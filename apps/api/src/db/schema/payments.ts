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
import { createdAt, timestamps } from './common.js';
import { orders, returnRequests } from './orders.js';
import { stores } from './tenancy.js';

export const transactionStatus = pgEnum('payment_transaction_status', ['created', 'pending', 'succeeded', 'failed', 'cancelled']);

/** One attempt to collect money for an order through a provider (or COD). */
export const paymentTransactions = pgTable(
  'payment_transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id').notNull(),
    orderId: uuid('order_id').notNull(),
    provider: text('provider').notNull(),
    // Provider's identifier for this payment/order; null until the provider returns one.
    providerRef: text('provider_ref'),
    status: transactionStatus('status').notNull().default('created'),
    amountPaise: integer('amount_paise').notNull(),
    currency: text('currency').notNull(),
    failureCode: text('failure_code'),
    ...timestamps,
  },
  (t) => [
    unique('payment_transactions_store_id_uq').on(t.storeId, t.id),
    uniqueIndex('payment_transactions_provider_ref_uq').on(t.provider, t.providerRef),
    index('payment_transactions_order_idx').on(t.orderId),
    index('payment_transactions_status_idx').on(t.status, t.createdAt),
    // At most one successful collection per order.
    uniqueIndex('payment_transactions_one_success_uq').on(t.orderId).where(sql`${t.status} = 'succeeded'`),
    foreignKey({
      name: 'payment_transactions_order_fk',
      columns: [t.storeId, t.orderId],
      foreignColumns: [orders.storeId, orders.id],
    }).onDelete('restrict'),
    check('payment_transactions_amount_ck', sql`${t.amountPaise} > 0`),
  ],
);

/**
 * Raw provider webhook events. The unique (provider, provider_event_id) key makes
 * duplicate deliveries a no-op. Rows are kept for audit and reconciliation.
 */
export const paymentEvents = pgTable(
  'payment_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: text('provider').notNull(),
    providerEventId: text('provider_event_id').notNull(),
    eventType: text('event_type').notNull(),
    providerRef: text('provider_ref'),
    // Resolved from provider_ref; null when the event matches no transaction.
    storeId: uuid('store_id'),
    transactionId: uuid('transaction_id'),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    signatureVerified: boolean('signature_verified').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    // e.g. 'applied', 'ignored_stale', 'amount_mismatch', 'unknown_transaction'.
    outcome: text('outcome'),
    receivedAt: createdAt,
  },
  (t) => [
    uniqueIndex('payment_events_provider_event_uq').on(t.provider, t.providerEventId),
    index('payment_events_ref_idx').on(t.provider, t.providerRef),
  ],
);

export const refundStatus = pgEnum('refund_status', ['pending', 'processing', 'succeeded', 'failed']);

export const refunds = pgTable(
  'refunds',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id').notNull(),
    orderId: uuid('order_id').notNull(),
    // Null for COD refunds paid out manually.
    paymentTransactionId: uuid('payment_transaction_id'),
    returnRequestId: uuid('return_request_id'),
    amountPaise: integer('amount_paise').notNull(),
    reason: text('reason').notNull(),
    status: refundStatus('status').notNull().default('pending'),
    providerRef: text('provider_ref'),
    idempotencyKey: text('idempotency_key').notNull(),
    failureCode: text('failure_code'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('refunds_idempotency_uq').on(t.storeId, t.idempotencyKey),
    index('refunds_order_idx').on(t.orderId),
    foreignKey({
      name: 'refunds_order_fk',
      columns: [t.storeId, t.orderId],
      foreignColumns: [orders.storeId, orders.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'refunds_transaction_fk',
      columns: [t.storeId, t.paymentTransactionId],
      foreignColumns: [paymentTransactions.storeId, paymentTransactions.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'refunds_return_fk',
      columns: [t.storeId, t.returnRequestId],
      foreignColumns: [returnRequests.storeId, returnRequests.id],
    }).onDelete('restrict'),
    check('refunds_amount_ck', sql`${t.amountPaise} > 0`),
  ],
);

/**
 * Per-store gateway credentials, edited by store admins. The merchant key is
 * stored encrypted (AES-256-GCM, CONFIG_ENCRYPTION_KEY) and never returned by the API.
 */
export const paymentGatewayConfigs = pgTable(
  'payment_gateway_configs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    enabled: boolean('enabled').notNull().default(false),
    environment: text('environment').notNull().default('staging'),
    merchantId: text('merchant_id').notNull(),
    websiteName: text('website_name').notNull(),
    callbackUrl: text('callback_url').notNull(),
    merchantKeyEncrypted: text('merchant_key_encrypted').notNull(),
    updatedBy: text('updated_by'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('payment_gateway_configs_store_provider_uq').on(t.storeId, t.provider),
    check('payment_gateway_configs_environment_ck', sql`${t.environment} in ('staging', 'production')`),
  ],
);
