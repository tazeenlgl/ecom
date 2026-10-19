import type { FastifyError, FastifyInstance } from 'fastify';

/** An error whose code and message are safe to show to clients. */
export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((err: FastifyError | AppError, request, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } });
    }
    if (err.validation) {
      return reply.status(400).send({ error: { code: 'invalid_request', message: err.message } });
    }
    const status = err.statusCode && err.statusCode < 500 ? err.statusCode : 500;
    if (status >= 500) {
      request.log.error({ err }, 'unhandled error');
      // Never leak internals to clients.
      return reply.status(500).send({ error: { code: 'internal_error', message: 'Something went wrong.' } });
    }
    return reply.status(status).send({ error: { code: err.code ?? 'request_error', message: err.message } });
  });

  app.setNotFoundHandler((_request, reply) =>
    reply.status(404).send({ error: { code: 'not_found', message: 'Not found.' } }),
  );
}
