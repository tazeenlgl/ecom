import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { jobs, orderItems, orders, posStockLevels } from '../src/db/schema.js';
import { jobHandlers } from '../src/modules/jobs/handlers.js';
import { runDueJobs } from '../src/modules/jobs/queue.js';
import { adminToken, bearer, customerToken, seedStore, setupTestApp, type TestContext } from './helpers.js';
import { InMemoryPosGateway } from './support/in-memory-pos.js';

let ctx: TestContext;
let pos: InMemoryPosGateway;
let alpha: Awaited<ReturnType<typeof seedStore>>;
let beta: Awaited<ReturnType<typeof seedStore>>;
let adminTok: string;
const v: Record<string, string> = {};
let saleCollectionId: string;

const S = () => `/v1/admin/stores/${alpha.store.id}`;
const admin = (method: 'GET' | 'POST' | 'PATCH' | 'PUT', url: string, payload?: unknown, headers: Record<string, string> = {}) =>
  ctx.app.inject({ method, url, headers: { ...bearer(adminTok), ...headers }, ...(payload ? { payload: payload as object } : {}) });
const shop = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, headers: Record<string, string> = {}, payload?: unknown, host = alpha.host) =>
  ctx.app.inject({ method, url: `/v1/storefront${url}`, headers: { host, ...headers }, ...(payload ? { payload: payload as object } : {}) });
const runJobs = () => runDueJobs(ctx.db, jobHandlers(ctx.app.ctx), 'test-worker', 50, new Date(Date.now() + ctx.clock.offsetMs));

async function addAddress(token: string, pincode = '560001') {
  const res = await shop('POST', '/me/addresses', bearer(token), { name: 'Test Buyer', phone: '9876500000', line1: '12 Residency Rd', city: 'Bengaluru', state: 'Karnataka', pincode });
  return res.json().address.id as string;
}

beforeAll(async () => {
  pos = new InMemoryPosGateway();
  ctx = await setupTestApp({ pos });
  alpha = await seedStore(ctx.db, 'alpha', { orderNumberPrefix: 'ALP', codMaxOrderPaise: 500_000 });
  beta = await seedStore(ctx.db, 'beta');
  adminTok = (await adminToken(ctx, 'owner@example.com', [{ role: 'platform_owner', storeId: null }])).token;

  // Catalogue: one shirt with two sizes, one mug; prices; shipping; a sale collection.
  const shirt = (await admin('POST', `${S()}/products`, { slug: 'oxford-shirt', title: 'Oxford Shirt', taxRateBps: 500 })).json().product;
  const mug = (await admin('POST', `${S()}/products`, { slug: 'mug', title: 'Mug', taxRateBps: 1200 })).json().product;
  for (const [key, productId, sku] of [['shirtM', shirt.id, 'SH-M'], ['shirtL', shirt.id, 'SH-L'], ['mug', mug.id, 'MUG-1']] as const) {
    v[key] = (await admin('POST', `${S()}/products/${productId}/variants`, { skuCode: sku, title: sku })).json().variant.id;
  }
  await admin('PUT', `${S()}/variants/${v.shirtM}/price`, { mrpPaise: 199_900, pricePaise: 149_900 });
  await admin('PUT', `${S()}/variants/${v.shirtL}/price`, { mrpPaise: 199_900, pricePaise: 149_900 });
  await admin('PUT', `${S()}/variants/${v.mug}/price`, { mrpPaise: 49_900, pricePaise: 39_900 });
  await admin('POST', `${S()}/products/${shirt.id}/status`, { status: 'published' });
  await admin('POST', `${S()}/products/${mug.id}/status`, { status: 'published' });
  saleCollectionId = (await admin('POST', `${S()}/collections`, { slug: 'sale', title: 'Sale' })).json().collection.id;
  await admin('PUT', `${S()}/collections/${saleCollectionId}/products`, { productIds: [mug.id] });
  await admin('POST', `${S()}/shipping-zones`, { name: 'Karnataka', pincodePrefixes: ['56'], chargePaise: 4_900, freeAbovePaise: 250_000, codAvailable: true, codFeePaise: 2_000, estimatedDaysMin: 2, estimatedDaysMax: 4 });

  // Stock comes from the POS (test double) through the sync job.
  pos.stock.set('SH-M', 5).set('SH-L', 0).set('MUG-1', 50);
  expect((await admin('POST', `${S()}/pos/stock-sync`)).statusCode).toBe(202);
  await runJobs();
});
afterAll(async () => ctx?.close());

describe('catalogue and stock read model', () => {
  it('shows only published products of the resolved store with availability', async () => {
    const list = await shop('GET', '/products');
    expect(list.json().items.map((p: { slug: string }) => p.slug).sort()).toEqual(['mug', 'oxford-shirt']);
    expect((await shop('GET', '/products', {}, undefined, beta.host)).json().items).toHaveLength(0);
    const detail = (await shop('GET', '/products/oxford-shirt')).json().product;
    expect(detail.variants.map((x: { skuCode: string; inStock: boolean }) => [x.skuCode, x.inStock])).toEqual([
      ['SH-M', true],
      ['SH-L', false],
    ]);
    expect((await shop('GET', '/products/oxford-shirt', {}, undefined, beta.host)).statusCode).toBe(404);
  });

  it('records SKUs the POS did not report as zero rather than unknown', async () => {
    const [row] = await ctx.db.select().from(posStockLevels).where(eq(posStockLevels.skuCode, 'SH-L'));
    expect(row!.available).toBe(0);
  });
});

describe('cart', () => {
  it('prices guest carts on the server and ignores client-sent prices', async () => {
    const created = await shop('POST', '/cart');
    const token = created.json().cart.cartToken as string;
    const add = await shop('POST', '/cart/items', { 'x-cart-token': token }, { variantId: v.shirtM, quantity: 2, pricePaise: 1, totalPaise: 1 });
    expect(add.statusCode).toBe(200);
    expect(add.json().quote).toMatchObject({ subtotalPaise: 299_800, totalPaise: 299_800 });
    const withPin = await shop('GET', '/cart?pincode=560001', { 'x-cart-token': token });
    expect(withPin.json().quote.shippingPaise).toBe(0); // free above ₹2,500
  });

  it('cannot add another store’s variant or read another store’s cart', async () => {
    const betaCart = (await shop('POST', '/cart', {}, undefined, beta.host)).json().cart.cartToken;
    const res = await shop('POST', '/cart/items', { 'x-cart-token': betaCart }, { variantId: v.mug, quantity: 1 }, beta.host);
    expect(res.statusCode).toBe(404);
    const alphaCart = (await shop('POST', '/cart')).json().cart.cartToken;
    expect((await shop('GET', '/cart', { 'x-cart-token': alphaCart }, undefined, beta.host)).statusCode).toBe(404);
  });

  it('flags out-of-stock lines', async () => {
    const token = (await shop('POST', '/cart')).json().cart.cartToken;
    const res = await shop('POST', '/cart/items', { 'x-cart-token': token }, { variantId: v.shirtL, quantity: 1 });
    expect(res.json().quote.issues).toEqual([expect.objectContaining({ code: 'insufficient_stock', variantId: v.shirtL })]);
  });

  it('merges a guest cart into the customer cart at sign-in', async () => {
    const custToken = await customerToken(ctx, alpha.host, '9800000001');
    await shop('POST', '/cart/items', bearer(custToken), { variantId: v.mug, quantity: 1 });
    const guest = (await shop('POST', '/cart')).json().cart.cartToken;
    await shop('POST', '/cart/items', { 'x-cart-token': guest }, { variantId: v.mug, quantity: 2 });
    await shop('POST', '/cart/items', { 'x-cart-token': guest }, { variantId: v.shirtM, quantity: 1 });
    ctx.clock.offsetMs = 31_000; // past the OTP resend cooldown
    const merged = await customerToken(ctx, alpha.host, '9800000001', { 'x-cart-token': guest });
    ctx.clock.offsetMs = 0;
    const cart = (await shop('GET', '/cart', bearer(merged))).json().quote;
    expect(cart.lines.map((l: { skuCode: string; quantity: number }) => [l.skuCode, l.quantity]).sort()).toEqual([
      ['MUG-1', 3],
      ['SH-M', 1],
    ]);
    // The guest token no longer works.
    expect((await shop('GET', '/cart', { 'x-cart-token': guest })).statusCode).toBe(404);
  });
});

describe('promotions', () => {
  it('applies coupon and automatic offers by priority and stacking rules', async () => {
    const percent = (await admin('POST', `${S()}/promotions`, { name: '10% off sale', kind: 'percentage', config: { percentBps: 1000 }, eligibility: { collectionIds: [saleCollectionId] }, stackable: true, priority: 5 })).json().promotion;
    const coupon = (await admin('POST', `${S()}/promotions`, { name: 'WELCOME ₹100', kind: 'fixed_amount', config: { amountPaise: 10_000 }, requiresCoupon: true, stackable: true, minSubtotalPaise: 100_000, perCustomerLimit: 1 })).json().promotion;
    expect((await admin('POST', `${S()}/promotions/${coupon.id}/coupons`, { code: 'welcome100' })).statusCode).toBe(201);
    // Invalid config is rejected.
    expect((await admin('POST', `${S()}/promotions`, { name: 'bad', kind: 'percentage', config: { percentBps: 20000 } })).statusCode).toBe(400);

    const token = await customerToken(ctx, alpha.host, '9800000002');
    await shop('POST', '/cart/items', bearer(token), { variantId: v.mug, quantity: 3 }); // 119,700
    let quote = (await shop('GET', '/cart', bearer(token))).json().quote;
    expect(quote.appliedPromotions.map((p: { promotionId: string }) => p.promotionId)).toEqual([percent.id]);
    expect(quote.itemDiscountPaise).toBe(11_970);

    const applied = await shop('PUT', '/cart/coupon', bearer(token), { code: 'WELCOME100' });
    expect(applied.statusCode).toBe(200);
    quote = applied.json().quote;
    expect(quote.coupon.status).toBe('applied');
    expect(quote.itemDiscountPaise).toBe(21_970);

    expect((await shop('PUT', '/cart/coupon', bearer(token), { code: 'NOPE' })).json().error.code).toBe('coupon_invalid');
    await admin('PATCH', `${S()}/promotions/${percent.id}`, { status: 'inactive' });
    await admin('PATCH', `${S()}/promotions/${coupon.id}`, { status: 'inactive' });
  });
});

describe('checkout and orders', () => {
  let token: string;
  let addressId: string;

  beforeAll(async () => {
    token = await customerToken(ctx, alpha.host, '9800000003');
    addressId = await addAddress(token);
    await shop('POST', '/cart/items', bearer(token), { variantId: v.mug, quantity: 2 });
  });

  const place = (key: string | null, body: Record<string, unknown>) =>
    shop('POST', '/checkout/orders', { ...bearer(token), ...(key ? { 'idempotency-key': key } : {}) }, body);

  it('requires an Idempotency-Key and the total the customer saw', async () => {
    expect((await place(null, { addressId, paymentMethod: 'cod', expectedTotalPaise: 1 })).statusCode).toBe(400);
    const stale = await place('order-key-0001', { addressId, paymentMethod: 'cod', expectedTotalPaise: 1 });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe('price_changed');
    expect(stale.json().error.details.quote.totalPaise).toBe(79_800 + 4_900 + 2_000);
  });

  it('places a COD order once per Idempotency-Key, snapshotting prices', async () => {
    const quote = (await shop('POST', '/checkout/quote', bearer(token), { addressId, paymentMethod: 'cod' })).json().quote;
    const body = { addressId, paymentMethod: 'cod', expectedTotalPaise: quote.totalPaise };
    const [first, concurrent] = await Promise.all([place('order-key-0002', body), place('order-key-0002', body)]);
    expect([first.statusCode, concurrent.statusCode].sort()).toEqual([200, 201]);
    const order = first.json().order;
    expect(concurrent.json().order.orderNumber).toBe(order.orderNumber);
    expect(order).toMatchObject({ status: 'confirmed', paymentStatus: 'cod_pending', subtotalPaise: 79_800, shippingPaise: 4_900, codFeePaise: 2_000, totalPaise: 86_700 });
    expect(order.orderNumber).toMatch(/^ALP-\d{6}$/);
    expect(order.items[0]).toMatchObject({ skuCode: 'MUG-1', unitPricePaise: 39_900, quantity: 2, taxPaise: 8_550 });

    const count = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(orders).where(eq(orders.customerId, (await ctx.db.select().from(orders).where(eq(orders.orderNumber, order.orderNumber)))[0]!.customerId));
    expect(count[0]!.n).toBe(1);

    // Same key, different request: rejected.
    const reused = await place('order-key-0002', { ...body, paymentMethod: 'online' });
    expect(reused.statusCode).toBe(422);

    // A later price change does not alter the order snapshot.
    await admin('PUT', `${S()}/variants/${v.mug}/price`, { mrpPaise: 49_900, pricePaise: 45_000 });
    const again = (await shop('GET', `/orders/${order.orderNumber}`, bearer(token))).json().order;
    expect(again.items[0].unitPricePaise).toBe(39_900);
    await admin('PUT', `${S()}/variants/${v.mug}/price`, { mrpPaise: 49_900, pricePaise: 39_900 });
  });

  it('protects order snapshots in the database', async () => {
    const [item] = await ctx.db.select().from(orderItems).limit(1);
    await expect(ctx.db.update(orderItems).set({ unitPricePaise: 1 }).where(eq(orderItems.id, item!.id))).rejects.toThrow();
    const [order] = await ctx.db.select().from(orders).limit(1);
    await expect(ctx.db.update(orders).set({ totalPaise: 1 }).where(eq(orders.id, order!.id))).rejects.toThrow();
  });

  it('hides orders from other customers and other stores', async () => {
    const [order] = await ctx.db.select().from(orders).where(eq(orders.storeId, alpha.store.id)).limit(1);
    const other = await customerToken(ctx, alpha.host, '9800000004');
    expect((await shop('GET', `/orders/${order!.orderNumber}`, bearer(other))).statusCode).toBe(404);
    expect((await shop('GET', `/orders/${order!.orderNumber}`, bearer(token), undefined, beta.host)).statusCode).toBe(401);
  });

  it('rejects illegal status changes and walks the fulfillment lifecycle', async () => {
    const [order] = await ctx.db.select().from(orders).where(and(eq(orders.storeId, alpha.store.id), eq(orders.paymentMethod, 'cod'))).limit(1);
    const id = order!.id;
    expect((await admin('POST', `${S()}/orders/${id}/status`, { to: 'completed' })).statusCode).toBe(200);
    const res = await admin('POST', `${S()}/orders/${id}/cancel`, { reason: 'test' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('invalid_transition');
  });

  it('ships, tracks (ignoring out-of-order events) and delivers', async () => {
    const t = await customerToken(ctx, alpha.host, '9800000005');
    const addr = await addAddress(t);
    await shop('POST', '/cart/items', bearer(t), { variantId: v.shirtM, quantity: 1 });
    const q = (await shop('POST', '/checkout/quote', bearer(t), { addressId: addr, paymentMethod: 'cod' })).json().quote;
    const placed = await shop('POST', '/checkout/orders', { ...bearer(t), 'idempotency-key': 'ship-flow-1' }, { addressId: addr, paymentMethod: 'cod', expectedTotalPaise: q.totalPaise });
    const orderId = placed.json().order.id;

    const shipment = (await admin('POST', `${S()}/orders/${orderId}/shipments`, { courier: 'manual', trackingNumber: 'TRK1' })).json().shipment;
    const ev = (status: string, occurredAt: string, externalEventId?: string) =>
      admin('POST', `${S()}/shipments/${shipment.id}/events`, { status, occurredAt, ...(externalEventId ? { externalEventId } : {}) });
    expect((await ev('shipped', '2026-10-01T10:00:00Z', 'e1')).json().applied).toBe(true);
    expect((await ev('shipped', '2026-10-01T10:00:00Z', 'e1')).json()).toMatchObject({ applied: false, reason: 'duplicate' });
    expect((await ev('out_for_delivery', '2026-10-02T08:00:00Z', 'e3')).json().applied).toBe(true);
    expect((await ev('in_transit', '2026-10-01T20:00:00Z', 'e2')).json()).toMatchObject({ applied: false, reason: 'out_of_order' });
    expect((await ev('delivered', '2026-10-02T12:00:00Z', 'e4')).json().applied).toBe(true);

    const detail = (await admin('GET', `${S()}/orders/${orderId}`)).json();
    expect(detail.order).toMatchObject({ status: 'completed', fulfillmentStatus: 'delivered' });

    // Return request after delivery, limited to ordered quantity.
    const item = detail.items[0];
    const tooMany = await shop('POST', `/orders/${placed.json().order.orderNumber}/returns`, bearer(t), { type: 'return', reason: 'Too small', items: [{ orderItemId: item.id, quantity: 2 }] });
    expect(tooMany.statusCode).toBe(422);
    const ret = await shop('POST', `/orders/${placed.json().order.orderNumber}/returns`, bearer(t), { type: 'return', reason: 'Too small', items: [{ orderItemId: item.id, quantity: 1 }] });
    expect(ret.statusCode).toBe(201);
    const rid = ret.json().returnRequest.id;
    expect((await admin('POST', `${S()}/returns/${rid}/status`, { to: 'completed' })).statusCode).toBe(409);
    expect((await admin('POST', `${S()}/returns/${rid}/status`, { to: 'approved' })).statusCode).toBe(200);
  });
});

describe('POS order synchronisation', () => {
  it('submits confirmed orders, retries retryable failures with backoff, and records the POS reference', async () => {
    await runJobs(); // drain jobs queued by earlier tests
    const t = await customerToken(ctx, alpha.host, '9800000006');
    const addr = await addAddress(t);
    await shop('POST', '/cart/items', bearer(t), { variantId: v.mug, quantity: 1 });
    const q = (await shop('POST', '/checkout/quote', bearer(t), { addressId: addr, paymentMethod: 'cod' })).json().quote;
    const placed = (await shop('POST', '/checkout/orders', { ...bearer(t), 'idempotency-key': 'pos-flow-1' }, { addressId: addr, paymentMethod: 'cod', expectedTotalPaise: q.totalPaise })).json().order;

    pos.failNext = 1;
    pos.failRetryable = true;
    await runJobs();
    let [order] = await ctx.db.select().from(orders).where(eq(orders.id, placed.id));
    expect(order!.posSyncStatus).toBe('failed');
    const [job] = await ctx.db.select().from(jobs).where(eq(jobs.idempotencyKey, `pos.submit_order:${placed.id}`));
    expect(job).toMatchObject({ status: 'queued', attempts: 1 });
    expect(job!.lastError).toContain('Simulated POS failure');
    expect(job!.runAt.getTime()).toBeGreaterThan(Date.now());

    ctx.clock.offsetMs = 60_000;
    await runJobs();
    ctx.clock.offsetMs = 0;
    [order] = await ctx.db.select().from(orders).where(eq(orders.id, placed.id));
    expect(order).toMatchObject({ posSyncStatus: 'synced', posOrderRef: `POS-${placed.orderNumber}` });
    expect(pos.submitted.get(placed.orderNumber)?.lines).toEqual([{ skuCode: 'MUG-1', quantity: 1, unitPricePaise: 39_900 }]);
  });

  it('dead-letters permanent failures and lets an admin retry', async () => {
    const t = await customerToken(ctx, alpha.host, '9800000007');
    const addr = await addAddress(t);
    await shop('POST', '/cart/items', bearer(t), { variantId: v.mug, quantity: 1 });
    const q = (await shop('POST', '/checkout/quote', bearer(t), { addressId: addr, paymentMethod: 'cod' })).json().quote;
    const placed = (await shop('POST', '/checkout/orders', { ...bearer(t), 'idempotency-key': 'pos-flow-2' }, { addressId: addr, paymentMethod: 'cod', expectedTotalPaise: q.totalPaise })).json().order;

    pos.failNext = 1;
    pos.failRetryable = false;
    await runJobs();
    const dead = (await admin('GET', `${S()}/jobs?status=dead`)).json().items;
    const job = dead.find((j: { payload: { orderId?: string } }) => j.payload.orderId === placed.id);
    expect(job).toBeTruthy();
    const status = (await admin('GET', `${S()}/pos/status`)).json();
    expect(status.capabilities.submitOrder).toBe(true);
    expect(status.deadJobsByType['pos.submit_order']).toBeGreaterThanOrEqual(1);

    expect((await admin('POST', `${S()}/jobs/${job.id}/retry`)).statusCode).toBe(200);
    await runJobs();
    const [order] = await ctx.db.select().from(orders).where(eq(orders.id, placed.id));
    expect(order!.posSyncStatus).toBe('synced');
  });
});
