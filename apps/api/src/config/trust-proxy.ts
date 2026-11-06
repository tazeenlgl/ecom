import { isIP } from 'node:net';

/**
 * What Fastify is told about reverse proxies (its `trustProxy` option):
 * - `false`: trust nobody. `request.ip` is the socket address and `X-Forwarded-*` headers are ignored.
 * - `true`: trust EVERY peer. The leftmost `X-Forwarded-For` value, which any caller can choose, becomes the client IP,
 *   and any caller can pick the store through `X-Forwarded-Host`. Local development only; refused in production.
 * - a number: trust that many hops from the socket.
 * - a list of IPs, CIDR ranges or the keywords `loopback`, `linklocal`, `uniquelocal`: trust only peers inside
 *   the list. The client is the first address, walking right to left, that is NOT in the list, so spoofed values
 *   placed in front of the real proxy chain are ignored.
 */
export type TrustProxySetting = boolean | number | string[];

const KEYWORDS = new Set(['loopback', 'linklocal', 'uniquelocal']);
const MAX_HOPS = 8;

function validEntry(entry: string): boolean {
  if (KEYWORDS.has(entry)) return true;
  if (isIP(entry)) return true;
  const m = /^([^/]+)\/(\d{1,3})$/.exec(entry);
  if (!m) return false;
  const family = isIP(m[1]!);
  return family !== 0 && Number(m[2]) <= (family === 4 ? 32 : 128);
}

/** The value handed to Fastify. A hop count becomes a function (hop 0 is the socket peer) because Fastify's typings omit numbers. */
export function toFastifyTrustProxy(setting: TrustProxySetting): boolean | string[] | ((address: string, hop: number) => boolean) {
  return typeof setting === 'number' ? (_address, hop) => hop < setting : setting;
}

/** Parses the `TRUST_PROXY` environment value. Throws a message that never echoes the value back as a secret (it is not one). */
export function parseTrustProxy(raw: string | undefined): TrustProxySetting {
  const value = (raw ?? '').trim();
  if (value === '' || value.toLowerCase() === 'false') return false;
  if (value.toLowerCase() === 'true') return true;
  if (/^\d+$/.test(value)) {
    const hops = Number(value);
    if (hops === 0) return false;
    if (hops > MAX_HOPS) throw new Error(`a hop count must be between 1 and ${MAX_HOPS}`);
    return hops;
  }
  const entries = value.split(',').map((e) => e.trim()).filter(Boolean);
  if (entries.length === 0 || !entries.every(validEntry)) {
    throw new Error('use "false", "true" (development only), a hop count, or a comma-separated list of IPs, CIDR ranges, "loopback", "linklocal" or "uniquelocal"');
  }
  return entries;
}
