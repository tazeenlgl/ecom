# Migrations

Migrations live in `apps/api/drizzle/`, are recorded in `drizzle/meta/_journal.json`, and are applied by `npm run db:migrate` (`apps/api/src/db/migrate.ts`, using Drizzle's migrator). Applied migrations are tracked in the `drizzle.__drizzle_migrations` table, so running the command again does nothing.

## Current migrations

| # | File | Kind | What it does |
| --- | --- | --- | --- |
| 0000 | `0000_init.sql` | generated | `brands`, `stores`, `store_domains`, `audit_logs` (foundation commit `a25e7c7`) |
| 0001 | `0001_commerce_core.sql` | generated | 38 new tables and their enums, indexes and constraints. Adds columns `stores.config`, `stores.pos_location_ref` and `store_domains.verification_token`. **Additive only**: no drops, renames or type changes to `0000` objects |
| 0002 | `0002_order_snapshots_immutable.sql` | hand-written | Trigger functions and triggers that make order snapshots immutable ([DATABASE.md](DATABASE.md#immutability)) |

Applied so far only to local and test databases. **No migration has been run against any shared or production database.**

## Policy

1. **Never edit a migration that has been applied anywhere shared.** Fix forward with a new migration.
2. **Additive by default.** Add tables, columns (nullable or with a default) and indexes. Destructive changes need explicit approval and a multi-step plan: add the new column, backfill it, switch the code, then drop the old column later. Destructive changes are drops, renames, type narrowing, and `NOT NULL` on existing data.
3. **Generate, then review.** Run `npm run db:generate -- --name <change>` after editing `src/db/schema/*.ts`, then read the SQL. Hand-written SQL (triggers, data fixes) goes in its own migration file, registered in the journal.
4. **Test on a disposable database.** Migrate a fresh database twice: the second run must be a no-op. Then run the test suite, which migrates from zero.
5. **Large tables.** Create indexes `CONCURRENTLY` in a separate migration, and backfill in batches. There are no large tables yet.
6. **Production migrations need separate explicit approval** and a fresh backup first ([DEPLOYMENT.md](DEPLOYMENT.md)).

## Rollback

Drizzle migrations are forward-only, and there are no down files. To roll back:
- For an additive migration, deploy the previous code version. Unused new tables and columns do no harm, and they can be dropped later with approval.
- For anything else, restore from the backup taken before the migration, or write a corrective forward migration.

## Running

```sh
npm run db:migrate                                    # uses DATABASE_URL
DATABASE_URL=postgres://... npm run db:migrate        # explicit target
node apps/api/dist/db/migrate.js                      # from a built image (no dev dependencies needed)
```
