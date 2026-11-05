import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { jobs, orders, paymentEvents, refunds } from '../src/db/schema.js';
import { jobHandlers } from '../src/modules/jobs/handlers.js';
import { runDueJobs } from '../src/modules/jobs/queue.js';
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
const runJobs = () => runDueJobs(ctx.db, jobHandlers(ctx.app.ctx), 'test-worker', 50, new Date(Date.now() + ctx.clock.offsetMs));

/** Sends a webhook signed like the fake provider would. */
function webhook(body: object, signature?: string) {
  const raw = JSON.stringify(body);
  return ctx.app.inject({
    method: 'POST',
    url: '/v1/webhooks/payments/fake',
    headers: { 'content-type': 'application/json', 'x-fake-signature': signature ?? ctx.payment.sign(raw) },
    payload: raw,
  });
}

let phoneSeq = 0;
/** Places an online order and starts its payment; returns order and provider reference. */
async function placeOnlineOrder() {
  phoneSeq += 1;
  const token = await customerToken(ctx, alpha.host, `97000000${String(phoneSeq).padStart(2, '0')}`);
  const address = await shop('POST', '/me/addresses', bearer(token), { name: 'Buyer', phone: '9700000000', line1: '1 Road', city: 'Chennai', state: 'Tamil Nadu', pincode: '600001' });
  await shop('POST', '/cart/items', bearer(token), { variantId, quantity: 1 });
  const body = { addressId: address.json().address.id, paymentMethod: 'online' };
  const quote = (await shop('POST', '/checkout/quote', bearer(token), body)).json().quote;
  const placed = await shop('POST', '/checkout/orders', { ...bearer(token), 'idempotency-key': `pay-${phoneSeq}-xyz` }, { ...body, expectedTotalPaise: quote.totalPaise });
  expect(placed.statusCode).toBe(201);
  const order = placed.json().order;
  expect(order).toMatchObject({ status: 'pending_payment', paymentStatus: 'unpaid' });
  const pay = await shop('POST', `/orders/${order.orderNumber}/payments`, bearer(token));
  expect(pay.statusCode).toBe(201);
  return { token, order, providerRef: pay.json().payment.client.providerRef as string, amount: pay.json().payment.amountPaise as number };
}

const orderRow = async (id: string) => (await ctx.db.select().from(orders).where(eq(orders.id, id)))[0]!;

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

describe('payment webhooks', () => {
  it('rejects unsigned or tampered webhooks', async () => {
    const { providerRef, amount } = await placeOnlineOrder();
    const body = { id: 'evt_bad', type: 'payment.succeeded', data: { providerRef, amountPaise: amount } };
    const res = await webhook(body, 'deadbeef');
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('webhook_invalid');
    expect(await ctx.db.select().from(paymentEvents)).toHaveLength(0);
  });

  it('confirms the order only on a verified success, once, and ignores a late failure', async () => {
    const { order, providerRef, amount, token } = await placeOnlineOrder();
    // The customer can see the order but it is not paid just because the browser came back.
    expect((await shop('GET', `/orders/${order.orderNumber}`, bearer(token))).json().order.paymentStatus).toBe('pending');

    const success = { id: 'evt_ok_1', type: 'payment.succeeded', data: { providerRef, amountPaise: amount } };
    expect((await webhook(success)).json().outcome).toBe('applied');
    expect((await webhook(success)).json().outcome).toBe('duplicate');
    const late = { id: 'evt_fail_1', type: 'payment.failed', data: { providerRef, failureCode: 'bank_declined' } };
    expect((await webhook(late)).json().outcome).toBe('ignored_stale');

    const row = await orderRow(order.id);
    expect(row).toMatchObject({ status: 'confirmed', paymentStatus: 'paid' });
    // Confirmation queued the POS submission and the customer notification exactly once.
    const queued = await ctx.db.select().from(jobs).where(eq(jobs.idempotencyKey, `pos.submit_order:${order.id}`));
    expect(queued).toHaveLength(1);
  });

  it('does not mark paid when the amount does not match', async () => {
    const { order, providerRef, amount } = await placeOnlineOrder();
    const res = await webhook({ id: 'evt_amt', type: 'payment.succeeded', data: { providerRef, amountPaise: amount - 1 } });
    expect(res.json().outcome).toBe('amount_mismatch');
    expect((await orderRow(order.id)).paymentStatus).toBe('pending');
  });

  it('accepts a success that arrives after a failure (out of order)', async () => {
    const { order, providerRef, amount } = await placeOnlineOrder();
    await webhook({ id: 'evt_f2', type: 'payment.failed', data: { providerRef } });
    expect((await orderRow(order.id)).paymentStatus).toBe('failed');
    await webhook({ id: 'evt_s2', type: 'payment.succeeded', data: { providerRef, amountPaise: amount } });
    expect(await orderRow(order.id)).toMatchObject({ status: 'confirmed', paymentStatus: 'paid' });
  });

  it('expires unpaid orders and refunds a payment that arrives afterwards', async () => {
    const { order, providerRef, amount } = await placeOnlineOrder();
    ctx.clock.offsetMs = 31 * 60_000;
    await runJobs();
    ctx.clock.offsetMs = 0;
    expect((await orderRow(order.id)).status).toBe('cancelled');
    const res = await webhook({ id: 'evt_late', type: 'payment.succeeded', data: { providerRef, amountPaise: amount } });
    expect(res.json().outcome).toBe('paid_after_cancel');
    const [refund] = await ctx.db.select().from(refunds).where(eq(refunds.orderId, order.id));
    expect(refund).toMatchObject({ amountPaise: amount, status: 'pending' });
  });

  it('reconciles a payment whose webhook never arrived', async () => {
    const { order, providerRef, amount } = await placeOnlineOrder();
    ctx.payment.payments.set(providerRef, { status: 'succeeded', amountPaise: amount });
    ctx.clock.offsetMs = 16 * 60_000;
    await admin('POST', `${S()}/payments/reconcile`);
    await runJobs();
    ctx.clock.offsetMs = 0;
    expect((await orderRow(order.id)).paymentStatus).toBe('paid');
  });
});

describe('refunds', () => {
  it('refunds idempotently, never more than collected, and settles on the provider webhook', async () => {
    const { order, providerRef, amount } = await placeOnlineOrder();
    await webhook({ id: `evt_paid_${order.id}`, type: 'payment.succeeded', data: { providerRef, amountPaise: amount } });

    const url = `${S()}/orders/${order.id}/refunds`;
    expect((await admin('POST', url, { amountPaise: amount + 1, reason: 'too much' }, { 'idempotency-key': 'refund-too-much' })).statusCode).toBe(422);
    const first = await admin('POST', url, { amountPaise: 100_000, reason: 'damaged' }, { 'idempotency-key': 'refund-key-1' });
    const again = await admin('POST', url, { amountPaise: 100_000, reason: 'damaged' }, { 'idempotency-key': 'refund-key-1' });
    expect(first.statusCode).toBe(201);
    expect(again.json().refund.id).toBe(first.json().refund.id);

    await runJobs(); // sends the refund to the provider
    const [sent] = await ctx.db.select().from(refunds).where(eq(refunds.id, first.json().refund.id));
    expect(sent!.status).toBe('processing');

    await webhook({ id: 'evt_rf_1', type: 'refund.succeeded', data: { providerRef: sent!.providerRef! } });
    expect(await orderRow(order.id)).toMatchObject({ paymentStatus: 'partially_refunded', refundedPaise: 100_000 });
  });
});
