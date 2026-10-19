# Testing

## Strategy

- **Unit tests** cover pure logic: the promotion engine and allocation, state machines, permissions, phone and host normalisation, included-GST calculation and recipient masking.
- **Integration tests** build the whole Fastify app with `buildApp` and send HTTP requests with `app.inject`. They run against a **real PostgreSQL database**, migrated from the real migration files before each test file. Nothing in the data layer is mocked.
- **External systems are fakes**, injected through `buildApp({ overrides })`:
  - SMS: `LogMessageSender`. Tests read OTP codes from its in-memory outbox.
  - Payments: `FakePaymentProvider`, which uses signed fake webhooks.
  - DNS: `FakeDns`, for domain verification.
  - POS: `InMemoryPosGateway` (`test/support/in-memory-pos.ts`), or the default unconfigured gateway.
  - Clock: `clock.offsetMs` moves "now" forward to test expiry and cooldowns.
- **No production data** is used. Test data is generated in `test/helpers.ts` (`seedStore` and others).

## Running

```sh
# Needs PostgreSQL 16. The test database's public schema is DROPPED and recreated.
createdb ecom_test
TEST_DATABASE_URL=postgres://ecom:ecom@localhost:5432/ecom_test npm test
```

If `TEST_DATABASE_URL` is unset, tests use `postgres://ecom:ecom@localhost:5432/ecom_test`. Files run one at a time (`fileParallelism: false` in `apps/api/vitest.config.ts`) because they share one database.

Other checks:

```sh
npm run typecheck
npm run build
npm run openapi -w @ecom/api && git diff --exit-code docs/openapi.json   # contract drift
```

CI (`.github/workflows/ci.yml`) runs all of these on every push and pull request, with a PostgreSQL 16 service container.

## Latest results

Run on 2026-10-19 in the development container (Node 22, PostgreSQL 16):

| File | Tests | What it covers |
| --- | --- | --- |
| `test/unit.test.ts` | 22 | Promotion engine (priority, stacking, thresholds, BxGy, caps, allocation), state machines, permissions, phone normalisation, included-GST calculation, recipient masking |
| `test/host.test.ts` | 12 | Host header normalisation |
| `test/tenancy.test.ts` | 12 | Domain → store resolution; client store ids ignored; `X-Forwarded-Host` only with a trusted proxy; maintenance; malformed hosts; health; no leaks on unknown routes |
| `test/auth.test.ts` | 11 | OTP issue, verify, attempt limit, expiry, cooldown, cross-store rejection; session store binding; logout; password set, login and reset; no enumeration; addresses |
| `test/admin.test.ts` | 14 | Login; no hash leaks; per-store and platform permissions; read-only roles; cross-store 404; DNS verification and audit; duplicate hostnames; disabled stores; attribute validation; publish rules; error shape; request ids; OpenAPI completeness |
| `test/commerce.test.ts` | 15 | Storefront catalogue; stock unknown vs zero; server pricing; cross-store cart isolation; stock issues; cart merge; coupons and stacking; idempotent COD checkout; snapshot immutability; order privacy; illegal transitions; shipping lifecycle with out-of-order events; POS submission retries, dead-lettering and admin retry |
| `test/payments.test.ts` | 7 | Unsigned or tampered webhooks; success once, late failure ignored; amount mismatch; success after failure; unpaid expiry plus refund of a late payment; reconciliation; idempotent, capped refunds |
| `test/database.test.ts` | 4 | Migration journal applies in order; composite tenant keys; payment event dedupe; job idempotency |
| `test/paytm.test.ts` | 11 | Paytm checksum round trip and tampering; rupee/paise conversion; admin settings (key required once, never returned, encrypted at rest, kept on update, not in audit); production refused; permission and cross-store checks; signed initiate request; notification checksum, MID and amount checks; duplicates; reconciliation through order status; refund with Paytm's txn id; fallback when disabled. **Paytm itself is simulated** |
| **Total** | **108 passed** | `Test Files 9 passed (9)`, `Tests 108 passed (108)` |

Also verified on 2026-10-19:
- `npm run typecheck` and `npm run build` pass.
- `npm run db:migrate` was run twice against a fresh database. The second run was a no-op, leaving 3 migrations applied and 42 tables. The database was then dropped.

## Not covered (yet)

- **Real providers:** SMS, Paytm staging, courier and POS. Contract tests are needed once each one is chosen ([POS_INTEGRATION.md](POS_INTEGRATION.md)).
- **Load and concurrency at scale.** Concurrent checkout with the same idempotency key is handled in code but has no dedicated stress test.
- **The worker process loop** (`src/worker.ts`). Job handlers are tested through `runDueJobs` directly.
- **Rate limits across several instances.** They are in-process; see [KNOWN_ISSUES.md](KNOWN_ISSUES.md).
- **The content and reports endpoints.** They are exercised only by the OpenAPI completeness test. They need dedicated tests.
- **Browser flows.** There is no UI yet.
