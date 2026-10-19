import { and, count, desc, eq, max } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { jobs, orders, posStockLevels, stores } from '../../db/schema.js';
import { actorOf, recordAudit } from '../../lib/audit.js';
import { AppError, notFound } from '../../lib/errors.js';
import { defineRoute, storeEntityParams, storeParams } from '../../lib/route.js';
import { requireStore } from '../platform/routes.js';
import { skusWithoutStock } from '../pos/stock.js';
import { enqueueJob } from './queue.js';

export function jobAdminRoutes(ctx: AppContext) {
  return async (app: FastifyInstance) => {
    const jobsAuth = { admin: 'jobs.manage' } as const;

    defineRoute(
      app,
      {
        method: 'GET',
        url: '/stores/:storeId/jobs',
        summary: 'Background jobs for a store (default: dead jobs needing attention)',
        tag: 'Admin: jobs',
        auth: jobsAuth,
        params: storeParams,
        query: z.object({ status: z.enum(['queued', 'running', 'succeeded', 'dead']).default('dead'), limit: z.coerce.number().int().min(1).max(100).default(50) }),
      },
      async (_r, { params, query }) => ({
        items: await ctx.db
          .select({ id: jobs.id, type: jobs.type, status: jobs.status, attempts: jobs.attempts, maxAttempts: jobs.maxAttempts, runAt: jobs.runAt, lastError: jobs.lastError, payload: jobs.payload, createdAt: jobs.createdAt })
          .from(jobs)
          .where(and(eq(jobs.storeId, params.storeId), eq(jobs.status, query.status)))
          .orderBy(desc(jobs.createdAt))
          .limit(query.limit),
      }),
    );

    defineRoute(
      app,
      { method: 'POST', url: '/stores/:storeId/jobs/:id/retry', summary: 'Re-queue a dead job with a fresh attempt budget', tag: 'Admin: jobs', auth: jobsAuth, params: storeEntityParams },
      async (request, { params }) =>
        ctx.db.transaction(async (tx) => {
          const [job] = await tx.select().from(jobs).where(and(eq(jobs.storeId, params.storeId), eq(jobs.id, params.id))).for('update');
          if (!job) throw notFound('Job');
          if (job.status !== 'dead') throw new AppError(409, 'conflict', 'Only dead jobs can be retried.');
          const [updated] = await tx.update(jobs).set({ status: 'queued', attempts: 0, runAt: ctx.now(), lastError: null }).where(eq(jobs.id, job.id)).returning();
          await recordAudit(tx, { storeId: params.storeId, actor: actorOf(request), action: 'job.retry', entityType: 'job', entityId: job.id, changes: { type: job.type } });
          return { job: updated };
        }),
    );

    // POS diagnostics -----------------------------------------------------------
    const posAuth = { admin: 'pos.manage' } as const;

    defineRoute(app, { method: 'GET', url: '/stores/:storeId/pos/status', summary: 'POS adapter capabilities, stock freshness, unsynced orders and failed jobs', tag: 'Admin: POS', auth: posAuth, params: storeParams }, async (_r, { params }) => {
      const store = await requireStore(ctx.db, params.storeId);
      const [syncByStatus, deadJobs, freshness, missing] = await Promise.all([
        ctx.db.select({ status: orders.posSyncStatus, n: count() }).from(orders).where(eq(orders.storeId, store.id)).groupBy(orders.posSyncStatus),
        ctx.db.select({ type: jobs.type, n: count() }).from(jobs).where(and(eq(jobs.storeId, store.id), eq(jobs.status, 'dead'))).groupBy(jobs.type),
        ctx.db.select({ lastSyncedAt: max(posStockLevels.syncedAt) }).from(posStockLevels).where(eq(posStockLevels.locationRef, store.posLocationRef ?? '')),
        skusWithoutStock(ctx, store.id, store.posLocationRef),
      ]);
      return {
        adapter: ctx.config.POS_ADAPTER,
        capabilities: ctx.pos.capabilities(),
        locationRef: store.posLocationRef,
        stock: { lastSyncedAt: freshness[0]?.lastSyncedAt ?? null, skusWithoutStockData: missing.slice(0, 200), skusWithoutStockCount: missing.length },
        ordersByPosSyncStatus: Object.fromEntries(syncByStatus.map((r) => [r.status, r.n])),
        deadJobsByType: Object.fromEntries(deadJobs.map((r) => [r.type, r.n])),
      };
    });

    defineRoute(app, { method: 'POST', url: '/stores/:storeId/pos/stock-sync', summary: 'Queue a stock refresh from the POS', tag: 'Admin: POS', auth: posAuth, status: 202, params: storeParams }, async (request, { params }) => {
      await requireStore(ctx.db, params.storeId);
      if (!ctx.pos.capabilities().getStock) throw new AppError(409, 'conflict', 'The POS adapter cannot read stock.');
      // One queued sync per minute at most.
      const bucket = Math.floor(ctx.now().getTime() / 60_000);
      await enqueueJob(ctx.db, { type: 'pos.sync_stock', storeId: params.storeId, idempotencyKey: `pos.sync_stock:${params.storeId}:${bucket}` });
      await recordAudit(ctx.db, { storeId: params.storeId, actor: actorOf(request), action: 'pos.stock_sync_requested', entityType: 'store', entityId: params.storeId });
      return { queued: true };
    });

    defineRoute(app, { method: 'POST', url: '/stores/:storeId/payments/reconcile', summary: 'Queue reconciliation of stale pending payments', tag: 'Admin: payments', auth: { admin: 'refunds.manage' }, status: 202, params: storeParams }, async (_r, { params }) => {
      const [store] = await ctx.db.select({ id: stores.id }).from(stores).where(eq(stores.id, params.storeId));
      if (!store) throw notFound('Store');
      const bucket = Math.floor(ctx.now().getTime() / 60_000);
      await enqueueJob(ctx.db, { type: 'payments.reconcile', storeId: store.id, idempotencyKey: `payments.reconcile:${store.id}:${bucket}` });
      return { queued: true };
    });
  };
}
