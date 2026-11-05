import { and, asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLogs, jobs, orders, paymentTransactions, refunds } from '../src/db/schema.js';
import { jobHandlers } from '../src/modules/jobs/handlers.js';
import { runDueJobs } from '../src/modules/jobs/queue.js';
import { reconcilePendingPayments } from '../src/modules/payments/service.js';
import { adminToken, bearer, customerToken, seedStore, setupTestApp, type TestContext } from './helpers.js';
import { InMemoryPosGateway } from './support/in-memory-pos.js';

let ctx: TestContext;
let alpha: Awaited<ReturnType<typeof seedStore>>;
let adminTok: string;
let variantId: string;
let pos: InMemoryPosGateway;

const S = () => `/v1/admin/stores/${alpha.store.id}`;
const admin = (method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown, headers: Record<string, string> = {}) =>
  ctx.app.inject({ method, url, headers: { ...bearer(adminTok), ...headers }, ...(payload ? { payload: payload as object } : {}) });
const shop = (method: 'GET' | 'POST', url: string, headers: Record<string, string>, payload?: unknown) =>
  ctx.app.inject({ method, url: `/v1/storefront${url}`, headers: { host: alpha.host, ...headers }, ...(payload ? { payload: payload as object } : {}) });
// +5s tolerates a database clock a little ahead of this machine (a job's run_at comes from the database clock).
const runJobs = () => runDueJobs(ctx.db, jobHandlers(ctx.app.ctx), 'test-worker', 50, new Date(Date.now() + ctx.clock.offsetMs + 5_000));

/** Sends a webhook signed like the fake provider would. */
function webhook(body: object) {
  const raw = JSON.stringify(body);
  return ctx.app.inject({
    method: 'POST',
    url: '/v1/webhooks/payments/fake',
    headers: { 'content-type': 'application/json', 'x-fake-signature': ctx.payment.sign(raw) },
    payload: raw,
  });
}

let phoneSeq = 0;
const tokens = new Map<number, string>();
/** Places an online order and starts its payment; returns order and provider reference. */
async function placeOnlineOrder() {
  phoneSeq += 1;
  const group = Math.floor((phoneSeq - 1) / 4);
  if (!tokens.has(group)) tokens.set(group, await customerToken(ctx, alpha.host, `96000000${String(group).padStart(2, '0')}`));
  const token = tokens.get(group)!;
  const address = await shop('POST', '/me/addresses', bearer(token), { name: 'Buyer', phone: '9600000000', line1: '1 Road', city: 'Chennai', state: 'Tamil Nadu', pincode: '600001' });
  await shop('POST', '/cart/items', bearer(token), { variantId, quantity: 1 });
  const body = { addressId: address.json().address.id, paymentMethod: 'online' };
  const quote = (await shop('POST', '/checkout/quote', bearer(token), body)).json().quote;
  const placed = await shop('POST', '/checkout/orders', { ...bearer(token), 'idempotency-key': `safety-${phoneSeq}-xyz` }, { ...body, expectedTotalPaise: quote.totalPaise });
  expect(placed.statusCode).toBe(201);
  const order = placed.json().order;
  // Payment starts are limited per client address (20 per 15 minutes); spread the test orders over addresses.
  const pay = await ctx.app.inject({ method: 'POST', url: `/v1/storefront/orders/${order.orderNumber}/payments`, headers: { host: alpha.host, ...bearer(token) }, remoteAddress: `10.20.${Math.floor(phoneSeq / 10)}.1` });
  expect(pay.statusCode).toBe(201);
  return { order, providerRef: pay.json().payment.client.providerRef as string, amount: pay.json().payment.amountPaise as number };
}

const orderRow = async (id: string) => (await ctx.db.select().from(orders).where(eq(orders.id, id)))[0]!;
const txnOf = async (providerRef: string) => (await ctx.db.select().from(paymentTransactions).where(eq(paymentTransactions.providerRef, providerRef)))[0]!;
const refundsOf = (orderId: string) => ctx.db.select().from(refunds).where(eq(refunds.orderId, orderId));

/** Wraps the fake provider's status check to record the order of calls and fail chosen references. */
function watchStatusChecks(failRefs: Set<string> = new Set()) {
  const original = ctx.payment.fetchPaymentStatus.bind(ctx.payment);
  const called: string[] = [];
  ctx.payment.fetchPaymentStatus = async (ref: string) => {
    called.push(ref);
    if (failRefs.has(ref)) throw new Error('provider unavailable');
    return original(ref);
  };
  return {
    called,
    restore: () => {
      ctx.payment.fetchPaymentStatus = original;
    },
  };
}

beforeAll(async () => {
  pos = new InMemoryPosGateway();
  ctx = await setupTestApp({ pos });
  alpha = await seedStore(ctx.db, 'alpha');
  adminTok = (await adminToken(ctx, 'owner@example.com', [{ role: 'platform_owner', storeId: null }])).token;
  const product = (await admin('POST', `${S()}/products`, { slug: 'saree', title: 'Saree' })).json().product;
  variantId = (await admin('POST', `${S()}/products/${product.id}/variants`, { skuCode: 'SAR-1', title: 'One size' })).json().variant.id;
  await admin('PUT', `${S()}/variants/${variantId}/price`, { mrpPaise: 500_000, pricePaise: 450_000 });
  await admin('POST', `${S()}/products/${product.id}/status`, { status: 'published' });
  await admin('POST', `${S()}/shipping-zones`, { name: 'TN', pincodePrefixes: ['600'], chargePaise: 0, codAvailable: false });
  pos.stock.set('SAR-1', 100);
  await admin('POST', `${S()}/pos/stock-sync`);
  await runJobs();
});
afterAll(async () => ctx?.close());

describe('manual settlement of online refunds', () => {
  async function paidOrderWithRefund(key: string, sendToProvider: boolean, refundAmount = 100_000) {
    const { order, providerRef, amount } = await placeOnlineOrder();
    await webhook({ id: `evt_paid_${key}`, type: 'payment.succeeded', data: { providerRef, amountPaise: amount } });
    const created = await admin('POST', `${S()}/orders/${order.id}/refunds`, { amountPaise: refundAmount === 0 ? amount : refundAmount, reason: 'damaged' }, { 'idempotency-key': key });
    expect(created.statusCode).toBe(201);
    if (sendToProvider) await runJobs();
    const refundId = created.json().refund.id as string;
    const refundRow = async () => (await ctx.db.select().from(refunds).where(eq(refunds.id, refundId)))[0]!;
    return { order, amount, refundId, refundRow };
  }
  const settle = (refundId: string, action: 'mark-succeeded' | 'mark-failed', payload: object, token = adminTok) =>
    ctx.app.inject({ method: 'POST', url: `${S()}/refunds/${refundId}/${action}`, headers: bearer(token), payload: payload as object });
  const ageRefund = (refundId: string, ms: number) => ctx.db.update(refunds).set({ updatedAt: new Date(Date.now() - ms), settledAt: new Date(Date.now() - ms) }).where(eq(refunds.id, refundId));
  const refundAudit = async (refundId: string, action: string) =>
    ctx.db.select().from(auditLogs).where(and(eq(auditLogs.entityId, refundId), eq(auditLogs.action, action)));

  it('confirms a refund the provider accepted only when its provider refund id is entered back', async () => {
    const { order, refundId, refundRow } = await paidOrderWithRefund('settle-ok', true);
    const before = await refundRow();
    expect(before.status).toBe('processing');
    expect(before.providerRef).toBeTruthy();

    const wrong = await settle(refundId, 'mark-succeeded', { reference: 'some-other-refund' });
    expect(wrong.statusCode).toBe(422);
    expect(wrong.json().error.details).toMatchObject({ field: 'reference' });
    expect((await refundRow()).status).toBe('processing');

    const res = await settle(refundId, 'mark-succeeded', { reference: ` ${before.providerRef!.toUpperCase()} ` });
    expect(res.statusCode).toBe(200);
    expect(await refundRow()).toMatchObject({
      status: 'succeeded',
      providerRef: before.providerRef,
      settlementSource: 'manual',
      settledByType: 'admin',
      settlementReference: before.providerRef!.toUpperCase(),
    });
    expect((await refundRow()).settledById).toBeTruthy();
    expect((await refundRow()).settledAt).toBeInstanceOf(Date);
    expect(await orderRow(order.id)).toMatchObject({ paymentStatus: 'partially_refunded', refundedPaise: 100_000 });
    expect((await settle(refundId, 'mark-succeeded', { reference: before.providerRef })).statusCode).toBe(409);
    expect(await orderRow(order.id)).toMatchObject({ refundedPaise: 100_000 });

    const [audit] = await refundAudit(refundId, 'refund.manual_success');
    expect(audit).toMatchObject({ actorType: 'admin', entityType: 'refund' });
    expect(audit!.actorId).toBeTruthy();
    expect(audit!.changes).toMatchObject({ reference: expect.any(String), online: true, fromStatus: 'processing', providerRef: before.providerRef, amountPaise: 100_000 });
  });

  it('refuses to settle an online refund that has not been sent yet', async () => {
    const { refundId, refundRow } = await paidOrderWithRefund('settle-pending', false);
    expect((await settle(refundId, 'mark-succeeded', { reference: 'x' })).statusCode).toBe(409);
    expect((await settle(refundId, 'mark-failed', { reference: 'x', reason: 'not sent but marked' })).statusCode).toBe(409);
    expect((await refundRow()).status).toBe('pending');
  });

  it('requires the provider refund id and a real reason to mark a refund failed', async () => {
    const { refundId, refundRow } = await paidOrderWithRefund('settle-fail-input', true);
    const { providerRef } = await refundRow();
    expect((await settle(refundId, 'mark-failed', { reference: 'wrong-id', reason: 'Rejected by the bank' })).statusCode).toBe(422);
    expect((await settle(refundId, 'mark-failed', { reference: providerRef, reason: 'short' })).statusCode).toBeGreaterThanOrEqual(400);
    expect((await refundRow()).status).toBe('processing');
  });

  it('holds the amount of a failed refund for 24 hours, and a mistaken failure can be corrected', async () => {
    const { order, amount, refundId, refundRow } = await paidOrderWithRefund('settle-fail', true);
    const { providerRef } = await refundRow();
    expect((await admin('POST', `${S()}/orders/${order.id}/refunds`, { amountPaise: amount, reason: 'full' }, { 'idempotency-key': 'settle-fail-full-1' })).statusCode).toBe(422);

    const failed = await settle(refundId, 'mark-failed', { reference: providerRef, reason: 'Rejected by the bank' });
    expect(failed.statusCode).toBe(200);
    expect(await refundRow()).toMatchObject({
      status: 'failed',
      failureCode: 'manual_failure',
      settlementSource: 'manual',
      settledByType: 'admin',
      settlementReference: providerRef,
      settlementNote: 'Rejected by the bank',
    });
    const failedRow = await refundRow();
    expect(failedRow.settledById).toBeTruthy();
    expect(failedRow.settledAt).toBeInstanceOf(Date);
    expect(await orderRow(order.id)).toMatchObject({ refundedPaise: 0 });
    const [failAudit] = await refundAudit(refundId, 'refund.manual_failure');
    expect(failAudit).toMatchObject({ actorType: 'admin' });
    expect(failAudit!.changes).toMatchObject({ reason: 'Rejected by the bank', fromStatus: 'processing', providerRef });

    // The same money cannot be refunded again straight away, but the rest of the order can be.
    const again = await admin('POST', `${S()}/orders/${order.id}/refunds`, { amountPaise: amount, reason: 'full' }, { 'idempotency-key': 'settle-fail-full-2' });
    expect(again.statusCode).toBe(422);
    expect(again.json().error.details).toMatchObject({ heldPaise: 100_000, refundablePaise: amount - 100_000 });
    expect((await admin('POST', `${S()}/orders/${order.id}/refunds`, { amountPaise: amount - 100_000, reason: 'rest' }, { 'idempotency-key': 'settle-fail-rest' })).statusCode).toBe(201);

    // Paytm shows it was refunded after all: correct it.
    expect((await settle(refundId, 'mark-succeeded', { reference: 'wrong' })).statusCode).toBe(422);
    const fixed = await settle(refundId, 'mark-succeeded', { reference: providerRef });
    expect(fixed.statusCode).toBe(200);
    expect(await refundRow()).toMatchObject({ status: 'succeeded', failureCode: null, settlementSource: 'manual', settledByType: 'admin', settlementReference: providerRef });
    expect((await refundRow()).settlementNote).toMatch(/Corrected from failed/);
    expect(await orderRow(order.id)).toMatchObject({ refundedPaise: 100_000 });
    const [fixAudit] = await refundAudit(refundId, 'refund.manual_correction');
    expect(fixAudit!.changes).toMatchObject({ fromStatus: 'failed', providerRef });
    // The earlier failure stays in the history.
    expect(await refundAudit(refundId, 'refund.manual_failure')).toHaveLength(1);
  });

  it('frees a failed refund amount after 24 hours', async () => {
    const { order, amount, refundId, refundRow } = await paidOrderWithRefund('settle-hold-expiry', true);
    expect((await settle(refundId, 'mark-failed', { reference: (await refundRow()).providerRef, reason: 'Rejected by the bank' })).statusCode).toBe(200);
    await ageRefund(refundId, 25 * 60 * 60_000);
    const again = await admin('POST', `${S()}/orders/${order.id}/refunds`, { amountPaise: amount, reason: 'full' }, { 'idempotency-key': 'settle-hold-expiry-2' });
    expect(again.statusCode).toBe(201);
  });

  it('never lets a correction take the refunded amount above the order total', async () => {
    const { order, amount, refundId, refundRow } = await paidOrderWithRefund('settle-over', true, 0);
    const { providerRef } = await refundRow();
    expect((await settle(refundId, 'mark-failed', { reference: providerRef, reason: 'Rejected by the bank' })).statusCode).toBe(200);
    await ageRefund(refundId, 25 * 60 * 60_000);
    // After the hold, the full amount is refunded again...
    const second = await admin('POST', `${S()}/orders/${order.id}/refunds`, { amountPaise: amount, reason: 'retry' }, { 'idempotency-key': 'settle-over-2' });
    expect(second.statusCode).toBe(201);
    await runJobs();
    // ...so confirming the first one as well would refund the order twice.
    const res = await settle(refundId, 'mark-succeeded', { reference: providerRef });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.details).toMatchObject({ orderTotalPaise: amount });
    expect((await refundRow()).status).toBe('failed');
    expect(await orderRow(order.id)).toMatchObject({ refundedPaise: 0 });
  });

  it('sends at most one refund notification per refund, including after a correction', async () => {
    const { order, refundId, refundRow } = await paidOrderWithRefund('settle-notify', true);
    const { providerRef } = await refundRow();
    const key = `notify:refund.succeeded:${order.id}:${refundId}`;
    const count = async () => (await ctx.db.select().from(jobs).where(eq(jobs.idempotencyKey, key))).length;
    await settle(refundId, 'mark-failed', { reference: providerRef, reason: 'Rejected by the bank' });
    expect(await count()).toBe(0); // a failure tells the customer nothing
    await settle(refundId, 'mark-succeeded', { reference: providerRef });
    expect(await count()).toBe(1);
    await settle(refundId, 'mark-succeeded', { reference: providerRef });
    expect(await count()).toBe(1);
  });

  it('stays correct when two staff settle the same refund at once', async () => {
    const both = await paidOrderWithRefund('settle-race-1', true);
    const { providerRef } = await both.refundRow();
    const [a, b] = await Promise.all([
      settle(both.refundId, 'mark-succeeded', { reference: providerRef }),
      settle(both.refundId, 'mark-succeeded', { reference: providerRef }),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
    expect(await orderRow(both.order.id)).toMatchObject({ refundedPaise: 100_000 });

    const mixed = await paidOrderWithRefund('settle-race-2', true);
    const ref2 = (await mixed.refundRow()).providerRef;
    const results = await Promise.all([
      settle(mixed.refundId, 'mark-failed', { reference: ref2, reason: 'Rejected by the bank' }),
      settle(mixed.refundId, 'mark-succeeded', { reference: ref2 }),
    ]);
    expect(results.map((r) => r.statusCode).every((c) => [200, 409].includes(c))).toBe(true);
    // Whatever the order, the money is recorded once and the refund ends paid.
    expect(await mixed.refundRow()).toMatchObject({ status: 'succeeded' });
    expect(await orderRow(mixed.order.id)).toMatchObject({ refundedPaise: 100_000 });
  });

  it('records provider-confirmed settlements as provider, with the event id', async () => {
    const { order, refundId, refundRow } = await paidOrderWithRefund('settle-provider', true);
    const { providerRef } = await refundRow();
    const res = await webhook({ id: 'evt_settle_provider_1', type: 'refund.succeeded', data: { providerRef: providerRef! } });
    expect(res.json().outcome).toBe('applied');
    expect(await refundRow()).toMatchObject({ status: 'succeeded', settlementSource: 'provider', settledByType: 'webhook', settledById: null, settlementReference: 'evt_settle_provider_1', settlementNote: null });
    expect((await refundRow()).settledAt).toBeInstanceOf(Date);
    expect(await orderRow(order.id)).toMatchObject({ refundedPaise: 100_000 });
  });

  it('holds a failed refund by its settlement time, and by updated_at for refunds settled before the columns existed', async () => {
    const { order, amount, refundId, refundRow } = await paidOrderWithRefund('settle-legacy-hold', true);
    expect((await settle(refundId, 'mark-failed', { reference: (await refundRow()).providerRef, reason: 'Rejected by the bank' })).statusCode).toBe(200);
    const full = (key: string) => admin('POST', `${S()}/orders/${order.id}/refunds`, { amountPaise: amount, reason: 'full' }, { 'idempotency-key': key });

    // Legacy row: no settlement time, failed just now -> still held.
    await ctx.db.update(refunds).set({ settledAt: null }).where(eq(refunds.id, refundId));
    expect((await full('settle-legacy-hold-1')).statusCode).toBe(422);
    // The settlement time wins over a recent updated_at.
    await ctx.db.update(refunds).set({ settledAt: new Date(Date.now() - 25 * 60 * 60_000) }).where(eq(refunds.id, refundId));
    expect((await full('settle-legacy-hold-2')).statusCode).toBe(201);
  });

  it('needs the refunds permission and stays inside the store', async () => {
    const { refundId, refundRow } = await paidOrderWithRefund('settle-perm', true);
    const { providerRef } = await refundRow();
    const support = (await adminToken(ctx, 'support@example.com', [{ role: 'support', storeId: alpha.store.id }])).token;
    expect((await settle(refundId, 'mark-succeeded', { reference: providerRef }, support)).statusCode).toBe(403);
    expect((await settle(refundId, 'mark-failed', { reference: providerRef, reason: 'Rejected by the bank' }, support)).statusCode).toBe(403);
    const other = await seedStore(ctx.db, 'beta-refunds');
    const crossStore = await admin('POST', `/v1/admin/stores/${other.store.id}/refunds/${refundId}/mark-succeeded`, { reference: providerRef });
    expect(crossStore.statusCode).toBe(404);
  });
});

describe('payment reconciliation', () => {
  it('checks the least recently checked payments first, in a stable order', async () => {
    for (let i = 0; i < 3; i += 1) await placeOnlineOrder();
    const snapshot = async () =>
      (await ctx.db.select().from(paymentTransactions).where(eq(paymentTransactions.status, 'pending')).orderBy(asc(paymentTransactions.updatedAt), asc(paymentTransactions.id)))
        .filter((t) => t.provider === 'fake')
        .map((t) => t.providerRef);
    ctx.clock.offsetMs = 16 * 60_000;
    const watch = watchStatusChecks();
    try {
      for (let run = 0; run < 2; run += 1) {
        const expected = await snapshot();
        watch.called.length = 0;
        await reconcilePendingPayments(ctx.app.ctx, alpha.store.id);
        expect(watch.called).toEqual(expected);
      }
    } finally {
      watch.restore();
      ctx.clock.offsetMs = 0;
    }
  });

  it('keeps going when the provider fails for one payment, then reports the failure', async () => {
    const bad = await placeOnlineOrder();
    const good = await placeOnlineOrder();
    ctx.payment.payments.set(good.providerRef, { status: 'succeeded', amountPaise: good.amount });
    ctx.clock.offsetMs = 16 * 60_000;
    const watch = watchStatusChecks(new Set([bad.providerRef]));
    try {
      await expect(reconcilePendingPayments(ctx.app.ctx, alpha.store.id)).rejects.toThrow(/failed 1/);
    } finally {
      watch.restore();
      ctx.clock.offsetMs = 0;
    }
    expect(await orderRow(good.order.id)).toMatchObject({ status: 'confirmed', paymentStatus: 'paid' });
    expect((await txnOf(bad.providerRef)).status).toBe('pending');
    expect((await orderRow(bad.order.id)).status).toBe('pending_payment');
  });

  it('does not let a payment that keeps failing starve the others', async () => {
    const bad = await placeOnlineOrder();
    ctx.clock.offsetMs = 16 * 60_000;
    const watch = watchStatusChecks(new Set([bad.providerRef]));
    try {
      await expect(reconcilePendingPayments(ctx.app.ctx, alpha.store.id)).rejects.toThrow();
      watch.called.length = 0;
      await expect(reconcilePendingPayments(ctx.app.ctx, alpha.store.id)).rejects.toThrow();
      // It was touched in the first run, so it is checked after everything that was not.
      expect(watch.called.at(-1)).toBe(bad.providerRef);
    } finally {
      watch.restore();
      ctx.clock.offsetMs = 0;
    }
  });
});

describe('abandoned and late payments', () => {
  const expireOrders = async () => {
    ctx.clock.offsetMs = 31 * 60_000;
    await runJobs();
  };

  it('closes a pending payment once its order was cancelled, and leaves live orders alone', async () => {
    const dead = await placeOnlineOrder();
    const live = await placeOnlineOrder();
    expect((await admin('POST', `${S()}/orders/${dead.order.id}/cancel`, { reason: 'Customer changed their mind' })).statusCode).toBe(200);
    ctx.clock.offsetMs = 16 * 60_000;
    try {
      await reconcilePendingPayments(ctx.app.ctx, alpha.store.id);
    } finally {
      ctx.clock.offsetMs = 0;
    }
    expect(await txnOf(dead.providerRef)).toMatchObject({ status: 'cancelled', failureCode: 'abandoned' });
    expect((await txnOf(live.providerRef)).status).toBe('pending');
    expect((await orderRow(live.order.id)).status).toBe('pending_payment');
  });

  it('still records and refunds a payment that lands after the attempt was closed', async () => {
    const { order, providerRef, amount } = await placeOnlineOrder();
    try {
      await expireOrders();
      await reconcilePendingPayments(ctx.app.ctx, alpha.store.id);
    } finally {
      ctx.clock.offsetMs = 0;
    }
    expect((await orderRow(order.id)).status).toBe('cancelled');
    expect((await txnOf(providerRef)).status).toBe('cancelled');

    const late = await webhook({ id: `evt_late_closed_${order.id}`, type: 'payment.succeeded', data: { providerRef, amountPaise: amount } });
    expect(late.json().outcome).toBe('paid_after_cancel');
    expect((await txnOf(providerRef)).status).toBe('succeeded');
    expect(await orderRow(order.id)).toMatchObject({ status: 'cancelled', paymentStatus: 'paid' });
    expect(await refundsOf(order.id)).toEqual([expect.objectContaining({ amountPaise: amount, status: 'pending' })]);
  });

  it('records a success the provider reports for a cancelled order instead of closing the attempt', async () => {
    const { order, providerRef, amount } = await placeOnlineOrder();
    ctx.payment.payments.set(providerRef, { status: 'succeeded', amountPaise: amount });
    try {
      await expireOrders();
      await reconcilePendingPayments(ctx.app.ctx, alpha.store.id);
    } finally {
      ctx.clock.offsetMs = 0;
    }
    expect((await txnOf(providerRef)).status).toBe('succeeded');
    expect(await orderRow(order.id)).toMatchObject({ status: 'cancelled', paymentStatus: 'paid' });
    expect(await refundsOf(order.id)).toHaveLength(1);
  });

  it('cancels and refunds, rather than confirms, a payment that arrives after the window but before the expiry job', async () => {
    const { order, providerRef, amount } = await placeOnlineOrder();
    ctx.clock.offsetMs = 31 * 60_000; // the expiry job has not run yet
    try {
      const res = await webhook({ id: `evt_after_window_${order.id}`, type: 'payment.succeeded', data: { providerRef, amountPaise: amount } });
      expect(res.json().outcome).toBe('paid_after_expiry');
    } finally {
      ctx.clock.offsetMs = 0;
    }
    expect(await orderRow(order.id)).toMatchObject({ status: 'cancelled', paymentStatus: 'paid' });
    expect((await txnOf(providerRef)).status).toBe('succeeded');
    expect(await refundsOf(order.id)).toEqual([expect.objectContaining({ amountPaise: amount, status: 'pending' })]);
  });

  it('still confirms a payment that arrives inside the window', async () => {
    const { order, providerRef, amount } = await placeOnlineOrder();
    ctx.clock.offsetMs = 20 * 60_000;
    try {
      const res = await webhook({ id: `evt_in_window_${order.id}`, type: 'payment.succeeded', data: { providerRef, amountPaise: amount } });
      expect(res.json().outcome).toBe('applied');
    } finally {
      ctx.clock.offsetMs = 0;
    }
    expect(await orderRow(order.id)).toMatchObject({ status: 'confirmed', paymentStatus: 'paid' });
  });
});

describe('abandoned attempts are still checked for 48 hours', () => {
  /** Places an order, expires it, and lets reconciliation close the attempt as abandoned. */
  async function abandonedAttempt() {
    const placed = await placeOnlineOrder();
    ctx.clock.offsetMs = 31 * 60_000;
    try {
      await runJobs();
      await reconcilePendingPayments(ctx.app.ctx, alpha.store.id);
    } finally {
      ctx.clock.offsetMs = 0;
    }
    expect(await txnOf(placed.providerRef)).toMatchObject({ status: 'cancelled', failureCode: 'abandoned' });
    return placed;
  }
  const reconcileAt = async (offsetMs: number) => {
    ctx.clock.offsetMs = offsetMs;
    try {
      await reconcilePendingPayments(ctx.app.ctx, alpha.store.id);
    } finally {
      ctx.clock.offsetMs = 0;
    }
  };

  it('finds a payment whose webhook was lost, records it and refunds it once', async () => {
    const { order, providerRef, amount } = await abandonedAttempt();
    ctx.payment.payments.set(providerRef, { status: 'succeeded', amountPaise: amount });
    await reconcileAt(2 * 60 * 60_000);

    expect(await txnOf(providerRef)).toMatchObject({ status: 'succeeded', failureCode: null });
    expect(await orderRow(order.id)).toMatchObject({ status: 'cancelled', paymentStatus: 'paid' });
    expect(await refundsOf(order.id)).toEqual([expect.objectContaining({ amountPaise: amount, status: 'pending' })]);

    // The provider's own notification arriving afterwards, or another run, changes nothing.
    const late = await webhook({ id: `evt_after_recheck_${order.id}`, type: 'payment.succeeded', data: { providerRef, amountPaise: amount } });
    expect(late.json().outcome).toBe('ignored_stale');
    await reconcileAt(3 * 60 * 60_000);
    expect(await refundsOf(order.id)).toHaveLength(1);
  });

  it('leaves an abandoned attempt alone while the provider still reports it pending or failed', async () => {
    const pending = await abandonedAttempt();
    await reconcileAt(2 * 60 * 60_000);
    expect(await txnOf(pending.providerRef)).toMatchObject({ status: 'cancelled', failureCode: 'abandoned' });

    ctx.payment.payments.set(pending.providerRef, { status: 'failed', amountPaise: pending.amount });
    await reconcileAt(3 * 60 * 60_000);
    expect(await txnOf(pending.providerRef)).toMatchObject({ status: 'cancelled', failureCode: 'abandoned' });
    expect(await refundsOf(pending.order.id)).toHaveLength(0);
  });

  it('stops checking after 48 hours', async () => {
    const { order, providerRef, amount } = await abandonedAttempt();
    ctx.payment.payments.set(providerRef, { status: 'succeeded', amountPaise: amount });
    const watch = watchStatusChecks();
    try {
      await reconcileAt(49 * 60 * 60_000);
      expect(watch.called).not.toContain(providerRef);
    } finally {
      watch.restore();
    }
    expect((await txnOf(providerRef)).status).toBe('cancelled');
    expect(await refundsOf(order.id)).toHaveLength(0);
  });

  it('does not recheck a cancelled attempt that was not abandoned', async () => {
    const { providerRef } = await placeOnlineOrder();
    await ctx.db.update(paymentTransactions).set({ status: 'cancelled', failureCode: null }).where(eq(paymentTransactions.providerRef, providerRef));
    const watch = watchStatusChecks();
    try {
      await reconcileAt(16 * 60_000);
      expect(watch.called).not.toContain(providerRef);
    } finally {
      watch.restore();
    }
  });
});
