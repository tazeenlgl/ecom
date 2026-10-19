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
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { productVariants } from './catalogue.js';
import { createdAt, timestamps } from './common.js';
import { customers } from './identity.js';
import { stores } from './tenancy.js';

// ---------------------------------------------------------------------------
// Carts
// ---------------------------------------------------------------------------

export const cartStatus = pgEnum('cart_status', ['active', 'merged', 'converted', 'abandoned']);

export const carts = pgTable(
  'carts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    customerId: uuid('customer_id'),
    // SHA-256 of the guest cart token; null once the cart belongs to a customer.
    guestTokenHash: text('guest_token_hash').unique(),
    status: cartStatus('status').notNull().default('active'),
    couponCode: text('coupon_code'),
    ...timestamps,
  },
  (t) => [
    unique('carts_store_id_uq').on(t.storeId, t.id),
    // One active cart per customer per store.
    uniqueIndex('carts_one_active_per_customer_uq')
      .on(t.storeId, t.customerId)
      .where(sql`${t.status} = 'active' and ${t.customerId} is not null`),
    foreignKey({
      name: 'carts_customer_fk',
      columns: [t.storeId, t.customerId],
      foreignColumns: [customers.storeId, customers.id],
    }).onDelete('cascade'),
  ],
);

export const cartItems = pgTable(
  'cart_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id').notNull(),
    cartId: uuid('cart_id').notNull(),
    variantId: uuid('variant_id').notNull(),
    quantity: integer('quantity').notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('cart_items_cart_variant_uq').on(t.cartId, t.variantId),
    foreignKey({
      name: 'cart_items_cart_fk',
      columns: [t.storeId, t.cartId],
      foreignColumns: [carts.storeId, carts.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'cart_items_variant_fk',
      columns: [t.storeId, t.variantId],
      foreignColumns: [productVariants.storeId, productVariants.id],
    }).onDelete('cascade'),
    check('cart_items_quantity_ck', sql`${t.quantity} between 1 and 100`),
  ],
);

// ---------------------------------------------------------------------------
// Orders. Five separate state machines live on/around an order; each one's
// legal transitions are defined in modules/orders/state-machines.ts.
// ---------------------------------------------------------------------------

export const orderStatus = pgEnum('order_status', ['pending_payment', 'confirmed', 'processing', 'completed', 'cancelled']);
export const paymentStatus = pgEnum('payment_status', [
  'unpaid',
  'pending',
  'paid',
  'failed',
  'cod_pending',
  'cod_collected',
  'partially_refunded',
  'refunded',
]);
export const fulfillmentStatus = pgEnum('fulfillment_status', [
  'unfulfilled',
  'packed',
  'shipped',
  'delivered',
  'delivery_failed',
  'returned_to_origin',
  'cancelled',
]);
export const posSyncStatus = pgEnum('pos_sync_status', ['pending', 'in_progress', 'synced', 'failed', 'manual_required']);
export const paymentMethod = pgEnum('payment_method', ['online', 'cod']);

export type AddressSnapshot = {
  name: string;
  phone: string;
  line1: string;
  line2?: string | null;
  landmark?: string | null;
  city: string;
  state: string;
  pincode: string;
  country: string;
};

export type AppliedPromotionSnapshot = {
  promotionId: string;
  name: string;
  kind: string;
  couponCode?: string;
  discountPaise: number;
  shippingDiscountPaise: number;
};

export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'restrict' }),
    orderNumber: text('order_number').notNull(),
    customerId: uuid('customer_id').notNull(),
    status: orderStatus('status').notNull(),
    paymentStatus: paymentStatus('payment_status').notNull(),
    fulfillmentStatus: fulfillmentStatus('fulfillment_status').notNull().default('unfulfilled'),
    posSyncStatus: posSyncStatus('pos_sync_status').notNull(),
    paymentMethod: paymentMethod('payment_method').notNull(),
    currency: text('currency').notNull(),
    subtotalPaise: integer('subtotal_paise').notNull(),
    discountPaise: integer('discount_paise').notNull(),
    shippingPaise: integer('shipping_paise').notNull(),
    codFeePaise: integer('cod_fee_paise').notNull().default(0),
    taxPaise: integer('tax_paise').notNull(),
    totalPaise: integer('total_paise').notNull(),
    refundedPaise: integer('refunded_paise').notNull().default(0),
    // Snapshots taken at order creation; never updated afterwards.
    customerSnapshot: jsonb('customer_snapshot').$type<{ name: string | null; phone: string; email: string | null }>().notNull(),
    shippingAddress: jsonb('shipping_address').$type<AddressSnapshot>().notNull(),
    appliedPromotions: jsonb('applied_promotions').$type<AppliedPromotionSnapshot[]>().notNull().default([]),
    // Client-supplied Idempotency-Key and a hash of the request it guarded.
    idempotencyKey: text('idempotency_key').notNull(),
    requestHash: text('request_hash').notNull(),
    posOrderRef: text('pos_order_ref'),
    placedAt: timestamp('placed_at', { withTimezone: true }).notNull().defaultNow(),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('orders_store_number_uq').on(t.storeId, t.orderNumber),
    uniqueIndex('orders_idempotency_uq').on(t.storeId, t.customerId, t.idempotencyKey),
    unique('orders_store_id_uq').on(t.storeId, t.id),
    index('orders_customer_idx').on(t.storeId, t.customerId, t.placedAt),
    index('orders_store_placed_idx').on(t.storeId, t.placedAt),
    index('orders_pos_sync_idx').on(t.posSyncStatus),
    foreignKey({
      name: 'orders_customer_fk',
      columns: [t.storeId, t.customerId],
      foreignColumns: [customers.storeId, customers.id],
    }).onDelete('restrict'),
    check(
      'orders_amounts_ck',
      sql`${t.totalPaise} >= 0 and ${t.discountPaise} >= 0 and ${t.refundedPaise} between 0 and ${t.totalPaise}`,
    ),
  ],
);

/** Immutable line snapshot. A database trigger rejects UPDATE and DELETE (migration 0002). */
export const orderItems = pgTable(
  'order_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id').notNull(),
    orderId: uuid('order_id').notNull(),
    // Kept for reporting; not a foreign key so catalogue edits/deletes never touch history.
    variantId: uuid('variant_id').notNull(),
    productId: uuid('product_id').notNull(),
    skuCode: text('sku_code').notNull(),
    productTitle: text('product_title').notNull(),
    variantTitle: text('variant_title').notNull(),
    options: jsonb('options').$type<Record<string, string>>().notNull().default({}),
    imageUrl: text('image_url'),
    quantity: integer('quantity').notNull(),
    mrpPaise: integer('mrp_paise').notNull(),
    unitPricePaise: integer('unit_price_paise').notNull(),
    discountPaise: integer('discount_paise').notNull(),
    taxRateBps: integer('tax_rate_bps').notNull(),
    taxPaise: integer('tax_paise').notNull(),
    lineTotalPaise: integer('line_total_paise').notNull(),
    createdAt,
  },
  (t) => [
    unique('order_items_store_id_uq').on(t.storeId, t.id),
    index('order_items_order_idx').on(t.orderId),
    foreignKey({
      name: 'order_items_order_fk',
      columns: [t.storeId, t.orderId],
      foreignColumns: [orders.storeId, orders.id],
    }).onDelete('restrict'),
    check('order_items_quantity_ck', sql`${t.quantity} > 0`),
  ],
);

/** Append-only timeline: every state change, note and integration event for an order. */
export const orderEvents = pgTable(
  'order_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id').notNull(),
    orderId: uuid('order_id').notNull(),
    // Which state machine or activity: order, payment, fulfillment, pos_sync, return, refund, note.
    machine: text('machine').notNull(),
    fromState: text('from_state'),
    toState: text('to_state'),
    actorType: text('actor_type').notNull(),
    actorId: text('actor_id'),
    note: text('note'),
    // Whether the customer may see this event.
    isPublic: boolean('is_public').notNull().default(false),
    createdAt,
  },
  (t) => [
    index('order_events_order_idx').on(t.orderId, t.createdAt),
    foreignKey({
      name: 'order_events_order_fk',
      columns: [t.storeId, t.orderId],
      foreignColumns: [orders.storeId, orders.id],
    }).onDelete('cascade'),
  ],
);

// ---------------------------------------------------------------------------
// Returns and exchanges
// ---------------------------------------------------------------------------

export const returnType = pgEnum('return_type', ['return', 'exchange']);
export const returnStatus = pgEnum('return_status', ['requested', 'approved', 'rejected', 'received', 'completed', 'cancelled']);

export const returnRequests = pgTable(
  'return_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id').notNull(),
    orderId: uuid('order_id').notNull(),
    type: returnType('type').notNull(),
    status: returnStatus('status').notNull().default('requested'),
    reason: text('reason').notNull(),
    // [{ orderItemId, quantity, exchangeVariantId? }]
    items: jsonb('items').$type<{ orderItemId: string; quantity: number; exchangeVariantId?: string }[]>().notNull(),
    resolutionNote: text('resolution_note'),
    ...timestamps,
  },
  (t) => [
    unique('return_requests_store_id_uq').on(t.storeId, t.id),
    index('return_requests_order_idx').on(t.orderId),
    foreignKey({
      name: 'return_requests_order_fk',
      columns: [t.storeId, t.orderId],
      foreignColumns: [orders.storeId, orders.id],
    }).onDelete('restrict'),
  ],
);
