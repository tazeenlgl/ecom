import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { customerAddresses, customers, refunds } from '../src/db/schema.js';
import { cancelRefundPaise } from '../src/modules/orders/eligibility.js';
import { jobHandlers } from '../src/modules/jobs/handlers.js';
import { runDueJobs } from '../src/modules/jobs/queue.js';
import { adminToken, bearer, customerToken, seedStore, setupTestApp, type TestContext } from './helpers.js';
import { InMemoryPosGateway } from './support/in-memory-pos.js';

let ctx: TestContext;
let alpha: Awaited<ReturnType<typeof seedStore>>;
let beta: Awaited<ReturnType<typeof seedStore>>;
let owner: string;
let variantId = '';
let seq = 0;

const S = () => `/v1/admin/stores/${alpha.store.id}`;
const admin = (method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, payload?: unknown) => ctx.app.inject({ method, url, headers: bearer(owner), ...(payload ? { payload: payload as object } : {}) });
const shop = (host: string, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, token?: string, payload?: unknown, headers: Record<string, string> = {}) =>
  ctx.app.inject({ method, url: `/v1/storefront${url}`, headers: { host, ...(token ? bearer(token) : {}), ...headers }, ...(payload ? { payload: payload as object } : {}) });
const runJobs = () => runDueJobs(ctx.db, jobHandlers(ctx.app.ctx), 'test-worker', 50, new Date(Date.now() + ctx.clock.offsetMs));

const address = (n: number) => ({ name: 'A Customer', phone: '9876543210', line1: `${n} MG Road`, city: 'Chennai', state: 'Tamil Nadu', pincode: '600001' });
const nextPhone = () => `96${String(10_000_000 + seq++).slice(-8)}`;
const signIn = (host = alpha.host) => customerToken(ctx, host, nextPhone());
const addAddress = (token: string, n: number, extra: object = {}, host = alpha.host) => shop(host, 'POST', '/me/addresses', token, { ...address(n), ...extra });
const listAddresses = async (token: string, host = alpha.host) => (await shop(host, 'GET', '/me/addresses', token)).json().items as { id: string; isDefault: boolean; line1: string }[];
const defaults = <T extends { isDefault: boolean }>(items: T[]) => items.filter((a) => a.isDefault);

beforeAll(async () => {
  const pos = new InMemoryPosGateway();
  ctx = await setupTestApp({ pos });
  alpha = await seedStore(ctx.db, 'alpha', { codEnabled: true, codMaxOrderPaise: 5_000_000 });
  beta = await seedStore(ctx.db, 'beta');
  owner = (await adminToken(ctx, 'owner@example.com', [{ role: 'platform_owner', storeId: null }])).token;
  const product = (await admin('POST', `${S()}/products`, { slug: 'saree', title: 'Saree' })).json().product;
  variantId = (await admin('POST', `${S()}/products/${product.id}/variants`, { skuCode: 'SAR-1', title: 'One size' })).json().variant.id;
  await admin('PUT', `${S()}/variants/${variantId}/price`, { mrpPaise: 500_000, pricePaise: 450_000 });
  await admin('POST', `${S()}/products/${product.id}/status`, { status: 'published' });
  await admin('POST', `${S()}/shipping-zones`, { name: 'TN', pincodePrefixes: ['600'], chargePaise: 0, codAvailable: true, codFeePaise: 0 });
  pos.stock.set('SAR-1', 100);
  await admin('POST', `${S()}/pos/stock-sync`);
  await runJobs();
});
afterAll(async () => ctx?.close());

describe('PATCH /me', () => {
  it('rejects a request with nothing to update (400, no server error)', async () => {
    const token = await signIn();
    for (const payload of [{}, { unknown: 'x' }]) {
      const res = await shop(alpha.host, 'PATCH', '/me', token, payload);
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('invalid_request');
    }
  });

  it('rejects a blank name and a malformed email', async () => {
    const token = await signIn();
    expect((await shop(alpha.host, 'PATCH', '/me', token, { name: '   ' })).statusCode).toBe(400);
    expect((await shop(alpha.host, 'PATCH', '/me', token, { email: 'not-an-email' })).statusCode).toBe(400);
  });

  it('trims the name, lower-cases the email, and updates one field without touching the other', async () => {
    const token = await signIn();
    const both = await shop(alpha.host, 'PATCH', '/me', token, { name: '  Asha Rao ', email: ' Asha@Example.COM ' });
    expect(both.statusCode).toBe(200);
    expect(both.json().customer).toMatchObject({ name: 'Asha Rao', email: 'asha@example.com' });
    const nameOnly = await shop(alpha.host, 'PATCH', '/me', token, { name: 'Asha R' });
    expect(nameOnly.json().customer).toMatchObject({ name: 'Asha R', email: 'asha@example.com' });
    const cleared = await shop(alpha.host, 'PATCH', '/me', token, { email: null });
    expect(cleared.json().customer).toMatchObject({ name: 'Asha R', email: null });
  });
});

describe('PUT /me/password', () => {
  const put = (token: string, payload: object) => shop(alpha.host, 'PUT', '/me/password', token, payload);

  it('answers a wrong current password with 422 and keeps the session valid', async () => {
    const token = await signIn();
    expect((await put(token, { newPassword: 'first-password' })).statusCode).toBe(204);
    const wrong = await put(token, { currentPassword: 'wrong-password', newPassword: 'second-password' });
    expect(wrong.statusCode).toBe(422);
    expect(wrong.json().error).toMatchObject({ code: 'invalid_request', details: { field: 'currentPassword' } });
    // The same session still works, and the password did not change.
    expect((await shop(alpha.host, 'GET', '/me', token)).statusCode).toBe(200);
    const customer = (await shop(alpha.host, 'GET', '/me', token)).json().customer;
    const login = await shop(alpha.host, 'POST', '/auth/password/login', undefined, { phone: customer.phone, password: 'first-password' });
    expect(login.statusCode).toBe(200);
  });

  it('changes the password with the right current one, keeps this session and signs the others out', async () => {
    const phone = nextPhone();
    const first = await customerToken(ctx, alpha.host, phone);
    expect((await put(first, { newPassword: 'first-password' })).statusCode).toBe(204);
    const second = (await shop(alpha.host, 'POST', '/auth/password/login', undefined, { phone, password: 'first-password' })).json().token as string;
    expect((await put(second, { currentPassword: 'first-password', newPassword: 'second-password' })).statusCode).toBe(204);
    expect((await shop(alpha.host, 'GET', '/me', second)).statusCode).toBe(200);
    expect((await shop(alpha.host, 'GET', '/me', first)).statusCode).toBe(401);
  });

  it('requires a new password of at least 8 characters', async () => {
    const token = await signIn();
    expect((await put(token, { newPassword: 'short' })).statusCode).toBe(400);
  });
});

describe('address default invariant', () => {
  it('makes the first address the default, even when the client asks for isDefault false', async () => {
    const token = await signIn();
    const first = await addAddress(token, 1, { isDefault: false });
    expect(first.statusCode).toBe(201);
    expect(first.json().address.isDefault).toBe(true);
    const second = await addAddress(token, 2);
    expect(second.json().address.isDefault).toBe(false);
    expect(defaults(await listAddresses(token))).toHaveLength(1);
  });

  it('moves the default when another address is made the default', async () => {
    const token = await signIn();
    const a = (await addAddress(token, 1)).json().address;
    const b = (await addAddress(token, 2)).json().address;
    const res = await shop(alpha.host, 'PATCH', `/me/addresses/${b.id}`, token, { isDefault: true });
    expect(res.json().address.isDefault).toBe(true);
    const items = await listAddresses(token);
    expect(defaults(items).map((x) => x.id)).toEqual([b.id]);
    expect(items.find((x) => x.id === a.id)!.isDefault).toBe(false);
  });

  it('ignores isDefault false on the current default', async () => {
    const token = await signIn();
    const a = (await addAddress(token, 1)).json().address;
    await addAddress(token, 2);
    const res = await shop(alpha.host, 'PATCH', `/me/addresses/${a.id}`, token, { isDefault: false, city: 'Madurai' });
    expect(res.statusCode).toBe(200);
    expect(res.json().address).toMatchObject({ isDefault: true, city: 'Madurai' });
    expect(defaults(await listAddresses(token))).toHaveLength(1);
  });

  it('accepts an update that changes nothing (no server error)', async () => {
    const token = await signIn();
    const a = (await addAddress(token, 1)).json().address;
    const res = await shop(alpha.host, 'PATCH', `/me/addresses/${a.id}`, token, {});
    expect(res.statusCode).toBe(200);
    expect(res.json().address.id).toBe(a.id);
  });

  it('promotes the newest remaining address when the default is deleted', async () => {
    const token = await signIn();
    const a = (await addAddress(token, 1)).json().address;
    const b = (await addAddress(token, 2)).json().address;
    const c = (await addAddress(token, 3)).json().address;
    expect(defaults(await listAddresses(token)).map((x) => x.id)).toEqual([a.id]);
    expect((await shop(alpha.host, 'DELETE', `/me/addresses/${a.id}`, token)).statusCode).toBe(204);
    const items = await listAddresses(token);
    expect(items).toHaveLength(2);
    expect(defaults(items).map((x) => x.id)).toEqual([c.id]);
    expect(items.some((x) => x.id === b.id && !x.isDefault)).toBe(true);
  });

  it('leaves the default alone when a non-default address is deleted, and allows deleting the last one', async () => {
    const token = await signIn();
    const a = (await addAddress(token, 1)).json().address;
    const b = (await addAddress(token, 2)).json().address;
    expect((await shop(alpha.host, 'DELETE', `/me/addresses/${b.id}`, token)).statusCode).toBe(204);
    expect(defaults(await listAddresses(token)).map((x) => x.id)).toEqual([a.id]);
    expect((await shop(alpha.host, 'DELETE', `/me/addresses/${a.id}`, token)).statusCode).toBe(204);
    expect(await listAddresses(token)).toEqual([]);
    expect((await shop(alpha.host, 'DELETE', `/me/addresses/${a.id}`, token)).statusCode).toBe(404);
  });

  it("never touches another customer's or another store's addresses", async () => {
    const mine = await signIn();
    const theirs = await signIn();
    const otherStore = await customerToken(ctx, beta.host, nextPhone());
    const a = (await addAddress(mine, 1)).json().address;
    const b = (await addAddress(theirs, 2)).json().address;
    expect((await shop(alpha.host, 'DELETE', `/me/addresses/${b.id}`, mine)).statusCode).toBe(404);
    expect((await shop(alpha.host, 'PATCH', `/me/addresses/${b.id}`, mine, { isDefault: true })).statusCode).toBe(404);
    expect((await shop(beta.host, 'DELETE', `/me/addresses/${a.id}`, otherStore)).statusCode).toBe(404);
    // Their default and list are unchanged.
    expect(defaults(await listAddresses(theirs)).map((x) => x.id)).toEqual([b.id]);
    expect(defaults(await listAddresses(mine)).map((x) => x.id)).toEqual([a.id]);
  });

  it('gives exactly one default when the first two addresses are saved at the same moment', async () => {
    const token = await signIn();
    const results = await Promise.all([addAddress(token, 1), addAddress(token, 2), addAddress(token, 3)]);
    expect(results.map((r) => r.statusCode)).toEqual([201, 201, 201]);
    const items = await listAddresses(token);
    expect(items).toHaveLength(3);
    expect(defaults(items)).toHaveLength(1);
  });

  it('repairs a customer who has addresses but no default, on their next write', async () => {
    const token = await signIn();
    const a = (await addAddress(token, 1)).json().address;
    await addAddress(token, 2);
    // Simulate data saved before this rule existed: no default at all.
    await ctx.db.update(customerAddresses).set({ isDefault: false }).where(eq(customerAddresses.customerId, a.customerId));
    expect(defaults(await listAddresses(token))).toHaveLength(0);
    await shop(alpha.host, 'PATCH', `/me/addresses/${a.id}`, token, { city: 'Salem' });
    expect(defaults(await listAddresses(token))).toHaveLength(1);
  });

  it('does not change what an existing order shows after its address is deleted', async () => {
    const token = await signIn();
    const a = (await addAddress(token, 1)).json().address;
    await shop(alpha.host, 'POST', '/cart/items', token, { variantId, quantity: 1 });
    const body = { addressId: a.id, paymentMethod: 'cod' };
    const quote = (await shop(alpha.host, 'POST', '/checkout/quote', token, body)).json().quote;
    const placed = await shop(alpha.host, 'POST', '/checkout/orders', token, { ...body, expectedTotalPaise: quote.totalPaise }, { 'idempotency-key': `acct-${seq}-addr-snap` });
    expect(placed.statusCode).toBe(201);
    await shop(alpha.host, 'DELETE', `/me/addresses/${a.id}`, token);
    const order = (await shop(alpha.host, 'GET', `/orders/${placed.json().order.orderNumber}`, token)).json().order;
    expect(order.shippingAddress).toMatchObject({ line1: '1 MG Road', pincode: '600001' });
  });
});

// Every sign-in asks for a code from the same test address, and the API allows 20 code requests per address per hour.
// Moving the test clock forward an hour starts a fresh window instead of weakening the limit.
const startFreshOtpWindow = () => {
  ctx.clock.offsetMs += 3_700_000;
};

describe('cancellation refund preview', () => {
  beforeAll(startFreshOtpWindow);

  it('cancelRefundPaise: only a collected online payment has something to refund', () => {
    expect(cancelRefundPaise({ paymentStatus: 'paid', totalPaise: 450_000, refundedPaise: 0 })).toBe(450_000);
    expect(cancelRefundPaise({ paymentStatus: 'paid', totalPaise: 450_000, refundedPaise: 50_000 })).toBe(400_000);
    expect(cancelRefundPaise({ paymentStatus: 'paid', totalPaise: 450_000, refundedPaise: 450_000 })).toBe(0);
    for (const paymentStatus of ['unpaid', 'pending', 'failed', 'cod_pending', 'cod_collected', 'refunded'] as const) {
      expect(cancelRefundPaise({ paymentStatus: paymentStatus as never, totalPaise: 450_000, refundedPaise: 0 })).toBe(0);
    }
  });

  async function placeOrder(method: 'cod' | 'online') {
    const token = await signIn();
    const a = (await addAddress(token, 1)).json().address;
    await shop(alpha.host, 'POST', '/cart/items', token, { variantId, quantity: 1 });
    const body = { addressId: a.id, paymentMethod: method };
    const quote = (await shop(alpha.host, 'POST', '/checkout/quote', token, body)).json().quote;
    const placed = await shop(alpha.host, 'POST', '/checkout/orders', token, { ...body, expectedTotalPaise: quote.totalPaise }, { 'idempotency-key': `acct-${method}-${seq++}-refund` });
    expect(placed.statusCode).toBe(201);
    return { token, order: placed.json().order };
  }

  it('shows no refund for a cash-on-delivery order, and cancelling creates none', async () => {
    const { token, order } = await placeOrder('cod');
    expect(order.actions).toMatchObject({ canCancel: true, cancelRefund: null });
    const res = await shop(alpha.host, 'POST', `/orders/${order.orderNumber}/cancel`, token, { reason: 'Changed my mind' });
    expect(res.statusCode).toBe(200);
    expect(res.json().order.actions.cancelRefund).toBeNull();
    expect(await ctx.db.select().from(refunds).where(eq(refunds.orderId, order.id))).toHaveLength(0);
  });

  it('shows no refund for an unpaid online order', async () => {
    const { order } = await placeOrder('online');
    expect(order).toMatchObject({ status: 'pending_payment', paymentStatus: 'unpaid' });
    expect(order.actions).toMatchObject({ canCancel: true, cancelRefund: null });
  });

  it('shows exactly the amount that cancelling a paid online order refunds', async () => {
    const { token, order } = await placeOrder('online');
    const pay = await shop(alpha.host, 'POST', `/orders/${order.orderNumber}/payments`, token);
    expect(pay.statusCode).toBe(201);
    const raw = JSON.stringify({ id: `evt_acct_${order.id}`, type: 'payment.succeeded', data: { providerRef: pay.json().payment.client.providerRef, amountPaise: pay.json().payment.amountPaise } });
    const hook = await ctx.app.inject({ method: 'POST', url: '/v1/webhooks/payments/fake', headers: { 'content-type': 'application/json', 'x-fake-signature': ctx.payment.sign(raw) }, payload: raw });
    expect(hook.json().outcome).toBe('applied');

    const view = (await shop(alpha.host, 'GET', `/orders/${order.orderNumber}`, token)).json().order;
    expect(view.paymentStatus).toBe('paid');
    expect(view.actions.cancelRefund).toEqual({ amountPaise: view.totalPaise });

    const res = await shop(alpha.host, 'POST', `/orders/${order.orderNumber}/cancel`, token, { reason: 'Changed my mind' });
    expect(res.statusCode).toBe(200);
    const [refund] = await ctx.db.select().from(refunds).where(eq(refunds.orderId, order.id));
    expect(refund!.amountPaise).toBe(view.actions.cancelRefund.amountPaise);
    // Once cancelled there is nothing left to offer.
    expect(res.json().order.actions).toMatchObject({ canCancel: false, cancelRefund: null });
  });
});

describe('store isolation of customer records', () => {
  beforeAll(startFreshOtpWindow);

  it('keeps the same phone number as separate customers in each store', async () => {
    const phone = nextPhone();
    await customerToken(ctx, alpha.host, phone);
    await customerToken(ctx, beta.host, phone);
    const rows = await ctx.db.select({ storeId: customers.storeId }).from(customers).where(and(eq(customers.phone, `+91${phone}`)));
    expect(new Set(rows.map((r) => r.storeId)).size).toBe(2);
  });
});
