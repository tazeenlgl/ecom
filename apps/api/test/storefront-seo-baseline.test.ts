import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { storeDomains } from '../src/db/schema.js';
import { jobHandlers } from '../src/modules/jobs/handlers.js';
import { runDueJobs } from '../src/modules/jobs/queue.js';
import { adminToken, bearer, seedStore, setupTestApp, type TestContext } from './helpers.js';
import { InMemoryPosGateway } from './support/in-memory-pos.js';

/**
 * What the storefront API hands to the web app for search and social metadata: stock state, canonical address,
 * indexability, meta description, breadcrumbs and the fields the sitemap needs.
 */
let ctx: TestContext;
let pos: InMemoryPosGateway;
let alpha: Awaited<ReturnType<typeof seedStore>>;
let adminTok: string;
let productId: string;

const S = () => `/v1/admin/stores/${alpha.store.id}`;
const admin = (method: 'GET' | 'POST' | 'PATCH' | 'PUT', url: string, payload?: unknown) =>
  ctx.app.inject({ method, url, headers: bearer(adminTok), ...(payload ? { payload: payload as object } : {}) });
const shop = (url: string) => ctx.app.inject({ method: 'GET', url: `/v1/storefront${url}`, headers: { host: alpha.host } });
const runJobs = () => runDueJobs(ctx.db, jobHandlers(ctx.app.ctx), 'test-worker', 50, new Date(Date.now() + ctx.clock.offsetMs + 5_000));

beforeAll(async () => {
  pos = new InMemoryPosGateway();
  ctx = await setupTestApp({ pos });
  alpha = await seedStore(ctx.db, 'alpha');
  adminTok = (await adminToken(ctx, 'owner@example.com', [{ role: 'platform_owner', storeId: null }])).token;
  const women = (await admin('POST', `${S()}/categories`, { slug: 'women', name: 'Women' })).json().category.id;
  const kurtas = (await admin('POST', `${S()}/categories`, { slug: 'kurtas', name: 'Kurtas', parentId: women })).json().category.id;

  const seo = { title: 'Custom SEO title', description: 'Custom SEO description.', canonicalUrl: 'https://elsewhere.example/p/x', noIndex: true };
  productId = (await admin('POST', `${S()}/products`, { slug: 'kurta', title: 'Kurta', description: 'First sentence. Second one.\n- bullet one\n- bullet two', seo, categoryIds: [kurtas] })).json().product.id;
  const stocked = (await admin('POST', `${S()}/products/${productId}/variants`, { skuCode: 'K-STOCKED', title: 'Stocked' })).json().variant.id;
  await admin('PUT', `${S()}/variants/${stocked}/price`, { mrpPaise: 200_000, pricePaise: 150_000 });
  pos.stock.set('K-STOCKED', 5);
  expect((await admin('POST', `${S()}/pos/stock-sync`)).statusCode).toBe(202);
  await runJobs();
  // Created after the sync: the POS has never reported this SKU, so its stock is unknown.
  const unknown = (await admin('POST', `${S()}/products/${productId}/variants`, { skuCode: 'K-UNKNOWN', title: 'Unknown stock' })).json().variant.id;
  await admin('PUT', `${S()}/variants/${unknown}/price`, { mrpPaise: 250_000, pricePaise: 180_000 });
  expect((await admin('POST', `${S()}/products/${productId}/status`, { status: 'published' })).statusCode).toBe(200);
});
afterAll(async () => ctx?.close());

describe('storefront product payload used for metadata', () => {
  it('returns the stored SEO object unchanged', async () => {
    const { product } = (await shop('/products/kurta')).json();
    expect(product.seo).toEqual({ title: 'Custom SEO title', description: 'Custom SEO description.', canonicalUrl: 'https://elsewhere.example/p/x', noIndex: true });
  });

  it('reports unknown POS stock as unknown, never as out of stock', async () => {
    const { product } = (await shop('/products/kurta')).json();
    const stock = Object.fromEntries(product.variants.map((v: { skuCode: string; stock: string }) => [v.skuCode, v.stock]));
    expect(stock).toEqual({ 'K-STOCKED': 'in_stock', 'K-UNKNOWN': 'unknown' });
    // The boolean stays for older clients: unknown still reads as not in stock there.
    expect(Object.fromEntries(product.variants.map((v: { skuCode: string; inStock: boolean }) => [v.skuCode, v.inStock]))).toEqual({ 'K-STOCKED': true, 'K-UNKNOWN': false });
  });

  it('has no canonical and is not indexable while the store has no primary domain', async () => {
    await ctx.db.update(storeDomains).set({ isPrimary: false });
    const { product } = (await shop('/products/kurta')).json();
    await ctx.db.update(storeDomains).set({ isPrimary: true });
    expect(product.canonicalUrl).toBeNull();
    expect(product.indexable).toBe(false);
  });

  it('resolves canonical, indexability, meta description and breadcrumbs on the server', async () => {
    await admin('PATCH', `${S()}/products/${productId}`, { seo: { description: '  ', noIndex: false } });
    const { product } = (await shop('/products/kurta')).json();
    expect(product.canonicalUrl).toBe(`https://${alpha.host}/p/kurta`);
    expect(product.indexable).toBe(true);
    // A blank admin description falls back to whole sentences of the product description, without bullet markers.
    expect(product.metaDescription).toBe('First sentence. Second one. bullet one bullet two');
    expect(product.breadcrumbs).toEqual([{ name: 'Women', slug: 'women' }, { name: 'Kurtas', slug: 'kurtas' }]);
    // An admin canonical on a foreign domain is ignored; an admin description is used as written.
    await admin('PATCH', `${S()}/products/${productId}`, { seo: { canonicalUrl: 'https://elsewhere.example/p/x', description: 'Exactly this.' } });
    const again = (await shop('/products/kurta')).json().product;
    expect(again.canonicalUrl).toBe(`https://${alpha.host}/p/kurta`);
    expect(again.metaDescription).toBe('Exactly this.');
  });

  it('rejects a canonical that is not https at write time', async () => {
    expect((await admin('PATCH', `${S()}/products/${productId}`, { seo: { canonicalUrl: 'javascript:alert(1)' } })).statusCode).toBe(400);
    expect((await admin('PATCH', `${S()}/products/${productId}`, { seo: { canonicalUrl: 'http://x.example/p' } })).statusCode).toBe(400);
  });

  it('lists update time and noIndex so the sitemap can use them', async () => {
    const item = (await shop('/products')).json().items.find((p: { slug: string }) => p.slug === 'kurta');
    expect(item.updatedAt).toBeTruthy();
    expect(item.noIndex).toBe(false);
    await admin('PATCH', `${S()}/products/${productId}`, { seo: { noIndex: true } });
    expect((await shop('/products')).json().items.find((p: { slug: string }) => p.slug === 'kurta').noIndex).toBe(true);
    await admin('PATCH', `${S()}/products/${productId}`, { seo: { noIndex: false } });
  });

  it('does not expose draft products', async () => {
    await admin('POST', `${S()}/products/${productId}/status`, { status: 'draft' });
    expect((await shop('/products/kurta')).statusCode).toBe(404);
    await admin('POST', `${S()}/products/${productId}/status`, { status: 'published' });
  });
});
