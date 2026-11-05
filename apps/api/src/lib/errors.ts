import type { FastifyError, FastifyInstance } from 'fastify';
import { ZodError } from 'zod';

/**
 * Stable error codes returned in `{ error: { code } }`. Clients branch on these,
 * so they are part of the API contract (see docs/API.md#errors).
 */
export type ErrorCode =
  | 'invalid_request'
  | 'invalid_host'
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'store_not_found'
  | 'store_maintenance'
  | 'conflict'
  | 'invalid_transition'
  | 'idempotency_key_reused'
  | 'rate_limited'
  | 'otp_invalid'
  | 'otp_expired'
  | 'unavailable'
  | 'price_changed'
  | 'not_serviceable'
  | 'payment_error'
  | 'webhook_invalid'
  | 'internal_error'
  | (string & {});

/** An error whose code and message are safe to show to clients. */
export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const notFound = (what = 'Resource') => new AppError(404, 'not_found', `${what} not found.`);
export const conflict = (message: string, details?: unknown) => new AppError(409, 'conflict', message, details);

const pgUniqueViolation = '23505';
const pgForeignKeyViolation = '23503';

function pgCode(err: unknown): string | undefined {
  const e = err as { code?: unknown; cause?: { code?: unknown } };
  if (typeof e?.code === 'string') return e.code;
  if (typeof e?.cause?.code === 'string') return e.cause.code;
  return undefined;
}

export const isUniqueViolation = (err: unknown) => pgCode(err) === pgUniqueViolation;

export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((err: FastifyError | AppError | ZodError, request, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.statusCode).send({
        error: { code: err.code, message: err.message, ...(err.details === undefined ? {} : { details: err.details }) },
      });
    }
    if (err instanceof ZodError) {
      const details = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
      return reply.status(400).send({ error: { code: 'invalid_request', message: 'Invalid request.', details } });
    }
    const code = pgCode(err);
    if (code === pgUniqueViolation) {
      return reply.status(409).send({ error: { code: 'conflict', message: 'A record with these values already exists.' } });
    }
    if (code === pgForeignKeyViolation) {
      return reply.status(409).send({ error: { code: 'conflict', message: 'A referenced record does not exist or is in use.' } });
    }
    if ('validation' in err && err.validation) {
      return reply.status(400).send({ error: { code: 'invalid_request', message: err.message } });
    }
    const status = 'statusCode' in err && err.statusCode && err.statusCode < 500 ? err.statusCode : 500;
    if (status >= 500) {
      request.log.error({ err }, 'unhandled error');
      // Never leak internals to clients.
      return reply.status(500).send({ error: { code: 'internal_error', message: 'Something went wrong.' } });
    }
    return reply
      .status(status)
      .send({ error: { code: ('code' in err && err.code) || 'request_error', message: err.message } });
  });

  app.setNotFoundHandler((_request, reply) =>
    reply.status(404).send({ error: { code: 'not_found', message: 'Not found.' } }),
  );
}
