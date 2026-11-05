# Database

PostgreSQL 16, accessed through Drizzle ORM. The schema source is `apps/api/src/db/schema/*.ts`, re-exported from `src/db/schema.ts`. Migrations are in `apps/api/drizzle/` ([MIGRATIONS.md](MIGRATIONS.md)). Relationships are drawn in [ER_DIAGRAM.md](ER_DIAGRAM.md).

There are **43 tables**: 4 from `0000_init`, 38 from `0001_commerce_core` and 1 from `0003_paytm_gateway_config`. Migration `0002_order_snapshots_immutable` adds triggers only.

## Conventions

- Primary keys are `uuid` (`gen_random_uuid()`), except `store_counters` (composite) and `pos_stock_levels` (unique key on SKU and location).
- Timestamps are `timestamptz`. Most tables have `created_at` and `updated_at`.
- Money is `integer` paise. Prices are GST-inclusive. Tax rates are `integer` basis points (`products.tax_rate_bps`, 0–10000).
- Status columns are Postgres enums. Their legal transitions are enforced in code (`modules/orders/state-machines.ts`).
- Flexible data is `jsonb` and is always validated by Zod before it is written:
  - `stores.config`;
  - `products.attributes` and `product_variants.attributes`;
  - `seo`;
  - `content_blocks.data`;
  - order snapshots.

## Tenant isolation in the schema

- Every store-owned table has `store_id NOT NULL`.
- Child tables reference their parent through **composite foreign keys on `(store_id, id)`**. Parents carry a matching unique index. So:
  - an order item cannot reference a variant from another store;
  - a cart item cannot reference another store's cart;
  - an address cannot belong to another store's customer.

  The database rejects such rows even if application code is wrong.
- Uniqueness is per store where the business needs it:
  - `customers (store_id, phone)`: the same phone number is a separate customer in each store;
  - `product_variants (store_id, sku_code)`;
  - `products/categories/collections/content_pages (store_id, slug)`;
  - `coupons (store_id, code)`;
  - `orders (store_id, order_number)`.
- `store_domains.hostname` is globally unique, which makes host resolution unambiguous.
- `pos_stock_levels` is deliberately **not** store-scoped. It mirrors the POS, keyed by `(sku_code, location_ref)`. A store reads the stock for its own `stores.pos_location_ref`. Assumption: one POS serves every store, and SKU codes mean the same thing across stores. This is not verified ([POS_INTEGRATION.md](POS_INTEGRATION.md)).

## Tables by area

| Area | Tables | Key constraints |
| --- | --- | --- |
| Tenancy | `brands`, `stores`, `store_domains`, `store_counters`, `audit_logs` | unique brand slug, `(brand_id, slug)`, unique hostname, one primary domain per store |
| Admin identity | `admin_users`, `admin_role_assignments`, `admin_sessions` | unique email, unique grant `(admin, role, store)` with NULLs not distinct |
| Customers | `customers`, `customer_sessions`, `otp_challenges`, `customer_addresses` | `(store_id, phone)` unique, PIN check `^[1-9][0-9]{5}$`, one default address per customer |
| Catalogue | `attribute_definitions`, `categories`, `size_charts`, `products`, `product_variants`, `product_categories`, `collections`, `collection_products`, `product_media` | per-store slugs and SKU codes, composite FKs, `tax_rate_bps` 0–10000 |
| Pricing and promotions | `variant_prices`, `price_history`, `promotions`, `coupons`, `promotion_redemptions` | `price > 0`, `mrp >= price`, `ends_at > starts_at`, one redemption per promotion per order |
| Cart and orders | `carts`, `cart_items`, `orders`, `order_items`, `order_events`, `return_requests` | one active cart per customer, quantity 1–100, `orders_idempotency_uq (store, customer, idempotency_key)`, `refunded <= total` |
| Payments | `payment_transactions`, `payment_events`, `refunds`, `payment_gateway_configs` | unique `(provider, provider_ref)`, **at most one succeeded transaction per order** (partial unique index), unique `(provider, provider_event_id)`, unique `(store, refund idempotency_key)`, amounts > 0, one gateway config per `(store, provider)`, with `environment` either `staging` or `production` |
| Shipping | `shipping_zones`, `shipments`, `shipment_events` | unique `(courier, tracking_number)`, unique `(shipment, external_event_id)` |
| POS | `pos_stock_levels` | unique `(sku_code, location_ref)` |
| Jobs | `jobs` | unique `idempotency_key` |
| Content | `content_pages`, `content_blocks` | unique `(store, slug)`, unique `(store, kind, key)` |

## Data ownership

| Data | Owner | Notes |
| --- | --- | --- |
| SKU code, barcode | POS | `product_variants.sku_code` is a reference. E-commerce never creates SKU identities |
| Stock quantity | POS | `pos_stock_levels` is a cache with `synced_at`. There is no stock ledger and no decrement on sale |
| Product content, categories, collections, media metadata | E-commerce | |
| Online price and MRP | E-commerce | `variant_prices` plus append-only `price_history` |
| Promotions, coupons, usage | E-commerce | |
| Carts, orders, order snapshots | E-commerce | Snapshots are immutable (migration `0002`) |
| Payment state | Payment provider | Mirrored in `payment_transactions` and changed only by verified webhooks or provider status calls |
| Shipment tracking | Courier | Entered manually today. `shipment_events.external_event_id` makes courier feeds idempotent later |
| Customer accounts | E-commerce, per store | |
| Audit trail | E-commerce | `audit_logs` is append-only by convention. There is no update or delete path in code |

## Immutability

Migration `0002_order_snapshots_immutable.sql` adds two triggers:
- `order_items_immutable`: rejects any `UPDATE` or `DELETE` on `order_items`.
- `orders_snapshot_immutable`: rejects changes to these `orders` columns: `customer_snapshot`, `shipping_address`, `applied_promotions`, the money columns, `order_number`, `store_id` and `customer_id`.

Corrections are recorded as new rows: `order_events`, `refunds`, `return_requests`. This is tested in `apps/api/test/database.test.ts`.

## Concurrency

- **Order numbers:** `store_counters` with `INSERT ... ON CONFLICT DO UPDATE value = value + 1`. This is gap-free per store within committed transactions.
- **Checkout:** locks the cart, and locks promotions that have usage limits, before counting redemptions.
- **Webhooks:** lock the `payment_transactions` row, then the order.
- **Jobs:** claimed with `FOR UPDATE SKIP LOCKED`.

## Design decisions

- **One customer per store, not a global account.** Brands may be separate businesses, and sharing accounts across them is a privacy decision nobody has made. See [DECISIONS.md](DECISIONS.md).
- **No generic idempotency table.** Each operation stores its key on its own row (orders, refunds, payment events, jobs), so the key and the result commit together.
- **Few hard deletes.** The API deletes only these: role grants, domains, content blocks, media metadata, cart lines, coupons on a cart and customer addresses. Products, variants, promotions and the like are archived or deactivated through status instead. Foreign keys from order and payment data use `restrict`, so a delete that would orphan history fails with `409 conflict`. Dependent rows cascade only where they are parts of their parent: variants, prices, cart items, category and collection links, media and sessions.
