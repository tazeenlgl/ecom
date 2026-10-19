# Architecture decision records

Each record gives the context, the decision, its consequences and its status. Dates are when the decision was made. A decision is changed by adding a new record that supersedes it, not by editing the old one.

## ADR-001: Modular monolith on Node, Fastify, PostgreSQL and Drizzle (2026-10-19)

- **Context:** one team, one database. Checkout must change cart, order, promotion usage and job rows atomically.
- **Decision:**
  - One TypeScript service (`apps/api`), split into modules by business area.
  - Separate API and worker processes built from the same code.
  - PostgreSQL 16, accessed through Drizzle ORM with SQL migrations.
  - Zod for validation and OpenAPI generation.
- **Consequences:** simple transactions and deployment. Module boundaries rely on discipline and review rather than on network calls. A module could be split out later behind its existing function interface.
- **Status:** accepted. This was set in the foundation commit `a25e7c7`.

## ADR-002: Store resolved only from a verified hostname (2026-10-19)

- **Context:** the brief requires that a client can never pick its store.
- **Decision:** storefront routes resolve the store in an `onRequest` hook from `store_domains` where `verified_at IS NOT NULL`. Admin routes carry `:storeId` in the path and are authorized per store.
- **Consequences:** a new brand needs a verified domain before it can sell. Local development uses an audited override that is refused in production.
- **Status:** accepted.

## ADR-003: Composite tenant foreign keys (2026-10-19)

- **Decision:** child tables reference parents through `(store_id, id)`.
- **Consequences:** cross-store references are impossible even if code has a bug. The cost is an extra unique index per parent table.
- **Status:** accepted.

## ADR-004: Roles and permissions defined in code, grants in the database (2026-10-19)

- **Decision:** a fixed set of permissions and five roles in `iam/permissions.ts`. `admin_role_assignments` stores grants, either per store or platform-wide.
- **Consequences:** permissions are reviewed and versioned together with the routes that check them. Custom roles per store are not possible without a code change.
- **Status:** accepted. Revisit if stores need their own custom roles.

## ADR-005: Money as integer paise, GST-inclusive prices (2026-10-19)

- **Decision:** every amount is an integer number of paise. Catalogue prices include GST. Included tax is derived per line from `products.tax_rate_bps` and snapshotted on order items.
- **Consequences:** there is no floating-point error. Shipping and COD fees carry no tax breakdown yet ([KNOWN_ISSUES.md](KNOWN_ISSUES.md)).
- **Status:** accepted. **Assumption:** prices are GST-inclusive, as is normal for Indian B2C. Confirm this with the business.

## ADR-006: OTPs stored as an HMAC, opaque hashed session tokens (2026-10-19)

- **Decision:**
  - OTP codes are stored as `HMAC(OTP_HMAC_SECRET, challengeId:code)`.
  - Sessions are random 32-byte tokens, stored as SHA-256 hashes.
  - Passwords are hashed with scrypt from `node:crypto`.
- **Consequences:** a database leak does not reveal codes, tokens or passwords, and no extra crypto dependency is needed. Sessions can be revoked immediately, which JWTs could not offer.
- **Status:** accepted.

## ADR-007: Customer accounts are per store (2026-10-19)

- **Context:** brands may be separate businesses, and sharing customer identities across them is a privacy and business decision.
- **Decision:** `customers` is unique on `(store_id, phone)`, and sessions are bound to a store.
- **Consequences:** a shopper registers separately on each brand. Linking accounts later would need a new table and consent.
- **Status:** accepted for now. **Open question** for the business: should stores of the same brand share accounts?

## ADR-008: Checkout requires a signed-in customer (2026-10-19)

- **Decision:** guests can browse and build carts, but placing an order requires OTP sign-in. The guest cart merges on sign-in.
- **Consequences:** every order has a verified mobile number, which matters for COD and order lookup. It adds one step for first-time buyers.
- **Status:** accepted.

## ADR-009: Unknown stock means unavailable (2026-10-19)

- **Decision:** a SKU with no stock data cannot be bought. SKUs the POS omits from a stock response are recorded as 0.
- **Consequences:** overselling cannot happen because of missing data. With no POS adapter, nothing is purchasable until stock is loaded.
- **Status:** accepted.

## ADR-010: Durable jobs in PostgreSQL, no message broker (2026-10-19)

- **Decision:** a `jobs` table claimed with `FOR UPDATE SKIP LOCKED`, with exponential backoff, a dead state and per-job idempotency keys. Jobs are enqueued inside the business transaction.
- **Consequences:** this is transactional outbox semantics with no new infrastructure. Throughput is limited by PostgreSQL, which is adequate at the expected scale.
- **Status:** accepted.

## ADR-011: Idempotency keys stored on the business row (2026-10-19)

- **Decision:** there is no generic idempotency table.
  - Checkout stores the key and a request hash on `orders`.
  - Refunds store the key on `refunds`.
  - Webhooks use `(provider, provider_event_id)` on `payment_events`.
  - Jobs use `jobs.idempotency_key`.
- **Consequences:** the key and the result commit atomically. Each new idempotent operation needs its own unique constraint.
- **Status:** accepted.

## ADR-012: Payments only through verified provider signals (2026-10-19)

- **Decision:** payment state changes only on a verified webhook or a server-side status check through the same event path. A browser redirect never counts.
- **Consequences:**
  - Late, duplicate and out-of-order events are handled explicitly.
  - A success after cancellation is refunded automatically.
  - A second success on an already paid order is flagged for staff.
- **Status:** accepted.

## ADR-013: No production adapters for unverified or unapproved systems (2026-10-19)

- **Context:** these are the user's rules. Do not write a POS adapter against a guessed API. Do not activate SMS, payment or courier providers without approval.
- **Decision:** ports with an unconfigured default and test doubles only. Production refuses the development-only adapters.
- **Status:** accepted. The POS remains blocked: remote access to the POS server was declined on 2026-10-19.

## ADR-014: Immutable order snapshots enforced by database triggers (2026-10-19)

- **Decision:** migration `0002` rejects updates and deletes on `order_items`, and changes to the snapshot and money columns of `orders`.
- **Consequences:** history cannot be rewritten by a bug or a manual query without dropping the trigger. Corrections are new rows.
- **Status:** accepted.
