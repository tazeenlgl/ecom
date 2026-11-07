# Environment variables

All configuration comes from the environment. It is validated at startup by `apps/api/src/config/env.ts`, which fails fast and names the bad variable without printing its value. Local defaults are in [.env.example](../.env.example). Never commit real values.

| Variable | Required | Default | Purpose | Notes |
| --- | --- | --- | --- | --- |
| `NODE_ENV` | no | `development` | `development`, `test` or `production` | `production` enables the strict checks below |
| `HOST` | no | `0.0.0.0` | Listen address | |
| `PORT` | no | `4000` | Listen port | |
| `LOG_LEVEL` | no | `info` | pino level (`fatal` … `trace`, `silent`) | |
| `DATABASE_URL` | **yes** | — | PostgreSQL connection string | Secret: contains a password |
| `MEDIA_ALLOWED_HOSTS` | no | empty | Hosts that image addresses (product photos, store logo and favicon, banner and homepage images) may point to | Comma-separated host names or `*.host` (one extra label in the API; Next.js treats `*` more widely, so use a wildcard only for a domain you fully control). Addresses must be `https`, default port, no credentials, no IP literals. **Empty accepts no new image address.** The storefront reads the same variable (set it in `apps/web/.env.local` too; it is read when the storefront is built and started, so **changing it needs a rebuild and restart**): its image optimizer fetches only these hosts, and images on other hosts are loaded directly by the browser. Existing rows on other hosts keep working but are not optimized and are left out of Open Graph and JSON-LD |
| `MEDIA_UPLOAD_MAX_BYTES` | no | `8000000` | Largest image the upload endpoint accepts (100000 to 20000000) | |
| `MEDIA_LOCAL_DIR` | no | `.local-media` | Folder for development uploads when no R2 variables are set | Git-ignored. Uploads are addressed as `https://local-media.test/<key>` (a pseudo host that resolves nowhere); the API serves them at `/v1/media/*` and the storefront and Admin development servers map that host to `/dev-media/*`. To save such an address in a block, list `local-media.test` in `MEDIA_ALLOWED_HOSTS` (API, storefront and Admin processes); normal validation still applies. Production has no local storage and answers 503 |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_BASE_URL` | all five or none | empty | Cloudflare R2 image storage (S3-compatible API at `https://<account id>.r2.cloudflarestorage.com`) | Secrets: the key id and secret. Server only; never logged or returned. `R2_PUBLIC_BASE_URL` is an https origin (for example `https://media.tazeen.in`) whose host must also be in `MEDIA_ALLOWED_HOSTS`; startup fails otherwise. A partial set fails startup naming the missing variables |
| `TRUST_PROXY` | no | `false` | Which peers may set `X-Forwarded-For` and `X-Forwarded-Host` | `false`, a hop count (1–8), or a comma-separated list of IPs, CIDR ranges, `loopback`, `linklocal` or `uniquelocal`. Only peers in the list are believed; anything a client puts in front of the real chain is ignored. `true` trusts every peer (any caller can choose its IP and store) and is **refused in production**; use `loopback` for local development ([TENANCY.md](TENANCY.md#proxies)) |
| `OTP_HMAC_SECRET` | in production | development value | Key for the HMAC that stores OTP codes | Secret. At least 32 characters. Production refuses the default. Rotating it invalidates outstanding codes only |
| `CUSTOMER_SESSION_TTL_DAYS` | no | `30` | Customer session lifetime (1–365) | |
| `ADMIN_SESSION_TTL_HOURS` | no | `12` | Admin session lifetime (1–168) | |
| `SMS_PROVIDER` | no | `log` | `log` or `disabled` | `log` keeps codes in memory and is refused in production. `disabled` refuses to send. No live SMS adapter exists yet |
| `PAYMENT_PROVIDER` | no | `none` | `none` or `fake` | `fake` moves no money and is refused in production. No live gateway adapter exists yet |
| `FAKE_PAYMENT_WEBHOOK_SECRET` | when `PAYMENT_PROVIDER=fake` | — | Signs fake webhooks | At least 16 characters. Development and test only |
| `CONFIG_ENCRYPTION_KEY` | in production | development value | Encrypts stored provider secrets (the Paytm merchant key) with AES-256-GCM | Secret. Base64 of 32 random bytes (`openssl rand -base64 32`). Production refuses the default. Changing it makes stored keys unreadable, so they must be re-entered |
| `PAYTM_STAGING_HOST` | no | `https://securestage.paytmpayments.com` | Paytm staging API host | Confirm against Paytm's current docs |
| `PAYTM_PRODUCTION_HOST` | no | `https://secure.paytmpayments.com` | Paytm production API host | Confirm against Paytm's current docs |
| `PAYTM_PRODUCTION_ENABLED` | no | `false` | Allows stores to choose Paytm `production` | Live payments. Set `true` only with the owner's approval |
| `POS_ADAPTER` | no | `none` | `none` only | The real POS API is unverified ([POS_INTEGRATION.md](POS_INTEGRATION.md)) |
| `WORKER_POLL_INTERVAL_MS` | no | `2000` | Worker idle poll interval (≥ 100) | |

Used outside the app config:

| Variable | Used by | Purpose |
| --- | --- | --- |
| `TEST_DATABASE_URL` | `apps/api/test/helpers.ts` | Test database, whose public schema is **dropped**. Default `postgres://ecom:ecom@localhost:5432/ecom_test`. Setup asks the live connection for `current_database()` and refuses to drop anything unless the real name ends in `_test` |
| `TRUSTED_PROXY_HOPS` | `apps/web`, `apps/admin` | Number of trusted reverse proxies in front of the server (0–8, default `0`). With `0`, no client IP is forwarded to the API. With `N`, the client is the Nth `X-Forwarded-For` entry from the right and must be a valid IP; the browser's own header is never copied. Set it only to the real number of proxies that overwrite or append the header, and keep the server unreachable except through them |
| `ADMIN_API_URL` | `apps/admin` | Where the admin server reaches the API (server to server) |
| `ADMIN_PASSWORD` | `npm run admin:create` | Password for the bootstrapped platform owner, read from the environment so it stays out of command arguments |
| `STOREFRONT_EDITORIAL_STORES` | `apps/web` | Comma-separated store slugs that get the editorial look without setting `theme.variant` in the store settings (local preview only) |
| `STOREFRONT_PREVIEW_OFFER` | `apps/web` | `CODE\|text` shown as the product-page offer when the store has none. Ignored in production builds; display only (local preview) |
| `STOREFRONT_PREVIEW_LAYOUT` | `apps/web` | `productsPhone,productsComputer,categoriesPhone,categoriesComputer` (e.g. `2,4,2,5`) previews cards per row when the store has no layout setting. Ignored in production builds (local preview) |
| `STOREFRONT_PREVIEW_PROMO` | `apps/web` | `Title|text` shown as the product-page promo note when the store has none. Ignored in production builds (local preview) |

When a real provider is approved, its credentials will be added here as new variables (for example a gateway key id, key secret and webhook secret), each validated in `env.ts`, with the live adapter selectable only by an explicit value.
