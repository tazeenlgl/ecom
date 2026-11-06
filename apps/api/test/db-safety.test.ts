import { afterAll, describe, expect, it } from 'vitest';
import { createDatabase } from '../src/db/client.js';
import { assertDisposableDatabase, isDisposableDatabaseName } from './support/disposable-db.js';

const fakeDb = (name: string | undefined) => ({ execute: async () => ({ rows: name === undefined ? [] : [{ name }] }) }) as never;

describe('destructive test setup guard', () => {
  it.each([
    ['ecom_test', true],
    ['shop_test', true],
    ['ecom', false],
    ['ecom_testing', false],
    ['ecom_test_backup', false],
    ['test', false],
    ['_test', false],
    ['ECOM', false],
    ['postgres', false],
    ['', false],
  ])('database name "%s" disposable = %s', (name, expected) => {
    expect(isDisposableDatabaseName(name)).toBe(expected);
  });

  it('refuses when the live connection reports a non-test database', async () => {
    await expect(assertDisposableDatabase(fakeDb('ecom'))).rejects.toThrow(/Refusing destructive test setup.*"ecom"/);
    await expect(assertDisposableDatabase(fakeDb('ecom_production'))).rejects.toThrow(/Refusing/);
  });

  it('refuses when the database name cannot be determined', async () => {
    await expect(assertDisposableDatabase(fakeDb(undefined))).rejects.toThrow(/unknown/);
  });

  it('accepts a *_test database', async () => {
    await expect(assertDisposableDatabase(fakeDb('ecom_test'))).resolves.toBe('ecom_test');
  });

  describe('against the real server', () => {
    // Read-only: only `select current_database()`. The maintenance database exists on every PostgreSQL server.
    const base = (process.env.TEST_DATABASE_URL ?? 'postgres://ecom:ecom@localhost:5432/ecom_test').replace(/\/[^/]*$/, '/postgres');
    const { db, pool } = createDatabase(base);
    afterAll(async () => pool.end());

    it('reads the real database name from the connection and refuses a non-test one', async () => {
      await expect(assertDisposableDatabase(db)).rejects.toThrow(/"postgres"/);
    });
  });
});
