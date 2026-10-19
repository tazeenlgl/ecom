import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { brands, storeDomains, stores } from '../src/db/schema.js';
import { setupTestApp } from './helpers.js';

let ctx: Awaited<ReturnType<typeof setupTestApp>>;

beforeAll(async () => {
  ctx = await setupTestApp();
  const { db } = ctx;

  const [alpha, beta, archived] = await db
    .insert(brands)
    .values([
      { slug: 'alpha', name: 'Alpha Wear' },
      { slug: 'beta', name: 'Beta Home' },
      { slug: 'gone', name: 'Gone Brand', status: 'archived' },
    ])
    .returning();

  const [alphaStore, betaStore, maintStore, disabledStore, archivedStore] = await db
    .insert(stores)
    .values([
      { brandId: alpha!.id, slug: 'in', name: 'Alpha India', publicSettings: { theme: { primary: '#111111' } } },
      { brandId: beta!.id, slug: 'in', name: 'Beta India' },
      { brandId: beta!.id, slug: 'maint', name: 'Beta Maint', status: 'maintenance' },
      { brandId: beta!.id, slug: 'off', name: 'Beta Off', status: 'disabled' },
      { brandId: archived!.id, slug: 'in', name: 'Gone India' },
    ])
    .returning();

  const verifiedAt = new Date();
  await db.insert(storeDomains).values([
    { storeId: alphaStore!.id, hostname: 'alpha.example.in', isPrimary: true, verifiedAt },
    { storeId: alphaStore!.id, hostname: 'www.alpha.example.in', verifiedAt },
    { storeId: betaStore!.id, hostname: 'beta.example.in', isPrimary: true, verifiedAt },
    { storeId: betaStore!.id, hostname: 'unverified.example.in' },
    { storeId: maintStore!.id, hostname: 'maint.example.in', verifiedAt },
    { storeId: disabledStore!.id, hostname: 'off.example.in', verifiedAt },
    { storeId: archivedStore!.id, hostname: 'gone.example.in', verifiedAt },
  ]);
});

afterAll(async () => {
  await ctx?.close();
});

const getStore = (host: string, headers: Record<string, string> = {}) =>
  ctx.app.inject({ method: 'GET', url: '/v1/storefront/store', headers: { host, ...headers } });

describe('store resolution by host', () => {
  it('resolves each domain to its own store', async () => {
    const alpha = await getStore('alpha.example.in');
    expect(alpha.statusCode).toBe(200);
    expect(alpha.json().store).toMatchObject({
      name: 'Alpha India',
      currency: 'INR',
      locale: 'en-IN',
      brand: { slug: 'alpha', name: 'Alpha Wear' },
      settings: { theme: { primary: '#111111' } },
    });

    const beta = await getStore('beta.example.in');
    expect(beta.statusCode).toBe(200);
    expect(beta.json().store.brand.slug).toBe('beta');
  });

  it('normalises case, port and trailing dot', async () => {
    const res = await getStore('WWW.Alpha.Example.IN.:8443');
    expect(res.statusCode).toBe(200);
    expect(res.json().store.name).toBe('Alpha India');
  });

  it('ignores client-supplied store or brand identifiers', async () => {
    const beta = await getStore('beta.example.in');
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/v1/storefront/store?storeId=' + beta.json().store.id,
      headers: { host: 'alpha.example.in', 'x-store-id': beta.json().store.id, 'x-brand': 'beta' },
    });
    expect(res.json().store.brand.slug).toBe('alpha');
  });

  it('ignores X-Forwarded-Host unless the proxy is trusted', async () => {
    const res = await getStore('alpha.example.in', { 'x-forwarded-host': 'beta.example.in' });
    expect(res.json().store.brand.slug).toBe('alpha');
  });

  it.each([
    ['unknown host', 'nobody.example.in'],
    ['unverified domain', 'unverified.example.in'],
    ['disabled store', 'off.example.in'],
    ['archived brand', 'gone.example.in'],
  ])('returns 404 for %s', async (_label, host) => {
    const res = await getStore(host);
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('store_not_found');
  });

  it('returns 503 for a store in maintenance', async () => {
    const res = await getStore('maint.example.in');
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('store_maintenance');
  });

  it('rejects malformed hosts', async () => {
    const res = await getStore('bad_host');
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('invalid_host');
  });
});

describe('health', () => {
  it('reports liveness and readiness without a store', async () => {
    const live = await ctx.app.inject({ method: 'GET', url: '/health/live', headers: { host: 'nobody.example.in' } });
    expect(live.statusCode).toBe(200);
    const ready = await ctx.app.inject({ method: 'GET', url: '/health/ready' });
    expect(ready.statusCode).toBe(200);
    expect(ready.json().checks.database).toBe('ok');
  });

  it('does not leak internals on unknown routes', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: { code: 'not_found', message: 'Not found.' } });
  });
});
