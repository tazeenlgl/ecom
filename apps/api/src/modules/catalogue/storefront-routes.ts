import { and, asc, desc, eq, ilike, inArray, isNotNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import {
  attributeDefinitions,
  categories,
  collectionProducts,
  collections,
  posStockLevels,
  productCategories,
  productMedia,
  products,
  productVariants,
  sizeCharts,
  storeDomains,
  variantPrices,
} from '../../db/schema.js';
import { notFound } from '../../lib/errors.js';
import { cursorCondition, pageQuery, toPage } from '../../lib/pagination.js';
import { defineRoute, slug } from '../../lib/route.js';
import { breadcrumbChain, canonicalProductUrl, metaDescription, stockState } from './seo.js';

/** Public catalogue reads. Only published products and active categories/collections are visible. */
export function catalogueStorefrontRoutes(ctx: AppContext) {
  return async (app: FastifyInstance) => {
    const tag = 'Storefront: catalogue';

    defineRoute(app, { method: 'GET', url: '/categories', summary: 'Active categories (flat list with parentId)', tag, auth: 'public' }, async (request) => ({
      items: await ctx.db
        .select({ id: categories.id, parentId: categories.parentId, slug: categories.slug, name: categories.name, description: categories.description, seo: categories.seo })
        .from(categories)
        .where(and(eq(categories.storeId, request.store.id), eq(categories.isActive, true)))
        .orderBy(asc(categories.position), asc(categories.name)),
    }));

    defineRoute(app, { method: 'GET', url: '/collections', summary: 'Active collections', tag, auth: 'public' }, async (request) => ({
      items: await ctx.db
        .select({ id: collections.id, slug: collections.slug, title: collections.title, description: collections.description, seo: collections.seo })
        .from(collections)
        .where(and(eq(collections.storeId, request.store.id), eq(collections.isActive, true)))
        .orderBy(asc(collections.title)),
    }));

    defineRoute(
      app,
      {
        method: 'GET',
        url: '/products',
        summary: 'Published products, filterable by category or collection slug and title search',
        tag,
        auth: 'public',
        query: pageQuery.extend({ category: slug.optional(), collection: slug.optional(), q: z.string().min(1).max(100).optional() }),
      },
      async (request, { query }) => {
        const storeId = request.store.id;
        const filters = [];
        if (query.category) {
          filters.push(
            inArray(
              products.id,
              ctx.db
                .select({ id: productCategories.productId })
                .from(productCategories)
                .innerJoin(categories, eq(categories.id, productCategories.categoryId))
                .where(and(eq(categories.storeId, storeId), eq(categories.slug, query.category), eq(categories.isActive, true))),
            ),
          );
        }
        if (query.collection) {
          filters.push(
            inArray(
              products.id,
              ctx.db
                .select({ id: collectionProducts.productId })
                .from(collectionProducts)
                .innerJoin(collections, eq(collections.id, collectionProducts.collectionId))
                .where(and(eq(collections.storeId, storeId), eq(collections.slug, query.collection), eq(collections.isActive, true))),
            ),
          );
        }
        if (query.q) filters.push(ilike(products.title, `%${query.q.replace(/[%_\\]/g, '\\$&')}%`));

        const rows = await ctx.db
          .select({
            id: products.id,
            slug: products.slug,
            title: products.title,
            createdAt: products.createdAt,
            updatedAt: products.updatedAt,
            // Lets the sitemap leave out products an admin hid from search engines.
            noIndex: sql<boolean>`coalesce(("products"."seo"->>'noIndex')::boolean, false)`,
            // The outer id must be table-qualified: drizzle renders a bare "id" in a single-table select, which would bind to the subquery's own id column.
            minPricePaise: sql<number | null>`(select min(vp.price_paise) from ${variantPrices} vp join ${productVariants} pv on pv.id = vp.variant_id where pv.product_id = "products"."id" and pv.status = 'active')`,
            maxMrpPaise: sql<number | null>`(select max(vp.mrp_paise) from ${variantPrices} vp join ${productVariants} pv on pv.id = vp.variant_id where pv.product_id = "products"."id" and pv.status = 'active')`,
            imageUrl: sql<string | null>`(select pm.url from ${productMedia} pm where pm.product_id = "products"."id" and pm.kind = 'image' order by pm.position limit 1)`,
            // Second photo for the card's hover swap.
            hoverImageUrl: sql<string | null>`(select pm.url from ${productMedia} pm where pm.product_id = "products"."id" and pm.kind = 'image' order by pm.position offset 1 limit 1)`,
            // Card label from the product's `label` attribute (a store-defined select, e.g. Bestseller).
            label: sql<string | null>`nullif("products"."attributes"->>'label', '')`,
            // Distinct colours of active variants (variant option `colour` or `color`), in variant order.
            colours: sql<string[]>`coalesce((select array_agg(c order by p) from (select coalesce(pv.options->>'colour', pv.options->>'color') as c, min(pv.position) as p from ${productVariants} pv where pv.product_id = "products"."id" and pv.status = 'active' group by 1) x where c is not null and c <> ''), '{}')`,
          })
          .from(products)
          .where(and(eq(products.storeId, storeId), eq(products.status, 'published'), ...filters, cursorCondition(query.cursor, products.createdAt, products.id)))
          .orderBy(desc(products.createdAt), desc(products.id))
          .limit(query.limit + 1);
        return toPage(rows, query.limit);
      },
    );

    defineRoute(
      app,
      { method: 'GET', url: '/products/:slug', summary: 'Product detail with variants, prices, availability, media and size chart', tag, auth: 'public', params: z.object({ slug }) },
      async (request, { params }) => {
        const store = request.store;
        const [product] = await ctx.db
          .select()
          .from(products)
          .where(and(eq(products.storeId, store.id), eq(products.slug, params.slug), eq(products.status, 'published')));
        if (!product) throw notFound('Product');

        const [variantRows, media, attributeDefs, chart, domains, activeCategories, productCats] = await Promise.all([
          ctx.db
            .select({
              id: productVariants.id,
              skuCode: productVariants.skuCode,
              title: productVariants.title,
              options: productVariants.options,
              mrpPaise: variantPrices.mrpPaise,
              pricePaise: variantPrices.pricePaise,
              available: posStockLevels.available,
            })
            .from(productVariants)
            .innerJoin(variantPrices, eq(variantPrices.variantId, productVariants.id))
            .leftJoin(posStockLevels, and(eq(posStockLevels.skuCode, productVariants.skuCode), eq(posStockLevels.locationRef, store.posLocationRef ?? '')))
            .where(and(eq(productVariants.storeId, store.id), eq(productVariants.productId, product.id), eq(productVariants.status, 'active')))
            .orderBy(asc(productVariants.position)),
          ctx.db
            .select({ url: productMedia.url, kind: productMedia.kind, altText: productMedia.altText, width: productMedia.width, height: productMedia.height, variantId: productMedia.variantId })
            .from(productMedia)
            .where(and(eq(productMedia.storeId, store.id), eq(productMedia.productId, product.id)))
            .orderBy(asc(productMedia.position)),
          ctx.db
            .select({ code: attributeDefinitions.code, label: attributeDefinitions.label, scope: attributeDefinitions.scope })
            .from(attributeDefinitions)
            .where(eq(attributeDefinitions.storeId, store.id)),
          product.sizeChartId
            ? ctx.db.select({ name: sizeCharts.name, chart: sizeCharts.chart, notes: sizeCharts.notes }).from(sizeCharts).where(and(eq(sizeCharts.storeId, store.id), eq(sizeCharts.id, product.sizeChartId)))
            : Promise.resolve([]),
          ctx.db.select({ hostname: storeDomains.hostname, isPrimary: storeDomains.isPrimary }).from(storeDomains).where(and(eq(storeDomains.storeId, store.id), isNotNull(storeDomains.verifiedAt))),
          ctx.db
            .select({ id: categories.id, parentId: categories.parentId, slug: categories.slug, name: categories.name })
            .from(categories)
            .where(and(eq(categories.storeId, store.id), eq(categories.isActive, true)))
            .orderBy(asc(categories.position), asc(categories.name)),
          ctx.db.select({ categoryId: productCategories.categoryId }).from(productCategories).where(and(eq(productCategories.storeId, store.id), eq(productCategories.productId, product.id))),
        ]);

        const primaryHost = domains.find((d) => d.isPrimary)?.hostname ?? null;
        const canonicalUrl = canonicalProductUrl({ primaryHost, verifiedHosts: domains.map((d) => d.hostname.toLowerCase()), slug: product.slug, override: product.seo.canonicalUrl });
        const inCategories = new Set(productCats.map((c) => c.categoryId));
        const breadcrumbs = breadcrumbChain(activeCategories, activeCategories.find((c) => inCategories.has(c.id))?.id);
        const labels = Object.fromEntries(attributeDefs.map((d) => [d.code, d.label]));
        return {
          product: {
            id: product.id,
            slug: product.slug,
            title: product.title,
            description: product.description,
            specifications: product.specifications,
            // `label` is the card label (merchandising), not a product detail, so it is left out here.
            attributes: Object.entries(product.attributes)
              .filter(([code]) => code !== 'label')
              .map(([code, value]) => ({ code, label: labels[code] ?? code, value })),
            seo: product.seo,
            // Resolved on the server so the storefront only renders it (docs/product-management, SEO Part C).
            canonicalUrl,
            // No verified primary domain, no canonical: such a page is not offered to search engines.
            indexable: canonicalUrl !== null && !product.seo.noIndex,
            metaDescription: product.seo.description?.trim() || metaDescription(product.description),
            breadcrumbs,
            sizeChart: chart[0] ?? null,
            media,
            // SKU codes are POS identifiers; they are shown so support can reference them.
            variants: variantRows.map(({ available, ...v }) => ({
              ...v,
              // Tri-state: a SKU the POS never reported is 'unknown', which must not be shown as out of stock.
              stock: stockState(available),
              optionLabels: Object.fromEntries(Object.keys(v.options).map((code) => [code, labels[code] ?? code])),
              inStock: available !== null && available > 0,
            })),
          },
        };
      },
    );
  };
}
