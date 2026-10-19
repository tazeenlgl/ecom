import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { loadConfig } from '../config/env.js';
import { createDatabase } from './client.js';

export const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

async function main() {
  const { db, pool } = createDatabase(loadConfig().DATABASE_URL);
  try {
    await migrate(db, { migrationsFolder });
    console.log('Migrations applied.');
  } finally {
    await pool.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
