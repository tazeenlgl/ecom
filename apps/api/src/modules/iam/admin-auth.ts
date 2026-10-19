import { and, eq, gt, isNull } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { adminRoleAssignments, adminSessions, adminUsers } from '../../db/schema.js';
import { recordAudit } from '../../lib/audit.js';
import { DUMMY_PASSWORD_HASH, newToken, sha256, verifyPassword } from '../../lib/crypto.js';
import { AppError } from '../../lib/errors.js';
import { RateLimiter } from '../../lib/rate-limit.js';
import { defineRoute } from '../../lib/route.js';
import { hasPermission, type Permission, type RoleGrant } from './permissions.js';

export type AuthenticatedAdmin = { id: string; email: string; name: string; sessionId: string; grants: RoleGrant[] };

declare module 'fastify' {
  interface FastifyRequest {
    admin: AuthenticatedAdmin | null;
  }
}

export function bearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (typeof header !== 'string') return null;
  const match = /^Bearer ([A-Za-z0-9_-]{20,200})$/.exec(header);
  return match?.[1] ?? null;
}

export async function loadGrants(ctx: AppContext, adminUserId: string): Promise<RoleGrant[]> {
  return ctx.db
    .select({ role: adminRoleAssignments.role, storeId: adminRoleAssignments.storeId })
    .from(adminRoleAssignments)
    .where(eq(adminRoleAssignments.adminUserId, adminUserId));
}

/** Authenticates the admin bearer token, then checks `permission` for `storeId`. */
export function adminAuthenticator(ctx: AppContext) {
  return async (request: FastifyRequest, permission: Permission | null, storeId: string | null) => {
    const token = bearerToken(request);
    if (!token) throw new AppError(401, 'unauthenticated', 'Sign in required.');
    const [row] = await ctx.db
      .select({ sessionId: adminSessions.id, id: adminUsers.id, email: adminUsers.email, name: adminUsers.name })
      .from(adminSessions)
      .innerJoin(adminUsers, eq(adminUsers.id, adminSessions.adminUserId))
      .where(
        and(
          eq(adminSessions.tokenHash, sha256(token)),
          isNull(adminSessions.revokedAt),
          gt(adminSessions.expiresAt, ctx.now()),
          eq(adminUsers.status, 'active'),
        ),
      )
      .limit(1);
    if (!row) throw new AppError(401, 'unauthenticated', 'Sign in required.');

    const grants = await loadGrants(ctx, row.id);
    request.admin = { ...row, grants };
    if (permission && !hasPermission(grants, permission, storeId)) {
      throw new AppError(403, 'forbidden', 'You do not have permission to do this.');
    }
  };
}

export function adminAuthRoutes(ctx: AppContext) {
  const loginLimiter = new RateLimiter(10, 15 * 60_000);
  const emailLimiter = new RateLimiter(5, 15 * 60_000);

  return async (app: FastifyInstance) => {
    defineRoute(
      app,
      {
        method: 'POST',
        url: '/auth/login',
        summary: 'Sign in as an administrator',
        tag: 'Admin: auth',
        auth: 'public',
        rateLimit: loginLimiter,
        body: z.object({ email: z.email().max(254), password: z.string().min(1).max(200) }),
      },
      async (request, { body }) => {
        const email = body.email.toLowerCase();
        emailLimiter.consume(email);
        const [admin] = await ctx.db.select().from(adminUsers).where(eq(adminUsers.email, email)).limit(1);
        // Always run one scrypt so response time does not reveal whether the email exists.
        const ok = await verifyPassword(body.password, admin?.passwordHash ?? DUMMY_PASSWORD_HASH);
        if (!admin || !ok || admin.status !== 'active') {
          throw new AppError(401, 'unauthenticated', 'Email or password is incorrect.');
        }
        emailLimiter.reset(email);
        const token = newToken();
        const expiresAt = new Date(ctx.now().getTime() + ctx.config.ADMIN_SESSION_TTL_HOURS * 3_600_000);
        await ctx.db.transaction(async (tx) => {
          await tx.insert(adminSessions).values({ adminUserId: admin.id, tokenHash: sha256(token), expiresAt });
          await tx.update(adminUsers).set({ lastLoginAt: ctx.now() }).where(eq(adminUsers.id, admin.id));
          await recordAudit(tx, {
            storeId: null,
            actor: { type: 'admin', id: admin.id },
            action: 'admin.login',
            entityType: 'admin_user',
            entityId: admin.id,
            changes: { ip: request.ip },
          });
        });
        return { token, expiresAt, admin: { id: admin.id, email: admin.email, name: admin.name } };
      },
    );

    defineRoute(
      app,
      { method: 'POST', url: '/auth/logout', summary: 'Revoke the current admin session', tag: 'Admin: auth', auth: { admin: null }, status: 204 },
      async (request) => {
        await ctx.db.update(adminSessions).set({ revokedAt: ctx.now() }).where(eq(adminSessions.id, request.admin!.sessionId));
      },
    );

    defineRoute(
      app,
      { method: 'GET', url: '/me', summary: 'Current admin and role grants', tag: 'Admin: auth', auth: { admin: null } },
      async (request) => {
        const { id, email, name, grants } = request.admin!;
        return { admin: { id, email, name }, grants };
      },
    );
  };
}
