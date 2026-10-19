import Fastify, { type FastifyServerOptions } from 'fastify';
import type { Config } from './config/env.js';
import type { Database } from './db/client.js';
import { registerErrorHandling } from './lib/errors.js';
import { healthRoutes } from './modules/health/routes.js';
import { resolveStoreFromHost } from './modules/tenancy/resolve-store.js';
import { storeRoutes } from './modules/tenancy/routes.js';

export type AppDeps = {
  config: Pick<Config, 'LOG_LEVEL' | 'TRUST_PROXY' | 'NODE_ENV'>;
  db: Database;
};

export async function buildApp({ config, db }: AppDeps) {
  const logger: FastifyServerOptions['logger'] = {
    level: config.LOG_LEVEL,
    redact: ['req.headers.authorization', 'req.headers.cookie'],
    ...(config.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty' } } : {}),
  };

  const app = Fastify({ logger, trustProxy: config.TRUST_PROXY });
  registerErrorHandling(app);

  // Platform-level routes: no store context.
  await app.register(healthRoutes(db));

  // Storefront API: every route here is scoped to the store resolved from the host.
  await app.register(
    async (storefront) => {
      resolveStoreFromHost(storefront, db);
      await storefront.register(storeRoutes);
    },
    { prefix: '/v1/storefront' },
  );

  return app;
}
