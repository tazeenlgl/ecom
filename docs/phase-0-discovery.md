# Phase 0 — Discovery Report

Date: 2026-10-19. Scope: read-only inspection from a cloud workspace with GitHub access to `tazeenlgl/*` repositories.

## 1. Verified facts

### Repository
- `tazeenlgl/ecom` existed on GitHub with **no branches and no commits** at inspection time (GitHub API `list_branches` returned an empty list; `git ls-remote` returned nothing). Nothing existed that could be overwritten.
- Remote: `https://github.com/tazeenlgl/ecom`. Visibility: **public**.
- Working branch for this work: `claude/project-thread-430gje`.

### Related repositories (read-only clones)
| Repository | What it is | POS relevance |
| --- | --- | --- |
| `tazeenlgl/whatsapp` | "Nexcred", an internal multi-project communications hub (React frontend, mostly mock data; `backend/`, `database/`, `infrastructure/` are empty placeholders) | Mentions "Yazin POS" only as a sample project name in mock data. No POS API client or schema. |
| `tazeenlgl/tazeen-mobile` | A Flutter app shell (theme + one customer home page), uploaded as a zip | No HTTP/API code at all. |
| `tazeenlgl/loancrm`, `tazeenlgl/lawyer.sudhar.in` | Unrelated by name | Not inspected further. |

### Tooling available in the build workspace
Node 22, Python 3.13, Docker 29, PostgreSQL 16 client and server.

## 2. Not verified (blocked)

The POS backend is **not in any GitHub repository this workspace can see**. The brief names two server paths:

- `/opt/tazeen-pos/offers-pos/backend`
- `/opt/tazeen-pos/backend`

Both live on a server that this workspace cannot reach. A read-only remote session on that server was offered and declined. Therefore **none** of the following are verified:

- Which backend is live, its language/framework and deployment.
- POS API routes, authentication, rate limits.
- SKU identity model (codes, barcodes, variant structure).
- Stock model (stored quantity vs movement ledger; per-branch/warehouse stock).
- Whether the POS supports order ingestion, reservation, cancellation or refunds.
- Server infrastructure: reverse proxy, domains, databases, queues, storage, backups.
- Existing payment, OTP, courier and notification integrations.

## 3. Reasonable inferences
- The POS is likely a custom in-house system ("tazeen-pos") with an "offers" variant; the two paths may be a fork or an older/newer copy of the same backend. This must be confirmed before any integration code is written.
- No existing commerce, brand or customer code exists to reuse; the e-commerce platform is greenfield.

## 4. Risks and blockers
| Risk | Impact | Mitigation |
| --- | --- | --- |
| POS contract unknown | POS sync (Phase 4) cannot be designed concretely | Integration is isolated behind a `PosGateway` port; no adapter is implemented until the real API is inspected |
| Repository is public | Any secret, customer data or POS detail committed later is world-readable | Make the repo private; `.env` files are git-ignored; secrets only via environment |
| Stock read model drifts from POS | Overselling | Read model stores `syncedAt`; checkout re-validates against POS when the POS supports a live read; reconciliation jobs |
| POS has no order ingestion | Online orders can't decrement POS stock automatically | Operator workflow + reconciliation report as fallback; decided in Phase 1 once verified |

## 5. Recommended decisions (for Phase 1 approval)
See [ARCHITECTURE.md](./ARCHITECTURE.md) (renamed from `architecture.md` and rewritten after this report).

## 6. Next approvals required
1. Read-only access to the POS server (or the POS source code) to complete the POS contract.
2. Approval of the Phase 1 architecture.
3. Hosting choice for staging/production (not provisioned; nothing deployed).
