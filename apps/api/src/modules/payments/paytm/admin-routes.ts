import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../../context.js';
import type { DbOrTx } from '../../../db/client.js';
import { paymentGatewayConfigs } from '../../../db/schema.js';
import { actorOf, recordAudit } from '../../../lib/audit.js';
import { encryptSecret } from '../../../lib/crypto.js';
import { AppError } from '../../../lib/errors.js';
import { defineRoute, storeParams } from '../../../lib/route.js';
import { requireStore } from '../../platform/routes.js';
import { PAYTM } from './config.js';

type ConfigRow = typeof paymentGatewayConfigs.$inferSelect;

/** What the API shows about a store's Paytm settings. The merchant key is never returned. */
const present = (row: ConfigRow | undefined) =>
  row
    ? {
        configured: true,
        enabled: row.enabled,
        environment: row.environment,
        merchantId: row.merchantId,
        websiteName: row.websiteName,
        callbackUrl: row.callbackUrl,
        merchantKeySet: true,
        updatedAt: row.updatedAt,
      }
    : { configured: false, enabled: false, merchantKeySet: false };

const fields = z.object({
  merchantId: z.string().regex(/^[A-Za-z0-9]{1,40}$/, 'letters and digits only'),
  // Paytm keys are 16 characters (AES-128). Write-only.
  merchantKey: z.string().length(16),
  websiteName: z.string().regex(/^[A-Za-z0-9_]{1,40}$/),
  callbackUrl: z.url({ protocol: /^https$/ }).max(500),
  environment: z.enum(['staging', 'production']),
  enabled: z.boolean(),
});

/** Admin API for a store's Paytm credentials (`store.settings.manage`). */
export function paytmAdminRoutes(ctx: AppContext) {
  return async (app: FastifyInstance) => {
    const tag = 'Admin: payments';
    const url = '/stores/:storeId/payment-gateways/paytm';
    const load = (db: DbOrTx, storeId: string) =>
      db
        .select()
        .from(paymentGatewayConfigs)
        .where(and(eq(paymentGatewayConfigs.storeId, storeId), eq(paymentGatewayConfigs.provider, PAYTM)))
        .then((rows) => rows[0]);

    defineRoute(
      app,
      { method: 'GET', url, summary: 'Paytm settings for the store (the merchant key is never returned)', tag, auth: { admin: 'store.settings.manage' }, params: storeParams },
      async (_request, { params }) => {
        await requireStore(ctx.db, params.storeId);
        return { paytm: present(await load(ctx.db, params.storeId)) };
      },
    );

    defineRoute(
      app,
      {
        method: 'PUT',
        url,
        summary: 'Set Paytm MID, merchant key, website name, callback URL and environment. Omit merchantKey to keep the stored one',
        tag,
        auth: { admin: 'store.settings.manage' },
        params: storeParams,
        body: fields.partial({ merchantKey: true, websiteName: true, environment: true, enabled: true }),
      },
      async (request, { params, body }) => {
        if (body.environment === 'production' && !ctx.config.PAYTM_PRODUCTION_ENABLED) {
          throw new AppError(409, 'conflict', 'Paytm production is not enabled for this deployment. Use staging.');
        }
        return ctx.db.transaction(async (tx) => {
          await requireStore(tx, params.storeId);
          const existing = await load(tx, params.storeId);
          if (!existing && !body.merchantKey) throw new AppError(400, 'invalid_request', 'merchantKey is required the first time Paytm is configured.');
          const values = {
            merchantId: body.merchantId,
            websiteName: body.websiteName ?? existing?.websiteName ?? (body.environment === 'production' ? 'DEFAULT' : 'WEBSTAGING'),
            callbackUrl: body.callbackUrl,
            environment: body.environment ?? existing?.environment ?? 'staging',
            enabled: body.enabled ?? existing?.enabled ?? false,
            merchantKeyEncrypted: body.merchantKey ? encryptSecret(ctx.config.CONFIG_ENCRYPTION_KEY, body.merchantKey) : existing!.merchantKeyEncrypted,
            updatedBy: request.admin!.id,
          };
          const [row] = await tx
            .insert(paymentGatewayConfigs)
            .values({ storeId: params.storeId, provider: PAYTM, ...values })
            .onConflictDoUpdate({ target: [paymentGatewayConfigs.storeId, paymentGatewayConfigs.provider], set: values })
            .returning();
          const { merchantKeyEncrypted: _k, updatedBy: _u, ...changes } = values;
          await recordAudit(tx, {
            storeId: params.storeId,
            actor: actorOf(request),
            action: 'payment_gateway.paytm.update',
            entityType: 'payment_gateway_config',
            entityId: row!.id,
            changes: { ...changes, merchantKeyChanged: Boolean(body.merchantKey) },
          });
          return { paytm: present(row) };
        });
      },
    );
  };
}
