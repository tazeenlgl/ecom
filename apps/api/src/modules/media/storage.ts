import { createHash, createHmac, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Where uploaded images live. Files are never stored in the database; blocks and products keep only the public address. */
export interface MediaStorage {
  readonly kind: 'local' | 'r2' | 'memory';
  /** Stores `body` under `key` and returns the public https address (local development returns an http address). */
  put(key: string, body: Buffer, contentType: string): Promise<{ url: string }>;
}

export const IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' } as const;
export type ImageType = keyof typeof IMAGE_TYPES;

export type ImageInfo = { contentType: ImageType; width: number; height: number };

/**
 * Identifies an image by its content, never by what the client claims. Returns null for anything that is not a
 * well-formed JPEG, PNG or WebP with readable dimensions (SVG and everything else are refused).
 */
export function inspectImage(b: Buffer): ImageInfo | null {
  if (b.length > 24 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) && b.toString('latin1', 12, 16) === 'IHDR') {
    return dims('image/png', b.readUInt32BE(16), b.readUInt32BE(20));
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1]!;
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
        i += 2;
        continue;
      }
      const len = b.readUInt16BE(i + 2);
      if (len < 2) return null;
      if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
        return dims('image/jpeg', b.readUInt16BE(i + 7), b.readUInt16BE(i + 5));
      }
      i += 2 + len;
    }
    return null;
  }
  if (b.length > 30 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') {
    const chunk = b.toString('latin1', 12, 16);
    if (chunk === 'VP8X') return dims('image/webp', 1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3));
    if (chunk === 'VP8 ' && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) return dims('image/webp', b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff);
    if (chunk === 'VP8L' && b[20] === 0x2f) {
      const v = b.readUInt32LE(21);
      return dims('image/webp', (v & 0x3fff) + 1, ((v >> 14) & 0x3fff) + 1);
    }
  }
  return null;
}

const dims = (contentType: ImageType, width: number, height: number): ImageInfo | null => (width > 0 && height > 0 && width <= 20000 && height <= 20000 ? { contentType, width, height } : null);

/** Server-chosen, store-scoped, unguessable name. The client's file name is never used. */
export const objectKey = (storeId: string, purpose: string, type: ImageType): string => `stores/${storeId}/${purpose}/${randomUUID()}.${IMAGE_TYPES[type]}`;

const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const hmac = (key: string | Buffer, data: string) => createHmac('sha256', key).update(data).digest();
const encodeKey = (key: string) => key.split('/').map((s) => encodeURIComponent(s)).join('/');

export type R2Settings = { accountId: string; accessKeyId: string; secretAccessKey: string; bucket: string; publicBaseUrl: string };

/** Cloudflare R2 through its S3-compatible API (AWS Signature V4, region "auto"). Credentials never leave this object. */
export class R2MediaStorage implements MediaStorage {
  readonly kind = 'r2' as const;
  private readonly host: string;

  constructor(
    private readonly s: R2Settings,
    private readonly fetchFn: typeof fetch = globalThis.fetch,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.host = `${s.accountId}.r2.cloudflarestorage.com`;
  }

  /** The signed request, exposed for tests (no secret is returned). */
  sign(key: string, body: Buffer, contentType: string, date: Date): { url: string; headers: Record<string, string> } {
    const amzDate = date.toISOString().replace(/[-:]|\.\d{3}/g, '');
    const day = amzDate.slice(0, 8);
    const payloadHash = sha256(body);
    const canonicalUri = `/${this.s.bucket}/${encodeKey(key)}`;
    const headers: Record<string, string> = { 'cache-control': 'public, max-age=31536000, immutable', 'content-type': contentType, host: this.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
    const names = Object.keys(headers).sort();
    const canonicalHeaders = names.map((n) => `${n}:${headers[n]}\n`).join('');
    const signedHeaders = names.join(';');
    const canonical = ['PUT', canonicalUri, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
    const scope = `${day}/auto/s3/aws4_request`;
    const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
    const signingKey = hmac(hmac(hmac(hmac(`AWS4${this.s.secretAccessKey}`, day), 'auto'), 's3'), 'aws4_request');
    const signature = createHmac('sha256', signingKey).update(toSign).digest('hex');
    const authorization = `AWS4-HMAC-SHA256 Credential=${this.s.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    return { url: `https://${this.host}${canonicalUri}`, headers: { ...headers, authorization } };
  }

  async put(key: string, body: Buffer, contentType: string) {
    const { url, headers } = this.sign(key, body, contentType, this.now());
    const { host: _host, ...sendHeaders } = headers; // fetch sets Host itself
    // Provider errors are reported without the response body, which could echo request details.
    const res = await this.fetchFn(url, { method: 'PUT', headers: sendHeaders, body: new Uint8Array(body), signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`R2 upload failed with status ${res.status}`);
    return { url: `${this.s.publicBaseUrl.replace(/\/$/, '')}/${encodeKey(key)}` };
  }
}

/**
 * Pseudo host for development uploads. It is a reserved .test name that resolves nowhere: the API serves the files at
 * /v1/media/* and the storefront and Admin map this host to that path (see their image helpers). To save these addresses
 * in blocks, list it in MEDIA_ALLOWED_HOSTS like any other media host; the normal validation still applies.
 */
export const LOCAL_MEDIA_HOST = 'local-media.test';

/** Development storage on local disk, addressed as https://local-media.test/<key>. */
export class LocalMediaStorage implements MediaStorage {
  readonly kind = 'local' as const;
  constructor(private readonly dir: string) {}

  async put(key: string, body: Buffer) {
    const file = this.resolve(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, body);
    return { url: `https://${LOCAL_MEDIA_HOST}/${encodeKey(key)}` };
  }

  async read(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.resolve(key));
    } catch {
      return null;
    }
  }

  private resolve(key: string): string {
    const root = path.resolve(this.dir);
    const file = path.resolve(root, key);
    if (!file.startsWith(root + path.sep)) throw new Error('invalid media key');
    return file;
  }
}

/** In-memory storage for tests. */
export class MemoryMediaStorage implements MediaStorage {
  readonly kind = 'memory' as const;
  readonly objects = new Map<string, { body: Buffer; contentType: string }>();
  async put(key: string, body: Buffer, contentType: string) {
    this.objects.set(key, { body, contentType });
    return { url: `https://media.example.com/${key}` };
  }
}
