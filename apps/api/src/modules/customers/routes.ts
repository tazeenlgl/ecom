import { and, desc, eq, gt, ilike, isNull, ne } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import type { Tx } from '../../db/client.js';
import { customerAddresses, customerSessions, customers } from '../../db/schema.js';
import { DUMMY_PASSWORD_HASH, hashPassword, newToken, sha256, verifyPassword } from '../../lib/crypto.js';
import { AppError, notFound } from '../../lib/errors.js';
import { INDIAN_STATES, normalizeIndianMobile } from '../../lib/india.js';
import { cursorCondition, pageQuery, toPage } from '../../lib/pagination.js';
import { RateLimiter } from '../../lib/rate-limit.js';
import { defineRoute, storeEntityParams, storeParams } from '../../lib/route.js';
import { CART_TOKEN_HEADER, mergeGuestCart } from '../cart/service.js';
import { bearerToken } from '../iam/admin-auth.js';
import { requireStore } from '../platform/routes.js';
import { consumeOtp, issueOtp } from './otp.js';

export type AuthenticatedCustomer = { id: string; phone: string; sessionId: string };

declare module 'fastify' {
  interface FastifyRequest {
    customer: AuthenticatedCustomer | null;
  }
}

const phone = z.string().transform((v, c) => {
  const normalized = normalizeIndianMobile(v);
  if (!normalized) {
    c.addIssue({ code: 'custom', message: 'Enter a valid 10-digit Indian mobile number.' });
    return z.NEVER;
  }
  return normalized;
});
const password = z.string().min(8, 'at least 8 characters').max(200);
const otpCode = z.string().regex(/^\d{6}$/);

const publicCustomer = {
  id: customers.id,
  phone: customers.phone,
  name: customers.name,
  email: customers.email,
  hasPassword: customers.passwordHash,
  createdAt: customers.createdAt,
};
type CustomerRow = { id: string; phone: string; name: string | null; email: string | null; hasPassword: string | null; createdAt: Date };
const present = (c: CustomerRow) => ({ ...c, hasPassword: c.hasPassword !== null });

/** Resolves the customer from the bearer token. The session must belong to the store resolved from the host. */
export function customerAuthenticator(ctx: AppContext) {
  return async (request: FastifyRequest) => {
    const token = bearerToken(request);
    if (!token) throw new AppError(401, 'unauthenticated', 'Sign in required.');
    const [row] = await ctx.db
      .select({ sessionId: customerSessions.id, id: customers.id, phone: customers.phone })
      .from(customerSessions)
      .innerJoin(customers, and(eq(customers.id, customerSessions.customerId), eq(customers.storeId, customerSessions.storeId)))
      .where(
        and(
          eq(customerSessions.tokenHash, sha256(token)),
          eq(customerSessions.storeId, request.store.id),
          isNull(customerSessions.revokedAt),
          gt(customerSessions.expiresAt, ctx.now()),
          eq(customers.status, 'active'),
        ),
      )
      .limit(1);
    if (!row) throw new AppError(401, 'unauthenticated', 'Sign in required.');
    request.customer = row;
  };
}

/** Tries to authenticate without requiring it (for guest-or-customer routes such as the cart). */
export async function optionalCustomer(ctx: AppContext, request: FastifyRequest) {
  if (!bearerToken(request)) return;
  await customerAuthenticator(ctx)(request);
}

async function startSession(ctx: AppContext, tx: Tx, storeId: string, customerId: string) {
  const token = newToken();
  const expiresAt = new Date(ctx.now().getTime() + ctx.config.CUSTOMER_SESSION_TTL_DAYS * 86_400_000);
  await tx.insert(customerSessions).values({ storeId, customerId, tokenHash: sha256(token), expiresAt });
  return { token, expiresAt };
}

const addressBody = z.object({
  name: z.string().min(1).max(120),
  phone,
  line1: z.string().min(1).max(200),
  line2: z.string().max(200).nullable().optional(),
  landmark: z.string().max(200).nullable().optional(),
  city: z.string().min(1).max(100),
  state: z.enum(INDIAN_STATES),
  pincode: z.string().regex(/^[1-9]\d{5}$/, 'Enter a valid 6-digit PIN code.'),
  isDefault: z.boolean().optional(),
});

export function customerStorefrontRoutes(ctx: AppContext) {
  const loginLimiter = new RateLimiter(10, 15 * 60_000);
  const phoneLimiter = new RateLimiter(5, 15 * 60_000);
  const verifyLimiter = new RateLimiter(30, 15 * 60_000);

  return async (app: FastifyInstance) => {
    const tag = 'Storefront: account';

    defineRoute(
      app,
      {
        method: 'POST',
        url: '/auth/otp/request',
        summary: 'Send a one-time code to an Indian mobile number',
        tag,
        auth: 'public',
        body: z.object({ phone, purpose: z.enum(['login', 'reset_password']).default('login') }),
      },
      async (request, { body }) => {
        const storeId = request.store.id;
        const [existing] = await ctx.db
          .select({ status: customers.status, passwordHash: customers.passwordHash })
          .from(customers)
          .where(and(eq(customers.storeId, storeId), eq(customers.phone, body.phone)));
        // Reset codes go only to existing accounts with a password; the response is identical either way.
        const deliver =
          existing?.status !== 'blocked' && (body.purpose === 'login' || Boolean(existing?.passwordHash));
        const challenge = await issueOtp(ctx, { storeId, phone: body.phone, purpose: body.purpose, ip: request.ip, deliver });
        return challenge;
      },
    );

    defineRoute(
      app,
      {
        method: 'POST',
        url: '/auth/otp/verify',
        summary: 'Verify a login code; signs in, registering the customer on first login',
        tag,
        auth: 'public',
        rateLimit: verifyLimiter,
        body: z.object({ challengeId: z.uuid(), phone, code: otpCode }),
      },
      async (request, { body }) => {
        const storeId = request.store.id;
        await consumeOtp(ctx, { storeId, challengeId: body.challengeId, phone: body.phone, purpose: 'login', code: body.code });
        return ctx.db.transaction(async (tx) => {
          const [customer] = await tx
            .insert(customers)
            .values({ storeId, phone: body.phone, phoneVerifiedAt: ctx.now() })
            .onConflictDoUpdate({ target: [customers.storeId, customers.phone], set: { phoneVerifiedAt: ctx.now() } })
            .returning();
          if (customer!.status !== 'active') throw new AppError(403, 'forbidden', 'This account cannot sign in.');
          const session = await startSession(ctx, tx, storeId, customer!.id);
          const guestToken = request.headers[CART_TOKEN_HEADER];
          await mergeGuestCart(tx, storeId, customer!.id, typeof guestToken === 'string' ? guestToken : undefined);
          return { ...session, customer: present({ ...customer!, hasPassword: customer!.passwordHash }) };
        });
      },
    );

    defineRoute(
      app,
      {
        method: 'POST',
        url: '/auth/password/login',
        summary: 'Sign in with mobile number and password',
        tag,
        auth: 'public',
        rateLimit: loginLimiter,
        body: z.object({ phone, password: z.string().min(1).max(200) }),
      },
      async (request, { body }) => {
        const storeId = request.store.id;
        phoneLimiter.consume(`${storeId}:${body.phone}`);
        const [customer] = await ctx.db
          .select()
          .from(customers)
          .where(and(eq(customers.storeId, storeId), eq(customers.phone, body.phone)));
        const ok = await verifyPassword(body.password, customer?.passwordHash ?? DUMMY_PASSWORD_HASH);
        if (!customer || !customer.passwordHash || !ok || customer.status !== 'active') {
          throw new AppError(401, 'unauthenticated', 'Mobile number or password is incorrect.');
        }
        phoneLimiter.reset(`${storeId}:${body.phone}`);
        return ctx.db.transaction(async (tx) => {
          const session = await startSession(ctx, tx, storeId, customer.id);
          const guestToken = request.headers[CART_TOKEN_HEADER];
          await mergeGuestCart(tx, storeId, customer.id, typeof guestToken === 'string' ? guestToken : undefined);
          return { ...session, customer: present({ ...customer, hasPassword: customer.passwordHash }) };
        });
      },
    );

    defineRoute(
      app,
      {
        method: 'POST',
        url: '/auth/password/reset',
        summary: 'Set a new password using a reset code; signs out every session',
        tag,
        auth: 'public',
        rateLimit: verifyLimiter,
        status: 204,
        body: z.object({ challengeId: z.uuid(), phone, code: otpCode, newPassword: password }),
      },
      async (request, { body }) => {
        const storeId = request.store.id;
        await consumeOtp(ctx, { storeId, challengeId: body.challengeId, phone: body.phone, purpose: 'reset_password', code: body.code });
        const passwordHash = await hashPassword(body.newPassword);
        await ctx.db.transaction(async (tx) => {
          const [customer] = await tx
            .update(customers)
            .set({ passwordHash })
            .where(and(eq(customers.storeId, storeId), eq(customers.phone, body.phone)))
            .returning({ id: customers.id });
          if (!customer) throw new AppError(400, 'otp_invalid', 'The code is incorrect.');
          await tx.update(customerSessions).set({ revokedAt: ctx.now() }).where(eq(customerSessions.customerId, customer.id));
        });
      },
    );

    defineRoute(
      app,
      { method: 'POST', url: '/auth/logout', summary: 'Sign out the current session', tag, auth: 'customer', status: 204 },
      async (request) => {
        await ctx.db.update(customerSessions).set({ revokedAt: ctx.now() }).where(eq(customerSessions.id, request.customer!.sessionId));
      },
    );

    defineRoute(app, { method: 'GET', url: '/me', summary: 'Current customer', tag, auth: 'customer' }, async (request) => {
      const [customer] = await ctx.db.select(publicCustomer).from(customers).where(eq(customers.id, request.customer!.id));
      return { customer: present(customer!) };
    });

    defineRoute(
      app,
      {
        method: 'PATCH',
        url: '/me',
        summary: 'Update name or email',
        tag,
        auth: 'customer',
        body: z.object({ name: z.string().min(1).max(120).optional(), email: z.email().max(254).nullable().optional() }),
      },
      async (request, { body }) => {
        const [customer] = await ctx.db
          .update(customers)
          .set(body)
          .where(and(eq(customers.id, request.customer!.id), eq(customers.storeId, request.store.id)))
          .returning(publicCustomer);
        return { customer: present(customer!) };
      },
    );

    defineRoute(
      app,
      {
        method: 'PUT',
        url: '/me/password',
        summary: 'Set or change password (current password required if one is set); signs out other sessions',
        tag,
        auth: 'customer',
        rateLimit: loginLimiter,
        status: 204,
        body: z.object({ currentPassword: z.string().max(200).optional(), newPassword: password }),
      },
      async (request, { body }) => {
        const me = request.customer!;
        const [customer] = await ctx.db.select().from(customers).where(eq(customers.id, me.id));
        if (customer!.passwordHash && !(await verifyPassword(body.currentPassword ?? '', customer!.passwordHash))) {
          throw new AppError(401, 'unauthenticated', 'Current password is incorrect.');
        }
        const passwordHash = await hashPassword(body.newPassword);
        await ctx.db.transaction(async (tx) => {
          await tx.update(customers).set({ passwordHash }).where(eq(customers.id, me.id));
          await tx
            .update(customerSessions)
            .set({ revokedAt: ctx.now() })
            // Keep the session that made the change.
            .where(and(eq(customerSessions.customerId, me.id), isNull(customerSessions.revokedAt), ne(customerSessions.id, me.sessionId)));
        });
      },
    );

    // Address book --------------------------------------------------------

    const addressScope = (request: FastifyRequest, id?: string) =>
      and(
        eq(customerAddresses.storeId, request.store.id),
        eq(customerAddresses.customerId, request.customer!.id),
        id ? eq(customerAddresses.id, id) : undefined,
      );

    defineRoute(app, { method: 'GET', url: '/me/addresses', summary: 'List saved addresses', tag, auth: 'customer' }, async (request) => ({
      items: await ctx.db.select().from(customerAddresses).where(addressScope(request)).orderBy(desc(customerAddresses.isDefault), desc(customerAddresses.createdAt)),
    }));

    defineRoute(
      app,
      { method: 'POST', url: '/me/addresses', summary: 'Add an address', tag, auth: 'customer', status: 201, body: addressBody },
      async (request, { body }) =>
        ctx.db.transaction(async (tx) => {
          if (body.isDefault) await tx.update(customerAddresses).set({ isDefault: false }).where(addressScope(request));
          const [address] = await tx
            .insert(customerAddresses)
            .values({ ...body, storeId: request.store.id, customerId: request.customer!.id })
            .returning();
          return { address };
        }),
    );

    defineRoute(
      app,
      {
        method: 'PATCH',
        url: '/me/addresses/:id',
        summary: 'Update an address',
        tag,
        auth: 'customer',
        params: z.object({ id: z.uuid() }),
        body: addressBody.partial(),
      },
      async (request, { params, body }) =>
        ctx.db.transaction(async (tx) => {
          if (body.isDefault) await tx.update(customerAddresses).set({ isDefault: false }).where(addressScope(request));
          const [address] = await tx.update(customerAddresses).set(body).where(addressScope(request, params.id)).returning();
          if (!address) throw notFound('Address');
          return { address };
        }),
    );

    defineRoute(
      app,
      { method: 'DELETE', url: '/me/addresses/:id', summary: 'Delete an address', tag, auth: 'customer', status: 204, params: z.object({ id: z.uuid() }) },
      async (request, { params }) => {
        const deleted = await ctx.db.delete(customerAddresses).where(addressScope(request, params.id)).returning({ id: customerAddresses.id });
        if (deleted.length === 0) throw notFound('Address');
      },
    );
  };
}

export function customerAdminRoutes(ctx: AppContext) {
  return async (app: FastifyInstance) => {
    const tag = 'Admin: customers';
    defineRoute(
      app,
      {
        method: 'GET',
        url: '/stores/:storeId/customers',
        summary: 'List customers (search by phone digits)',
        tag,
        auth: { admin: 'customers.read' },
        params: storeParams,
        query: pageQuery.extend({ phone: z.string().regex(/^\+?\d{3,13}$/).optional() }),
      },
      async (_request, { params, query }) => {
        await requireStore(ctx.db, params.storeId);
        const rows = await ctx.db
          .select({ ...publicCustomer, status: customers.status })
          .from(customers)
          .where(
            and(
              eq(customers.storeId, params.storeId),
              query.phone ? ilike(customers.phone, `%${query.phone.replace(/\D/g, '')}%`) : undefined,
              cursorCondition(query.cursor, customers.createdAt, customers.id),
            ),
          )
          .orderBy(desc(customers.createdAt), desc(customers.id))
          .limit(query.limit + 1);
        const page = toPage(rows, query.limit);
        return { ...page, items: page.items.map(present) };
      },
    );

    defineRoute(
      app,
      { method: 'GET', url: '/stores/:storeId/customers/:id', summary: 'Get a customer with addresses', tag, auth: { admin: 'customers.read' }, params: storeEntityParams },
      async (_request, { params }) => {
        const [customer] = await ctx.db
          .select({ ...publicCustomer, status: customers.status })
          .from(customers)
          .where(and(eq(customers.storeId, params.storeId), eq(customers.id, params.id)));
        if (!customer) throw notFound('Customer');
        const addresses = await ctx.db
          .select()
          .from(customerAddresses)
          .where(and(eq(customerAddresses.storeId, params.storeId), eq(customerAddresses.customerId, params.id)));
        return { customer: present(customer), addresses };
      },
    );
  };
}
