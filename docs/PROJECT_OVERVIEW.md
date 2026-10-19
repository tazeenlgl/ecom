# Project overview

## Vision

One platform runs online stores for many brands, each on its own domain. A new brand or store is a configuration change, not new code. The business already runs a POS that knows every SKU and how much stock exists. The online platform sells against that truth instead of keeping its own.

## Scope

| In scope (this platform owns) | Out of scope (owned elsewhere) |
| --- | --- |
| Online selling prices and MRP display | SKU identity, barcodes (POS) |
| Promotions, coupons, offer rules | Stock quantities and movements (POS) |
| Carts, checkout, online orders | In-store sales (POS) |
| Online payments, COD, refunds | Accounting and GST filing (not yet decided) |
| Shipping zones, shipments, tracking records | Courier operations (courier, once chosen) |
| Returns and exchanges | |
| Storefront content: pages, banners, navigation, SEO | |
| Customer accounts (per store) | |

## Users

- **Shoppers** buy on a brand's storefront. They sign in with an Indian mobile number and OTP, and can optionally set a password.
- **Store staff** run one store: catalogue, prices, offers, orders and returns. Their access comes from per-store role grants.
- **Platform administrators** create brands, stores and domains, and manage staff access.
- **Systems:** the POS, a payment provider, an SMS provider and a courier. None is connected yet. See [KNOWN_ISSUES.md](KNOWN_ISSUES.md).

## Major capabilities and status

| Capability | Status |
| --- | --- |
| Brands, stores, verified domains, host-based store resolution | Implemented |
| Admin accounts, roles, per-store permissions, audit log | Implemented |
| Customer OTP and password login, sessions, addresses, password reset | Implemented (SMS delivery is log-only) |
| Catalogue: products, variants mapped to POS SKUs, flexible attributes, categories, collections, media metadata, size charts, SEO | Implemented |
| Online prices with history | Implemented |
| Promotions: percentage, fixed, buy-X-get-Y, free shipping, thresholds, coupons, limits, stacking | Implemented |
| Guest and customer carts, merge on login, server-side quotes | Implemented |
| Idempotent checkout with price snapshots | Implemented |
| Order, payment, fulfillment, POS-sync, return and refund state machines | Implemented |
| Provider-neutral payments, webhook verification, refunds, reconciliation | Implemented with a fake provider only |
| Shipping zones and PIN serviceability, manual shipments and tracking | Implemented. Courier integration is blocked until a courier is chosen |
| POS stock sync and order submission | Implemented behind a port. The real adapter is blocked because the POS API is unverified |
| Content: pages, policies, FAQs, homepage sections, navigation, banners | Implemented |
| Notifications (OTP, order, shipping, refund) | Partial: queued jobs exist, delivery is log-only |
| Sales report | Implemented (basic) |
| Storefront UI, admin UI | Planned. Not started by instruction |
| Deployment | Planned. Nothing deployed |

Related: [REQUIREMENTS.md](REQUIREMENTS.md), [ARCHITECTURE.md](ARCHITECTURE.md), [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md).
