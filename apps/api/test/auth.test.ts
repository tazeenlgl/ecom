import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { otpChallenges } from '../src/db/schema.js';
import { bearer, customerToken, lastOtp, seedStore, setupTestApp, type TestContext } from './helpers.js';

let ctx: TestContext;
let alpha: Awaited<ReturnType<typeof seedStore>>;
let beta: Awaited<ReturnType<typeof seedStore>>;

beforeAll(async () => {
  ctx = await setupTestApp();
  alpha = await seedStore(ctx.db, 'alpha');
  beta = await seedStore(ctx.db, 'beta');
});
afterAll(async () => ctx?.close());

const post = (host: string, url: string, payload: unknown, headers: Record<string, string> = {}) =>
  ctx.app.inject({ method: 'POST', url: `/v1/storefront${url}`, headers: { host, ...headers }, payload: payload as object });

describe('OTP sign-in', () => {
  it('rejects invalid Indian mobile numbers', async () => {
    const res = await post(alpha.host, '/auth/otp/request', { phone: '12345' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('invalid_request');
  });

  it('registers on first login, normalises the number, and stores only a hash of the code', async () => {
    const req = await post(alpha.host, '/auth/otp/request', { phone: '098765 43210' });
    expect(req.statusCode).toBe(200);
    expect(JSON.stringify(req.json())).not.toMatch(/"code"/);
    const code = lastOtp(ctx, '+919876543210');
    const [row] = await ctx.db.select().from(otpChallenges).where(eq(otpChallenges.id, req.json().challengeId));
    expect(row!.codeHash).not.toContain(code);

    const verify = await post(alpha.host, '/auth/otp/verify', { challengeId: req.json().challengeId, phone: '9876543210', code });
    expect(verify.statusCode).toBe(200);
    expect(verify.json().customer.phone).toBe('+919876543210');

    // Replay: the same code cannot be used twice.
    const replay = await post(alpha.host, '/auth/otp/verify', { challengeId: req.json().challengeId, phone: '9876543210', code });
    expect(replay.statusCode).toBe(400);
    expect(replay.json().error.code).toBe('otp_expired');
  });

  it('counts wrong attempts and locks the challenge after the limit', async () => {
    const req = await post(alpha.host, '/auth/otp/request', { phone: '9000000001' });
    const challengeId = req.json().challengeId;
    const code = lastOtp(ctx, '+919000000001');
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 4; i >= 0; i--) {
      const res = await post(alpha.host, '/auth/otp/verify', { challengeId, phone: '9000000001', code: wrong });
      expect(res.json().error).toMatchObject({ code: 'otp_invalid', details: { attemptsRemaining: i } });
    }
    const locked = await post(alpha.host, '/auth/otp/verify', { challengeId, phone: '9000000001', code });
    expect(locked.json().error.code).toBe('otp_expired');
  });

  it('expires codes', async () => {
    const req = await post(alpha.host, '/auth/otp/request', { phone: '9000000002' });
    ctx.clock.offsetMs = 6 * 60_000;
    try {
      const res = await post(alpha.host, '/auth/otp/verify', { challengeId: req.json().challengeId, phone: '9000000002', code: lastOtp(ctx, '+919000000002') });
      expect(res.json().error.code).toBe('otp_expired');
    } finally {
      ctx.clock.offsetMs = 0;
    }
  });

  it('enforces a resend cooldown per phone', async () => {
    await post(alpha.host, '/auth/otp/request', { phone: '9000000003' });
    const again = await post(alpha.host, '/auth/otp/request', { phone: '9000000003' });
    expect(again.statusCode).toBe(429);
    expect(again.json().error.code).toBe('rate_limited');
  });

  it('does not accept a challenge from another store', async () => {
    const req = await post(alpha.host, '/auth/otp/request', { phone: '9000000004' });
    const res = await post(beta.host, '/auth/otp/verify', { challengeId: req.json().challengeId, phone: '9000000004', code: lastOtp(ctx, '+919000000004') });
    expect(res.json().error.code).toBe('otp_expired');
  });
});

describe('sessions are store-scoped', () => {
  it('rejects a token from one store on another store', async () => {
    const token = await customerToken(ctx, alpha.host, '9111111111');
    const own = await ctx.app.inject({ method: 'GET', url: '/v1/storefront/me', headers: { host: alpha.host, ...bearer(token) } });
    expect(own.statusCode).toBe(200);
    const other = await ctx.app.inject({ method: 'GET', url: '/v1/storefront/me', headers: { host: beta.host, ...bearer(token) } });
    expect(other.statusCode).toBe(401);
  });

  it('logout revokes the session', async () => {
    const token = await customerToken(ctx, alpha.host, '9111111112');
    await post(alpha.host, '/auth/logout', {}, bearer(token));
    const res = await ctx.app.inject({ method: 'GET', url: '/v1/storefront/me', headers: { host: alpha.host, ...bearer(token) } });
    expect(res.statusCode).toBe(401);
  });
});

describe('password sign-in and recovery', () => {
  it('sets a password, signs in with it, and resets it by OTP (revoking sessions)', async () => {
    const token = await customerToken(ctx, alpha.host, '9222222222');
    const set = await ctx.app.inject({ method: 'PUT', url: '/v1/storefront/me/password', headers: { host: alpha.host, ...bearer(token) }, payload: { newPassword: 'first-password' } });
    expect(set.statusCode).toBe(204);

    const bad = await post(alpha.host, '/auth/password/login', { phone: '9222222222', password: 'nope-nope' });
    expect(bad.statusCode).toBe(401);
    const good = await post(alpha.host, '/auth/password/login', { phone: '9222222222', password: 'first-password' });
    expect(good.statusCode).toBe(200);

    ctx.clock.offsetMs = 31_000; // past the resend cooldown from the login code
    const otp = await post(alpha.host, '/auth/otp/request', { phone: '9222222222', purpose: 'reset_password' });
    ctx.clock.offsetMs = 0;
    expect(otp.statusCode).toBe(200);
    const reset = await post(alpha.host, '/auth/password/reset', {
      challengeId: otp.json().challengeId,
      phone: '9222222222',
      code: lastOtp(ctx, '+919222222222'),
      newPassword: 'second-password',
    });
    expect(reset.statusCode).toBe(204);
    const old = await ctx.app.inject({ method: 'GET', url: '/v1/storefront/me', headers: { host: alpha.host, ...bearer(token) } });
    expect(old.statusCode).toBe(401);
    expect((await post(alpha.host, '/auth/password/login', { phone: '9222222222', password: 'second-password' })).statusCode).toBe(200);
  });

  it('does not send reset codes to unknown numbers but responds identically', async () => {
    const before = ctx.messages.outbox.length;
    const res = await post(alpha.host, '/auth/otp/request', { phone: '9333333333', purpose: 'reset_password' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty('challengeId');
    expect(ctx.messages.outbox.length).toBe(before);
  });
});

describe('addresses', () => {
  it('validates PIN codes and keeps one default per customer', async () => {
    const token = await customerToken(ctx, alpha.host, '9444444444');
    const headers = { host: alpha.host, ...bearer(token) };
    const base = { name: 'A Customer', phone: '9444444444', line1: '1 MG Road', city: 'Bengaluru', state: 'Karnataka' };
    const invalid = await ctx.app.inject({ method: 'POST', url: '/v1/storefront/me/addresses', headers, payload: { ...base, pincode: '012345' } });
    expect(invalid.statusCode).toBe(400);
    const a = await ctx.app.inject({ method: 'POST', url: '/v1/storefront/me/addresses', headers, payload: { ...base, pincode: '560001', isDefault: true } });
    const b = await ctx.app.inject({ method: 'POST', url: '/v1/storefront/me/addresses', headers, payload: { ...base, pincode: '560002', isDefault: true } });
    expect(a.statusCode).toBe(201);
    expect(b.statusCode).toBe(201);
    const list = await ctx.app.inject({ method: 'GET', url: '/v1/storefront/me/addresses', headers });
    expect(list.json().items.filter((x: { isDefault: boolean }) => x.isDefault)).toHaveLength(1);

    // Another customer cannot touch this address by id.
    const other = await customerToken(ctx, alpha.host, '9444444445');
    const steal = await ctx.app.inject({ method: 'PATCH', url: `/v1/storefront/me/addresses/${a.json().address.id}`, headers: { host: alpha.host, ...bearer(other) }, payload: { city: 'X' } });
    expect(steal.statusCode).toBe(404);
  });
});
