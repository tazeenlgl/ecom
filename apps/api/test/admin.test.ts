import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLogs } from '../src/db/schema.js';
import { adminToken, bearer, seedStore, setupTestApp, type TestContext } from './helpers.js';

let ctx: TestContext;
let alpha: Awaited<ReturnType<typeof seedStore>>;
let beta: Awaited<ReturnType<typeof seedStore>>;
let owner: string;
let alphaManager: string;
let alphaSupport: string;

beforeAll(async () => {
  ctx = await setupTestApp();
  alpha = await seedStore(ctx.db, 'alpha');
  beta = await seedStore(ctx.db, 'beta');
  owner = (await adminToken(ctx, 'owner@example.com', [{ role: 'platform_owner', storeId: null }])).token;
  alphaManager = (await adminToken(ctx, 'manager@example.com', [{ role: 'store_manager', storeId: alpha.store.id }])).token;
  alphaSupport = (await adminToken(ctx, 'support@example.com', [{ role: 'support', storeId: alpha.store.id }])).token;
});
afterAll(async () => ctx?.close());

const admin = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, token: string | null, payload?: unknown) =>
  ctx.app.inject({ method, url: `/v1/admin${url}`, headers: token ? bearer(token) : {}, ...(payload ? { payload: payload as object } : {}) });

describe('admin authentication', () => {
  it('rejects missing and wrong credentials without revealing which', async () => {
    expect((await admin('GET', '/me', null)).statusCode).toBe(401);
    const res = await ctx.app.inject({ method: 'POST', url: '/v1/admin/auth/login', payload: { email: 'owner@example.com', password: 'wrong password!' } });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.message).toBe('Email or password is incorrect.');
  });

  it('never returns password hashes', async () => {
    const res = await admin('GET', '/admin-users', owner);
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('scrypt$');
  });
});

describe('permissions and tenant isolation', () => {
  it('limits a store admin to their own store', async () => {
    expect((await admin('GET', `/stores/${alpha.store.id}`, alphaManager)).statusCode).toBe(200);
    expect((await admin('GET', `/stores/${beta.store.id}`, alphaManager)).statusCode).toBe(403);
    const list = await admin('GET', '/stores', alphaManager);
    expect(list.json().items.map((s: { id: string }) => s.id)).toEqual([alpha.store.id]);
  });

  it('blocks platform operations for store admins', async () => {
    expect((await admin('POST', '/brands', alphaManager, { slug: 'x', name: 'X' })).statusCode).toBe(403);
    expect((await admin('POST', `/stores/${alpha.store.id}/domains`, alphaManager, { hostname: 'new.example.in' })).statusCode).toBe(403);
    expect((await admin('PATCH', `/stores/${alpha.store.id}`, alphaManager, { status: 'disabled' })).statusCode).toBe(403);
  });

  it('blocks writes for read-only roles', async () => {
    expect((await admin('POST', `/stores/${alpha.store.id}/categories`, alphaSupport, { slug: 'shirts', name: 'Shirts' })).statusCode).toBe(403);
    expect((await admin('GET', `/stores/${alpha.store.id}/orders`, alphaSupport)).statusCode).toBe(200);
  });

  it('returns 404 for another store’s records addressed through this store’s path', async () => {
    const betaProduct = await admin('POST', `/stores/${beta.store.id}/products`, owner, { slug: 'beta-mug', title: 'Beta Mug' });
    expect(betaProduct.statusCode).toBe(201);
    const id = betaProduct.json().product.id;
    expect((await admin('GET', `/stores/${alpha.store.id}/products/${id}`, alphaManager)).statusCode).toBe(404);
    expect((await admin('PATCH', `/stores/${alpha.store.id}/products/${id}`, alphaManager, { title: 'Hijacked' })).statusCode).toBe(404);
    expect((await admin('POST', `/stores/${alpha.store.id}/products/${id}/variants`, alphaManager, { skuCode: 'X1', title: 'X' })).statusCode).toBe(404);
    // Attaching another store's category to this store's product is rejected too.
    const betaCat = await admin('POST', `/stores/${beta.store.id}/categories`, owner, { slug: 'mugs', name: 'Mugs' });
    const alphaProduct = await admin('POST', `/stores/${alpha.store.id}/products`, alphaManager, { slug: 'tee', title: 'Tee', categoryIds: [betaCat.json().category.id] });
    expect(alphaProduct.statusCode).toBe(404);
  });
});

describe('domains', () => {
  it('verifies a domain only when the TXT record matches, and audits it', async () => {
    const add = await admin('POST', `/stores/${alpha.store.id}/domains`, owner, { hostname: 'Shop.Alpha-Brand.IN' });
    expect(add.statusCode).toBe(201);
    const domain = add.json().domain;
    expect(domain.hostname).toBe('shop.alpha-brand.in');
    expect(domain.verifiedAt).toBeNull();

    const notYet = await ctx.app.inject({ method: 'GET', url: '/v1/storefront/store', headers: { host: 'shop.alpha-brand.in' } });
    expect(notYet.statusCode).toBe(404);

    const fail = await admin('POST', `/stores/${alpha.store.id}/domains/${domain.id}/verify`, owner, {});
    expect(fail.statusCode).toBe(409);

    ctx.dns.records.set('_ecom-verify.shop.alpha-brand.in', [domain.verificationToken]);
    const ok = await admin('POST', `/stores/${alpha.store.id}/domains/${domain.id}/verify`, owner, {});
    expect(ok.statusCode).toBe(200);

    const live = await ctx.app.inject({ method: 'GET', url: '/v1/storefront/store', headers: { host: 'shop.alpha-brand.in' } });
    expect(live.json().store.slug).toBe('alpha');

    const audit = await ctx.db.select().from(auditLogs).where(and(eq(auditLogs.entityId, domain.id), eq(auditLogs.action, 'domain.verify')));
    expect(audit).toHaveLength(1);
  });

  it('refuses a hostname that already belongs to another store', async () => {
    const res = await admin('POST', `/stores/${beta.store.id}/domains`, owner, { hostname: 'alpha.example.in' });
    expect(res.statusCode).toBe(409);
  });

  it('a disabled store stops resolving', async () => {
    const store = await seedStore(ctx.db, 'gamma');
    expect((await admin('PATCH', `/stores/${store.store.id}`, owner, { status: 'disabled' })).statusCode).toBe(200);
    const res = await ctx.app.inject({ method: 'GET', url: '/v1/storefront/store', headers: { host: store.host } });
    expect(res.statusCode).toBe(404);
  });
});

describe('catalogue validation', () => {
  it('validates attribute values against store definitions', async () => {
    const s = alpha.store.id;
    await admin('POST', `/stores/${s}/attributes`, alphaManager, { code: 'size', label: 'Size', type: 'select', scope: 'variant', options: ['S', 'M', 'L'] });
    await admin('POST', `/stores/${s}/attributes`, alphaManager, { code: 'fabric', label: 'Fabric', type: 'text', scope: 'product' });
    const p = await admin('POST', `/stores/${s}/products`, alphaManager, { slug: 'kurta', title: 'Kurta', attributes: { fabric: 'Cotton' } });
    expect(p.statusCode).toBe(201);
    const bad = await admin('POST', `/stores/${s}/products`, alphaManager, { slug: 'kurta-2', title: 'Kurta 2', attributes: { colour: 'Red' } });
    expect(bad.statusCode).toBe(400);
    const id = p.json().product.id;
    expect((await admin('POST', `/stores/${s}/products/${id}/variants`, alphaManager, { skuCode: 'KUR-XL', title: 'XL', options: { size: 'XL' } })).statusCode).toBe(400);
    expect((await admin('POST', `/stores/${s}/products/${id}/variants`, alphaManager, { skuCode: 'KUR-M', title: 'M', options: { size: 'M' } })).statusCode).toBe(201);
    // SKU codes are unique per store.
    expect((await admin('POST', `/stores/${s}/products/${id}/variants`, alphaManager, { skuCode: 'KUR-M', title: 'M again' })).statusCode).toBe(409);
  });

  it('refuses to publish a product without a priced active variant, and rejects price above MRP', async () => {
    const s = alpha.store.id;
    const p = await admin('POST', `/stores/${s}/products`, alphaManager, { slug: 'dupatta', title: 'Dupatta' });
    const id = p.json().product.id;
    expect((await admin('POST', `/stores/${s}/products/${id}/status`, alphaManager, { status: 'published' })).statusCode).toBe(409);
    const v = await admin('POST', `/stores/${s}/products/${id}/variants`, alphaManager, { skuCode: 'DUP-1', title: 'Free size' });
    const variantId = v.json().variant.id;
    expect((await admin('PUT', `/stores/${s}/variants/${variantId}/price`, alphaManager, { mrpPaise: 1000, pricePaise: 2000 })).statusCode).toBe(400);
    expect((await admin('PUT', `/stores/${s}/variants/${variantId}/price`, alphaManager, { mrpPaise: 99900, pricePaise: 79900 })).statusCode).toBe(200);
    expect((await admin('PUT', `/stores/${s}/variants/${variantId}/price`, alphaManager, { mrpPaise: 99900, pricePaise: 69900 })).statusCode).toBe(200);
    expect((await admin('GET', `/stores/${s}/variants/${variantId}/price-history`, alphaManager)).json().items).toHaveLength(2);
    expect((await admin('POST', `/stores/${s}/products/${id}/status`, alphaManager, { status: 'published' })).statusCode).toBe(200);
  });
});

describe('API conventions', () => {
  it('validation errors use the standard error shape', async () => {
    const res = await admin('POST', `/stores/${alpha.store.id}/categories`, alphaManager, { slug: 'Not A Slug', name: '' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('invalid_request');
    expect(Array.isArray(res.json().error.details)).toBe(true);
  });

  it('echoes a well-formed request id and sets no-store', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/health/live', headers: { 'x-request-id': 'abc12345-test' } });
    expect(res.headers['x-request-id']).toBe('abc12345-test');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('publishes an OpenAPI document covering every route with permissions', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/v1/openapi.json' });
    expect(res.statusCode).toBe(200);
    const doc = res.json();
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.paths['/v1/storefront/checkout/orders'].post.parameters.some((p: { name: string }) => p.name === 'Idempotency-Key')).toBe(true);
    expect(doc.paths['/v1/admin/stores/{storeId}/orders/{id}/refunds'].post['x-permission']).toBe('refunds.manage');
  });
});
