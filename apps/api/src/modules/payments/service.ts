import { and, eq, inArray, lt, ne, sql } from 'drizzle-orm';
import type { AppContext } from '../../context.js';
import type { Tx } from '../../db/client.js';
import { orders, paymentEvents, paymentTransactions, refunds } from '../../db/schema.js';
import type { Actor } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import { enqueueJob } from '../jobs/queue.js';
import { addOrderEvent, lockOrder, notifyOrder, type Order, schedulePosSync, transitionOrder } from '../orders/service.js';
import { canTransition } from '../orders/state-machines.js';
import type { VerifiedPaymentEvent } from './provider.js';

const webhookActor: Actor = { type: 'webhook', id: null };

export type EventOutcome =
  | 'applied'
  | 'duplicate'
  | 'ignored_stale'
  | 'amount_mismatch'
  | 'unknown_reference'
  | 'paid_after_cancel'
  | 'duplicate_payment';

/**
 * Records a verified provider event and applies it, in one transaction. The
 * unique (provider, provider_event_id) key makes redelivery a no-op; if
 * applying fails the event row rolls back too, so the provider's retry is
 * processed rather than dropped.
 */
export async function ingestPaymentEvent(ctx: AppContext, provider: string, event: VerifiedPaymentEvent, signatureVerified = true): Promise<EventOutcome> {
  return ctx.db.transaction(async (tx) => {
    const [stored] = await tx
      .insert(paymentEvents)
      .values({
        provider,
        providerEventId: event.eventId,
        eventType: event.type,
        providerRef: event.providerRef,
        payload: event.payload,
        signatureVerified,
        occurredAt: event.occurredAt,
      })
      .onConflictDoNothing()
      .returning({ id: paymentEvents.id });
    if (!stored) return 'duplicate';

    const result = event.type.startsWith('payment.')
      ? await applyPaymentEvent(ctx, tx, provider, event)
      : await applyRefundEvent(ctx, tx, provider, event);

    await tx
      .update(paymentEvents)
      .set({ processedAt: ctx.now(), outcome: result.outcome, storeId: result.storeId ?? null, transactionId: result.transactionId ?? null })
      .where(eq(paymentEvents.id, stored.id));
    return result.outcome;
  });
}

type ApplyResult = { outcome: EventOutcome; storeId?: string; transactionId?: string };

async function applyPaymentEvent(ctx: AppContext, tx: Tx, provider: string, event: VerifiedPaymentEvent): Promise<ApplyResult> {
  const [txn] = await tx
    .select()
    .from(paymentTransactions)
    .where(and(eq(paymentTransactions.provider, provider), eq(paymentTransactions.providerRef, event.providerRef)))
    .for('update');
  if (!txn) return { outcome: 'unknown_reference' };
  const ids = { storeId: txn.storeId, transactionId: txn.id };
  let order = await lockOrder(tx, txn.storeId, txn.orderId);

  if (event.type === 'payment.failed') {
    // A failure arriving after success (out of order) changes nothing.
    if (!canTransition('transaction', txn.status, 'failed')) return { outcome: 'ignored_stale', ...ids };
    await tx.update(paymentTransactions).set({ status: 'failed', failureCode: event.failureCode ?? null }).where(eq(paymentTransactions.id, txn.id));
    if (canTransition('payment', order.paymentStatus, 'failed')) {
      await transitionOrder(tx, order, 'payment', 'failed', webhookActor, { note: event.failureCode ?? 'Payment failed', isPublic: true });
    }
    return { outcome: 'applied', ...ids };
  }

  // payment.succeeded
  if (txn.status === 'succeeded') return { outcome: 'ignored_stale', ...ids };
  if (event.amountPaise === null || event.amountPaise !== txn.amountPaise) {
    await addOrderEvent(tx, order, { machine: 'payment', actor: webhookActor, note: `Provider reported ${event.amountPaise ?? 'no'} paise for a ${txn.amountPaise} paise payment; not applied.` });
    return { outcome: 'amount_mismatch', ...ids };
  }
  const [otherSuccess] = await tx
    .select({ id: paymentTransactions.id })
    .from(paymentTransactions)
    .where(and(eq(paymentTransactions.orderId, order.id), eq(paymentTransactions.status, 'succeeded'), ne(paymentTransactions.id, txn.id)));
  if (otherSuccess) {
    await tx.update(paymentTransactions).set({ failureCode: 'duplicate_payment' }).where(eq(paymentTransactions.id, txn.id));
    await addOrderEvent(tx, order, { machine: 'payment', actor: webhookActor, note: 'A second successful payment was received for this order. Refund it from the provider dashboard.' });
    return { outcome: 'duplicate_payment', ...ids };
  }

  await tx.update(paymentTransactions).set({ status: 'succeeded', failureCode: null }).where(eq(paymentTransactions.id, txn.id));
  order = await transitionOrder(tx, order, 'payment', 'paid', webhookActor, { isPublic: true });

  if (order.status === 'cancelled') {
    // Money arrived after the unpaid order expired: refund it in full.
    await createRefund(ctx, tx, order, { amountPaise: txn.amountPaise, reason: 'Payment received after the order was cancelled', idempotencyKey: `late:${txn.id}`, actor: webhookActor });
    return { outcome: 'paid_after_cancel', ...ids };
  }
  if (order.status === 'pending_payment') {
    order = await transitionOrder(tx, order, 'order', 'confirmed', webhookActor, { isPublic: true });
    await schedulePosSync(ctx, tx, order, webhookActor);
    await notifyOrder(tx, order, 'order.confirmed');
  }
  return { outcome: 'applied', ...ids };
}

async function applyRefundEvent(ctx: AppContext, tx: Tx, provider: string, event: VerifiedPaymentEvent): Promise<ApplyResult> {
  const [row] = await tx
    .select({ refund: refunds })
    .from(refunds)
    .innerJoin(paymentTransactions, eq(paymentTransactions.id, refunds.paymentTransactionId))
    .where(and(eq(paymentTransactions.provider, provider), eq(refunds.providerRef, event.providerRef)))
    .for('update');
  if (!row) return { outcome: 'unknown_reference' };
  const refund = row.refund;
  const ids = { storeId: refund.storeId, transactionId: refund.paymentTransactionId ?? undefined };
  const to = event.type === 'refund.succeeded' ? 'succeeded' : 'failed';
  if (!canTransition('refund', refund.status, to)) return { outcome: 'ignored_stale', ...ids };
  await markRefund(ctx, tx, refund, to, webhookActor, event.failureCode);
  return { outcome: 'applied', ...ids };
}

/** Sets a refund's final state and, on success, the order's refunded amount and payment status. */
export async function markRefund(
  ctx: AppContext,
  tx: Tx,
  refund: typeof refunds.$inferSelect,
  to: 'succeeded' | 'failed',
  actor: Actor,
  failureCode?: string,
) {
  await tx.update(refunds).set({ status: to, failureCode: failureCode ?? null }).where(eq(refunds.id, refund.id));
  const order = await lockOrder(tx, refund.storeId, refund.orderId);
  if (to === 'failed') {
    await addOrderEvent(tx, order, { machine: 'refund', from: refund.status, to, actor, note: failureCode ?? 'Refund failed' });
    return;
  }
  const refundedPaise = order.refundedPaise + refund.amountPaise;
  const [updated] = await tx.update(orders).set({ refundedPaise }).where(eq(orders.id, order.id)).returning();
  await addOrderEvent(tx, order, { machine: 'refund', from: refund.status, to, actor, note: `Refunded ${refund.amountPaise} paise`, isPublic: true });
  const paymentTo = refundedPaise >= order.totalPaise ? 'refunded' : 'partially_refunded';
  if (canTransition('payment', updated!.paymentStatus, paymentTo)) {
    await transitionOrder(tx, updated!, 'payment', paymentTo, actor);
  }
  await notifyOrder(tx, order, 'refund.succeeded', refund.id);
}

/**
 * Creates a refund record (idempotent per store + key) after checking the amount
 * does not exceed what was collected minus refunds already made or in flight.
 * Online refunds are sent to the provider by the `payments.process_refund` job.
 */
export async function createRefund(
  ctx: AppContext,
  tx: Tx,
  order: Order,
  input: { amountPaise: number; reason: string; idempotencyKey: string; actor: Actor; returnRequestId?: string },
) {
  const [existing] = await tx
    .select()
    .from(refunds)
    .where(and(eq(refunds.storeId, order.storeId), eq(refunds.idempotencyKey, input.idempotencyKey)));
  if (existing) return existing;

  if (!['paid', 'partially_refunded', 'cod_collected'].includes(order.paymentStatus)) {
    throw new AppError(409, 'invalid_transition', 'Only collected payments can be refunded.');
  }
  const [inFlight] = await tx
    .select({ total: sql<number>`coalesce(sum(${refunds.amountPaise}), 0)::int` })
    .from(refunds)
    .where(and(eq(refunds.orderId, order.id), inArray(refunds.status, ['pending', 'processing'])));
  const refundable = order.totalPaise - order.refundedPaise - (inFlight?.total ?? 0);
  if (input.amountPaise <= 0 || input.amountPaise > refundable) {
    throw new AppError(422, 'invalid_request', `The refundable amount is ${refundable} paise.`, { refundablePaise: refundable });
  }
  const [txn] = await tx
    .select()
    .from(paymentTransactions)
    .where(and(eq(paymentTransactions.orderId, order.id), eq(paymentTransactions.status, 'succeeded')));
  const online = txn && txn.provider !== 'cod';
  const [refund] = await tx
    .insert(refunds)
    .values({
      storeId: order.storeId,
      orderId: order.id,
      paymentTransactionId: txn?.id ?? null,
      returnRequestId: input.returnRequestId ?? null,
      amountPaise: input.amountPaise,
      reason: input.reason,
      idempotencyKey: input.idempotencyKey,
    })
    .returning();
  await addOrderEvent(tx, order, { machine: 'refund', to: 'pending', actor: input.actor, note: `${input.amountPaise} paise: ${input.reason}` });
  if (online) {
    await enqueueJob(tx, { type: 'payments.process_refund', storeId: order.storeId, payload: { refundId: refund!.id }, idempotencyKey: `refund:${refund!.id}` });
  }
  return refund!;
}

/** Job: send a pending online refund to its provider. */
export async function processRefund(ctx: AppContext, storeId: string, refundId: string) {
  await ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .select({ refund: refunds, txn: paymentTransactions })
      .from(refunds)
      .innerJoin(paymentTransactions, eq(paymentTransactions.id, refunds.paymentTransactionId))
      .where(and(eq(refunds.storeId, storeId), eq(refunds.id, refundId)))
      .for('update', { of: refunds });
    if (!row || !['pending', 'failed'].includes(row.refund.status)) return;
    const provider = ctx.payments.get(row.txn.provider);
    if (!provider || !row.txn.providerRef) throw new Error(`Payment provider ${row.txn.provider} is not configured`);
    const { refundRef } = await provider.createRefund({ refundId: row.refund.id, paymentRef: row.txn.providerRef, amountPaise: row.refund.amountPaise });
    await tx.update(refunds).set({ status: 'processing', providerRef: refundRef }).where(eq(refunds.id, row.refund.id));
  });
}

/**
 * Job: ask providers about payments still pending after 15 minutes, so a lost
 * webhook does not leave an order stuck. Results go through the same event path.
 */
export async function reconcilePendingPayments(ctx: AppContext, storeId: string) {
  const stale = await ctx.db
    .select()
    .from(paymentTransactions)
    .where(
      and(
        eq(paymentTransactions.storeId, storeId),
        eq(paymentTransactions.status, 'pending'),
        lt(paymentTransactions.createdAt, new Date(ctx.now().getTime() - 15 * 60_000)),
      ),
    )
    .limit(100);
  let applied = 0;
  for (const txn of stale) {
    const provider = ctx.payments.get(txn.provider);
    if (!provider || !txn.providerRef) continue;
    const status = await provider.fetchPaymentStatus(txn.providerRef);
    if (status.status === 'pending') continue;
    const outcome = await ingestPaymentEvent(
      ctx,
      txn.provider,
      {
        eventId: `reconcile:${txn.id}:${status.status}`,
        type: status.status === 'succeeded' ? 'payment.succeeded' : 'payment.failed',
        providerRef: txn.providerRef,
        amountPaise: status.amountPaise,
        occurredAt: null,
        payload: { source: 'reconciliation', status: status.status },
      },
      false,
    );
    if (outcome === 'applied') applied += 1;
  }
  return { checked: stale.length, applied };
}
