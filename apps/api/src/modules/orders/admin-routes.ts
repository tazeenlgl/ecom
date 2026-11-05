import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import type { Tx } from '../../db/client.js';
import {
  orderEvents,
  orderItems,
  orders,
  paymentTransactions,
  refunds,
  returnRequests,
  shipmentEvents,
  shipments,
} from '../../db/schema.js';
import { actorOf, recordAudit } from '../../lib/audit.js';
import { AppError, notFound } from '../../lib/errors.js';
import { cursorCondition, pageQuery, toPage } from '../../lib/pagination.js';
import { defineRoute, paise, storeEntityParams, storeParams } from '../../lib/route.js';
import { enqueueJob } from '../jobs/queue.js';
import { createRefund, markRefund } from '../payments/service.js';
import { addOrderEvent, cancelOrder, lockOrder, notifyOrder, transitionOrder } from './service.js';
import { assertTransition, canTransition } from './state-machines.js';

type ShipmentStatus = (typeof shipments.$inferSelect)['status'];

/** How a shipment status maps onto the order's fulfillment status. */
const FULFILLMENT_FOR: Partial<Record<ShipmentStatus, 'packed' | 'shipped' | 'delivered' | 'delivery_failed' | 'returned_to_origin'>> = {
  packed: 'packed',
  shipped: 'shipped',
  in_transit: 'shipped',
  out_for_delivery: 'shipped',
  delivered: 'delivered',
  delivery_failed: 'delivery_failed',
  rto_delivered: 'returned_to_origin',
};

/** True when the refund is paid back through an online provider (not a cash-on-delivery payout). */
async function isOnlineRefund(tx: Tx, refund: typeof refunds.$inferSelect): Promise<boolean> {
  if (!refund.paymentTransactionId) return false;
  const [txn] = await tx.select({ provider: paymentTransactions.provider }).from(paymentTransactions).where(eq(paymentTransactions.id, refund.paymentTransactionId));
  return Boolean(txn && txn.provider !== 'cod');
}

/** The staff member must enter the provider's refund id back, proving they opened this refund at the provider. */
function requireProviderRefundId(refund: typeof refunds.$inferSelect, entered: string) {
  if (!refund.providerRef || refund.providerRef.trim().toLowerCase() !== entered.trim().toLowerCase()) {
    throw new AppError(422, 'invalid_request', "Enter this refund's provider refund id exactly as the provider shows it.", { field: 'reference' });
  }
}

/** Confirming a refund must never take the order's refunded amount above what was collected. */
async function assertWithinOrderTotal(tx: Tx, order: { id: string; totalPaise: number; refundedPaise: number }, refund: typeof refunds.$inferSelect) {
  const [others] = await tx
    .select({ total: sql<number>`coalesce(sum(${refunds.amountPaise}), 0)::int` })
    .from(refunds)
    .where(and(eq(refunds.orderId, order.id), inArray(refunds.status, ['pending', 'processing']), ne(refunds.id, refund.id)));
  const would = order.refundedPaise + (others?.total ?? 0) + refund.amountPaise;
  if (would > order.totalPaise) {
    throw new AppError(409, 'conflict', 'Confirming this refund would refund more than the order total. Another refund has already been recorded for this money.', {
      orderTotalPaise: order.totalPaise,
      refundedPaise: order.refundedPaise,
      otherInFlightPaise: others?.total ?? 0,
    });
  }
}

export function orderAdminRoutes(ctx: AppContext) {
  return async (app: FastifyInstance) => {
    const tag = 'Admin: orders';
    const read = { admin: 'orders.read' } as const;
    const manage = { admin: 'orders.manage' } as const;

    defineRoute(
      app,
      {
        method: 'GET',
        url: '/stores/:storeId/orders',
        summary: 'List orders with state filters',
        tag,
        auth: read,
        params: storeParams,
        query: pageQuery.extend({
          status: z.enum(['pending_payment', 'confirmed', 'processing', 'completed', 'cancelled']).optional(),
          posSyncStatus: z.enum(['pending', 'in_progress', 'synced', 'failed', 'manual_required']).optional(),
        }),
      },
      async (_r, { params, query }) => {
        const rows = await ctx.db
          .select()
          .from(orders)
          .where(
            and(
              eq(orders.storeId, params.storeId),
              query.status ? eq(orders.status, query.status) : undefined,
              query.posSyncStatus ? eq(orders.posSyncStatus, query.posSyncStatus) : undefined,
              cursorCondition(query.cursor, orders.createdAt, orders.id),
            ),
          )
          .orderBy(desc(orders.createdAt), desc(orders.id))
          .limit(query.limit + 1);
        const page = toPage(rows, query.limit);
        return { ...page, items: page.items.map(({ idempotencyKey: _k, requestHash: _h, ...o }) => o) };
      },
    );

    defineRoute(app, { method: 'GET', url: '/stores/:storeId/orders/:id', summary: 'Full order: items, timeline, payments, refunds, shipments, returns', tag, auth: read, params: storeEntityParams }, async (_r, { params }) => {
      const [order] = await ctx.db.select().from(orders).where(and(eq(orders.storeId, params.storeId), eq(orders.id, params.id)));
      if (!order) throw notFound('Order');
      const scope = (t: { storeId: AnyPgColumn; orderId: AnyPgColumn }) => and(eq(t.storeId, params.storeId), eq(t.orderId, order.id));
      const [items, events, payments, refundRows, shipmentRows, returns] = await Promise.all([
        ctx.db.select().from(orderItems).where(scope(orderItems)),
        ctx.db.select().from(orderEvents).where(scope(orderEvents)).orderBy(asc(orderEvents.createdAt)),
        ctx.db.select().from(paymentTransactions).where(scope(paymentTransactions)).orderBy(asc(paymentTransactions.createdAt)),
        ctx.db.select().from(refunds).where(scope(refunds)).orderBy(asc(refunds.createdAt)),
        ctx.db.select().from(shipments).where(scope(shipments)),
        ctx.db.select().from(returnRequests).where(scope(returnRequests)),
      ]);
      const { idempotencyKey: _k, requestHash: _h, ...rest } = order;
      return { order: rest, items, timeline: events, payments, refunds: refundRows, shipments: shipmentRows, returns };
    });

    defineRoute(
      app,
      {
        method: 'POST',
        url: '/stores/:storeId/orders/:id/status',
        summary: 'Move the order status forward (processing, completed)',
        tag,
        auth: manage,
        params: storeEntityParams,
        body: z.object({ to: z.enum(['processing', 'completed']), note: z.string().max(500).optional() }),
      },
      async (request, { params, body }) =>
        ctx.db.transaction(async (tx) => {
          const order = await lockOrder(tx, params.storeId, params.id);
          const updated = await transitionOrder(tx, order, 'order', body.to, actorOf(request), { ...(body.note ? { note: body.note } : {}), isPublic: true });
          return { order: updated };
        }),
    );

    defineRoute(
      app,
      { method: 'POST', url: '/stores/:storeId/orders/:id/cancel', summary: 'Cancel an unshipped order (refund is queued if paid)', tag, auth: manage, params: storeEntityParams, body: z.object({ reason: z.string().min(1).max(500) }) },
      async (request, { params, body }) =>
        ctx.db.transaction(async (tx) => {
          const order = await lockOrder(tx, params.storeId, params.id);
          return { order: await cancelOrder(ctx, tx, order, actorOf(request), body.reason) };
        }),
    );

    defineRoute(
      app,
      { method: 'POST', url: '/stores/:storeId/orders/:id/notes', summary: 'Add an internal note to the timeline', tag, auth: manage, status: 201, params: storeEntityParams, body: z.object({ note: z.string().min(1).max(2000) }) },
      async (request, { params, body }) => {
        const [order] = await ctx.db.select().from(orders).where(and(eq(orders.storeId, params.storeId), eq(orders.id, params.id)));
        if (!order) throw notFound('Order');
        await addOrderEvent(ctx.db, order, { machine: 'note', actor: actorOf(request), note: body.note });
      },
    );

    // Payments (COD and refunds) ---------------------------------------------
    const refundAuth = { admin: 'refunds.manage' } as const;

    defineRoute(
      app,
      { method: 'POST', url: '/stores/:storeId/orders/:id/cod-collected', summary: 'Record cash collected on delivery', tag: 'Admin: payments', auth: manage, params: storeEntityParams },
      async (request, { params }) =>
        ctx.db.transaction(async (tx) => {
          let order = await lockOrder(tx, params.storeId, params.id);
          assertTransition('payment', order.paymentStatus, 'cod_collected');
          await tx.insert(paymentTransactions).values({ storeId: order.storeId, orderId: order.id, provider: 'cod', status: 'succeeded', amountPaise: order.totalPaise, currency: order.currency });
          order = await transitionOrder(tx, order, 'payment', 'cod_collected', actorOf(request));
          await recordAudit(tx, { storeId: order.storeId, actor: actorOf(request), action: 'order.cod_collected', entityType: 'order', entityId: order.id });
          return { order };
        }),
    );

    defineRoute(
      app,
      {
        method: 'POST',
        url: '/stores/:storeId/orders/:id/refunds',
        summary: 'Refund part or all of a collected payment. Requires Idempotency-Key',
        tag: 'Admin: payments',
        auth: refundAuth,
        status: 201,
        idempotencyKey: true,
        params: storeEntityParams,
        body: z.object({ amountPaise: paise.min(1), reason: z.string().min(1).max(500), returnRequestId: z.uuid().optional() }),
      },
      async (request, { params, body, idempotencyKey }) =>
        ctx.db.transaction(async (tx) => {
          const order = await lockOrder(tx, params.storeId, params.id);
          if (body.returnRequestId) {
            const [rr] = await tx.select().from(returnRequests).where(and(eq(returnRequests.storeId, order.storeId), eq(returnRequests.orderId, order.id), eq(returnRequests.id, body.returnRequestId)));
            if (!rr) throw notFound('Return request');
          }
          const refund = await createRefund(ctx, tx, order, { ...body, idempotencyKey: `admin:${idempotencyKey}`, actor: actorOf(request) });
          await recordAudit(tx, { storeId: order.storeId, actor: actorOf(request), action: 'refund.create', entityType: 'order', entityId: order.id, changes: { refundId: refund.id, amountPaise: body.amountPaise } });
          return { refund };
        }),
    );

    defineRoute(
      app,
      {
        method: 'POST',
        url: '/stores/:storeId/refunds/:id/mark-succeeded',
        summary: 'Record a refund paid outside a provider (COD), or confirm an online refund the provider accepted (status processing) after checking it in the provider dashboard',
        tag: 'Admin: payments',
        auth: refundAuth,
        params: storeEntityParams,
        body: z.object({ reference: z.string().min(1).max(200) }),
      },
      async (request, { params, body }) =>
        ctx.db.transaction(async (tx) => {
          const [refund] = await tx.select().from(refunds).where(and(eq(refunds.storeId, params.storeId), eq(refunds.id, params.id))).for('update');
          if (!refund) throw notFound('Refund');
          const online = await isOnlineRefund(tx, refund);
          // An online refund can be confirmed by hand only after the provider accepted it (it has the
          // provider's refund id): while processing, or to correct a refund wrongly marked failed. One still
          // pending is sent by the job, and confirming it here would record a refund that was never made.
          const correction = online && refund.status === 'failed';
          if (online && (!refund.providerRef || !['processing', 'failed'].includes(refund.status))) {
            throw new AppError(409, 'conflict', 'An online refund can be confirmed by hand only after the provider has accepted it (status processing, or failed by mistake).');
          }
          // The staff member must have opened this refund at the provider: its id has to be entered back.
          if (online) requireProviderRefundId(refund, body.reference);
          assertTransition('refund', refund.status, 'succeeded');
          const order = await lockOrder(tx, refund.storeId, refund.orderId);
          if (online) await assertWithinOrderTotal(tx, order, refund);
          // COD: the staff reference becomes the refund reference. Online: keep the provider's own refund id.
          if (!online) await tx.update(refunds).set({ providerRef: body.reference }).where(eq(refunds.id, refund.id));
          await markRefund(ctx, tx, refund, 'succeeded', actorOf(request), undefined, { reference: body.reference.trim(), note: correction ? 'Corrected from failed after checking the provider dashboard.' : online ? 'Confirmed after checking the provider dashboard.' : 'Paid outside the provider.' });
          await addOrderEvent(tx, order, {
            machine: 'refund',
            actor: actorOf(request),
            note: !online
              ? 'Refund recorded as paid outside the provider.'
              : correction
                ? 'A refund marked failed was corrected to paid by staff after checking the provider dashboard.'
                : 'Refund confirmed as paid by staff after checking the provider dashboard.',
          });
          await recordAudit(tx, {
            storeId: params.storeId,
            actor: actorOf(request),
            action: correction ? 'refund.manual_correction' : 'refund.manual_success',
            entityType: 'refund',
            entityId: refund.id,
            changes: { reference: body.reference, online, fromStatus: refund.status, providerRef: refund.providerRef, amountPaise: refund.amountPaise },
          });
          return { refundId: refund.id, status: 'succeeded' };
        }),
    );

    defineRoute(
      app,
      {
        method: 'POST',
        url: '/stores/:storeId/refunds/:id/mark-failed',
        summary: 'Record that an online refund the provider accepted (status processing) did not complete, after checking it in the provider dashboard. Frees the amount for a new refund',
        tag: 'Admin: payments',
        auth: refundAuth,
        params: storeEntityParams,
        body: z.object({ reference: z.string().min(1).max(200), reason: z.string().trim().min(10).max(190) }),
      },
      async (request, { params, body }) =>
        ctx.db.transaction(async (tx) => {
          const [refund] = await tx.select().from(refunds).where(and(eq(refunds.storeId, params.storeId), eq(refunds.id, params.id))).for('update');
          if (!refund) throw notFound('Refund');
          if (!(await isOnlineRefund(tx, refund)) || refund.status !== 'processing' || !refund.providerRef) {
            throw new AppError(409, 'conflict', 'Only an online refund in status processing can be marked failed by hand.');
          }
          requireProviderRefundId(refund, body.reference);
          // The settlement columns record who did this and why. The amount stays held for a day in createRefund,
          // so a mistaken failure can be corrected (mark-succeeded) before the same money is refunded again.
          await markRefund(ctx, tx, refund, 'failed', actorOf(request), 'manual_failure', { reference: body.reference.trim(), note: body.reason });
          await recordAudit(tx, {
            storeId: params.storeId,
            actor: actorOf(request),
            action: 'refund.manual_failure',
            entityType: 'refund',
            entityId: refund.id,
            changes: { reference: body.reference, reason: body.reason, fromStatus: refund.status, providerRef: refund.providerRef, amountPaise: refund.amountPaise },
          });
          return { refundId: refund.id, status: 'failed' };
        }),
    );

    // Shipments and tracking -----------------------------------------------------
    const shipTag = 'Admin: fulfillment';

    defineRoute(
      app,
      {
        method: 'POST',
        url: '/stores/:storeId/orders/:id/shipments',
        summary: 'Create a shipment for a confirmed order (manual courier details)',
        tag: shipTag,
        auth: manage,
        status: 201,
        params: storeEntityParams,
        body: z.object({ courier: z.string().min(1).max(80).optional(), trackingNumber: z.string().min(1).max(80).optional(), trackingUrl: z.url().max(500).optional() }),
      },
      async (request, { params, body }) =>
        ctx.db.transaction(async (tx) => {
          const order = await lockOrder(tx, params.storeId, params.id);
          if (!['confirmed', 'processing'].includes(order.status)) throw new AppError(409, 'invalid_transition', 'Only confirmed orders can be shipped.');
          const [shipment] = await tx.insert(shipments).values({ storeId: order.storeId, orderId: order.id, ...body }).returning();
          await addOrderEvent(tx, order, { machine: 'fulfillment', actor: actorOf(request), note: 'Shipment created' });
          return { shipment };
        }),
    );

    defineRoute(
      app,
      {
        method: 'POST',
        url: '/stores/:storeId/shipments/:id/events',
        summary: 'Record a tracking event; out-of-order and duplicate events are kept but do not move status backwards',
        tag: shipTag,
        auth: manage,
        status: 201,
        params: storeEntityParams,
        body: z.object({
          status: z.enum(['packed', 'shipped', 'in_transit', 'out_for_delivery', 'delivered', 'delivery_failed', 'rto_initiated', 'rto_delivered', 'cancelled']),
          occurredAt: z.iso.datetime({ offset: true }),
          description: z.string().max(500).optional(),
          location: z.string().max(200).optional(),
          externalEventId: z.string().max(200).optional(),
          trackingNumber: z.string().max(80).optional(),
          courier: z.string().max(80).optional(),
        }),
      },
      async (request, { params, body }) =>
        ctx.db.transaction(async (tx) => {
          const [shipment] = await tx.select().from(shipments).where(and(eq(shipments.storeId, params.storeId), eq(shipments.id, params.id))).for('update');
          if (!shipment) throw notFound('Shipment');
          const occurredAt = new Date(body.occurredAt);
          const [inserted] = await tx
            .insert(shipmentEvents)
            .values({
              storeId: shipment.storeId,
              shipmentId: shipment.id,
              status: body.status,
              description: body.description ?? null,
              location: body.location ?? null,
              externalEventId: body.externalEventId ?? null,
              source: 'admin',
              occurredAt,
            })
            .onConflictDoNothing()
            .returning({ id: shipmentEvents.id });
          if (!inserted) return { shipment, applied: false, reason: 'duplicate' };

          const [latest] = await tx
            .select({ occurredAt: shipmentEvents.occurredAt })
            .from(shipmentEvents)
            .where(eq(shipmentEvents.shipmentId, shipment.id))
            .orderBy(desc(shipmentEvents.occurredAt))
            .limit(1);
          const isNewest = !latest || latest.occurredAt.getTime() <= occurredAt.getTime();
          if (!isNewest || !canTransition('shipment', shipment.status, body.status)) {
            return { shipment, applied: false, reason: isNewest ? 'invalid_transition' : 'out_of_order' };
          }

          const [updated] = await tx
            .update(shipments)
            .set({ status: body.status, ...(body.trackingNumber ? { trackingNumber: body.trackingNumber } : {}), ...(body.courier ? { courier: body.courier } : {}) })
            .where(eq(shipments.id, shipment.id))
            .returning();

          const actor = actorOf(request);
          let order = await lockOrder(tx, shipment.storeId, shipment.orderId);
          const target = FULFILLMENT_FOR[body.status];
          if (target && target !== order.fulfillmentStatus && canTransition('fulfillment', order.fulfillmentStatus, target)) {
            order = await transitionOrder(tx, order, 'fulfillment', target, actor, { isPublic: true });
            if (target === 'shipped') {
              if (order.status === 'confirmed') order = await transitionOrder(tx, order, 'order', 'processing', actor);
              await notifyOrder(tx, order, 'order.shipped', shipment.id);
            }
            if (target === 'delivered') {
              if (canTransition('order', order.status, 'completed')) order = await transitionOrder(tx, order, 'order', 'completed', actor, { isPublic: true });
              await notifyOrder(tx, order, 'order.delivered', shipment.id);
            }
          }
          return { shipment: updated, applied: true };
        }),
    );

    // Returns --------------------------------------------------------------------
    defineRoute(
      app,
      {
        method: 'POST',
        url: '/stores/:storeId/returns/:id/status',
        summary: 'Approve, reject, receive, complete or cancel a return/exchange',
        tag: 'Admin: returns',
        auth: manage,
        params: storeEntityParams,
        body: z.object({ to: z.enum(['approved', 'rejected', 'received', 'completed', 'cancelled']), note: z.string().max(1000).optional() }),
      },
      async (request, { params, body }) =>
        ctx.db.transaction(async (tx) => {
          const [rr] = await tx.select().from(returnRequests).where(and(eq(returnRequests.storeId, params.storeId), eq(returnRequests.id, params.id))).for('update');
          if (!rr) throw notFound('Return request');
          assertTransition('return', rr.status, body.to);
          const [updated] = await tx.update(returnRequests).set({ status: body.to, resolutionNote: body.note ?? rr.resolutionNote }).where(eq(returnRequests.id, rr.id)).returning();
          await addOrderEvent(tx, { id: rr.orderId, storeId: rr.storeId }, { machine: 'return', from: rr.status, to: body.to, actor: actorOf(request), ...(body.note ? { note: body.note } : {}), isPublic: true });
          await notifyOrder(tx, { id: rr.orderId, storeId: rr.storeId }, `return.${body.to}`, rr.id);
          return { returnRequest: updated };
        }),
    );

    // POS synchronisation recovery -------------------------------------------------
    const posAuth = { admin: 'pos.manage' } as const;

    defineRoute(
      app,
      { method: 'POST', url: '/stores/:storeId/orders/:id/pos-sync/retry', summary: 'Re-queue POS submission for a failed order', tag: 'Admin: POS', auth: posAuth, params: storeEntityParams },
      async (request, { params }) =>
        ctx.db.transaction(async (tx) => {
          let order = await lockOrder(tx, params.storeId, params.id);
          if (!ctx.pos.capabilities().submitOrder) throw new AppError(409, 'conflict', 'The POS adapter cannot accept orders; mark it synced after manual entry.');
          order = await transitionOrder(tx, order, 'pos_sync', 'pending', actorOf(request), { note: 'Retry requested' });
          await enqueueJob(tx, { type: 'pos.submit_order', storeId: order.storeId, payload: { orderId: order.id }, idempotencyKey: `pos.submit_order:${order.id}:${Date.now()}` });
          return { order };
        }),
    );

    defineRoute(
      app,
      {
        method: 'POST',
        url: '/stores/:storeId/orders/:id/pos-sync/mark-synced',
        summary: 'Record that the order was entered in the POS manually',
        tag: 'Admin: POS',
        auth: posAuth,
        params: storeEntityParams,
        body: z.object({ posOrderRef: z.string().min(1).max(100) }),
      },
      async (request, { params, body }) =>
        ctx.db.transaction(async (tx) => {
          let order = await lockOrder(tx, params.storeId, params.id);
          order = await transitionOrder(tx, order, 'pos_sync', 'synced', actorOf(request), { note: `Manual POS entry ${body.posOrderRef}` });
          const [updated] = await tx.update(orders).set({ posOrderRef: body.posOrderRef }).where(eq(orders.id, order.id)).returning();
          await recordAudit(tx, { storeId: order.storeId, actor: actorOf(request), action: 'order.pos_mark_synced', entityType: 'order', entityId: order.id, changes: body });
          return { order: updated };
        }),
    );
  };
}
