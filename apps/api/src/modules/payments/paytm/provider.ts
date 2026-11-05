import { and, eq } from 'drizzle-orm';
import type { Database } from '../../../db/client.js';
import { paymentTransactions } from '../../../db/schema.js';
import { type PaymentProvider, type ProviderPaymentStatus, type VerifiedPaymentEvent, WebhookVerificationError } from '../provider.js';
import { generateSignature, paramsToString, verifySignature } from './checksum.js';
import { PAYTM, type PaytmConfigSource, type PaytmStoreConfig } from './config.js';

/** Paytm amounts are rupee strings with two decimals. */
export const paiseToRupees = (paise: number) => `${Math.floor(paise / 100)}.${String(paise % 100).padStart(2, '0')}`;

export function rupeesToPaise(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d+(\.\d{1,2})?$/.test(value)) return null;
  const [rupees, fraction = ''] = value.split('.');
  return Number(rupees) * 100 + Number(fraction.padEnd(2, '0'));
}

export class PaytmApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaytmApiError';
  }
}

type PaytmResponse = { body?: Record<string, unknown> & { resultInfo?: { resultStatus?: string; resultCode?: string; resultMsg?: string } } };

/**
 * Paytm Payment Gateway adapter (JS Checkout flow), with credentials per store
 * from the admin API. Written from Paytm's published API documentation and
 * NOT yet exercised against Paytm staging: endpoints, field names and the
 * checksum must be confirmed with a staging MID and key before use.
 *
 * - Paytm's `orderId` is our payment transaction id, so every attempt is unique
 *   and a webhook leads back to its store.
 * - Payment state changes only through the checksum-verified server-to-server
 *   notification or the server-side status API (`fetchPaymentStatus`), never
 *   through the browser callback.
 */
export class PaytmPaymentProvider implements PaymentProvider {
  readonly name = PAYTM;

  constructor(
    private readonly deps: {
      db: Database;
      configFor: PaytmConfigSource;
      fetch: typeof fetch;
    },
  ) {}

  async isEnabledFor(storeId: string): Promise<boolean> {
    return Boolean((await this.deps.configFor(storeId))?.enabled);
  }

  private async requireConfig(storeId: string): Promise<PaytmStoreConfig> {
    const config = await this.deps.configFor(storeId);
    if (!config?.enabled) throw new PaytmApiError('Paytm is not enabled for this store');
    return config;
  }

  /** Signed JSON call: `{ body, head: { signature } }`, where the signature covers the serialised body. */
  private async call(config: PaytmStoreConfig, path: string, body: Record<string, unknown>): Promise<NonNullable<PaytmResponse['body']>> {
    const json = JSON.stringify(body);
    const signature = generateSignature(json, config.merchantKey);
    const res = await this.deps.fetch(`${config.host}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: `{"body":${json},"head":{"signature":${JSON.stringify(signature)}}}`,
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new PaytmApiError(`Paytm returned HTTP ${res.status}`);
    const parsed = (await res.json()) as PaytmResponse;
    if (!parsed.body) throw new PaytmApiError('Paytm returned no body');
    return parsed.body;
  }

  async createPayment(input: { storeId: string; transactionId: string; amountPaise: number; currency: string; customerRef: string }) {
    const config = await this.requireConfig(input.storeId);
    if (input.currency !== 'INR') throw new PaytmApiError('Paytm accepts INR only');
    const orderId = input.transactionId;
    const body = await this.call(config, `/theia/api/v1/initiateTransaction?mid=${encodeURIComponent(config.merchantId)}&orderId=${encodeURIComponent(orderId)}`, {
      requestType: 'Payment',
      mid: config.merchantId,
      websiteName: config.websiteName,
      orderId,
      callbackUrl: config.callbackUrl,
      txnAmount: { value: paiseToRupees(input.amountPaise), currency: 'INR' },
      userInfo: { custId: input.customerRef },
    });
    const txnToken = body.txnToken;
    if (body.resultInfo?.resultStatus !== 'S' || typeof txnToken !== 'string') {
      throw new PaytmApiError(`Paytm initiateTransaction failed: ${body.resultInfo?.resultCode ?? 'unknown'} ${body.resultInfo?.resultMsg ?? ''}`.trim());
    }
    return {
      providerRef: orderId,
      // Everything the browser needs for Paytm JS Checkout. No secrets.
      clientPayload: {
        provider: PAYTM,
        environment: config.environment,
        mid: config.merchantId,
        orderId,
        txnToken,
        amount: paiseToRupees(input.amountPaise),
        checkoutScriptUrl: `${config.host}/merchantpgpui/checkoutjs/merchants/${encodeURIComponent(config.merchantId)}.js`,
      },
    };
  }

  /**
   * Server-to-server payment notification: form-encoded, with CHECKSUMHASH over
   * the other fields. The store (and so the key) is found from ORDERID, which is
   * our transaction id; the MID must match that store's settings.
   */
  async parseWebhook(rawBody: Buffer): Promise<VerifiedPaymentEvent | null> {
    const form = Object.fromEntries(new URLSearchParams(rawBody.toString('utf8')));
    const { CHECKSUMHASH: checksum, ...fields } = form;
    const orderId = fields.ORDERID;
    if (!checksum || !orderId) throw new WebhookVerificationError('Missing ORDERID or CHECKSUMHASH');

    const [txn] = await this.deps.db
      .select({ storeId: paymentTransactions.storeId })
      .from(paymentTransactions)
      .where(and(eq(paymentTransactions.provider, PAYTM), eq(paymentTransactions.providerRef, orderId)));
    // Unknown orders are rejected rather than stored: without the store we cannot verify the checksum.
    if (!txn) throw new WebhookVerificationError('Unknown ORDERID');
    const config = await this.deps.configFor(txn.storeId);
    if (!config || fields.MID !== config.merchantId || !verifySignature(paramsToString(fields), config.merchantKey, checksum)) {
      throw new WebhookVerificationError();
    }

    const type = fields.STATUS === 'TXN_SUCCESS' ? 'payment.succeeded' : fields.STATUS === 'TXN_FAILURE' ? 'payment.failed' : null;
    if (!type) return null;
    return {
      eventId: `${fields.TXNID || orderId}:${fields.STATUS}`,
      type,
      providerRef: orderId,
      amountPaise: rupeesToPaise(fields.TXNAMOUNT),
      occurredAt: null,
      ...(type === 'payment.failed' && fields.RESPCODE ? { failureCode: `paytm_${fields.RESPCODE}` } : {}),
      // Stored on payment_events. The checksum is dropped; nothing here is secret.
      payload: fields,
    };
  }

  private async orderStatus(config: PaytmStoreConfig, orderId: string) {
    return this.call(config, '/v3/order/status', { mid: config.merchantId, orderId });
  }

  async fetchPaymentStatus(providerRef: string, storeId: string): Promise<ProviderPaymentStatus> {
    const config = await this.requireConfig(storeId);
    const body = await this.orderStatus(config, providerRef);
    const status = body.resultInfo?.resultStatus;
    const amountPaise = rupeesToPaise(body.txnAmount) ?? 0;
    if (status === 'TXN_SUCCESS') return { status: 'succeeded', amountPaise };
    if (status === 'TXN_FAILURE') return { status: 'failed', amountPaise };
    return { status: 'pending', amountPaise };
  }

  async createRefund(input: { storeId: string; refundId: string; paymentRef: string; amountPaise: number }) {
    const config = await this.requireConfig(input.storeId);
    // The refund API needs Paytm's own transaction id, which we read from the status API.
    const status = await this.orderStatus(config, input.paymentRef);
    if (status.resultInfo?.resultStatus !== 'TXN_SUCCESS' || typeof status.txnId !== 'string') {
      throw new PaytmApiError('Paytm does not report this payment as successful');
    }
    const body = await this.call(config, '/refund/apply', {
      mid: config.merchantId,
      txnType: 'REFUND',
      orderId: input.paymentRef,
      txnId: status.txnId,
      refId: input.refundId,
      refundAmount: paiseToRupees(input.amountPaise),
    });
    const result = body.resultInfo?.resultStatus;
    if (result === 'TXN_FAILURE' || typeof body.refundId !== 'string') {
      throw new PaytmApiError(`Paytm refund failed: ${body.resultInfo?.resultCode ?? 'unknown'} ${body.resultInfo?.resultMsg ?? ''}`.trim());
    }
    return { refundRef: body.refundId };
  }
}
