# ecom

Multi-brand, multi-domain e-commerce platform (India-first). One codebase and admin serve many brands; each brand's storefront is resolved from its domain on the server. The existing POS stays authoritative for SKU identity and stock.

- [Phase 0 discovery report](docs/phase-0-discovery.md)
- [Architecture](docs/architecture.md)

## Status

Platform foundation, first checkpoint:

- `apps/api` — Fastify + TypeScript API with PostgreSQL (Drizzle ORM)
  - Brand / store / domain schema with controlled SQL migrations
  - Store resolution from the `Host` header (verified domains only; client-sent store IDs are ignored)
  - Health probes, structured logging, safe error responses
  - `PosGateway` port for the POS integration (no adapter until the real POS API is verified)

Storefront (Next.js), admin panel, catalogue, checkout, payments and POS sync come in later phases.

## Local development

Requires Node 22 and Docker (or a local PostgreSQL 16).

```sh
cp .env.example .env
docker compose up -d postgres
npm install
npm run db:migrate
npm run dev            # http://localhost:4000/health/ready
```

To try the storefront API, add a brand, store and verified domain (e.g. `localhost`) to the database, then:

```sh
curl -H 'Host: localhost' http://localhost:4000/v1/storefront/store
```

## Tests

Integration tests run against a real PostgreSQL database and **drop and recreate its schema**, so point them at a dedicated database:

```sh
createdb ecom_test   # or via docker compose
TEST_DATABASE_URL=postgres://ecom:ecom@localhost:5432/ecom_test npm test
```

## Database changes

Edit `apps/api/src/db/schema.ts`, then generate a reviewed SQL migration:

```sh
npm run db:generate -- --name <change_name>
```
