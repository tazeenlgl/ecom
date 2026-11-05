import Image from 'next/image';
import { redirect } from 'next/navigation';
import { sessionToken } from '@/lib/server';
import { LoginForm } from './login-form';

export const metadata = { title: 'Sign in' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ expired?: string }> }) {
  const { expired } = await searchParams;
  if ((await sessionToken()) && !expired) redirect('/');
  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <div className="card w-full max-w-sm p-8">
        <Image src="/brand/tazeen-logo-stacked.png" alt="TAZEEN" width={160} height={118} className="mx-auto h-24 w-auto" priority />
        <h1 className="mt-6 text-center font-display text-3xl font-semibold">Admin sign in</h1>
        <p className="mt-1 text-center text-sm text-muted">Platform and store administration</p>
        {expired && <p className="mt-4 rounded-lg bg-warn/10 px-3 py-2 text-center text-sm text-warn">Your session has ended. Please sign in again.</p>}
        <LoginForm />
      </div>
    </div>
  );
}
