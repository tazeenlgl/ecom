import { and, eq, sql } from 'drizzle-orm';
import type { AppContext } from '../../context.js';
import { posStockLevels, productVariants, stores } from '../../db/schema.js';

/**
 * Writes POS-reported stock into the read model. SKUs the POS did not return
 * are recorded as 0 available, so an unknown SKU is never oversold.
 * This is a cache of the POS, not a ledger: nothing else writes these rows.
 */
export async function upsertStock(ctx: AppContext, locationRef: string, requested: string[], levels: { skuCode: string; available: number; asOf?: Date }[]) {
  const bySku = new Map(levels.map((l) => [l.skuCode, l]));
  const rows = requested.map((skuCode) => ({
    skuCode,
    locationRef,
    available: Math.max(0, Math.floor(bySku.get(skuCode)?.available ?? 0)),
    posAsOf: bySku.get(skuCode)?.asOf ?? null,
    syncedAt: ctx.now(),
  }));
  if (rows.length === 0) return 0;
  await ctx.db
    .insert(posStockLevels)
    .values(rows)
    .onConflictDoUpdate({
      target: [posStockLevels.skuCode, posStockLevels.locationRef],
      set: { available: sql`excluded.available`, posAsOf: sql`excluded.pos_as_of`, syncedAt: sql`excluded.synced_at` },
    });
  return rows.length;
}

/**
 * Best-effort live stock read for specific SKUs before an order is placed.
 * Returns false when the POS cannot be asked (no capability, or an error), in
 * which case checkout uses the last synced read model.
 */
export async function refreshStockLive(ctx: AppContext, locationRef: string | null, skuCodes: string[]): Promise<boolean> {
  if (!ctx.pos.capabilities().getStock || skuCodes.length === 0) return false;
  try {
    const levels = await ctx.pos.getStock(skuCodes);
    await upsertStock(ctx, locationRef ?? '', skuCodes, levels);
    return true;
  } catch {
    return false;
  }
}

/** Job: refresh the read model for every variant SKU of a store, in batches. */
export async function syncStoreStock(ctx: AppContext, storeId: string) {
  if (!ctx.pos.capabilities().getStock) return { synced: 0, skipped: 'POS adapter cannot read stock' };
  const [store] = await ctx.db.select({ posLocationRef: stores.posLocationRef }).from(stores).where(eq(stores.id, storeId));
  if (!store) return { synced: 0, skipped: 'store not found' };
  const variants = await ctx.db.select({ skuCode: productVariants.skuCode }).from(productVariants).where(eq(productVariants.storeId, storeId));
  const skus = [...new Set(variants.map((v) => v.skuCode))];
  let synced = 0;
  for (let i = 0; i < skus.length; i += 100) {
    const batch = skus.slice(i, i + 100);
    // A POS error propagates so the job is retried with backoff.
    const levels = await ctx.pos.getStock(batch);
    synced += await upsertStock(ctx, store.posLocationRef ?? '', batch, levels);
  }
  return { synced };
}

/** SKUs of a store with no stock row at all (never reported by the POS). */
export async function skusWithoutStock(ctx: AppContext, storeId: string, locationRef: string | null) {
  const rows = await ctx.db
    .select({ skuCode: productVariants.skuCode })
    .from(productVariants)
    .leftJoin(posStockLevels, and(eq(posStockLevels.skuCode, productVariants.skuCode), eq(posStockLevels.locationRef, locationRef ?? '')))
    .where(and(eq(productVariants.storeId, storeId), sql`${posStockLevels.skuCode} is null`));
  return rows.map((r) => r.skuCode);
}

