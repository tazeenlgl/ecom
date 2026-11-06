import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminToken, bearer, seedStore, setupTestApp, type TestContext } from './helpers.js';

let ctx: TestContext;
let alpha: Awaited<ReturnType<typeof seedStore>>;
let token: string;

const S = () => `/v1/admin/stores/${alpha.store.id}`;
const admin = (method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown) =>
  ctx.app.inject({ method, url, headers: bearer(token), ...(payload ? { payload: payload as object } : {}) });

beforeAll(async () => {
  ctx = await setupTestApp();
  alpha = await seedStore(ctx.db, 'alpha');
  token = (await adminToken(ctx, 'owner@example.com', [{ role: 'platform_owner', storeId: null }])).token;
});
afterAll(async () => ctx?.close());

describe('storefront product list', () => {
  it('returns each product\'s lowest price, highest MRP and first image (correlated subqueries)', async () => {
    const product = (await admin('POST', `${S()}/products`, { slug: 'kurta-set', title: 'Kurta Set', taxRateBps: 500 })).json().product;
    const small = (await admin('POST', `${S()}/products/${product.id}/variants`, { skuCode: 'KS-S', title: 'S' })).json().variant.id;
    const large = (await admin('POST', `${S()}/products/${product.id}/variants`, { skuCode: 'KS-L', title: 'L' })).json().variant.id;
    await admin('PUT', `${S()}/variants/${small}/price`, { mrpPaise: 599_900, pricePaise: 449_900 });
    await admin('PUT', `${S()}/variants/${large}/price`, { mrpPaise: 649_900, pricePaise: 499_900 });
    await admin('POST', `${S()}/products/${product.id}/media`, { url: 'https://cdn.example.in/second.jpg', position: 2 });
    await admin('POST', `${S()}/products/${product.id}/media`, { url: 'https://cdn.example.in/first.jpg', position: 1 });
    await admin('POST', `${S()}/products/${product.id}/status`, { status: 'published' });

    const res = await ctx.app.inject({ method: 'GET', url: '/v1/storefront/products', headers: { host: alpha.host } });
    expect(res.statusCode).toBe(200);
    const item = res.json().items.find((p: { slug: string }) => p.slug === 'kurta-set');
    expect(item.minPricePaise).toBe(449_900);
    expect(item.maxMrpPaise).toBe(649_900);
    expect(item.imageUrl).toBe('https://cdn.example.in/first.jpg');
  });
});

describe('sales report', () => {
  it('groups orders by day in the store timezone (200, not a Postgres GROUP BY error)', async () => {
    const res = await admin('GET', `${S()}/reports/sales?from=2026-01-01&to=2026-02-01`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ currency: 'INR', daily: [], topSkus: [] });
  });
});
