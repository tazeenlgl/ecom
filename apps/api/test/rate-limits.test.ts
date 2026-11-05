import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RateLimiter } from '../src/lib/rate-limit.js';
import { COUPON_FAILURES_PER_CART, COUPON_FAILURES_PER_IP } from '../src/modules/cart/routes.js';
import { adminToken, bearer, customerToken, seedStore, setupTestApp, type TestContext } from './helpers.js';

describe('RateLimiter', () => {
  it('consume() refuses the call after the max-th and reports when to retry', () => {
    let t = 1_000;
    const limiter = new RateLimiter(2, 60_000, () => t);
    limiter.consume('k');
    limiter.consume('k');
    expect(() => limiter.consume('k')).toThrow(/Too many attempts/);
    t += 61_000;
    expect(() => limiter.consume('k')).not.toThrow();
  });

  it('guard() never counts; hit() counts without throwing; the window is deterministic', () => {
    let t = 0;
    const limiter = new RateLimiter(3, 60_000, () => t);
    for (let i = 0; i < 20; i++) limiter.guard('k');
    limiter.hit('k');
    limiter.hit('k');
    expect(() => limiter.guard('k')).not.toThrow();
    limiter.hit('k');
    let err: { statusCode?: number; code?: string; details?: { retryAfterSeconds: number } } | undefined;
    try {
      limiter.guard('k');
    } catch (e) {
      err = e as typeof err;
    }
    expect(err).toMatchObject({ statusCode: 429, code: 'rate_limited' });
    expect(err!.details!.retryAfterSeconds).toBe(60);
    t += 30_000;
    expect(() => limiter.guard('k')).toThrow();
    t += 31_000;
    expect(() => limiter.guard('k')).not.toThrow();
    expect(() => limiter.guard('other')).not.toThrow();
  });
});

describe('coupon guessing limits', () => {
  let ctx: TestContext;
  let alpha: Awaited<ReturnType<typeof seedStore>>;
  let owner: string;
  let variantId: string;
  let n = 0;
  const S = () => `/v1/admin/stores/${alpha.store.id}`;
  const admin = (method: 'POST' | 'PUT', url: string, payload: unknown) => ctx.app.inject({ method, url, headers: bearer(owner), payload: payload as object });

  beforeAll(async () => {
    ctx = await setupTestApp();
    alpha = await seedStore(ctx.db, 'alpha');
    owner = (await adminToken(ctx, 'owner@example.com', [{ role: 'platform_owner', storeId: null }])).token;
    const product = (await admin('POST', `${S()}/products`, { slug: 'kurta', title: 'Kurta', taxRateBps: 500 })).json().product;
    variantId = (await admin('POST', `${S()}/products/${product.id}/variants`, { skuCode: 'K-M', title: 'M' })).json().variant.id;
    await admin('PUT', `${S()}/variants/${variantId}/price`, { mrpPaise: 200_000, pricePaise: 100_000 });
    await admin('POST', `${S()}/products/${product.id}/status`, { status: 'published' });
    const promo = (await admin('POST', `${S()}/promotions`, { name: 'Ten percent', kind: 'percentage', config: { percentBps: 1000 }, requiresCoupon: true, stackable: true })).json().promotion;
    await admin('POST', `${S()}/promotions/${promo.id}/coupons`, { code: 'GOOD10' });
  });
  afterAll(async () => ctx?.close());

  /** A fresh guest cart with one item; each cart has its own token. */
  async function guestCart(peer: string) {
    const created = await ctx.app.inject({ method: 'POST', url: '/v1/storefront/cart', remoteAddress: peer, headers: { host: alpha.host } });
    const token = created.json().cart.cartToken as string;
    await ctx.app.inject({ method: 'POST', url: '/v1/storefront/cart/items', remoteAddress: peer, headers: { host: alpha.host, 'x-cart-token': token }, payload: { variantId, quantity: 1 } });
    return token;
  }
  const put = (code: string, headers: Record<string, string>, peer: string, extra: Record<string, unknown> = {}) =>
    ctx.app.inject({ method: 'PUT', url: '/v1/storefront/cart/coupon', remoteAddress: peer, headers: { host: alpha.host, ...headers }, payload: { code, ...extra } });
  const del = (headers: Record<string, string>, peer: string) => ctx.app.inject({ method: 'DELETE', url: '/v1/storefront/cart/coupon', remoteAddress: peer, headers: { host: alpha.host, ...headers } });
  const peer = () => `203.0.113.${(n++ % 200) + 1}`;

  it('allows exactly 10 failed guesses per cart, then refuses further attempts with 429', async () => {
    const p = peer();
    const h = { 'x-cart-token': await guestCart(p) };
    for (let i = 0; i < COUPON_FAILURES_PER_CART; i++) {
      const res = await put(`NOPE${i}`, h, p);
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe('coupon_invalid');
    }
    const blocked = await put('NOPE-11', h, p);
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error).toMatchObject({ code: 'rate_limited', details: { retryAfterSeconds: expect.any(Number) } });
    // Even the right code waits for the window (otherwise guessing could continue through it).
    expect((await put('GOOD10', h, p)).statusCode).toBe(429);
  });

  it('lets the cart try again once the 15-minute window has passed', async () => {
    const p = peer();
    const h = { 'x-cart-token': await guestCart(p) };
    for (let i = 0; i < COUPON_FAILURES_PER_CART; i++) await put(`MISS${i}`, h, p);
    expect((await put('GOOD10', h, p)).statusCode).toBe(429);
    ctx.clock.offsetMs += 16 * 60_000;
    const ok = await put('GOOD10', h, p);
    expect(ok.statusCode).toBe(200);
    expect(ok.json().quote.coupon).toMatchObject({ code: 'GOOD10', status: 'applied' });
    ctx.clock.offsetMs = 0;
  });

  it('does not count successful applications, so normal coupon changes are never penalised', async () => {
    const p = peer();
    const h = { 'x-cart-token': await guestCart(p) };
    for (let i = 0; i < COUPON_FAILURES_PER_CART * 2; i++) expect((await put('GOOD10', h, p)).statusCode).toBe(200);
    // 9 typos then the right code still works.
    for (let i = 0; i < COUPON_FAILURES_PER_CART - 1; i++) expect((await put(`TYPO${i}`, h, p)).statusCode).toBe(422);
    expect((await put('GOOD10', h, p)).statusCode).toBe(200);
  });

  it('keeps removal of a coupon available even when guessing is locked', async () => {
    const p = peer();
    const h = { 'x-cart-token': await guestCart(p) };
    await put('GOOD10', h, p);
    for (let i = 0; i < COUPON_FAILURES_PER_CART; i++) await put(`BAD${i}`, h, p);
    expect((await put('BAD-X', h, p)).statusCode).toBe(429);
    const removed = await del(h, p);
    expect(removed.statusCode).toBe(200);
    expect(removed.json().cart.couponCode).toBeNull();
  });

  it('limits per cart independently: another cart from another address is unaffected', async () => {
    const p1 = peer();
    const p2 = peer();
    const h1 = { 'x-cart-token': await guestCart(p1) };
    for (let i = 0; i < COUPON_FAILURES_PER_CART; i++) await put(`X${i}`, h1, p1);
    expect((await put('X-LAST', h1, p1)).statusCode).toBe(429);
    const h2 = { 'x-cart-token': await guestCart(p2) };
    expect((await put('GOOD10', h2, p2)).statusCode).toBe(200);
  });

  it('limits per client IP across carts, so creating new carts does not reset the guessing budget', async () => {
    const p = peer();
    const carts = await Promise.all(Array.from({ length: 4 }, () => guestCart(p)));
    let failures = 0;
    for (const token of carts) {
      for (let i = 0; i < 8 && failures < COUPON_FAILURES_PER_IP; i++, failures++) expect((await put(`IP${failures}`, { 'x-cart-token': token }, p)).statusCode).toBe(422);
    }
    expect(failures).toBe(COUPON_FAILURES_PER_IP);
    const fresh = { 'x-cart-token': await guestCart(p) };
    expect((await put('ONE-MORE', fresh, p)).statusCode).toBe(429);
    // A different address is not affected.
    const other = peer();
    expect((await put('GOOD10', { 'x-cart-token': await guestCart(other) }, other)).statusCode).toBe(200);
  });

  it('applies the same limits to a signed-in customer\'s cart', async () => {
    const p = peer();
    const token = await customerToken(ctx, alpha.host, '9812345670');
    const h = bearer(token);
    await ctx.app.inject({ method: 'POST', url: '/v1/storefront/cart/items', remoteAddress: p, headers: { host: alpha.host, ...h }, payload: { variantId, quantity: 1 } });
    for (let i = 0; i < COUPON_FAILURES_PER_CART; i++) expect((await put(`C${i}`, h, p)).statusCode).toBe(422);
    expect((await put('C-LAST', h, p)).statusCode).toBe(429);
  });

  it('still calculates the discount on the server and ignores amounts sent by the browser', async () => {
    const p = peer();
    const h = { 'x-cart-token': await guestCart(p) };
    const res = await put('GOOD10', h, p, { discountPaise: 99_999_999, percentBps: 10_000, totalPaise: 1 });
    expect(res.statusCode).toBe(200);
    expect(res.json().quote).toMatchObject({ subtotalPaise: 100_000, discountPaise: 10_000 });
  });
});

describe('administrator sign-in limits', () => {
  let ctx: TestContext;
  const EMAIL = 'ops@example.com';
  const login = (email: string, password: string, peer: string) =>
    ctx.app.inject({ method: 'POST', url: '/v1/admin/auth/login', remoteAddress: peer, payload: { email, password } });

  beforeAll(async () => {
    ctx = await setupTestApp();
    await adminToken(ctx, EMAIL, [{ role: 'platform_owner', storeId: null }]);
  });
  afterAll(async () => ctx?.close());

  it('limits per account across different addresses (5 attempts), identically for existing and unknown accounts', async () => {
    const statuses = async (email: string) => {
      const out: number[] = [];
      for (let i = 0; i < 6; i++) out.push((await login(email, 'wrong password!', `198.51.100.${i + 1}`)).statusCode);
      return out;
    };
    expect(await statuses(EMAIL)).toEqual([401, 401, 401, 401, 401, 429]);
    expect(await statuses('ghost@example.com')).toEqual([401, 401, 401, 401, 401, 429]);
    const a = await login(EMAIL, 'wrong password!', '198.51.100.99');
    const b = await login('ghost@example.com', 'wrong password!', '198.51.100.98');
    expect(a.json()).toEqual(b.json()); // same body: nothing reveals which account exists
  });

  it('treats upper-case and mixed-case spellings of the address as the same account', async () => {
    const email = 'Case.Test@Example.com';
    await adminToken(ctx, email.toLowerCase(), [{ role: 'support', storeId: null }]);
    const codes: number[] = [];
    const spellings = [email, email.toUpperCase(), email.toLowerCase(), 'CASE.test@example.COM', email, email];
    for (let i = 0; i < spellings.length; i++) codes.push((await login(spellings[i]!, 'wrong password!', `192.0.2.${i + 1}`)).statusCode);
    expect(codes).toEqual([401, 401, 401, 401, 401, 429]);
  });

  it('forgets the failures after the window, and a successful sign-in clears them', async () => {
    const email = 'window@example.com';
    await adminToken(ctx, email, [{ role: 'support', storeId: null }]);
    for (let i = 0; i < 5; i++) await login(email, 'wrong password!', `203.0.113.${i + 1}`);
    expect((await login(email, 'correct horse battery staple', '203.0.113.50')).statusCode).toBe(429);
    ctx.clock.offsetMs += 16 * 60_000;
    expect((await login(email, 'correct horse battery staple', '203.0.113.51')).statusCode).toBe(200);
    // Success reset the account counter: four more misses are still allowed.
    for (let i = 0; i < 4; i++) expect((await login(email, 'wrong password!', `203.0.113.${60 + i}`)).statusCode).toBe(401);
    ctx.clock.offsetMs = 0;
  });

  it('limits per client IP independently of the account (10 attempts)', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) codes.push((await login(`user${i}@example.com`, 'wrong password!', '100.64.0.1')).statusCode);
    expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true);
    expect(codes[10]).toBe(429);
  });
});
