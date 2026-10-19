/**
 * Provider-neutral payment port. Every real gateway (Razorpay, Cashfree, PayU...)
 * gets its own adapter implementing this interface, written against that
 * provider's documented contract once it is chosen and approved.
 *
 * Rules every adapter must follow:
 * - `parseWebhook` verifies the provider's signature over the raw request body
 *   and throws `WebhookVerificationError` when it does not match.
 * - A browser redirect is never proof of payment; only a verified webhook or a
 *   server-side `fetchPaymentStatus` call changes payment state.
 */

export type PaymentEventType = 'payment.succeeded' | 'payment.failed' | 'refund.succeeded' | 'refund.failed';

export type VerifiedPaymentEvent = {
  /** Provider's unique event id; used to drop duplicate deliveries. */
  eventId: string;
  type: PaymentEventType;
  /** Payment reference for payment.* events, refund reference for refund.* events. */
  providerRef: string;
  amountPaise: number | null;
  occurredAt: Date | null;
  failureCode?: string;
  payload: Record<string, unknown>;
};

export type ProviderPaymentStatus = { status: 'pending' | 'succeeded' | 'failed'; amountPaise: number };

export interface PaymentProvider {
  readonly name: string;
  createPayment(input: {
    transactionId: string;
    orderNumber: string;
    amountPaise: number;
    currency: string;
  }): Promise<{ providerRef: string; clientPayload: Record<string, unknown> }>;
  parseWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): VerifiedPaymentEvent;
  fetchPaymentStatus(providerRef: string): Promise<ProviderPaymentStatus>;
  createRefund(input: { refundId: string; paymentRef: string; amountPaise: number }): Promise<{ refundRef: string }>;
}

export class WebhookVerificationError extends Error {
  constructor(message = 'Webhook signature verification failed') {
    super(message);
    this.name = 'WebhookVerificationError';
  }
}

export type PaymentProviders = Map<string, PaymentProvider>;
