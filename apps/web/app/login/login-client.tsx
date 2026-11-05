'use client';

import { useRouter } from 'next/navigation';
import { useCart } from '@/components/cart-provider';
import { SignIn } from '@/components/sign-in';

export function LoginClient({ target }: { target: string }) {
  const router = useRouter();
  const { refresh } = useCart();
  return (
    <SignIn
      onSignedIn={async () => {
        await refresh();
        router.replace(target);
        router.refresh();
      }}
    />
  );
}
