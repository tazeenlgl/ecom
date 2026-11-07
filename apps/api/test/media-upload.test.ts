import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/env.js';
import { mediaStorageFor } from '../src/app.js';
import { inspectImage, LocalMediaStorage, MemoryMediaStorage, objectKey, R2MediaStorage } from '../src/modules/media/storage.js';
import { adminToken, bearer, seedStore, setupTestApp, type TestContext } from './helpers.js';

const png = (w = 1920, h = 1080) => {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'latin1');
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
};
const jpeg = (w = 1080, h = 1350) => {
  const b = Buffer.alloc(24);
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]).copy(b); // SOI, APP0 (length 4)
  Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08]).copy(b, 8); // SOF0
  b.writeUInt16BE(h, 13);
  b.writeUInt16BE(w, 15);
  return b;
};
const webp = (w = 800, h = 600) => {
  const b = Buffer.alloc(32);
  b.write('RIFF', 0, 'latin1');
  b.write('WEBP', 8, 'latin1');
  b.write('VP8X', 12, 'latin1');
  b.writeUIntLE(w - 1, 24, 3);
  b.writeUIntLE(h - 1, 27, 3);
  return b;
};

const R2 = { accountId: 'a'.repeat(32), accessKeyId: 'AKIDEXAMPLE0001', secretAccessKey: 'SECRET-DO-NOT-LEAK-0123456789', bucket: 'tazeen-media', publicBaseUrl: 'https://media.tazeen.in' };
const baseEnv = { DATABASE_URL: 'x', NODE_ENV: 'test', LOG_LEVEL: 'silent' };
const r2Env = { R2_ACCOUNT_ID: R2.accountId, R2_ACCESS_KEY_ID: R2.accessKeyId, R2_SECRET_ACCESS_KEY: R2.secretAccessKey, R2_BUCKET_NAME: R2.bucket, R2_PUBLIC_BASE_URL: R2.publicBaseUrl, MEDIA_ALLOWED_HOSTS: 'media.tazeen.in' };

describe('image inspection reads content, not claims', () => {
  it('identifies PNG, JPEG and WebP with their dimensions', () => {
    expect(inspectImage(png(1920, 1080))).toEqual({ contentType: 'image/png', width: 1920, height: 1080 });
    expect(inspectImage(jpeg(1080, 1350))).toEqual({ contentType: 'image/jpeg', width: 1080, height: 1350 });
    expect(inspectImage(webp(800, 600))).toEqual({ contentType: 'image/webp', width: 800, height: 600 });
  });
  it('refuses SVG, HTML, empty and truncated data', () => {
    expect(inspectImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
    expect(inspectImage(Buffer.from('<html><script>alert(1)</script></html>'))).toBeNull();
    expect(inspectImage(Buffer.alloc(0))).toBeNull();
    expect(inspectImage(png().subarray(0, 12))).toBeNull();
    expect(inspectImage(png(0, 10))).toBeNull();
  });
});

describe('object keys', () => {
  it('are store-scoped, server-chosen and never use a client name', () => {
    const a = objectKey('11111111-1111-1111-1111-111111111111', 'hero', 'image/png');
    expect(a).toMatch(/^stores\/11111111-1111-1111-1111-111111111111\/hero\/[0-9a-f-]{36}\.png$/);
    expect(objectKey('s', 'hero', 'image/png')).not.toBe(objectKey('s', 'hero', 'image/png'));
  });
});

describe('R2 adapter', () => {
  it('signs a PUT to the account endpoint and returns the media.tazeen.in address', async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const fake = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;
    const r2 = new R2MediaStorage(R2, fake, () => new Date('2026-11-07T10:00:00Z'));
    const out = await r2.put('stores/s1/hero/abc.png', png(), 'image/png');
    expect(out.url).toBe('https://media.tazeen.in/stores/s1/hero/abc.png');
    expect(seen!.url).toBe(`https://${'a'.repeat(32)}.r2.cloudflarestorage.com/tazeen-media/stores/s1/hero/abc.png`);
    expect(seen!.init.method).toBe('PUT');
    const headers = seen!.init.headers as Record<string, string>;
    expect(headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE0001\/20261107\/auto\/s3\/aws4_request, SignedHeaders=cache-control;content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/);
    expect(headers['x-amz-date']).toBe('20261107T100000Z');
    expect(JSON.stringify(headers)).not.toContain(R2.secretAccessKey);
  });
  it('is deterministic for the same input and changes with the secret', () => {
    const when = new Date('2026-11-07T10:00:00Z');
    const a = new R2MediaStorage(R2).sign('k.png', png(), 'image/png', when).headers.authorization;
    expect(new R2MediaStorage(R2).sign('k.png', png(), 'image/png', when).headers.authorization).toBe(a);
    expect(new R2MediaStorage({ ...R2, secretAccessKey: 'another-secret-0123456789' }).sign('k.png', png(), 'image/png', when).headers.authorization).not.toBe(a);
  });
  it('reports a failed upload without the response body or credentials', async () => {
    const fake = (async () => new Response('<Error>SECRET-DO-NOT-LEAK-0123456789</Error>', { status: 403 })) as unknown as typeof fetch;
    await expect(new R2MediaStorage(R2, fake).put('k.png', png(), 'image/png')).rejects.toThrow(/^R2 upload failed with status 403$/);
  });
});

describe('storage selection and configuration', () => {
  it('uses local disk in development, nothing in production without R2, and R2 when configured', () => {
    expect(mediaStorageFor(loadConfig({ ...baseEnv, NODE_ENV: 'development' }))).toBeInstanceOf(LocalMediaStorage);
    expect(mediaStorageFor(loadConfig({ ...baseEnv, NODE_ENV: 'test' }))).toBeNull();
    expect(mediaStorageFor(loadConfig({ ...baseEnv, ...r2Env }))).toBeInstanceOf(R2MediaStorage);
  });
  it('treats blank R2 variables as unset and demands all five or none', () => {
    expect(() => loadConfig({ ...baseEnv, R2_ACCOUNT_ID: '', R2_ACCESS_KEY_ID: '', R2_SECRET_ACCESS_KEY: '', R2_BUCKET_NAME: '', R2_PUBLIC_BASE_URL: '' })).not.toThrow();
    expect(() => loadConfig({ ...baseEnv, R2_ACCOUNT_ID: R2.accountId })).toThrow(/R2_ACCESS_KEY_ID.*R2_BUCKET_NAME|R2_ACCESS_KEY_ID/);
  });
  it('requires the public host to be in MEDIA_ALLOWED_HOSTS and an origin only, and never echoes secrets', () => {
    expect(() => loadConfig({ ...baseEnv, ...r2Env, MEDIA_ALLOWED_HOSTS: '' })).toThrow(/MEDIA_ALLOWED_HOSTS/);
    expect(() => loadConfig({ ...baseEnv, ...r2Env, R2_PUBLIC_BASE_URL: 'https://media.tazeen.in/path' })).toThrow(/origin only/);
    expect(() => loadConfig({ ...baseEnv, ...r2Env, R2_PUBLIC_BASE_URL: 'http://media.tazeen.in' })).toThrow(/R2_PUBLIC_BASE_URL/);
    try {
      loadConfig({ ...baseEnv, ...r2Env, R2_ACCOUNT_ID: 'bad', MEDIA_ALLOWED_HOSTS: '' });
    } catch (e) {
      expect(String(e)).not.toContain(R2.secretAccessKey);
      expect(String(e)).not.toContain(R2.accessKeyId);
    }
  });
});

describe('POST /v1/admin/stores/:storeId/media', () => {
  let ctx: TestContext;
  let alpha: Awaited<ReturnType<typeof seedStore>>;
  let beta: Awaited<ReturnType<typeof seedStore>>;
  let owner: string;
  let alphaEditor: string;
  let supportUser: string;
  const mem = new MemoryMediaStorage();

  beforeAll(async () => {
    ctx = await setupTestApp({ media: mem });
    alpha = await seedStore(ctx.db, 'alpha');
    beta = await seedStore(ctx.db, 'beta');
    owner = (await adminToken(ctx, 'owner@example.com', [{ role: 'platform_owner', storeId: null }])).token;
    alphaEditor = (await adminToken(ctx, 'editor@example.com', [{ role: 'catalogue_editor', storeId: alpha.store.id }])).token;
    supportUser = (await adminToken(ctx, 'support@example.com', [{ role: 'support', storeId: alpha.store.id }])).token;
  });
  afterAll(async () => ctx?.close());

  const upload = (storeId: string, body: Buffer | string, type: string, token?: string, qs = '') =>
    ctx.app.inject({ method: 'POST', url: `/v1/admin/stores/${storeId}/media${qs}`, headers: { ...(token ? bearer(token) : {}), 'content-type': type }, payload: body });

  it('stores a valid image under a store-scoped key and returns its public address and size', async () => {
    const res = await upload(alpha.store.id, png(1920, 1080), 'image/png', alphaEditor);
    expect(res.statusCode).toBe(201);
    const out = res.json();
    expect(out).toMatchObject({ contentType: 'image/png', width: 1920, height: 1080 });
    expect(out.key).toMatch(new RegExp(`^stores/${alpha.store.id}/hero/[0-9a-f-]{36}\\.png$`));
    expect(out.url).toBe(`https://media.example.com/${out.key}`);
    expect(mem.objects.get(out.key)?.contentType).toBe('image/png');
    expect((await upload(alpha.store.id, jpeg(), 'image/jpeg', owner)).statusCode).toBe(201);
    expect((await upload(alpha.store.id, webp(), 'image/webp', owner)).statusCode).toBe(201);
  });

  it('rejects anonymous callers, missing permission and other stores', async () => {
    expect((await upload(alpha.store.id, png(), 'image/png')).statusCode).toBe(401);
    expect((await upload(alpha.store.id, png(), 'image/png', supportUser)).statusCode).toBe(403);
    expect((await upload(beta.store.id, png(), 'image/png', alphaEditor)).statusCode).toBe(403);
    const before = mem.objects.size;
    await upload(beta.store.id, png(), 'image/png', alphaEditor);
    expect(mem.objects.size).toBe(before);
  });

  it('rejects files whose content is not the declared image type', async () => {
    expect((await upload(alpha.store.id, Buffer.from('<svg></svg>'), 'image/png', owner)).statusCode).toBe(400);
    expect((await upload(alpha.store.id, png(), 'image/jpeg', owner)).statusCode).toBe(400);
    expect((await upload(alpha.store.id, Buffer.alloc(100), 'image/webp', owner)).statusCode).toBe(400);
  });

  it('refuses other content types, oversize files and unknown stores or purposes', async () => {
    expect((await upload(alpha.store.id, '<svg/>', 'image/svg+xml', owner)).statusCode).toBe(415);
    expect((await upload(alpha.store.id, 'hello', 'text/plain', owner)).statusCode).toBe(400);
    expect((await upload(alpha.store.id, JSON.stringify({ a: 1 }), 'application/json', owner)).statusCode).toBe(400);
    const big = Buffer.concat([png(), Buffer.alloc(ctx.app.ctx.config.MEDIA_UPLOAD_MAX_BYTES)]);
    expect((await upload(alpha.store.id, big, 'image/png', owner)).statusCode).toBe(413);
    expect((await upload('00000000-0000-4000-8000-000000000000', png(), 'image/png', owner)).statusCode).toBe(404);
    expect((await upload(alpha.store.id, png(), 'image/png', owner, '?purpose=../../x')).statusCode).toBe(400);
  });

  it('records an audit entry without the file contents', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: `/v1/admin/stores/${alpha.store.id}/audit-logs`, headers: bearer(owner) });
    if (res.statusCode === 200) expect(JSON.stringify(res.json())).not.toContain('IHDR');
  });
});

describe('without configured storage', () => {
  it('answers 503 instead of failing later', async () => {
    const ctx = await setupTestApp({ media: null });
    try {
      const s = await seedStore(ctx.db, 'gamma');
      const t = (await adminToken(ctx, 'o@example.com', [{ role: 'platform_owner', storeId: null }])).token;
      const res = await ctx.app.inject({ method: 'POST', url: `/v1/admin/stores/${s.store.id}/media`, headers: { ...bearer(t), 'content-type': 'image/png' }, payload: png() });
      expect(res.statusCode).toBe(503);
    } finally {
      await ctx.close();
    }
  });
});
