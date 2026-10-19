# Requirements

Status key: **I** implemented · **P** partial · **PL** planned · **B** blocked. "Evidence" points at code or tests.

## Functional

| # | Requirement | Status | Evidence / notes |
| --- | --- | --- | --- |
| F1 | Resolve the store from a verified request hostname. Reject unknown, unverified, disabled and archived-brand hosts | I | `modules/tenancy`, `test/tenancy.test.ts` |
| F2 | Brands, stores, store settings, enable/disable | I | `modules/platform/routes.ts`, `test/admin.test.ts` |
| F3 | Domain ownership verification (DNS TXT) with audit | I | `modules/platform/routes.ts` |
| F4 | Platform and per-store admin permissions | I | `modules/iam/permissions.ts`, `test/unit.test.ts`, `test/admin.test.ts` |
| F5 | Audit log of admin changes | I | `lib/audit.ts`, `GET /v1/admin/stores/:storeId/audit-logs` |
| F6 | Indian mobile normalisation, OTP login and registration | I | `lib/india.ts`, `modules/customers` |
| F7 | OTP expiry, attempt limit, resend cooldown, per-phone and per-IP limits, single use | I | `modules/customers/otp.ts`, `test/auth.test.ts` |
| F8 | Optional password login, password change, OTP-based reset | I | `test/auth.test.ts` |
| F9 | Sessions and logout | I | `customer_sessions`, `admin_sessions` |
| F10 | Address book with PIN and state validation | I | `customer_addresses` |
| F11 | Products, variants, SKU mapping, categories and subcategories, collections | I | `modules/catalogue` |
| F12 | Flexible attributes (not apparel-specific), size charts, media metadata, specifications | I | `attribute_definitions`, `modules/catalogue/attributes.ts` |
| F13 | Publication status, slugs, SEO metadata | I | `products.status`, `seo` columns |
| F14 | Online price and MRP with history | I | `variant_prices`, `price_history` |
| F15 | Coupons, percentage, fixed, buy-X-get-Y, threshold, free-shipping offers | I | `modules/promotions/engine.ts` |
| F16 | Eligibility by product or collection, validity windows, usage and per-customer limits, priority and stacking | I | `modules/promotions/loader.ts`, `test/commerce.test.ts` |
| F17 | Guest and customer carts, merge on login | I | `modules/cart` |
| F18 | Server-side pricing, stale-price detection at checkout | I | `modules/checkout/quote.ts`, `expectedTotalPaise` |
| F19 | Idempotent order creation | I | `orders_idempotency_uq`, `test/commerce.test.ts` |
| F20 | Immutable order item, price, customer and address snapshots | I | migration `0002`, `test/commerce.test.ts` |
| F21 | Separate order, payment, fulfillment, POS-sync and return/refund state machines with legal transitions only | I | `modules/orders/state-machines.ts` |
| F22 | Cancellation, return and exchange requests | I | `modules/orders/*-routes.ts` |
| F23 | Provider-neutral payments, verified webhooks, duplicate and out-of-order handling, refunds, reconciliation | I (fake provider); P (Paytm, not yet run on staging) | `modules/payments`, `test/payments.test.ts`, `test/paytm.test.ts` |
| F24 | COD | I | `cod-collected` endpoint, zone COD flags |
| F25 | Shipping zones, PIN serviceability, charges | I | `modules/shipping` |
| F26 | Shipments, tracking events, delivery failure, RTO | I (manual entry) | `shipments`, `shipment_events` |
| F27 | Courier integration | B | No courier chosen. `CourierAdapter` port only |
| F28 | POS SKU mapping, stock sync, order submission, retries, recovery, diagnostics | P | Port, jobs and test double done. Real adapter blocked ([POS_INTEGRATION.md](POS_INTEGRATION.md)) |
| F29 | Content: brand config, homepage sections, navigation, banners and campaigns, pages, FAQs, policies, SEO | I | `modules/content`, `modules/platform/settings.ts` |
| F30 | Reporting | P | Daily sales and top SKUs only |
| F31 | Notifications (OTP, order, payment, shipping, return, refund) | P | Jobs and templates are named. Delivery is log-only |
| F32 | Storefront and admin UIs | PL | Not started by instruction |

## Non-functional

| # | Requirement | Status | Notes |
| --- | --- | --- | --- |
| N1 | Tenant isolation in every query, API and job | I | See [TENANCY.md](TENANCY.md). Composite foreign keys enforce it in the database too |
| N2 | No client-supplied price or total is authoritative | I | Quotes are recomputed. Checkout compares `expectedTotalPaise` only to detect change |
| N3 | Input validation on every endpoint | I | Zod via `defineRoute` |
| N4 | Standard error format, no stack traces | I | `lib/errors.ts` |
| N5 | Request ids and structured logs | I | `x-request-id`, pino |
| N6 | Secrets never logged; OTPs and passwords never stored in plain text | I | HMAC-hashed OTPs, scrypt passwords, header redaction |
| N7 | Idempotency for sensitive operations | I | Checkout, refunds, webhooks, jobs |
| N8 | Rate limits on sensitive endpoints | P | Database-backed for OTP. In-process for logins (per instance) |
| N9 | Durable, retryable, observable background jobs | I | `jobs` table, backoff, dead-letter, admin retry |
| N10 | Versioned, additive migrations | I | [MIGRATIONS.md](MIGRATIONS.md) |
| N11 | OpenAPI contract | I | Generated, CI drift check |
| N12 | Integration tests on real PostgreSQL | I | [TESTING.md](TESTING.md) |
