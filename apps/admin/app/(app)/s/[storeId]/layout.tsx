'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import type { ReactNode } from 'react';
import { useSession } from '@/components/session';

/**
 * UI guard: only stores the API listed for this admin are shown. A hand-typed store id gets this page, and any
 * request made for it would be rejected by the API anyway (the BFF forwards the id; the API checks the grant).
 */
export default function StoreLayout({ children }: { children: ReactNode }) {
  const { storeId } = useParams<{ storeId: string }>();
  const { stores } = useSession();
  if (!stores.some((s) => s.id === storeId)) {
    return (
      <div className="card mx-auto max-w-lg p-8 text-center">
        <p className="font-display text-2xl">Store not found</p>
        <p className="mt-2 text-sm text-muted">This store does not exist or your account has no access to it.</p>
        <Link className="btn-secondary mt-5" href="/">
          Back to overview
        </Link>
      </div>
    );
  }
  return <>{children}</>;
}
