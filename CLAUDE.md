# ecom — Project Context

Multi-brand, multi-domain e-commerce platform (India-first). One codebase + one admin serve many brands. Storefront is resolved server-side from the request `Host`. The existing POS stays authoritative for SKU identity and stock.

Repo: https://github.com/tazeenlgl/ecom (public — never commit secrets, customer data, or POS internals; plan to make private).

## Current state (HEAD a25e7c7, 2026-10-19)

Only Phase 0 + platform foundation exist. Single commit.

Done:
- `apps/api` — Fastify 5 + TypeScript (ESM) + Drizzle ORM + PostgreSQL 16
- Schema: `brands`, `stores`, `store_domains`, `audit_logs` (migration `0000_init.sql`)
- Tenant resolution: `Host` -> normalised hostname -> verified `store_domains` row -> `request.store`
- Health probes: `/health/live`, `/health/ready`
- Error handling (`AppError`, safe 500s), Pino logging with redaction, Zod env config
- `PosGateway` port only (types + interface, no adapter)
- Tests (Vitest, real Postgres), CI (GitHub Actions), Dockerfile, docker-compose (Postgres)

Not built: storefront (Next.js), admin, identity/auth, catalogue, pricing, cart, orders, payments, shipping, customers, content, notifications, reporting, POS adapter, background jobs.

## Layout

```
apps/api/
  src/app.ts                      buildApp({config, db}) — wires routes
  src/server.ts                   entrypoint, graceful shutdown
  src/config/env.ts               Zod env (NODE_ENV, HOST, PORT, LOG_LEVEL, DATABASE_URL, TRUST_PROXY)
  src/db/{schema,client,migrate}.ts
  src/lib/errors.ts               AppError + error/notFound handlers
  src/modules/health/             probes
  src/modules/tenancy/            host.ts, repository.ts, resolve-store.ts, routes.ts
  src/modules/pos/gateway.ts      PosGateway port, PosError
  test/                           helpers.ts, host.test.ts, tenancy.test.ts
  drizzle/                        generated SQL migrations
docs/architecture.md, docs/phase-0-discovery.md
```

Planned: `apps/web` (Next.js storefront, Phase 3), `apps/admin` (Phase 7), `packages/` only when a second consumer exists.

## Commands

```sh
cp .env.example .env
docker compose up -d postgres
npm install
npm run db:migrate
npm run dev                 # http://localhost:4000/health/ready
npm run typecheck
npm test                    # needs TEST_DATABASE_URL; DROPS + recreates its schema
npm run build
npm run db:generate -- --name <change_name>   # after editing src/db/schema.ts
```

Test DB: `TEST_DATABASE_URL=postgres://ecom:ecom@localhost:5432/ecom_test`. Never point it at a real database.
Try storefront API: insert brand + store + verified domain (e.g. `localhost`), then `curl -H 'Host: localhost' localhost:4000/v1/storefront/store`.

## Stack

Node >=22 (`.nvmrc` 22), npm workspaces, TypeScript 5.9, Fastify 5.12, Drizzle 0.45 + drizzle-kit, node-postgres, Zod 4, Pino, Vitest 3, tsx. Dependencies are pinned to exact versions.

## Architecture rules (do not violate)

1. Modular monolith. Modules talk via exported functions, never via each other's tables.
2. Tenant isolation: store comes only from the verified `Host`. Never trust client-sent store/brand IDs for auth.
3. Every store-owned table has `store_id`. Repository functions take the resolved store as a required argument.
4. Unknown host -> `404 store_not_found`; disabled store / archived brand -> same 404; maintenance -> `503 store_maintenance`; bad host -> `400 invalid_host`.
5. Cache keys must include `storeId`.
6. Admin/customer identities are store-scoped; platform admins get explicit cross-store roles.
7. POS owns SKU identity, stock quantity, inventory movements. E-commerce keeps only a read-only stock mirror with `synced_at`, and never writes stock adjustments.
8. E-commerce owns online prices, offers, coupons, cart, checkout, orders, payments, returns.
9. Money in paise (integers). Default currency INR, locale en-IN, tz Asia/Kolkata.
10. Schema changes only through reviewed, generated SQL migrations. Never edit an applied migration.
11. Background work (POS sync, notifications, webhooks) = separate worker process on a PostgreSQL job table. No Redis until a measured need.
12. Errors: throw `AppError(status, code, message)` for client-safe errors; never leak internals on 5xx. Env errors report variable names only, never values.

## POS integration (BLOCKED)

The POS backend is not in any visible repo. Server paths named in the brief: `/opt/tazeen-pos/offers-pos/backend` and `/opt/tazeen-pos/backend`. Unverified: live backend, API routes/auth, SKU model, stock model, order ingestion/reservation/cancel support.

- `PosGateway.capabilities()` gates every optional operation. Do not assume reserve/submit/cancel exist.
- No adapter until the real POS API/source is inspected (Phase 4).
- Fallback if POS cannot ingest orders: operator workflow + reconciliation report.

## Roadmap (from docs)

0 discovery (done) -> 1 architecture approval -> 3 Next.js multi-domain storefront -> 4 POS adapter + stock sync -> 7 admin panel. Phases 2, 5, 6 are not defined in the docs yet (catalogue/checkout/payments presumably) — confirm before assuming.

## Open decisions / blockers

1. Read-only access to POS server or source.
2. Approval of Phase 1 architecture.
3. Hosting for staging/production (nothing provisioned or deployed).
4. Make repo private.
5. Payment gateway, courier, OTP/notification providers: not chosen.

## Conventions

- Match existing style: ESM with `.js` import suffixes, named exports, small modules, Zod for validation.
- Add a Vitest integration test for every new route/module; tests run against real Postgres.
- CI must stay green: `typecheck`, `test`, `build`.
- Keep `.env.example` in sync with `src/config/env.ts`.
- Update `docs/architecture.md` module table when a module ships.
