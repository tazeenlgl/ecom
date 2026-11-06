'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useStore } from '@/components/store-context';
import { Badge, DataTable, Denied, Empty, ErrorNote, LoadMore, PageHeader, statusTone } from '@/components/ui';
import { dateTime, humanize, money } from '@/lib/format';
import { useList } from '@/lib/hooks';

export type OrderRow = { id: string; orderNumber: string; status: string; paymentStatus: string; fulfillmentStatus: string; posSyncStatus: string; paymentMethod: string; totalPaise: number; placedAt: string; customerSnapshot?: { name?: string | null; phone?: string } | null };

export default function OrdersPage() {
  return (
    <Suspense fallback={null}>
      <Orders />
    </Suspense>
  );
}

function Orders() {
  const { storeId, s, can } = useStore();
  const sp = useSearchParams();
  const [status, setStatus] = useState(sp.get('status') ?? '');
  const [pos, setPos] = useState('');
  const [find, setFind] = useState('');
  const qs = new URLSearchParams({ limit: '25' });
  if (status) qs.set('status', status);
  if (pos) qs.set('posSyncStatus', pos);
  const list = useList<OrderRow>(can('orders.read') ? `${s('orders')}?${qs}` : null);

  if (!can('orders.read')) return <Denied what="view orders" />;
  // The API has no free-text order search, so the box filters the rows already loaded.
  const rows = list.items.filter((o) => !find.trim() || [o.orderNumber, o.customerSnapshot?.phone, o.customerSnapshot?.name].some((x) => x?.toLowerCase().includes(find.trim().toLowerCase())));
  return (
    <>
      <PageHeader title="Orders" subtitle="Newest first. The search box filters the orders loaded below; use Load more to reach older ones." />
      <div className="mb-4 flex flex-wrap gap-3">
        <div className="min-w-56 flex-1">
          <label htmlFor="find" className="sr-only">Find in loaded orders</label>
          <input id="find" className="field" placeholder="Order number, name or phone…" value={find} onChange={(e) => setFind(e.target.value)} />
        </div>
        <div>
          <label htmlFor="os" className="sr-only">Order status</label>
          <select id="os" className="field" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {['pending_payment', 'confirmed', 'processing', 'completed', 'cancelled'].map((x) => <option key={x} value={x}>{humanize(x)}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="ps" className="sr-only">POS sync</label>
          <select id="ps" className="field" value={pos} onChange={(e) => setPos(e.target.value)}>
            <option value="">Any POS sync</option>
            {['pending', 'in_progress', 'synced', 'failed', 'manual_required'].map((x) => <option key={x} value={x}>POS: {humanize(x)}</option>)}
          </select>
        </div>
      </div>
      {list.error && <ErrorNote message={list.error} onRetry={list.reload} />}
      <DataTable head={['Order', 'Placed', 'Customer', 'Payment', 'Status', 'Total']} empty={!list.loading && rows.length === 0 && !list.error ? <Empty title="No orders found" hint="Orders appear here after customers check out." /> : undefined}>
        {rows.map((o) => (
          <tr key={o.id} className="hover:bg-accent-soft/30">
            <td className="td font-medium"><Link className="text-accent hover:underline" href={`/s/${storeId}/orders/${o.id}`}>{o.orderNumber}</Link></td>
            <td className="td text-muted">{dateTime(o.placedAt)}</td>
            <td className="td">{o.customerSnapshot?.name ?? '—'}<span className="block text-xs text-muted">{o.customerSnapshot?.phone}</span></td>
            <td className="td"><Badge tone={statusTone(o.paymentStatus)}>{humanize(o.paymentStatus)}</Badge><span className="ml-1 text-xs text-muted">{o.paymentMethod === 'cod' ? 'COD' : 'Online'}</span></td>
            <td className="td"><Badge tone={statusTone(o.status)}>{humanize(o.status)}</Badge><span className="block text-xs text-muted">{humanize(o.fulfillmentStatus)}</span></td>
            <td className="td font-medium">{money(o.totalPaise)}</td>
          </tr>
        ))}
      </DataTable>
      {list.loading && <p className="py-4 text-center text-sm text-muted" role="status">Loading…</p>}
      <LoadMore hasMore={list.hasMore} loading={list.loading} onClick={list.loadMore} />
    </>
  );
}
