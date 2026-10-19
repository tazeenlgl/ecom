# Architecture

Status: proposed foundation. The POS integration contract is pending verification (see [phase-0-discovery.md](./phase-0-discovery.md)).

## Shape

A **TypeScript modular monolith** in an npm-workspaces monorepo:

```
apps/
  api/        Fastify HTTP API (storefront + admin endpoints), Drizzle ORM, PostgreSQL
  web/        (Phase 3) Next.js storefront, multi-domain
  admin/      (Phase 7) Next.js admin panel
packages/     shared types and UI (added when a second consumer exists)
docs/
```

One API process serves every brand. Background jobs (POS sync, notifications, webhooks) will run from the same codebase as a separate worker process, backed by a durable PostgreSQL job table, so Redis is not required until a measured need appears.

## Modules (apps/api/src/modules)

| Module | Owns | Status |
| --- | --- | --- |
| `health` | liveness/readiness probes | done |
| `tenancy` | brands, stores, domains; resolving a request's host to a store | done |
| `pos` | `PosGateway` port; SKU/stock read model | port only |
| identity, catalogue, pricing, cart, orders, payments, shipping, customers, content, notifications, admin, reporting | — | later phases |

Modules talk to each other through exported functions, never through each other's tables.

## Tenant isolation

- **Brand** = a business identity. **Store** = a sellable storefront of a brand (locale, currency, catalogue scope). **StoreDomain** = a hostname mapped to exactly one store.
- Every request's `Host` header is normalised (lower-cased, port and trailing dot stripped) and looked up in `store_domains`. Unknown hosts get `404 store_not_found`; inactive stores get `503`.
- The resolved `storeId` is attached to the request by the server. **Client-sent store or brand IDs are never used for authorization.**
- Every store-owned table carries `store_id`, and repository functions take the resolved store as a required argument, so a query without a store scope does not type-check.
- Admin and customer identities will be scoped to a store (or, for platform admins, granted explicit cross-store roles).
- Caches will key on `storeId` to prevent cross-tenant leaks.

## Data ownership

| Data | Owner |
| --- | --- |
| SKU identity, stock quantity, inventory movements | **POS** (authoritative) |
| Stock read model for fast availability | e-commerce (read-only mirror, with `synced_at`) |
| Online prices, offers, coupons, cart, checkout, orders, payments, returns | e-commerce |

The e-commerce platform never writes stock adjustments of its own.

## POS integration (port, no adapter yet)

`PosGateway` declares only what the platform *might* need. Each capability is optional and reported by `capabilities()`, so checkout and order flows branch on what the real POS supports instead of assuming it:

- `listSkus(cursor)`, `getStock(skuCodes)` — read side
- `submitOrder(order)` — only if POS supports ingestion (idempotent by order number)
- `reserveStock`, `releaseReservation`, `cancelOrder` — only if supported

An adapter is written in Phase 4 after the real API is inspected.

## Stack

Node 22, TypeScript, Fastify 5, Drizzle ORM + node-postgres, PostgreSQL 16, Zod for config and input validation, Pino structured logs, Vitest. Containerised deployment; CI on GitHub Actions.
