# Changelog

Dates are when the change was committed. Nothing has been deployed.

## 2026-11-05: PR #3 review corrections H1 and H2 (uncommitted)

Changed:
- Payment reconciliation moves a checked payment to the back of the queue with the database clock (`clock_timestamp()`, microseconds, like `created_at`) instead of a millisecond `new Date()`. Two rows handled in the same millisecond used to tie, and the random id decided their order, which failed `payment-safety.test.ts` in CI (reproduced locally in 4 of 12 runs). Which payments are selected, and the order (`updated_at`, then id), are unchanged.
- The two reconciliation ordering tests no longer depend on ids or on other tests' rows: they isolate their own payments and compare with the queue order the database reports. New tests: a payment never checked is taken before one that keeps failing; a tie is broken by id; consecutive touches get distinct stamps.
- New `apps/api/test/proxy-production.test.ts`: production-mode configuration (address list, hop count, default), store resolution through the headers the storefront server really sends, untrusted peers cannot choose the store, fail-closed 404 without `TRUST_PROXY`, and unsafe values refused at startup. One characterisation test records that a hop count trusts whoever connects directly.
- `docs/DEPLOYMENT.md` now has "TRUST_PROXY by environment" and the list of facts to confirm before deploying. The stale advice in `apps/web/.env.example` and `apps/web/README.md` that the API must run with `TRUST_PROXY=true` was corrected.
- No production behaviour of `TRUST_PROXY` changed in this step. The actual proxy topology and addresses are not known to this repository and remain to be confirmed.

## 2026-11-05: Payment safety, review fixes (uncommitted)

Changed:
- Reconciliation keeps checking an abandoned payment attempt for 48 hours after its creation. A provider-confirmed success goes through the late-payment path (recorded, order stays cancelled, full refund once). Before this, a lost webhook after abandonment left the customer charged with no refund.
- Manual settlement of online refunds is stricter: the provider refund id must be entered back (`mark-succeeded` `reference`; `mark-failed` now takes `reference` and a `reason` of at least 10 characters). A refund marked failed by mistake can be corrected with `mark-succeeded`. Confirmation is refused if the order would be refunded above its total. The money of a failed, provider-accepted refund is held for 24 hours before a new refund can use it. Audit entries carry the actor, reference, provider refund id and previous status; `refund.manual_correction` is new; the order timeline gets a staff-only note.
- The order page shows the provider refund id and offers the confirm, fail and correct actions.
- Migration `0004_refund_settlement` (additive): the refund row records how it was settled: `settlement_source` (`provider` or `manual`), who (`settled_by_type`, `settled_by_id`), when (`settled_at`), the reference and a note. Webhooks record `provider` with the event id; staff settlements record `manual` with the entered reference and reason. A manual failure now has failure code `manual_failure` instead of a `manual: ` prefix, and the 24-hour hold uses `settled_at`. The admin order page shows the settlement. Applied only to disposable test databases.

## 2026-11-05: Payment safety (uncommitted)

Changed:
- Paytm staging is refused when `NODE_ENV=production`: the admin save answers `409`, a saved staging configuration is not enabled, and a staging notification is rejected. `GET .../payment-gateways/paytm` gains `blockedReason`.
- The admin Payments card showed no merchant ID because it read `mid`; it now reads `merchantId`, and also shows the environment and why a configuration is blocked.
- Online refunds stuck in `processing` can be settled by staff: `mark-succeeded` now accepts an online refund in `processing` (keeping the provider reference), and the new `POST .../refunds/{id}/mark-failed` records a refund that did not complete. The order page offers both.
- Payment reconciliation checks the least recently checked payments first, continues past a provider error for one payment, and throws at the end if any failed.
- A pending payment whose order was cancelled is closed as `cancelled` (`abandoned`). A late success is still recorded and refunded (transaction state `cancelled -> succeeded` is allowed).
- A success arriving after the payment window but before the expiry job no longer confirms the order: it is cancelled and refunded (new outcome `paid_after_expiry`).
- No migration. New tests: `apps/api/test/payment-safety.test.ts` and a block in `paytm.test.ts`.

## 2026-11-05: Customer account, phase 1 (uncommitted)

Added:
- Account security page (`/account/security`): set a password, or change it with the current one. Forgot-password flow in the sign-in form (reset code by OTP, then a new password). Both use the existing `PUT /me/password`, `POST /auth/otp/request` (`purpose: reset_password`) and `POST /auth/password/reset`; no endpoint was added.
- A shared accessible `Dialog` (`apps/web/components/dialog.tsx`): labelled, Close button, Escape and backdrop close, focus trap, focus returned to the opener, page scroll locked, closing disabled while a request is in flight. Used by the cancel, return/exchange and address-delete dialogs.
- Cancel dialog: shows what will be refunded before confirming (`actions.cancelRefund`, a new additive field on the storefront order view; `null` when nothing was collected), cannot be submitted twice, shows progress, and the order page confirms the outcome afterwards.
- Address book: the first address becomes the default; deleting the default promotes the newest remaining address; unsetting the default by editing it is ignored (make another address the default instead); deleting asks for confirmation. The list is reloaded from the API after each change.
- `apps/api/test/customer-account.test.ts`, `apps/web/test/password.test.ts`, `apps/web/test/cancel.test.ts`.

Changed:
- `PUT /v1/storefront/me/password` answers a wrong current password with `422 invalid_request` (`details.field = "currentPassword"`) instead of `401`. A 401 made the storefront proxy drop the session cookie, signing the customer out.
- `PATCH /v1/storefront/me` rejects a body with neither `name` nor `email` (400) instead of failing on an empty update set; the name is trimmed and the email lower-cased.
- `PATCH /v1/storefront/me/addresses/:id` with an empty body returns the address unchanged.
- `cancelOrder` takes the refund amount from the shared `cancelRefundPaise` (same value as before; an order with nothing left to refund no longer attempts a zero refund).
- `docs/openapi.json` regenerated. It also picks up `PATCH /v1/admin/stores/{storeId}/customers/{id}` (block/unblock), which was missing.

Not changed: no migration (the one-default-per-customer unique index already existed), authentication, sessions, SMS, or other storefront features. The new API tests were type-checked but not run: no PostgreSQL test database was available.

## 2026-11-05: Admin dashboard (`apps/admin`, branch `feature/multi-store-admin`)

Added:
- A Next.js 15 admin on port 3001 for platform and store administrators: brands, stores, administrators and role grants, a store selector limited to authorised stores, catalogue (products, variants, prices, photos, categories, collections), promotions and coupons, orders (status, cancel, notes, shipments, COD, returns, refunds, POS recovery), customers, pages and blocks, shipping zones, store settings and domains, POS status, jobs, audit history and the sales report. See [docs/ADMIN.md](docs/ADMIN.md).
- Server-side admin sessions: the API bearer token lives in an httpOnly SameSite=Strict cookie, writes need a double-submit CSRF token, sign-out revokes the token at the API.
- `apps/admin/test`: unit tests for permissions, CSRF and proxy paths, and `e2e-roles.mjs` (57 checks of four roles, cross-store access and session revocation against a running local stack).
- `apps/api/test/regressions.test.ts`.

Fixed:
- `GET /v1/admin/stores/:storeId/reports/sales` returned 500 (Postgres `GROUP BY` error). It now groups by position.
- `GET /v1/storefront/products` always returned `null` for `minPricePaise`, `maxMrpPaise` and `imageUrl`, because the correlated subqueries compared against an unqualified `id`. They are now table-qualified.

Not changed: no migrations, no endpoint was added or changed in shape (`docs/openapi.json` is unchanged).

## 2026-11-05: Storefront UI (`apps/web`)

Added:
- A Next.js 15 storefront serving every store from its host: home page from content blocks, listings, search, product pages, bag, OTP sign-in, checkout with Paytm or COD, and the customer account (orders, tracking, cancel, returns, addresses). See `apps/web/README.md`.
- A backend-for-frontend route that keeps session and cart tokens in httpOnly cookies and proxies only storefront paths, so the API needs no CORS.
- `apps/web/scripts/demo-store.sql`, a local-only demo store.

Not changed: no API code or migrations.

## 2026-10-19: Paytm payment gateway (branch `claude/project-thread-4t2912`)

Added:
- A Paytm adapter (`modules/payments/paytm/`). It covers initiate transaction, checksum-verified server notifications, order status (used by reconciliation) and refund apply. It defaults to staging. **Status: partial.** It has not been run against Paytm staging yet; see `docs/PAYMENTS.md#paytm`.
- Per-store Paytm settings, edited through `GET/PUT /v1/admin/stores/:storeId/payment-gateways/paytm` (`store.settings.manage`). The merchant key is encrypted with AES-256-GCM (`CONFIG_ENCRYPTION_KEY`) and never returned or logged.
- Migration `0003_paytm_gateway_config`: one additive table, `payment_gateway_configs`.
- New environment variables: `CONFIG_ENCRYPTION_KEY`, `PAYTM_STAGING_HOST`, `PAYTM_PRODUCTION_HOST` and `PAYTM_PRODUCTION_ENABLED`, which defaults to `false`.

Changed:
- The `PaymentProvider` methods now receive the store id, so credentials can differ per store.
- `parseWebhook` may be async and may return `null` for a verified notification that carries no state change.

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
