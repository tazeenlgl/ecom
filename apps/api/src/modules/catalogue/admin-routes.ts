import { and, asc, desc, eq, ilike, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import type { Tx } from '../../db/client.js';
import {
  attributeDefinitions,
  categories,
  collectionProducts,
  collections,
  priceHistory,
  productCategories,
  productMedia,
  products,
  productVariants,
  sizeCharts,
  variantPrices,
} from '../../db/schema.js';
import { actorOf, recordAudit } from '../../lib/audit.js';
import { AppError, notFound } from '../../lib/errors.js';
import { cursorCondition, pageQuery, toPage } from '../../lib/pagination.js';
import { defineRoute, paise, seoSchema, slug, storeEntityParams, storeParams } from '../../lib/route.js';
import { requireStore } from '../platform/routes.js';
import { validateAttributes } from './attributes.js';

const attributeValue = z.union([z.string().max(500), z.number(), z.boolean()]);
const read = { admin: 'catalogue.read' } as const;
const write = { admin: 'catalogue.write' } as const;

/** Throws 404 unless every id belongs to the store (guards against cross-store id injection). */
async function assertOwned(tx: Tx, table: typeof categories | typeof collections, storeId: string, ids: string[]) {
  if (ids.length === 0) return;
  const unique = [...new Set(ids)];
  const rows = await tx.select({ id: table.id }).from(table).where(and(eq(table.storeId, storeId), inArray(table.id, unique)));
  if (rows.length !== unique.length) throw notFound(table === categories ? 'Category' : 'Collection');
}

async function findProduct(tx: Tx | AppContext['db'], storeId: string, id: string) {
  const [product] = await tx.select().from(products).where(and(eq(products.storeId, storeId), eq(products.id, id)));
  if (!product) throw notFound('Product');
  return product;
}

export function catalogueAdminRoutes(ctx: AppContext) {
  return async (app: FastifyInstance) => {
    // Attribute definitions ---------------------------------------------------
    const attrTag = 'Admin: catalogue attributes';
    const attributeBody = z.object({
      code: z.string().regex(/^[a-z][a-z0-9_]{0,40}$/),
      label: z.string().min(1).max(80),
      type: z.enum(['text', 'number', 'boolean', 'select']),
      scope: z.enum(['product', 'variant']),
      options: z.array(z.string().min(1).max(80)).max(200),
      isFilterable: z.boolean(),
      position: z.number().int(),
    });
    // Defaults only on create, so PATCH never resets omitted fields.
    const createAttribute = attributeBody.extend({
      options: attributeBody.shape.options.default([]),
      isFilterable: attributeBody.shape.isFilterable.default(false),
      position: attributeBody.shape.position.default(0),
    });

    defineRoute(app, { method: 'GET', url: '/stores/:storeId/attributes', summary: 'List attribute definitions', tag: attrTag, auth: read, params: storeParams }, async (_r, { params }) => ({
      items: await ctx.db.select().from(attributeDefinitions).where(eq(attributeDefinitions.storeId, params.storeId)).orderBy(asc(attributeDefinitions.position)),
    }));

    defineRoute(
      app,
      { method: 'POST', url: '/stores/:storeId/attributes', summary: 'Define an attribute', tag: attrTag, auth: write, status: 201, params: storeParams, body: createAttribute },
      async (request, { params, body }) => {
        if (body.type === 'select' && body.options.length === 0) throw new AppError(400, 'invalid_request', 'Select attributes need options.');
        return ctx.db.transaction(async (tx) => {
          await requireStore(tx, params.storeId);
          const [attribute] = await tx.insert(attributeDefinitions).values({ ...body, storeId: params.storeId }).returning();
          await recordAudit(tx, { storeId: params.storeId, actor: actorOf(request), action: 'attribute.create', entityType: 'attribute', entityId: attribute!.id, changes: body });
          return { attribute };
        });
      },
    );

    defineRoute(
      app,
      {
        method: 'PATCH',
        url: '/stores/:storeId/attributes/:id',
        summary: 'Update an attribute definition (code, type and scope are fixed)',
        tag: attrTag,
        auth: write,
        params: storeEntityParams,
        body: attributeBody.pick({ label: true, options: true, isFilterable: true, position: true }).partial(),
      },
      async (request, { params, body }) =>
        ctx.db.transaction(async (tx) => {
          const [attribute] = await tx
            .update(attributeDefinitions)
            .set(body)
            .where(and(eq(attributeDefinitions.storeId, params.storeId), eq(attributeDefinitions.id, params.id)))
            .returning();
          if (!attribute) throw notFound('Attribute');
          await recordAudit(tx, { storeId: params.storeId, actor: actorOf(request), action: 'attribute.update', entityType: 'attribute', entityId: attribute.id, changes: body });
          return { attribute };
        }),
    );

    // Categories ---------------------------------------------------------------
    const catTag = 'Admin: categories and collections';
    const categoryBody = z.object({
      slug,
      name: z.string().min(1).max(120),
      parentId: z.uuid().nullable().optional(),
      description: z.string().max(5000).nullable().optional(),
      position: z.number().int().optional(),
      isActive: z.boolean().optional(),
      seo: seoSchema.optional(),
    });

    defineRoute(app, { method: 'GET', url: '/stores/:storeId/categories', summary: 'List categories', tag: catTag, auth: read, params: storeParams }, async (_r, { params }) => ({
      items: await ctx.db.select().from(categories).where(eq(categories.storeId, params.storeId)).orderBy(asc(categories.position), asc(categories.name)),
    }));

    defineRoute(
      app,
      { method: 'POST', url: '/stores/:storeId/categories', summary: 'Create a category or subcategory', tag: catTag, auth: write, status: 201, params: storeParams, body: categoryBody },
      async (request, { params, body }) =>
        ctx.db.transaction(async (tx) => {
          await requireStore(tx, params.storeId);
          if (body.parentId) await assertOwned(tx, categories, params.storeId, [body.parentId]);
          const [category] = await tx.insert(categories).values({ ...body, storeId: params.storeId }).returning();
          await recordAudit(tx, { storeId: params.storeId, actor: actorOf(request), action: 'category.create', entityType: 'category', entityId: category!.id, changes: body });
          return { category };
        }),
    );

    defineRoute(
      app,
      { method: 'PATCH', url: '/stores/:storeId/categories/:id', summary: 'Update a category', tag: catTag, auth: write, params: storeEntityParams, body: categoryBody.partial() },
      async (request, { params, body }) =>
        ctx.db.transaction(async (tx) => {
          if (body.parentId) {
            if (body.parentId === params.id) throw new AppError(400, 'invalid_request', 'A category cannot be its own parent.');
            await assertOwned(tx, categories, params.storeId, [body.parentId]);
            // Reject cycles: the new parent must not be a descendant of this category.
            const cycle = await tx.execute<{ id: string }>(sql`
              with recursive descendants as (
                select id from ${categories} where parent_id = ${params.id} and store_id = ${params.storeId}
                union all
                select c.id from ${categories} c join descendants d on c.parent_id = d.id
              ) select id from descendants where id = ${body.parentId} limit 1`);
            if (cycle.rows.length) throw new AppError(400, 'invalid_request', 'That parent would create a cycle.');
          }
          const [category] = await tx
            .update(categories)
            .set(body)
            .where(and(eq(categories.storeId, params.storeId), eq(categories.id, params.id)))
            .returning();
          if (!category) throw notFound('Category');
          await recordAudit(tx, { storeId: params.storeId, actor: actorOf(request), action: 'category.update', entityType: 'category', entityId: category.id, changes: body });
          return { category };
        }),
    );

    // Size charts --------------------------------------------------------------
    const chartBody = z.object({
      name: z.string().min(1).max(120),
      chart: z.object({ columns: z.array(z.string().max(40)).min(1).max(20), rows: z.array(z.array(z.string().max(40)).max(20)).max(100), unit: z.string().max(10).optional() }),
      notes: z.string().max(2000).nullable().optional(),
    });

    defineRoute(app, { method: 'GET', url: '/stores/:storeId/size-charts', summary: 'List size charts', tag: catTag, auth: read, params: storeParams }, async (_r, { params }) => ({
      items: await ctx.db.select().from(sizeCharts).where(eq(sizeCharts.storeId, params.storeId)),
    }));

    defineRoute(
      app,
      { method: 'POST', url: '/stores/:storeId/size-charts', summary: 'Create a size chart', tag: catTag, auth: write, status: 201, params: storeParams, body: chartBody },
      async (request, { params, body }) =>
        ctx.db.transaction(async (tx) => {
          await requireStore(tx, params.storeId);
          const [sizeChart] = await tx.insert(sizeCharts).values({ ...body, storeId: params.storeId }).returning();
          await recordAudit(tx, { storeId: params.storeId, actor: actorOf(request), action: 'size_chart.create', entityType: 'size_chart', entityId: sizeChart!.id });
          return { sizeChart };
        }),
    );

    defineRoute(
      app,
      { method: 'PATCH', url: '/stores/:storeId/size-charts/:id', summary: 'Update a size chart', tag: catTag, auth: write, params: storeEntityParams, body: chartBody.partial() },
      async (request, { params, body }) =>
        ctx.db.transaction(async (tx) => {
          const [sizeChart] = await tx.update(sizeCharts).set(body).where(and(eq(sizeCharts.storeId, params.storeId), eq(sizeCharts.id, params.id))).returning();
          if (!sizeChart) throw notFound('Size chart');
          await recordAudit(tx, { storeId: params.storeId, actor: actorOf(request), action: 'size_chart.update', entityType: 'size_chart', entityId: sizeChart.id });
          return { sizeChart };
        }),
    );

    // Collections ---------------------------------------------------------------
    const collectionBody = z.object({
      slug,
      title: z.string().min(1).max(160),
      description: z.string().max(5000).nullable().optional(),
      isActive: z.boolean().optional(),
      seo: seoSchema.optional(),
    });

    defineRoute(app, { method: 'GET', url: '/stores/:storeId/collections', summary: 'List collections', tag: catTag, auth: read, params: storeParams }, async (_r, { params }) => ({
      items: await ctx.db.select().from(collections).where(eq(collections.storeId, params.storeId)).orderBy(asc(collections.title)),
    }));

    defineRoute(
      app,
      { method: 'POST', url: '/stores/:storeId/collections', summary: 'Create a collection', tag: catTag, auth: write, status: 201, params: storeParams, body: collectionBody },
      async (request, { params, body }) =>
        ctx.db.transaction(async (tx) => {
          await requireStore(tx, params.storeId);
          const [collection] = await tx.insert(collections).values({ ...body, storeId: params.storeId }).returning();
          await recordAudit(tx, { storeId: params.storeId, actor: actorOf(request), action: 'collection.create', entityType: 'collection', entityId: collection!.id, changes: body });
          return { collection };
        }),
    );

    defineRoute(
      app,
      { method: 'PATCH', url: '/stores/:storeId/collections/:id', summary: 'Update a collection', tag: catTag, auth: write, params: storeEntityParams, body: collectionBody.partial() },
      async (request, { params, body }) =>
        ctx.db.transaction(async (tx) => {
          const [collection] = await tx.update(collections).set(body).where(and(eq(collections.storeId, params.storeId), eq(collections.id, params.id))).returning();
          if (!collection) throw notFound('Collection');
          await recordAudit(tx, { storeId: params.storeId, actor: actorOf(request), action: 'collection.update', entityType: 'collection', entityId: collection.id, changes: body });
          return { collection };
        }),
    );

    defineRoute(
      app,
      {
        method: 'PUT',
        url: '/stores/:storeId/collections/:id/products',
        summary: 'Replace the ordered product list of a collection',
        tag: catTag,
        auth: write,
        params: storeEntityParams,
        body: z.object({ productIds: z.array(z.uuid()).max(1000) }),
      },
      async (request, { params, body }) =>
        ctx.db.transaction(async (tx) => {
          await assertOwned(tx, collections, params.storeId, [params.id]);
          const ids = [...new Set(body.productIds)];
          if (ids.length) {
            const owned = await tx.select({ id: products.id }).from(products).where(and(eq(products.storeId, params.storeId), inArray(products.id, ids)));
            if (owned.length !== ids.length) throw notFound('Product');
          }
          await tx.delete(collectionProducts).where(and(eq(collectionProducts.storeId, params.storeId), eq(collectionProducts.collectionId, params.id)));
          if (ids.length) {
            await tx.insert(collectionProducts).values(ids.map((productId, position) => ({ storeId: params.storeId, collectionId: params.id, productId, position })));
          }
          await recordAudit(tx, { storeId: params.storeId, actor: actorOf(request), action: 'collection.products', entityType: 'collection', entityId: params.id, changes: { productIds: ids } });
          return { productIds: ids };
        }),
    );

    // Products --------------------------------------------------------------------
    const prodTag = 'Admin: products';
    const productBody = z.object({
      slug,
      title: z.string().min(1).max(200),
      description: z.string().max(20000).nullable().optional(),
      specifications: z.array(z.object({ label: z.string().min(1).max(80), value: z.string().max(500) })).max(50).optional(),
      attributes: z.record(z.string(), attributeValue).optional(),
      taxRateBps: z.number().int().min(0).max(10000).optional(),
      hsnCode: z.string().regex(/^\d{4,8}$/).nullable().optional(),
      sizeChartId: z.uuid().nullable().optional(),
      seo: seoSchema.optional(),
      categoryIds: z.array(z.uuid()).max(20).optional(),
    });

    async function saveCategories(tx: Tx, storeId: string, productId: string, categoryIds: string[] | undefined) {
      if (!categoryIds) return;
      await assertOwned(tx, categories, storeId, categoryIds);
      await tx.delete(productCategories).where(and(eq(productCategories.storeId, storeId), eq(productCategories.productId, productId)));
      const ids = [...new Set(categoryIds)];
      if (ids.length) await tx.insert(productCategories).values(ids.map((categoryId) => ({ storeId, productId, categoryId })));
    }

    async function assertSizeChart(tx: Tx, storeId: string, sizeChartId: string | null | undefined) {
      if (!sizeChartId) return;
      const [chart] = await tx.select({ id: sizeCharts.id }).from(sizeCharts).where(and(eq(sizeCharts.storeId, storeId), eq(sizeCharts.id, sizeChartId)));
      if (!chart) throw notFound('Size chart');
    }

    defineRoute(
      app,
      {
        method: 'GET',
        url: '/stores/:storeId/products',
        summary: 'List products',
        tag: prodTag,
        auth: read,
        params: storeParams,
        query: pageQuery.extend({ status: z.enum(['draft', 'published', 'archived']).optional(), q: z.string().max(100).optional() }),
      },
      async (_r, { params, query }) => {
        const rows = await ctx.db
          .select()
          .from(products)
          .where(
            and(
              eq(products.storeId, params.storeId),
              query.status ? eq(products.status, query.status) : undefined,
              query.q ? ilike(products.title, `%${query.q.replace(/[%_\\]/g, '\\$&')}%`) : undefined,
              cursorCondition(query.cursor, products.createdAt, products.id),
            ),
          )
          .orderBy(desc(products.createdAt), desc(products.id))
          .limit(query.limit + 1);
        return toPage(rows, query.limit);
      },
    );

    defineRoute(
      app,
      { method: 'POST', url: '/stores/:storeId/products', summary: 'Create a draft product', tag: prodTag, auth: write, status: 201, params: storeParams, body: productBody },
      async (request, { params, body }) =>
        ctx.db.transaction(async (tx) => {
          await requireStore(tx, params.storeId);
          const { categoryIds, ...fields } = body;
          await validateAttributes(tx, params.storeId, 'product', fields.attributes ?? {});
          await assertSizeChart(tx, params.storeId, fields.sizeChartId);
          const [product] = await tx.insert(products).values({ ...fields, storeId: params.storeId, status: 'draft' }).returning();
          await saveCategories(tx, params.storeId, product!.id, categoryIds);
          await recordAudit(tx, { storeId: params.storeId, actor: actorOf(request), action: 'product.create', entityType: 'product', entityId: product!.id, changes: { slug: body.slug, title: body.title } });
          return { product };
        }),
    );

    defineRoute(
      app,
      { method: 'GET', url: '/stores/:storeId/products/:id', summary: 'Get a product with variants, prices, media and categories', tag: prodTag, auth: read, params: storeEntityParams },
      async (_r, { params }) => {
        const product = await findProduct(ctx.db, params.storeId, params.id);
        const variants = await ctx.db
          .select({ variant: productVariants, price: variantPrices })
          .from(productVariants)
          .leftJoin(variantPrices, eq(variantPrices.variantId, productVariants.id))
          .where(and(eq(productVariants.storeId, params.storeId), eq(productVariants.productId, product.id)))
          .orderBy(asc(productVariants.position));
        const media = await ctx.db.select().from(productMedia).where(and(eq(productMedia.storeId, params.storeId), eq(productMedia.productId, product.id))).orderBy(asc(productMedia.position));
        const cats = await ctx.db.select({ id: productCategories.categoryId }).from(productCategories).where(eq(productCategories.productId, product.id));
        return {
          product,
          categoryIds: cats.map((c) => c.id),
          variants: variants.map((v) => ({ ...v.variant, price: v.price ? { mrpPaise: v.price.mrpPaise, pricePaise: v.price.pricePaise } : null })),
          media,
        };
      },
    );

    defineRoute(
      app,
      { method: 'PATCH', url: '/stores/:storeId/products/:id', summary: 'Update product content', tag: prodTag, auth: write, params: storeEntityParams, body: productBody.partial() },
      async (request, { params, body }) =>
        ctx.db.transaction(async (tx) => {
          await findProduct(tx, params.storeId, params.id);
          const { categoryIds, ...fields } = body;
          if (fields.attributes) await validateAttributes(tx, params.storeId, 'product', fields.attributes);
          await assertSizeChart(tx, params.storeId, fields.sizeChartId);
          const [product] = Object.keys(fields).length
            ? await tx.update(products).set(fields).where(and(eq(products.storeId, params.storeId), eq(products.id, params.id))).returning()
            : [await findProduct(tx, params.storeId, params.id)];
          await saveCategories(tx, params.storeId, params.id, categoryIds);
          await recordAudit(tx, { storeId: params.storeId, actor: actorOf(request), action: 'product.update', entityType: 'product', entityId: params.id, changes: { fields: Object.keys(body) } });
          return { product };
        }),
    );

    defineRoute(
      app,
      {
        method: 'POST',
        url: '/stores/:storeId/products/:id/status',
        summary: 'Publish, unpublish (draft) or archive a product',
        tag: prodTag,
        auth: write,
        params: storeEntityParams,
        body: z.object({ status: z.enum(['draft', 'published', 'archived']) }),
      },
      async (request, { params, body }) =>
        ctx.db.transaction(async (tx) => {
          const product = await findProduct(tx, params.storeId, params.id);
          if (body.status === 'published') {
            const [sellable] = await tx
              .select({ id: productVariants.id })
              .from(productVariants)
              .innerJoin(variantPrices, eq(variantPrices.variantId, productVariants.id))
              .where(and(eq(productVariants.storeId, params.storeId), eq(productVariants.productId, product.id), eq(productVariants.status, 'active')))
              .limit(1);
            if (!sellable) throw new AppError(409, 'conflict', 'A product needs at least one active, priced variant before it can be published.');
          }
          const [updated] = await tx
            .update(products)
            .set({ status: body.status, publishedAt: body.status === 'published' ? (product.publishedAt ?? ctx.now()) : product.publishedAt })
            .where(eq(products.id, product.id))
            .returning();
          await recordAudit(tx, { storeId: params.storeId, actor: actorOf(request), action: 'product.status', entityType: 'product', entityId: product.id, changes: { from: product.status, to: body.status } });
          return { product: updated };
        }),
    );

    // Variants ---------------------------------------------------------------------
    const variantBody = z.object({
      skuCode: z.string().min(1).max(64).regex(/^[A-Za-z0-9._\-/]+$/),
      title: z.string().min(1).max(200),
      options: z.record(z.string(), z.string().max(80)).optional(),
      status: z.enum(['active', 'inactive']).optional(),
      position: z.number().int().optional(),
      weightGrams: z.number().int().positive().nullable().optional(),
    });

    defineRoute(
      app,
      {
        method: 'POST',
        url: '/stores/:storeId/products/:id/variants',
        summary: 'Add a variant mapped to an existing POS SKU code',
        tag: prodTag,
        auth: write,
        status: 201,
        params: storeEntityParams,
        body: variantBody,
      },
      async (request, { params, body }) =>
        ctx.db.transaction(async (tx) => {
          await findProduct(tx, params.storeId, params.id);
          await validateAttributes(tx, params.storeId, 'variant', body.options ?? {});
          const [variant] = await tx.insert(productVariants).values({ ...body, storeId: params.storeId, productId: params.id }).returning();
          await recordAudit(tx, { storeId: params.storeId, actor: actorOf(request), action: 'variant.create', entityType: 'variant', entityId: variant!.id, changes: { skuCode: body.skuCode } });
          return { variant };
        }),
    );

    defineRoute(
      app,
      {
        method: 'PATCH',
        url: '/stores/:storeId/variants/:id',
        summary: 'Update a variant (SKU code changes are audited)',
        tag: prodTag,
        auth: write,
        params: storeEntityParams,
        body: variantBody.partial(),
      },
      async (request, { params, body }) =>
        ctx.db.transaction(async (tx) => {
          if (body.options) await validateAttributes(tx, params.storeId, 'variant', body.options);
          const [before] = await tx.select().from(productVariants).where(and(eq(productVariants.storeId, params.storeId), eq(productVariants.id, params.id)));
          if (!before) throw notFound('Variant');
          const [variant] = await tx.update(productVariants).set(body).where(eq(productVariants.id, before.id)).returning();
          await recordAudit(tx, {
            storeId: params.storeId,
            actor: actorOf(request),
            action: 'variant.update',
            entityType: 'variant',
            entityId: before.id,
            changes: body.skuCode && body.skuCode !== before.skuCode ? { skuCode: { from: before.skuCode, to: body.skuCode } } : { fields: Object.keys(body) },
          });
          return { variant };
        }),
    );

    // Prices ---------------------------------------------------------------------------
    defineRoute(
      app,
      {
        method: 'PUT',
        url: '/stores/:storeId/variants/:id/price',
        summary: 'Set the online selling price and MRP (paise, GST-inclusive)',
        tag: 'Admin: pricing',
        auth: { admin: 'pricing.write' },
        params: storeEntityParams,
        body: z.object({ mrpPaise: paise.min(1), pricePaise: paise.min(1) }).refine((b) => b.pricePaise <= b.mrpPaise, 'Price cannot exceed MRP.'),
      },
      async (request, { params, body }) =>
        ctx.db.transaction(async (tx) => {
          const [variant] = await tx.select({ id: productVariants.id }).from(productVariants).where(and(eq(productVariants.storeId, params.storeId), eq(productVariants.id, params.id)));
          if (!variant) throw notFound('Variant');
          const actor = actorOf(request);
          const values = { storeId: params.storeId, variantId: variant.id, ...body, updatedBy: actor.id, updatedAt: ctx.now() };
          const [price] = await tx
            .insert(variantPrices)
            .values(values)
            .onConflictDoUpdate({ target: variantPrices.variantId, set: { mrpPaise: body.mrpPaise, pricePaise: body.pricePaise, updatedBy: actor.id, updatedAt: ctx.now() } })
            .returning();
          await tx.insert(priceHistory).values({ storeId: params.storeId, variantId: variant.id, ...body, changedBy: actor.id });
          await recordAudit(tx, { storeId: params.storeId, actor, action: 'price.set', entityType: 'variant', entityId: variant.id, changes: body });
          return { price };
        }),
    );

    defineRoute(
      app,
      { method: 'GET', url: '/stores/:storeId/variants/:id/price-history', summary: 'Price change history', tag: 'Admin: pricing', auth: read, params: storeEntityParams },
      async (_r, { params }) => ({
        items: await ctx.db
          .select()
          .from(priceHistory)
          .where(and(eq(priceHistory.storeId, params.storeId), eq(priceHistory.variantId, params.id)))
          .orderBy(desc(priceHistory.createdAt)),
      }),
    );

    // Media metadata -------------------------------------------------------------------
    defineRoute(
      app,
      {
        method: 'POST',
        url: '/stores/:storeId/products/:id/media',
        summary: 'Attach media metadata (file hosted elsewhere)',
        tag: prodTag,
        auth: write,
        status: 201,
        params: storeEntityParams,
        body: z.object({
          url: z.url({ protocol: /^https$/ }).max(1000),
          kind: z.enum(['image', 'video']).default('image'),
          variantId: z.uuid().nullable().optional(),
          altText: z.string().max(300).nullable().optional(),
          width: z.number().int().positive().nullable().optional(),
          height: z.number().int().positive().nullable().optional(),
          position: z.number().int().default(0),
        }),
      },
      async (request, { params, body }) =>
        ctx.db.transaction(async (tx) => {
          await findProduct(tx, params.storeId, params.id);
          if (body.variantId) {
            const [v] = await tx
              .select({ id: productVariants.id })
              .from(productVariants)
              .where(and(eq(productVariants.storeId, params.storeId), eq(productVariants.productId, params.id), eq(productVariants.id, body.variantId)));
            if (!v) throw notFound('Variant');
          }
          const [media] = await tx.insert(productMedia).values({ ...body, storeId: params.storeId, productId: params.id }).returning();
          await recordAudit(tx, { storeId: params.storeId, actor: actorOf(request), action: 'media.add', entityType: 'product', entityId: params.id, changes: { mediaId: media!.id } });
          return { media };
        }),
    );

    defineRoute(
      app,
      { method: 'DELETE', url: '/stores/:storeId/media/:id', summary: 'Remove media metadata', tag: prodTag, auth: write, status: 204, params: storeEntityParams },
      async (request, { params }) =>
        ctx.db.transaction(async (tx) => {
          const [media] = await tx.delete(productMedia).where(and(eq(productMedia.storeId, params.storeId), eq(productMedia.id, params.id))).returning();
          if (!media) throw notFound('Media');
          await recordAudit(tx, { storeId: params.storeId, actor: actorOf(request), action: 'media.remove', entityType: 'product', entityId: media.productId, changes: { mediaId: media.id } });
        }),
    );
  };
}
