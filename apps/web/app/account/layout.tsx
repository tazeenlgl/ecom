import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { getCustomer } from '@/lib/server-api';
import { SignOutButton } from './sign-out';

export const metadata = { robots: { index: false } };

export default async function AccountLayout({ children }: { children: ReactNode }) {
  const customer = await getCustomer();
  if (!customer) redirect('/login?next=/account');
  return (
    <div className="container-x py-10 sm:py-14">
      <p className="eyebrow">Your account</p>
      <h1 className="display-title mt-2 text-4xl sm:text-5xl">Hello{customer.name ? `, ${customer.name.split(' ')[0]}` : ''}</h1>
      <div className="mt-10 grid gap-10 lg:grid-cols-[220px_1fr]">
        <nav className="flex gap-2 overflow-x-auto text-sm lg:flex-col lg:gap-1" aria-label="Account">
          <Link className="rounded-full px-4 py-2 hover:bg-fg/5 lg:rounded-xl" href="/account">Overview</Link>
          <Link className="rounded-full px-4 py-2 hover:bg-fg/5 lg:rounded-xl" href="/account/orders">Orders</Link>
          <Link className="rounded-full px-4 py-2 hover:bg-fg/5 lg:rounded-xl" href="/account/addresses">Addresses</Link>
          <SignOutButton />
        </nav>
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
