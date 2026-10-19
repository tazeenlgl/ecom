# Changelog

Dates are when the change was committed. Nothing has been deployed.

## 2026-10-19: Backend and database checkpoint (branch `claude/project-thread-4t2912`)

Added:
- **Schema and migrations:** `0001_commerce_core` adds 38 tables covering identity, catalogue, pricing, promotions, carts, orders, payments, shipping, returns, POS read model, jobs and content. `0002_order_snapshots_immutable` adds triggers that reject edits to order snapshots. Existing tables only gained columns: `stores.config`, `stores.pos_location_ref` and `store_domains.verification_token`.
- **Admin API (`/v1/admin`):**
  - Admin login, sessions, code-defined roles and per-store grants.
  - Brands, stores and settings.
  - Domain verification by DNS TXT record.
  - Catalogue: attributes, categories, size charts, collections, products, variants and media.
  - Prices with history.
  - Promotions and coupons.
  - Shipping zones and content.
  - Customers.
  - Orders: status, cancellation, shipments and tracking, returns, COD, refunds.
  - Jobs, POS diagnostics and recovery, sales report.
  - Audit log.
- **Storefront API (`/v1/storefront`):**
  - OTP and password login, sessions, password reset, profile and address book.
  - Catalogue reads, content, PIN-code serviceability.
  - Guest and customer carts with merge on login, and server-side quotes.
  - Idempotent checkout.
  - Orders, cancellation, returns and payment initiation.
- **Payment webhooks (`/v1/webhooks/payments/:provider`):** signature-verified and deduplicated. Handles out-of-order events, amount mismatches, late payments, refunds and reconciliation.
- **Worker:** durable PostgreSQL job queue (`npm run worker`) for POS order submission, stock sync, notifications, unpaid-order expiry, refunds and payment reconciliation.
- **OpenAPI:** generated from the route definitions (`/v1/openapi.json`, `docs/openapi.json`).
- **Tests:** 97 tests, including integration tests on real PostgreSQL.
- **Knowledge base:** `docs/`, `CLAUDE.md` and this changelog.

Changed:
- `docs/architecture.md` was renamed to `docs/ARCHITECTURE.md` and rewritten to describe the implemented system.
- `buildApp` now takes the full `Config` and optional adapter overrides.
- Error responses may include `details`. Database unique and foreign-key violations map to `409 conflict`.

Not included: storefront UI, admin UI, live SMS, payment, courier or POS adapters, and deployment.

## 2026-10-19: Platform foundation (`a25e7c7`)

- Fastify API, brand, store and domain schema (`0000_init`), host-based store resolution, health probes, `PosGateway` port, CI and Dockerfile.
- Phase 0 discovery report.
