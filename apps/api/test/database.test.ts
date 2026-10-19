import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { jobs, paymentEvents, products, productVariants, variantPrices } from '../src/db/schema.js';
import { migrationsFolder } from '../src/db/migrate.js';
import { enqueueJob } from '../src/modules/jobs/queue.js';
import { seedStore, setupTestApp, type TestContext } from './helpers.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await setupTestApp();
});
afterAll(async () => ctx?.close());

describe('migrations on a disposable database', () => {
  it('applies every journal entry in order', async () => {
    const journal = JSON.parse(readFileSync(join(migrationsFolder, 'meta/_journal.json'), 'utf8')) as { entries: { tag: string }[] };
    const applied = await ctx.db.execute<{ n: number }>(sql`select count(*)::int as n from drizzle.__drizzle_migrations`);
    expect(applied.rows[0]!.n).toBe(journal.entries.length);
    const tables = await ctx.db.execute<{ table_name: string }>(sql`select table_name from information_schema.tables where table_schema = 'public' order by 1`);
    expect(tables.rows.map((r) => r.table_name)).toEqual(
      expect.arrayContaining(['brands', 'stores', 'store_domains', 'customers', 'products', 'product_variants', 'orders', 'order_items', 'payment_events', 'jobs', 'pos_stock_levels']),
    );
  });
});

describe('database constraints', () => {
  it('rejects a child row pointing at another store’s parent (composite tenant keys)', async () => {
    const a = await seedStore(ctx.db, 'cona');
    const b = await seedStore(ctx.db, 'conb');
    const [product] = await ctx.db.insert(products).values({ storeId: a.store.id, slug: 'p', title: 'P' }).returning();
    await expect(ctx.db.insert(productVariants).values({ storeId: b.store.id, productId: product!.id, skuCode: 'X', title: 'X' })).rejects.toThrow();
    const [variant] = await ctx.db.insert(productVariants).values({ storeId: a.store.id, productId: product!.id, skuCode: 'X', title: 'X' }).returning();
    await expect(ctx.db.insert(variantPrices).values({ storeId: b.store.id, variantId: variant!.id, mrpPaise: 100, pricePaise: 100 })).rejects.toThrow();
    // Price above MRP is rejected by a check constraint.
    await expect(ctx.db.insert(variantPrices).values({ storeId: a.store.id, variantId: variant!.id, mrpPaise: 100, pricePaise: 200 })).rejects.toThrow();
  });

  it('stores each provider event once', async () => {
    const row = { provider: 'fake', providerEventId: 'evt_1', eventType: 'payment.succeeded', payload: {}, signatureVerified: true };
    await ctx.db.insert(paymentEvents).values(row);
    await expect(ctx.db.insert(paymentEvents).values(row)).rejects.toThrow();
  });

  it('enqueues a job once per idempotency key', async () => {
    await enqueueJob(ctx.db, { type: 'noop', storeId: null, idempotencyKey: 'once' });
    await enqueueJob(ctx.db, { type: 'noop', storeId: null, idempotencyKey: 'once' });
    const rows = await ctx.db.select().from(jobs).where(sql`${jobs.idempotencyKey} = 'once'`);
    expect(rows).toHaveLength(1);
  });
});
