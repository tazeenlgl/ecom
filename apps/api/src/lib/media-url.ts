import { AppError } from './errors.js';

/**
 * Policy for image addresses that staff enter (product photos, store logo, banners). Only https addresses on an
 * explicit host allow-list (MEDIA_ALLOWED_HOSTS) are accepted, so an address can never point the storefront's image
 * optimizer at an internal service or an arbitrary third party. Mirror: apps/web/lib/media-hosts.ts (same rules, same table test).
 *
 * Entries are exact host names (`cdn.example.com`) or `*.example.com`, which matches exactly one extra label
 * (`a.example.com`, not `a.b.example.com` and not `example.com`).
 */

const LABEL = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)$/;

function isHostName(host: string): boolean {
  if (host.length > 253 || !host.includes('.')) return false;
  const labels = host.split('.');
  // A numeric last label would make this an IPv4 literal in some notations (127.1, 0x7f.1, 2130706433).
  if (/^(?:\d+|0x[0-9a-f]+)$/i.test(labels[labels.length - 1]!)) return false;
  return labels.every((l) => LABEL.test(l));
}

/** Parses the configuration value. Throws on an entry that is not a plain host name or `*.host` pattern. */
export function parseMediaHosts(raw: string | undefined): string[] {
  const entries = (raw ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  for (const entry of entries) {
    const host = entry.startsWith('*.') ? entry.slice(2) : entry;
    if (!isHostName(host)) throw new Error(`"${entry}" is not a host name or a "*.host" pattern`);
  }
  return [...new Set(entries)];
}

export const isAllowedMediaHost = (hosts: readonly string[], hostname: string) => matches(hosts, hostname);

const matches = (hosts: readonly string[], hostname: string) =>
  hosts.some((h) => {
    if (!h.startsWith('*.')) return hostname === h;
    const suffix = h.slice(1); // ".example.com"
    return hostname.length > suffix.length && hostname.endsWith(suffix) && !hostname.slice(0, -suffix.length).includes('.');
  });

export type MediaUrlCheck = { ok: true; url: string } | { ok: false; reason: string };

/** Validates and normalises one address. Never resolves DNS; trusts only the allow-listed names. */
export function checkMediaUrl(raw: string, hosts: readonly string[]): MediaUrlCheck {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 1000) return { ok: false, reason: 'must be 1 to 1000 characters' };
  // Control characters, whitespace and backslashes make parsers disagree about the host.
  if (/[\u0000- \u007f\\]/.test(raw)) return { ok: false, reason: 'contains spaces, control characters or backslashes' };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'is not a valid address' };
  }
  if (url.protocol !== 'https:') return { ok: false, reason: 'must start with https://' };
  if (url.username || url.password) return { ok: false, reason: 'must not contain a user name or password' };
  if (url.port && url.port !== '443') return { ok: false, reason: 'must use the default port' };
  if (url.hash) return { ok: false, reason: 'must not contain a fragment' };
  // URL has already lower-cased the host and converted internationalised names to punycode.
  const hostname = url.hostname;
  if (hostname.endsWith('.') || hostname.startsWith('[') || !isHostName(hostname)) return { ok: false, reason: 'must use a host name, not an IP address or a local name' };
  if (!matches(hosts, hostname)) return { ok: false, reason: `host ${hostname} is not allowed (ask an administrator to add it to MEDIA_ALLOWED_HOSTS)` };
  url.port = '';
  return { ok: true, url: url.toString() };
}

/** Throws a 400 for the first address that fails the policy. `field` names it in the message. */
export function assertMediaUrls(hosts: readonly string[], urls: (string | undefined | null)[], field = 'url'): void {
  for (const raw of urls) {
    if (!raw) continue;
    const result = checkMediaUrl(raw, hosts);
    if (!result.ok) throw new AppError(400, 'invalid_request', `Image address ${result.reason}.`, [`${field}: ${result.reason}`]);
  }
}
