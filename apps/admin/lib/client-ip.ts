import { isIP } from 'node:net';

/**
 * Client IP to forward to the API, derived only through a documented trusted-proxy chain.
 *
 * A browser can send any `X-Forwarded-For` it likes, so the header is never copied as is. This server is told how
 * many trusted reverse proxies sit in front of it (`TRUSTED_PROXY_HOPS`); each of them appends the address of the peer
 * it saw. The client is therefore the entry that many places from the RIGHT. Entries to its left can be spoofed and
 * are ignored. `X-Real-IP` is not read.
 *
 * - hops = 0 (the default): no trusted proxy is configured, so nothing is forwarded and the API uses this server's
 *   own address (a shared, stricter rate-limit bucket: safe, never open).
 * - fewer entries than hops, or a value that is not an IP address: nothing is forwarded.
 */
export function clientIpFromHeaders(headers: { get(name: string): string | null }, hops: number): string | null {
  if (!Number.isInteger(hops) || hops < 1) return null;
  const raw = headers.get('x-forwarded-for');
  if (!raw) return null;
  const entries = raw.split(',').map((e) => e.trim()).filter(Boolean);
  if (entries.length < hops) return null;
  return normalizeIp(entries[entries.length - hops]);
}

/** Canonical IP text, or null when it is not an IP address. IPv4-mapped IPv6 becomes plain IPv4. */
export function normalizeIp(value: string | undefined): string | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(v);
  const candidate = mapped ? mapped[1]! : v;
  return isIP(candidate) ? candidate : null;
}

/** `TRUSTED_PROXY_HOPS` as a whole number from 0 to 8. Anything else counts as 0, so a typo fails safe. */
export function trustedProxyHops(value: string | undefined = process.env.TRUSTED_PROXY_HOPS): number {
  if (!value || !/^\d$/.test(value.trim())) return 0;
  const n = Number(value.trim());
  return n >= 0 && n <= 8 ? n : 0;
}
