# Known issues, risks and open decisions

Last reviewed 2026-10-19.

## Blocked

| Item | Why | Unblocks with |
| --- | --- | --- |
| Real POS adapter | POS API not inspected. Server access was declined | Source or API docs, a sandbox, and answers to the unknowns in [POS_INTEGRATION.md](POS_INTEGRATION.md) |
| Live SMS (OTP and notifications) | No provider chosen. Activation needs approval | Provider choice, DLT registration of templates (an Indian telecom requirement), credentials |
| Live payment gateway | No provider chosen. Activation needs approval | Provider choice, sandbox credentials, then a separate approval for live |
| Courier integration | No courier chosen | Courier choice and API docs |
| Production deployment | Needs separate approval and hosting decisions | [DEPLOYMENT.md](DEPLOYMENT.md) |

## Limitations in the current code

1. **Nothing is purchasable without stock data.** With `POS_ADAPTER=none`, every variant is `stock_unknown`. This is intentional ([DECISIONS.md](DECISIONS.md) ADR-009), but it means checkout works only in tests until a POS adapter exists or stock is loaded. There is no manual stock-entry endpoint, because that would create a competing stock record.
2. **Login rate limits are in-process.** Admin and customer password logins, OTP verification and payment initiation limits reset on restart, and each instance counts separately. OTP *issue* limits are database-backed and hold across instances. Fix: move the limits to PostgreSQL or Redis before running more than one instance.
3. **Recurring jobs are not scheduled.** `pos.sync_stock` and `payments.reconcile` run only when an admin endpoint queues them. A scheduler is needed: a cron-triggered endpoint or a self-rescheduling job.
4. **Cached stock has no freshness limit.** If the live POS check fails at checkout, the read model is used whatever its age. A maximum age should be decided.
5. **Duplicate online payments** (two successful payments for one order) are flagged but must be refunded by hand in the provider dashboard. Auto-refunding needs the real provider's refund semantics.
6. **No GST breakdown for shipping or COD fees.** Tax is computed on item lines only. Invoicing and GST reporting are out of scope until the accounting owner is decided.
7. **Multi-shipment orders.** Order fulfillment status follows the latest shipment event, so one delivered shipment marks the whole order delivered and completed.
8. **The return window is hard-coded** at 7 days (`RETURN_WINDOW_DAYS`) instead of being a store setting.
9. **Exchanges** are recorded and approved, but no replacement order is created automatically. Staff ship the replacement manually.
10. **Reports** are basic: daily sales and top SKUs, in the store's timezone (default `Asia/Kolkata`). There is no export.
11. **Local customer sign-in.** OTPs are never logged, so a developer cannot complete OTP sign-in by hand against `npm run dev`. Possible fix: a development-only endpoint, refused in production, that returns the last code for a phone number. Not built without approval.
12. **No CORS configuration** yet. The storefront UI will need an explicit origin allow-list per store domain.
13. **Admin accounts have no multi-factor authentication.**
14. **The audit log has no request id or IP address.**
15. **Tests not written** for the content and reports endpoints and the worker loop ([TESTING.md](TESTING.md#not-covered-yet)).
16. **An empty `apps/api/src/modules/pricing/` folder** is left over from the foundation. Price endpoints live in `catalogue`.

## Risks

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
