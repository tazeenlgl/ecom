import { and, asc, eq, gt, inArray, lt, ne, or, sql } from 'drizzle-orm';
import type { AppContext } from '../../context.js';
import type { Tx } from '../../db/client.js';
import { orders, paymentEvents, paymentTransactions, refunds, stores } from '../../db/schema.js';
import { type Actor, systemActor } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import { enqueueJob } from '../jobs/queue.js';
import { addOrderEvent, cancelOrder, lockOrder, notifyOrder, type Order, schedulePosSync, transitionOrder } from '../orders/service.js';
import { canTransition } from '../orders/state-machines.js';
import type { PaymentProvider, VerifiedPaymentEvent } from './provider.js';

const webhookActor: Actor = { type: 'webhook', id: null };

export type EventOutcome =
  | 'applied'
  | 'duplicate'
  | 'ignored_stale'
  | 'amount_mismatch'
  | 'unknown_reference'
  | 'paid_after_cancel'
  | 'paid_after_expiry'
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
    if (await paymentWindowClosed(ctx, tx, order)) {
      // The unpaid-order window has passed but the expiry job has not cancelled the order yet.
      // Do not confirm it: cancel it now, which also queues a full refund of the money received.
      await cancelOrder(ctx, tx, order, webhookActor, 'Payment received after the payment window closed');
      return { outcome: 'paid_after_expiry', ...ids };
    }
    order = await transitionOrder(tx, order, 'order', 'confirmed', webhookActor, { isPublic: true });
    await schedulePosSync(ctx, tx, order, webhookActor);
    await notifyOrder(tx, order, 'order.confirmed');
  }
  return { outcome: 'applied', ...ids };
}

/** True when an unpaid order is older than its store's payment window (`unpaidOrderTtlMinutes`, default 30). */
async function paymentWindowClosed(ctx: AppContext, tx: Tx, order: Order): Promise<boolean> {
  const [store] = await tx.select({ config: stores.config }).from(stores).where(eq(stores.id, order.storeId));
  const ttlMinutes = store?.config.unpaidOrderTtlMinutes ?? 30;
  return ctx.now().getTime() > order.placedAt.getTime() + ttlMinutes * 60_000;
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
  await markRefund(ctx, tx, refund, to, webhookActor, event.failureCode, { reference: event.eventId });
  return { outcome: 'applied', ...ids };
}

/**
 * Sets a refund's final state and, on success, the order's refunded amount and payment status.
 * Records how it was settled: `provider` for a provider event, `manual` when a staff member recorded it
 * (with the reference they entered and a note). A later correction replaces the settlement; the earlier one
 * stays in the order timeline and the audit log.
 */
export async function markRefund(
  ctx: AppContext,
  tx: Tx,
  refund: typeof refunds.$inferSelect,
  to: 'succeeded' | 'failed',
  actor: Actor,
  failureCode?: string,
  settlement: { reference?: string; note?: string } = {},
) {
  await tx
    .update(refunds)
    .set({
      status: to,
      failureCode: failureCode ?? null,
      settlementSource: actor.type === 'admin' ? 'manual' : 'provider',
      settledByType: actor.type,
      settledById: actor.id,
      settledAt: ctx.now(),
      settlementReference: settlement.reference ?? null,
      settlementNote: settlement.note ?? null,
    })
    .where(eq(refunds.id, refund.id));
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
  // Money in flight, plus money from an accepted refund that failed very recently. The second is held for a
  // day: if a person marked it failed by mistake, the same money must not be refunded again before that can
  // be corrected (mark-succeeded). A refund that failed without the provider ever accepting it is not held.
  const holdCutoff = new Date(ctx.now().getTime() - FAILED_REFUND_HOLD_MS).toISOString();
  const [reserved] = await tx
    .select({
      inFlight: sql<number>`coalesce(sum(${refunds.amountPaise}) filter (where ${refunds.status} in ('pending', 'processing')), 0)::int`,
      held: sql<number>`coalesce(sum(${refunds.amountPaise}) filter (where ${refunds.status} = 'failed' and ${refunds.providerRef} is not null and coalesce(${refunds.settledAt}, ${refunds.updatedAt}) > ${holdCutoff}::timestamptz), 0)::int`,
    })
    .from(refunds)
    .where(eq(refunds.orderId, order.id));
  const held = reserved?.held ?? 0;
  const refundable = order.totalPaise - order.refundedPaise - (reserved?.inFlight ?? 0) - held;
  if (input.amountPaise <= 0 || input.amountPaise > refundable) {
    const why = held > 0 ? ` ${held} paise from a refund that failed in the last 24 hours is still held, in case it was marked failed by mistake.` : '';
    throw new AppError(422, 'invalid_request', `The refundable amount is ${refundable} paise.${why}`, { refundablePaise: refundable, heldPaise: held });
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

/**
 * The provider that takes online payments for a store: a gateway the store has
 * configured and enabled (Paytm), otherwise the deployment-wide PAYMENT_PROVIDER.
 */
export async function providerForStore(ctx: AppContext, storeId: string): Promise<PaymentProvider | undefined> {
  for (const provider of ctx.payments.values()) {
    if (provider.isEnabledFor && (await provider.isEnabledFor(storeId))) return provider;
  }
  const fallback = ctx.payments.get(ctx.config.PAYMENT_PROVIDER);
  return fallback && !fallback.isEnabledFor ? fallback : undefined;
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
    const { refundRef } = await provider.createRefund({ storeId, refundId: row.refund.id, paymentRef: row.txn.providerRef, amountPaise: row.refund.amountPaise });
    await tx.update(refunds).set({ status: 'processing', providerRef: refundRef }).where(eq(refunds.id, row.refund.id));
  });
}

/** Pending payments are checked with the provider only after this long. */
const RECONCILE_AFTER_MS = 15 * 60_000;
/** How long the amount of a recently failed, provider-accepted refund stays unavailable for a new refund. */
const FAILED_REFUND_HOLD_MS = 24 * 60 * 60_000;
/** How long after its creation an abandoned attempt is still checked with the provider. */
const ABANDONED_RECHECK_MS = 48 * 60 * 60_000;

/**
 * Job: ask providers about payments still pending after 15 minutes, so a lost
 * webhook does not leave an order stuck. Results go through the same event path.
 *
 * - Oldest-checked first (`updated_at`, then id), and every row that stays
 *   pending is touched, so a payment the provider keeps failing on cannot
 *   starve the others in a later run.
 * - One provider failure is recorded and skipped; the rest of the batch still
 *   runs. The job throws at the end when anything failed, so it is retried and,
 *   if it keeps failing, shows up as a failed job. Every step is idempotent.
 * - A payment still unconfirmed after its order was cancelled is closed as
 *   `cancelled` (abandoned). It is still checked for 48 hours after creation:
 *   a success then goes through the normal late-payment path (recorded and
 *   refunded in full), so a lost webhook cannot leave the customer charged
 *   with no refund.
 */
export async function reconcilePendingPayments(ctx: AppContext, storeId: string) {
  const stale = await ctx.db
    .select()
    .from(paymentTransactions)
    .where(
      and(
        eq(paymentTransactions.storeId, storeId),
        lt(paymentTransactions.createdAt, new Date(ctx.now().getTime() - RECONCILE_AFTER_MS)),
        or(
          eq(paymentTransactions.status, 'pending'),
          // An abandoned attempt can still be paid at the provider (a customer finishing at the bank
          // after the order expired). Keep asking for a bounded time, so a lost webhook cannot hide it.
          and(
            eq(paymentTransactions.status, 'cancelled'),
            eq(paymentTransactions.failureCode, 'abandoned'),
            gt(paymentTransactions.createdAt, new Date(ctx.now().getTime() - ABANDONED_RECHECK_MS)),
          ),
        ),
      ),
    )
    .orderBy(asc(paymentTransactions.updatedAt), asc(paymentTransactions.id))
    .limit(100);
  let applied = 0;
  let abandoned = 0;
  const failures: { transactionId: string; message: string }[] = [];
  for (const txn of stale) {
    try {
      const provider = ctx.payments.get(txn.provider);
      if (!provider || !txn.providerRef) continue;
      const status = await provider.fetchPaymentStatus(txn.providerRef, storeId);
      if (status.status === 'pending') {
        if (await abandonIfOrderCancelled(ctx, txn.id)) abandoned += 1;
        continue;
      }
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
    } catch (err) {
      failures.push({ transactionId: txn.id, message: err instanceof Error ? err.message : 'unknown error' });
    } finally {
      // Rotate the row to the back of the queue whatever happened (a no-op once it is resolved). The database's own
      // clock, to the microsecond, like `created_at`: a millisecond value from this process let two rows touched in
      // the same millisecond tie, and the random id then decided their order.
      await ctx.db.update(paymentTransactions).set({ updatedAt: sql`clock_timestamp()` }).where(eq(paymentTransactions.id, txn.id)).catch(() => undefined);
    }
  }
  if (failures.length > 0) {
    const sample = failures.slice(0, 3).map((f) => `${f.transactionId}: ${f.message}`).join('; ');
    throw new Error(`Reconciliation checked ${stale.length}, applied ${applied}, abandoned ${abandoned}, failed ${failures.length} (${sample})`);
  }
  return { checked: stale.length, applied, abandoned, failed: 0 };
}

/**
 * Closes a still-pending transaction whose order has been cancelled (for
 * example the unpaid order expired) and which the provider does not report as
 * paid. The conditional update loses to a concurrent webhook, so a payment that
 * lands meanwhile is never overwritten. A success that arrives later is still
 * recorded and refunded by `applyPaymentEvent`.
 */
async function abandonIfOrderCancelled(ctx: AppContext, transactionId: string): Promise<boolean> {
  return ctx.db.transaction(async (tx) => {
    const [txn] = await tx.select().from(paymentTransactions).where(eq(paymentTransactions.id, transactionId)).for('update');
    if (!txn || txn.status !== 'pending') return false;
    const order = await lockOrder(tx, txn.storeId, txn.orderId);
    if (order.status !== 'cancelled') return false;
    await tx.update(paymentTransactions).set({ status: 'cancelled', failureCode: 'abandoned' }).where(eq(paymentTransactions.id, txn.id));
    await addOrderEvent(tx, order, { machine: 'payment', actor: systemActor, note: 'Payment attempt closed: the order was cancelled before the provider confirmed any payment.' });
    return true;
  });
}
