import { and, eq } from 'drizzle-orm';
import type { AppContext } from '../../context.js';
import { orderItems, orders } from '../../db/schema.js';
import { systemActor } from '../../lib/audit.js';
import { addOrderEvent, cancelOrder, lockOrder, transitionOrder } from '../orders/service.js';
import { canTransition } from '../orders/state-machines.js';
import { processRefund, reconcilePendingPayments } from '../payments/service.js';
import { PosError } from '../pos/gateway.js';
import { syncStoreStock } from '../pos/stock.js';
import { type Job, type JobHandlers, PermanentJobError } from './queue.js';

function requireStoreId(job: Job): string {
  if (!job.storeId) throw new PermanentJobError(`${job.type} requires a store`);
  return job.storeId;
}

const payloadId = (job: Job, key: string): string => {
  const value = job.payload[key];
  if (typeof value !== 'string') throw new PermanentJobError(`${job.type} payload is missing ${key}`);
  return value;
};

/**
 * Every handler is idempotent (safe to run twice) and scopes its queries to
 * the job's store_id, so a job can never touch another tenant's data.
 */
export function jobHandlers(ctx: AppContext): JobHandlers {
  return {
    'notify.order': async (job) => {
      const storeId = requireStoreId(job);
      const [order] = await ctx.db
        .select({ orderNumber: orders.orderNumber, customerSnapshot: orders.customerSnapshot, totalPaise: orders.totalPaise })
        .from(orders)
        .where(and(eq(orders.storeId, storeId), eq(orders.id, payloadId(job, 'orderId'))));
      if (!order) throw new PermanentJobError('order not found');
      await ctx.messages.send({
        channel: 'sms',
        to: order.customerSnapshot.phone,
        template: String(job.payload.template),
        variables: { orderNumber: order.orderNumber, totalPaise: String(order.totalPaise) },
      });
    },

    'orders.expire_unpaid': async (job) => {
      const storeId = requireStoreId(job);
      await ctx.db.transaction(async (tx) => {
        const order = await lockOrder(tx, storeId, payloadId(job, 'orderId'));
        // Only cancels orders still waiting for money; a late webhook will refund if it arrives later.
        if (order.status !== 'pending_payment' || order.paymentStatus === 'paid') return;
        await cancelOrder(ctx, tx, order, systemActor, 'Payment not received in time');
      });
    },

    'pos.submit_order': async (job) => {
      const storeId = requireStoreId(job);
      const orderId = payloadId(job, 'orderId');
      const submit = ctx.pos.submitOrder?.bind(ctx.pos);
      if (!ctx.pos.capabilities().submitOrder || !submit) throw new PermanentJobError('POS adapter cannot accept orders');

      const order = await ctx.db.transaction(async (tx) => {
        const o = await lockOrder(tx, storeId, orderId);
        if (o.posSyncStatus === 'synced' || o.status === 'cancelled') return null;
        return canTransition('pos_sync', o.posSyncStatus, 'in_progress') ? transitionOrder(tx, o, 'pos_sync', 'in_progress', systemActor) : o;
      });
      if (!order) return;

      const lines = await ctx.db
        .select({ skuCode: orderItems.skuCode, quantity: orderItems.quantity, lineTotalPaise: orderItems.lineTotalPaise })
        .from(orderItems)
        .where(and(eq(orderItems.storeId, storeId), eq(orderItems.orderId, orderId)));
      try {
        // The order number is the idempotency key: a retry after a timeout must not create a second POS order.
        const { posOrderRef } = await submit({
          externalOrderNumber: order.orderNumber,
          paymentMode: order.paymentMethod === 'cod' ? 'cod' : 'prepaid',
          lines: lines.map((l) => ({ skuCode: l.skuCode, quantity: l.quantity, unitPricePaise: Math.round(l.lineTotalPaise / l.quantity) })),
        });
        await ctx.db.transaction(async (tx) => {
          const o = await lockOrder(tx, storeId, orderId);
          if (o.posSyncStatus === 'synced') return;
          const synced = await transitionOrder(tx, o, 'pos_sync', 'synced', systemActor, { note: `POS order ${posOrderRef}` });
          await tx.update(orders).set({ posOrderRef }).where(eq(orders.id, synced.id));
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'POS error';
        await ctx.db.transaction(async (tx) => {
          const o = await lockOrder(tx, storeId, orderId);
          if (canTransition('pos_sync', o.posSyncStatus, 'failed')) {
            await transitionOrder(tx, o, 'pos_sync', 'failed', systemActor, { note: message.slice(0, 500) });
          }
        });
        if (err instanceof PosError && !err.retryable) throw new PermanentJobError(message);
        throw err;
      }
    },

    'pos.cancel_order': async (job) => {
      const storeId = requireStoreId(job);
      const cancel = ctx.pos.cancelOrder?.bind(ctx.pos);
      if (!ctx.pos.capabilities().cancelOrder || !cancel) throw new PermanentJobError('POS adapter cannot cancel orders');
      const [order] = await ctx.db.select().from(orders).where(and(eq(orders.storeId, storeId), eq(orders.id, payloadId(job, 'orderId'))));
      if (!order?.posOrderRef) return;
      await cancel(order.posOrderRef);
      await addOrderEvent(ctx.db, order, { machine: 'pos_sync', actor: systemActor, note: 'Cancelled in POS' });
    },

    'pos.sync_stock': async (job) => {
      await syncStoreStock(ctx, requireStoreId(job));
    },

    'payments.process_refund': async (job) => {
      await processRefund(ctx, requireStoreId(job), payloadId(job, 'refundId'));
    },

    'payments.reconcile': async (job) => {
      await reconcilePendingPayments(ctx, requireStoreId(job));
    },
  };
}
