import { and, count, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import type { Tx } from '../../db/client.js';
import { collections, coupons, products, promotionRedemptions, promotions } from '../../db/schema.js';
import { actorOf, recordAudit } from '../../lib/audit.js';
import { AppError, notFound } from '../../lib/errors.js';
import { defineRoute, paise, storeEntityParams, storeParams } from '../../lib/route.js';
import { requireStore } from '../platform/routes.js';
import { promotionConfigSchemas } from './engine.js';

// No defaults here: PATCH bodies must not silently reset omitted fields.
const promotionFields = z.object({
  name: z.string().min(1).max(160),
  kind: z.enum(['percentage', 'fixed_amount', 'buy_x_get_y', 'free_shipping']),
  config: z.record(z.string(), z.number()),
  eligibility: z.object({ productIds: z.array(z.uuid()).max(1000).optional(), collectionIds: z.array(z.uuid()).max(200).optional() }).strict(),
  minSubtotalPaise: paise,
  requiresCoupon: z.boolean(),
  priority: z.number().int().min(-1000).max(1000),
  stackable: z.boolean(),
  status: z.enum(['active', 'inactive']),
  startsAt: z.iso.datetime({ offset: true }).nullable(),
  endsAt: z.iso.datetime({ offset: true }).nullable(),
  usageLimit: z.number().int().positive().nullable(),
  perCustomerLimit: z.number().int().positive().nullable(),
});
const createPromotion = promotionFields.partial().required({ name: true, kind: true }).extend({
  config: promotionFields.shape.config.default({}),
  eligibility: promotionFields.shape.eligibility.default({}),
});

/** Validates kind-specific config and that eligibility ids belong to the store. */
async function validatePromotion(tx: Tx, storeId: string, p: { kind: keyof typeof promotionConfigSchemas; config: Record<string, number>; eligibility: { productIds?: string[]; collectionIds?: string[] } }) {
  const parsed = promotionConfigSchemas[p.kind].safeParse(p.config);
  if (!parsed.success) throw new AppError(400, 'invalid_request', `Invalid config for a ${p.kind} promotion.`, parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
  const productIds = [...new Set(p.eligibility.productIds ?? [])];
  const collectionIds = [...new Set(p.eligibility.collectionIds ?? [])];
  if (productIds.length) {
    const rows = await tx.select({ id: products.id }).from(products).where(and(eq(products.storeId, storeId), inArray(products.id, productIds)));
    if (rows.length !== productIds.length) throw notFound('Product');
  }
  if (collectionIds.length) {
    const rows = await tx.select({ id: collections.id }).from(collections).where(and(eq(collections.storeId, storeId), inArray(collections.id, collectionIds)));
    if (rows.length !== collectionIds.length) throw notFound('Collection');
  }
  return parsed.data as Record<string, number>;
}

const dates = (b: { startsAt?: string | null; endsAt?: string | null }) => ({
  ...(b.startsAt !== undefined ? { startsAt: b.startsAt ? new Date(b.startsAt) : null } : {}),
  ...(b.endsAt !== undefined ? { endsAt: b.endsAt ? new Date(b.endsAt) : null } : {}),
});

export function promotionAdminRoutes(ctx: AppContext) {
  return async (app: FastifyInstance) => {
    const tag = 'Admin: promotions';
    const auth = { admin: 'promotions.write' } as const;

    defineRoute(app, { method: 'GET', url: '/stores/:storeId/promotions', summary: 'List promotions with usage counts', tag, auth: { admin: 'catalogue.read' }, params: storeParams }, async (_r, { params }) => {
      const rows = await ctx.db.select().from(promotions).where(eq(promotions.storeId, params.storeId)).orderBy(desc(promotions.priority), desc(promotions.createdAt));
      const usage = await ctx.db
        .select({ promotionId: promotionRedemptions.promotionId, n: count() })
        .from(promotionRedemptions)
        .where(and(eq(promotionRedemptions.storeId, params.storeId), isNull(promotionRedemptions.voidedAt)))
        .groupBy(promotionRedemptions.promotionId);
      const used = new Map(usage.map((u) => [u.promotionId, u.n]));
      return { items: rows.map((p) => ({ ...p, timesUsed: used.get(p.id) ?? 0 })) };
    });

    defineRoute(app, { method: 'POST', url: '/stores/:storeId/promotions', summary: 'Create a promotion', tag, auth, status: 201, params: storeParams, body: createPromotion }, async (request, { params, body }) =>
      ctx.db.transaction(async (tx) => {
        await requireStore(tx, params.storeId);
        const config = await validatePromotion(tx, params.storeId, body);
        const { startsAt: _s, endsAt: _e, ...fields } = body;
        const [promotion] = await tx
          .insert(promotions)
          .values({ ...fields, ...dates(body), config, storeId: params.storeId })
          .returning();
        await recordAudit(tx, { storeId: params.storeId, actor: actorOf(request), action: 'promotion.create', entityType: 'promotion', entityId: promotion!.id, changes: body });
        return { promotion };
      }),
    );

    defineRoute(
      app,
      {
        method: 'PATCH',
        url: '/stores/:storeId/promotions/:id',
        summary: 'Update a promotion (kind is fixed)',
        tag,
        auth,
        params: storeEntityParams,
        body: promotionFields.omit({ kind: true }).partial(),
      },
      async (request, { params, body }) =>
        ctx.db.transaction(async (tx) => {
          const [current] = await tx.select().from(promotions).where(and(eq(promotions.storeId, params.storeId), eq(promotions.id, params.id))).for('update');
          if (!current) throw notFound('Promotion');
          const merged = { kind: current.kind, config: (body.config ?? current.config) as Record<string, number>, eligibility: body.eligibility ?? current.eligibility };
          const config = await validatePromotion(tx, params.storeId, merged);
          const { startsAt: _s, endsAt: _e, ...fields } = body;
          const [promotion] = await tx
            .update(promotions)
            .set({ ...fields, ...dates(body), config })
            .where(eq(promotions.id, current.id))
            .returning();
          await recordAudit(tx, { storeId: params.storeId, actor: actorOf(request), action: 'promotion.update', entityType: 'promotion', entityId: current.id, changes: body });
          return { promotion };
        }),
    );

    defineRoute(app, { method: 'GET', url: '/stores/:storeId/promotions/:id/coupons', summary: 'List coupon codes for a promotion', tag, auth: { admin: 'catalogue.read' }, params: storeEntityParams }, async (_r, { params }) => ({
      items: await ctx.db.select().from(coupons).where(and(eq(coupons.storeId, params.storeId), eq(coupons.promotionId, params.id))),
    }));

    defineRoute(
      app,
      {
        method: 'POST',
        url: '/stores/:storeId/promotions/:id/coupons',
        summary: 'Create a coupon code for a coupon-only promotion',
        tag,
        auth,
        status: 201,
        params: storeEntityParams,
        body: z.object({ code: z.string().min(3).max(40).regex(/^[A-Za-z0-9_-]+$/), usageLimit: z.number().int().positive().nullable().optional() }),
      },
      async (request, { params, body }) =>
        ctx.db.transaction(async (tx) => {
          const [promotion] = await tx.select().from(promotions).where(and(eq(promotions.storeId, params.storeId), eq(promotions.id, params.id)));
          if (!promotion) throw notFound('Promotion');
          if (!promotion.requiresCoupon) throw new AppError(409, 'conflict', 'This promotion applies automatically; set requiresCoupon first.');
          const [coupon] = await tx
            .insert(coupons)
            .values({ storeId: params.storeId, promotionId: promotion.id, code: body.code.toUpperCase(), usageLimit: body.usageLimit ?? null })
            .returning();
          await recordAudit(tx, { storeId: params.storeId, actor: actorOf(request), action: 'coupon.create', entityType: 'promotion', entityId: promotion.id, changes: { code: coupon!.code } });
          return { coupon };
        }),
    );

    defineRoute(
      app,
      {
        method: 'PATCH',
        url: '/stores/:storeId/coupons/:id',
        summary: 'Activate or deactivate a coupon',
        tag,
        auth,
        params: storeEntityParams,
        body: z.object({ isActive: z.boolean() }),
      },
      async (request, { params, body }) =>
        ctx.db.transaction(async (tx) => {
          const [coupon] = await tx.update(coupons).set(body).where(and(eq(coupons.storeId, params.storeId), eq(coupons.id, params.id))).returning();
          if (!coupon) throw notFound('Coupon');
          await recordAudit(tx, { storeId: params.storeId, actor: actorOf(request), action: 'coupon.update', entityType: 'coupon', entityId: coupon.id, changes: body });
          return { coupon };
        }),
    );
  };
}
