import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkMediaUrl } from '../src/lib/media-url.js';
import { LOCAL_MEDIA_HOST, LocalMediaStorage, MemoryMediaStorage } from '../src/modules/media/storage.js';
import { adminToken, bearer, seedStore, setupTestApp, type TestContext } from './helpers.js';

/** The Admin homepage hero workflow, end to end through the API: upload, draft, publish, replace, remove, disable. */
const png = (w: number, h: number) => {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'latin1');
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
};

let ctx: TestContext;
let alpha: Awaited<ReturnType<typeof seedStore>>;
let beta: Awaited<ReturnType<typeof seedStore>>;
let alphaEditor: string;
let betaEditor: string;
const mem = new MemoryMediaStorage();

const upload = async (storeId: string, token: string, w = 1920, h = 1080) => {
  const res = await ctx.app.inject({ method: 'POST', url: `/v1/admin/stores/${storeId}/media?purpose=hero`, headers: { ...bearer(token), 'content-type': 'image/png' }, payload: png(w, h) });
  expect(res.statusCode).toBe(201);
  return res.json() as { url: string; key: string };
};
const saveSlide = (storeId: string, token: string, n: number, status: 'draft' | 'published', data: object, position = n) =>
  ctx.app.inject({ method: 'PUT', url: `/v1/admin/stores/${storeId}/blocks`, headers: bearer(token), payload: { kind: 'homepage_section', key: `hero-slide-${n}`, title: `Hero slide ${n}`, status, position, data: { layout: 'hero', ...data } } });
const publicSlides = async (host: string) => {
  const res = await ctx.app.inject({ method: 'GET', url: '/v1/storefront/content/blocks?kind=homepage_section', headers: { host } });
  expect(res.statusCode).toBe(200);
  return res.json().items as { key: string; data: { image?: { url: string }; mobileImage?: { url: string }; imageFocus?: { x: number; y: number }; heading?: string } }[];
};

beforeAll(async () => {
  ctx = await setupTestApp({ media: mem, config: { MEDIA_ALLOWED_HOSTS: ['media.example.com'] } });
  alpha = await seedStore(ctx.db, 'alpha');
  beta = await seedStore(ctx.db, 'beta');
  alphaEditor = (await adminToken(ctx, 'a@example.com', [{ role: 'catalogue_editor', storeId: alpha.store.id }])).token;
  betaEditor = (await adminToken(ctx, 'b@example.com', [{ role: 'catalogue_editor', storeId: beta.store.id }])).token;
});
afterAll(async () => ctx?.close());

describe('hero slide workflow', () => {
  const urls: Record<string, string> = {};

  it('saves uploaded images as drafts, and drafts are not public', async () => {
    for (const n of [1, 2, 3]) {
      const d = await upload(alpha.store.id, alphaEditor);
      const m = await upload(alpha.store.id, alphaEditor, 1080, 1350);
      urls[`d${n}`] = d.url;
      urls[`m${n}`] = m.url;
      const res = await saveSlide(alpha.store.id, alphaEditor, n, 'draft', { heading: `Slide ${n}`, image: { url: d.url, alt: `d${n}` }, mobileImage: { url: m.url, alt: `m${n}` }, imageFocus: { x: 10 * n, y: 25 }, link: { label: 'Go', href: '/shop' } });
      expect(res.statusCode).toBe(200);
    }
    expect(await publicSlides(alpha.host)).toEqual([]);
    const admin = await ctx.app.inject({ method: 'GET', url: `/v1/admin/stores/${alpha.store.id}/blocks`, headers: bearer(alphaEditor) });
    expect(admin.json().items.filter((b: { key: string }) => b.key.startsWith('hero-slide-'))).toHaveLength(3);
  });

  it('publishes in position order with mobile image and focus intact', async () => {
    await saveSlide(alpha.store.id, alphaEditor, 1, 'published', { heading: 'Slide 1', image: { url: urls.d1!, alt: 'd1' }, mobileImage: { url: urls.m1!, alt: 'm1' }, imageFocus: { x: 10, y: 25 } }, 3);
    await saveSlide(alpha.store.id, alphaEditor, 2, 'published', { heading: 'Slide 2', image: { url: urls.d2!, alt: 'd2' }, mobileImage: { url: urls.m2!, alt: 'm2' }, imageFocus: { x: 20, y: 25 } }, 1);
    await saveSlide(alpha.store.id, alphaEditor, 3, 'published', { heading: 'Slide 3', image: { url: urls.d3!, alt: 'd3' }, imageFocus: { x: 30, y: 25 } }, 2);
    const slides = await publicSlides(alpha.host);
    expect(slides.map((s) => s.key)).toEqual(['hero-slide-2', 'hero-slide-3', 'hero-slide-1']);
    expect(slides[0]!.data).toMatchObject({ image: { url: urls.d2 }, mobileImage: { url: urls.m2 }, imageFocus: { x: 20, y: 25 } });
    expect(slides[1]!.data.mobileImage).toBeUndefined(); // no mobile image: the storefront falls back to the desktop image
  });

  it('replaces a desktop and a mobile image; the replacement is public and the old files are never deleted', async () => {
    const newDesktop = await upload(alpha.store.id, alphaEditor);
    const newMobile = await upload(alpha.store.id, alphaEditor, 1080, 1350);
    expect(newDesktop.url).not.toBe(urls.d2);
    const res = await saveSlide(alpha.store.id, alphaEditor, 2, 'published', { heading: 'Slide 2', image: { url: newDesktop.url, alt: 'new d2' }, mobileImage: { url: newMobile.url, alt: 'new m2' }, imageFocus: { x: 20, y: 25 } }, 1);
    expect(res.statusCode).toBe(200);
    const s2 = (await publicSlides(alpha.host)).find((s) => s.key === 'hero-slide-2')!;
    expect(s2.data.image?.url).toBe(newDesktop.url);
    expect(s2.data.mobileImage?.url).toBe(newMobile.url);
    // Nothing removes stored files: replacing only changes which address the block points at.
    const oldKey = new URL(urls.d2!).pathname.slice(1);
    expect(mem.objects.has(oldKey)).toBe(true);
  });

  it('removes a mobile image (omitted from the block) and disables a slide (draft)', async () => {
    await saveSlide(alpha.store.id, alphaEditor, 1, 'published', { heading: 'Slide 1', image: { url: urls.d1!, alt: 'd1' } }, 3);
    expect((await publicSlides(alpha.host)).find((s) => s.key === 'hero-slide-1')!.data.mobileImage).toBeUndefined();
    await saveSlide(alpha.store.id, alphaEditor, 3, 'draft', { heading: 'Slide 3', image: { url: urls.d3!, alt: 'd3' } }, 2);
    expect((await publicSlides(alpha.host)).map((s) => s.key)).toEqual(['hero-slide-2', 'hero-slide-1']);
    await saveSlide(alpha.store.id, alphaEditor, 3, 'published', { heading: 'Slide 3', image: { url: urls.d3!, alt: 'd3' } }, 2);
    expect((await publicSlides(alpha.host)).map((s) => s.key)).toEqual(['hero-slide-2', 'hero-slide-3', 'hero-slide-1']);
  });

  it('keeps stores apart: no leakage, no cross-store writes or uploads', async () => {
    expect(await publicSlides(beta.host)).toEqual([]);
    expect((await saveSlide(alpha.store.id, betaEditor, 1, 'published', { heading: 'x', image: { url: urls.d1!, alt: 'x' } })).statusCode).toBe(403);
    const cross = await ctx.app.inject({ method: 'POST', url: `/v1/admin/stores/${alpha.store.id}/media`, headers: { ...bearer(betaEditor), 'content-type': 'image/png' }, payload: png(10, 10) });
    expect(cross.statusCode).toBe(403);
    const betaList = await ctx.app.inject({ method: 'GET', url: `/v1/admin/stores/${beta.store.id}/blocks`, headers: bearer(betaEditor) });
    expect(betaList.json().items).toEqual([]);
  });

  it('refuses images that are not on an allowed host, including the local pseudo host unless it is listed', async () => {
    for (const url of ['https://evil.example/a.png', `https://${LOCAL_MEDIA_HOST}/stores/s/hero/a.png`, 'http://media.example.com/a.png', '/photos/a.jpg']) {
      expect((await saveSlide(alpha.store.id, alphaEditor, 1, 'draft', { image: { url, alt: 'x' } })).statusCode, url).toBe(400);
      expect((await saveSlide(alpha.store.id, alphaEditor, 1, 'draft', { image: { url: urls.d1!, alt: 'x' }, mobileImage: { url } })).statusCode, `mobile ${url}`).toBe(400);
    }
    expect(checkMediaUrl(`https://${LOCAL_MEDIA_HOST}/stores/s/hero/a.png`, [LOCAL_MEDIA_HOST]).ok).toBe(true);
  });

  it('documents the upload body as binary images, not JSON', async () => {
    const spec = (await ctx.app.inject({ method: 'GET', url: '/v1/openapi.json' })).json();
    const body = spec.paths['/v1/admin/stores/{storeId}/media'].post.requestBody.content;
    expect(Object.keys(body).sort()).toEqual(['image/jpeg', 'image/png', 'image/webp']);
    expect(body['image/png'].schema).toEqual({ type: 'string', format: 'binary' });
  });
});

describe('local development storage', () => {
  it('stores under a safe path, addresses files on the pseudo host and refuses traversal', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'tazeen-media-'));
    try {
      const local = new LocalMediaStorage(dir);
      const { url } = await local.put('stores/s1/hero/a.png', png(5, 5));
      expect(url).toBe(`https://${LOCAL_MEDIA_HOST}/stores/s1/hero/a.png`);
      expect((await local.read('stores/s1/hero/a.png'))?.length).toBe(33);
      expect(await local.read('stores/s1/hero/missing.png')).toBeNull();
      await expect(local.put('../escape.png', png(5, 5))).rejects.toThrow();
      expect(await local.read('../../etc/passwd')).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
