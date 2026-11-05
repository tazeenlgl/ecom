import { desc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/env.js';
import { parseTrustProxy } from '../src/config/trust-proxy.js';
import { otpChallenges } from '../src/db/schema.js';
import { clientIp, normalizeIp, UNKNOWN_CLIENT } from '../src/lib/client-ip.js';
import { seedStore, setupTestApp, type TestContext } from './helpers.js';

describe('TRUST_PROXY parsing', () => {
  it.each([
    [undefined, false],
    ['', false],
    ['false', false],
    ['FALSE', false],
    ['true', true],
    ['0', false],
    ['1', 1],
    ['2', 2],
    ['loopback', ['loopback']],
    ['10.0.0.0/8', ['10.0.0.0/8']],
    ['127.0.0.1, ::1 ,10.1.2.3/32', ['127.0.0.1', '::1', '10.1.2.3/32']],
    ['fd00::/8', ['fd00::/8']],
  ])('parses %j', (raw, expected) => {
    expect(parseTrustProxy(raw as string | undefined)).toEqual(expected);
  });

  it.each(['yes', '9', '10.0.0.0/33', 'fd00::/129', '300.1.1.1', 'not-an-ip', '10.0.0.0/8,oops', ','])('rejects %j', (raw) => {
    expect(() => parseTrustProxy(raw)).toThrow();
  });

  it('refuses TRUST_PROXY=true in production but allows it elsewhere', () => {
    const base = { DATABASE_URL: 'x', OTP_HMAC_SECRET: 'p'.repeat(40), CONFIG_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'), SMS_PROVIDER: 'disabled' };
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', TRUST_PROXY: 'true' })).toThrow(/TRUST_PROXY/);
    expect(loadConfig({ ...base, NODE_ENV: 'production', TRUST_PROXY: '10.0.0.0/8' }).TRUST_PROXY).toEqual(['10.0.0.0/8']);
    expect(loadConfig({ ...base, NODE_ENV: 'production', TRUST_PROXY: '2' }).TRUST_PROXY).toBe(2);
    expect(loadConfig({ ...base, NODE_ENV: 'development', TRUST_PROXY: 'true' }).TRUST_PROXY).toBe(true);
    expect(() => loadConfig({ ...base, NODE_ENV: 'development', TRUST_PROXY: 'banana' })).toThrow(/TRUST_PROXY/);
  });
});

describe('client IP validation', () => {
  it('normalises valid addresses and rejects everything else', () => {
    expect(normalizeIp('203.0.113.9')).toBe('203.0.113.9');
    expect(normalizeIp('::ffff:203.0.113.9')).toBe('203.0.113.9');
    expect(normalizeIp('2001:DB8::1')).toBe('2001:db8::1');
    for (const bad of ['not-an-ip', '', '999.1.1.1', "1.1.1.1'; drop table x;--", '1.1.1.1, 2.2.2.2', undefined, null]) expect(normalizeIp(bad as string)).toBeNull();
  });

  it('falls back to the socket address, then to a shared bucket', () => {
    expect(clientIp({ ip: 'garbage', socket: { remoteAddress: '10.0.0.5' } } as never)).toBe('10.0.0.5');
    expect(clientIp({ ip: 'garbage', socket: { remoteAddress: 'also-garbage' } } as never)).toBe(UNKNOWN_CLIENT);
    expect(clientIp({ ip: '198.51.100.7', socket: { remoteAddress: '10.0.0.5' } } as never)).toBe('198.51.100.7');
  });
});

/** Only peers inside 10.0.0.0/8 are trusted proxies. 203.0.113.x peers are "the internet". */
describe('forwarding headers over HTTP (trusted peers: 10.0.0.0/8)', () => {
  let ctx: TestContext;
  let alpha: Awaited<ReturnType<typeof seedStore>>;
  let beta: Awaited<ReturnType<typeof seedStore>>;
  let n = 0;

  beforeAll(async () => {
    ctx = await setupTestApp({ config: { TRUST_PROXY: ['10.0.0.0/8'] } });
    alpha = await seedStore(ctx.db, 'alpha');
    beta = await seedStore(ctx.db, 'beta');
  });
  afterAll(async () => ctx?.close());

  const phone = () => `98765${String(10000 + n++).slice(-5)}`;
  /** Requests an OTP from `peer` with the given headers and returns the IP the API recorded for it. */
  async function recordedIp(peer: string, headers: Record<string, string>, host = alpha.host) {
    const p = phone();
    const res = await ctx.app.inject({ method: 'POST', url: '/v1/storefront/auth/otp/request', remoteAddress: peer, headers: { host, ...headers }, payload: { phone: p, purpose: 'login' } });
    expect(res.statusCode).toBe(200);
    const [row] = await ctx.db.select().from(otpChallenges).orderBy(desc(otpChallenges.createdAt)).limit(1);
    return row!.requestIp;
  }

  it('ignores a spoofed X-Forwarded-For from an untrusted peer', async () => {
    expect(await recordedIp('203.0.113.9', { 'x-forwarded-for': '6.6.6.6' })).toBe('203.0.113.9');
  });

  it('uses the forwarded client when the peer is a trusted proxy', async () => {
    expect(await recordedIp('10.0.0.5', { 'x-forwarded-for': '198.51.100.7' })).toBe('198.51.100.7');
  });

  it('ignores values spoofed in front of the real chain (multiple forwarding values)', async () => {
    expect(await recordedIp('10.0.0.5', { 'x-forwarded-for': '6.6.6.6, 198.51.100.7' })).toBe('198.51.100.7');
    expect(await recordedIp('10.0.0.5', { 'x-forwarded-for': '6.6.6.6, 198.51.100.7, 10.0.0.9' })).toBe('198.51.100.7');
  });

  it('falls back to the peer address when the header is missing', async () => {
    expect(await recordedIp('10.0.0.5', {})).toBe('10.0.0.5');
  });

  it('never records a malformed forwarded value', async () => {
    expect(await recordedIp('10.0.0.5', { 'x-forwarded-for': 'not-an-ip' })).toBe('10.0.0.5');
    expect(await recordedIp('10.0.0.5', { 'x-forwarded-for': "1.1.1.1'; --" })).toBe('10.0.0.5');
  });

  it('honours X-Forwarded-Host only from a trusted peer', async () => {
    const viaTrusted = await ctx.app.inject({ method: 'GET', url: '/v1/storefront/store', remoteAddress: '10.0.0.5', headers: { host: 'internal', 'x-forwarded-host': beta.host } });
    expect(viaTrusted.json().store.brand.slug).toBe('beta');
    const viaUntrusted = await ctx.app.inject({ method: 'GET', url: '/v1/storefront/store', remoteAddress: '203.0.113.9', headers: { host: alpha.host, 'x-forwarded-host': beta.host } });
    expect(viaUntrusted.json().store.brand.slug).toBe('alpha');
  });

  it('a spoofed header cannot bypass the admin sign-in limit', async () => {
    // A different (nonexistent) email each time, so only the per-IP limit can trip here.
    const attempt = (peer: string, xff: string, i: number) =>
      ctx.app.inject({ method: 'POST', url: '/v1/admin/auth/login', remoteAddress: peer, headers: { 'x-forwarded-for': xff }, payload: { email: `spoof${i}@example.com`, password: 'wrong password!' } });
    // From the internet, rotating the header does not create new buckets: the 11th attempt is limited.
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) codes.push((await attempt('203.0.113.50', `6.6.6.${i}`, i)).statusCode);
    expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true);
    expect(codes[10]).toBe(429);
  });

  it('a trusted proxy gives each real client its own sign-in bucket', async () => {
    let k = 0;
    const attempt = (client: string) =>
      ctx.app.inject({ method: 'POST', url: '/v1/admin/auth/login', remoteAddress: '10.0.0.5', headers: { 'x-forwarded-for': client }, payload: { email: `behind-proxy${k++}@example.com`, password: 'wrong password!' } });
    // 11 different clients behind the same proxy: nobody is limited.
    for (let i = 0; i < 11; i++) expect((await attempt(`198.51.100.${i + 1}`)).statusCode).toBe(401);
    // One client repeating itself is limited on the 11th try.
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) codes.push((await attempt('198.51.100.200')).statusCode);
    expect(codes[10]).toBe(429);
  });
});

describe('TRUST_PROXY as a hop count', () => {
  let ctx: TestContext;
  let alpha: Awaited<ReturnType<typeof seedStore>>;

  beforeAll(async () => {
    ctx = await setupTestApp({ config: { TRUST_PROXY: 1 } });
    alpha = await seedStore(ctx.db, 'alpha');
  });
  afterAll(async () => ctx?.close());

  it('trusts exactly one hop: the rightmost forwarded value is the client, anything before it is ignored', async () => {
    const res = await ctx.app.inject({ method: 'POST', url: '/v1/storefront/auth/otp/request', remoteAddress: '10.0.0.5', headers: { host: alpha.host, 'x-forwarded-for': '6.6.6.6, 198.51.100.7' }, payload: { phone: '9876543211', purpose: 'login' } });
    expect(res.statusCode).toBe(200);
    const [row] = await ctx.db.select().from(otpChallenges).where(eq(otpChallenges.phone, '+919876543211'));
    expect(row!.requestIp).toBe('198.51.100.7');
  });
});

describe('TRUST_PROXY=false (default)', () => {
  let ctx: TestContext;
  let alpha: Awaited<ReturnType<typeof seedStore>>;

  beforeAll(async () => {
    ctx = await setupTestApp();
    alpha = await seedStore(ctx.db, 'alpha');
  });
  afterAll(async () => ctx?.close());

  it('ignores every forwarding header', async () => {
    const res = await ctx.app.inject({ method: 'POST', url: '/v1/storefront/auth/otp/request', remoteAddress: '10.0.0.5', headers: { host: alpha.host, 'x-forwarded-for': '6.6.6.6' }, payload: { phone: '9876543210', purpose: 'login' } });
    expect(res.statusCode).toBe(200);
    const [row] = await ctx.db.select().from(otpChallenges).where(eq(otpChallenges.phone, '+919876543210'));
    expect(row!.requestIp).toBe('10.0.0.5');
  });
});
