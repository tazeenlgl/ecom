import { redirect } from 'next/navigation';
import { getCustomer } from '@/lib/server-api';
import { LoginClient } from './login-client';

export const metadata = { title: 'Sign in', robots: { index: false } };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  // Only same-site relative paths are accepted as a return target.
  const target = next && next.startsWith('/') && !next.startsWith('//') ? next : '/account';
  if (await getCustomer()) redirect(target);
  return (
    <div className="container-x flex min-h-[70vh] items-center justify-center py-16">
      <div className="w-full max-w-sm">
        <p className="eyebrow text-center">Welcome</p>
        <h1 className="display-title mt-3 text-center text-4xl">Sign in</h1>
        <p className="mb-8 mt-3 text-center text-sm text-muted">New here? Signing in with your mobile number creates your account.</p>
        <LoginClient target={target} />
      </div>
    </div>
  );
}
