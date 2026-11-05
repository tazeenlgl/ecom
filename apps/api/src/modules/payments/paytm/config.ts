import { and, eq } from 'drizzle-orm';
import type { Config } from '../../../config/env.js';
import type { Database } from '../../../db/client.js';
import { paymentGatewayConfigs } from '../../../db/schema.js';
import { decryptSecret } from '../../../lib/crypto.js';

export const PAYTM = 'paytm';

/** Decrypted Paytm settings for one store. Never log or return `merchantKey`. */
export type PaytmStoreConfig = {
  storeId: string;
  enabled: boolean;
  environment: 'staging' | 'production';
  blockedReason: ReturnType<typeof paytmBlockedReason>;
  merchantId: string;
  merchantKey: string;
  websiteName: string;
  callbackUrl: string;
  host: string;
};

export type PaytmConfigSource = (storeId: string) => Promise<PaytmStoreConfig | null>;

/**
 * Why a stored Paytm configuration cannot take payments in this deployment, or
 * null. Staging is refused in a production deployment, because a staging
 * "success" moves no money and would mark real orders paid. Production is
 * refused until the deployment sets PAYTM_PRODUCTION_ENABLED.
 */
export function paytmBlockedReason(config: Pick<Config, 'NODE_ENV' | 'PAYTM_PRODUCTION_ENABLED'>, environment: 'staging' | 'production') {
  if (environment === 'staging' && config.NODE_ENV === 'production') return 'staging_in_production' as const;
  if (environment === 'production' && !config.PAYTM_PRODUCTION_ENABLED) return 'production_not_enabled' as const;
  return null;
}

/**
 * Loads a store's Paytm settings from `payment_gateway_configs`. A
 * configuration blocked by `paytmBlockedReason` is treated as not enabled.
 */
export function paytmConfigFromDb(db: Database, config: Config): PaytmConfigSource {
  return async (storeId) => {
    const [row] = await db
      .select()
      .from(paymentGatewayConfigs)
      .where(and(eq(paymentGatewayConfigs.storeId, storeId), eq(paymentGatewayConfigs.provider, PAYTM)));
    if (!row) return null;
    const environment = row.environment === 'production' ? 'production' : 'staging';
    return {
      storeId,
      enabled: row.enabled && paytmBlockedReason(config, environment) === null,
      environment,
      blockedReason: paytmBlockedReason(config, environment),
      merchantId: row.merchantId,
      merchantKey: decryptSecret(config.CONFIG_ENCRYPTION_KEY, row.merchantKeyEncrypted),
      websiteName: row.websiteName,
      callbackUrl: row.callbackUrl,
      host: environment === 'production' ? config.PAYTM_PRODUCTION_HOST : config.PAYTM_STAGING_HOST,
    };
  };
}
