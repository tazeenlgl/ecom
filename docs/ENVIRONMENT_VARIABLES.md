# Environment variables

All configuration comes from the environment. It is validated at startup by `apps/api/src/config/env.ts`, which fails fast and names the bad variable without printing its value. Local defaults are in [.env.example](../.env.example). Never commit real values.

| Variable | Required | Default | Purpose | Notes |
| --- | --- | --- | --- | --- |
| `NODE_ENV` | no | `development` | `development`, `test` or `production` | `production` enables the strict checks below |
| `HOST` | no | `0.0.0.0` | Listen address | |
| `PORT` | no | `4000` | Listen port | |
| `LOG_LEVEL` | no | `info` | pino level (`fatal` … `trace`, `silent`) | |
| `DATABASE_URL` | **yes** | — | PostgreSQL connection string | Secret: contains a password |
| `TRUST_PROXY` | no | `false` | Trust `X-Forwarded-*` from a reverse proxy | Set `true` **only** behind a proxy that overwrites these headers. Otherwise clients could spoof the host ([TENANCY.md](TENANCY.md#proxies)) |
| `OTP_HMAC_SECRET` | in production | development value | Key for the HMAC that stores OTP codes | Secret. At least 32 characters. Production refuses the default. Rotating it invalidates outstanding codes only |
| `CUSTOMER_SESSION_TTL_DAYS` | no | `30` | Customer session lifetime (1–365) | |
| `ADMIN_SESSION_TTL_HOURS` | no | `12` | Admin session lifetime (1–168) | |
| `SMS_PROVIDER` | no | `log` | `log` or `disabled` | `log` keeps codes in memory and is refused in production. `disabled` refuses to send. No live SMS adapter exists yet |
| `PAYMENT_PROVIDER` | no | `none` | `none` or `fake` | `fake` moves no money and is refused in production. No live gateway adapter exists yet |
| `FAKE_PAYMENT_WEBHOOK_SECRET` | when `PAYMENT_PROVIDER=fake` | — | Signs fake webhooks | At least 16 characters. Development and test only |
| `POS_ADAPTER` | no | `none` | `none` only | The real POS API is unverified ([POS_INTEGRATION.md](POS_INTEGRATION.md)) |
| `WORKER_POLL_INTERVAL_MS` | no | `2000` | Worker idle poll interval (≥ 100) | |

Used outside the app config:

| Variable | Used by | Purpose |
| --- | --- | --- |
| `TEST_DATABASE_URL` | `apps/api/test/helpers.ts` | Test database, whose public schema is **dropped**. Default `postgres://ecom:ecom@localhost:5432/ecom_test` |
| `ADMIN_PASSWORD` | `npm run admin:create` | Password for the bootstrapped platform owner, read from the environment so it stays out of command arguments |

When a real provider is approved, its credentials will be added here as new variables (for example a gateway key id, key secret and webhook secret), each validated in `env.ts`, with the live adapter selectable only by an explicit value.
