import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyServerOptions } from 'fastify';
import type { Config } from './config/env.js';
import type { AppContext } from './context.js';
import type { Database } from './db/client.js';
import { registerErrorHandling } from './lib/errors.js';
import { buildOpenApi } from './lib/openapi.js';
import { collectRouteDocs, type RouteDoc } from './lib/route.js';
import { cartRoutes } from './modules/cart/routes.js';
import { catalogueAdminRoutes } from './modules/catalogue/admin-routes.js';
import { catalogueStorefrontRoutes } from './modules/catalogue/storefront-routes.js';
import { checkoutRoutes } from './modules/checkout/routes.js';
import { contentAdminRoutes, contentStorefrontRoutes } from './modules/content/routes.js';
import { customerAdminRoutes, customerAuthenticator, customerStorefrontRoutes } from './modules/customers/routes.js';
import { healthRoutes } from './modules/health/routes.js';
import { adminAuthenticator, adminAuthRoutes } from './modules/iam/admin-auth.js';
import { adminUserRoutes } from './modules/iam/admin-users.js';
import { jobAdminRoutes } from './modules/jobs/admin-routes.js';
import { LogMessageSender, DisabledMessageSender } from './modules/notifications/sender.js';
import { orderAdminRoutes } from './modules/orders/admin-routes.js';
import { orderStorefrontRoutes } from './modules/orders/storefront-routes.js';
import { FakePaymentProvider } from './modules/payments/fake-provider.js';
import type { PaymentProviders } from './modules/payments/provider.js';
import { paytmAdminRoutes } from './modules/payments/paytm/admin-routes.js';
import { paytmConfigFromDb } from './modules/payments/paytm/config.js';
import { PaytmPaymentProvider } from './modules/payments/paytm/provider.js';
import { paymentWebhookRoutes } from './modules/payments/webhook-routes.js';
import { DnsDomainVerifier } from './modules/platform/domain-verifier.js';
import { platformRoutes } from './modules/platform/routes.js';
import { UnconfiguredPosGateway } from './modules/pos/unconfigured-gateway.js';
import { promotionAdminRoutes } from './modules/promotions/admin-routes.js';
import { reportRoutes } from './modules/reports/routes.js';
import { shippingAdminRoutes, shippingStorefrontRoutes } from './modules/shipping/routes.js';
import { resolveStoreFromHost } from './modules/tenancy/resolve-store.js';
import { storeRoutes } from './modules/tenancy/routes.js';

export type AppDeps = {
  config: Config;
  db: Database;
  /** Overrides for outside-world adapters (tests inject fakes and a fixed clock). */
  overrides?: Partial<Omit<AppContext, 'config' | 'db'>>;
};

declare module 'fastify' {
  interface FastifyInstance {
    /** The adapters this app was built with (tests read fakes through it). */
    ctx: AppContext;
    routeDocs: RouteDoc[];
  }
}

const REQUEST_ID = /^[A-Za-z0-9._-]{8,64}$/;

/** Builds the adapters selected by configuration. Only non-live adapters exist. */
export function createContext({ config, db, overrides = {} }: AppDeps, log: { info: (...args: never[]) => void }): AppContext {
  const payments: PaymentProviders = new Map();
  if (config.PAYMENT_PROVIDER === 'fake' && config.FAKE_PAYMENT_WEBHOOK_SECRET) {
    payments.set('fake', new FakePaymentProvider(config.FAKE_PAYMENT_WEBHOOK_SECRET));
  }
  // Inert until a store saves and enables its own Paytm credentials (staging unless production is allowed).
  payments.set('paytm', new PaytmPaymentProvider({ db, configFor: paytmConfigFromDb(db, config), fetch: globalThis.fetch }));
  return {
    config,
    db,
    pos: new UnconfiguredPosGateway(),
    payments,
    messages: config.SMS_PROVIDER === 'log' ? new LogMessageSender(log as never) : new DisabledMessageSender(),
    dns: new DnsDomainVerifier(),
    now: () => new Date(),
    ...overrides,
  };
}

export async function buildApp(deps: AppDeps) {
  const { config } = deps;
  const logger: FastifyServerOptions['logger'] = {
    level: config.LOG_LEVEL,
    redact: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-cart-token"]'],
    ...(config.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty' } } : {}),
  };

  const app = Fastify({
    logger,
    trustProxy: config.TRUST_PROXY,
    // Propagate a caller's request id when it is well-formed; otherwise mint one.
    genReqId: (req) => {
      const incoming = req.headers['x-request-id'];
      return typeof incoming === 'string' && REQUEST_ID.test(incoming) ? incoming : randomUUID();
    },
  });
  const ctx = createContext(deps, app.log);

  registerErrorHandling(app);
  app.decorate('authenticators', { customer: customerAuthenticator(ctx), admin: adminAuthenticator(ctx) });
  app.decorateRequest('admin', null);
  app.decorateRequest('customer', null);

  app.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id);
    reply.header('x-content-type-options', 'nosniff');
    // Responses depend on the host (tenant) and often on the caller; never let shared caches mix them.
    reply.header('vary', 'Host, Authorization, X-Cart-Token');
    if (!reply.getHeader('cache-control')) reply.header('cache-control', 'no-store');
  });

  const routeDocs = collectRouteDocs(app);

  // Platform-level routes: no store context.
  await app.register(healthRoutes(deps.db));

  // Storefront API: every route here is scoped to the store resolved from the host.
  await app.register(
    async (storefront) => {
      resolveStoreFromHost(storefront, deps.db);
      await storefront.register(storeRoutes);
      await storefront.register(customerStorefrontRoutes(ctx));
      await storefront.register(catalogueStorefrontRoutes(ctx));
      await storefront.register(contentStorefrontRoutes(ctx));
      await storefront.register(shippingStorefrontRoutes(ctx));
      await storefront.register(cartRoutes(ctx));
      await storefront.register(checkoutRoutes(ctx));
      await storefront.register(orderStorefrontRoutes(ctx));
    },
    { prefix: '/v1/storefront' },
  );

  // Admin API: platform-hosted; store-scoped routes take the store id in the path
  // and every one of them checks the admin's permission for that store.
  await app.register(
    async (admin) => {
      await admin.register(adminAuthRoutes(ctx));
      await admin.register(adminUserRoutes(ctx));
      await admin.register(platformRoutes(ctx));
      await admin.register(catalogueAdminRoutes(ctx));
      await admin.register(promotionAdminRoutes(ctx));
      await admin.register(shippingAdminRoutes(ctx));
      await admin.register(contentAdminRoutes(ctx));
      await admin.register(customerAdminRoutes(ctx));
      await admin.register(orderAdminRoutes(ctx));
      await admin.register(jobAdminRoutes(ctx));
      await admin.register(reportRoutes(ctx));
      await admin.register(paytmAdminRoutes(ctx));
    },
    { prefix: '/v1/admin' },
  );

  await app.register(paymentWebhookRoutes(ctx), { prefix: '/v1/webhooks' });

  app.get('/v1/openapi.json', async () => buildOpenApi(routeDocs));

  app.decorate('ctx', ctx);
  app.decorate('routeDocs', routeDocs);
  return app;
}
