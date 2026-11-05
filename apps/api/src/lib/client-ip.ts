import { isIP } from 'node:net';
import type { FastifyRequest } from 'fastify';

/** Canonical text for an IP address, or null when `raw` is not one. IPv4-mapped IPv6 (`::ffff:1.2.3.4`) becomes plain IPv4. */
export function normalizeIp(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim().toLowerCase();
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(value);
  const candidate = mapped ? mapped[1]! : value;
  return isIP(candidate) ? candidate : null;
}

/** Bucket used when no valid address can be established. It is shared, so the failure mode is stricter limits, never open ones. */
export const UNKNOWN_CLIENT = 'unknown';

/**
 * The client address for rate limits, OTP records and audit entries.
 *
 * `request.ip` already follows the `TRUST_PROXY` setting (forwarding headers only count when they arrive from a
 * trusted peer), but Fastify passes through whatever text a trusted peer put in the header. This validates it and
 * falls back to the socket address, then to a shared "unknown" bucket.
 */
export function clientIp(request: Pick<FastifyRequest, 'ip' | 'socket'>): string {
  return normalizeIp(request.ip) ?? normalizeIp(request.socket?.remoteAddress) ?? UNKNOWN_CLIENT;
}
