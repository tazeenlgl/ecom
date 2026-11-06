import { NextResponse, type NextRequest } from 'next/server';
import { CSRF_COOKIE, CSRF_HEADER, csrfOk } from '@/lib/csrf';
import { adminApi, endSession, sessionToken } from '@/lib/server';

/** Revokes the session at the API (so the token is dead even if copied), then clears the cookies. */
export async function POST(req: NextRequest) {
  const ok = csrfOk({ method: 'POST', origin: req.headers.get('origin'), host: req.headers.get('host'), header: req.headers.get(CSRF_HEADER), cookie: req.cookies.get(CSRF_COOKIE)?.value ?? null });
  if (!ok) return NextResponse.json({ error: { code: 'forbidden', message: 'Request blocked.' } }, { status: 403 });
  const token = await sessionToken();
  let revoked = true;
  if (token) {
    try {
      await adminApi('auth/logout', { method: 'POST', token });
    } catch {
      revoked = false;
    }
  }
  await endSession();
  return NextResponse.json({ ok: true, revoked });
}
