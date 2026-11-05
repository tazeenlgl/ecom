import { describe, expect, it } from 'vitest';
import { csrfOk, safeEqual, safeProxyPath } from '@/lib/csrf';
import { hasPermission, type RoleDef } from '@/lib/permissions';

const roles: RoleDef[] = [
  { key: 'platform_owner', label: 'Platform owner', permissions: ['platform.admins.manage', 'store.read', 'catalogue.write', 'orders.manage'] },
  { key: 'catalogue_editor', label: 'Catalogue editor', permissions: ['store.read', 'catalogue.read', 'catalogue.write'] },
  { key: 'support', label: 'Support', permissions: ['store.read', 'orders.read'] },
];

describe('hasPermission (mirrors the API)', () => {
  it('platform-wide grants apply to every store and to platform permissions', () => {
    const g = [{ role: 'platform_owner', storeId: null }];
    expect(hasPermission(g, roles, 'catalogue.write', 'store-a')).toBe(true);
    expect(hasPermission(g, roles, 'catalogue.write', 'store-b')).toBe(true);
    expect(hasPermission(g, roles, 'platform.admins.manage', null)).toBe(true);
  });

  it('store-scoped grants only apply to their store and never to platform permissions', () => {
    const g = [{ role: 'catalogue_editor', storeId: 'store-a' }];
    expect(hasPermission(g, roles, 'catalogue.write', 'store-a')).toBe(true);
    expect(hasPermission(g, roles, 'catalogue.write', 'store-b')).toBe(false);
    expect(hasPermission(g, roles, 'catalogue.write', null)).toBe(false);
    expect(hasPermission(g, roles, 'orders.manage', 'store-a')).toBe(false);
  });

  it('a store-scoped owner grant still cannot use platform permissions', () => {
    expect(hasPermission([{ role: 'platform_owner', storeId: 'store-a' }], roles, 'platform.admins.manage', 'store-a')).toBe(false);
  });

  it('unknown roles grant nothing', () => {
    expect(hasPermission([{ role: 'made_up', storeId: null }], roles, 'store.read', 'store-a')).toBe(false);
  });
});

describe('csrfOk', () => {
  const base = { origin: 'http://localhost:3001', host: 'localhost:3001', header: 'a'.repeat(32), cookie: 'a'.repeat(32) };
  it('lets safe methods through without a token', () => {
    expect(csrfOk({ ...base, method: 'GET', header: null, cookie: null })).toBe(true);
  });
  it('accepts a matching double-submit token from the same origin', () => {
    expect(csrfOk({ ...base, method: 'POST' })).toBe(true);
    expect(csrfOk({ ...base, method: 'PATCH', origin: null })).toBe(true);
  });
  it('rejects a missing, mismatched or short token', () => {
    expect(csrfOk({ ...base, method: 'POST', header: null })).toBe(false);
    expect(csrfOk({ ...base, method: 'POST', header: 'b'.repeat(32) })).toBe(false);
    expect(csrfOk({ ...base, method: 'DELETE', header: 'abc', cookie: 'abc' })).toBe(false);
  });
  it('rejects a cross-site Origin even with a valid token', () => {
    expect(csrfOk({ ...base, method: 'POST', origin: 'https://evil.example' })).toBe(false);
    expect(csrfOk({ ...base, method: 'POST', origin: 'not a url' })).toBe(false);
  });
  it('compares in a length-safe way', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('safeProxyPath', () => {
  it('joins plain segments', () => {
    expect(safeProxyPath(['stores', 'abc-123', 'products'])).toBe('stores/abc-123/products');
  });
  it('blocks traversal, odd characters and empty paths', () => {
    expect(safeProxyPath([])).toBeNull();
    expect(safeProxyPath(['stores', '..', 'auth'])).toBeNull();
    expect(safeProxyPath(['stores', 'a/b'])).toBeNull();
    expect(safeProxyPath(['stores', 'a b'])).toBeNull();
    expect(safeProxyPath(['stores', '%2e%2e'])).toBeNull();
  });
  it('never proxies the auth endpoints (they have their own routes)', () => {
    expect(safeProxyPath(['auth', 'login'])).toBeNull();
    expect(safeProxyPath(['auth', 'logout'])).toBeNull();
  });
});
