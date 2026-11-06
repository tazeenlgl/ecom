import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { returnRequests } from '../src/db/schema.js';
import { jobHandlers } from '../src/modules/jobs/handlers.js';
import { runDueJobs } from '../src/modules/jobs/queue.js';
import { adminToken, bearer, customerToken, seedStore, setupTestApp, type TestContext } from './helpers.js';
import { InMemoryPosGateway } from './support/in-memory-pos.js';

let ctx: TestContext;
let alpha: Awaited<ReturnType<typeof seedStore>>;
let beta: Awaited<ReturnType<typeof seedStore>>;
let owner: string;
const v: Record<string, string> = {};
const productOf: Record<string, string> = {};
let n = 0;

const S = (store = alpha) => `/v1/admin/stores/${store.store.id}`;
const admin = (method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, payload?: unknown) => ctx.app.inject({ method, url, headers: bearer(owner), ...(payload ? { payload: payload as object } : {}) });
const shop = (method: 'GET' | 'POST', url: string, headers: Record<string, string> = {}, payload?: unknown, host = alpha.host) =>
  ctx.app.inject({ method, url: `/v1/storefront${url}`, headers: { host, ...headers }, ...(payload ? { payload: payload as object } : {}) });
const runJobs = () => runDueJobs(ctx.db, jobHandlers(ctx.app.ctx), 'test-worker', 50, new Date(Date.now() + ctx.clock.offsetMs));

async function makeProduct(store: typeof alpha, slug: string, variants: [key: string, sku: string][]) {
  const product = (await admin('POST', `${S(store)}/products`, { slug, title: slug, taxRateBps: 500 })).json().product;
  productOf[slug] = product.id;
  for (const [key, sku] of variants) {
    v[key] = (await admin('POST', `${S(store)}/products/${product.id}/variants`, { skuCode: sku, title: sku })).json().variant.id;
    await admin('PUT', `${S(store)}/variants/${v[key]}/price`, { mrpPaise: 199_900, pricePaise: 149_900 });
  }
  await admin('POST', `${S(store)}/products/${product.id}/status`, { status: 'published' });
  return product.id as string;
}

/** A customer with a DELIVERED COD order of one shirt (size M). */
async function deliveredOrder() {
  const phone = `98${String(20_000_000 + n++).slice(-8)}`;
  const token = await customerToken(ctx, alpha.host, phone, freshAddress());
  const addressRes = await shop('POST', '/me/addresses', bearer(token), { name: 'Buyer', phone, line1: '12 Residency Rd', city: 'Bengaluru', state: 'Karnataka', pincode: '560001' });
  expect(addressRes.statusCode, addressRes.body).toBe(201);
  const address = addressRes.json().address.id as string;
  const added = await shop('POST', '/cart/items', bearer(token), { variantId: v.shirtM, quantity: 2 });
  expect(added.statusCode, added.body).toBe(200);
  const quote = (await shop('POST', '/checkout/quote', bearer(token), { addressId: address, paymentMethod: 'cod' })).json().quote;
  const placedRes = await shop('POST', '/checkout/orders', { ...bearer(token), 'idempotency-key': `ret-${phone}` }, { addressId: address, paymentMethod: 'cod', expectedTotalPaise: quote.totalPaise });
  expect(placedRes.statusCode, placedRes.body).toBe(201);
  const placed = placedRes.json().order;
  const shipmentRes = await admin('POST', `${S()}/orders/${placed.id}/shipments`, { courier: 'manual', trackingNumber: `TRK-${placed.id.slice(0, 8)}` });
  expect(shipmentRes.statusCode, shipmentRes.body).toBeLessThan(300);
  const shipment = shipmentRes.json().shipment;
  for (const [status, at, id] of [['shipped', '2026-10-01T10:00:00Z', 's1'], ['delivered', '2026-10-02T10:00:00Z', 's2']] as const) {
    // External event ids are unique per store, so make them unique per order.
    expect((await admin('POST', `${S()}/shipments/${shipment.id}/events`, { status, occurredAt: at, externalEventId: `${id}-${placed.id}` })).statusCode).toBeLessThan(300);
  }
  return { token, orderNumber: placed.orderNumber as string, orderId: placed.id as string };
}
const freshAddress = () => ({ 'x-forwarded-for': `198.51.100.${(n % 250) + 1}` });
const getOrder = async (token: string, orderNumber: string) => (await shop('GET', `/orders/${orderNumber}`, bearer(token))).json().order;
const lineOf = async (token: string, orderNumber: string) => (await getOrder(token, orderNumber)).items[0].id as string;
const requestReturn = (token: string, orderNumber: string, body: unknown) => shop('POST', `/orders/${orderNumber}/returns`, bearer(token), body);

beforeAll(async () => {
  const pos = new InMemoryPosGateway();
  // The test client is a trusted proxy, so each test customer can come from its own address (OTP requests are limited per IP).
  ctx = await setupTestApp({ pos, config: { TRUST_PROXY: ['127.0.0.1'] } });
  alpha = await seedStore(ctx.db, 'alpha', { orderNumberPrefix: 'ALP', codMaxOrderPaise: 5_000_000 });
  beta = await seedStore(ctx.db, 'beta');
  owner = (await adminToken(ctx, 'owner@example.com', [{ role: 'platform_owner', storeId: null }])).token;
  await makeProduct(alpha, 'oxford-shirt', [['shirtM', 'SH-M'], ['shirtL', 'SH-L'], ['shirtXL', 'SH-XL']]);
  await makeProduct(alpha, 'linen-kurta', [['kurtaM', 'KU-M']]);
  await makeProduct(beta, 'beta-shirt', [['betaM', 'BS-M']]);
  await admin('POST', `${S()}/shipping-zones`, { name: 'Karnataka', pincodePrefixes: ['56'], chargePaise: 4_900, freeAbovePaise: 250_000, codAvailable: true, codFeePaise: 2_000 });
  pos.stock.set('SH-M', 50).set('SH-L', 50).set('SH-XL', 50).set('KU-M', 50);
  expect((await admin('POST', `${S()}/pos/stock-sync`)).statusCode).toBe(202);
  await runJobs();
});
afterAll(async () => ctx?.close());

describe('return window and eligibility flags', () => {
  it('canReturn is false before delivery, true after, and false once the 7-day window has closed', async () => {
    const phone = '9800077701';
    const token = await customerToken(ctx, alpha.host, phone, freshAddress());
    const address = (await shop('POST', '/me/addresses', bearer(token), { name: 'Buyer', phone, line1: '1 MG Road', city: 'Bengaluru', state: 'Karnataka', pincode: '560001' })).json().address.id as string;
    await shop('POST', '/cart/items', bearer(token), { variantId: v.shirtM, quantity: 1 });
    const quote = (await shop('POST', '/checkout/quote', bearer(token), { addressId: address, paymentMethod: 'cod' })).json().quote;
    const placed = (await shop('POST', '/checkout/orders', { ...bearer(token), 'idempotency-key': 'flag-order-1' }, { addressId: address, paymentMethod: 'cod', expectedTotalPaise: quote.totalPaise })).json().order;
    expect(placed.actions).toMatchObject({ canReturn: false, returnWindowEndsAt: null });
    const line = (await getOrder(token, placed.orderNumber)).items[0].id;
    expect((await requestReturn(token, placed.orderNumber, { type: 'return', reason: 'x', items: [{ orderItemId: line, quantity: 1 }] })).statusCode).toBe(409);

    const shipment = (await admin('POST', `${S()}/orders/${placed.id}/shipments`, { courier: 'manual' })).json().shipment;
    for (const [status, at, id] of [['shipped', '2026-10-01T10:00:00Z', 'd0'], ['delivered', '2026-10-02T10:00:00Z', 'd1']] as const) {
      expect((await admin('POST', `${S()}/shipments/${shipment.id}/events`, { status, occurredAt: at, externalEventId: id })).statusCode).toBeLessThan(300);
    }
    const delivered = await getOrder(token, placed.orderNumber);
    expect(delivered.actions.canReturn).toBe(true);
    expect(new Date(delivered.actions.returnWindowEndsAt).getTime()).toBeGreaterThan(Date.now() + 6 * 86_400_000);

    try {
      ctx.clock.offsetMs += 8 * 86_400_000;
      const late = await getOrder(token, placed.orderNumber);
      expect(late.actions.canReturn).toBe(false);
      const res = await requestReturn(token, placed.orderNumber, { type: 'return', reason: 'x', items: [{ orderItemId: line, quantity: 1 }] });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.message).toMatch(/window.*closed/);
    } finally {
      ctx.clock.offsetMs = 0;
    }
  });

  it('canReturn becomes false once every unit has been asked for, but reopens if the request is rejected', async () => {
    const o = await deliveredOrder();
    const line = await lineOf(o.token, o.orderNumber);
    expect((await getOrder(o.token, o.orderNumber)).actions.canReturn).toBe(true);
    const first = await requestReturn(o.token, o.orderNumber, { type: 'return', reason: 'Too big', items: [{ orderItemId: line, quantity: 1 }] });
    expect(first.statusCode).toBe(201);
    expect((await getOrder(o.token, o.orderNumber)).actions.canReturn).toBe(true); // 1 of 2 left
    const second = await requestReturn(o.token, o.orderNumber, { type: 'return', reason: 'Too big', items: [{ orderItemId: line, quantity: 1 }] });
    expect(second.statusCode).toBe(201);
    expect((await getOrder(o.token, o.orderNumber)).actions.canReturn).toBe(false);
    expect((await requestReturn(o.token, o.orderNumber, { type: 'return', reason: 'More', items: [{ orderItemId: line, quantity: 1 }] })).statusCode).toBe(422);
    await admin('POST', `${S()}/returns/${second.json().returnRequest.id}/status`, { to: 'rejected' });
    expect((await getOrder(o.token, o.orderNumber)).actions.canReturn).toBe(true);
  });

  it('does not accept the same order line twice in one request', async () => {
    const o = await deliveredOrder();
    const line = await lineOf(o.token, o.orderNumber);
    const res = await requestReturn(o.token, o.orderNumber, { type: 'return', reason: 'x', items: [{ orderItemId: line, quantity: 2 }, { orderItemId: line, quantity: 2 }] });
    expect(res.statusCode).toBe(422);
  });
});

describe('exchange replacement variant', () => {
  const exchange = (token: string, orderNumber: string, line: string, exchangeVariantId?: string, quantity = 1) =>
    requestReturn(token, orderNumber, { type: 'exchange', reason: 'Wrong size', items: [{ orderItemId: line, quantity, ...(exchangeVariantId ? { exchangeVariantId } : {}) }] });

  it('accepts another active variant of the same published product and stores it', async () => {
    const o = await deliveredOrder();
    const line = await lineOf(o.token, o.orderNumber);
    const res = await exchange(o.token, o.orderNumber, line, v.shirtL);
    expect(res.statusCode).toBe(201);
    const [row] = await ctx.db.select().from(returnRequests);
    expect(row).toBeDefined();
    expect(res.json().returnRequest.items).toEqual([{ orderItemId: line, quantity: 1, exchangeVariantId: v.shirtL }]);
  });

  it('requires a replacement for an exchange', async () => {
    const o = await deliveredOrder();
    expect((await exchange(o.token, o.orderNumber, await lineOf(o.token, o.orderNumber))).statusCode).toBe(422);
  });

  it('rejects a replacement on an ordinary return', async () => {
    const o = await deliveredOrder();
    const line = await lineOf(o.token, o.orderNumber);
    const res = await requestReturn(o.token, o.orderNumber, { type: 'return', reason: 'x', items: [{ orderItemId: line, quantity: 1, exchangeVariantId: v.shirtL }] });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toMatch(/only be chosen for an exchange/);
  });

  it.each([
    ['the variant that was ordered', () => v.shirtM],
    ['a variant of an unrelated product in the same store', () => v.kurtaM],
    ["another store's variant", () => v.betaM],
    ['an unknown variant id', () => '00000000-0000-4000-8000-000000000000'],
  ])('rejects %s with the same answer, revealing nothing', async (_label, pick) => {
    const o = await deliveredOrder();
    const res = await exchange(o.token, o.orderNumber, await lineOf(o.token, o.orderNumber), pick());
    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toMatch(/Choose an available replacement/);
    expect(res.body).not.toContain('beta');
  });

  it('rejects an inactive variant, then accepts it again once it is active', async () => {
    const o = await deliveredOrder();
    const line = await lineOf(o.token, o.orderNumber);
    await admin('PATCH', `${S()}/variants/${v.shirtXL}`, { status: 'inactive' });
    expect((await exchange(o.token, o.orderNumber, line, v.shirtXL)).statusCode).toBe(422);
    await admin('PATCH', `${S()}/variants/${v.shirtXL}`, { status: 'active' });
    expect((await exchange(o.token, o.orderNumber, line, v.shirtXL)).statusCode).toBe(201);
  });

  it('rejects a replacement while its product is not published', async () => {
    const o = await deliveredOrder();
    const line = await lineOf(o.token, o.orderNumber);
    await admin('POST', `${S()}/products/${productOf['oxford-shirt']}/status`, { status: 'draft' });
    expect((await exchange(o.token, o.orderNumber, line, v.shirtL)).statusCode).toBe(422);
    await admin('POST', `${S()}/products/${productOf['oxford-shirt']}/status`, { status: 'published' });
    expect((await exchange(o.token, o.orderNumber, line, v.shirtL)).statusCode).toBe(201);
  });

  it("offers exactly the eligible variants through exchange-options, and nothing from other products or stores", async () => {
    const o = await deliveredOrder();
    const line = await lineOf(o.token, o.orderNumber);
    const res = await shop('GET', `/orders/${o.orderNumber}/exchange-options`, bearer(o.token));
    expect(res.statusCode).toBe(200);
    const options = res.json().items.find((i: { orderItemId: string }) => i.orderItemId === line).variants as { id: string }[];
    expect(options.map((x) => x.id).sort()).toEqual([v.shirtL, v.shirtXL].sort());
    // Whatever the endpoint offers, the returns endpoint accepts.
    for (const option of options) expect((await exchange(o.token, o.orderNumber, line, option.id, 0 + 1)).statusCode).toBe(201);
  });

  it('protects exchange-options: own orders only, and signed-in customers only', async () => {
    const o = await deliveredOrder();
    const other = await customerToken(ctx, alpha.host, '9800077799');
    expect((await shop('GET', `/orders/${o.orderNumber}/exchange-options`, bearer(other))).statusCode).toBe(404);
    expect((await shop('GET', `/orders/${o.orderNumber}/exchange-options`)).statusCode).toBe(401);
    expect((await shop('GET', `/orders/${o.orderNumber}/exchange-options`, bearer(o.token), undefined, beta.host)).statusCode).toBe(401);
  });
});
