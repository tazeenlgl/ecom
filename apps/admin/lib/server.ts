import 'server-only';
import { randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { CSRF_COOKIE, SESSION_COOKIE } from './csrf';

export const API_URL = (process.env.ADMIN_API_URL ?? 'http://localhost:4000').replace(/\/$/, '');
const secure = process.env.NODE_ENV === 'production';

export async function sessionToken(): Promise<string | null> {
  return (await cookies()).get(SESSION_COOKIE)?.value ?? null;
}

/** Sets the httpOnly session cookie (API token) and a readable CSRF cookie. The token never reaches browser JavaScript. */
export async function startSession(token: string, expiresAt: string) {
  const jar = await cookies();
  const expires = new Date(expiresAt);
  jar.set(SESSION_COOKIE, token, { httpOnly: true, secure, sameSite: 'strict', path: '/', expires });
  jar.set(CSRF_COOKIE, randomBytes(24).toString('base64url'), { httpOnly: false, secure, sameSite: 'strict', path: '/', expires });
}

export async function endSession() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  jar.delete(CSRF_COOKIE);
}

export class UpstreamError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

/** Server-side call to /v1/admin/* with the session token. */
export async function adminApi<T>(path: string, init: { method?: string; body?: unknown; token?: string | null; headers?: Record<string, string> } = {}): Promise<T> {
  const token = init.token === undefined ? await sessionToken() : init.token;
  const res = await fetch(`${API_URL}/v1/admin/${path.replace(/^\//, '')}`, {
    method: init.method ?? 'GET',
    headers: {
      accept: 'application/json',
      ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: 'no-store',
  });
  if (res.status === 204) return undefined as T;
  const body = (await res.json().catch(() => null)) as { error?: { code: string; message: string; details?: unknown } } | null;
  if (!res.ok) throw new UpstreamError(res.status, body?.error?.code ?? 'error', body?.error?.message ?? res.statusText, body?.error?.details);
  return body as T;
}
