'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useStore } from '@/components/store-context';
import { Badge, Card, DataTable, Denied, ErrorNote, Loading, PageHeader, statusTone } from '@/components/ui';
import { dateOnly, dateTime, humanize, money } from '@/lib/format';
import { useFetch, useList } from '@/lib/hooks';

type Address = { id: string; name: string; phone: string; line1: string; line2: string | null; landmark: string | null; city: string; state: string; pincode: string; isDefault: boolean };
type Detail = { customer: { id: string; phone: string; name: string | null; email: string | null; status: string; createdAt: string }; addresses: Address[] };
type OrderRow = { id: string; orderNumber: string; customerId: string | null; status: string; totalPaise: number; placedAt: string };

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { storeId, s, can } = useStore();
  const { data, error, loading, reload } = useFetch<Detail>(can('customers.read') ? s(`customers/${id}`) : null);
  // The orders API cannot filter by customer, so history is read from the newest orders and filtered here.
  const orders = useList<OrderRow>(can('orders.read') ? `${s('orders')}?limit=100` : null);
  if (!can('customers.read')) return <Denied what="view customers" />;
  if (error) return <ErrorNote message={error} onRetry={reload} />;
  if (loading && !data) return <Loading />;
  if (!data) return null;
  const { customer: c } = data;
  const mine = orders.items.filter((o) => o.customerId === id);
  return (
    <>
      <PageHeader title={c.name ?? 'Unnamed customer'} subtitle={<span className="flex flex-wrap items-center gap-2"><Badge tone={statusTone(c.status)}>{c.status}</Badge> {c.phone}{c.email ? ` · ${c.email}` : ''} · joined {dateOnly(c.createdAt)} · <Link className="text-accent hover:underline" href={`/s/${storeId}/customers`}>All customers</Link></span>} />
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <Card title="Order history">
          {!can('orders.read') ? <p className="text-sm text-muted">Your role cannot view orders.</p> : orders.error ? <ErrorNote message={orders.error} onRetry={orders.reload} /> : (
            <>
              <DataTable head={['Order', 'Placed', 'Status', 'Total']}>
                {mine.map((o) => (
                  <tr key={o.id}><td className="td"><Link className="text-accent hover:underline" href={`/s/${storeId}/orders/${o.id}`}>{o.orderNumber}</Link></td><td className="td text-muted">{dateTime(o.placedAt)}</td><td className="td"><Badge tone={statusTone(o.status)}>{humanize(o.status)}</Badge></td><td className="td">{money(o.totalPaise)}</td></tr>
                ))}
              </DataTable>
              {orders.loading && <p className="py-3 text-center text-sm text-muted" role="status">Loading…</p>}
              {!orders.loading && mine.length === 0 && <p className="mt-3 text-sm text-muted">No orders found in the {orders.items.length} most recent orders.</p>}
              {orders.hasMore && <button className="btn-ghost mt-2" onClick={orders.loadMore} disabled={orders.loading}>Search older orders</button>}
            </>
          )}
        </Card>
        <Card title="Addresses">
          {data.addresses.length === 0 ? <p className="text-sm text-muted">No saved addresses.</p> : (
            <ul className="space-y-3 text-sm">
              {data.addresses.map((a) => (
                <li key={a.id} className="rounded-lg border border-line p-3">
                  <p className="font-medium">{a.name} {a.isDefault && <Badge tone="accent">Default</Badge>}</p>
                  <p className="text-muted">{[a.line1, a.line2, a.landmark].filter(Boolean).join(', ')}<br />{a.city}, {a.state} {a.pincode}<br />{a.phone}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
