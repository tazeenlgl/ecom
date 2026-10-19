import { sql } from 'drizzle-orm';
import {
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, type SeoMeta, timestamps } from './common.js';
import { orders } from './orders.js';
import { stores } from './tenancy.js';

// ---------------------------------------------------------------------------
// Shipping
// ---------------------------------------------------------------------------

/** A serviceable area matched by PIN-code prefix, with a flat-rate charge. */
export const shippingZones = pgTable(
  'shipping_zones',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    // e.g. ['56', '600'] matches every PIN starting with 56 or 600. Longest prefix wins.
    pincodePrefixes: text('pincode_prefixes').array().notNull(),
    chargePaise: integer('charge_paise').notNull().default(0),
    freeAbovePaise: integer('free_above_paise'),
    codAvailable: boolean('cod_available').notNull().default(false),
    codFeePaise: integer('cod_fee_paise').notNull().default(0),
    estimatedDaysMin: integer('estimated_days_min'),
    estimatedDaysMax: integer('estimated_days_max'),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [index('shipping_zones_store_idx').on(t.storeId)],
);

export const shipmentStatus = pgEnum('shipment_status', [
  'pending',
  'packed',
  'shipped',
  'in_transit',
  'out_for_delivery',
  'delivered',
  'delivery_failed',
  'rto_initiated',
  'rto_delivered',
  'cancelled',
]);

export const shipments = pgTable(
  'shipments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id').notNull(),
    orderId: uuid('order_id').notNull(),
    status: shipmentStatus('status').notNull().default('pending'),
    courier: text('courier'),
    trackingNumber: text('tracking_number'),
    trackingUrl: text('tracking_url'),
    ...timestamps,
  },
  (t) => [
    unique('shipments_store_id_uq').on(t.storeId, t.id),
    index('shipments_order_idx').on(t.orderId),
    uniqueIndex('shipments_tracking_uq').on(t.courier, t.trackingNumber),
    foreignKey({
      name: 'shipments_order_fk',
      columns: [t.storeId, t.orderId],
      foreignColumns: [orders.storeId, orders.id],
    }).onDelete('restrict'),
  ],
);

export const shipmentEvents = pgTable(
  'shipment_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id').notNull(),
    shipmentId: uuid('shipment_id').notNull(),
    status: shipmentStatus('status').notNull(),
    description: text('description'),
    location: text('location'),
    // Courier's event id, when it has one, so redelivered events are ignored.
    externalEventId: text('external_event_id'),
    source: text('source').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    createdAt,
  },
  (t) => [
    index('shipment_events_shipment_idx').on(t.shipmentId, t.occurredAt),
    uniqueIndex('shipment_events_external_uq').on(t.shipmentId, t.externalEventId),
    foreignKey({
      name: 'shipment_events_shipment_fk',
      columns: [t.storeId, t.shipmentId],
      foreignColumns: [shipments.storeId, shipments.id],
    }).onDelete('cascade'),
  ],
);

// ---------------------------------------------------------------------------
// POS read model. The POS is authoritative; these rows are a cache with a sync time.
// ---------------------------------------------------------------------------

export const posStockLevels = pgTable(
  'pos_stock_levels',
  {
    skuCode: text('sku_code').notNull(),
    // '' when the POS reports stock without locations.
    locationRef: text('location_ref').notNull().default(''),
    available: integer('available').notNull(),
    posAsOf: timestamp('pos_as_of', { withTimezone: true }),
    syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('pos_stock_levels_sku_location_uq').on(t.skuCode, t.locationRef)],
);

// ---------------------------------------------------------------------------
// Durable background jobs (POS sync, notifications, payment reconciliation)
// ---------------------------------------------------------------------------

export const jobStatus = pgEnum('job_status', ['queued', 'running', 'succeeded', 'dead']);

export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    type: text('type').notNull(),
    // Null only for platform-wide jobs. Handlers must scope all work to this store.
    storeId: uuid('store_id').references(() => stores.id, { onDelete: 'cascade' }),
    // IDs and parameters only; never secrets, OTPs or customer PII.
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    status: jobStatus('status').notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(8),
    runAt: timestamp('run_at', { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    lockedBy: text('locked_by'),
    lastError: text('last_error'),
    // Enqueueing the same key twice is a no-op.
    idempotencyKey: text('idempotency_key').unique(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index('jobs_ready_idx').on(t.runAt).where(sql`${t.status} = 'queued'`),
    index('jobs_store_status_idx').on(t.storeId, t.status),
  ],
);

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

export const contentStatus = pgEnum('content_status', ['draft', 'published']);
export const pageKind = pgEnum('content_page_kind', ['page', 'policy', 'faq']);

export const contentPages = pgTable(
  'content_pages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    kind: pageKind('kind').notNull(),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    // Markdown. Rendered and sanitised by the storefront.
    body: text('body').notNull().default(''),
    status: contentStatus('status').notNull().default('draft'),
    position: integer('position').notNull().default(0),
    seo: jsonb('seo').$type<SeoMeta>().notNull().default({}),
    ...timestamps,
  },
  (t) => [uniqueIndex('content_pages_store_slug_uq').on(t.storeId, t.slug)],
);

export const blockKind = pgEnum('content_block_kind', ['homepage_section', 'navigation', 'banner']);

/** Configurable blocks: homepage sections, navigation menus and scheduled banners/campaigns. */
export const contentBlocks = pgTable(
  'content_blocks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    kind: blockKind('kind').notNull(),
    // e.g. 'main-menu', 'hero'. Unique per store and kind.
    key: text('key').notNull(),
    title: text('title'),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    status: contentStatus('status').notNull().default('draft'),
    position: integer('position').notNull().default(0),
    startsAt: timestamp('starts_at', { withTimezone: true }),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [uniqueIndex('content_blocks_store_kind_key_uq').on(t.storeId, t.kind, t.key)],
);
