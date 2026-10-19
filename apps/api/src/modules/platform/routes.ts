import { and, desc, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import type { DbOrTx } from '../../db/client.js';
import { auditLogs, brands, storeDomains, stores } from '../../db/schema.js';
import { actorOf, recordAudit } from '../../lib/audit.js';
import { newToken } from '../../lib/crypto.js';
import { AppError, notFound } from '../../lib/errors.js';
import { cursorCondition, pageQuery, toPage } from '../../lib/pagination.js';
import { defineRoute, slug, storeEntityParams, storeParams } from '../../lib/route.js';
import { hasPermission } from '../iam/permissions.js';
import { normalizeHost } from '../tenancy/host.js';
import { verificationRecordName } from './domain-verifier.js';
import { publicSettingsSchema, storeConfigSchema } from './settings.js';

/** Loads a store by id or throws 404. Admin routes call this after the permission check. */
export async function requireStore(db: DbOrTx, storeId: string) {
  const [store] = await db.select().from(stores).where(eq(stores.id, storeId)).limit(1);
  if (!store) throw notFound('Store');
  return store;
}

export function platformRoutes(ctx: AppContext) {
  return async (app: FastifyInstance) => {
    // Brands --------------------------------------------------------------
    const brandTag = 'Admin: brands and stores';

    defineRoute(
      app,
      { method: 'GET', url: '/brands', summary: 'List brands', tag: brandTag, auth: { admin: 'platform.brands.manage' } },
      async () => ({ items: await ctx.db.select().from(brands).orderBy(brands.name) }),
    );

    defineRoute(
      app,
      {
        method: 'POST',
        url: '/brands',
        summary: 'Create a brand',
        tag: brandTag,
        auth: { admin: 'platform.brands.manage' },
        status: 201,
        body: z.object({ slug, name: z.string().min(1).max(120) }),
      },
      async (request, { body }) =>
        ctx.db.transaction(async (tx) => {
          const [brand] = await tx.insert(brands).values(body).returning();
          await recordAudit(tx, { storeId: null, actor: actorOf(request), action: 'brand.create', entityType: 'brand', entityId: brand!.id, changes: body });
          return { brand };
        }),
    );

    defineRoute(
      app,
      {
        method: 'PATCH',
        url: '/brands/:id',
        summary: 'Rename or archive a brand',
        tag: brandTag,
        auth: { admin: 'platform.brands.manage' },
        params: z.object({ id: z.uuid() }),
        body: z.object({ name: z.string().min(1).max(120).optional(), status: z.enum(['active', 'archived']).optional() }),
      },
      async (request, { params, body }) =>
        ctx.db.transaction(async (tx) => {
          const [brand] = await tx.update(brands).set(body).where(eq(brands.id, params.id)).returning();
          if (!brand) throw notFound('Brand');
          await recordAudit(tx, { storeId: null, actor: actorOf(request), action: 'brand.update', entityType: 'brand', entityId: brand.id, changes: body });
          return { brand };
        }),
    );

    // Stores --------------------------------------------------------------

    defineRoute(
      app,
      { method: 'GET', url: '/stores', summary: 'List the stores this admin can access', tag: brandTag, auth: { admin: null } },
      async (request) => {
        const grants = request.admin!.grants;
        const platformWide = grants.some((g) => g.storeId === null);
        const ids = grants.flatMap((g) => (g.storeId ? [g.storeId] : []));
        if (!platformWide && ids.length === 0) return { items: [] };
        const rows = await ctx.db
          .select()
          .from(stores)
          .where(platformWide ? undefined : inArray(stores.id, ids))
          .orderBy(stores.name);
        return { items: rows };
      },
    );

    defineRoute(
      app,
      {
        method: 'POST',
        url: '/stores',
        summary: 'Create a store for a brand',
        tag: brandTag,
        auth: { admin: 'platform.stores.manage' },
        status: 201,
        body: z.object({
          brandId: z.uuid(),
          slug,
          name: z.string().min(1).max(120),
          locale: z.string().max(20).optional(),
          timezone: z.string().max(60).optional(),
          publicSettings: publicSettingsSchema.optional(),
          config: storeConfigSchema.optional(),
        }),
      },
      async (request, { body }) =>
        ctx.db.transaction(async (tx) => {
          const [brand] = await tx.select().from(brands).where(eq(brands.id, body.brandId));
          if (!brand) throw notFound('Brand');
          // New stores start in maintenance until a domain is verified and the catalogue is ready.
          const [store] = await tx.insert(stores).values({ ...body, status: 'maintenance', currency: 'INR' }).returning();
          await recordAudit(tx, { storeId: store!.id, actor: actorOf(request), action: 'store.create', entityType: 'store', entityId: store!.id, changes: body });
          return { store };
        }),
    );

    defineRoute(
      app,
      { method: 'GET', url: '/stores/:storeId', summary: 'Get a store', tag: brandTag, auth: { admin: 'store.read' }, params: storeParams },
      async (_request, { params }) => ({ store: await requireStore(ctx.db, params.storeId) }),
    );

    defineRoute(
      app,
      {
        method: 'PATCH',
        url: '/stores/:storeId',
        summary: 'Update store settings. Changing status needs platform.stores.manage',
        tag: brandTag,
        auth: { admin: 'store.settings.manage' },
        params: storeParams,
        body: z.object({
          name: z.string().min(1).max(120).optional(),
          status: z.enum(['active', 'maintenance', 'disabled']).optional(),
          locale: z.string().max(20).optional(),
          timezone: z.string().max(60).optional(),
          publicSettings: publicSettingsSchema.optional(),
          config: storeConfigSchema.optional(),
          posLocationRef: z.string().max(100).nullable().optional(),
        }),
      },
      async (request, { params, body }) => {
        if (body.status && !hasPermission(request.admin!.grants, 'platform.stores.manage', params.storeId)) {
          throw new AppError(403, 'forbidden', 'Only platform administrators can change store status.');
        }
        return ctx.db.transaction(async (tx) => {
          await requireStore(tx, params.storeId);
          const [store] = await tx.update(stores).set(body).where(eq(stores.id, params.storeId)).returning();
          await recordAudit(tx, { storeId: params.storeId, actor: actorOf(request), action: 'store.update', entityType: 'store', entityId: params.storeId, changes: body });
          return { store };
        });
      },
    );

    // Domains -------------------------------------------------------------
    const domainTag = 'Admin: domains';
    const domainAuth = { admin: 'platform.domains.manage' } as const;

    defineRoute(
      app,
      { method: 'GET', url: '/stores/:storeId/domains', summary: 'List domains for a store', tag: domainTag, auth: { admin: 'store.read' }, params: storeParams },
      async (_request, { params }) => {
        await requireStore(ctx.db, params.storeId);
        const rows = await ctx.db.select().from(storeDomains).where(eq(storeDomains.storeId, params.storeId)).orderBy(storeDomains.hostname);
        return { items: rows.map((d) => ({ ...d, verificationRecord: verificationRecordName(d.hostname) })) };
      },
    );

    defineRoute(
      app,
      {
        method: 'POST',
        url: '/stores/:storeId/domains',
        summary: 'Add an unverified domain; returns the TXT record to create',
        tag: domainTag,
        auth: domainAuth,
        status: 201,
        params: storeParams,
        body: z.object({ hostname: z.string().min(1).max(253) }),
      },
      async (request, { params, body }) => {
        const hostname = normalizeHost(body.hostname);
        if (!hostname || hostname.split('.').length < 2) throw new AppError(400, 'invalid_request', 'Enter a valid domain name.');
        return ctx.db.transaction(async (tx) => {
          await requireStore(tx, params.storeId);
          const [domain] = await tx
            .insert(storeDomains)
            .values({ storeId: params.storeId, hostname, verificationToken: `ecom-verify=${newToken()}` })
            .returning();
          await recordAudit(tx, { storeId: params.storeId, actor: actorOf(request), action: 'domain.add', entityType: 'store_domain', entityId: domain!.id, changes: { hostname } });
          return { domain: { ...domain, verificationRecord: verificationRecordName(hostname) } };
        });
      },
    );

    defineRoute(
      app,
      {
        method: 'POST',
        url: '/stores/:storeId/domains/:id/verify',
        summary: 'Check the DNS TXT record and mark the domain verified',
        tag: domainTag,
        auth: domainAuth,
        params: storeEntityParams,
        body: z.object({ override: z.boolean().default(false) }),
      },
      async (request, { params, body }) => {
        const [domain] = await ctx.db
          .select()
          .from(storeDomains)
          .where(and(eq(storeDomains.id, params.id), eq(storeDomains.storeId, params.storeId)));
        if (!domain) throw notFound('Domain');
        if (domain.verifiedAt) return { domain };

        if (body.override) {
          // For local/staging hostnames that cannot carry DNS records.
          if (ctx.config.NODE_ENV === 'production') {
            throw new AppError(403, 'forbidden', 'Verification override is not available in production.');
          }
        } else {
          const records = await ctx.dns.txtRecords(verificationRecordName(domain.hostname));
          if (!domain.verificationToken || !records.includes(domain.verificationToken)) {
            throw new AppError(409, 'conflict', 'The verification TXT record was not found.', {
              record: verificationRecordName(domain.hostname),
              expected: domain.verificationToken,
            });
          }
        }
        return ctx.db.transaction(async (tx) => {
          const [updated] = await tx.update(storeDomains).set({ verifiedAt: ctx.now() }).where(eq(storeDomains.id, domain.id)).returning();
          await recordAudit(tx, {
            storeId: params.storeId,
            actor: actorOf(request),
            action: body.override ? 'domain.verify_override' : 'domain.verify',
            entityType: 'store_domain',
            entityId: domain.id,
            changes: { hostname: domain.hostname },
          });
          return { domain: updated };
        });
      },
    );

    defineRoute(
      app,
      {
        method: 'POST',
        url: '/stores/:storeId/domains/:id/primary',
        summary: 'Make a verified domain the primary one',
        tag: domainTag,
        auth: domainAuth,
        params: storeEntityParams,
      },
      async (request, { params }) =>
        ctx.db.transaction(async (tx) => {
          const [domain] = await tx
            .select()
            .from(storeDomains)
            .where(and(eq(storeDomains.id, params.id), eq(storeDomains.storeId, params.storeId)))
            .for('update');
          if (!domain) throw notFound('Domain');
          if (!domain.verifiedAt) throw new AppError(409, 'conflict', 'Only a verified domain can be primary.');
          await tx.update(storeDomains).set({ isPrimary: false }).where(eq(storeDomains.storeId, params.storeId));
          const [updated] = await tx.update(storeDomains).set({ isPrimary: true }).where(eq(storeDomains.id, domain.id)).returning();
          await recordAudit(tx, { storeId: params.storeId, actor: actorOf(request), action: 'domain.primary', entityType: 'store_domain', entityId: domain.id });
          return { domain: updated };
        }),
    );

    defineRoute(
      app,
      { method: 'DELETE', url: '/stores/:storeId/domains/:id', summary: 'Remove a domain', tag: domainTag, auth: domainAuth, status: 204, params: storeEntityParams },
      async (request, { params }) =>
        ctx.db.transaction(async (tx) => {
          const [domain] = await tx
            .delete(storeDomains)
            .where(and(eq(storeDomains.id, params.id), eq(storeDomains.storeId, params.storeId)))
            .returning();
          if (!domain) throw notFound('Domain');
          await recordAudit(tx, { storeId: params.storeId, actor: actorOf(request), action: 'domain.remove', entityType: 'store_domain', entityId: domain.id, changes: { hostname: domain.hostname } });
        }),
    );

    // Audit log -----------------------------------------------------------

    defineRoute(
      app,
      {
        method: 'GET',
        url: '/stores/:storeId/audit-logs',
        summary: 'Audit history for a store',
        tag: 'Admin: audit',
        auth: { admin: 'audit.read' },
        params: storeParams,
        query: pageQuery.extend({ entityType: z.string().max(60).optional(), entityId: z.string().max(100).optional() }),
      },
      async (_request, { params, query }) => {
        const rows = await ctx.db
          .select()
          .from(auditLogs)
          .where(
            and(
              eq(auditLogs.storeId, params.storeId),
              query.entityType ? eq(auditLogs.entityType, query.entityType) : undefined,
              query.entityId ? eq(auditLogs.entityId, query.entityId) : undefined,
              cursorCondition(query.cursor, auditLogs.createdAt, auditLogs.id),
            ),
          )
          .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
          .limit(query.limit + 1);
        return toPage(rows, query.limit);
      },
    );
  };
}

