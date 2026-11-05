import { z } from 'zod';
import type { RouteDoc } from './route.js';

const errorSchema = {
  type: 'object',
  required: ['error'],
  properties: {
    error: {
      type: 'object',
      required: ['code', 'message'],
      properties: { code: { type: 'string' }, message: { type: 'string' }, details: {} },
    },
  },
};

function jsonSchema(schema: z.ZodType) {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;
  return rest;
}

function parameters(schema: z.ZodType | undefined, location: 'path' | 'query') {
  if (!schema) return [];
  const json = jsonSchema(schema) as { properties?: Record<string, unknown>; required?: string[] };
  return Object.entries(json.properties ?? {}).map(([name, s]) => ({
    name,
    in: location,
    required: location === 'path' || (json.required ?? []).includes(name),
    schema: s,
  }));
}

/**
 * Builds the OpenAPI 3.1 document from the same route definitions (and Zod
 * schemas) that validate requests, so the contract cannot drift from the code.
 */
export function buildOpenApi(routes: RouteDoc[]) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const r of [...routes].sort((a, b) => a.url.localeCompare(b.url))) {
    const path = r.url.replace(/:([A-Za-z]+)/g, '{$1}');
    const security =
      r.auth === 'customer' ? [{ customerBearer: [] }] : typeof r.auth === 'object' ? [{ adminBearer: [] }] : [];
    const notes: string[] = [];
    if (path.startsWith('/v1/storefront')) notes.push('Store is resolved from the verified Host header; client-supplied store ids are ignored.');
    if (typeof r.auth === 'object') notes.push(r.auth.admin ? `Requires permission \`${r.auth.admin}\`${path.includes('{storeId}') ? ' for the store in the path' : ''}.` : 'Requires any signed-in admin.');
    if (r.auth === 'customer') notes.push('Requires a signed-in customer of the resolved store.');
    if (r.idempotencyKey) notes.push('Requires an `Idempotency-Key` header (8-128 chars).');
    if (r.rateLimited) notes.push('Rate limited per client IP.');

    const headerParams = [
      ...(r.idempotencyKey ? [{ name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string', minLength: 8, maxLength: 128 } }] : []),
    ];
    paths[path] ??= {};
    paths[path][r.method.toLowerCase()] = {
      summary: r.summary,
      tags: [r.tag],
      ...(notes.length ? { description: notes.join(' ') } : {}),
      ...(typeof r.auth === 'object' && r.auth.admin ? { 'x-permission': r.auth.admin } : {}),
      security,
      parameters: [...parameters(r.params, 'path'), ...parameters(r.query, 'query'), ...headerParams],
      ...(r.body && r.method !== 'GET' ? { requestBody: { required: true, content: { 'application/json': { schema: jsonSchema(r.body) } } } } : {}),
      responses: {
        [String(r.status)]: { description: r.status === 204 ? 'No content' : 'Success' },
        '4XX': { description: 'Client error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        '5XX': { description: 'Server error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
      },
    };
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'ecom API',
      version: '1',
      description: 'Multi-brand commerce API. Amounts are integer paise (INR, GST-inclusive). See docs/API.md for conventions.',
    },
    paths,
    components: {
      securitySchemes: {
        customerBearer: { type: 'http', scheme: 'bearer', description: 'Customer session token from /v1/storefront/auth/*' },
        adminBearer: { type: 'http', scheme: 'bearer', description: 'Admin session token from /v1/admin/auth/login' },
      },
      schemas: { Error: errorSchema },
    },
  };
}
