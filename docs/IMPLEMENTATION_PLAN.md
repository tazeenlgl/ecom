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

### 3. Storefront UI (not started by instruction)
- **Scope:** product listing and detail, cart, OTP sign-in, address book, checkout with quote confirmation, order history and tracking, returns, and content pages. Driven by per-store configuration and content blocks.
- **Depends on:** a CORS decision and a domain for a staging store.
- **Acceptance:** works on mobile, fails safely when stock is unknown, never sends prices as authoritative, accessibility basics.

### 4. Admin UI
- **Scope:** store setup, catalogue and prices, promotions, orders and fulfillment, refunds, returns, POS status and recovery, jobs, audit.
- **Acceptance:** every action maps to an existing permission-checked endpoint.

### 5. Provider integrations (each needs explicit approval)
- **POS:** after the API is verified. See [POS_INTEGRATION.md](POS_INTEGRATION.md#what-is-needed-to-build-the-adapter).
- **Payment gateway:** sandbox first, then a separate approval for live.
- **SMS:** DLT-registered templates, sandbox or test numbers first.
- **Courier:** shipment creation and a tracking webhook, reusing the `externalEventId` idempotency.
- **Acceptance:** contract tests against the provider sandbox, with no live calls in CI.

### 6. Deployment (needs explicit approval)
- See [DEPLOYMENT.md](DEPLOYMENT.md#before-the-first-production-deploy).
- **Acceptance:** staging environment, backups verified by a restore test, production migration plan approved.
