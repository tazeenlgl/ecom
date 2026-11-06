import { sql } from 'drizzle-orm';
import type { Database } from '../../src/db/client.js';

/** A database may be wiped by the test setup only when its real name ends in `_test`. */
export const DISPOSABLE_DATABASE_SUFFIX = '_test';

export const isDisposableDatabaseName = (name: string | null | undefined): boolean => typeof name === 'string' && name.length > DISPOSABLE_DATABASE_SUFFIX.length && name.endsWith(DISPOSABLE_DATABASE_SUFFIX);

type Queryable = Pick<Database, 'execute'>;

/**
 * Asks the live connection which database it is actually talking to (not the URL text, which can lie through
 * defaults, environment overrides or poolers) and refuses unless it is a disposable `*_test` database.
 * Call this before anything destructive such as `drop schema`.
 */
export async function assertDisposableDatabase(db: Queryable): Promise<string> {
  const result = (await db.execute(sql`select current_database() as name`)) as unknown as { rows?: { name?: string }[] };
  const name = result.rows?.[0]?.name;
  if (!isDisposableDatabaseName(name)) {
    throw new Error(
      `Refusing destructive test setup: the connected database is "${name ?? 'unknown'}", not a disposable "*${DISPOSABLE_DATABASE_SUFFIX}" database. ` +
        'Point TEST_DATABASE_URL at a dedicated test database. Nothing was changed.',
    );
  }
  return name!;
}
