import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/env.js';
import { assertMediaUrls, checkMediaUrl, parseMediaHosts } from '../src/lib/media-url.js';
import { adminToken, bearer, seedStore, setupTestApp, type TestContext } from './helpers.js';

const HOSTS = ['cdn.example.com', '*.img.example.org'];
const accepted = (raw: string) => checkMediaUrl(raw, HOSTS);

describe('image address policy', () => {
  it('accepts https addresses on an allowed host and normalises them', () => {
    expect(accepted('https://cdn.example.com/a/b.jpg?w=1')).toEqual({ ok: true, url: 'https://cdn.example.com/a/b.jpg?w=1' });
    expect(accepted('https://CDN.EXAMPLE.COM:443/a.jpg')).toEqual({ ok: true, url: 'https://cdn.example.com/a.jpg' });
    expect(accepted('https://a.img.example.org/x.png')).toMatchObject({ ok: true });
  });

  it.each([
    ['plain http', 'http://cdn.example.com/a.jpg'],
    ['no scheme', 'cdn.example.com/a.jpg'],
    ['protocol-relative', '//cdn.example.com/a.jpg'],
    ['other scheme', 'ftp://cdn.example.com/a.jpg'],
    ['javascript scheme', 'javascript:alert(1)'],
    ['data scheme', 'data:image/png;base64,AAAA'],
    ['user info', 'https://user:pw@cdn.example.com/a.jpg'],
    ['user info trick', 'https://cdn.example.com@evil.example/a.jpg'],
    ['backslash trick', 'https://evil.example\\@cdn.example.com/a.jpg'],
    ['IPv4', 'https://127.0.0.1/a.jpg'],
    ['IPv4 metadata address', 'https://169.254.169.254/latest/meta-data'],
    ['IPv4 decimal', 'https://2130706433/a.jpg'],
    ['IPv4 hex', 'https://0x7f.1/a.jpg'],
    ['IPv4 short', 'https://127.1/a.jpg'],
    ['IPv6 loopback', 'https://[::1]/a.jpg'],
    ['IPv4-mapped IPv6', 'https://[::ffff:127.0.0.1]/a.jpg'],
    ['localhost', 'https://localhost/a.jpg'],
    ['single label', 'https://intranet/a.jpg'],
    ['.local', 'https://printer.local/a.jpg'],
    ['trailing dot', 'https://cdn.example.com./a.jpg'],
    ['other port', 'https://cdn.example.com:8443/a.jpg'],
    ['fragment', 'https://cdn.example.com/a.jpg#x'],
    ['unlisted host', 'https://evil.example/a.jpg'],
    ['look-alike suffix', 'https://cdn.example.com.evil.example/a.jpg'],
    ['look-alike prefix', 'https://evilcdn.example.com/a.jpg'],
    ['subdomain of an exact entry', 'https://x.cdn.example.com/a.jpg'],
    ['wildcard parent itself', 'https://img.example.org/a.jpg'],
    ['wildcard two labels deep', 'https://a.b.img.example.org/a.jpg'],
    ['punycode look-alike', 'https://xn--cdn-example-9gb.com/a.jpg'],
    ['space', 'https://cdn.example.com/a b.jpg'],
    ['newline', 'https://cdn.example.com/a.jpg\n'],
    ['control character', 'https://cdn.exa\u0000mple.com/a.jpg'],
    ['empty', ''],
    ['over 1000 characters', `https://cdn.example.com/${'a'.repeat(1000)}`],
  ])('rejects %s', (_name, raw) => {
    expect(accepted(raw).ok, raw).toBe(false);
  });

  it('with an empty list accepts nothing', () => {
    expect(checkMediaUrl('https://cdn.example.com/a.jpg', []).ok).toBe(false);
  });

  it('assertMediaUrls skips empty values and throws a 400 naming the problem', () => {
    expect(() => assertMediaUrls(HOSTS, [undefined, null, 'https://cdn.example.com/a.jpg'])).not.toThrow();
    expect(() => assertMediaUrls(HOSTS, ['https://evil.example/a.jpg'], 'logo')).toThrowError(/not allowed/);
  });
});

describe('MEDIA_ALLOWED_HOSTS configuration', () => {
  it('parses a list, lower-cases it and removes duplicates', () => {
    expect(parseMediaHosts(' CDN.example.com, *.img.example.org ,cdn.example.com')).toEqual(['cdn.example.com', '*.img.example.org']);
    expect(parseMediaHosts('')).toEqual([]);
    expect(parseMediaHosts(undefined)).toEqual([]);
  });

  it.each(['*', '**', '*.com.', 'localhost', '127.0.0.1', '[::1]', 'https://cdn.example.com', 'cdn.example.com/path', 'a b.example.com', '*.*.example.com', '2130706433'])('rejects the entry %s', (entry) => {
    expect(() => parseMediaHosts(entry)).toThrow();
  });

  it('is read from the environment by loadConfig and defaults to no hosts', () => {
    const base = { DATABASE_URL: 'x', LOG_LEVEL: 'silent' };
    expect(loadConfig({ ...base }).MEDIA_ALLOWED_HOSTS).toEqual([]);
    expect(loadConfig({ ...base, MEDIA_ALLOWED_HOSTS: 'cdn.example.com' }).MEDIA_ALLOWED_HOSTS).toEqual(['cdn.example.com']);
    expect(() => loadConfig({ ...base, MEDIA_ALLOWED_HOSTS: '*' })).toThrow(/MEDIA_ALLOWED_HOSTS/);
  });
});

describe('image address policy on the admin API', () => {
  let ctx: TestContext;
  let alpha: Awaited<ReturnType<typeof seedStore>>;
  let tok: string;
  let productId: string;
  const S = () => `/v1/admin/stores/${alpha.store.id}`;
  const call = (method: 'POST' | 'PATCH' | 'PUT', url: string, payload: unknown) => ctx.app.inject({ method, url, headers: bearer(tok), payload: payload as object });

  beforeAll(async () => {
    ctx = await setupTestApp({ config: { MEDIA_ALLOWED_HOSTS: ['cdn.example.com'] } });
    alpha = await seedStore(ctx.db, 'alpha');
    tok = (await adminToken(ctx, 'owner@example.com', [{ role: 'platform_owner', storeId: null }])).token;
    productId = (await call('POST', `${S()}/products`, { slug: 'kurta', title: 'Kurta' })).json().product.id;
  });
  afterAll(async () => ctx?.close());

  it('stores a product photo on an allowed host', async () => {
    expect((await call('POST', `${S()}/products/${productId}/media`, { url: 'https://cdn.example.com/a.jpg', altText: 'x' })).statusCode).toBe(201);
  });

  it('refuses photos on internal, IP-literal and unlisted hosts and stores nothing', async () => {
    for (const url of ['https://127.0.0.1/a.jpg', 'https://localhost/a.jpg', 'https://169.254.169.254/latest', 'https://evil.example/a.jpg', 'https://u:p@cdn.example.com/a.jpg', 'http://cdn.example.com/a.jpg']) {
      const res = await call('POST', `${S()}/products/${productId}/media`, { url });
      expect(res.statusCode, url).toBe(400);
    }
    const product = (await ctx.app.inject({ method: 'GET', url: `${S()}/products/${productId}`, headers: bearer(tok) })).json();
    expect(product.media).toHaveLength(1);
  });

  it('applies the same policy to the store logo and favicon', async () => {
    const ok = await call('PATCH', S(), { publicSettings: { logoUrl: 'https://cdn.example.com/logo.png' } });
    expect(ok.statusCode).toBe(200);
    for (const publicSettings of [{ logoUrl: 'https://evil.example/logo.png' }, { faviconUrl: 'https://10.0.0.1/f.ico' }]) {
      expect((await call('PATCH', S(), { publicSettings })).statusCode).toBe(400);
    }
  });

  it('validates cards per row, offers and promo notes in the public settings', async () => {
    const good = { layout: { products: { mobile: 2, desktop: 4 }, categories: { mobile: 1, desktop: 6 } }, productOffer: { code: 'SAVE20', text: 'Buy 2, get 20 off' }, productPromo: { title: 'Limited time offer', text: 'Text only' } };
    expect((await call('PATCH', S(), { publicSettings: good })).statusCode).toBe(200);
    for (const layout of [{ products: { mobile: 0, desktop: 4 } }, { products: { mobile: 2, desktop: 7 } }, { categories: { mobile: 2, desktop: 1 } }, { products: { mobile: 1.5, desktop: 4 } }, { cards: 3 }]) {
      expect((await call('PATCH', S(), { publicSettings: { layout } })).statusCode).toBe(400);
    }
    expect((await call('PATCH', S(), { publicSettings: { productOffer: { code: 'bad code!', text: 'x' } } })).statusCode).toBe(400);
  });

  it('applies the same policy to banner and homepage images', async () => {
    const banner = (url: string) => call('PUT', `${S()}/blocks`, { kind: 'banner', key: 'top', status: 'draft', position: 0, data: { image: { url } } });
    expect((await banner('https://cdn.example.com/b.jpg')).statusCode).toBe(200);
    expect((await banner('https://evil.example/b.jpg')).statusCode).toBe(400);
    const section = await call('PUT', `${S()}/blocks`, { kind: 'homepage_section', key: 'hero', status: 'draft', position: 0, data: { layout: 'hero', image: { url: 'https://127.0.0.1/h.jpg' } } });
    expect(section.statusCode).toBe(400);
  });

  it('validates the hero slide mobile image and focal point', async () => {
    const slide = (data: object) => call('PUT', `${S()}/blocks`, { kind: 'homepage_section', key: 'hero-slide-1', status: 'draft', position: 0, data: { layout: 'hero', ...data } });
    const ok = { image: { url: 'https://cdn.example.com/d.jpg', alt: 'd' }, mobileImage: { url: 'https://cdn.example.com/m.jpg', alt: 'm' }, imageFocus: { x: 50, y: 20 } };
    expect((await slide(ok)).statusCode).toBe(200);
    expect((await slide({ image: ok.image })).statusCode).toBe(200);
    expect((await slide({ ...ok, mobileImage: { url: 'https://evil.example/m.jpg' } })).statusCode).toBe(400);
    expect((await slide({ ...ok, mobileImage: { url: 'https://127.0.0.1/m.jpg' } })).statusCode).toBe(400);
    for (const imageFocus of [{ x: -1, y: 0 }, { x: 0, y: 101 }, { x: 'a', y: 0 }, { x: 1 }, { x: 1, y: 1, z: 1 }]) {
      expect((await slide({ ...ok, imageFocus })).statusCode, JSON.stringify(imageFocus)).toBe(400);
    }
  });
});
