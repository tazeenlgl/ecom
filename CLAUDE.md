# CLAUDE.md

Project instructions for Claude Code. Read this first, then [docs/INDEX.md](docs/INDEX.md). Status and evidence live in [ecom-context.md](ecom-context.md). Keep this file short.

**Implemented does not mean production verified.** Nothing is deployed. No production deployment, production migration or live provider call is authorized.

## What this is

A multi-brand, multi-domain e-commerce platform for India, as an npm-workspaces monorepo (Node 22, TypeScript). One codebase and one admin serve many brands; each storefront is resolved on the server from its verified domain.

| Path | What |
| --- | --- |
| `apps/api` | Fastify 5 + Drizzle ORM + PostgreSQL 16 + Zod 4 + Vitest. Storefront, admin and webhook endpoints; separate worker process (`src/worker.ts`) |
| `apps/web` | Next.js 15 storefront for all stores (port 3000). A BFF route keeps tokens in httpOnly cookies |
| `apps/admin` | Next.js 15 admin for platform and store administrators (port 3001). Uses only `/v1/admin/*`. First release, partial ([docs/ADMIN.md](docs/ADMIN.md)) |
| `apps/api/drizzle` | SQL migrations `0000`-`0004` |
| `docs/` | Knowledge base and generated `openapi.json` |

The API is a modular monolith under `apps/api/src/modules` (tenancy, iam, catalogue, pricing via catalogue, promotions, cart, checkout, orders, payments, shipping, customers, content, jobs, notifications, pos, platform, reports, health). Modules talk through exported functions, not each other's tables.

## Non-negotiable rules

1. **The POS owns SKU identity and stock.** `product_variants.sku_code` maps to a POS SKU and is never minted here. `pos_stock_levels` is a read-only cache written only by POS sync. No stock ledger, no stock adjustments.
2. **The POS API is unverified.** Do not write an adapter against a guessed contract. `PosGateway` (`src/modules/pos/gateway.ts`) has optional capabilities; flows branch on `capabilities()`. Only `UnconfiguredPosGateway` and the test double `InMemoryPosGateway` exist.
3. **Tenancy:** the storefront store comes only from the verified `Host` (`src/modules/tenancy`). Never accept a store id from the client. Every store-owned query filters by `store_id`. Admin routes take `:storeId` in the path and `defineRoute` checks the permission for that store.
4. **Money:** integer paise, GST-inclusive. The server recalculates prices (`src/modules/checkout/quote.ts`); never trust a client price, discount or total.
5. **State changes** go through `transitionOrder` and `MACHINES` (`src/modules/orders/state-machines.ts`). No generic status update.
6. **No live providers.** SMS has only `log` and `disabled` senders; payments have `none`, `fake` and the per-store Paytm adapter; there is no courier or POS adapter. Do not add real credentials, send real messages or move money without explicit approval.
7. **Paytm is implemented, not verified.** It has only run against a simulated Paytm API. Treat it as unverified until a real staging transaction succeeds. Never call Paytm (staging or live) from tests, CI or scripts without approval.
8. **Migrations are additive and never edited once merged.** Change `src/db/schema/*.ts`, run `npm run db:generate -- --name <x>`, review the SQL. Never run migrations against a shared or production database without separate approval.
9. Never commit secrets, never log OTPs, passwords or tokens, never deploy without the owner's explicit approval. The repository is public.

## Conventions

- Define routes with `defineRoute` (`src/lib/route.ts`): Zod validation, auth, permissions, idempotency keys, rate limits, OpenAPI. After route changes run `npm run openapi -w @ecom/api`; CI fails if `docs/openapi.json` is stale.
- Errors: throw `AppError(status, code, message)`. Codes in `src/lib/errors.ts` are part of the API contract.
- Admin writes call `recordAudit` in the same transaction.
- Side effects (POS calls, notifications, refunds) go through `enqueueJob` (`src/modules/jobs/queue.ts`) in the same transaction with an idempotency key. Handlers must be idempotent and scoped to `job.storeId`.
- `PATCH` Zod schemas must have **no `.default()`** (Zod 4 applies defaults inside `.partial()`).
- Web and admin never decide authorization; the API does. The UIs only hide what a role cannot do.
- Match surrounding style and comment density.

## Auth and permissions (summary; details in [docs/SECURITY.md](docs/SECURITY.md))

- **Customers:** Indian mobile OTP (`+91`, 6-9 start; 6 digits, 5-minute expiry, 5 attempts, HMAC-stored) or optional password (scrypt). Sessions are bearer tokens stored hashed and bound to one store. Account phase 1: password set/change/reset, addresses, orders, cancel, returns. **OTP delivery is not real:** no SMS provider exists, so sign-in cannot be completed against a running local API by hand.
- **Admins:** email + password, hashed sessions (`ADMIN_SESSION_TTL_HOURS`). Roles in `src/modules/iam/permissions.ts`: `platform_owner`, `store_manager`, `catalogue_editor`, `order_manager`, `support`; a grant with NULL `store_id` is platform-wide. No MFA. Admin UI: httpOnly SameSite=Strict cookie, double-submit CSRF, BFF at `/api/admin/*`.
- First admin: `ADMIN_PASSWORD=... npm run admin:create -w @ecom/api -- <email> "<name>"`.

## Payments, orders, refunds (summary; see [docs/PAYMENTS.md](docs/PAYMENTS.md))

- Provider-neutral design. Online orders start `pending_payment`; **only a verified webhook (or reconciliation) confirms payment**, never a browser redirect. At most one succeeded payment per order (unique index).
- Paytm: per-store merchant ID and key set via `PUT /v1/admin/stores/:storeId/payment-gateways/paytm` (key encrypted with `CONFIG_ENCRYPTION_KEY`, write-only). No UI to enter it yet. Staging Paytm is refused when `NODE_ENV=production`; production Paytm needs `PAYTM_PRODUCTION_ENABLED=true` (owner approval).
- Unverified Paytm details: hosts, endpoint paths and response fields, checksum parity, notification field names, API response signatures, refund-status contract. Refunds stay `processing` until staff settle them with `mark-succeeded` / `mark-failed` (provider refund id required; failed money held 24 h).
- Reconciliation (`payments.reconcile` job) uses `clock_timestamp()` ordering, tolerates per-payment errors, closes abandoned attempts, and re-checks abandoned attempts for 48 h. Recurring jobs are **not scheduled**; an admin must queue them.
- COD works when the store enables it; staff record collection.

## Database and migrations

PostgreSQL 16, Drizzle. Five migrations applied only to local/test databases. Policy: [docs/MIGRATIONS.md](docs/MIGRATIONS.md). Order snapshots are immutable via triggers (`0002`). Never run migrations against production.

## TRUST_PROXY (must be right before any deploy)

`TRUST_PROXY` controls which peers may set `X-Forwarded-For` / `X-Forwarded-Host`. Values: `false` (default), a hop count 1-8, or a comma-separated list of IPs/CIDRs/`loopback`/`linklocal`/`uniquelocal`.
- **Local development:** `loopback` (or `true`; trusts every caller, never expose it).
- **Production:** `true` is refused at startup. Use the addresses of the web/admin servers that call the API (preferred); a hop count trusts whoever connects directly.
- The storefront server calls the API with its own `Host` and puts the shop domain in `X-Forwarded-Host`. A wrong value makes the shop 404; it never serves another store.
- The edge proxy must overwrite `X-Forwarded-*`; web/admin forward a client IP only per `TRUSTED_PROXY_HOPS` (default `0`). The real topology and addresses are not known to this repo ([docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)).

## Environment

Full table: [docs/ENVIRONMENT_VARIABLES.md](docs/ENVIRONMENT_VARIABLES.md). Local defaults: `.env.example`. Production refuses to start with the dev `OTP_HMAC_SECRET`, dev `CONFIG_ENCRYPTION_KEY`, `SMS_PROVIDER=log`, `PAYMENT_PROVIDER=fake` or `TRUST_PROXY=true`. Web uses `API_URL` (`apps/web/.env.example`); admin uses `ADMIN_API_URL` and `TRUSTED_PROXY_HOPS` (`apps/admin/.env.example`; the web server reads `TRUSTED_PROXY_HOPS` too).

## Commands (repo root)

```sh
cp .env.example .env && docker compose up -d postgres && npm install
npm run db:migrate                          # DATABASE_URL; local only
npm run dev                                 # API :4000
npm run dev:worker -w @ecom/api             # worker
npm run dev -w @ecom/web                    # storefront :3000
npm run dev -w @ecom/admin                  # admin :3001
npm run typecheck && npm test && npm run build
npm run openapi -w @ecom/api                # regenerate docs/openapi.json
npm run db:generate -- --name <change>
```

`npm test` needs `TEST_DATABASE_URL` (default `postgres://ecom:ecom@localhost:5432/ecom_test`) and **drops that database's `public` schema**; setup refuses a database whose name does not end in `_test`. `apps/admin/test/e2e-roles.mjs` runs against a local stack only and is not in CI.

## CI

`.github/workflows/ci.yml` on every push and pull request (Node 22, Postgres 16 service): `npm ci`, `npm run typecheck`, `npm test`, `npm run build`, then regenerate OpenAPI and `git diff --exit-code docs/openapi.json`. CI uses fakes only; it makes no Paytm, SMS or POS calls.

## Known gaps and next priorities (full list: [docs/KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md))

Gaps: no stock data without a POS adapter (every variant is `stock_unknown`, so checkout works only in tests); no live SMS, courier or POS; Paytm unverified; in-process rate limits; recurring jobs unscheduled; no admin MFA; Paytm refund status not automatic; admin UI gaps ([docs/ADMIN.md](docs/ADMIN.md)).
Priorities, each needing approval: verify the POS contract; a Paytm staging test; a job scheduler and shared rate limits; choose SMS and courier providers; confirm proxy topology; make the repo private; staging environment. Several docs under `docs/` and the README still describe earlier states (see `ecom-context.md`); fix them when you touch them.

## Before you finish

Run typecheck, tests and build. Update the docs you affected (at least [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md), [docs/KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md) and [CHANGELOG.md](CHANGELOG.md)), label features implemented, partial, planned or blocked, and record decisions in [docs/DECISIONS.md](docs/DECISIONS.md).
