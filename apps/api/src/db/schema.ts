// Single entry point for the Drizzle schema (used by drizzle-kit and the app).
// Each file under ./schema holds one domain's tables.
export * from './schema/tenancy.js';
export * from './schema/identity.js';
export * from './schema/catalogue.js';
export * from './schema/pricing.js';
export * from './schema/orders.js';
export * from './schema/payments.js';
export * from './schema/operations.js';
