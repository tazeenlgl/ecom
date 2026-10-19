import { and, asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { shippingZones } from '../../db/schema.js';
import { actorOf, recordAudit } from '../../lib/audit.js';
import { notFound } from '../../lib/errors.js';
import { defineRoute, paise, storeEntityParams, storeParams } from '../../lib/route.js';
import { requireStore } from '../platform/routes.js';
import { findZone } from './zones.js';

const zoneFields = z.object({
    name: z.string().min(1).max(120),
    pincodePrefixes: z.array(z.string().regex(/^[1-9]\d{0,5}$/)).min(1).max(1000),
    chargePaise: paise,
    freeAbovePaise: paise.nullable().optional(),
    codAvailable: z.boolean().optional(),
    codFeePaise: paise.optional(),
    estimatedDaysMin: z.number().int().min(0).max(60).nullable().optional(),
    estimatedDaysMax: z.number().int().min(0).max(60).nullable().optional(),
    isActive: z.boolean().optional(),
});
const zoneBody = zoneFields.refine((z) => z.estimatedDaysMin == null || z.estimatedDaysMax == null || z.estimatedDaysMin <= z.estimatedDaysMax, 'estimatedDaysMin must not exceed estimatedDaysMax');

export function shippingAdminRoutes(ctx: AppContext) {
  return async (app: FastifyInstance) => {
    const tag = 'Admin: shipping';
    const auth = { admin: 'shipping.write' } as const;

    defineRoute(app, { method: 'GET', url: '/stores/:storeId/shipping-zones', summary: 'List shipping zones', tag, auth: { admin: 'store.read' }, params: storeParams }, async (_r, { params }) => ({
      items: await ctx.db.select().from(shippingZones).where(eq(shippingZones.storeId, params.storeId)).orderBy(asc(shippingZones.name)),
    }));

    defineRoute(app, { method: 'POST', url: '/stores/:storeId/shipping-zones', summary: 'Create a shipping zone', tag, auth, status: 201, params: storeParams, body: zoneBody }, async (request, { params, body }) =>
      ctx.db.transaction(async (tx) => {
        await requireStore(tx, params.storeId);
        const [zone] = await tx.insert(shippingZones).values({ ...body, storeId: params.storeId }).returning();
        await recordAudit(tx, { storeId: params.storeId, actor: actorOf(request), action: 'shipping_zone.create', entityType: 'shipping_zone', entityId: zone!.id, changes: body });
        return { zone };
      }),
    );

    defineRoute(
      app,
      { method: 'PATCH', url: '/stores/:storeId/shipping-zones/:id', summary: 'Update a shipping zone', tag, auth, params: storeEntityParams, body: zoneFields.partial() },
      async (request, { params, body }) =>
        ctx.db.transaction(async (tx) => {
          const [zone] = await tx.update(shippingZones).set(body).where(and(eq(shippingZones.storeId, params.storeId), eq(shippingZones.id, params.id))).returning();
          if (!zone) throw notFound('Shipping zone');
          await recordAudit(tx, { storeId: params.storeId, actor: actorOf(request), action: 'shipping_zone.update', entityType: 'shipping_zone', entityId: zone.id, changes: body });
          return { zone };
        }),
    );
  };
}

export function shippingStorefrontRoutes(ctx: AppContext) {
  return async (app: FastifyInstance) => {
    defineRoute(
      app,
      {
        method: 'GET',
        url: '/shipping/serviceability',
        summary: 'Whether a PIN code is serviceable, with charge and COD availability',
        tag: 'Storefront: shipping',
        auth: 'public',
        query: z.object({ pincode: z.string().regex(/^[1-9]\d{5}$/) }),
      },
      async (request, { query }) => {
        const zone = await findZone(ctx.db, request.store.id, query.pincode);
        if (!zone) return { pincode: query.pincode, serviceable: false };
        return {
          pincode: query.pincode,
          serviceable: true,
          chargePaise: zone.chargePaise,
          freeAbovePaise: zone.freeAbovePaise,
          codAvailable: zone.codAvailable && request.store.config.codEnabled === true,
          estimatedDays: zone.estimatedDaysMin !== null && zone.estimatedDaysMax !== null ? [zone.estimatedDaysMin, zone.estimatedDaysMax] : null,
        };
      },
    );
  };
}
