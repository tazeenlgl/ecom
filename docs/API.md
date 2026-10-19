# API

Status: **implemented**. The contract is generated from the route definitions into [openapi.json](openapi.json) (OpenAPI 3.1, 117 operations). It is also served by a running API at `GET /v1/openapi.json`. CI fails if `docs/openapi.json` is out of date: run `npm run openapi -w @ecom/api` after changing a route.

## Surfaces

| Prefix | Who | How the store is chosen |
| --- | --- | --- |
| `/v1/storefront/*` | Shoppers | The verified `Host` header ([TENANCY.md](TENANCY.md)). There is no store id in the URL or body |
| `/v1/admin/*` | Staff and platform admins | `:storeId` in the path, authorized against the admin's role grants |
| `/v1/webhooks/payments/:provider` | Payment providers | From the stored payment transaction the event refers to |
| `/health/live`, `/health/ready` | Load balancers | None. `ready` checks the database |

## Conventions

- **Versioning:** the major version is in the path (`/v1`). Changes within v1 are additive only: new endpoints, new optional fields.
- **Format:** JSON. Field names are camelCase. Money is integer **paise** in `*Paise` fields. Timestamps are ISO 8601 UTC.
- **Authentication:** `Authorization: Bearer <token>`.
  - Customers get a token from `/v1/storefront/auth/otp/verify` or `/auth/password/login`.
  - Admins get a token from `/v1/admin/auth/login`.
  - Tokens are opaque. Only their SHA-256 hash is stored.
- **Guest carts:** `POST /v1/storefront/cart` returns a `cartToken` once. The client sends it back in the `x-cart-token` header. When the shopper signs in, the guest cart merges into their cart.
- **Validation:** every params, query and body is validated by Zod. Unknown values are rejected or ignored, never trusted.
- **Request ids:** every response carries `x-request-id`. A caller-supplied `x-request-id` is reused, which helps trace a request across systems.
- **Caching:** API responses are `cache-control: no-store`.

## Errors

Every error has the same shape:

```json
{ "error": { "code": "price_changed", "message": "Prices changed since you last saw them.", "details": { } } }
```

`code` is stable and is part of the contract (`apps/api/src/lib/errors.ts`). `message` is safe to show to users. `details` is optional. Stack traces and internal errors are never returned: a 500 response is always `internal_error`.

| Status | Codes |
| --- | --- |
| 400 | `invalid_request` (with `details[]` of `{path, message}`), `invalid_host`, `otp_invalid`, `otp_expired` |
| 401 | `unauthenticated` |
| 403 | `forbidden` |
| 404 | `not_found`, `store_not_found` |
| 409 | `conflict` (including database unique and foreign-key violations; at checkout, `details.issues` lists stock, availability, serviceability or COD problems), `invalid_transition` (with `{machine, from, to}`), `price_changed` (with `details.quote`) |
| 422 | `idempotency_key_reused` |
| 429 | `rate_limited` |
| 502 | `payment_error` (the provider call failed) |
| 503 | `store_maintenance`, `unavailable` (the OTP could not be sent), `payment_error` (no payment provider is configured) |

Webhooks that fail signature verification return `400 webhook_invalid`.

## Pagination

List endpoints take `?limit=` (1–100, default 20) and `?cursor=`, and return `{ "items": [...], "nextCursor": "..." | null }`. Cursors are opaque keyset positions over `(created_at desc, id desc)`. A tampered cursor returns `400 invalid_request`.

## Idempotency

| Operation | Mechanism |
| --- | --- |
| `POST /v1/storefront/checkout/orders` | `Idempotency-Key` header required (8–128 characters, `[A-Za-z0-9_-:.]`). A retry with the same key and body returns the original order with status 200 instead of 201. The same key with a different body returns `422 idempotency_key_reused`. A concurrent duplicate request also returns the original order |
| `POST /v1/admin/stores/:storeId/orders/:id/refunds` | `Idempotency-Key` header required. The same key returns the same refund |
| Payment webhooks | Deduplicated by `(provider, provider_event_id)` |
| Background jobs | Deduplicated by job `idempotency_key` |

## Rate limits

| Endpoint | Limit | Where it is enforced |
| --- | --- | --- |
| OTP request | 30 s resend cooldown; 3 per phone per 15 min; 20 per IP per hour | Database (`otp_challenges`), so it holds across instances |
| OTP verify and password reset | 5 attempts per code, after which the code is dead (database); 30 per IP per 15 min (in-process) | Database plus in-process |
| Customer password login | 10 per IP and 5 failures per phone per 15 min | In-process (per instance) |
| Customer password change | 10 per IP per 15 min | In-process (per instance) |
| Admin login | 10 per IP and 5 failures per email per 15 min | In-process (per instance) |
| Payment initiation | 20 per IP per 15 min | In-process (per instance) |

The in-process limits reset when the process restarts, and each instance counts separately. See [KNOWN_ISSUES.md](KNOWN_ISSUES.md).

## Prices are never taken from the client

Cart and quote responses are computed on the server from `variant_prices`, active promotions, shipping zones and stock. Checkout accepts an optional `expectedTotalPaise`. The server only compares it with its own total: if they differ, checkout fails with `409 price_changed` and returns the new quote, so the shopper can confirm. The client's number is never used as the price.

## Endpoint index

Generated from `docs/openapi.json`. "Access" is the permission checked for the path's `:storeId`; `platform.*` permissions need a platform-wide grant. "customer" means a customer bearer token, "none" means unauthenticated (storefront routes still require a verified host). Roles and their permissions are listed in [SECURITY.md](SECURITY.md#roles).

| Method | Path | Access | Summary |
| --- | --- | --- | --- |
| POST | `/v1/storefront/auth/logout` | customer | Sign out the current session |
| POST | `/v1/storefront/auth/otp/request` | none | Send a one-time code to an Indian mobile number |
| POST | `/v1/storefront/auth/otp/verify` | none | Verify a login code; signs in, registering the customer on first login |
| POST | `/v1/storefront/auth/password/login` | none | Sign in with mobile number and password |
| POST | `/v1/storefront/auth/password/reset` | none | Set a new password using a reset code; signs out every session |
| POST | `/v1/storefront/cart` | none | Get or create the current cart (new guest carts return cartToken once) |
| GET | `/v1/storefront/cart` | none | Current cart with server-calculated totals |
| PUT | `/v1/storefront/cart/coupon` | none | Apply a coupon code (validated on every quote) |
| DELETE | `/v1/storefront/cart/coupon` | none | Remove the coupon |
| POST | `/v1/storefront/cart/items` | none | Add a variant (quantities add up) |
| PATCH | `/v1/storefront/cart/items/{itemId}` | none | Change a line quantity |
| DELETE | `/v1/storefront/cart/items/{itemId}` | none | Remove a line |
| GET | `/v1/storefront/categories` | none | Active categories (flat list with parentId) |
| POST | `/v1/storefront/checkout/orders` | customer | Place an order from the cart. Requires Idempotency-Key; retries with the same key return the same order |
| POST | `/v1/storefront/checkout/quote` | customer | Price the cart for an address and payment method without placing an order |
| GET | `/v1/storefront/collections` | none | Active collections |
| GET | `/v1/storefront/content/blocks` | none | Published blocks of a kind that are live now |
| GET | `/v1/storefront/faqs` | none | Published FAQ entries |
| GET | `/v1/storefront/me` | customer | Current customer |
| PATCH | `/v1/storefront/me` | customer | Update name or email |
| GET | `/v1/storefront/me/addresses` | customer | List saved addresses |
| POST | `/v1/storefront/me/addresses` | customer | Add an address |
| PATCH | `/v1/storefront/me/addresses/{id}` | customer | Update an address |
| DELETE | `/v1/storefront/me/addresses/{id}` | customer | Delete an address |
| PUT | `/v1/storefront/me/password` | customer | Set or change password (current password required if one is set); signs out other sessions |
| GET | `/v1/storefront/orders` | customer | My orders |
| GET | `/v1/storefront/orders/{orderNumber}` | customer | Order detail with items, timeline and shipments |
| POST | `/v1/storefront/orders/{orderNumber}/cancel` | customer | Cancel an order that has not been packed or shipped |
| POST | `/v1/storefront/orders/{orderNumber}/payments` | customer | Start an online payment for an unpaid order; returns provider data for the client SDK |
| POST | `/v1/storefront/orders/{orderNumber}/returns` | customer | Request a return or exchange within 7 days of delivery |
| GET | `/v1/storefront/pages/{slug}` | none | A published page, policy or FAQ entry |
| GET | `/v1/storefront/products` | none | Published products, filterable by category or collection slug and title search |
| GET | `/v1/storefront/products/{slug}` | none | Product detail with variants, prices, availability, media and size chart |
| GET | `/v1/storefront/shipping/serviceability` | none | Whether a PIN code is serviceable, with charge and COD availability |
| POST | `/v1/webhooks/payments/{provider}` | none | Payment provider webhook (signature-verified, idempotent by provider event id) |
| GET | `/v1/admin/admin-users` | platform.admins.manage | List administrators |
| POST | `/v1/admin/admin-users` | platform.admins.manage | Create an administrator |
| PATCH | `/v1/admin/admin-users/{id}` | platform.admins.manage | Enable or disable an administrator |
| POST | `/v1/admin/admin-users/{id}/roles` | platform.admins.manage | Grant a role, platform-wide (storeId null) or for one store |
| DELETE | `/v1/admin/admin-users/{id}/roles/{grantId}` | platform.admins.manage | Revoke a role grant |
| POST | `/v1/admin/auth/login` | none | Sign in as an administrator |
| POST | `/v1/admin/auth/logout` | admin (any) | Revoke the current admin session |
| GET | `/v1/admin/brands` | platform.brands.manage | List brands |
| POST | `/v1/admin/brands` | platform.brands.manage | Create a brand |
| PATCH | `/v1/admin/brands/{id}` | platform.brands.manage | Rename or archive a brand |
| GET | `/v1/admin/me` | admin (any) | Current admin and role grants |
| GET | `/v1/admin/roles` | admin (any) | List roles and their permissions |
| GET | `/v1/admin/stores` | admin (any) | List the stores this admin can access |
| POST | `/v1/admin/stores` | platform.stores.manage | Create a store for a brand |
| GET | `/v1/admin/stores/{storeId}` | store.read | Get a store |
| PATCH | `/v1/admin/stores/{storeId}` | store.settings.manage | Update store settings. Changing status needs platform.stores.manage |
| GET | `/v1/admin/stores/{storeId}/attributes` | catalogue.read | List attribute definitions |
| POST | `/v1/admin/stores/{storeId}/attributes` | catalogue.write | Define an attribute |
| PATCH | `/v1/admin/stores/{storeId}/attributes/{id}` | catalogue.write | Update an attribute definition (code, type and scope are fixed) |
| GET | `/v1/admin/stores/{storeId}/audit-logs` | audit.read | Audit history for a store |
| GET | `/v1/admin/stores/{storeId}/blocks` | store.read | List homepage sections, navigation menus and banners |
| PUT | `/v1/admin/stores/{storeId}/blocks` | content.write | Create or replace a content block by kind and key |
| DELETE | `/v1/admin/stores/{storeId}/blocks/{id}` | content.write | Delete a content block |
| GET | `/v1/admin/stores/{storeId}/categories` | catalogue.read | List categories |
| POST | `/v1/admin/stores/{storeId}/categories` | catalogue.write | Create a category or subcategory |
| PATCH | `/v1/admin/stores/{storeId}/categories/{id}` | catalogue.write | Update a category |
| GET | `/v1/admin/stores/{storeId}/collections` | catalogue.read | List collections |
| POST | `/v1/admin/stores/{storeId}/collections` | catalogue.write | Create a collection |
| PATCH | `/v1/admin/stores/{storeId}/collections/{id}` | catalogue.write | Update a collection |
| PUT | `/v1/admin/stores/{storeId}/collections/{id}/products` | catalogue.write | Replace the ordered product list of a collection |
| PATCH | `/v1/admin/stores/{storeId}/coupons/{id}` | promotions.write | Activate or deactivate a coupon |
| GET | `/v1/admin/stores/{storeId}/customers` | customers.read | List customers (search by phone digits) |
| GET | `/v1/admin/stores/{storeId}/customers/{id}` | customers.read | Get a customer with addresses |
| GET | `/v1/admin/stores/{storeId}/domains` | store.read | List domains for a store |
| POST | `/v1/admin/stores/{storeId}/domains` | platform.domains.manage | Add an unverified domain; returns the TXT record to create |
| DELETE | `/v1/admin/stores/{storeId}/domains/{id}` | platform.domains.manage | Remove a domain |
| POST | `/v1/admin/stores/{storeId}/domains/{id}/primary` | platform.domains.manage | Make a verified domain the primary one |
| POST | `/v1/admin/stores/{storeId}/domains/{id}/verify` | platform.domains.manage | Check the DNS TXT record and mark the domain verified |
| GET | `/v1/admin/stores/{storeId}/jobs` | jobs.manage | Background jobs for a store (default: dead jobs needing attention) |
| POST | `/v1/admin/stores/{storeId}/jobs/{id}/retry` | jobs.manage | Re-queue a dead job with a fresh attempt budget |
| DELETE | `/v1/admin/stores/{storeId}/media/{id}` | catalogue.write | Remove media metadata |
| GET | `/v1/admin/stores/{storeId}/orders` | orders.read | List orders with state filters |
| GET | `/v1/admin/stores/{storeId}/orders/{id}` | orders.read | Full order: items, timeline, payments, refunds, shipments, returns |
| POST | `/v1/admin/stores/{storeId}/orders/{id}/cancel` | orders.manage | Cancel an unshipped order (refund is queued if paid) |
| POST | `/v1/admin/stores/{storeId}/orders/{id}/cod-collected` | orders.manage | Record cash collected on delivery |
| POST | `/v1/admin/stores/{storeId}/orders/{id}/notes` | orders.manage | Add an internal note to the timeline |
| POST | `/v1/admin/stores/{storeId}/orders/{id}/pos-sync/mark-synced` | pos.manage | Record that the order was entered in the POS manually |
| POST | `/v1/admin/stores/{storeId}/orders/{id}/pos-sync/retry` | pos.manage | Re-queue POS submission for a failed order |
| POST | `/v1/admin/stores/{storeId}/orders/{id}/refunds` | refunds.manage | Refund part or all of a collected payment. Requires Idempotency-Key |
| POST | `/v1/admin/stores/{storeId}/orders/{id}/shipments` | orders.manage | Create a shipment for a confirmed order (manual courier details) |
| POST | `/v1/admin/stores/{storeId}/orders/{id}/status` | orders.manage | Move the order status forward (processing, completed) |
| GET | `/v1/admin/stores/{storeId}/pages` | store.read | List pages, policies and FAQs |
| POST | `/v1/admin/stores/{storeId}/pages` | content.write | Create a page, policy or FAQ entry |
| PATCH | `/v1/admin/stores/{storeId}/pages/{id}` | content.write | Update a page |
| POST | `/v1/admin/stores/{storeId}/payments/reconcile` | refunds.manage | Queue reconciliation of stale pending payments |
| GET | `/v1/admin/stores/{storeId}/pos/status` | pos.manage | POS adapter capabilities, stock freshness, unsynced orders and failed jobs |
| POST | `/v1/admin/stores/{storeId}/pos/stock-sync` | pos.manage | Queue a stock refresh from the POS |
| GET | `/v1/admin/stores/{storeId}/products` | catalogue.read | List products |
| POST | `/v1/admin/stores/{storeId}/products` | catalogue.write | Create a draft product |
| GET | `/v1/admin/stores/{storeId}/products/{id}` | catalogue.read | Get a product with variants, prices, media and categories |
| PATCH | `/v1/admin/stores/{storeId}/products/{id}` | catalogue.write | Update product content |
| POST | `/v1/admin/stores/{storeId}/products/{id}/media` | catalogue.write | Attach media metadata (file hosted elsewhere) |
| POST | `/v1/admin/stores/{storeId}/products/{id}/status` | catalogue.write | Publish, unpublish (draft) or archive a product |
| POST | `/v1/admin/stores/{storeId}/products/{id}/variants` | catalogue.write | Add a variant mapped to an existing POS SKU code |
| GET | `/v1/admin/stores/{storeId}/promotions` | catalogue.read | List promotions with usage counts |
| POST | `/v1/admin/stores/{storeId}/promotions` | promotions.write | Create a promotion |
| PATCH | `/v1/admin/stores/{storeId}/promotions/{id}` | promotions.write | Update a promotion (kind is fixed) |
| GET | `/v1/admin/stores/{storeId}/promotions/{id}/coupons` | catalogue.read | List coupon codes for a promotion |
| POST | `/v1/admin/stores/{storeId}/promotions/{id}/coupons` | promotions.write | Create a coupon code for a coupon-only promotion |
| POST | `/v1/admin/stores/{storeId}/refunds/{id}/mark-succeeded` | refunds.manage | Record a refund paid outside a provider (e.g. COD bank transfer) |
| GET | `/v1/admin/stores/{storeId}/reports/sales` | reports.read | Daily order count and value, excluding cancelled orders (store timezone) |
| POST | `/v1/admin/stores/{storeId}/returns/{id}/status` | orders.manage | Approve, reject, receive, complete or cancel a return/exchange |
| POST | `/v1/admin/stores/{storeId}/shipments/{id}/events` | orders.manage | Record a tracking event; out-of-order and duplicate events are kept but do not move status backwards |
| GET | `/v1/admin/stores/{storeId}/shipping-zones` | store.read | List shipping zones |
| POST | `/v1/admin/stores/{storeId}/shipping-zones` | shipping.write | Create a shipping zone |
| PATCH | `/v1/admin/stores/{storeId}/shipping-zones/{id}` | shipping.write | Update a shipping zone |
| GET | `/v1/admin/stores/{storeId}/size-charts` | catalogue.read | List size charts |
| POST | `/v1/admin/stores/{storeId}/size-charts` | catalogue.write | Create a size chart |
| PATCH | `/v1/admin/stores/{storeId}/size-charts/{id}` | catalogue.write | Update a size chart |
| PATCH | `/v1/admin/stores/{storeId}/variants/{id}` | catalogue.write | Update a variant (SKU code changes are audited) |
| PUT | `/v1/admin/stores/{storeId}/variants/{id}/price` | pricing.write | Set the online selling price and MRP (paise, GST-inclusive) |
| GET | `/v1/admin/stores/{storeId}/variants/{id}/price-history` | catalogue.read | Price change history |
