# Deployment

Status: **planned. Nothing has been deployed**, and no hosting, domain, TLS or database provider has been chosen. Deployment needs the user's separate explicit approval. This document describes what the code expects. Everything below that is not marked "verified" is a proposal.

## What exists (verified)

- `apps/api/Dockerfile`: a multi-stage build on `node:22-alpine` that runs as the `node` user and starts `node dist/server.js`. Build it from the repository root with `docker build -f apps/api/Dockerfile .`. The image also contains `dist/worker.js`, `dist/db/migrate.js`, `dist/scripts/create-admin.js` and the `drizzle/` migrations.
- `docker-compose.yml`: local PostgreSQL only.
- CI: typecheck, tests, build and the OpenAPI drift check.

## Processes

| Process | Command (in the image, working directory `apps/api`) | Scale |
| --- | --- | --- |
| API | `node dist/server.js` | Horizontally, behind a load balancer |
| Worker | `node dist/worker.js` | One or more. Safe to run several because claims use `SKIP LOCKED` |
| Migrations | `node dist/db/migrate.js` | Once per release, before the new API version takes traffic, with approval |
| First admin | `ADMIN_PASSWORD=... node dist/scripts/create-admin.js <email> <name>` | Once |

Both the API and the worker handle `SIGTERM`. The worker finishes its current batch, and jobs that are interrupted are recovered after their 15-minute lease.

## Proposed topology

See the diagram in [ARCHITECTURE.md](ARCHITECTURE.md#deployment-topology-proposed-not-verified).
- A TLS-terminating proxy or load balancer in front of the API. Each brand domain points at it.
- Set `TRUST_PROXY=true` **only** when that proxy overwrites `X-Forwarded-Host` and `X-Forwarded-For`.
- Managed PostgreSQL 16 with automated backups and point-in-time recovery, in an Indian region for data residency (assumption: confirm the requirement).
- Health checks: `GET /health/live` (process up) and `GET /health/ready` (database reachable). These need no store host.

## Before the first production deploy

1. Make the GitHub repository private ([KNOWN_ISSUES.md](KNOWN_ISSUES.md)).
2. Choose hosting and set secrets in its secret store: `DATABASE_URL` and `OTP_HMAC_SECRET` (random, at least 32 characters).
3. Approve and implement live SMS and payment adapters. Production refuses to start with `SMS_PROVIDER=log` or `PAYMENT_PROVIDER=fake`. Without a payment adapter, online checkout is unavailable, and COD still works.
4. Replace the in-process login rate limits with a shared store if more than one API instance will run.
5. Schedule the recurring jobs (stock sync, payment reconciliation); see [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md).
6. Take a backup, run migrations with approval, then deploy the API and the worker.
7. Add domains and verify them by DNS TXT record. The development override is refused in production.

## Release and rollback

- Migrations are additive, so the previous API version keeps working after a migration. Roll back by redeploying the previous image ([MIGRATIONS.md](MIGRATIONS.md#rollback)).
- Never run migrations against production without separate approval.
