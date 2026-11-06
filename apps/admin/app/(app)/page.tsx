'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useSession } from '@/components/session';
import { Badge, Card, DataTable, ErrorNote, Loading, PageHeader, statusTone } from '@/components/ui';
import { useFetch } from '@/lib/hooks';

type Brand = { id: string; slug: string; name: string; status: string };

export default function PlatformOverview() {
  const { stores, can, admin, roleLabels } = useSession();
  const router = useRouter();
  const platform = can('platform.brands.manage') || can('platform.stores.manage') || can('platform.admins.manage');
  const brands = useFetch<{ items: Brand[] }>(can('platform.brands.manage') ? 'brands' : null);
  const admins = useFetch<{ items: { id: string }[] }>(can('platform.admins.manage') ? 'admin-users' : null);

  // A store-scoped admin has no platform overview: send them to their (first) store.
  useEffect(() => {
    if (!platform && stores.length > 0) router.replace(`/s/${stores[0]!.id}`);
  }, [platform, stores, router]);

  if (!platform && stores.length > 0) return <Loading />;
  if (!platform) {
    return (
      <Card title="No stores">
        <p className="text-sm text-muted">Your account ({admin.email}) has no accessible stores. Ask a platform owner to grant you a role.</p>
      </Card>
    );
  }

  const active = stores.filter((s) => s.status === 'active').length;
  return (
    <>
      <PageHeader title="Platform overview" subtitle={`Signed in as ${admin.name} · ${roleLabels(null).join(', ')}`} />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Accessible stores" value={String(stores.length)} />
        <Stat label="Active stores" value={String(active)} />
        {can('platform.brands.manage') && <Stat label="Brands" value={brands.data ? String(brands.data.items.length) : '…'} />}
        {can('platform.admins.manage') && <Stat label="Administrators" value={admins.data ? String(admins.data.items.length) : '…'} />}
      </div>
      {brands.error && <ErrorNote message={brands.error} onRetry={brands.reload} />}
      <h2 className="mb-3 mt-2 text-sm font-semibold">Stores you can access</h2>
      <DataTable head={['Store', 'Slug', 'Status', 'Currency', 'Timezone', '']}>
        {stores.map((s) => (
          <tr key={s.id}>
            <td className="td font-medium">{s.name}</td>
            <td className="td text-muted">{s.slug}</td>
            <td className="td">
              <Badge tone={statusTone(s.status)}>{s.status}</Badge>
            </td>
            <td className="td">{s.currency}</td>
            <td className="td text-muted">{s.timezone}</td>
            <td className="td text-right">
              <Link className="btn-secondary" href={`/s/${s.id}`}>
                Open
              </Link>
            </td>
          </tr>
        ))}
      </DataTable>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-2 font-display text-4xl font-semibold text-accent">{value}</p>
    </div>
  );
}
