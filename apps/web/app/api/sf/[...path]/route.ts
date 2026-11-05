import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { API_URL, CART_COOKIE, SESSION_COOKIE, upstreamHeaders } from '@/lib/server-api';

/**
 * Backend-for-frontend proxy. The browser only talks to this origin; this route
 * forwards to the API with the store host and the shopper's tokens taken from
 * httpOnly cookies, and turns tokens in API responses back into cookies. Because
 * the browser never calls the API directly, the API needs no CORS allow-list.
 */

// First path segment the browser may reach. Admin and webhook routes are never proxied.
const ALLOWED_ROOTS = new Set([
  'store', 'categories', 'collections', 'products', 'content', 'faqs', 'pages',
  'shipping', 'cart', 'checkout', 'auth', 'me', 'orders',
]);
const SEGMENT = /^[A-Za-z0-9_-]{1,120}$/;
const SIGN_IN_PATHS = new Set(['auth/otp/verify', 'auth/password/login']);
const secure = process.env.NODE_ENV === 'production';

async function handle(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  if (!path.length || !ALLOWED_ROOTS.has(path[0]!) || !path.every((s) => SEGMENT.test(s))) {
    return NextResponse.json({ error: { code: 'not_found', message: 'Not found.' } }, { status: 404 });
  }
  const joined = path.join('/');
  const method = request.method.toUpperCase();

  // CSRF: state-changing requests must come from this origin.
  if (method !== 'GET' && method !== 'HEAD') {
    const origin = request.headers.get('origin');
    const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
    if (!origin || new URL(origin).host !== host) {
      return NextResponse.json({ error: { code: 'forbidden', message: 'Cross-site request refused.' } }, { status: 403 });
    }
  }

  // Bodyless writes (logout, start payment) must reach the API with no body and no content type.
  const rawBody = method === 'GET' || method === 'HEAD' ? '' : await request.text();
  const extra: Record<string, string> = {};
  const contentType = request.headers.get('content-type');
  if (contentType && rawBody) extra['content-type'] = contentType;
  const idem = request.headers.get('idempotency-key');
  if (idem) extra['idempotency-key'] = idem;

  const upstream = await fetch(`${API_URL}/v1/storefront/${joined}${request.nextUrl.search}`, {
    method,
    headers: await upstreamHeaders(extra),
    body: rawBody || undefined,
    cache: 'no-store',
  });

  const jar = await cookies();
  const hadSession = Boolean(jar.get(SESSION_COOKIE));
  let data: Record<string, unknown> | null = null;
  if (upstream.status !== 204) data = (await upstream.json().catch(() => null)) as Record<string, unknown> | null;

  const response = upstream.status === 204 ? new NextResponse(null, { status: 204 }) : NextResponse.json(data, { status: upstream.status });

  if (upstream.ok && data && SIGN_IN_PATHS.has(joined) && typeof data.token === 'string') {
    response.cookies.set(SESSION_COOKIE, data.token, {
      httpOnly: true, secure, sameSite: 'lax', path: '/',
      expires: typeof data.expiresAt === 'string' ? new Date(data.expiresAt) : undefined,
    });
    // The guest cart was merged into the customer's cart by the API.
    response.cookies.delete(CART_COOKIE);
    delete data.token;
    return NextResponse.json(data, { status: upstream.status, headers: response.headers });
  }

  const cart = data?.cart as { cartToken?: string } | undefined;
  if (upstream.ok && cart?.cartToken) {
    response.cookies.set(CART_COOKIE, cart.cartToken, { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 30 });
    delete cart.cartToken;
    return NextResponse.json(data, { status: upstream.status, headers: response.headers });
  }

  if (joined === 'auth/logout' || (upstream.status === 401 && hadSession)) response.cookies.delete(SESSION_COOKIE);
  return response;
}

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE };
