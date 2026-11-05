import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { hmacSha256, safeEqual } from '../../lib/crypto.js';
import {
  type PaymentProvider,
  type ProviderPaymentStatus,
  type VerifiedPaymentEvent,
  WebhookVerificationError,
} from './provider.js';

const eventSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['payment.succeeded', 'payment.failed', 'refund.succeeded', 'refund.failed']),
  data: z.object({
    providerRef: z.string().min(1),
    amountPaise: z.number().int().nullable().optional(),
    occurredAt: z.iso.datetime().optional(),
    failureCode: z.string().optional(),
  }),
});

/**
 * NOT A REAL GATEWAY. A deterministic stand-in for development and tests.
 * It moves no money and talks to no network. Webhooks are signed with
 * HMAC-SHA256 over the raw body in the `x-fake-signature` header, which is the
 * same shape most Indian gateways use, so the verification path is exercised.
 * Refused in production by config validation.
 */
export class FakePaymentProvider implements PaymentProvider {
  readonly name = 'fake';
  /** Server-side payment state, as `fetchPaymentStatus` would report it. */
  readonly payments = new Map<string, ProviderPaymentStatus>();

  constructor(private readonly webhookSecret: string) {}

  async createPayment(input: { transactionId: string; amountPaise: number }) {
    const providerRef = `fake_pay_${randomUUID()}`;
    this.payments.set(providerRef, { status: 'pending', amountPaise: input.amountPaise });
    return { providerRef, clientPayload: { provider: this.name, providerRef, note: 'Test provider: no real checkout.' } };
  }

  sign(rawBody: string): string {
    return hmacSha256(this.webhookSecret, rawBody);
  }

  parseWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): VerifiedPaymentEvent {
    const signature = headers['x-fake-signature'];
    if (typeof signature !== 'string' || !safeEqual(signature, this.sign(rawBody.toString('utf8')))) {
      throw new WebhookVerificationError();
    }
    let json: unknown;
    try {
      json = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new WebhookVerificationError('Malformed webhook body');
    }
    const parsed = eventSchema.safeParse(json);
    if (!parsed.success) throw new WebhookVerificationError('Unrecognised webhook body');
    const { id, type, data } = parsed.data;
    return {
      eventId: id,
      type,
      providerRef: data.providerRef,
      amountPaise: data.amountPaise ?? null,
      occurredAt: data.occurredAt ? new Date(data.occurredAt) : null,
      ...(data.failureCode ? { failureCode: data.failureCode } : {}),
      payload: json as Record<string, unknown>,
    };
  }

  async fetchPaymentStatus(providerRef: string): Promise<ProviderPaymentStatus> {
    return this.payments.get(providerRef) ?? { status: 'pending', amountPaise: 0 };
  }

  async createRefund(_input: { refundId: string }) {
    return { refundRef: `fake_rfnd_${randomUUID()}` };
  }
}
