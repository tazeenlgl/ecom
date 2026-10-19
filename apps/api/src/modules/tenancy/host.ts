const HOSTNAME_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/;

/**
 * Normalise a Host header value to the form stored in `store_domains.hostname`:
 * lower-case, without port or trailing dot. Returns null for anything that is
 * not a plain DNS hostname (IP literals, empty values, illegal characters).
 */
export function normalizeHost(raw: string | undefined | null): string | null {
  if (!raw) return null;
  let host = raw.trim().toLowerCase();
  if (host.startsWith('[')) return null; // IPv6 literal
  const colon = host.indexOf(':');
  if (colon !== -1) {
    const port = host.slice(colon + 1);
    if (!/^\d{1,5}$/.test(port)) return null;
    host = host.slice(0, colon);
  }
  if (host.endsWith('.')) host = host.slice(0, -1);
  return HOSTNAME_RE.test(host) ? host : null;
}
