# Security

Status: the controls below are **implemented and tested** unless marked otherwise. Nothing is deployed, so infrastructure controls (TLS, WAF, secret storage, backups) are **planned**.

## Threat model (summary)

| Threat | Main controls |
| --- | --- |
| One store reads or changes another store's data | Host-based store resolution, per-store admin permissions, `store_id` on every query, composite foreign keys ([TENANCY.md](TENANCY.md)) |
| A shopper manipulates prices, discounts or totals | All pricing on the server; client totals only detect change (`price_changed`) |
| Account takeover by OTP guessing | 6-digit codes, 5 attempts per code, 5-minute expiry, single use, per-phone and per-IP limits |
| Credential stuffing on passwords | scrypt hashes, constant-time comparison, a dummy hash for unknown users, in-process login limits |
| Forged or replayed payment webhooks | Signature verification on the raw body, dedupe by provider event id, amount checks, state-machine guards |
| Double charging or double ordering on retries | Idempotency keys, at most one succeeded payment per order (unique index) |
| Secret or personal-data leaks in logs and responses | Header redaction, masked recipients, no OTP or password logging, explicit response presenters |
| Rogue or compromised admin | Least-privilege roles, audit log, disabling an admin revokes their sessions |
| Host header spoofing | Only verified domains resolve; `X-Forwarded-Host` is trusted only with `TRUST_PROXY=true` |

## Authentication

**Customers** (`modules/customers`):
- **Phone numbers:** normalised to `+91XXXXXXXXXX` by `lib/india.ts`. Only Indian mobile numbers starting with 6–9 are accepted.
- **OTP policy** (`OTP_POLICY` in `otp.ts`):
  - 6 digits from `crypto.randomInt`, valid for 300 s.
  - At most 5 verification attempts per code.
  - A 30 s resend cooldown, at most 3 codes per phone per 15 minutes and 20 per IP per hour.
  - Each code works once.
- **OTP storage:** codes are stored only as `HMAC-SHA256(OTP_HMAC_SECRET, challengeId:code)` and compared in constant time. A wrong guess increments `attempts` in its own committed transaction, so a failure cannot be rolled back to retry.
- **No account enumeration:** `POST /auth/otp/request` returns the same response whether or not the number has an account. Reset codes are sent only to accounts that have a password. Blocked customers get no code.
- **Passwords:** optional, 8–200 characters, hashed with scrypt (N=16384, r=8, p=1, 16-byte salt, 64-byte key; `lib/crypto.ts`). Unknown phone numbers are checked against a dummy hash, so response time does not reveal whether an account exists. Changing or resetting a password revokes the customer's other sessions (reset revokes all of them).
- **Sessions:** a random 32-byte token is returned once. Only its SHA-256 hash is stored in `customer_sessions`. A session is valid only on the store whose host issued it, and expires after `CUSTOMER_SESSION_TTL_DAYS`. Logout revokes it.

**Admins** (`modules/iam`):
- Email and password login uses the same hashing as customers.
- Sessions expire after `ADMIN_SESSION_TTL_HOURS` and are stored hashed.
- Disabling an admin revokes all their sessions.
- The first admin is created from the command line (`npm run admin:create`), with the password read from the `ADMIN_PASSWORD` environment variable so it never appears in shell history arguments.

## Authorization

Every admin route declares one permission in `defineRoute`. The check runs before input parsing or the handler, so an unauthorized caller cannot probe validation errors. Store permissions require a grant for that store or a platform-wide grant. Platform permissions require a platform-wide grant. The permission is published as `x-permission` in OpenAPI and listed in [API.md](API.md#endpoint-index).

### Roles

Defined in code (`apps/api/src/modules/iam/permissions.ts`). Grants are stored in `admin_role_assignments`, where `store_id` NULL means platform-wide.

| Role | Permissions |
| --- | --- |
| `platform_owner` | everything |
| `store_manager` | all store permissions: `store.read`, `store.settings.manage`, `audit.read`, `catalogue.read/write`, `pricing.write`, `promotions.write`, `shipping.write`, `content.write`, `customers.read`, `orders.read/manage`, `refunds.manage`, `pos.manage`, `jobs.manage`, `reports.read` |
| `catalogue_editor` | `store.read`, `catalogue.read/write`, `pricing.write`, `promotions.write`, `content.write` |
| `order_manager` | `store.read`, `catalogue.read`, `customers.read`, `orders.read/manage`, `refunds.manage`, `reports.read` |
| `support` | `store.read`, `catalogue.read`, `customers.read`, `orders.read` |

Customers can reach only their own records: every customer query filters by both `customer_id` and `store_id`.

## Input and output

- Zod validates every request. Hostnames, PIN codes, Indian states, slugs, UUIDs and money fields have strict formats.
- Responses are built by presenters that select fields explicitly. Password hashes, token hashes, OTP hashes, idempotency keys and request hashes are never returned. Customer lists show only what support needs.
- Errors never include stack traces ([API.md](API.md#errors)).
- Security headers on every response: `x-content-type-options: nosniff` and `cache-control: no-store`. CORS is not enabled. The storefront UI will need an explicit allow-list, which is planned.

## Secrets and logging

- Configuration is read from the environment only (`src/config/env.ts`). Validation errors name the variable and never print its value.
- Production refuses to start with the development OTP secret, `SMS_PROVIDER=log` or `PAYMENT_PROVIDER=fake`.
- The logger redacts the `authorization`, `cookie` and `x-cart-token` headers.
- OTP codes and passwords are never logged. `LogMessageSender` logs only the channel, a masked recipient (every character except the last four replaced with `*`) and the template name. Codes are kept in an in-memory outbox for tests and local development.
- Job payloads carry ids only, never personal data or secrets.
- `.env` is git-ignored. `.env.example` contains no real values.

## Webhooks and payments

See [PAYMENTS.md](PAYMENTS.md).
- The webhook route reads the raw body (at most 256 KB) and the provider adapter verifies the signature before anything is parsed or stored.
- Unknown providers return 404.
- A browser redirect never changes payment state.
- The fake provider cannot be enabled in production.

## Audit

`lib/audit.ts` writes `audit_logs` rows in the same transaction as the change. Each row records the actor (admin, customer, system or webhook), action, entity and a summary of the changes, without secrets. Audited changes are platform changes (brands, stores, domains, settings), admin users and role grants, admin logins, catalogue and prices, promotions and coupons, shipping zones, content, job retries and POS overrides, and some order actions.

Every order change (status transitions, cancellations, refunds, COD collection, shipments, returns, POS sync) is also written to `order_events` with its actor. Read the audit log with `GET /v1/admin/stores/:storeId/audit-logs` (`audit.read`).

Planned: the audit row does not yet store the request id or IP address.

## Known gaps

See [KNOWN_ISSUES.md](KNOWN_ISSUES.md). The main ones:
- Login rate limits are per process.
- The repository is public.
- There is no CORS allow-list yet.
- Nothing is in place for TLS or secret storage because nothing is deployed.
- There is no admin multi-factor authentication.
