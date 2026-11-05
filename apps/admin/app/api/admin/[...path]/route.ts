import { NextResponse, type NextRequest } from 'next/server';
import { CSRF_COOKIE, CSRF_HEADER, SESSION_COOKIE, csrfOk, safeProxyPath } from '@/lib/csrf';

const API_URL = (process.env.ADMIN_API_URL ?? 'http://localhost:4000').replace(/\/$/, '');

/**
 * Backend-for-frontend proxy to /v1/admin/*. The browser never sees the admin token: it lives in an httpOnly cookie
 * and is attached here. State-changing requests need a matching CSRF header/cookie pair and a same-site Origin.
 * Authorization is NOT decided here: the API checks the role grants on every call.
 */
async function handle(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const path = safeProxyPath((await ctx.params).path);
  if (!path) return NextResponse.json({ error: { code: 'not_found', message: 'Not found.' } }, { status: 404 });

  const csrf = csrfOk({
    method: req.method,
    origin: req.headers.get('origin'),
    host: req.headers.get('host'),
    header: req.headers.get(CSRF_HEADER),
    cookie: req.cookies.get(CSRF_COOKIE)?.value ?? null,
  });
  if (!csrf) return NextResponse.json({ error: { code: 'forbidden', message: 'Request blocked (CSRF check failed). Reload the page and try again.' } }, { status: 403 });

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return NextResponse.json({ error: { code: 'unauthenticated', message: 'Sign in required.' } }, { status: 401 });

  const hasBody = !['GET', 'HEAD'].includes(req.method);
  const text = hasBody ? await req.text() : '';
  const idem = req.headers.get('idempotency-key');
  let upstream: Response;
  try {
    upstream = await fetch(`${API_URL}/v1/admin/${path}${req.nextUrl.search}`, {
      method: req.method,
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${token}`,
        ...(hasBody && text ? { 'content-type': 'application/json' } : {}),
        ...(idem ? { 'idempotency-key': idem } : {}),
      },
      body: hasBody && text ? text : undefined,
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json({ error: { code: 'unavailable', message: 'The API is not reachable.' } }, { status: 502 });
  }

  const out = new NextResponse(upstream.status === 204 ? null : await upstream.text(), {
    status: upstream.status,
    headers: upstream.status === 204 ? {} : { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
  });
  if (upstream.status === 401) {
    out.cookies.delete(SESSION_COOKIE);
    out.cookies.delete(CSRF_COOKIE);
  }
  return out;
}

export { handle as GET, handle as POST, handle as PATCH, handle as PUT, handle as DELETE };
