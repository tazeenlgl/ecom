/**
 * Role, CSRF and cross-store authorization checks against a RUNNING local stack (API on :4000, admin on :3001).
 * Everything goes through the admin BFF exactly as the browser would. Local disposable database only.
 *
 *   E2E_OWNER_EMAIL=... E2E_OWNER_PASSWORD=... node apps/admin/test/e2e-roles.mjs
 */
import { randomBytes } from 'node:crypto';

const ADMIN = process.env.ADMIN_URL ?? 'http://localhost:3001';
const API = process.env.API_URL ?? 'http://localhost:4000';
const OWNER = { email: process.env.E2E_OWNER_EMAIL, password: process.env.E2E_OWNER_PASSWORD };
if (!OWNER.email || !OWNER.password) {
  console.error('Set E2E_OWNER_EMAIL and E2E_OWNER_PASSWORD (a local platform owner).');
  process.exit(2);
}
if (!/localhost|127\.0\.0\.1/.test(ADMIN + API)) {
  console.error('Refusing to run against a non-local URL.');
  process.exit(2);
}

let passed = 0;
const failures = [];
const check = (name, ok, extra = '') => {
  if (ok) passed++;
  else failures.push(`${name} ${extra}`);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ` ${extra}`}`);
};

/** A browser-like client: keeps cookies, sends the CSRF header the way lib/client.ts does. */
class Client {
  jar = new Map();
  async raw(path, init = {}) {
    const cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(`${ADMIN}${path}`, { redirect: 'manual', ...init, headers: { ...(cookie ? { cookie } : {}), ...init.headers } });
    for (const sc of res.headers.getSetCookie?.() ?? []) {
      const [pair] = sc.split(';');
      const i = pair.indexOf('=');
      const [k, v] = [pair.slice(0, i), pair.slice(i + 1)];
      if (/expires=Thu, 01 Jan 1970|max-age=0/i.test(sc) || v === '') this.jar.delete(k);
      else this.jar.set(k, v);
    }
    return res;
  }
  async login(email, password) {
    return this.raw('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
  }
  /** Through the BFF. */
  async call(method, path, body, opts = {}) {
    const headers = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (method !== 'GET' && opts.csrf !== false) headers['x-csrf-token'] = this.jar.get('ecom_admin_csrf') ?? '';
    if (opts.origin) headers.origin = opts.origin;
    const res = await this.raw(`/api/admin/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { status: res.status, json };
  }
}

const suffix = randomBytes(3).toString('hex');
const owner = new Client();
const r = await owner.login(OWNER.email, OWNER.password);
check('owner can sign in through the admin app', r.status === 200);

const stores = (await owner.call('GET', 'stores')).json?.items ?? [];
const demo = stores.find((s) => s.slug === 'demo') ?? stores[0];
check('owner sees at least one store', Boolean(demo));

// A second brand and store for cross-store checks.
const brand = (await owner.call('POST', 'brands', { slug: `e2e-${suffix}`, name: `E2E Brand ${suffix}` })).json?.brand;
const other = (await owner.call('POST', 'stores', { brandId: brand?.id, slug: `e2e-store-${suffix}`, name: `E2E Store ${suffix}` })).json?.store;
check('owner can create a second brand and store', Boolean(brand?.id && other?.id));

// One admin per role, each limited to the demo store.
const password = `Pw-${randomBytes(9).toString('base64url')}`;
const roles = ['store_manager', 'catalogue_editor', 'order_manager', 'support'];
const users = {};
for (const role of roles) {
  const email = `e2e-${role}-${suffix}@example.com`;
  const created = (await owner.call('POST', 'admin-users', { email, name: `E2E ${role}`, password })).json?.adminUser;
  await owner.call('POST', `admin-users/${created?.id}/roles`, { role, storeId: demo.id });
  users[role] = { email, id: created?.id };
}
check('four role accounts were created', roles.every((x) => users[x].id));

const as = {};
for (const role of roles) {
  as[role] = new Client();
  const res = await as[role].login(users[role].email, password);
  check(`${role}: sign-in works`, res.status === 200);
}

// --- Anonymous and CSRF -------------------------------------------------------------------------------
const anon = new Client();
check('anonymous BFF read is rejected (401)', (await anon.call('GET', 'stores')).status === 401);
check('wrong password is rejected', (await new Client().login(OWNER.email, 'definitely-wrong')).status === 401);
check('auth endpoints cannot be reached through the proxy', (await owner.call('POST', 'auth/login', { email: 'x', password: 'y' })).status === 404);
check('write without a CSRF header is blocked (403)', (await as.store_manager.call('POST', `stores/${demo.id}/products`, { slug: `csrf-${suffix}`, title: 'x' }, { csrf: false })).status === 403);
check('write from another origin is blocked (403)', (await as.store_manager.call('POST', `stores/${demo.id}/products`, { slug: `csrf2-${suffix}`, title: 'x' }, { origin: 'https://evil.example' })).status === 403);

// --- Store scoping --------------------------------------------------------------------------------------
for (const role of roles) {
  const visible = (await as[role].call('GET', 'stores')).json?.items?.map((s) => s.id) ?? [];
  check(`${role}: lists only the store they were granted`, visible.length === 1 && visible[0] === demo.id, JSON.stringify(visible));
  check(`${role}: cannot read another store's products by URL`, (await as[role].call('GET', `stores/${other.id}/products`)).status === 403);
  check(`${role}: cannot read another store's orders by URL`, (await as[role].call('GET', `stores/${other.id}/orders`)).status === 403);
  check(`${role}: platform endpoints are denied`, (await as[role].call('GET', 'admin-users')).status === 403 && (await as[role].call('GET', 'brands')).status === 403);
}
check('owner sees both stores', (await owner.call('GET', 'stores')).json?.items?.some((s) => s.id === other.id) === true);

// --- Per-role permissions on the demo store ---------------------------------------------------------------
const p = (role, method, path, body) => as[role].call(method, `stores/${demo.id}${path ? `/${path}` : ''}`, body);
const matrix = [
  // role, label, method, path, body, expected-allowed
  ['store_manager', 'read orders', 'GET', 'orders', undefined, true],
  ['store_manager', 'read audit logs', 'GET', 'audit-logs', undefined, true],
  ['store_manager', 'update store settings', 'PATCH', '', { name: demo.name }, true],
  ['catalogue_editor', 'read products', 'GET', 'products', undefined, true],
  ['catalogue_editor', 'read orders', 'GET', 'orders', undefined, false],
  ['catalogue_editor', 'read customers', 'GET', 'customers', undefined, false],
  ['catalogue_editor', 'read audit logs', 'GET', 'audit-logs', undefined, false],
  ['catalogue_editor', 'update store settings', 'PATCH', '', { name: 'Hacked' }, false],
  ['order_manager', 'read orders', 'GET', 'orders', undefined, true],
  ['order_manager', 'read customers', 'GET', 'customers', undefined, true],
  ['order_manager', 'create a product', 'POST', 'products', { slug: `om-${suffix}`, title: 'x' }, false],
  ['order_manager', 'read background jobs', 'GET', 'jobs', undefined, false],
  ['support', 'read orders', 'GET', 'orders', undefined, true],
  ['support', 'read customers', 'GET', 'customers', undefined, true],
  ['support', 'create a product', 'POST', 'products', { slug: `su-${suffix}`, title: 'x' }, false],
  ['support', 'create a promotion', 'POST', 'promotions', { name: 'x', kind: 'free_shipping' }, false],
  ['support', 'read sales reports', 'GET', 'reports/sales?from=2026-01-01&to=2026-01-02', undefined, false],
  ['support', 'read POS status', 'GET', 'pos/status', undefined, false],
];
for (const [role, label, method, path, body, allowed] of matrix) {
  const res = await p(role, method, path, body);
  const ok = allowed ? res.status < 300 : res.status === 403;
  check(`${role}: ${allowed ? 'can' : 'cannot'} ${label}`, ok, `(got ${res.status})`);
}

// --- A real write, then verify it landed ------------------------------------------------------------------
const slug = `e2e-product-${suffix}`;
const created = await p('catalogue_editor', 'POST', 'products', { slug, title: `E2E product ${suffix}` });
check('catalogue_editor: creates a draft product', created.status === 201 && created.json?.product?.status === 'draft', `(got ${created.status})`);
const pid = created.json?.product?.id;
const fetched = await p('store_manager', 'GET', `products/${pid}`);
check('the new product is readable by another role', fetched.status === 200 && fetched.json?.product?.slug === slug);
check('order_manager cannot edit it', (await p('order_manager', 'PATCH', `products/${pid}`, { title: 'nope' })).status === 403);
check('product cannot be reached through the other store', (await as.store_manager.call('GET', `stores/${other.id}/products/${pid}`)).status === 403);
await p('store_manager', 'POST', `products/${pid}/status`, { status: 'archived' });

// --- Sign-out really revokes the session ------------------------------------------------------------------
const token = as.support.jar.get('ecom_admin_session');
const before = await fetch(`${API}/v1/admin/me`, { headers: { authorization: `Bearer ${token}` } });
const out = await as.support.raw('/api/auth/logout', { method: 'POST', headers: { 'x-csrf-token': as.support.jar.get('ecom_admin_csrf') ?? '' } });
const after = await fetch(`${API}/v1/admin/me`, { headers: { authorization: `Bearer ${token}` } });
check('session token worked before sign-out', before.status === 200);
check('sign-out succeeds and reports the token revoked', out.status === 200);
check('the old token is rejected by the API after sign-out', after.status === 401, `(got ${after.status})`);
check('the BFF no longer lets the signed-out client in', (await as.support.call('GET', 'stores')).status === 401);

// --- Disabled accounts lose access immediately -------------------------------------------------------------
await owner.call('PATCH', `admin-users/${users.order_manager.id}`, { status: 'disabled' });
check('a disabled administrator is locked out at once', (await as.order_manager.call('GET', `stores/${demo.id}/orders`)).status === 401);

// --- Cleanup (local test data only) -------------------------------------------------------------------------
for (const role of roles) await owner.call('PATCH', `admin-users/${users[role].id}`, { status: 'disabled' });
await owner.call('PATCH', `stores/${other.id}`, { status: 'disabled' });
await owner.call('PATCH', `brands/${brand.id}`, { status: 'archived' });

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log(failures.map((f) => ` - ${f}`).join('\n'));
  process.exit(1);
}
