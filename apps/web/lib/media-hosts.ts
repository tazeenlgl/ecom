/**
 * Which hosts the storefront may load product images from through its own image optimizer. The same
 * MEDIA_ALLOWED_HOSTS variable is read by the API, which refuses new image addresses on other hosts. This is a
 * mirror of apps/api/src/lib/media-url.ts (same rules); test/media-hosts.test.ts checks the two agree.
 *
 * Entries: exact host names or `*.host`, which matches exactly one extra label.
 */

const LABEL = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)$/;

function isHostName(host: string): boolean {
  if (host.length > 253 || !host.includes('.')) return false;
  const labels = host.split('.');
  if (/^(?:\d+|0x[0-9a-f]+)$/i.test(labels[labels.length - 1]!)) return false;
  return labels.every((l) => LABEL.test(l));
}

/** Parses the variable. Invalid entries are dropped (never widened) so a typo cannot open the optimizer up. */
export function parseMediaHosts(raw: string | undefined): string[] {
  const entries = (raw ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return [...new Set(entries.filter((entry) => isHostName(entry.startsWith('*.') ? entry.slice(2) : entry)))];
}

const matches = (hosts: readonly string[], hostname: string) =>
  hosts.some((h) => {
    if (!h.startsWith('*.')) return hostname === h;
    const suffix = h.slice(1);
    return hostname.length > suffix.length && hostname.endsWith(suffix) && !hostname.slice(0, -suffix.length).includes('.');
  });

/** True only for an https address on an allowed host with no credentials, odd port, fragment or IP-literal host. */
export function isAllowedMediaUrl(raw: string | null | undefined, hosts: readonly string[]): boolean {
  if (!raw || raw.length > 1000 || /[\u0000- \u007f\\]/.test(raw)) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) return false;
  if (url.port && url.port !== '443') return false;
  return !url.hostname.endsWith('.') && !url.hostname.startsWith('[') && isHostName(url.hostname) && matches(hosts, url.hostname);
}

/** `remotePatterns` for next.config: one entry per allowed host, https and the default port only. Empty list, no remote fetches. */
export const remotePatternsFor = (hosts: readonly string[]) => hosts.map((hostname) => ({ protocol: 'https' as const, hostname, port: '' }));

/** Pseudo host of development uploads (same constant as the API's local storage). Resolves nowhere; see localMediaPath. */
export const LOCAL_MEDIA_HOST = 'local-media.test';

/** https://local-media.test/<key> is served by the API at /v1/media/<key>; the development server rewrites /dev-media/* there. */
export function localMediaPath(src: string): string | null {
  try {
    const url = new URL(src);
    if (url.protocol === 'https:' && url.hostname === LOCAL_MEDIA_HOST && !url.username && !url.password) return `/dev-media${url.pathname}`;
  } catch {
    // not an absolute address
  }
  return null;
}
