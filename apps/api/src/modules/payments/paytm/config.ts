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
  merchantId: string;
  merchantKey: string;
  websiteName: string;
  callbackUrl: string;
  host: string;
};

export type PaytmConfigSource = (storeId: string) => Promise<PaytmStoreConfig | null>;

/**
 * Loads a store's Paytm settings from `payment_gateway_configs`. Production is
 * used only when the deployment allows it (PAYTM_PRODUCTION_ENABLED) and the
 * store chose it; otherwise the store is treated as not enabled.
 */
export function paytmConfigFromDb(db: Database, config: Config): PaytmConfigSource {
  return async (storeId) => {
    const [row] = await db
      .select()
      .from(paymentGatewayConfigs)
      .where(and(eq(paymentGatewayConfigs.storeId, storeId), eq(paymentGatewayConfigs.provider, PAYTM)));
    if (!row) return null;
    const environment = row.environment === 'production' ? 'production' : 'staging';
    const productionBlocked = environment === 'production' && !config.PAYTM_PRODUCTION_ENABLED;
    return {
      storeId,
      enabled: row.enabled && !productionBlocked,
      environment,
      merchantId: row.merchantId,
      merchantKey: decryptSecret(config.CONFIG_ENCRYPTION_KEY, row.merchantKeyEncrypted),
      websiteName: row.websiteName,
      callbackUrl: row.callbackUrl,
      host: environment === 'production' ? config.PAYTM_PRODUCTION_HOST : config.PAYTM_STAGING_HOST,
    };
  };
}
