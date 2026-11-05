# Tenancy

Status: **implemented**. Tests: `apps/api/test/tenancy.test.ts` and `host.test.ts`, plus cross-store cases in `admin.test.ts` and `commerce.test.ts`.

## Model

- A **brand** (`brands`) is a business identity: name, slug, and `active` or `archived`.
- A **store** (`stores`) belongs to one brand. It is the unit of isolation: catalogue, prices, customers, orders and content all belong to one store.
  - `status` is `active`, `maintenance` or `disabled`.
  - `config` (jsonb) holds `orderNumberPrefix`, `codEnabled`, `codMaxOrderPaise` and `unpaidOrderTtlMinutes`.
  - `pos_location_ref` names the store's POS location.
- A **domain** (`store_domains`) maps one hostname to one store. A store can have several hostnames and at most one primary hostname.

Brand-specific behaviour comes from store configuration, settings and content blocks, never from code branches on a brand.

## How a storefront request finds its store

`apps/api/src/modules/tenancy/resolve-store.ts` runs as an `onRequest` hook on every `/v1/storefront/*` route:

1. `normalizeHost(request.host)` (`host.ts`) lower-cases the host and strips the port and trailing dot. It rejects anything that is not a plain DNS hostname, such as IPv6 literals and illegal characters. Failure returns `400 invalid_host`.
2. The hook looks up `store_domains` by hostname, **only where `verified_at IS NOT NULL`**, joined to the store and brand.
3. No row, a `disabled` store or a non-active brand all return the same `404 store_not_found`, so a caller cannot tell them apart.
4. A `maintenance` store returns `503 store_maintenance`.
5. Otherwise the hook sets `request.store`. Handlers use `request.store.id` and nothing else.

The store is **never** taken from a client-supplied id, query parameter, cookie or body. Store ids in a storefront request body are not part of any schema, so they are ignored.

Hostnames are globally unique (`store_domains.hostname` UNIQUE), so resolution is never ambiguous.

### Proxies

`request.host` honours `X-Forwarded-Host` only when `TRUST_PROXY=true`. Enable this only behind a proxy that overwrites the header. Otherwise a client could choose its store by sending the header. See [DEPLOYMENT.md](DEPLOYMENT.md).

## Domain verification

`POST /v1/admin/stores/:storeId/domains` adds an unverified domain with a random `verification_token`. The response includes the TXT record name `_ecom-verify.<hostname>`. `POST .../domains/:id/verify` resolves that TXT record and marks the domain verified if the token is present. The verifier is `modules/platform/domain-verifier.ts`, and tests replace it with a fake DNS.

`{"override": true}` marks a domain verified without DNS. It is meant for local development (`localhost`). It is **refused in production** and is audited as `domain.verify_override`.

## Admin requests

Admin routes do not use the Host header. Each store-scoped route has `:storeId` in its path, and `defineRoute` checks that the admin holds a role granting the route's permission **for that store**, or a platform-wide grant, before the handler runs. Handlers then filter every query by that `storeId`. A record id from another store returns `404`, because the query includes `store_id`.

## Background jobs

Each job row carries `store_id`. Handlers load records by id **and** store id from the payload. Payloads contain ids only.

## Database enforcement

Composite foreign keys `(store_id, x_id) → parent(store_id, id)` make cross-store references impossible at the database level. See [DATABASE.md](DATABASE.md#tenant-isolation-in-the-schema).

## Customers are per store

The same phone number registers separately in each store (`customers (store_id, phone)` unique). Sessions are bound to the store: a customer token from store A is rejected on store B's host. Sharing accounts across a brand's stores has not been decided; see [DECISIONS.md](DECISIONS.md) ADR-007.

## Adding a store

Configuration only, through the admin API:
1. `POST /v1/admin/brands`.
2. `POST /v1/admin/stores` with the `brandId`.
3. Add a domain and verify it.
4. Set the store settings.
5. Grant roles.
6. Create catalogue, prices, zones and content.

No code change or deploy is needed.
