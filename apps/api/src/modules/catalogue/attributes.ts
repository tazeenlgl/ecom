import { and, eq } from 'drizzle-orm';
import type { DbOrTx } from '../../db/client.js';
import { attributeDefinitions } from '../../db/schema.js';
import { AppError } from '../../lib/errors.js';

type Value = string | number | boolean;

/**
 * Checks attribute values against the store's attribute definitions for a scope.
 * Unknown codes and values of the wrong type (or outside a select list) are rejected,
 * so apparel fields such as size live in data, not in code.
 */
export async function validateAttributes(
  db: DbOrTx,
  storeId: string,
  scope: 'product' | 'variant',
  values: Record<string, Value>,
): Promise<void> {
  const codes = Object.keys(values);
  if (codes.length === 0) return;
  const defs = await db
    .select()
    .from(attributeDefinitions)
    .where(and(eq(attributeDefinitions.storeId, storeId), eq(attributeDefinitions.scope, scope)));
  const byCode = new Map(defs.map((d) => [d.code, d]));
  const problems: string[] = [];
  for (const code of codes) {
    const def = byCode.get(code);
    const value = values[code];
    if (!def) {
      problems.push(`${code}: not a ${scope} attribute of this store`);
      continue;
    }
    const ok =
      (def.type === 'text' && typeof value === 'string') ||
      (def.type === 'number' && typeof value === 'number') ||
      (def.type === 'boolean' && typeof value === 'boolean') ||
      (def.type === 'select' && typeof value === 'string' && def.options.includes(value));
    if (!ok) problems.push(`${code}: invalid value for ${def.type} attribute`);
  }
  if (problems.length) throw new AppError(400, 'invalid_request', 'Invalid attribute values.', problems);
}
