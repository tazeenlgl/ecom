import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { actorOf, recordAudit } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import { RateLimiter } from '../../lib/rate-limit.js';
import { defineRoute, storeParams } from '../../lib/route.js';
import { requireStore } from '../platform/routes.js';
import { IMAGE_TYPES, type ImageType, inspectImage, LocalMediaStorage, objectKey } from './storage.js';

const uploadQuery = z.object({ purpose: z.enum(['hero']).default('hero') });
const limiter = new RateLimiter(30, 60_000);

export function mediaAdminRoutes(ctx: AppContext) {
  return async (app: FastifyInstance) => {
    // Raw image bodies. Fastify enforces the size limit before the handler runs; anything else is a 415.
    app.addContentTypeParser(Object.keys(IMAGE_TYPES), { parseAs: 'buffer', bodyLimit: ctx.config.MEDIA_UPLOAD_MAX_BYTES }, (_req, body, done) => done(null, body));

    defineRoute(
      app,
      {
        method: 'POST',
        url: '/stores/:storeId/media',
        summary: 'Upload an image (raw body, Content-Type image/jpeg, image/png or image/webp). Returns its public address.',
        tag: 'Admin: media',
        status: 201,
        auth: { admin: 'content.write' },
        params: storeParams,
        query: uploadQuery,
        body: z.instanceof(Buffer, { error: 'Send the image as the raw request body with an image Content-Type.' }),
        binaryBodyTypes: Object.keys(IMAGE_TYPES),
        rateLimited: true,
        rateLimitNote: '30 uploads per minute per admin user in each API instance',
      },
      async (request, { params, query, body }) => {
        if (!ctx.media) throw new AppError(503, 'unavailable', 'Image storage is not configured.');
        limiter.consume(`media:${request.admin?.id ?? request.ip}`);
        const claimed = String(request.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase() as ImageType;
        const info = inspectImage(body);
        if (!info) throw new AppError(400, 'invalid_request', 'The file is not a valid JPEG, PNG or WebP image.');
        if (info.contentType !== claimed) throw new AppError(400, 'invalid_request', 'The file content does not match its Content-Type.');
        await requireStore(ctx.db, params.storeId);
        const key = objectKey(params.storeId, query.purpose, info.contentType);
        let url: string;
        try {
          ({ url } = await ctx.media.put(key, body, info.contentType));
        } catch (err) {
          request.log.error({ err: err instanceof Error ? err.message : 'upload failed' }, 'media upload failed');
          throw new AppError(502, 'unavailable', 'The image could not be stored. Try again.');
        }
        await ctx.db.transaction((tx) => recordAudit(tx, { storeId: params.storeId, actor: actorOf(request), action: 'media.upload', entityType: 'media', entityId: key, changes: { purpose: query.purpose, bytes: body.length, type: info.contentType } }));
        return { url, key, contentType: info.contentType, bytes: body.length, width: info.width, height: info.height };
      },
    );
  };
}

/** Development only: serves what LocalMediaStorage stored. Registered only for the local adapter. */
export function localMediaRoutes(storage: LocalMediaStorage) {
  return async (app: FastifyInstance) => {
    app.get('/media/*', async (request, reply) => {
      const key = (request.params as { '*': string })['*'];
      const file = await storage.read(key).catch(() => null);
      const ext = key.split('.').pop() ?? '';
      const type = Object.entries(IMAGE_TYPES).find(([, e]) => e === ext)?.[0];
      if (!file || !type) throw new AppError(404, 'not_found', 'Not found.');
      return reply.header('content-type', type).header('cache-control', 'no-store').send(file);
    });
  };
}
