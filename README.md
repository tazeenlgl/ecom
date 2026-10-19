# ecom

Multi-brand, multi-domain e-commerce platform for India. One codebase and one admin API serve many brands. Each storefront is resolved on the server from its verified domain. Brand differences live in configuration, not code. The existing POS remains authoritative for SKU identity and stock. This platform owns online prices, promotions, carts, checkout, orders, payments and customer-facing workflows.

**Status:** the backend API and database are implemented and tested. Storefront and admin UIs are not built yet. No live SMS, payment, courier or POS integration is active. See [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) and [docs/KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md).

Start with [docs/INDEX.md](docs/INDEX.md).

## What is in the repository

| Path | What it is |
| --- | --- |
| `apps/api` | Fastify + TypeScript API, Drizzle ORM, PostgreSQL. Storefront, admin and webhook endpoints, plus a background worker |
| `apps/api/drizzle` | Versioned SQL migrations (`0000`–`0002`) |
| `apps/api/test` | Vitest suites against a real PostgreSQL database |
| `docs/` | Knowledge base, architecture and generated `openapi.json` |

## Prerequisites

- Node 22 (`.nvmrc`)
- PostgreSQL 16 (Docker via `docker compose`, or a local install)

## Setup

```sh
cp .env.example .env
docker compose up -d postgres
npm install
npm run db:migrate
ADMIN_PASSWORD='choose-a-long-password' npm run admin:create -w @ecom/api -- you@example.com "Your Name"
npm run dev                         # API on http://localhost:4000
npm run dev:worker -w @ecom/api     # background jobs (separate terminal)
```

Check it is running with `curl http://localhost:4000/health/ready`. The OpenAPI document is served at `/v1/openapi.json`.

To try the storefront API locally, create a brand, a store and the domain `localhost` through the admin API. Verify the domain with `{"override": true}`, which is allowed outside production only. Then call:

```sh
curl -H 'Host: localhost' http://localhost:4000/v1/storefront/store
```

Step-by-step workflows are in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## Commands

Run from the repository root unless noted.

| Command | Does |
| --- | --- |
| `npm run dev` | API with reload |
| `npm run dev:worker -w @ecom/api` | Worker with reload |
| `npm run typecheck` | TypeScript, no emit |
| `npm test` | All tests (needs `TEST_DATABASE_URL`, see below) |
| `npm run build` | Compile to `apps/api/dist` |
| `npm run db:migrate` | Apply pending migrations to `DATABASE_URL` |
| `npm run db:generate -- --name <change>` | Generate a migration from schema changes |
| `npm run openapi -w @ecom/api` | Regenerate `docs/openapi.json` |
| `npm run admin:create -w @ecom/api -- <email> <name>` | Bootstrap a platform owner (password from `ADMIN_PASSWORD`) |

## Environment

Every variable is documented in [docs/ENVIRONMENT_VARIABLES.md](docs/ENVIRONMENT_VARIABLES.md). Production refuses to start with development-only settings, such as the default OTP secret, the log-only SMS sender or the fake payment provider.

## Tests

Tests run against a real PostgreSQL database and **drop and recreate its `public` schema**, so use a dedicated database:

```sh
createdb ecom_test   # or via docker compose
TEST_DATABASE_URL=postgres://ecom:ecom@localhost:5432/ecom_test npm test
```

External providers are fakes. See [docs/TESTING.md](docs/TESTING.md) for what is and is not covered.

## Documentation

- [docs/INDEX.md](docs/INDEX.md): reading order and map
- [CLAUDE.md](CLAUDE.md): rules for AI-assisted sessions
- [CHANGELOG.md](CHANGELOG.md)
