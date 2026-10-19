# Operations

Status: the tooling below is **implemented in the API**. Hosting, dashboards, alerting and backups are **planned**, because nothing is deployed.

## Logs

- Logs are structured JSON from pino. Every request log carries `reqId`, which matches the `x-request-id` response header. Clients can pass their own `x-request-id` to correlate requests.
- The `authorization`, `cookie` and `x-cart-token` headers are redacted. OTP codes, passwords, tokens and full phone numbers are never logged ([SECURITY.md](SECURITY.md#secrets-and-logging)).
- Notable log events:
  - `payment webhook processed` (with `outcome`);
  - `rejected payment webhook: verification failed`;
  - `payment initiation failed`;
  - `jobs processed`;
  - `worker loop error`;
  - 5xx errors with the stack trace (server-side only).

## Background jobs

The `jobs` table is the queue. The worker (`npm run worker`) polls it every `WORKER_POLL_INTERVAL_MS` when idle.

| Type | Queued by | Purpose |
| --- | --- | --- |
| `notify.order` | Order events | Send the customer message for a template (`order.confirmed`, `order.shipped`, `order.delivered`, `order.cancelled`, `refund.succeeded`, `return.<status>`) |
| `orders.expire_unpaid` | Online checkout (delayed) | Cancel orders still unpaid after the TTL |
| `pos.submit_order` | Order confirmation, admin retry | Send the order to the POS |
| `pos.cancel_order` | Cancellation of a synced order | Cancel in the POS, if supported |
| `pos.sync_stock` | Admin `POST .../pos/stock-sync` | Refresh the stock read model |
| `payments.process_refund` | Refund creation (online) | Send the refund to the provider |
| `payments.reconcile` | Admin `POST .../payments/reconcile` | Resolve payments stuck in `pending` |

Retries back off exponentially: 30 s, doubling, capped at 1 h. The default is 8 attempts. A job that fails permanently or runs out of attempts becomes `dead`, and its `last_error` is kept. A job left `running` for more than 15 minutes, for example because its worker crashed, is returned to the queue.

Admin tools (`jobs.manage`):
- `GET /v1/admin/stores/:storeId/jobs?status=dead` lists jobs.
- `POST .../jobs/:id/retry` re-queues a dead job.

Every retry is audited.

## Routine checks

| Check | How |
| --- | --- |
| POS health | `GET /v1/admin/stores/:storeId/pos/status`: capabilities, last stock sync, SKUs without stock, orders by POS sync status, dead jobs |
| Orders needing manual POS entry | Orders with `pos_sync_status = manual_required` or `failed`. Resolve with `pos-sync/retry` or `pos-sync/mark-synced` |
| Stuck payments | Run `POST .../payments/reconcile`. Investigate `payment_events` with outcomes `amount_mismatch`, `unknown_reference` and `duplicate_payment` |
| Duplicate payments | Timeline note on the order. Refund from the provider dashboard |
| Sales | `GET /v1/admin/stores/:storeId/reports/sales?from=&to=` |
| Audit | `GET /v1/admin/stores/:storeId/audit-logs` |

## Incidents (runbook outline)

- **POS down:** orders keep being accepted. Submissions fail and retry with backoff, then go `dead`. Checkout falls back to cached stock. After recovery, retry the dead jobs from the admin API.
- **Payment webhooks not arriving:** orders stay `pending_payment` and expire after the TTL. Run reconciliation. Late payments on expired orders are refunded automatically.
- **Suspected cross-store data exposure:** treat it as a security incident. Use the audit log and request ids to scope it. Composite foreign keys rule out cross-store references in the database itself.
- **Leaked secret:** rotate it in the secret store and redeploy. Rotating `OTP_HMAC_SECRET` only invalidates OTPs that are in flight.

## Backups (planned)

Use managed PostgreSQL with daily snapshots and point-in-time recovery. Test restores regularly. Take a backup before every production migration.
