import { and, eq, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLogs, customerSessions, customers, orders } from '../src/db/schema.js';
import { jobHandlers } from '../src/modules/jobs/handlers.js';
import { runDueJobs } from '../src/modules/jobs/queue.js';
import { adminToken, bearer, customerToken, seedStore, setupTestApp, type TestContext } from './helpers.js';
import { InMemoryPosGateway } from './support/in-memory-pos.js';

let ctx: TestContext;
let alpha: Awaited<ReturnType<typeof seedStore>>;
let beta: Awaited<ReturnType<typeof seedStore>>;
const tok: Record<string, string> = {};
let variantId: string;
let n = 0;

const A = () => `/v1/admin/stores/${alpha.store.id}`;
const adminCall = (method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, token: string | null, payload?: unknown) =>
  ctx.app.inject({ method, url, headers: token ? bearer(token) : {}, ...(payload ? { payload: payload as object } : {}) });
const shop = (method: 'GET' | 'POST', url: string, headers: Record<string, string> = {}, payload?: unknown, host = alpha.host) =>
  ctx.app.inject({ method, url: `/v1/storefront${url}`, headers: { host, ...headers }, ...(payload ? { payload: payload as object } : {}) });
const runJobs = () => runDueJobs(ctx.db, jobHandlers(ctx.app.ctx), 'test-worker', 50, new Date(Date.now() + ctx.clock.offsetMs));
/** The test client is a trusted proxy, so each customer can come from its own address (OTP requests are limited per IP). */
const fresh = () => ({ 'x-forwarded-for': `198.51.100.${(n++ % 250) + 1}` });

/** A customer of `store` with a live session. */
async function newCustomer(host = alpha.host) {
  const phone = `97${String(30_000_000 + n++).slice(-8)}`;
  const token = await customerToken(ctx, host, phone, fresh());
  const [row] = await ctx.db.select().from(customers).where(eq(customers.phone, `+91${phone}`));
  return { phone, token, id: row!.id, row: row! };
}
const block = (token: string | null, id: string, status: 'blocked' | 'active', reason = 'Repeated fake orders', store = alpha) =>
  adminCall('PATCH', `/v1/admin/stores/${store.store.id}/customers/${id}`, token, { status, reason });
const auditFor = async (id: string) => (await ctx.db.select().from(auditLogs).where(and(eq(auditLogs.entityType, 'customer'), eq(auditLogs.entityId, id)))).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

beforeAll(async () => {
  const pos = new InMemoryPosGateway();
  ctx = await setupTestApp({ pos, config: { TRUST_PROXY: ['127.0.0.1'] } });
  alpha = await seedStore(ctx.db, 'alpha', { orderNumberPrefix: 'ALP', codMaxOrderPaise: 5_000_000 });
  beta = await seedStore(ctx.db, 'beta');
  tok.owner = (await adminToken(ctx, 'owner@example.com', [{ role: 'platform_owner', storeId: null }])).token;
  tok.manager = (await adminToken(ctx, 'manager@example.com', [{ role: 'store_manager', storeId: alpha.store.id }])).token;
  tok.support = (await adminToken(ctx, 'support@example.com', [{ role: 'support', storeId: alpha.store.id }])).token;
  tok.orders = (await adminToken(ctx, 'orders@example.com', [{ role: 'order_manager', storeId: alpha.store.id }])).token;
  tok.catalogue = (await adminToken(ctx, 'catalogue@example.com', [{ role: 'catalogue_editor', storeId: alpha.store.id }])).token;
  tok.betaManager = (await adminToken(ctx, 'beta-manager@example.com', [{ role: 'store_manager', storeId: beta.store.id }])).token;

  const product = (await adminCall('POST', `${A()}/products`, tok.owner!, { slug: 'kurta', title: 'Kurta', taxRateBps: 500 })).json().product;
  variantId = (await adminCall('POST', `${A()}/products/${product.id}/variants`, tok.owner!, { skuCode: 'K-M', title: 'M' })).json().variant.id;
  await adminCall('PUT', `${A()}/variants/${variantId}/price`, tok.owner!, { mrpPaise: 200_000, pricePaise: 100_000 });
  await adminCall('POST', `${A()}/products/${product.id}/status`, tok.owner!, { status: 'published' });
  await adminCall('POST', `${A()}/shipping-zones`, tok.owner!, { name: 'Karnataka', pincodePrefixes: ['56'], chargePaise: 4_900, codAvailable: true, codFeePaise: 2_000 });
  pos.stock.set('K-M', 50);
  await adminCall('POST', `${A()}/pos/stock-sync`, tok.owner!);
  await runJobs();
});
afterAll(async () => ctx?.close());

describe('who may block a customer', () => {
  it('only roles that hold customers.manage: platform owner and store manager', async () => {
    const roles = (await adminCall('GET', '/v1/admin/roles', tok.owner!)).json().items as { key: string; permissions: string[] }[];
    expect(roles.filter((r) => r.permissions.includes('customers.manage')).map((r) => r.key).sort()).toEqual(['platform_owner', 'store_manager']);
  });

  it('allows a store manager and the platform owner', async () => {
    const c = await newCustomer();
    expect((await block(tok.manager!, c.id, 'blocked')).statusCode).toBe(200);
    expect((await block(tok.owner!, c.id, 'active')).statusCode).toBe(200);
  });

  it.each(['support', 'orders', 'catalogue'])('refuses %s (403) and changes nothing', async (who) => {
    const c = await newCustomer();
    expect((await block(tok[who]!, c.id, 'blocked')).statusCode).toBe(403);
    expect((await ctx.db.select().from(customers).where(eq(customers.id, c.id)))[0]!.status).toBe('active');
    expect(await auditFor(c.id)).toHaveLength(0);
  });

  it('refuses anonymous callers (401) and customers (401)', async () => {
    const c = await newCustomer();
    expect((await block(null, c.id, 'blocked')).statusCode).toBe(401);
    expect((await block(c.token, c.id, 'blocked')).statusCode).toBe(401);
  });
});

describe('store isolation', () => {
  it("refuses another store's manager (403), and another store's path cannot reach this store's customer (404)", async () => {
    const c = await newCustomer();
    expect((await block(tok.betaManager!, c.id, 'blocked', 'x reason', alpha)).statusCode).toBe(403);
    expect((await block(tok.betaManager!, c.id, 'blocked', 'x reason', beta)).statusCode).toBe(404);
    expect((await block(tok.owner!, c.id, 'blocked', 'x reason', beta)).statusCode).toBe(404);
    expect((await ctx.db.select().from(customers).where(eq(customers.id, c.id)))[0]!.status).toBe('active');
  });

  it('blocking someone in one store leaves the same phone number in another store untouched', async () => {
    const phone = `96${String(30_000_000 + n++).slice(-8)}`;
    const inAlpha = await customerToken(ctx, alpha.host, phone, fresh());
    const inBeta = await customerToken(ctx, beta.host, phone, fresh());
    const [row] = await ctx.db.select().from(customers).where(and(eq(customers.storeId, alpha.store.id), eq(customers.phone, `+91${phone}`)));
    expect((await block(tok.manager!, row!.id, 'blocked')).statusCode).toBe(200);
    expect((await shop('GET', '/me', bearer(inAlpha))).statusCode).toBe(401);
    expect((await shop('GET', '/me', bearer(inBeta), undefined, beta.host)).statusCode).toBe(200);
  });
});

describe('input', () => {
  it.each([
    ['no reason', { status: 'blocked' }],
    ['a two-character reason', { status: 'blocked', reason: 'ab' }],
    ['a blank reason', { status: 'blocked', reason: '     ' }],
    ['a 501-character reason', { status: 'blocked', reason: 'x'.repeat(501) }],
    ['an unknown status', { status: 'deleted', reason: 'valid reason' }],
    ['no status', { reason: 'valid reason' }],
  ])('rejects %s with 400', async (_label, payload) => {
    const c = await newCustomer();
    expect((await adminCall('PATCH', `${A()}/customers/${c.id}`, tok.manager!, payload)).statusCode).toBe(400);
    expect((await ctx.db.select().from(customers).where(eq(customers.id, c.id)))[0]!.status).toBe('active');
  });

  it('rejects a malformed id and returns 404 for an unknown customer', async () => {
    expect((await adminCall('PATCH', `${A()}/customers/not-a-uuid`, tok.manager!, { status: 'blocked', reason: 'valid reason' })).statusCode).toBe(400);
    expect((await block(tok.manager!, '00000000-0000-4000-8000-000000000000', 'blocked')).statusCode).toBe(404);
  });

  it('accepts a reason of exactly 3 and exactly 500 characters, trimmed', async () => {
    const c = await newCustomer();
    expect((await block(tok.manager!, c.id, 'blocked', '  abc  ')).statusCode).toBe(200);
    expect((await block(tok.manager!, c.id, 'active', 'y'.repeat(500))).statusCode).toBe(200);
    expect((await auditFor(c.id)).map((a) => (a.changes as { reason: string }).reason.length)).toEqual([3, 500]);
  });
});

describe('what blocking does', () => {
  it('ends every live session at once, and the revoked sessions stay revoked after unblocking', async () => {
    const c = await newCustomer();
    // A second live session for the same customer.
    ctx.clock.offsetMs += 31_000;
    const second = await customerToken(ctx, alpha.host, c.phone, fresh());
    expect((await shop('GET', '/me', bearer(c.token))).statusCode).toBe(200);
    expect((await shop('GET', '/me', bearer(second))).statusCode).toBe(200);

    const res = await block(tok.manager!, c.id, 'blocked');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ changed: true, revokedSessions: 2, customer: { id: c.id, status: 'blocked' } });
    for (const t of [c.token, second]) {
      expect((await shop('GET', '/me', bearer(t))).statusCode).toBe(401);
      expect((await shop('GET', '/cart', bearer(t))).statusCode).toBe(401);
    }
    expect(await ctx.db.select().from(customerSessions).where(and(eq(customerSessions.customerId, c.id), isNull(customerSessions.revokedAt)))).toHaveLength(0);

    // Unblocking does not bring the old sessions back.
    expect((await block(tok.manager!, c.id, 'active', 'Resolved with the customer')).statusCode).toBe(200);
    expect((await shop('GET', '/me', bearer(c.token))).statusCode).toBe(401);
    expect((await shop('GET', '/me', bearer(second))).statusCode).toBe(401);
  });

  it('blocks sign-in while blocked (no code is sent, password login is refused) and allows a fresh sign-in after unblocking', async () => {
    const c = await newCustomer();
    const setPassword = await ctx.app.inject({ method: 'PUT', url: '/v1/storefront/me/password', headers: { host: alpha.host, ...bearer(c.token) }, payload: { newPassword: 'a good long password' } });
    expect(setPassword.statusCode).toBe(204);
    expect((await block(tok.manager!, c.id, 'blocked')).statusCode).toBe(200);

    ctx.clock.offsetMs += 31_000;
    const before = ctx.messages.outbox.filter((m) => m.to === c.phone || m.to === `+91${c.phone}`).length;
    const otp = await ctx.app.inject({ method: 'POST', url: '/v1/storefront/auth/otp/request', headers: { host: alpha.host, ...fresh() }, payload: { phone: c.phone } });
    expect(otp.statusCode).toBe(200); // same answer as for anyone: nothing reveals the block
    expect(ctx.messages.outbox.filter((m) => m.to === c.phone || m.to === `+91${c.phone}`).length).toBe(before);

    const pw = await ctx.app.inject({ method: 'POST', url: '/v1/storefront/auth/password/login', headers: { host: alpha.host, ...fresh() }, payload: { phone: c.phone, password: 'a good long password' } });
    const wrong = await ctx.app.inject({ method: 'POST', url: '/v1/storefront/auth/password/login', headers: { host: alpha.host, ...fresh() }, payload: { phone: c.phone, password: 'definitely wrong pass' } });
    expect(pw.statusCode).toBe(401);
    expect(pw.json()).toEqual(wrong.json()); // indistinguishable from a wrong password

    expect((await block(tok.manager!, c.id, 'active', 'Account verified again')).statusCode).toBe(200);
    ctx.clock.offsetMs += 31_000;
    const again = await customerToken(ctx, alpha.host, c.phone, fresh());
    expect((await shop('GET', '/me', bearer(again))).statusCode).toBe(200);
    const login = await ctx.app.inject({ method: 'POST', url: '/v1/storefront/auth/password/login', headers: { host: alpha.host, ...fresh() }, payload: { phone: c.phone, password: 'a good long password' } });
    expect(login.statusCode).toBe(200);
  });

  it('keeps existing orders and shows them to staff', async () => {
    const c = await newCustomer();
    const address = (await shop('POST', '/me/addresses', bearer(c.token), { name: 'B', phone: c.phone, line1: '1 MG Road', city: 'Bengaluru', state: 'Karnataka', pincode: '560001' })).json().address.id as string;
    await shop('POST', '/cart/items', bearer(c.token), { variantId, quantity: 1 });
    const quote = (await shop('POST', '/checkout/quote', bearer(c.token), { addressId: address, paymentMethod: 'cod' })).json().quote;
    const placed = (await shop('POST', '/checkout/orders', { ...bearer(c.token), 'idempotency-key': `blk-${c.phone}` }, { addressId: address, paymentMethod: 'cod', expectedTotalPaise: quote.totalPaise })).json().order;

    expect((await block(tok.manager!, c.id, 'blocked')).statusCode).toBe(200);
    const [row] = await ctx.db.select().from(orders).where(eq(orders.customerId, c.id));
    expect(row).toMatchObject({ orderNumber: placed.orderNumber, status: 'confirmed' });
    const detail = await adminCall('GET', `${A()}/orders/${placed.id}`, tok.manager!);
    expect(detail.statusCode).toBe(200);
    const listed = await adminCall('GET', `${A()}/customers?phone=${c.phone}`, tok.manager!);
    expect(listed.json().items[0]).toMatchObject({ id: c.id, status: 'blocked' });
    // The blocked customer can no longer see or cancel it through the storefront.
    expect((await shop('GET', `/orders/${placed.orderNumber}`, bearer(c.token))).statusCode).toBe(401);
  });
});

describe('audit trail and repeats', () => {
  it('records who, what and why, with the reason only in the audit log', async () => {
    const c = await newCustomer();
    await block(tok.manager!, c.id, 'blocked', 'Chargeback abuse');
    await block(tok.owner!, c.id, 'active', 'Cleared after review');
    const [b, u] = await auditFor(c.id);
    expect(b).toMatchObject({ action: 'customer.block', storeId: alpha.store.id, actorType: 'admin', entityType: 'customer' });
    expect(b!.changes).toMatchObject({ from: 'active', to: 'blocked', reason: 'Chargeback abuse', revokedSessions: 1 });
    expect(u).toMatchObject({ action: 'customer.unblock', actorType: 'admin' });
    expect(u!.changes).toMatchObject({ from: 'blocked', to: 'active', reason: 'Cleared after review' });
    expect(b!.actorId).not.toBe(u!.actorId);
    // The customer row itself carries no reason column.
    expect(Object.keys((await ctx.db.select().from(customers).where(eq(customers.id, c.id)))[0]!)).not.toContain('blockReason');
    // Visible to administrators who may read the audit log.
    const log = await adminCall('GET', `${A()}/audit-logs?entityType=customer&entityId=${c.id}`, tok.manager!);
    expect(log.json().items.map((i: { action: string }) => i.action).sort()).toEqual(['customer.block', 'customer.unblock']);
  });

  it('is idempotent: repeating the same state changes nothing and adds no audit entry', async () => {
    const c = await newCustomer();
    expect((await block(tok.manager!, c.id, 'active')).json()).toMatchObject({ changed: false });
    expect(await auditFor(c.id)).toHaveLength(0);
    expect((await block(tok.manager!, c.id, 'blocked')).json()).toMatchObject({ changed: true });
    expect((await block(tok.manager!, c.id, 'blocked')).json()).toMatchObject({ changed: false, revokedSessions: 0 });
    expect(await auditFor(c.id)).toHaveLength(1);
  });

  it('serialises two administrators acting at the same moment', async () => {
    const c = await newCustomer();
    const [x, y] = await Promise.all([block(tok.manager!, c.id, 'blocked', 'first admin'), block(tok.owner!, c.id, 'blocked', 'second admin')]);
    expect([x.json().changed, y.json().changed].sort()).toEqual([false, true]);
    expect(await auditFor(c.id)).toHaveLength(1);
  });
});
