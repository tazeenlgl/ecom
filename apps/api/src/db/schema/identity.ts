import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, timestamps } from './common.js';
import { stores } from './tenancy.js';

// ---------------------------------------------------------------------------
// Administrators (platform staff and store staff)
// ---------------------------------------------------------------------------

export const adminUserStatus = pgEnum('admin_user_status', ['active', 'disabled']);

export const adminUsers = pgTable('admin_users', {
  id: uuid('id').primaryKey().defaultRandom(),
  // Stored lower-cased.
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  status: adminUserStatus('status').notNull().default('active'),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  ...timestamps,
});

/**
 * Grants a code-defined role (see modules/iam/permissions.ts) to an admin.
 * `store_id` null means the grant applies to every store (platform scope).
 */
export const adminRoleAssignments = pgTable(
  'admin_role_assignments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    adminUserId: uuid('admin_user_id')
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    storeId: uuid('store_id').references(() => stores.id, { onDelete: 'cascade' }),
    createdAt,
  },
  (t) => [unique('admin_role_assignments_uq').on(t.adminUserId, t.role, t.storeId).nullsNotDistinct()],
);

export const adminSessions = pgTable(
  'admin_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    adminUserId: uuid('admin_user_id')
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'cascade' }),
    // SHA-256 of the bearer token; the token itself is never stored.
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    createdAt,
  },
  (t) => [index('admin_sessions_user_idx').on(t.adminUserId)],
);

// ---------------------------------------------------------------------------
// Customers (scoped to one store)
// ---------------------------------------------------------------------------

export const customerStatus = pgEnum('customer_status', ['active', 'blocked']);

export const customers = pgTable(
  'customers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'restrict' }),
    // E.164, e.g. +919876543210.
    phone: text('phone').notNull(),
    email: text('email'),
    name: text('name'),
    passwordHash: text('password_hash'),
    status: customerStatus('status').notNull().default('active'),
    phoneVerifiedAt: timestamp('phone_verified_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('customers_store_phone_uq').on(t.storeId, t.phone),
    // Target for composite foreign keys that pin child rows to the same store.
    unique('customers_store_id_uq').on(t.storeId, t.id),
  ],
);

export const customerSessions = pgTable(
  'customer_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id').notNull(),
    customerId: uuid('customer_id').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    createdAt,
  },
  (t) => [
    index('customer_sessions_customer_idx').on(t.customerId),
    foreignKey({
      name: 'customer_sessions_customer_fk',
      columns: [t.storeId, t.customerId],
      foreignColumns: [customers.storeId, customers.id],
    }).onDelete('cascade'),
  ],
);

export const otpPurpose = pgEnum('otp_purpose', ['login', 'reset_password']);

/**
 * One OTP challenge. The code is stored as an HMAC so a database leak does not
 * reveal live codes. `consumed_at` makes each challenge single-use.
 */
export const otpChallenges = pgTable(
  'otp_challenges',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    phone: text('phone').notNull(),
    purpose: otpPurpose('purpose').notNull(),
    codeHash: text('code_hash').notNull(),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    requestIp: text('request_ip'),
    createdAt,
  },
  (t) => [
    index('otp_challenges_phone_created_idx').on(t.storeId, t.phone, t.createdAt),
    index('otp_challenges_ip_created_idx').on(t.requestIp, t.createdAt),
  ],
);

export const customerAddresses = pgTable(
  'customer_addresses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id').notNull(),
    customerId: uuid('customer_id').notNull(),
    name: text('name').notNull(),
    phone: text('phone').notNull(),
    line1: text('line1').notNull(),
    line2: text('line2'),
    landmark: text('landmark'),
    city: text('city').notNull(),
    state: text('state').notNull(),
    pincode: text('pincode').notNull(),
    country: text('country').notNull().default('IN'),
    isDefault: boolean('is_default').notNull().default(false),
    ...timestamps,
  },
  (t) => [
    index('customer_addresses_customer_idx').on(t.storeId, t.customerId),
    foreignKey({
      name: 'customer_addresses_customer_fk',
      columns: [t.storeId, t.customerId],
      foreignColumns: [customers.storeId, customers.id],
    }).onDelete('cascade'),
    uniqueIndex('customer_addresses_one_default_uq').on(t.customerId).where(sql`${t.isDefault}`),
    check('customer_addresses_pincode_ck', sql`${t.pincode} ~ '^[1-9][0-9]{5}$'`),
  ],
);
