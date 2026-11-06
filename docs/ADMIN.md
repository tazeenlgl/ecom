# Admin dashboard (`apps/admin`)

Status: **first release, partial**. A Next.js 15 admin for platform and store administrators. Every screen reads from, and every action writes to, the existing `/v1/admin/*` API. The API makes every permission decision; the UI only hides what a role cannot do.

## Run it locally

```sh
cp apps/admin/.env.example apps/admin/.env.local   # ADMIN_API_URL=http://localhost:4000
npm run dev -w @ecom/admin                          # http://localhost:3001
```

The API must be running (see [DEVELOPMENT.md](DEVELOPMENT.md)). Create the first platform owner with `npm run admin:create -w @ecom/api -- you@example.com "Your Name"` (`ADMIN_PASSWORD` in the environment, 12+ characters). That owner can then create further administrators and grant store-scoped roles in **Platform → Administrators**.

| Command | What |
| --- | --- |
| `npm run typecheck -w @ecom/admin` | Type check |
| `npm run build -w @ecom/admin` | Production build |
| `npm test -w @ecom/admin` | Unit tests (permissions, CSRF, proxy path rules) |
| `E2E_OWNER_EMAIL=... E2E_OWNER_PASSWORD=... node apps/admin/test/e2e-roles.mjs` | 57 checks of roles, CSRF, cross-store access and session revocation against a **running local** stack (refuses non-local URLs; the API login limiter allows 10 sign-ins per 15 minutes, so one run per window) |

## Authentication and security design

- **Server-side session.** `POST /api/auth/login` calls the API's `/auth/login` and stores the opaque bearer token in an **httpOnly, SameSite=Strict** cookie (`Secure` in production). The browser never sees the token and nothing is put in `localStorage` or `sessionStorage`.
- **BFF proxy.** The browser only calls `/api/admin/*`. That route attaches the token and forwards to `/v1/admin/*`. It refuses path traversal and the `auth/*` endpoints (login and logout have dedicated routes).
- **CSRF.** Every non-GET request needs an `x-csrf-token` header equal to the readable `ecom_admin_csrf` cookie (double submit) and, when the browser sends one, a same-host `Origin`.
- **Revocation.** Sign-out calls the API's `/auth/logout`, so the token is dead server side. Each page render asks the API for `/me`, so expired, revoked or disabled sessions are signed out on the next request.
- **Authorization.** Never decided by the UI. A hand-typed store id is forwarded, and the API rejects it with 403 when the grant does not cover that store. `apps/admin/test/e2e-roles.mjs` proves this for four roles.
- **Not implemented:** multi-factor authentication (the API has none), password change and reset for administrators (no endpoint), login lockout beyond the API's per-IP rate limit.

## Capability map: endpoint to screen

| Area | Screen | Endpoints used | Permission |
| --- | --- | --- | --- |
| Session | Sign in, sign out, store selector | `POST /auth/login`, `POST /auth/logout`, `GET /me`, `GET /roles`, `GET /stores` | any signed-in admin |
| Brands | Platform → Brands | `GET/POST /brands`, `PATCH /brands/:id` | `platform.brands.manage` |
| Stores | Platform → Stores | `GET /stores`, `POST /stores` | any (list), `platform.stores.manage` (create) |
| Administrators | Platform → Administrators | `GET/POST /admin-users`, `PATCH /admin-users/:id`, `POST /admin-users/:id/roles`, `DELETE .../roles/:grantId` | `platform.admins.manage` |
| Store dashboard | Dashboard | `GET /stores/:s/reports/sales`, `GET .../orders`, `.../pos/status`, `.../jobs`, `.../audit-logs` | each section needs its own permission |
| Products | Products, New, Detail | `GET/POST /products`, `GET/PATCH /products/:id`, `POST .../status`, `POST .../variants`, `PATCH /variants/:id`, `PUT /variants/:id/price`, `GET .../price-history`, `POST .../media`, `DELETE /media/:id` | `catalogue.read/write`, `pricing.write` |
| Categories | Categories | `GET/POST /categories`, `PATCH /categories/:id` | `catalogue.read/write` |
| Collections | Collections | `GET/POST /collections`, `PATCH`, `PUT .../products` | `catalogue.read/write` |
| Promotions | Promotions | `GET/POST /promotions`, `PATCH`, `GET/POST .../coupons`, `PATCH /coupons/:id` | `catalogue.read`, `promotions.write` |
| Orders | Orders, Order detail | `GET /orders`, `GET /orders/:id`, `POST .../status`, `.../cancel`, `.../notes`, `.../cod-collected`, `.../shipments`, `.../refunds`, `.../pos-sync/*`, `POST /shipments/:id/events`, `POST /returns/:id/status`, `POST /refunds/:id/mark-succeeded` | `orders.read/manage`, `refunds.manage`, `pos.manage` |
| Customers | Customers, Detail | `GET /customers`, `GET /customers/:id` | `customers.read` |
| Content | Content | `GET/POST /pages`, `PATCH /pages/:id`, `GET/PUT /blocks`, `DELETE /blocks/:id` | `store.read`, `content.write` |
| Shipping | Shipping zones | `GET/POST /shipping-zones`, `PATCH` | `store.read`, `shipping.write` |
| Store settings | Store settings | `GET/PATCH /stores/:s`, `GET/POST/DELETE /domains`, `.../verify`, `.../primary`, `GET /payment-gateways/paytm` | `store.read`, `store.settings.manage`, `platform.domains.manage` |
| Operations | POS and stock, Jobs, Audit, Sales report | `GET /pos/status`, `POST /pos/stock-sync`, `GET /jobs`, `POST /jobs/:id/retry`, `GET /audit-logs`, `GET /reports/sales` | `pos.manage`, `jobs.manage`, `audit.read`, `reports.read` |

## Not built, and API gaps

Not built yet (the API supports them):
- Size charts, product attributes and specifications editors (list and create endpoints exist).
- Promotion eligibility rules (specific products or collections). Promotions apply to the whole bag from this form.
- Paytm credential entry (`PUT .../payment-gateways/paytm`). Deliberately left out of the first release; the screen shows status only and never any secret.
- Payment reconciliation (`POST /payments/reconcile`).

The API cannot do these, so the UI does not pretend to:
- **No counts.** There is no product or customer count endpoint, so the dashboard shows none.
- **No order search, and no customer filter on orders.** The order search box filters loaded rows only; a customer's order history is read from the newest 100 orders and filtered in the browser.
- **No return-request list.** Returns appear on their order's page only.
- **No list of an administrator's grants.** Only grants created during an open Roles dialog can be revoked from the UI.
- **No collection product read.** "Set products" replaces the list blind (and says so).
- **No product delete, no stock edit.** Stock belongs to the POS (or the stand-in `pos_stock_levels` table).
- **No file upload.** Product photos are https addresses of images hosted elsewhere. Block and media validation is strict: relative photo paths used by the local preview cannot be re-saved through the API.
- **Variants** must map to a SKU that already exists in the POS.
- `GET /stores/:s/audit-logs` and `.../reports/sales` are read-only, with no export.
