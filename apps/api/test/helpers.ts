import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { buildApp } from '../src/app.js';
import { testConfig } from '../src/config/env.js';
import { createDatabase, type Database } from '../src/db/client.js';
import { migrationsFolder } from '../src/db/migrate.js';
import { adminRoleAssignments, adminUsers, brands, storeDomains, stores } from '../src/db/schema.js';
import { hashPassword } from '../src/lib/crypto.js';
import { LogMessageSender } from '../src/modules/notifications/sender.js';
import { FakePaymentProvider } from '../src/modules/payments/fake-provider.js';
import { paytmConfigFromDb } from '../src/modules/payments/paytm/config.js';
import { PaytmPaymentProvider } from '../src/modules/payments/paytm/provider.js';
import type { PaymentProvider } from '../src/modules/payments/provider.js';
import type { PosGateway } from '../src/modules/pos/gateway.js';
import { UnconfiguredPosGateway } from '../src/modules/pos/unconfigured-gateway.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://ecom:ecom@localhost:5432/ecom_test';
export const WEBHOOK_SECRET = 'test-webhook-secret-0123456789';

/** Fake DNS for domain verification: tests set TXT records directly. */
export class FakeDns {
  records = new Map<string, string[]>();
  async txtRecords(name: string) {
    return this.records.get(name) ?? [];
  }
}

/**
 * Builds the app against a real, freshly migrated PostgreSQL schema.
 * External integrations are fakes: log-only messages, FakePaymentProvider,
 * FakeDns, and the given POS gateway (unconfigured by default).
 */
export async function setupTestApp(options: { pos?: PosGateway; paytmFetch?: typeof fetch } = {}) {
  const { db, pool } = createDatabase(TEST_DATABASE_URL);
  await db.execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
  await migrate(db, { migrationsFolder });

  const messages = new LogMessageSender({ info: () => undefined });
  const payment = new FakePaymentProvider(WEBHOOK_SECRET);
  const dns = new FakeDns();
  const clock = { offsetMs: 0 };
  const config = testConfig({ PAYMENT_PROVIDER: 'fake', FAKE_PAYMENT_WEBHOOK_SECRET: WEBHOOK_SECRET });
  // Paytm never reaches the network in tests: calls go to `paytmFetch` (or fail).
  const noNetwork = (async () => {
    throw new Error('network disabled in tests');
  }) as typeof fetch;
  const paytm = new PaytmPaymentProvider({ db, configFor: paytmConfigFromDb(db, config), fetch: options.paytmFetch ?? noNetwork });
  const app = await buildApp({
    config,
    db,
    overrides: {
      messages,
      payments: new Map<string, PaymentProvider>([
        ['fake', payment],
        ['paytm', paytm],
      ]),
      dns,
      pos: options.pos ?? new UnconfiguredPosGateway(),
      now: () => new Date(Date.now() + clock.offsetMs),
    },
  });
  return {
    app,
    db,
    messages,
    payment,
    dns,
    clock,
    close: async () => {
      await app.close();
      await pool.end();
    },
  };
}

export type TestDb = Database;
export type TestContext = Awaited<ReturnType<typeof setupTestApp>>;

/** A brand, an active store and a verified domain. */
export async function seedStore(db: Database, slug: string, config: (typeof stores.$inferInsert)['config'] = {}) {
  const [brand] = await db.insert(brands).values({ slug, name: `${slug} brand` }).returning();
  const [store] = await db
    .insert(stores)
    .values({ brandId: brand!.id, slug, name: `${slug} store`, config: { codEnabled: true, ...config } })
    .returning();
  const host = `${slug}.example.in`;
  await db.insert(storeDomains).values({ storeId: store!.id, hostname: host, isPrimary: true, verifiedAt: new Date() });
  return { brand: brand!, store: store!, host };
}

/** Creates an admin with the given role grants and returns a bearer token. */
export async function adminToken(ctx: TestContext, email: string, grants: { role: string; storeId: string | null }[]) {
  const password = 'correct horse battery staple';
  const [admin] = await ctx.db.insert(adminUsers).values({ email, name: email, passwordHash: await hashPassword(password) }).returning();
  if (grants.length) await ctx.db.insert(adminRoleAssignments).values(grants.map((g) => ({ ...g, adminUserId: admin!.id })));
  const res = await ctx.app.inject({ method: 'POST', url: '/v1/admin/auth/login', payload: { email, password } });
  if (res.statusCode !== 200) throw new Error(`admin login failed: ${res.body}`);
  return { id: admin!.id, token: res.json().token as string };
}

/** The most recent OTP code "sent" to a phone (read from the log-only sender's in-memory outbox). */
export function lastOtp(ctx: TestContext, phone: string): string {
  const msg = [...ctx.messages.outbox].reverse().find((m) => m.to === phone && m.template.startsWith('otp.'));
  if (!msg) throw new Error(`no OTP sent to ${phone}`);
  return msg.variables.code!;
}

/** Signs a customer in with OTP on `host`; returns the session token. */
export async function customerToken(ctx: TestContext, host: string, phone: string, headers: Record<string, string> = {}) {
  const req = await ctx.app.inject({ method: 'POST', url: '/v1/storefront/auth/otp/request', headers: { host }, payload: { phone } });
  if (req.statusCode !== 200) throw new Error(`otp request failed: ${req.body}`);
  const { challengeId } = req.json();
  const e164 = `+91${phone.replace(/\D/g, '').slice(-10)}`;
  const verify = await ctx.app.inject({
    method: 'POST',
    url: '/v1/storefront/auth/otp/verify',
    headers: { host, ...headers },
    payload: { challengeId, phone, code: lastOtp(ctx, e164) },
  });
  if (verify.statusCode !== 200) throw new Error(`otp verify failed: ${verify.body}`);
  return verify.json().token as string;
}

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
