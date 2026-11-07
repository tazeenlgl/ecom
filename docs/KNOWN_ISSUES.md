# Known issues, risks and open decisions

Last reviewed 2026-11-05.

## Blocked

| Item | Why | Unblocks with |
| --- | --- | --- |
| Real POS adapter | POS API not inspected. Server access was declined | Source or API docs, a sandbox, and answers to the unknowns in [POS_INTEGRATION.md](POS_INTEGRATION.md) |
| Live SMS (OTP and notifications) | No provider chosen. Activation needs approval | Provider choice, DLT registration of templates (an Indian telecom requirement), credentials |
| Paytm on staging | The adapter is built, but no Paytm test MID or key is available to run it against staging | A store admin enters the staging MID and key with `PUT .../payment-gateways/paytm`, then a test payment confirms the checksum and API fields ([PAYMENTS.md](PAYMENTS.md#not-verified-yet)) |
| Live Paytm | Needs the owner's approval | Staging verified, then `PAYTM_PRODUCTION_ENABLED=true` and the production MID and key |
| Courier integration | No courier chosen | Courier choice and API docs |
| Production deployment | Needs separate approval and hosting decisions | [DEPLOYMENT.md](DEPLOYMENT.md) |

## Limitations in the current code

1. **Nothing is purchasable without stock data.** With `POS_ADAPTER=none`, every variant is `stock_unknown`. This is intentional ([DECISIONS.md](DECISIONS.md) ADR-009), but it means checkout works only in tests until a POS adapter exists or stock is loaded. There is no manual stock-entry endpoint, because that would create a competing stock record.
2. **Login rate limits are in-process.** Admin and customer password logins, OTP verification and payment initiation limits reset on restart, and each instance counts separately. OTP *issue* limits are database-backed and hold across instances. Fix: move the limits to PostgreSQL or Redis before running more than one instance.
3. **Recurring jobs are not scheduled.** `pos.sync_stock` and `payments.reconcile` run only when an admin endpoint queues them. A scheduler is needed: a cron-triggered endpoint or a self-rescheduling job.
4. **Cached stock has no freshness limit.** If the live POS check fails at checkout, the read model is used whatever its age. A maximum age should be decided.
5. **Paytm refunds stay `processing`** after Paytm accepts them. There is no refund-status webhook or poll, and the refund-status API and refund notification format are not verified, so nothing finishes the refund automatically. Staff settle it with `mark-succeeded` or `mark-failed` after checking the Paytm dashboard (the order page offers both). Paytm's API responses are also not signature-checked yet. Blocked on: the verified refund status contract and a staging account.
6. **Duplicate online payments** (two successful payments for one order) are flagged but must be refunded by hand in the provider dashboard. Auto-refunding needs the real provider's refund semantics.
7. **No GST breakdown for shipping or COD fees.** Tax is computed on item lines only. Invoicing and GST reporting are out of scope until the accounting owner is decided.
8. **Multi-shipment orders.** Order fulfillment status follows the latest shipment event, so one delivered shipment marks the whole order delivered and completed.
9. **The return window is hard-coded** at 7 days (`RETURN_WINDOW_DAYS`) instead of being a store setting.
10. **Exchanges** are recorded and approved, but no replacement order is created automatically. Staff ship the replacement manually.
11. **Reports** are basic: daily sales and top SKUs, in the store's timezone (default `Asia/Kolkata`). There is no export.
12. **Local customer sign-in.** OTPs are never logged, so a developer cannot complete OTP sign-in by hand against `npm run dev`. Possible fix: a development-only endpoint, refused in production, that returns the last code for a phone number. Not built without approval.
13. **No CORS configuration.** Not needed by the storefront: `apps/web` calls the API server-to-server through its BFF route. A browser-based admin UI on another origin would need an allow-list.
14. **Admin accounts have no multi-factor authentication.**
15. **The audit log has no request id or IP address.**
16. **Tests not written** for the content and reports endpoints and the worker loop ([TESTING.md](TESTING.md#not-covered-yet)). The product list and sales report now have regression tests.
17. **Admin API gaps found while building the admin UI** ([ADMIN.md](ADMIN.md#not-built-and-api-gaps)): no count endpoints, no order text search or customer filter, no list of return requests, no way to list another administrator's role grants, no read of a collection's products, no product delete, and no password change or reset for administrators.
18. **`PATCH /v1/admin/stores/:storeId` with an empty body returns 500** instead of 400 (an empty update set). The admin UI always sends a field.
19. **Block and media validation requires https image addresses.** A relative path such as `/photos/x.jpg` (used by the local preview) can be inserted into the database directly but cannot be saved through the API. Local development uploads therefore use the pseudo host `local-media.test` (see ENVIRONMENT_VARIABLES.md).
20. **Rate limits are in memory.** Admin sign-in (10 per client IP and 5 per account per 15 minutes, the account key a keyed hash of the normalised email) and failed coupon attempts (10 per cart and 30 per client IP per 15 minutes) reset when the API restarts, and with several API instances each enforces its own count. Move them to a shared store before running more than one instance. Behind a proxy that does not forward a valid client IP, everyone shares one per-IP bucket. A determined attacker can still lock a known administrator out by failing five times (account limits trade availability for safety).
17. **An empty `apps/api/src/modules/pricing/` folder** is left over from the foundation. Price endpoints live in `catalogue`.

21. **Customer account follow-ups** (after phase 1): the password reset and sign-in screens cannot be completed end to end until a real SMS provider is approved (the log sender never delivers). A customer's email is not verified, and a name cannot be cleared once set. Addresses have no maximum count. A customer who forgets their password and never set one signs in with a one-time code instead. Dialog behaviour (Escape, focus trap, double submit) has no automated test; use the manual checklist in the phase 1 report.

22. **A failed refund's money is held for 24 hours.** Settlement is now stored on the refund (migration 0004), but the hold is a fixed rule: a genuine provider failure also waits 24 hours before the money can be refunded again, and cancelling a paid order inside that window fails with `422` because the held money is not refundable. Refunds settled before the migration have no settlement metadata.
23. **Payment safety follow-ups:** a transaction left `created` (the process stopped between saving it and the provider call, so it has no provider reference) is not reconciled or closed. An abandoned attempt is checked only for 48 hours after its creation. A Paytm refund notification, if its form fields look like a payment notification, could be read as one; the format is unverified. The refund job still calls the provider inside a database transaction. The late-payment window uses the store's `unpaidOrderTtlMinutes` against the order's placed time, with no grace period. A test database whose clock runs ahead of the machine can make job-driven tests flaky (`commerce.test.ts` failed 3 tests in 2 of about 6 runs; not fixed here).

## Risks

- **Image optimizer redirects (R2 residual).** The storefront restricts `/_next/image` to `MEDIA_ALLOWED_HOSTS`, but Next.js 15.5.29 follows redirects from an allowed host and has no private-address or DNS-rebinding check (verified in `node_modules/next/dist/server/image-optimizer.js`). Allow only trusted hosts that do not redirect, filter the storefront server's outbound traffic to private ranges and the metadata address, and rate-limit `/_next/image` at the edge. A hardened proxy or a Next.js upgrade is the fix; see `docs/product-management/MEDIA_ARCHITECTURE.md` section 7.
- **Legacy photos on other hosts.** Rows created before `MEDIA_ALLOWED_HOSTS` may point at hosts that are not listed. They still display (loaded directly, unoptimized) but are left out of Open Graph and JSON-LD, and editing a store's logo or favicon on such a host is refused until the host is listed or the image is re-hosted.

| Risk | Impact | Mitigation |
| --- | --- | --- |
| **The repository is public** | Anyone can read the code and any secret committed by mistake | Make it private. `.env` is git-ignored. Secrets come only from the environment |
| Stock read model drifts from the POS | Overselling or false out-of-stock | Live check at checkout when supported, `synced_at` shown in POS status, sync job |
| The POS cannot accept orders | Online sales never reduce POS stock automatically | `manual_required` workflow with the admin `mark-synced` endpoint |
| The POS does not honour the order-number idempotency key | Retries could duplicate POS orders | Verify during adapter work. Consider reservations or a POS-side lookup before retrying |
| One POS shared by all stores (assumption) | Wrong stock if stores use separate POS instances | `pos_location_ref` per store. Revisit once the POS is known |

## Open decisions for the business

1. Should stores of the same brand share customer accounts? (ADR-007)
2. Confirm that prices are GST-inclusive, and who owns invoicing and GST filing.
3. Which payment gateway, SMS provider and courier to use.
4. Return and exchange policy per store: window, which items are eligible, who pays return shipping.
5. COD limits and fees per store and zone. The mechanisms exist; the values are business settings.
6. Data residency and retention requirements for customer data.

## Editorial look (Milestone 1)

- **No real hero content yet:** the published homepage hero has no image, so the transparent header and full-bleed hero only show once licensed desktop and mobile campaign images are published. Verified with a temporary stand-in page that was removed.
- **Header over any image:** the transparent header relies on a dark top gradient for contrast; check each new campaign image.
- **Animations:** header and hero transitions were checked by their end states only; a visible-browser pass is still needed.
- **Local setup:** the demo store's relative logo path is rejected by the settings API, so the variant is set with an environment variable locally.
