# Storefront (`apps/web`)

Next.js 15 (App Router) storefront for every brand and store on the platform. One deployment serves all stores: the API resolves the store from the request host, and each store's look (colours, logo, announcement, navigation, homepage) comes from its admin settings and content blocks.

## How it talks to the API

The browser only talks to the storefront. Server components call the API directly, and browser-side calls go through a backend-for-frontend route, `app/api/sf/[...path]/route.ts`, which:

- forwards the shopper's host as `X-Forwarded-Host` (the API must run with `TRUST_PROXY=true` on a private network);
- keeps the customer session token and guest cart token in **httpOnly, SameSite=Lax cookies** (`sf_session`, `sf_cart`), so browser JavaScript never sees them;
- only proxies `/v1/storefront/*` paths with plain segments (never admin or webhook routes);
- refuses state-changing requests whose `Origin` is not this site (CSRF guard).

Because of this, the API needs no CORS allow-list.

Prices shown on product and cart pages are for display. The checkout quote from the API is the source of truth, and orders are placed with `expectedTotalPaise` and an `Idempotency-Key`.

## Features

- Home page built from `homepage_section` and `banner` blocks (hero, product grid, collection and category tiles, image with text, rich text), with a default layout when none are set up.
- Mega menu from the `navigation` block, sticky shrinking header, mobile drawer menu, scrolling announcement bar.
- Instant search overlay, category and collection listings with infinite scroll.
- Product page: gallery with hover zoom, variant picker with stock state, size guide, PIN code delivery check, sticky mobile add-to-bag, JSON-LD, Open Graph.
- Slide-out bag with optimistic quantity changes and coupons.
- Mobile OTP sign-in (WebOTP autofill on Android) or password; the guest bag merges on sign-in.
- Checkout: saved or new address, online payment (Paytm JS Checkout) or cash on delivery, live server quote, price-change handling.
- Account: orders with progress tracker, timeline and shipment tracking, cancel, return or exchange requests, address book, profile.
- Per-store sitemap, robots and web manifest. Animations use Motion and respect `prefers-reduced-motion`.

## Run locally

```bash
cp apps/web/.env.example apps/web/.env.local   # API_URL, STORE_HOST_OVERRIDE
# API with TRUST_PROXY=true on :4000 (see docs/DEVELOPMENT.md)
psql "$DATABASE_URL" -f apps/web/scripts/demo-store.sql   # optional demo store on demo.localhost (local only)
STORE_HOST_OVERRIDE=demo.localhost npm run dev -w @ecom/web   # http://localhost:3000
```

OTP codes are never logged by the API, so local OTP sign-in needs an approved dev-only helper (see `docs/KNOWN_ISSUES.md` #12) or password sign-in.

## Not yet built

Wishlist, reviews, faceted filters and sorting, and recommendations need new API endpoints first. The admin UI is a separate app, not started.
