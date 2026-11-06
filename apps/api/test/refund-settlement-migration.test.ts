import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '../src/db/client.js';
import { migrationsFolder } from '../src/db/migrate.js';
import { refunds } from '../src/db/schema.js';
import { assertDisposableDatabase } from './support/disposable-db.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://ecom:ecom@localhost:5432/ecom_test';

let db: Database;
let close: () => Promise<void>;
let partialFolder: string;

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

beforeAll(async () => {
  const { db: database, pool } = createDatabase(TEST_DATABASE_URL);
  db = database;
  close = () => pool.end();
  await assertDisposableDatabase(db);
  await db.execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);

  // A migrations folder that stops before the refund settlement migration.
  partialFolder = mkdtempSync(join(tmpdir(), 'ecom-migrations-'));
  mkdirSync(join(partialFolder, 'meta'));
  const journal = JSON.parse(readFileSync(join(migrationsFolder, 'meta/_journal.json'), 'utf8')) as { entries: { tag: string }[] };
  const before = journal.entries.filter((e) => e.tag < '0004');
  for (const e of before) cpSync(join(migrationsFolder, `${e.tag}.sql`), join(partialFolder, `${e.tag}.sql`));
  writeFileSync(join(partialFolder, 'meta/_journal.json'), JSON.stringify({ ...journal, entries: before }));
});

afterAll(async () => {
  rmSync(partialFolder, { recursive: true, force: true });
  await close?.();
});

describe('refund settlement migration (0004)', () => {
  it('keeps refunds that existed before it valid and readable', async () => {
    await migrate(db, { migrationsFolder: partialFolder });
    const before = await db.execute<{ column_name: string }>(sql`select column_name from information_schema.columns where table_name = 'refunds'`);
    expect(before.rows.map((r) => r.column_name)).not.toContain('settlement_source');

    // Refunds from before the migration, written without foreign-key checks (this test only exercises the table).
    await db.execute(sql`set session_replication_role = replica`);
    try {
      await db.execute(sql`
        insert into refunds (id, store_id, order_id, payment_transaction_id, amount_paise, reason, status, provider_ref, idempotency_key, failure_code)
        values
          (${id(1)}, ${id(100)}, ${id(200)}, ${id(300)}, 100000, 'old succeeded', 'succeeded', 'RF_OLD_1', 'old-1', null),
          (${id(2)}, ${id(100)}, ${id(200)}, ${id(300)}, 50000, 'old failed', 'failed', 'RF_OLD_2', 'old-2', 'manual: Rejected by the bank'),
          (${id(3)}, ${id(100)}, ${id(201)}, null, 20000, 'old pending', 'pending', null, 'old-3', null)`);
    } finally {
      await db.execute(sql`set session_replication_role = origin`);
    }

    // Applying the remaining migration is additive: nothing is rewritten.
    await migrate(db, { migrationsFolder });
    const rows = await db.select().from(refunds).orderBy(refunds.idempotencyKey);
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row).toMatchObject({ settlementSource: null, settledByType: null, settledById: null, settledAt: null, settlementReference: null, settlementNote: null });
    }
    expect(rows.map((r) => [r.status, r.failureCode])).toEqual([
      ['succeeded', null],
      ['failed', 'manual: Rejected by the bank'],
      ['pending', null],
    ]);

    // It is recorded once; running it again changes nothing.
    await migrate(db, { migrationsFolder });
    const applied = await db.execute<{ n: number }>(sql`select count(*)::int as n from drizzle.__drizzle_migrations`);
    const journal = JSON.parse(readFileSync(join(migrationsFolder, 'meta/_journal.json'), 'utf8')) as { entries: unknown[] };
    expect(applied.rows[0]!.n).toBe(journal.entries.length);
  });

  it('accepts only the provider and manual settlement sources', async () => {
    const set = (source: string | null) =>
      db.execute(sql`update refunds set settlement_source = ${source}, settled_by_type = 'admin', settled_at = now() where id = ${id(1)}`);
    await expect(set('provider')).resolves.toBeDefined();
    await expect(set('manual')).resolves.toBeDefined();
    await expect(set(null)).resolves.toBeDefined();
    const error = await set('staff').then(() => null, (e: unknown) => e as { cause?: { constraint?: string } });
    expect(error?.cause?.constraint).toBe('refunds_settlement_source_ck');
  });
});
