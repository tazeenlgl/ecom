import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { orders, promotionRedemptions } from '../src/db/schema.js';
import { customerCanCancel } from '../src/modules/orders/eligibility.js';
import { jobHandlers } from '../src/modules/jobs/handlers.js';
import { runDueJobs } from '../src/modules/jobs/queue.js';
import { adminToken, bearer, customerToken, seedStore, setupTestApp, type TestContext } from './helpers.js';
import { InMemoryPosGateway } from './support/in-memory-pos.js';

let ctx: TestContext;
let alpha: Awaited<ReturnType<typeof seedStore>>;
let owner: string;
const v: Record<string, string> = {};
let n = 0;

const S = () => `/v1/admin/stores/${alpha.store.id}`;
const admin = (method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, payload?: unknown) => ctx.app.inject({ method, url, headers: bearer(owner), ...(payload ? { payload: payload as object } : {}) });
const shop = (method: 'GET' | 'POST', url: string, headers: Record<string, string> = {}, payload?: unknown) =>
  ctx.app.inject({ method, url: `/v1/storefront${url}`, headers: { host: alpha.host, ...headers }, ...(payload ? { payload: payload as object } : {}) });
const runJobs = () => runDueJobs(ctx.db, jobHandlers(ctx.app.ctx), 'test-worker', 50, new Date(Date.now() + ctx.clock.offsetMs));

/** A signed-in customer with one COD order for a single item, ready for the actions under test. */
async function placeOrder(options: { variant?: string; quantity?: number } = {}) {
  const phone = `98${String(10_000_000 + n++).slice(-8)}`;
  const token = await customerToken(ctx, alpha.host, phone);
  const address = (await shop('POST', '/me/addresses', bearer(token), { name: 'Test Buyer', phone, line1: '12 Residency Rd', city: 'Bengaluru', state: 'Karnataka', pincode: '560001' })).json().address.id as string;
  await shop('POST', '/cart/items', bearer(token), { variantId: options.variant ?? v.shirtM, quantity: options.quantity ?? 1 });
  const quote = (await shop('POST', '/checkout/quote', bearer(token), { addressId: address, paymentMethod: 'cod' })).json().quote;
  const placed = await shop('POST', '/checkout/orders', { ...bearer(token), 'idempotency-key': `actions-${phone}` }, { addressId: address, paymentMethod: 'cod', expectedTotalPaise: quote.totalPaise });
  expect(placed.statusCode).toBe(201);
  const order = placed.json().order;
  return { token, phone, order, orderNumber: order.orderNumber as string, orderId: order.id as string };
}
const getOrder = async (token: string, orderNumber: string) => (await shop('GET', `/orders/${orderNumber}`, bearer(token))).json().order;
const cancel = (token: string, orderNumber: string) => shop('POST', `/orders/${orderNumber}/cancel`, bearer(token), { reason: 'Changed my mind' });

beforeAll(async () => {
  const pos = new InMemoryPosGateway();
  ctx = await setupTestApp({ pos });
  alpha = await seedStore(ctx.db, 'alpha', { orderNumberPrefix: 'ALP', codMaxOrderPaise: 5_000_000 });
  owner = (await adminToken(ctx, 'owner@example.com', [{ role: 'platform_owner', storeId: null }])).token;

  const shirt = (await admin('POST', `${S()}/products`, { slug: 'oxford-shirt', title: 'Oxford Shirt', taxRateBps: 500 })).json().product;
  for (const [key, sku] of [['shirtM', 'SH-M'], ['shirtL', 'SH-L']] as const) {
    v[key] = (await admin('POST', `${S()}/products/${shirt.id}/variants`, { skuCode: sku, title: sku })).json().variant.id;
    await admin('PUT', `${S()}/variants/${v[key]}/price`, { mrpPaise: 199_900, pricePaise: 149_900 });
  }
  await admin('POST', `${S()}/products/${shirt.id}/status`, { status: 'published' });
  v.shirtProduct = shirt.id;
  await admin('POST', `${S()}/shipping-zones`, { name: 'Karnataka', pincodePrefixes: ['56'], chargePaise: 4_900, freeAbovePaise: 250_000, codAvailable: true, codFeePaise: 2_000, estimatedDaysMin: 2, estimatedDaysMax: 4 });
  pos.stock.set('SH-M', 50).set('SH-L', 50);
  expect((await admin('POST', `${S()}/pos/stock-sync`)).statusCode).toBe(202);
  await runJobs();
});
afterAll(async () => ctx?.close());

describe('customer cancellation eligibility (single rule)', () => {
  it.each([
    ['pending_payment', 'unfulfilled', true],
    ['confirmed', 'unfulfilled', true],
    ['confirmed', 'packed', false],
    ['processing', 'unfulfilled', false],
    ['processing', 'packed', false],
    ['confirmed', 'shipped', false],
    ['completed', 'delivered', false],
    ['cancelled', 'cancelled', false],
    ['confirmed', 'delivery_failed', false],
  ])('status %s + fulfilment %s -> canCancel %s', (status, fulfillmentStatus, expected) => {
    expect(customerCanCancel({ status, fulfillmentStatus } as never)).toBe(expected);
  });

  it('reports canCancel from the server and the cancel endpoint agrees', async () => {
    const o = await placeOrder();
    expect(o.order.actions).toMatchObject({ canCancel: true, canReturn: false });
    expect((await getOrder(o.token, o.orderNumber)).actions.canCancel).toBe(true);

    const res = await cancel(o.token, o.orderNumber);
    expect(res.statusCode).toBe(200);
    expect(res.json().order).toMatchObject({ status: 'cancelled', fulfillmentStatus: 'cancelled', actions: { canCancel: false } });
    const again = await cancel(o.token, o.orderNumber);
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('invalid_transition');
  });

  it('offers no cancel once the store has started processing, and the API refuses it too', async () => {
    const o = await placeOrder();
    expect((await admin('POST', `${S()}/orders/${o.orderId}/status`, { to: 'processing' })).statusCode).toBe(200);
    expect((await getOrder(o.token, o.orderNumber)).actions.canCancel).toBe(false);
    const res = await cancel(o.token, o.orderNumber);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('invalid_transition');
    // Nothing changed: the order is still processing and not cancelled.
    expect(await getOrder(o.token, o.orderNumber)).toMatchObject({ status: 'processing', actions: { canCancel: false } });
  });

  it('offers no cancel once an order is packed or shipped', async () => {
    const o = await placeOrder();
    const shipment = (await admin('POST', `${S()}/orders/${o.orderId}/shipments`, { courier: 'manual', trackingNumber: 'TRK-A' })).json().shipment;
    const ev = (status: string, at: string, id: string) => admin('POST', `${S()}/shipments/${shipment.id}/events`, { status, occurredAt: at, externalEventId: id });
    await ev('packed', '2026-10-01T10:00:00Z', 'p1');
    expect((await getOrder(o.token, o.orderNumber)).actions.canCancel).toBe(false);
    expect((await cancel(o.token, o.orderNumber)).statusCode).toBe(409);
    await ev('shipped', '2026-10-01T12:00:00Z', 'p2');
    expect((await getOrder(o.token, o.orderNumber)).actions.canCancel).toBe(false);
    expect((await cancel(o.token, o.orderNumber)).statusCode).toBe(409);
  });

  it('handles a stale page: the old view said cancellable, the API says 409, a refresh says not cancellable', async () => {
    const o = await placeOrder();
    const stale = await getOrder(o.token, o.orderNumber);
    expect(stale.actions.canCancel).toBe(true);
    await admin('POST', `${S()}/orders/${o.orderId}/status`, { to: 'processing' });
    const res = await cancel(o.token, o.orderNumber);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.message).toMatch(/no longer be cancelled/);
    expect((await getOrder(o.token, o.orderNumber)).actions.canCancel).toBe(false);
  });

  it('keeps staff cancellation of a packed (unshipped) order working: staff rules are not changed', async () => {
    const o = await placeOrder();
    const shipment = (await admin('POST', `${S()}/orders/${o.orderId}/shipments`, { courier: 'manual', trackingNumber: 'TRK-B' })).json().shipment;
    await admin('POST', `${S()}/shipments/${shipment.id}/events`, { status: 'packed', occurredAt: '2026-10-01T10:00:00Z', externalEventId: 'b1' });
    const res = await admin('POST', `${S()}/orders/${o.orderId}/cancel`, { reason: 'Customer called' });
    expect(res.statusCode).toBe(200);
  });

  it('still voids coupon redemptions and records the public timeline event when a customer cancels', async () => {
    const promo = (await admin('POST', `${S()}/promotions`, { name: 'Ten percent', kind: 'percentage', config: { percentBps: 1000 }, requiresCoupon: true, stackable: true })).json().promotion;
    await admin('POST', `${S()}/promotions/${promo.id}/coupons`, { code: 'TENOFF' });
    const phone = `97${String(10_000_000 + n++).slice(-8)}`;
    const token = await customerToken(ctx, alpha.host, phone);
    const address = (await shop('POST', '/me/addresses', bearer(token), { name: 'Buyer', phone, line1: '1 MG Road', city: 'Bengaluru', state: 'Karnataka', pincode: '560001' })).json().address.id as string;
    await shop('POST', '/cart/items', bearer(token), { variantId: v.shirtM, quantity: 1 });
    expect((await ctx.app.inject({ method: 'PUT', url: '/v1/storefront/cart/coupon', headers: { host: alpha.host, ...bearer(token) }, payload: { code: 'TENOFF' } })).statusCode).toBe(200);
    const quote = (await shop('POST', '/checkout/quote', bearer(token), { addressId: address, paymentMethod: 'cod' })).json().quote;
    const placed = (await shop('POST', '/checkout/orders', { ...bearer(token), 'idempotency-key': `coupon-${phone}` }, { addressId: address, paymentMethod: 'cod', expectedTotalPaise: quote.totalPaise })).json().order;
    const [row] = await ctx.db.select().from(orders).where(eq(orders.orderNumber, placed.orderNumber));
    expect((await ctx.db.select().from(promotionRedemptions).where(eq(promotionRedemptions.orderId, row!.id)))[0]!.voidedAt).toBeNull();

    expect((await cancel(token, placed.orderNumber)).statusCode).toBe(200);
    expect((await ctx.db.select().from(promotionRedemptions).where(eq(promotionRedemptions.orderId, row!.id)))[0]!.voidedAt).not.toBeNull();
    const detail = await getOrder(token, placed.orderNumber);
    expect(detail.timeline.some((e: { machine: string; toState: string; note: string | null }) => e.machine === 'order' && e.toState === 'cancelled' && e.note === 'Changed my mind')).toBe(true);
  });

  it("never lets one customer cancel another's order", async () => {
    const mine = await placeOrder();
    const other = await customerToken(ctx, alpha.host, '9876500001');
    expect((await cancel(other, mine.orderNumber)).statusCode).toBe(404);
    expect((await getOrder(mine.token, mine.orderNumber)).status).toBe('confirmed');
  });
});
