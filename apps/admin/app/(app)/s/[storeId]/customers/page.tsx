'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useStore } from '@/components/store-context';
import { Badge, DataTable, Denied, Empty, ErrorNote, LoadMore, PageHeader, statusTone } from '@/components/ui';
import { dateOnly } from '@/lib/format';
import { useDebounced, useList } from '@/lib/hooks';

type Customer = { id: string; phone: string; name: string | null; email: string | null; status: string; createdAt: string };

export default function CustomersPage() {
  const { storeId, s, can } = useStore();
  const [phone, setPhone] = useState('');
  const dp = useDebounced(phone.replace(/\D/g, ''));
  const qs = new URLSearchParams({ limit: '25' });
  if (dp) qs.set('phone', dp);
  const list = useList<Customer>(can('customers.read') ? `${s('customers')}?${qs}` : null);
  if (!can('customers.read')) return <Denied what="view customers" />;
  return (
    <>
      <PageHeader title="Customers" subtitle="Search by mobile number digits. Customers sign up themselves on the storefront." />
      <div className="mb-4 max-w-sm">
        <label htmlFor="ph" className="sr-only">Mobile number</label>
        <input id="ph" className="field" inputMode="numeric" placeholder="Search by mobile number…" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </div>
      {list.error && <ErrorNote message={list.error} onRetry={list.reload} />}
      <DataTable head={['Customer', 'Mobile', 'Email', 'Status', 'Joined']} empty={!list.loading && list.items.length === 0 && !list.error ? <Empty title="No customers found" /> : undefined}>
        {list.items.map((c) => (
          <tr key={c.id} className="hover:bg-accent-soft/30">
            <td className="td font-medium"><Link className="text-accent hover:underline" href={`/s/${storeId}/customers/${c.id}`}>{c.name ?? 'Unnamed'}</Link></td>
            <td className="td">{c.phone}</td>
            <td className="td text-muted">{c.email ?? '—'}</td>
            <td className="td"><Badge tone={statusTone(c.status)}>{c.status}</Badge></td>
            <td className="td text-muted">{dateOnly(c.createdAt)}</td>
          </tr>
        ))}
      </DataTable>
      <LoadMore hasMore={list.hasMore} loading={list.loading} onClick={list.loadMore} />
    </>
  );
}
