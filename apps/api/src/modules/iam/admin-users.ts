import { and, desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { adminRoleAssignments, adminSessions, adminUsers, stores } from '../../db/schema.js';
import { actorOf, recordAudit } from '../../lib/audit.js';
import { hashPassword } from '../../lib/crypto.js';
import { notFound } from '../../lib/errors.js';
import { defineRoute } from '../../lib/route.js';
import { ROLE_KEYS, ROLES } from './permissions.js';

const password = z.string().min(12, 'at least 12 characters').max(200);
const publicAdmin = {
  id: adminUsers.id,
  email: adminUsers.email,
  name: adminUsers.name,
  status: adminUsers.status,
  lastLoginAt: adminUsers.lastLoginAt,
  createdAt: adminUsers.createdAt,
};

export function adminUserRoutes(ctx: AppContext) {
  return async (app: FastifyInstance) => {
    const manage = { admin: 'platform.admins.manage' } as const;
    const tag = 'Admin: users and roles';

    defineRoute(app, { method: 'GET', url: '/roles', summary: 'List roles and their permissions', tag, auth: { admin: null } }, async () => ({
      items: ROLE_KEYS.map((key) => ({ key, label: ROLES[key].label, permissions: ROLES[key].permissions })),
    }));

    defineRoute(app, { method: 'GET', url: '/admin-users', summary: 'List administrators', tag, auth: manage }, async () => ({
      items: await ctx.db.select(publicAdmin).from(adminUsers).orderBy(desc(adminUsers.createdAt)),
    }));

    defineRoute(
      app,
      {
        method: 'POST',
        url: '/admin-users',
        summary: 'Create an administrator',
        tag,
        auth: manage,
        status: 201,
        body: z.object({ email: z.email().max(254), name: z.string().min(1).max(120), password }),
      },
      async (request, { body }) => {
        const passwordHash = await hashPassword(body.password);
        return ctx.db.transaction(async (tx) => {
          const [admin] = await tx
            .insert(adminUsers)
            .values({ email: body.email.toLowerCase(), name: body.name, passwordHash })
            .returning(publicAdmin);
          await recordAudit(tx, {
            storeId: null,
            actor: actorOf(request),
            action: 'admin_user.create',
            entityType: 'admin_user',
            entityId: admin!.id,
            changes: { email: admin!.email },
          });
          return { adminUser: admin };
        });
      },
    );

    defineRoute(
      app,
      {
        method: 'PATCH',
        url: '/admin-users/:id',
        summary: 'Enable or disable an administrator',
        tag,
        auth: manage,
        params: z.object({ id: z.uuid() }),
        body: z.object({ status: z.enum(['active', 'disabled']) }),
      },
      async (request, { params, body }) =>
        ctx.db.transaction(async (tx) => {
          const [admin] = await tx.update(adminUsers).set({ status: body.status }).where(eq(adminUsers.id, params.id)).returning(publicAdmin);
          if (!admin) throw notFound('Admin user');
          if (body.status === 'disabled') {
            await tx.update(adminSessions).set({ revokedAt: ctx.now() }).where(eq(adminSessions.adminUserId, admin.id));
          }
          await recordAudit(tx, {
            storeId: null,
            actor: actorOf(request),
            action: 'admin_user.status',
            entityType: 'admin_user',
            entityId: admin.id,
            changes: { status: body.status },
          });
          return { adminUser: admin };
        }),
    );

    defineRoute(
      app,
      {
        method: 'POST',
        url: '/admin-users/:id/roles',
        summary: 'Grant a role, platform-wide (storeId null) or for one store',
        tag,
        auth: manage,
        status: 201,
        params: z.object({ id: z.uuid() }),
        body: z.object({ role: z.enum(ROLE_KEYS as [string, ...string[]]), storeId: z.uuid().nullable() }),
      },
      async (request, { params, body }) =>
        ctx.db.transaction(async (tx) => {
          const [admin] = await tx.select({ id: adminUsers.id }).from(adminUsers).where(eq(adminUsers.id, params.id));
          if (!admin) throw notFound('Admin user');
          if (body.storeId) {
            const [store] = await tx.select({ id: stores.id }).from(stores).where(eq(stores.id, body.storeId));
            if (!store) throw notFound('Store');
          }
          const [grant] = await tx
            .insert(adminRoleAssignments)
            .values({ adminUserId: admin.id, role: body.role, storeId: body.storeId })
            .returning();
          await recordAudit(tx, {
            storeId: body.storeId,
            actor: actorOf(request),
            action: 'admin_role.grant',
            entityType: 'admin_user',
            entityId: admin.id,
            changes: { role: body.role, storeId: body.storeId },
          });
          return { grant };
        }),
    );

    defineRoute(
      app,
      {
        method: 'DELETE',
        url: '/admin-users/:id/roles/:grantId',
        summary: 'Revoke a role grant',
        tag,
        auth: manage,
        status: 204,
        params: z.object({ id: z.uuid(), grantId: z.uuid() }),
      },
      async (request, { params }) =>
        ctx.db.transaction(async (tx) => {
          const [grant] = await tx
            .delete(adminRoleAssignments)
            .where(and(eq(adminRoleAssignments.id, params.grantId), eq(adminRoleAssignments.adminUserId, params.id)))
            .returning();
          if (!grant) throw notFound('Role grant');
          await recordAudit(tx, {
            storeId: grant.storeId,
            actor: actorOf(request),
            action: 'admin_role.revoke',
            entityType: 'admin_user',
            entityId: params.id,
            changes: { role: grant.role, storeId: grant.storeId },
          });
        }),
    );
  };
}
