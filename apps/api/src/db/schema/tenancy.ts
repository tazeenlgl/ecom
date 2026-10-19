import { sql } from 'drizzle-orm';
import { bigint, boolean, index, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { timestamps } from './common.js';

export const brandStatus = pgEnum('brand_status', ['active', 'archived']);
export const storeStatus = pgEnum('store_status', ['active', 'maintenance', 'disabled']);

export const brands = pgTable('brands', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  status: brandStatus('status').notNull().default('active'),
  ...timestamps,
});

/**
 * Server-only store configuration (never sent to browsers as a whole).
 * Validated by `storeConfigSchema` in modules/platform/settings.ts.
 */
export type StoreConfig = {
  orderNumberPrefix?: string;
  codEnabled?: boolean;
  codMaxOrderPaise?: number;
  unpaidOrderTtlMinutes?: number;
};

export const stores = pgTable(
  'stores',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    brandId: uuid('brand_id')
      .notNull()
      .references(() => brands.id, { onDelete: 'restrict' }),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    status: storeStatus('status').notNull().default('active'),
    currency: text('currency').notNull().default('INR'),
    locale: text('locale').notNull().default('en-IN'),
    timezone: text('timezone').notNull().default('Asia/Kolkata'),
    // Safe to send to browsers: theme tokens, logo URLs, announcement text, SEO defaults.
    publicSettings: jsonb('public_settings').$type<Record<string, unknown>>().notNull().default({}),
    config: jsonb('config').$type<StoreConfig>().notNull().default({}),
    // POS branch/warehouse whose stock this store sells. Unverified concept until the POS is inspected.
    posLocationRef: text('pos_location_ref'),
    ...timestamps,
  },
  (t) => [uniqueIndex('stores_brand_slug_uq').on(t.brandId, t.slug)],
);

export const storeDomains = pgTable(
  'store_domains',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    // Stored normalised: lower-case, no port, no trailing dot.
    hostname: text('hostname').notNull().unique(),
    isPrimary: boolean('is_primary').notNull().default(false),
    // A domain only routes traffic once ownership is verified.
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    // Value expected in the `_ecom-verify.<hostname>` TXT record.
    verificationToken: text('verification_token'),
    ...timestamps,
  },
  (t) => [
    index('store_domains_store_idx').on(t.storeId),
    uniqueIndex('store_domains_one_primary_uq').on(t.storeId).where(sql`${t.isPrimary}`),
  ],
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Null for platform-level actions.
    storeId: uuid('store_id').references(() => stores.id, { onDelete: 'set null' }),
    actorType: text('actor_type').notNull(),
    actorId: text('actor_id'),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    changes: jsonb('changes').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_logs_store_created_idx').on(t.storeId, t.createdAt),
    index('audit_logs_entity_idx').on(t.entityType, t.entityId),
  ],
);

/** Per-store monotonically increasing counters (order numbers, return numbers). */
export const storeCounters = pgTable(
  'store_counters',
  {
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    value: bigint('value', { mode: 'number' }).notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.storeId, t.name] })],
);
