# Development

## Setup

Prerequisites: Node 22 (`.nvmrc`) and PostgreSQL 16. `docker compose up -d postgres` starts PostgreSQL with user, password and database all named `ecom`.

```sh
cp .env.example .env
npm install
npm run db:migrate
ADMIN_PASSWORD='a-long-local-password' npm run admin:create -w @ecom/api -- you@example.com "Your Name"
npm run dev                       # API on :4000, reloads on change
npm run dev:worker -w @ecom/api   # background jobs, separate terminal
```

## Layout

```
apps/api/
  src/
    server.ts            API entry point
    worker.ts            Job runner entry point
    app.ts               buildApp / createContext: wiring, hooks, error handling, route registration
    context.ts           AppContext type (config, db, pos, payments, messages, dns, now)
    config/env.ts        Environment validation
    db/                  client, migrate script, schema/*.ts
    lib/                 route helper, errors, crypto, pagination, audit, rate limiter, OpenAPI builder
    modules/<area>/      business modules (see ARCHITECTURE.md)
    scripts/             create-admin, openapi
  drizzle/               SQL migrations + journal
  test/                  Vitest suites, helpers, test doubles
docs/                    this knowledge base + openapi.json
```

## Adding an endpoint

1. Add it to the module's routes file with `defineRoute(app, { method, url, summary, tag, auth, params, query, body, status }, handler)`.
   - `auth` is `'public'`, `'customer'`, or `{ admin: '<permission>' }` (`{ admin: null }` for any signed-in admin).
   - Store-scoped admin routes use `/stores/:storeId/...` and `storeParams` or `storeEntityParams`.
   - Set `idempotencyKey: true` for operations that create money movements or orders.
2. Filter every query by the store: `request.store.id` on the storefront, `params.storeId` on admin routes. Include `customer_id` for customer data.
3. Use a transaction for multi-row changes. Record admin changes with `recordAudit` and order changes with `transitionOrder` or `addOrderEvent`.
4. Return explicit fields. Never return hashes, tokens or internal keys.
5. Run `npm run openapi -w @ecom/api` and commit `docs/openapi.json`. CI fails if it is stale.
6. Add tests, including a cross-store test for anything store-scoped.

Zod note: `.partial()` keeps `.default()` values, so PATCH schemas must be built from a field schema **without** defaults. See `promotionFields` and `createPromotion` in `modules/promotions/admin-routes.ts` for the pattern.

## Changing the schema

Edit `src/db/schema/*.ts`, then `npm run db:generate -- --name <change>`. Review the SQL and follow [MIGRATIONS.md](MIGRATIONS.md).

## Background jobs

Add a handler to `jobHandlers` in `modules/jobs/handlers.ts`. Enqueue work with `enqueueJob(tx, {...})` inside the transaction that makes it necessary, and give the job an `idempotencyKey`. Throw `PermanentJobError` for failures that a retry cannot fix. Payloads must contain ids only.

## Trying the storefront locally

1. Sign in: `POST /v1/admin/auth/login`.
2. Create a brand and a store.
3. Add the domain `localhost` and verify it with `{"override": true}` (development only).
4. Create a product, a variant with a SKU code and a price, then publish the product.
5. Call storefront endpoints with `Host: localhost`.

Customer sign-in cannot be completed by hand locally yet. OTP codes are never logged, and with `SMS_PROVIDER=log` they stay in the API process's memory. The integration tests read them from there (`lastOtp` in `test/helpers.ts`). A development-only way to see codes is listed in [KNOWN_ISSUES.md](KNOWN_ISSUES.md).

Checkout needs stock data. With the default `POS_ADAPTER=none` every item is `stock_unknown` ([POS_INTEGRATION.md](POS_INTEGRATION.md#stock)). Use the integration tests, which use the in-memory POS double, to exercise checkout.

## Conventions

See [CLAUDE.md](../CLAUDE.md). The main ones:
- money in paise;
- every query is scoped by store;
- no client-trusted prices;
- additive migrations only;
- never log OTPs, passwords or tokens.
