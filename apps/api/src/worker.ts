import { hostname } from 'node:os';
import pino from 'pino';
import { createContext } from './app.js';
import { loadConfig } from './config/env.js';
import { createDatabase } from './db/client.js';
import { jobHandlers } from './modules/jobs/handlers.js';
import { runDueJobs } from './modules/jobs/queue.js';

/**
 * Background worker: polls the durable `jobs` table. Run one or more of these
 * alongside the API (`npm run worker`). Safe to scale out: jobs are claimed
 * with FOR UPDATE SKIP LOCKED.
 */
const config = loadConfig();
const log = pino({ level: config.LOG_LEVEL });
const { db, pool } = createDatabase(config.DATABASE_URL);
const ctx = createContext({ config, db }, log);
const handlers = jobHandlers(ctx);
const workerId = `${hostname()}:${process.pid}`;

let stopping = false;
const stop = (signal: string) => {
  log.info({ signal }, 'worker stopping');
  stopping = true;
};
process.on('SIGTERM', () => stop('SIGTERM'));
process.on('SIGINT', () => stop('SIGINT'));

log.info({ workerId, jobTypes: Object.keys(handlers) }, 'worker started');
while (!stopping) {
  try {
    const processed = await runDueJobs(db, handlers, workerId);
    if (processed > 0) log.info({ processed }, 'jobs processed');
    if (processed === 0) await new Promise((r) => setTimeout(r, config.WORKER_POLL_INTERVAL_MS));
  } catch (err) {
    log.error({ err }, 'worker loop error');
    await new Promise((r) => setTimeout(r, config.WORKER_POLL_INTERVAL_MS));
  }
}
await pool.end();
