import { and, type Column, lt, or, eq, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { AppError } from './errors.js';

/** Query parameters shared by every list endpoint. */
export const pageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(200).optional(),
});

export type Page<T> = { items: T[]; nextCursor: string | null };

type CursorValue = { t: string; id: string };

/**
 * Keyset pagination ordered by (created_at desc, id desc). The cursor is opaque
 * to clients: base64url JSON of the last row's sort key.
 */
export function cursorCondition(cursor: string | undefined, createdAt: Column, id: Column): SQL | undefined {
  if (!cursor) return undefined;
  let value: CursorValue;
  try {
    value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as CursorValue;
  } catch {
    throw new AppError(400, 'invalid_request', 'Invalid cursor.');
  }
  const t = new Date(value?.t);
  if (Number.isNaN(t.getTime()) || typeof value.id !== 'string' || !z.uuid().safeParse(value.id).success) {
    throw new AppError(400, 'invalid_request', 'Invalid cursor.');
  }
  return or(lt(createdAt, t), and(eq(createdAt, t), lt(id, value.id)));
}

export function toPage<T extends { id: string; createdAt: Date }>(rows: T[], limit: number): Page<T> {
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  const nextCursor =
    rows.length > limit && last
      ? Buffer.from(JSON.stringify({ t: last.createdAt.toISOString(), id: last.id })).toString('base64url')
      : null;
  return { items, nextCursor };
}
