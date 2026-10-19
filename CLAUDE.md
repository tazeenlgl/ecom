# CLAUDE.md

Read this first, then [docs/INDEX.md](docs/INDEX.md). Keep this file short.

## What this is

A multi-brand, multi-domain e-commerce backend for India: a TypeScript modular monolith in `apps/api` (Fastify 5, Drizzle ORM, PostgreSQL 16, Zod, Vitest). Storefront and admin UIs are **not** built yet. Do not start them until the backend checkpoint is approved by the project owner.

## Non-negotiable rules

1. **The POS owns SKU identity and stock.** `product_variants.sku_code` maps to a POS SKU and is never minted here. `pos_stock_levels` is a read-only cache written only by POS sync. Never add a stock ledger or stock adjustments.
2. **The POS API is unverified.** Do not write a POS adapter against a guessed contract. `PosGateway` (`src/modules/pos/gateway.ts`) has optional capabilities. Flows must branch on `capabilities()`.
3. **Tenancy:** the storefront store comes only from the verified `Host` (`src/modules/tenancy`). Never accept a store id from the client. Every store-owned query filters by `store_id`. Admin routes take `:storeId` in the path, and `defineRoute` checks the permission for that store.
4. **Money:** integer paise, GST-inclusive. The server always recalculates prices (`src/modules/checkout/quote.ts`). Never trust a client price, discount or total.
5. **State changes** go through `transitionOrder` and `MACHINES` (`src/modules/orders/state-machines.ts`). Never add a generic status update.
6. **No live providers.** SMS, payments and courier have only log, fake or no adapters. Do not add real credentials, send real messages or move money without explicit approval.
7. **Migrations are additive and never edited once merged.** Change `src/db/schema/*.ts`, run `npm run db:generate -- --name <x>`, and review the SQL. Never run migrations against production without separate approval.
8. Never commit secrets, never log OTPs, passwords or tokens, and never deploy without the owner's explicit approval.

## Conventions

- Define routes with `defineRoute` (`src/lib/route.ts`). It gives you Zod validation, auth, permissions, idempotency keys, rate limits and OpenAPI. After route changes, run `npm run openapi -w @ecom/api` (CI checks `docs/openapi.json` is current).
- Errors: throw `AppError(status, code, message)`. Codes are listed in `src/lib/errors.ts` and are part of the API contract.
- Admin writes call `recordAudit` inside the same transaction.
- Side effects such as POS calls, notifications and refunds go through `enqueueJob` (`src/modules/jobs/queue.ts`) in the same transaction, with an idempotency key. Handlers must be idempotent and scoped to `job.storeId`.
- Zod schemas used for `PATCH` must have **no `.default()`** (Zod 4 applies defaults inside `.partial()`). Put defaults on a separate create schema.
- Keep comment density and style as in the surrounding code.

## Commands

`npm run typecheck`, `npm test` (needs `TEST_DATABASE_URL`; it drops that DB's schema), `npm run build`, `npm run db:migrate`, `npm run openapi -w @ecom/api`.

## Before you finish

Run typecheck, tests and build. Update the docs you affected (at least [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md), [docs/KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md) and [CHANGELOG.md](CHANGELOG.md)) and label features as implemented, partial, planned or blocked. Record new decisions in [docs/DECISIONS.md](docs/DECISIONS.md).
