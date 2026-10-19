import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { safeEqual } from '../../../lib/crypto.js';

/**
 * Paytm checksum ("signature"), reimplemented from Paytm's published
 * PaytmChecksum library: AES-128-CBC with a fixed IV over
 * `sha256(params + "|" + salt) + salt`, base64-encoded, with a 4-character salt.
 *
 * NOT YET VERIFIED against Paytm staging (no test MID/key available when this
 * was written). Confirm with a staging transaction before relying on it.
 */
const IV = '@@@@&&&&####$$$$';

function encrypt(input: string, key: string): string {
  const cipher = createCipheriv('aes-128-cbc', Buffer.from(key, 'utf8'), Buffer.from(IV, 'utf8'));
  return Buffer.concat([cipher.update(input, 'utf8'), cipher.final()]).toString('base64');
}

function decrypt(encrypted: string, key: string): string {
  const decipher = createDecipheriv('aes-128-cbc', Buffer.from(key, 'utf8'), Buffer.from(IV, 'utf8'));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64')), decipher.final()]).toString('utf8');
}

const hashWithSalt = (params: string, salt: string) => createHash('sha256').update(`${params}|${salt}`).digest('hex') + salt;

export function generateSignature(params: string, key: string, salt = randomBytes(3).toString('base64')): string {
  return encrypt(hashWithSalt(params, salt), key);
}

export function verifySignature(params: string, key: string, signature: string): boolean {
  let decrypted: string;
  try {
    decrypted = decrypt(signature, key);
  } catch {
    return false;
  }
  if (decrypted.length < 5) return false;
  return safeEqual(decrypted, hashWithSalt(params, decrypted.slice(-4)));
}

/** Form parameters as Paytm signs them: sorted by key, values joined by "|", "null" treated as empty. */
export function paramsToString(params: Record<string, string>): string {
  return Object.keys(params)
    .sort()
    .map((k) => {
      const v = params[k] ?? '';
      return v.toLowerCase() === 'null' ? '' : v;
    })
    .join('|');
}
