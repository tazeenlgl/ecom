import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import type { DbOrTx, Database } from '../../db/client.js';
import { jobs } from '../../db/schema.js';

export type Job = typeof jobs.$inferSelect;

export type EnqueueInput = {
  type: string;
  storeId: string | null;
  /** IDs and parameters only. Never secrets, OTPs or customer personal data. */
  payload?: Record<string, unknown>;
  /** Enqueueing the same key again does nothing. */
  idempotencyKey?: string;
  runAt?: Date;
  maxAttempts?: number;
};

/** Adds a job. Use the caller's transaction so the job exists only if the change commits. */
export async function enqueueJob(db: DbOrTx, input: EnqueueInput): Promise<void> {
  await db
    .insert(jobs)
    .values({
      type: input.type,
      storeId: input.storeId,
      payload: input.payload ?? {},
      idempotencyKey: input.idempotencyKey ?? null,
      ...(input.runAt ? { runAt: input.runAt } : {}),
      ...(input.maxAttempts ? { maxAttempts: input.maxAttempts } : {}),
    })
    .onConflictDoNothing({ target: jobs.idempotencyKey });
}

/** Thrown by a handler for failures that retrying cannot fix; the job goes straight to `dead`. */
export class PermanentJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentJobError';
  }
}

export type JobHandler = (job: Job) => Promise<void>;
export type JobHandlers = Record<string, JobHandler>;

/** Exponential backoff: 30s, 1m, 2m, 4m ... capped at 1h. */
export const backoffMs = (attempts: number) => Math.min(30_000 * 2 ** Math.max(0, attempts - 1), 3_600_000);

const LEASE_MS = 15 * 60_000;

/**
 * Claims up to `limit` due jobs with FOR UPDATE SKIP LOCKED, so several workers
 * can run safely, then runs each. Returns the number processed.
 */
export async function runDueJobs(db: Database, handlers: JobHandlers, workerId: string, limit = 10, now = new Date()) {
  // Recover jobs whose worker died mid-run.
  await db
    .update(jobs)
    .set({ status: 'queued', lockedAt: null, lockedBy: null })
    .where(and(eq(jobs.status, 'running'), lt(jobs.lockedAt, new Date(now.getTime() - LEASE_MS))));

  const claimed = await db.execute<{ id: string }>(sql`
    update ${jobs} set status = 'running', locked_at = ${now.toISOString()}, locked_by = ${workerId},
      attempts = attempts + 1, updated_at = now()
    where id in (
      select id from ${jobs}
      where status = 'queued' and run_at <= ${now.toISOString()}
      order by run_at
      for update skip locked
      limit ${limit}
    )
    returning id`);
  const ids = claimed.rows.map((r) => r.id);
  if (ids.length === 0) return 0;

  const rows = await db.select().from(jobs).where(inArray(jobs.id, ids));
  for (const job of rows) {
    const handler = handlers[job.type];
    try {
      if (!handler) throw new PermanentJobError(`No handler for job type ${job.type}`);
      await handler(job);
      await db
        .update(jobs)
        .set({ status: 'succeeded', completedAt: new Date(), lockedAt: null, lockedBy: null, lastError: null })
        .where(eq(jobs.id, job.id));
    } catch (err) {
      const message = err instanceof Error ? err.message.slice(0, 1000) : 'unknown error';
      const permanent = err instanceof PermanentJobError || (err as { retryable?: boolean })?.retryable === false;
      const dead = permanent || job.attempts >= job.maxAttempts;
      await db
        .update(jobs)
        .set({
          status: dead ? 'dead' : 'queued',
          runAt: dead ? job.runAt : new Date(now.getTime() + backoffMs(job.attempts)),
          lockedAt: null,
          lockedBy: null,
          lastError: message,
        })
        .where(eq(jobs.id, job.id));
    }
  }
  return rows.length;
}
