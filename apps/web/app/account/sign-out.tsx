'use client';

import { useRouter } from 'next/navigation';
import { useCart } from '@/components/cart-provider';
import { sf } from '@/lib/client-api';

export function SignOutButton() {
  const router = useRouter();
  const { refresh } = useCart();
  return (
    <button
      className="rounded-full px-4 py-2 text-left text-muted hover:bg-fg/5 lg:rounded-xl"
      onClick={async () => {
        await sf('auth/logout', { method: 'POST' }).catch(() => {});
        await refresh();
        router.push('/');
        router.refresh();
      }}
    >
      Sign out
    </button>
  );
}
