import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { productVariants } from './catalogue.js';
import { createdAt, timestamps } from './common.js';
import { orders } from './orders.js';
import { stores } from './tenancy.js';

/** Current online selling price per variant. All amounts are GST-inclusive paise. */
export const variantPrices = pgTable(
  'variant_prices',
  {
    storeId: uuid('store_id').notNull(),
    variantId: uuid('variant_id').notNull(),
    mrpPaise: integer('mrp_paise').notNull(),
    pricePaise: integer('price_paise').notNull(),
    updatedBy: text('updated_by'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.variantId] }),
    foreignKey({
      name: 'variant_prices_variant_fk',
      columns: [t.storeId, t.variantId],
      foreignColumns: [productVariants.storeId, productVariants.id],
    }).onDelete('cascade'),
    check('variant_prices_amounts_ck', sql`${t.pricePaise} > 0 and ${t.mrpPaise} >= ${t.pricePaise}`),
  ],
);

/** Append-only record of every price change. */
export const priceHistory = pgTable(
  'price_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id').notNull(),
    variantId: uuid('variant_id').notNull(),
    mrpPaise: integer('mrp_paise').notNull(),
    pricePaise: integer('price_paise').notNull(),
    changedBy: text('changed_by'),
    createdAt,
  },
  (t) => [
    index('price_history_variant_idx').on(t.variantId, t.createdAt),
    foreignKey({
      name: 'price_history_variant_fk',
      columns: [t.storeId, t.variantId],
      foreignColumns: [productVariants.storeId, productVariants.id],
    }).onDelete('cascade'),
  ],
);

export const promotionKind = pgEnum('promotion_kind', ['percentage', 'fixed_amount', 'buy_x_get_y', 'free_shipping']);
export const promotionStatus = pgEnum('promotion_status', ['active', 'inactive']);

/**
 * Kind-specific parameters, validated by `promotionConfigSchema` in modules/promotions.
 * - percentage:   { percentBps, maxDiscountPaise? }
 * - fixed_amount: { amountPaise }
 * - buy_x_get_y:  { buyQuantity, getQuantity, getDiscountBps }
 * - free_shipping: {}
 */
export type PromotionConfig = Record<string, number | undefined>;
export type PromotionEligibility = { productIds?: string[]; collectionIds?: string[] };

export const promotions = pgTable(
  'promotions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    kind: promotionKind('kind').notNull(),
    config: jsonb('config').$type<PromotionConfig>().notNull().default({}),
    // Empty eligibility means every product in the store.
    eligibility: jsonb('eligibility').$type<PromotionEligibility>().notNull().default({}),
    // Cart-value threshold: the eligible subtotal must reach this amount.
    minSubtotalPaise: integer('min_subtotal_paise').notNull().default(0),
    requiresCoupon: boolean('requires_coupon').notNull().default(false),
    // Higher runs first. See docs/ORDERS_AND_FULFILLMENT.md#promotions for stacking rules.
    priority: integer('priority').notNull().default(0),
    stackable: boolean('stackable').notNull().default(false),
    status: promotionStatus('status').notNull().default('active'),
    startsAt: timestamp('starts_at', { withTimezone: true }),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    usageLimit: integer('usage_limit'),
    perCustomerLimit: integer('per_customer_limit'),
    ...timestamps,
  },
  (t) => [
    unique('promotions_store_id_uq').on(t.storeId, t.id),
    index('promotions_store_status_idx').on(t.storeId, t.status),
    check('promotions_window_ck', sql`${t.endsAt} is null or ${t.startsAt} is null or ${t.endsAt} > ${t.startsAt}`),
  ],
);

export const coupons = pgTable(
  'coupons',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id').notNull(),
    promotionId: uuid('promotion_id').notNull(),
    // Stored upper-cased.
    code: text('code').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    usageLimit: integer('usage_limit'),
    createdAt,
  },
  (t) => [
    uniqueIndex('coupons_store_code_uq').on(t.storeId, t.code),
    foreignKey({
      name: 'coupons_promotion_fk',
      columns: [t.storeId, t.promotionId],
      foreignColumns: [promotions.storeId, promotions.id],
    }).onDelete('cascade'),
  ],
);

/** One row per promotion applied to a placed order. Usage limits count these rows. */
export const promotionRedemptions = pgTable(
  'promotion_redemptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id').notNull(),
    promotionId: uuid('promotion_id').notNull(),
    couponId: uuid('coupon_id').references(() => coupons.id, { onDelete: 'set null' }),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    customerId: uuid('customer_id'),
    discountPaise: integer('discount_paise').notNull(),
    // Set when the order is cancelled, so the usage is released.
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    createdAt,
  },
  (t) => [
    uniqueIndex('promotion_redemptions_order_uq').on(t.promotionId, t.orderId),
    index('promotion_redemptions_customer_idx').on(t.promotionId, t.customerId),
    foreignKey({
      name: 'promotion_redemptions_promotion_fk',
      columns: [t.storeId, t.promotionId],
      foreignColumns: [promotions.storeId, promotions.id],
    }).onDelete('restrict'),
  ],
);
