'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { api } from '@/lib/client';
import { useSession } from './session';

type NavItem = { href: string; label: string; show: boolean };

export function Shell({ children }: { children: ReactNode }) {
  const { admin, stores, can } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const storeMatch = pathname.match(/^\/s\/([^/]+)/);
  const storeId = storeMatch ? storeMatch[1]! : null;
  const store = stores.find((s) => s.id === storeId) ?? null;
  const base = storeId ? `/s/${storeId}` : '';

  const platform: NavItem[] = [
    { href: '/', label: 'Overview', show: true },
    { href: '/platform/brands', label: 'Brands', show: can('platform.brands.manage') },
    { href: '/platform/stores', label: 'Stores', show: can('platform.stores.manage') },
    { href: '/platform/admins', label: 'Administrators', show: can('platform.admins.manage') },
  ];
  const storeNav: NavItem[] = store
    ? [
        { href: base, label: 'Dashboard', show: can('store.read', store.id) },
        { href: `${base}/products`, label: 'Products', show: can('catalogue.read', store.id) },
        { href: `${base}/categories`, label: 'Categories', show: can('catalogue.read', store.id) },
        { href: `${base}/collections`, label: 'Collections', show: can('catalogue.read', store.id) },
        { href: `${base}/promotions`, label: 'Promotions', show: can('catalogue.read', store.id) },
        { href: `${base}/orders`, label: 'Orders', show: can('orders.read', store.id) },
        { href: `${base}/customers`, label: 'Customers', show: can('customers.read', store.id) },
        { href: `${base}/content`, label: 'Content', show: can('store.read', store.id) },
        { href: `${base}/shipping`, label: 'Shipping zones', show: can('store.read', store.id) },
        { href: `${base}/settings`, label: 'Store settings', show: can('store.read', store.id) },
        { href: `${base}/operations`, label: 'Operations', show: ['pos.manage', 'jobs.manage', 'audit.read', 'reports.read'].some((p) => can(p, store.id)) },
      ]
    : [];

  const link = (n: NavItem) => {
    const active = n.href === '/' ? pathname === '/' : n.href === base ? pathname === base : pathname.startsWith(n.href);
    return (
      <li key={n.href}>
        <Link
          href={n.href}
          aria-current={active ? 'page' : undefined}
          onClick={() => setOpen(false)}
          className={`block rounded-lg px-3 py-2 text-sm transition ${active ? 'bg-accent-soft font-medium text-accent' : 'text-fg/80 hover:bg-accent-soft/60 hover:text-accent'}`}
        >
          {n.label}
        </Link>
      </li>
    );
  };

  const switchStore = (id: string) => {
    const rest = storeId ? pathname.replace(/^\/s\/[^/]+/, '').split('/').slice(0, 2).join('/') : '';
    router.push(`/s/${id}${rest}`);
  };

  const logout = async () => {
    await api('../auth/logout', { method: 'POST' }).catch(() => {});
    window.location.assign('/login');
  };

  const nav = (
    <nav aria-label="Main" className="flex h-full flex-col gap-6 overflow-y-auto p-4">
      {platform.filter((n) => n.show).length > 1 && (
        <div>
          <p className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted">Platform</p>
          <ul className="space-y-0.5">{platform.filter((n) => n.show).map(link)}</ul>
        </div>
      )}
      {store && (
        <div>
          <p className="mb-2 truncate px-3 text-[11px] font-semibold uppercase tracking-wider text-muted">{store.name}</p>
          <ul className="space-y-0.5">{storeNav.filter((n) => n.show).map(link)}</ul>
        </div>
      )}
    </nav>
  );

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[248px_1fr]">
      <aside className="sticky top-0 hidden h-dvh border-r border-line bg-surface lg:flex lg:flex-col">
        <Link href="/" className="flex h-16 items-center border-b border-line px-5" aria-label="TAZEEN admin home">
          <Image src="/brand/tazeen-logo-wide.png" alt="TAZEEN" width={150} height={50} className="h-9 w-auto" priority />
        </Link>
        <div className="min-h-0 flex-1">{nav}</div>
      </aside>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-fg/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 bg-surface shadow-xl">{nav}</aside>
        </div>
      )}

      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-line bg-surface/90 px-4 backdrop-blur sm:px-6">
          <button className="btn-ghost lg:hidden" aria-label="Open menu" onClick={() => setOpen(true)}>
            ☰
          </button>
          <div className="flex min-w-0 items-center gap-2">
            <label htmlFor="store-switch" className="sr-only">
              Active store
            </label>
            <select id="store-switch" className="field max-w-[16rem] py-1.5" value={store?.id ?? ''} onChange={(e) => e.target.value && switchStore(e.target.value)}>
              {!store && <option value="">{stores.length ? 'Select a store…' : 'No accessible stores'}</option>}
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.status !== 'active' ? ` (${s.status})` : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <div className="hidden text-right text-xs leading-tight sm:block">
              <p className="font-medium">{admin.name}</p>
              <p className="text-muted">{admin.email}</p>
            </div>
            <button className="btn-secondary" onClick={logout}>
              Sign out
            </button>
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-[1280px] p-4 sm:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
