'use client';

import { CSRF_COOKIE, CSRF_HEADER } from './csrf';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

function csrfToken(): string {
  const m = document.cookie.split('; ').find((c) => c.startsWith(`${CSRF_COOKIE}=`));
  return m ? decodeURIComponent(m.slice(CSRF_COOKIE.length + 1)) : '';
}

/** Browser call through the admin BFF (/api/admin/*). The BFF adds the bearer token from the httpOnly cookie. */
export async function api<T>(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<T> {
  const method = init.method ?? 'GET';
  const res = await fetch(`/api/admin/${path.replace(/^\//, '')}`, {
    method,
    credentials: 'same-origin',
    headers: {
      accept: 'application/json',
      ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(method !== 'GET' ? { [CSRF_HEADER]: csrfToken() } : {}),
      ...init.headers,
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const body = (await res.json().catch(() => null)) as { error?: { code: string; message: string; details?: unknown } } | null;
  if (res.status === 401 && typeof window !== 'undefined') window.location.assign('/login?expired=1');
  if (!res.ok) throw new ApiError(res.status, body?.error?.code ?? 'error', body?.error?.message ?? 'Something went wrong. Please try again.', body?.error?.details);
  return body as T;
}

export function errorText(err: unknown): string {
  if (err instanceof ApiError) {
    const d = err.details;
    if (Array.isArray(d) && d.length) return `${err.message} ${d.map((x) => (typeof x === 'string' ? x : `${(x as { path?: string }).path ?? ''}: ${(x as { message?: string }).message ?? ''}`)).join('; ')}`;
    return err.message;
  }
  return err instanceof Error ? err.message : 'Something went wrong.';
}
