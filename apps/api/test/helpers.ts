import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { buildApp } from '../src/app.js';
import { createDatabase, type Database } from '../src/db/client.js';
import { migrationsFolder } from '../src/db/migrate.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://ecom:ecom@localhost:5432/ecom_test';

export async function setupTestApp() {
  const { db, pool } = createDatabase(TEST_DATABASE_URL);
  await db.execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
  await migrate(db, { migrationsFolder });
  const app = await buildApp({ config: { LOG_LEVEL: 'silent', TRUST_PROXY: false, NODE_ENV: 'test' }, db });
  return {
    app,
    db,
    close: async () => {
      await app.close();
      await pool.end();
    },
  };
}

export type TestDb = Database;
