import { and, eq, sql } from 'drizzle-orm';
import type { AppContext } from '../../context.js';
import type { DbOrTx, Tx } from '../../db/client.js';
import { orderEvents, orders, promotionRedemptions, storeCounters } from '../../db/schema.js';
import type { Actor } from '../../lib/audit.js';
import { AppError, notFound } from '../../lib/errors.js';
import { enqueueJob } from '../jobs/queue.js';
import { createRefund } from '../payments/service.js';
import { assertTransition, type StateOf } from './state-machines.js';

export type Order = typeof orders.$inferSelect;

const COLUMN = {
  order: 'status',
  payment: 'paymentStatus',
  fulfillment: 'fulfillmentStatus',
  pos_sync: 'posSyncStatus',
} as const;
type OrderMachine = keyof typeof COLUMN;

/** Loads an order row-locked for update, scoped to the store. */
export async function lockOrder(tx: Tx, storeId: string, orderId: string): Promise<Order> {
  const [order] = await tx
    .select()
    .from(orders)
    .where(and(eq(orders.storeId, storeId), eq(orders.id, orderId)))
    .for('update');
  if (!order) throw notFound('Order');
  return order;
}

/**
 * Moves one of the order's state machines to `to` after checking the transition
 * is legal, and appends a timeline event. The caller holds the row lock.
 */
export async function transitionOrder<M extends OrderMachine>(
  tx: Tx,
  order: Order,
  machine: M,
  to: StateOf<M>,
  actor: Actor,
  options: { note?: string; isPublic?: boolean } = {},
): Promise<Order> {
  const column = COLUMN[machine];
  const from = order[column] as unknown as StateOf<M>;
  assertTransition(machine, from, to);
  const patch: Partial<Order> = { [column]: to } as Partial<Order>;
  if (machine === 'order' && to === 'cancelled') patch.cancelledAt = new Date();
  const [updated] = await tx.update(orders).set(patch).where(eq(orders.id, order.id)).returning();
  await addOrderEvent(tx, updated!, { machine, from, to, actor, ...options });
  return updated!;
}

export async function addOrderEvent(
  db: DbOrTx,
  order: Pick<Order, 'id' | 'storeId'>,
  e: { machine: string; from?: string | null; to?: string | null; actor: Actor; note?: string; isPublic?: boolean },
) {
  await db.insert(orderEvents).values({
    storeId: order.storeId,
    orderId: order.id,
    machine: e.machine,
    fromState: e.from ?? null,
    toState: e.to ?? null,
    actorType: e.actor.type,
    actorId: e.actor.id,
    note: e.note ?? null,
    isPublic: e.isPublic ?? false,
  });
}

/** Next order number for a store, e.g. ALPHA-000042. Allocated inside the order transaction. */
export async function nextOrderNumber(tx: Tx, store: { id: string; slug: string; config: { orderNumberPrefix?: string } }) {
  const [row] = await tx
    .insert(storeCounters)
    .values({ storeId: store.id, name: 'order', value: 1 })
    .onConflictDoUpdate({ target: [storeCounters.storeId, storeCounters.name], set: { value: sql`${storeCounters.value} + 1` } })
    .returning({ value: storeCounters.value });
  const prefix = store.config.orderNumberPrefix ?? store.slug.replace(/[^a-z0-9]/gi, '').slice(0, 8).toUpperCase();
  return `${prefix}-${String(row!.value).padStart(6, '0')}`;
}

/** Queues the customer notification for an order event; idempotent per order and template. */
export async function notifyOrder(db: DbOrTx, order: Pick<Order, 'id' | 'storeId'>, template: string, dedupeRef = '') {
  await enqueueJob(db, {
    type: 'notify.order',
    storeId: order.storeId,
    payload: { orderId: order.id, template },
    idempotencyKey: `notify:${template}:${order.id}:${dedupeRef}`,
  });
}

/**
 * Hands a confirmed order to the POS when the adapter supports order submission;
 * otherwise flags it for manual entry in the POS.
 */
export async function schedulePosSync(ctx: AppContext, tx: Tx, order: Order, actor: Actor): Promise<Order> {
  if (!ctx.pos.capabilities().submitOrder) {
    if (order.posSyncStatus === 'manual_required') return order;
    return transitionOrder(tx, order, 'pos_sync', 'manual_required', actor, { note: 'POS order submission is not available; enter this order in the POS.' });
  }
  await enqueueJob(tx, {
    type: 'pos.submit_order',
    storeId: order.storeId,
    payload: { orderId: order.id },
    idempotencyKey: `pos.submit_order:${order.id}`,
  });
  return order;
}

/**
 * Cancels an order: order → cancelled, unfulfilled → cancelled, promotion usage
 * released, and a full refund queued if money was collected online.
 */
export async function cancelOrder(ctx: AppContext, tx: Tx, order: Order, actor: Actor, reason: string): Promise<Order> {
  if (!['unfulfilled', 'packed'].includes(order.fulfillmentStatus)) {
    throw new AppError(409, 'invalid_transition', 'This order has already shipped and can no longer be cancelled.');
  }
  let updated = await transitionOrder(tx, order, 'order', 'cancelled', actor, { note: reason, isPublic: true });
  updated = await transitionOrder(tx, updated, 'fulfillment', 'cancelled', actor);
  await tx
    .update(promotionRedemptions)
    .set({ voidedAt: ctx.now() })
    .where(and(eq(promotionRedemptions.orderId, order.id), eq(promotionRedemptions.storeId, order.storeId)));
  if (updated.paymentStatus === 'paid') {
    await createRefund(ctx, tx, updated, {
      amountPaise: updated.totalPaise - updated.refundedPaise,
      reason: `Order cancelled: ${reason}`,
      idempotencyKey: `cancel:${updated.id}`,
      actor,
    });
  }
  if (ctx.pos.capabilities().cancelOrder && updated.posOrderRef) {
    await enqueueJob(tx, { type: 'pos.cancel_order', storeId: updated.storeId, payload: { orderId: updated.id }, idempotencyKey: `pos.cancel_order:${updated.id}` });
  }
  await notifyOrder(tx, updated, 'order.cancelled');
  return updated;
}
