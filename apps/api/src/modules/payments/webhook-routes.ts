import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { AppError } from '../../lib/errors.js';
import { defineRoute } from '../../lib/route.js';
import { WebhookVerificationError } from './provider.js';
import { ingestPaymentEvent } from './service.js';

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: Buffer;
  }
}

/**
 * Provider webhooks. Not tenant-resolved by host: the store is derived from
 * the payment transaction the event refers to. Signatures are verified over
 * the exact raw bytes, so this scope keeps the body as a Buffer.
 */
export function paymentWebhookRoutes(ctx: AppContext) {
  return async (app: FastifyInstance) => {
    app.removeAllContentTypeParsers();
    app.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit: 256 * 1024 }, (request, body, done) => {
      request.rawBody = body as Buffer;
      done(null, {});
    });

    defineRoute(
      app,
      {
        method: 'POST',
        url: '/payments/:provider',
        summary: 'Payment provider webhook (signature-verified, idempotent by provider event id)',
        tag: 'Webhooks',
        auth: 'public',
        params: z.object({ provider: z.string().regex(/^[a-z0-9_-]{1,40}$/) }),
      },
      async (request, { params }) => {
        const provider = ctx.payments.get(params.provider);
        if (!provider) throw new AppError(404, 'not_found', 'Not found.');
        let event;
        try {
          event = await provider.parseWebhook(request.rawBody ?? Buffer.alloc(0), request.headers);
        } catch (err) {
          if (err instanceof WebhookVerificationError) {
            request.log.warn({ provider: params.provider }, 'rejected payment webhook: verification failed');
            throw new AppError(400, 'webhook_invalid', 'Webhook verification failed.');
          }
          throw err;
        }
        if (!event) return { received: true, outcome: 'no_change' };
        const outcome = await ingestPaymentEvent(ctx, provider.name, event);
        request.log.info({ provider: provider.name, eventId: event.eventId, outcome }, 'payment webhook processed');
        return { received: true, outcome };
      },
    );
  };
}
