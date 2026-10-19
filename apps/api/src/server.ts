import { buildApp } from './app.js';
import { loadConfig } from './config/env.js';
import { createDatabase } from './db/client.js';

const config = loadConfig();
const { db, pool } = createDatabase(config.DATABASE_URL);
const app = await buildApp({ config, db });

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ host: config.HOST, port: config.PORT });
