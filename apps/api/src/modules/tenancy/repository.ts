import { and, eq, isNotNull } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { brands, type StoreConfig, storeDomains, stores } from '../../db/schema.js';

export type ResolvedStore = {
  id: string;
  slug: string;
  name: string;
  status: 'active' | 'maintenance' | 'disabled';
  currency: string;
  locale: string;
  timezone: string;
  publicSettings: Record<string, unknown>;
  config: StoreConfig;
  posLocationRef: string | null;
  brand: { id: string; slug: string; name: string; status: 'active' | 'archived' };
  hostname: string;
};

/** Look up the store that owns a verified hostname. `hostname` must already be normalised. */
export async function findStoreByHostname(db: Database, hostname: string): Promise<ResolvedStore | null> {
  const rows = await db
    .select({
      id: stores.id,
      slug: stores.slug,
      name: stores.name,
      status: stores.status,
      currency: stores.currency,
      locale: stores.locale,
      timezone: stores.timezone,
      publicSettings: stores.publicSettings,
      config: stores.config,
      posLocationRef: stores.posLocationRef,
      brand: { id: brands.id, slug: brands.slug, name: brands.name, status: brands.status },
      hostname: storeDomains.hostname,
    })
    .from(storeDomains)
    .innerJoin(stores, eq(stores.id, storeDomains.storeId))
    .innerJoin(brands, eq(brands.id, stores.brandId))
    .where(and(eq(storeDomains.hostname, hostname), isNotNull(storeDomains.verifiedAt)))
    .limit(1);
  return rows[0] ?? null;
}
