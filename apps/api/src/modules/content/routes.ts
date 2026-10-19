import { and, asc, eq, gt, isNull, lte, or } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { contentBlocks, contentPages } from '../../db/schema.js';
import { actorOf, recordAudit } from '../../lib/audit.js';
import { notFound } from '../../lib/errors.js';
import { defineRoute, seoSchema, slug, storeEntityParams, storeParams } from '../../lib/route.js';
import { requireStore } from '../platform/routes.js';

const link = z.object({ label: z.string().min(1).max(80), href: z.string().max(500).regex(/^(\/|https:\/\/)/) });
type Link = z.infer<typeof link> & { children?: Link[] };
const navItem: z.ZodType<Link> = z.lazy(() => link.extend({ children: z.array(navItem).max(30).optional() }));
const image = z.object({ url: z.url({ protocol: /^https$/ }).max(1000), alt: z.string().max(300).optional() });

/** Shape of `data` per block kind, so the storefront can rely on it. */
const blockData = {
  navigation: z.object({ items: z.array(navItem).max(30) }).strict(),
  banner: z.object({ image, mobileImage: image.optional(), link: link.optional(), headline: z.string().max(200).optional() }).strict(),
  homepage_section: z
    .object({
      layout: z.enum(['hero', 'product_grid', 'collection_grid', 'category_grid', 'rich_text', 'image_with_text']),
      heading: z.string().max(200).optional(),
      body: z.string().max(5000).optional(),
      image: image.optional(),
      collectionSlug: slug.optional(),
      categorySlugs: z.array(slug).max(24).optional(),
      productLimit: z.number().int().min(1).max(48).optional(),
      link: link.optional(),
    })
    .strict(),
} as const;

const blockBase = z.object({
  key: slug,
  title: z.string().max(200).nullable().optional(),
  status: z.enum(['draft', 'published']).default('draft'),
  position: z.number().int().default(0),
  startsAt: z.iso.datetime({ offset: true }).nullable().optional(),
  endsAt: z.iso.datetime({ offset: true }).nullable().optional(),
});
const blockBody = z.discriminatedUnion('kind', [
  blockBase.extend({ kind: z.literal('navigation'), data: blockData.navigation }),
  blockBase.extend({ kind: z.literal('banner'), data: blockData.banner }),
  blockBase.extend({ kind: z.literal('homepage_section'), data: blockData.homepage_section }),
]);

const pageBody = z.object({
  kind: z.enum(['page', 'policy', 'faq']),
  slug,
  title: z.string().min(1).max(200),
  body: z.string().max(100_000),
  status: z.enum(['draft', 'published']),
  position: z.number().int(),
  seo: seoSchema.optional(),
});
// Defaults only on create, so PATCH never resets omitted fields (e.g. unpublishing a page).
const createPage = pageBody.extend({
  body: pageBody.shape.body.default(''),
  status: pageBody.shape.status.default('draft'),
  position: pageBody.shape.position.default(0),
});

const toDates = (b: { startsAt?: string | null; endsAt?: string | null }) => ({
  startsAt: b.startsAt ? new Date(b.startsAt) : null,
  endsAt: b.endsAt ? new Date(b.endsAt) : null,
});

export function contentAdminRoutes(ctx: AppContext) {
  return async (app: FastifyInstance) => {
    const tag = 'Admin: content';
    const auth = { admin: 'content.write' } as const;

    defineRoute(app, { method: 'GET', url: '/stores/:storeId/pages', summary: 'List pages, policies and FAQs', tag, auth: { admin: 'store.read' }, params: storeParams }, async (_r, { params }) => ({
      items: await ctx.db.select().from(contentPages).where(eq(contentPages.storeId, params.storeId)).orderBy(asc(contentPages.kind), asc(contentPages.position)),
    }));

    defineRoute(app, { method: 'POST', url: '/stores/:storeId/pages', summary: 'Create a page, policy or FAQ entry', tag, auth, status: 201, params: storeParams, body: createPage }, async (request, { params, body }) =>
      ctx.db.transaction(async (tx) => {
        await requireStore(tx, params.storeId);
        const [page] = await tx.insert(contentPages).values({ ...body, storeId: params.storeId }).returning();
        await recordAudit(tx, { storeId: params.storeId, actor: actorOf(request), action: 'page.create', entityType: 'content_page', entityId: page!.id, changes: { slug: body.slug } });
        return { page };
      }),
    );

    defineRoute(app, { method: 'PATCH', url: '/stores/:storeId/pages/:id', summary: 'Update a page', tag, auth, params: storeEntityParams, body: pageBody.partial() }, async (request, { params, body }) =>
      ctx.db.transaction(async (tx) => {
        const [page] = await tx.update(contentPages).set(body).where(and(eq(contentPages.storeId, params.storeId), eq(contentPages.id, params.id))).returning();
        if (!page) throw notFound('Page');
        await recordAudit(tx, { storeId: params.storeId, actor: actorOf(request), action: 'page.update', entityType: 'content_page', entityId: page.id, changes: { fields: Object.keys(body) } });
        return { page };
      }),
    );

    defineRoute(app, { method: 'GET', url: '/stores/:storeId/blocks', summary: 'List homepage sections, navigation menus and banners', tag, auth: { admin: 'store.read' }, params: storeParams }, async (_r, { params }) => ({
      items: await ctx.db.select().from(contentBlocks).where(eq(contentBlocks.storeId, params.storeId)).orderBy(asc(contentBlocks.kind), asc(contentBlocks.position)),
    }));

    // Create or replace by (kind, key): blocks are configuration, edited as a whole.
    defineRoute(app, { method: 'PUT', url: '/stores/:storeId/blocks', summary: 'Create or replace a content block by kind and key', tag, auth, params: storeParams, body: blockBody }, async (request, { params, body }) =>
      ctx.db.transaction(async (tx) => {
        await requireStore(tx, params.storeId);
        const values = { ...body, ...toDates(body), storeId: params.storeId };
        const [block] = await tx
          .insert(contentBlocks)
          .values(values)
          .onConflictDoUpdate({ target: [contentBlocks.storeId, contentBlocks.kind, contentBlocks.key], set: { title: values.title ?? null, data: values.data, status: values.status, position: values.position, startsAt: values.startsAt, endsAt: values.endsAt, updatedAt: ctx.now() } })
          .returning();
        await recordAudit(tx, { storeId: params.storeId, actor: actorOf(request), action: 'block.save', entityType: 'content_block', entityId: block!.id, changes: { kind: body.kind, key: body.key, status: body.status } });
        return { block };
      }),
    );

    defineRoute(app, { method: 'DELETE', url: '/stores/:storeId/blocks/:id', summary: 'Delete a content block', tag, auth, status: 204, params: storeEntityParams }, async (request, { params }) =>
      ctx.db.transaction(async (tx) => {
        const [block] = await tx.delete(contentBlocks).where(and(eq(contentBlocks.storeId, params.storeId), eq(contentBlocks.id, params.id))).returning();
        if (!block) throw notFound('Block');
        await recordAudit(tx, { storeId: params.storeId, actor: actorOf(request), action: 'block.delete', entityType: 'content_block', entityId: block.id, changes: { kind: block.kind, key: block.key } });
      }),
    );
  };
}

export function contentStorefrontRoutes(ctx: AppContext) {
  return async (app: FastifyInstance) => {
    const tag = 'Storefront: content';

    defineRoute(app, { method: 'GET', url: '/pages/:slug', summary: 'A published page, policy or FAQ entry', tag, auth: 'public', params: z.object({ slug }) }, async (request, { params }) => {
      const [page] = await ctx.db
        .select({ kind: contentPages.kind, slug: contentPages.slug, title: contentPages.title, body: contentPages.body, seo: contentPages.seo, updatedAt: contentPages.updatedAt })
        .from(contentPages)
        .where(and(eq(contentPages.storeId, request.store.id), eq(contentPages.slug, params.slug), eq(contentPages.status, 'published')));
      if (!page) throw notFound('Page');
      return { page };
    });

    defineRoute(app, { method: 'GET', url: '/faqs', summary: 'Published FAQ entries', tag, auth: 'public' }, async (request) => ({
      items: await ctx.db
        .select({ slug: contentPages.slug, title: contentPages.title, body: contentPages.body })
        .from(contentPages)
        .where(and(eq(contentPages.storeId, request.store.id), eq(contentPages.kind, 'faq'), eq(contentPages.status, 'published')))
        .orderBy(asc(contentPages.position)),
    }));

    defineRoute(
      app,
      { method: 'GET', url: '/content/blocks', summary: 'Published blocks of a kind that are live now', tag, auth: 'public', query: z.object({ kind: z.enum(['homepage_section', 'navigation', 'banner']) }) },
      async (request, { query }) => {
        const now = ctx.now();
        return {
          items: await ctx.db
            .select({ key: contentBlocks.key, title: contentBlocks.title, data: contentBlocks.data, position: contentBlocks.position })
            .from(contentBlocks)
            .where(
              and(
                eq(contentBlocks.storeId, request.store.id),
                eq(contentBlocks.kind, query.kind),
                eq(contentBlocks.status, 'published'),
                or(isNull(contentBlocks.startsAt), lte(contentBlocks.startsAt, now)),
                or(isNull(contentBlocks.endsAt), gt(contentBlocks.endsAt, now)),
              ),
            )
            .orderBy(asc(contentBlocks.position)),
        };
      },
    );
  };
}
