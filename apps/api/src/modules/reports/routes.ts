import { and, count, eq, gte, lt, ne, sql, sum } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { orderItems, orders } from '../../db/schema.js';
import { AppError } from '../../lib/errors.js';
import { defineRoute, storeParams } from '../../lib/route.js';
import { requireStore } from '../platform/routes.js';

/** Read-only sales reporting from order snapshots (never from the live catalogue). */
export function reportRoutes(ctx: AppContext) {
  return async (app: FastifyInstance) => {
    defineRoute(
      app,
      {
        method: 'GET',
        url: '/stores/:storeId/reports/sales',
        summary: 'Daily order count and value, excluding cancelled orders (store timezone)',
        tag: 'Admin: reports',
        auth: { admin: 'reports.read' },
        params: storeParams,
        query: z.object({ from: z.iso.date(), to: z.iso.date() }),
      },
      async (_r, { params, query }) => {
        const store = await requireStore(ctx.db, params.storeId);
        const from = new Date(`${query.from}T00:00:00Z`);
        const to = new Date(`${query.to}T00:00:00Z`);
        if (to <= from || to.getTime() - from.getTime() > 366 * 86_400_000) {
          throw new AppError(400, 'invalid_request', 'Choose a range of 1 to 366 days.');
        }
        const day = sql<string>`to_char(${orders.placedAt} at time zone ${store.timezone}, 'YYYY-MM-DD')`;
        const scope = and(eq(orders.storeId, store.id), ne(orders.status, 'cancelled'), gte(orders.placedAt, from), lt(orders.placedAt, to));
        const [daily, top] = await Promise.all([
          ctx.db
            .select({ day, orders: count(), totalPaise: sum(orders.totalPaise).mapWith(Number), discountPaise: sum(orders.discountPaise).mapWith(Number), refundedPaise: sum(orders.refundedPaise).mapWith(Number) })
            .from(orders)
            .where(scope)
            .groupBy(day)
            .orderBy(day),
          ctx.db
            .select({ skuCode: orderItems.skuCode, title: orderItems.productTitle, units: sum(orderItems.quantity).mapWith(Number), revenuePaise: sum(orderItems.lineTotalPaise).mapWith(Number) })
            .from(orderItems)
            .innerJoin(orders, eq(orders.id, orderItems.orderId))
            .where(scope)
            .groupBy(orderItems.skuCode, orderItems.productTitle)
            .orderBy(sql`sum(${orderItems.lineTotalPaise}) desc`)
            .limit(20),
        ]);
        return { currency: store.currency, daily, topSkus: top };
      },
    );
  };
}
