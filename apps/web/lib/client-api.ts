'use client';

import { ApiError } from './errors';

/**
 * Browser call through the storefront's own BFF route (/api/sf/*). The BFF adds
 * the store host and the shopper's tokens from httpOnly cookies.
 */
export async function sf<T>(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<T> {
  const res = await fetch(`/api/sf/${path.replace(/^\//, '')}`, {
    method: init.method ?? 'GET',
    headers: { accept: 'application/json', ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}), ...init.headers },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    credentials: 'same-origin',
  });
  if (res.status === 204) return undefined as T;
  const body = (await res.json().catch(() => null)) as { error?: { code: string; message: string; details?: unknown } } | null;
  if (!res.ok) throw new ApiError(res.status, body?.error?.code ?? 'error', body?.error?.message ?? 'Something went wrong. Please try again.', body?.error?.details);
  return body as T;
}

export function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : 'Something went wrong. Please try again.';
}
