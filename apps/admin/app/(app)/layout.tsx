import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { SessionProvider, type SessionData, type StoreSummary } from '@/components/session';
import { Shell } from '@/components/shell';
import type { Grant, RoleDef } from '@/lib/permissions';
import { UpstreamError, adminApi, sessionToken } from '@/lib/server';

/** Every page in this group needs a live admin session. The API is asked on each render, so revoked or expired sessions are caught. */
export default async function AppLayout({ children }: { children: ReactNode }) {
  if (!(await sessionToken())) redirect('/login');
  let data: SessionData;
  try {
    const [me, roles, stores] = await Promise.all([
      adminApi<{ admin: SessionData['admin']; grants: Grant[] }>('me'),
      adminApi<{ items: RoleDef[] }>('roles'),
      adminApi<{ items: StoreSummary[] }>('stores'),
    ]);
    data = { admin: me.admin, grants: me.grants, roles: roles.items, stores: stores.items };
  } catch (err) {
    if (err instanceof UpstreamError && err.status === 401) redirect('/login?expired=1');
    return (
      <div className="mx-auto max-w-lg p-10 text-center">
        <p className="font-display text-2xl">The admin API is not reachable</p>
        <p className="mt-2 text-sm text-muted">{err instanceof Error ? err.message : 'Unknown error'}. Check that the API is running and try again.</p>
      </div>
    );
  }
  return (
    <SessionProvider value={data}>
      <Shell>{children}</Shell>
    </SessionProvider>
  );
}
