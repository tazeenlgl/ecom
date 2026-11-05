import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Config, loadConfig } from '../src/config/env.js';
import { seedStore, setupTestApp, type TestContext } from './helpers.js';

/**
 * How the API behaves in production mode for the headers the storefront server really sends: `Host` is the API's
 * own address, and the shop's host travels in `X-Forwarded-Host` (apps/web/lib/server-api.ts `upstreamHeaders`).
 * Store resolution therefore depends on TRUST_PROXY naming the web server's address. The addresses used here are
 * test values (10.0.0.0/8 is "the web servers", 203.0.113.x is "the internet"), not a statement about any deployment.
 */
const PRODUCTION_ENV = {
  NODE_ENV: 'production',
  DATABASE_URL: 'unused',
  LOG_LEVEL: 'silent',
  OTP_HMAC_SECRET: 'p'.repeat(40),
  CONFIG_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  SMS_PROVIDER: 'disabled',
  PAYMENT_PROVIDER: 'none',
};

/** The production configuration as the API itself would load it, so a rule that loadConfig enforces cannot be skipped. */
const productionConfig = (trustProxy?: string): Config => loadConfig({ ...PRODUCTION_ENV, ...(trustProxy === undefined ? {} : { TRUST_PROXY: trustProxy }) });

/** The headers the storefront server sends upstream for a shopper's request. */
const asWebServer = (shopHost: string, clientIp = '198.51.100.7') => ({ host: 'api.internal:4000', 'x-forwarded-host': shopHost, 'x-forwarded-proto': 'https', 'x-forwarded-for': clientIp, accept: 'application/json' });

const brandOf = (res: { json: () => { store?: { brand?: { slug?: string } } } }) => res.json().store?.brand?.slug;

describe.each([
  ['an address list', '10.0.0.0/8'],
  ['a hop count of 1', '1'],
])('production with TRUST_PROXY as %s', (_name, setting) => {
  let ctx: TestContext;
  let alpha: Awaited<ReturnType<typeof seedStore>>;
  let beta: Awaited<ReturnType<typeof seedStore>>;

  beforeAll(async () => {
    const config = productionConfig(setting);
    expect(config.NODE_ENV).toBe('production');
    ctx = await setupTestApp({ config });
    alpha = await seedStore(ctx.db, 'alpha');
    beta = await seedStore(ctx.db, 'beta');
  });
  afterAll(async () => ctx?.close());

  const store = (remoteAddress: string, headers: Record<string, string>) => ctx.app.inject({ method: 'GET', url: '/v1/storefront/store', remoteAddress, headers });

  it('resolves the store from the host the web server forwards', async () => {
    const res = await store('10.0.0.5', asWebServer(alpha.host));
    expect(res.statusCode).toBe(200);
    expect(brandOf(res)).toBe('alpha');
    expect(brandOf(await store('10.0.0.5', asWebServer(beta.host)))).toBe('beta');
  });

  // A hop count has no notion of "outside": the directly connected peer is always trusted. See the characterisation below.
  it.runIf(setting.includes('/'))('never lets a caller outside the trusted proxies choose the store through X-Forwarded-Host', async () => {
    // The Host header names alpha; the forwarded header, from an untrusted peer, asks for beta.
    const res = await store('203.0.113.9', { host: alpha.host, 'x-forwarded-host': beta.host });
    expect(res.statusCode).toBe(200);
    expect(brandOf(res)).toBe('alpha');
    // The web server's own headers from an untrusted peer leave the API's own Host, which names no store.
    const stranger = await store('203.0.113.9', asWebServer(beta.host));
    expect(stranger.statusCode).toBe(404);
  });

  it('answers a forwarded host that is not a verified store domain exactly like an unknown host', async () => {
    const unknown = await store('10.0.0.5', asWebServer('no-such-shop.example'));
    const unnamed = await store('10.0.0.5', { host: 'api.internal:4000' });
    expect(unknown.statusCode).toBe(404);
    expect(unnamed.statusCode).toBe(404);
    expect(unknown.json().error.code).toBe(unnamed.json().error.code);
  });

  it('does not accept a forwarded host that is not a plain hostname', async () => {
    for (const bad of ['[::1]', 'a b', "alpha.example'; --", '']) {
      const res = await store('10.0.0.5', { ...asWebServer(alpha.host), 'x-forwarded-host': bad });
      expect([400, 404]).toContain(res.statusCode);
    }
  });
});

describe('production with a hop count: whoever connects directly is trusted', () => {
  let ctx: TestContext;
  let alpha: Awaited<ReturnType<typeof seedStore>>;
  let beta: Awaited<ReturnType<typeof seedStore>>;

  beforeAll(async () => {
    ctx = await setupTestApp({ config: productionConfig('1') });
    alpha = await seedStore(ctx.db, 'alpha');
    beta = await seedStore(ctx.db, 'beta');
  });
  afterAll(async () => ctx?.close());

  // Characterisation, not an endorsement: with TRUST_PROXY=<hops> the API cannot tell a proxy from any other caller,
  // so the proxy must be the ONLY way to reach it (private address, firewall). An address list does not have this
  // dependency, which is why docs/DEPLOYMENT.md recommends it. If the API were reachable directly, a caller could
  // pick the store with X-Forwarded-Host and its rate-limit bucket with X-Forwarded-For.
  it('honours forwarding headers from the directly connected peer', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/v1/storefront/store', remoteAddress: '203.0.113.9', headers: { host: alpha.host, 'x-forwarded-host': beta.host } });
    expect(brandOf(res)).toBe('beta');
  });
});

describe('production without TRUST_PROXY (the default)', () => {
  let ctx: TestContext;
  let alpha: Awaited<ReturnType<typeof seedStore>>;
  let beta: Awaited<ReturnType<typeof seedStore>>;

  beforeAll(async () => {
    const config = productionConfig();
    expect(config.TRUST_PROXY).toBe(false);
    ctx = await setupTestApp({ config });
    alpha = await seedStore(ctx.db, 'alpha');
    beta = await seedStore(ctx.db, 'beta');
  });
  afterAll(async () => ctx?.close());

  const store = (remoteAddress: string, headers: Record<string, string>) => ctx.app.inject({ method: 'GET', url: '/v1/storefront/store', remoteAddress, headers });

  it('serves a request addressed directly to the store domain', async () => {
    const res = await store('203.0.113.9', { host: alpha.host });
    expect(res.statusCode).toBe(200);
    expect(brandOf(res)).toBe('alpha');
  });

  it('ignores X-Forwarded-Host from every peer, including a would-be proxy', async () => {
    for (const peer of ['203.0.113.9', '10.0.0.5', '127.0.0.1']) {
      expect(brandOf(await store(peer, { host: alpha.host, 'x-forwarded-host': beta.host }))).toBe('alpha');
    }
  });

  it('fails closed, not onto another store, when the web server reaches the API through a different Host', async () => {
    // This is what happens if the API is deployed without TRUST_PROXY behind the storefront server: the shop's
    // host is in X-Forwarded-Host only, the API ignores it, and no store is found (404). Nothing is served
    // for the wrong store. The fix is to set TRUST_PROXY to the web servers' addresses (docs/DEPLOYMENT.md).
    const res = await store('10.0.0.5', asWebServer(alpha.host));
    expect(res.statusCode).toBe(404);
  });
});

describe('production refuses an unsafe TRUST_PROXY at startup', () => {
  it.each(['true', 'TRUE'])('rejects %s', (value) => {
    expect(() => productionConfig(value)).toThrow(/TRUST_PROXY.*not allowed in production/);
  });

  it.each(['yes', '9', '10.0.0.0/33', 'not-an-ip'])('rejects the malformed value %s', (value) => {
    expect(() => productionConfig(value)).toThrow(/TRUST_PROXY/);
  });

  it('accepts a list, a hop count, and the default', () => {
    expect(productionConfig('10.1.2.3,10.1.2.4').TRUST_PROXY).toEqual(['10.1.2.3', '10.1.2.4']);
    expect(productionConfig('1').TRUST_PROXY).toBe(1);
    expect(productionConfig().TRUST_PROXY).toBe(false);
  });
});
