import type { FastifyInstance } from 'fastify';
import type { Database } from '../../db/client.js';
import { AppError } from '../../lib/errors.js';
import { normalizeHost } from './host.js';
import { findStoreByHostname, type ResolvedStore } from './repository.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** The store resolved from the request's host. Set only on store-scoped routes. */
    store: ResolvedStore;
  }
}

/**
 * Adds a hook to the current (encapsulated) Fastify context that resolves the
 * store from the Host header. Routes registered in that context can rely on
 * `request.store`. The store is never taken from client-supplied IDs.
 */
export function resolveStoreFromHost(app: FastifyInstance, db: Database): void {
  app.decorateRequest('store', null as unknown as ResolvedStore);
  app.addHook('onRequest', async (request) => {
    const hostname = normalizeHost(request.host);
    if (!hostname) throw new AppError(400, 'invalid_host', 'Invalid host.');

    const store = await findStoreByHostname(db, hostname);
    // Disabled stores and archived brands are indistinguishable from unknown hosts.
    if (!store || store.status === 'disabled' || store.brand.status !== 'active') {
      throw new AppError(404, 'store_not_found', 'Store not found.');
    }
    if (store.status === 'maintenance') {
      throw new AppError(503, 'store_maintenance', 'This store is temporarily unavailable.');
    }
    request.store = store;
  });
}
