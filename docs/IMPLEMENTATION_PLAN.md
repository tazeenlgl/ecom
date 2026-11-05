# Implementation plan

Status as of 2026-10-19. Each phase needs the user's approval before it starts.

## Done

| Phase | What | Evidence |
| --- | --- | --- |
| 0. Discovery | Read-only inspection, POS leads | [phase-0-discovery.md](phase-0-discovery.md) |
| Foundation | API service, brand, store and domain schema, host resolution, `PosGateway` port, CI | commit `a25e7c7` |
| Backend and database | All modules in [ARCHITECTURE.md](ARCHITECTURE.md), migrations `0001` and `0002`, 117 API operations, worker | branch `claude/project-thread-4t2912`, [TESTING.md](TESTING.md) (97 tests) |
| Knowledge base | `docs/`, `README.md`, `CLAUDE.md`, `CHANGELOG.md` | this folder |
| Paytm adapter (partial) | Per-store encrypted credentials, initiate, notification, status, refund | [PAYMENTS.md](PAYMENTS.md#paytm). Needs a staging test with a real test MID and key |

## Next (proposed order)

### 1. Review and merge the backend
- **Acceptance:** the PR is reviewed and CI is green on the merge.

### 2. Close the small backend gaps
Pick what the business needs from [KNOWN_ISSUES.md](KNOWN_ISSUES.md):
- a scheduler for stock sync and reconciliation;
- shared rate limits;
- a CORS allow-list;
- the return window as a store setting;
- tests for content and reports;
- request id and IP in audit rows;
- a development-only way to read OTPs locally, if approved.
- **Acceptance:** each item has tests and updated docs.

### 3. Storefront UI (built 2026-11-05 in `apps/web`; next: wishlist, reviews, facets once their endpoints exist)
- **Scope:** product listing and detail, cart, OTP sign-in, address book, checkout with quote confirmation, order history and tracking, returns, and content pages. Driven by per-store configuration and content blocks.
- **Depends on:** a CORS decision and a domain for a staging store.
- **Acceptance:** works on mobile, fails safely when stock is unknown, never sends prices as authoritative, accessibility basics.

### 4. Admin UI (first release built in `apps/admin`; see [ADMIN.md](ADMIN.md))
- **Scope:** store setup, catalogue and prices, promotions, orders and fulfillment, refunds, returns, POS status and recovery, jobs, audit.
- **Built:** sign-in with a server-side session (BFF, httpOnly cookie, CSRF), store selector limited to authorised stores, platform brands/stores/administrators, store dashboard, products with variants, prices and photos, categories, collections, promotions and coupons, orders with fulfilment, returns and refunds, customers, pages and blocks, shipping zones, store settings and domains, POS status, jobs, audit history, sales report.
- **Next:** size charts, attributes and specifications, promotion eligibility, Paytm credential entry, payment reconciliation, and the API gaps listed in [ADMIN.md](ADMIN.md#not-built-and-api-gaps).
- **Acceptance:** every action maps to an existing permission-checked endpoint. Met for everything built; `apps/admin/test/e2e-roles.mjs` checks four roles and cross-store access.

### 5. Provider integrations (each needs explicit approval)
- **POS:** after the API is verified. See [POS_INTEGRATION.md](POS_INTEGRATION.md#what-is-needed-to-build-the-adapter).
- **Payment gateway:** sandbox first, then a separate approval for live.
- **SMS:** DLT-registered templates, sandbox or test numbers first.
- **Courier:** shipment creation and a tracking webhook, reusing the `externalEventId` idempotency.
- **Acceptance:** contract tests against the provider sandbox, with no live calls in CI.

### 6. Deployment (needs explicit approval)
- See [DEPLOYMENT.md](DEPLOYMENT.md#before-the-first-production-deploy).
- **Acceptance:** staging environment, backups verified by a restore test, production migration plan approved.
