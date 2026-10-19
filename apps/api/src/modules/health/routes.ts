import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Database } from '../../db/client.js';

export function healthRoutes(db: Database) {
  return async (app: FastifyInstance): Promise<void> => {
    app.get('/health/live', async () => ({ status: 'ok' }));

    app.get('/health/ready', async (request, reply) => {
      try {
        await db.execute(sql`select 1`);
        return { status: 'ok', checks: { database: 'ok' } };
      } catch (err) {
        request.log.error({ err }, 'readiness check failed');
        return reply.status(503).send({ status: 'unavailable', checks: { database: 'failed' } });
      }
    });
  };
}
