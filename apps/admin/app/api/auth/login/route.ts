import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { UpstreamError, adminApi, startSession } from '@/lib/server';

const body = z.object({ email: z.string().min(3).max(200), password: z.string().min(1).max(200) });

export async function POST(req: NextRequest) {
  const origin = req.headers.get('origin');
  if (origin && new URL(origin).host !== req.headers.get('host')) return NextResponse.json({ error: { code: 'forbidden', message: 'Cross-site sign-in blocked.' } }, { status: 403 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: 'invalid_request', message: 'Enter your email and password.' } }, { status: 400 });
  try {
    const r = await adminApi<{ token: string; expiresAt: string; admin: { id: string; email: string; name: string } }>('auth/login', {
      method: 'POST',
      body: parsed.data,
      token: null,
      headers: { 'x-forwarded-for': req.headers.get('x-forwarded-for') ?? '' },
    });
    await startSession(r.token, r.expiresAt);
    return NextResponse.json({ admin: r.admin });
  } catch (err) {
    if (err instanceof UpstreamError) return NextResponse.json({ error: { code: err.code, message: err.message } }, { status: err.status });
    return NextResponse.json({ error: { code: 'unavailable', message: 'The API is not reachable.' } }, { status: 502 });
  }
}
