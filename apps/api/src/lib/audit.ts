import type { FastifyRequest } from 'fastify';
import type { DbOrTx } from '../db/client.js';
import { auditLogs } from '../db/schema.js';

export type Actor = { type: 'admin' | 'customer' | 'system' | 'webhook'; id: string | null };

export const systemActor: Actor = { type: 'system', id: null };

export function actorOf(request: FastifyRequest): Actor {
  if (request.admin) return { type: 'admin', id: request.admin.id };
  if (request.customer) return { type: 'customer', id: request.customer.id };
  return systemActor;
}

/**
 * Appends an audit entry. Call inside the same transaction as the change.
 * `changes` must never contain secrets (passwords, tokens, OTPs, provider keys).
 */
export async function recordAudit(
  db: DbOrTx,
  entry: {
    storeId: string | null;
    actor: Actor;
    action: string;
    entityType: string;
    entityId: string | null;
    changes?: Record<string, unknown>;
  },
): Promise<void> {
  await db.insert(auditLogs).values({
    storeId: entry.storeId,
    actorType: entry.actor.type,
    actorId: entry.actor.id,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    changes: entry.changes ?? null,
  });
}
