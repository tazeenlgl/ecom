'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { useStore } from '@/components/store-context';
import { Badge, Card, ErrorNote, Loading, PageHeader, statusTone } from '@/components/ui';
import { dateTime, humanize, money } from '@/lib/format';
import { useFetch } from '@/lib/hooks';

type Sales = { currency: string; daily: { day: string; orders: number; totalPaise: number; discountPaise: number; refundedPaise: number }[]; topSkus: { skuCode: string; title: string; units: number; revenuePaise: number }[] };
type Pos = { adapter: string; stock: { lastSyncedAt: string | null; skusWithoutStockCount: number }; ordersByPosSyncStatus: Record<string, number>; deadJobsByType: Record<string, number> };
type Audit = { items: { id: string; action: string; entityType: string; actorEmail?: string | null; createdAt: string }[] };

const iso = (d: Date) => d.toISOString().slice(0, 10);

export default function StoreDashboard() {
  const { store, storeId, s, can } = useStore();
  const range = useMemo(() => {
    const to = new Date(Date.now() + 86_400_000);
    return { from: iso(new Date(Date.now() - 29 * 86_400_000)), to: iso(to) };
  }, []);
  const sales = useFetch<Sales>(can('reports.read') ? `${s('reports/sales')}?from=${range.from}&to=${range.to}` : null);
  const toShip = useFetch<{ items: { id: string }[]; nextCursor: string | null }>(can('orders.read') ? `${s('orders')}?status=confirmed&limit=100` : null);
  const awaiting = useFetch<{ items: { id: string }[]; nextCursor: string | null }>(can('orders.read') ? `${s('orders')}?status=pending_payment&limit=100` : null);
  const pos = useFetch<Pos>(can('pos.manage') ? s('pos/status') : null);
  const dead = useFetch<{ items: { id: string }[] }>(can('jobs.manage') ? `${s('jobs')}?status=dead` : null);
  const audit = useFetch<Audit>(can('audit.read') ? `${s('audit-logs')}?limit=6` : null);

  const totals = sales.data?.daily.reduce((a, d) => ({ orders: a.orders + d.orders, value: a.value + d.totalPaise, refunded: a.refunded + d.refundedPaise }), { orders: 0, value: 0, refunded: 0 });
  const count = (r: typeof toShip.data) => (r ? `${r.items.length}${r.nextCursor ? '+' : ''}` : '…');

  return (
    <>
      <PageHeader
        title={store.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={statusTone(store.status)}>{store.status}</Badge> {store.slug} · {store.currency} · {store.timezone}
          </span>
        }
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {can('reports.read') && <Stat label="Orders, last 30 days" value={totals ? String(totals.orders) : sales.error ? '—' : '…'} />}
        {can('reports.read') && <Stat label="Order value, last 30 days" value={totals ? money(totals.value) : sales.error ? '—' : '…'} note="Excludes cancelled orders" />}
        {can('orders.read') && <Stat label="Confirmed, to fulfil" value={count(toShip.data)} href={`/s/${storeId}/orders?status=confirmed`} />}
        {can('orders.read') && <Stat label="Awaiting payment" value={count(awaiting.data)} href={`/s/${storeId}/orders?status=pending_payment`} />}
      </div>
      {!can('reports.read') && !can('orders.read') && <Card><p className="text-sm text-muted">Your role has no reporting or order access for this store. Use the menu to open what you can manage.</p></Card>}
      {sales.error && <ErrorNote message={sales.error} onRetry={sales.reload} />}

      <div className="grid gap-6 lg:grid-cols-2">
        {can('pos.manage') && (
          <Card title="POS and stock" actions={<Link className="btn-ghost" href={`/s/${storeId}/operations`}>Details</Link>}>
            {pos.error ? <ErrorNote message={pos.error} /> : !pos.data ? <Loading /> : (
              <dl className="space-y-2 text-sm">
                <Row k="POS adapter" v={pos.data.adapter === 'none' ? 'None configured' : pos.data.adapter} />
                <Row k="Stock last refreshed" v={dateTime(pos.data.stock.lastSyncedAt)} />
                <Row k="SKUs without stock data" v={String(pos.data.stock.skusWithoutStockCount)} />
              </dl>
            )}
          </Card>
        )}
        {can('jobs.manage') && (
          <Card title="Background jobs" actions={<Link className="btn-ghost" href={`/s/${storeId}/operations`}>Open</Link>}>
            {dead.error ? <ErrorNote message={dead.error} /> : !dead.data ? <Loading /> : dead.data.items.length === 0 ? <p className="text-sm text-muted">No failed jobs.</p> : <p className="text-sm"><Badge tone="danger">{dead.data.items.length} failed</Badge> jobs need attention.</p>}
          </Card>
        )}
        {can('audit.read') && (
          <Card title="Recent activity" className="lg:col-span-2" actions={<Link className="btn-ghost" href={`/s/${storeId}/operations`}>All activity</Link>}>
            {audit.error ? <ErrorNote message={audit.error} /> : !audit.data ? <Loading /> : audit.data.items.length === 0 ? <p className="text-sm text-muted">No recorded activity yet.</p> : (
              <ul className="divide-y divide-line text-sm">
                {audit.data.items.map((a) => (
                  <li key={a.id} className="flex flex-wrap justify-between gap-2 py-2">
                    <span><b className="font-medium">{humanize(a.action.replace('.', ' '))}</b> <span className="text-muted">· {a.entityType}</span></span>
                    <span className="text-muted">{dateTime(a.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </div>
      <p className="mt-6 text-xs text-muted">Totals come straight from the sales report and order list. Product and customer counts are not shown because the API has no count endpoint.</p>
    </>
  );
}

function Stat({ label, value, note, href }: { label: string; value: string; note?: string; href?: string }) {
  const body = (
    <div className="card h-full p-5 transition hover:border-accent/50">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-2 font-display text-4xl font-semibold text-accent">{value}</p>
      {note && <p className="mt-1 text-xs text-muted">{note}</p>}
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between gap-4"><dt className="text-muted">{k}</dt><dd className="text-right font-medium">{v}</dd></div>;
}
