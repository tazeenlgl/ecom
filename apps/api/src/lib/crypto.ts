import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/** A random bearer token (256 bits). Only its SHA-256 is stored. */
export const newToken = (): string => randomBytes(32).toString('base64url');

export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

export const hmacSha256 = (secret: string, value: string): string =>
  createHmac('sha256', secret).update(value).digest('hex');

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** A numeric one-time code with `digits` digits, from a CSPRNG. */
export const newOtpCode = (digits = 6): string => randomInt(0, 10 ** digits).toString().padStart(digits, '0');

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

/** Format: scrypt$N$r$p$salt$hash (base64url). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, SCRYPT.keylen, { ...SCRYPT, maxmem: 64 * 1024 * 1024 });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64url'), key.toString('base64url')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, n, r, p, salt, hash] = stored.split('$');
  if (algo !== 'scrypt' || !n || !r || !p || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const key = await scryptAsync(password, Buffer.from(salt, 'base64url'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: 64 * 1024 * 1024,
  });
  return timingSafeEqual(key, expected);
}

/** Used to equalise timing when an account does not exist. */
export const DUMMY_PASSWORD_HASH =
  'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$' + Buffer.alloc(64).toString('base64url');

/**
 * Encrypts a stored secret (e.g. a gateway merchant key) with AES-256-GCM.
 * Format: `v1.<iv>.<tag>.<ciphertext>` (base64url). `keyBase64` is CONFIG_ENCRYPTION_KEY.
 */
export function encryptSecret(keyBase64: string, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(keyBase64, 'base64'), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.');
}

export function decryptSecret(keyBase64: string, stored: string): string {
  const [version, iv, tag, ciphertext] = stored.split('.');
  if (version !== 'v1' || !iv || !tag || ciphertext === undefined) throw new Error('Unrecognised encrypted secret');
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(keyBase64, 'base64'), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8');
}
