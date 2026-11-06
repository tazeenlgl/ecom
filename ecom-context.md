# ecom: project handoff

Written 2026-11-06 from the repository at `main` = merge commit `b92e2cd346a5e61bd64eed9907985d1ce16b27f2`. Rules for working in the repo are in [CLAUDE.md](CLAUDE.md); this file is status and evidence. Items marked **[not reverified]** were copied from repository documents and not checked against running code or a live system in this review.

## 1. Status in one paragraph

A multi-brand, multi-domain e-commerce platform for India (TAZEEN and other brands) with a Fastify/PostgreSQL API, a Next.js storefront and a Next.js admin. Implemented and tested against **fakes and a real PostgreSQL test database**. **Nothing is deployed, no live provider is connected, and production readiness is not claimed.** The main blockers are an unverified POS contract, an unverified Paytm integration, no SMS or courier provider, and undecided hosting and proxy topology.

## 2. Repository and branch state (checked 2026-11-06 via the GitHub API)

| Item | State |
| --- | --- |
| Repo | https://github.com/tazeenlgl/ecom, **public** |
| `main` | `b92e2cd`, merge of PR #3 (merged 2026-11-06 08:44:25 UTC, normal merge commit; parents `3b8c8ca` and PR head `7003597`) |
| PR #1 (backend, Paytm adapter, docs) and PR #2 (storefront) | Merged into `main` earlier. Not open |
| PR #3 (admin, customer accounts, payment safety) | Merged. No PRs were open when checked |
| **GitHub default branch** | `claude/project-thread-430gje`, an old Phase 0 branch (`a25e7c7`), **not `main`**. Visitors land on the stale foundation. Owner action: change the default branch to `main` |
| Other branches | `claude/project-thread-4t2912` (PR #1 head), `claude/project-thread-a3uqs7` (PR #2 head), `feature/tazeen-ecommerce` (PR #3 head). All merged; none deleted |
| `claude/add-project-context` | Obsolete (one commit adding an outdated `CLAUDE.md`, no PR). **Deletion was attempted and blocked in the session that wrote this file** (see the PR description); delete it from the GitHub branches page |
| Branch protection | None on `main` when checked |

## 3. What is implemented

Status words follow `docs/INDEX.md`. "Implemented" means code and tests exist, not that it was verified against a real provider or deployed.

**API (`apps/api`)**
- Tenancy: brands, stores, domains with DNS TXT verification; store resolved from the verified `Host`; per-store admin permissions.
- Catalogue (products, variants, prices and history, media, categories, collections, attributes), promotions and coupons, carts, checkout with server-side quote, content pages and blocks, shipping zones with COD rules, customers, orders with state machines and immutable snapshots, shipments with out-of-order event handling, returns and exchanges, reports (daily sales, top SKUs).
- Customer accounts: OTP or password sign-in, sessions bound to a store, addresses, profile, password set/change/reset, order cancellation with refund preview, returns, admin block/unblock.
- Payments: provider-neutral flow, signed-webhook processing with dedupe, late-payment and duplicate-payment handling, refunds (including manual settlement of online refunds with a 24-hour hold on failed refund money), COD, reconciliation job. Paytm adapter with per-store encrypted credentials; fake provider for tests.
- POS: `PosGateway` port, stock read model, sync and order-submission jobs, recovery endpoints, an in-memory test double. No real adapter.
- Jobs: PostgreSQL job table, separate worker process, idempotent handlers.
- Security: rate limits (in process), trusted-proxy handling, audit log, secret encryption, production startup checks.
- 122 operations across 98 paths in `docs/openapi.json` (counted in this review).

**Storefront (`apps/web`)**: home from content blocks, listings, search, product pages, bag, OTP/password sign-in, checkout (Paytm JS Checkout or COD) with price-change handling, account (orders, tracking, cancel, returns, addresses, password), per-store sitemap/robots/manifest. Not built: wishlist, reviews, facets, recommendations.

**Admin (`apps/admin`)**: first release. Sign-in with server-side session and CSRF, platform brands/stores/administrators, store dashboard, products and variants, categories, collections, promotions, orders (fulfilment, returns, refunds, POS recovery), customers, pages and blocks, shipping zones, store settings and domains, POS status, jobs, audit, sales report. Not built: Paytm credential entry, payment reconciliation screen, size charts and attributes editors, promotion eligibility rules, and several things the API cannot do yet (order search, return list, grant list, product delete). See `docs/ADMIN.md`.

**Migrations**: `0000_init`, `0001_commerce_core`, `0002_order_snapshots_immutable` (hand-written triggers), `0003_paytm_gateway_config`, `0004_refund_settlement`. Applied only to local and disposable test databases **[not reverified: from `docs/MIGRATIONS.md`]**.

## 4. Verified test and CI evidence

| Evidence | Date | Scope |
| --- | --- | --- |
| CI workflow `CI` on PR #3 head `7003597`: push run `42061002129` and pull_request run `42061020813`, both `success` | 2026-11-05 | Typecheck, tests, build, OpenAPI drift check on a clean runner with a PostgreSQL 16 service |
| CI workflow `CI` on `main` `b92e2cd`: push run `42189843333`, `success` | 2026-11-06 08:44 UTC | Same steps on the merge commit |

What CI covers: the steps in `.github/workflows/ci.yml` using fakes (fake payment provider, in-memory POS, log SMS sender, fake DNS, simulated Paytm API).
What CI does **not** cover: Paytm staging or live, any SMS, courier or POS system, deployed environments, browser flows, load, the worker loop (`src/worker.ts`), and `apps/admin/test/e2e-roles.mjs` (local only).

**Not reverified in this review:** no tests, typecheck, build or migration were run locally here. Test counts in `docs/TESTING.md` (108 tests, 2026-10-19) are **outdated and must not be treated as current**. Older reports of local test runs, including "API tests not run" notes for customer-account work in `CHANGELOG.md`, predate the CI results above.

## 5. Unverified external integrations

| Integration | State |
| --- | --- |
| **POS** | **Nothing about the POS is verified.** The backend is not in any visible repo; the paths named in the brief (`/opt/tazeen-pos/offers-pos/backend`, `/opt/tazeen-pos/backend`) were never inspected; server access was declined on 2026-10-19. Unknown: API existence, auth, SKU and stock model, order ingestion, reservation, cancel, refund support. No capability may be assumed |
| **Paytm** | Built from published documentation and tested only against a simulation. **Unverified until a real staging transaction succeeds**: hosts (staging default `https://securestage.paytmpayments.com`), endpoint paths and response fields, checksum parity, notification field names, response signatures, the refund host, the refund-status contract and how refund notifications look. No test merchant ID or key has been available. Live Paytm is off (`PAYTM_PRODUCTION_ENABLED=false`) and needs the owner's approval |
| **SMS / OTP** | **No provider integration exists.** Only `log` (development, in-memory, refused in production) and `disabled` senders. Customer OTP and password-reset sign-in cannot complete against a real phone. Needs a provider choice and DLT-registered templates |
| **Courier** | None chosen; none integrated |
| **Domains / DNS** | `DnsDomainVerifier` checks TXT records; never exercised against a real brand domain **[not reverified]** |

## 6. Known limitations and blockers

Full list: `docs/KNOWN_ISSUES.md` (its numbering has duplicates; item content is still useful). The ones that matter most:

1. **Nothing is purchasable without stock data.** With `POS_ADAPTER=none` every variant is `stock_unknown`; checkout works only in tests until a POS adapter exists or stock rows are loaded. By design, no manual stock-entry endpoint.
2. Rate limits (sign-in, coupon guessing, payment initiation, OTP verification) are per process and reset on restart; several instances would not share counts.
3. Recurring jobs (`pos.sync_stock`, `payments.reconcile`) are **not scheduled**.
4. Cached stock has no maximum age when the live POS check fails.
5. Paytm refunds stay `processing` until staff settle them; duplicate online payments are only flagged.
6. No admin MFA; no admin password change or reset endpoint; audit rows have no request id or IP.
7. A payment transaction left `created` (crash before the provider call) is not reconciled; abandoned attempts are checked for 48 hours only.
8. Return window hard-coded at 7 days; exchanges create no replacement order; multi-shipment orders follow the latest shipment event.
9. No GST breakdown for shipping or COD fees; invoicing and GST filing owner undecided.
10. The repository is public (risk for any committed secret).

## 7. Deployment readiness and safety boundaries

**Not deployable today, and no deployment has been authorized.**
- No hosting, domain, TLS, database provider or secret store chosen. Staging environment does not exist.
- **No production migration has been authorized or run.** Needs separate approval and a fresh backup.
- **No live Paytm call has been authorized.** Staging Paytm is refused when `NODE_ENV=production`.
- Production refuses to start with the dev `OTP_HMAC_SECRET` or `CONFIG_ENCRYPTION_KEY`, `SMS_PROVIDER=log`, `PAYMENT_PROVIDER=fake` or `TRUST_PROXY=true`. With no SMS provider, production customer sign-in is effectively unavailable.
- **`TRUST_PROXY`:** use the addresses (IPs or CIDR ranges) of the web and admin servers that call the API, or a hop count only when the API is reachable through the proxy alone; `loopback` for local development; never `true` in production. The edge proxy must overwrite `X-Forwarded-Host` and `X-Forwarded-For`; set `TRUSTED_PROXY_HOPS` on web/admin to the real proxy count (leave `0` if unsure); the API and web servers must not be reachable except through the proxy. **The real topology and addresses are unknown and must be confirmed** (checklist in `docs/DEPLOYMENT.md`).
- Before first production deploy (`docs/DEPLOYMENT.md`): make the repo private, set secrets, approve SMS and payment adapters, schedule recurring jobs, use shared rate limits if running several instances, back up, run migrations with approval, verify each brand domain and an unknown host (expect 404).

## 8. Recommended next phases (each needs the owner's approval)

1. **Repository hygiene:** set `main` as the default branch; delete `claude/add-project-context`; make the repo private; refresh the stale documents listed in section 9.
2. **Unblock the POS:** obtain read-only access to the POS source or API docs, a sandbox, and answers to `docs/POS_INTEGRATION.md`; then build the adapter against the verified contract.
3. **Paytm staging:** enter a staging MID/key through the admin API on a non-production deployment, run a real test payment, refund and notification, confirm the unverified items in section 5, then decide on live.
4. **Backend gaps:** job scheduler, shared rate limits, stock freshness limit, return window as a store setting, tests for content, reports and the worker loop.
5. **Provider choices:** SMS (with DLT templates) and courier.
6. **Admin completion:** Paytm credential entry, reconciliation screen, attribute and size-chart editors, and the API gaps in `docs/ADMIN.md`.
7. **Staging deployment** and a restore-tested backup, then a separately approved production plan.

## 9. Documents on `main` that are known to be stale

Left untouched by the documentation refresh that introduced this file (scope was limited to `CLAUDE.md` and this file). Do not rely on these statements:
- `README.md`: says storefront and admin are not built and lists migrations `0000`-`0003`.
- `docs/IMPLEMENTATION_PLAN.md`: dated 2026-10-19, labels merged work "uncommitted" and "to be merged".
- `docs/TESTING.md`: test counts and results from 2026-10-19.
- `CHANGELOG.md`: entry headings say "(uncommitted)" for work that is now merged.
- `docs/KNOWN_ISSUES.md`: duplicate item numbers (17, 20/21 ordering).
