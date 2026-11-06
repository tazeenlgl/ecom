export const SESSION_COOKIE = 'ecom_admin_session';
export const CSRF_COOKIE = 'ecom_admin_csrf';
export const CSRF_HEADER = 'x-csrf-token';

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Double-submit CSRF check for state-changing requests: the header must equal the cookie, and a browser-supplied
 * Origin (when present) must be this site. Safe methods pass.
 */
export function csrfOk(input: { method: string; origin: string | null; host: string | null; header: string | null; cookie: string | null }): boolean {
  if (SAFE_METHODS.has(input.method.toUpperCase())) return true;
  if (input.origin) {
    try {
      if (new URL(input.origin).host !== input.host) return false;
    } catch {
      return false;
    }
  }
  if (!input.header || !input.cookie || input.cookie.length < 16) return false;
  return safeEqual(input.header, input.cookie);
}

/** Path segments the BFF will forward: plain ids and slugs only, never traversal, and never the auth endpoints (they have their own routes). */
export function safeProxyPath(segments: string[]): string | null {
  if (segments.length === 0 || segments.length > 8) return null;
  if (!segments.every((s) => /^[A-Za-z0-9_.:-]+$/.test(s) && s !== '.' && s !== '..')) return null;
  if (segments[0] === 'auth') return null;
  return segments.join('/');
}
