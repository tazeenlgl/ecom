import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Permission } from '../modules/iam/permissions.js';
import { AppError } from './errors.js';
import type { RateLimiter } from './rate-limit.js';

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * Who may call a route.
 * - public:   anyone (storefront routes still require a resolved store)
 * - customer: a signed-in customer of the store resolved from the host
 * - admin:    a signed-in admin holding `permission` (for `:storeId` in the path, if present)
 */
export type RouteAuth = 'public' | 'customer' | { admin: Permission | null };

export type RouteDef<P extends z.ZodType, Q extends z.ZodType, B extends z.ZodType> = {
  method: Method;
  url: string;
  summary: string;
  tag: string;
  auth: RouteAuth;
  params?: P;
  query?: Q;
  body?: B;
  /** Success status code; defaults to 200. */
  status?: number;
  /** Requires an `Idempotency-Key` header. */
  idempotencyKey?: boolean;
  /** Per-IP limiter applied before the handler. */
  rateLimit?: RateLimiter;
};

/** Route metadata collected for the OpenAPI document. */
export type RouteDoc = {
  method: Method;
  url: string;
  summary: string;
  tag: string;
  auth: RouteAuth;
  params?: z.ZodType;
  query?: z.ZodType;
  body?: z.ZodType;
  status: number;
  idempotencyKey: boolean;
  rateLimited: boolean;
};

declare module 'fastify' {
  interface FastifyContextConfig {
    doc?: RouteDoc;
  }
  interface FastifyInstance {
    authenticators: {
      customer(request: FastifyRequest): Promise<void>;
      admin(request: FastifyRequest, permission: Permission | null, storeId: string | null): Promise<void>;
    };
  }
}

type Input<P extends z.ZodType, Q extends z.ZodType, B extends z.ZodType> = {
  params: z.output<P>;
  query: z.output<Q>;
  body: z.output<B>;
  idempotencyKey: string;
};

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_\-:.]{8,128}$/;
const empty = z.object({});

/**
 * Registers a route whose params, query and body are validated with Zod, whose
 * authentication/permission rule is enforced before the handler runs, and whose
 * definition feeds the OpenAPI document (`GET /v1/openapi.json`).
 */
export function defineRoute<
  P extends z.ZodType = typeof empty,
  Q extends z.ZodType = typeof empty,
  B extends z.ZodType = typeof empty,
>(
  app: FastifyInstance,
  def: RouteDef<P, Q, B>,
  handler: (request: FastifyRequest, input: Input<P, Q, B>, reply: FastifyReply) => Promise<unknown>,
): void {
  const doc: RouteDoc = {
    method: def.method,
    url: def.url,
    summary: def.summary,
    tag: def.tag,
    auth: def.auth,
    params: def.params,
    query: def.query,
    body: def.body,
    status: def.status ?? 200,
    idempotencyKey: def.idempotencyKey ?? false,
    rateLimited: Boolean(def.rateLimit),
  };

  app.route({
    method: def.method,
    url: def.url,
    config: { doc },
    handler: async (request, reply) => {
      def.rateLimit?.consume(`${def.url}:${request.ip}`);

      // Authenticate before validating input so anonymous callers learn nothing about it.
      if (def.auth === 'customer') {
        await app.authenticators.customer(request);
      } else if (typeof def.auth === 'object') {
        const rawStoreId = (request.params as { storeId?: unknown } | undefined)?.storeId;
        const storeId = z.uuid().safeParse(rawStoreId).success ? (rawStoreId as string) : null;
        await app.authenticators.admin(request, def.auth.admin, storeId);
      }

      const params = (def.params ?? empty).parse(request.params ?? {});

      const query = (def.query ?? empty).parse(request.query ?? {});
      const body = (def.body ?? empty).parse(request.body ?? {});

      let idempotencyKey = '';
      if (def.idempotencyKey) {
        const header = request.headers['idempotency-key'];
        if (typeof header !== 'string' || !IDEMPOTENCY_KEY.test(header)) {
          throw new AppError(400, 'invalid_request', 'A valid Idempotency-Key header (8-128 characters) is required.');
        }
        idempotencyKey = header;
      }

      // Handlers may override the status (e.g. 200 for an idempotent replay).
      reply.status(doc.status);
      const result = await handler(request, { params, query, body, idempotencyKey } as Input<P, Q, B>, reply);
      if (reply.sent) return reply;
      return result ?? (reply.statusCode === 204 ? undefined : { ok: true });
    },
  });
}

/** Collects the documentation of every route registered after this call. */
export function collectRouteDocs(app: FastifyInstance): RouteDoc[] {
  const docs: RouteDoc[] = [];
  app.addHook('onRoute', (route) => {
    const doc = route.config?.doc;
    // Fastify adds a HEAD route for every GET; document the GET only.
    if (doc && route.method !== 'HEAD') docs.push({ ...doc, url: route.url });
  });
  return docs;
}

// Reusable schema pieces ----------------------------------------------------

export const uuidParam = z.uuid();
export const slug = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'lower-case letters, digits and single hyphens');
export const paise = z.number().int().min(0).max(2_000_000_000);
export const seoSchema = z
  .object({
    title: z.string().max(200).optional(),
    description: z.string().max(500).optional(),
    canonicalUrl: z.url().max(500).optional(),
    noIndex: z.boolean().optional(),
  })
  .strict();
export const storeParams = z.object({ storeId: z.uuid() });
export const storeEntityParams = z.object({ storeId: z.uuid(), id: z.uuid() });
