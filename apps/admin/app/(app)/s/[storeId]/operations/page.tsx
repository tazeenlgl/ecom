'use client';

import { useMemo, useState } from 'react';
import { useStore } from '@/components/store-context';
import { Badge, Card, DataTable, Denied, Empty, ErrorNote, Field, Loading, LoadMore, PageHeader, statusTone, useToast } from '@/components/ui';
import { api, errorText } from '@/lib/client';
import { dateTime, humanize, money } from '@/lib/format';
import { useFetch, useList } from '@/lib/hooks';

type Tab = 'pos' | 'jobs' | 'audit' | 'reports';

export default function OperationsPage() {
  const { can } = useStore();
  const tabs: { key: Tab; label: string; show: boolean }[] = [
    { key: 'pos', label: 'POS and stock', show: can('pos.manage') },
    { key: 'jobs', label: 'Background jobs', show: can('jobs.manage') },
    { key: 'audit', label: 'Audit history', show: can('audit.read') },
    { key: 'reports', label: 'Sales report', show: can('reports.read') },
  ];
  const visible = tabs.filter((t) => t.show);
  const [tab, setTab] = useState<Tab | null>(null);
  const active = tab ?? visible[0]?.key ?? null;
  if (!active) return <Denied what="view operations" />;
  return (
    <>
      <PageHeader title="Operations" subtitle="Integration status, background work, change history and reports." />
      <div className="mb-5 flex flex-wrap gap-1 border-b border-line" role="tablist">
        {visible.map((t) => (
          <button key={t.key} role="tab" aria-selected={active === t.key} onClick={() => setTab(t.key)} className={`-mb-px border-b-2 px-4 py-2 text-sm ${active === t.key ? 'border-accent font-medium text-accent' : 'border-transparent text-muted hover:text-fg'}`}>{t.label}</button>
        ))}
      </div>
      {active === 'pos' && <Pos />}
      {active === 'jobs' && <Jobs />}
      {active === 'audit' && <Audit />}
      {active === 'reports' && <Reports />}
    </>
  );
}

type PosStatus = { adapter: string; capabilities: Record<string, boolean>; locationRef: string | null; stock: { lastSyncedAt: string | null; skusWithoutStockData: string[]; skusWithoutStockCount: number }; ordersByPosSyncStatus: Record<string, number>; deadJobsByType: Record<string, number> };

function Pos() {
  const { s } = useStore();
  const toast = useToast();
  const { data, error, loading, reload } = useFetch<PosStatus>(s('pos/status'));
  const [busy, setBusy] = useState(false);
  if (error) return <ErrorNote message={error} onRetry={reload} />;
  if (loading && !data) return <Loading />;
  if (!data) return null;
  const none = data.adapter === 'none';
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card title="Connection">
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between"><dt className="text-muted">Adapter</dt><dd><Badge tone={none ? 'warn' : 'ok'}>{none ? 'None (no POS connected)' : data.adapter}</Badge></dd></div>
          <div className="flex justify-between"><dt className="text-muted">Location</dt><dd>{data.locationRef ?? '—'}</dd></div>
          {Object.entries(data.capabilities).map(([k, v]) => <div key={k} className="flex justify-between"><dt className="text-muted">{humanize(k.replace(/([A-Z])/g, ' $1').toLowerCase())}</dt><dd>{v ? 'Supported' : 'Not available'}</dd></div>)}
        </dl>
        {none && <p className="mt-3 text-xs text-muted">No real POS is connected. Stock comes from a stand-in stock table, and orders are not sent anywhere.</p>}
      </Card>
      <Card title="Stock">
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between"><dt className="text-muted">Last refreshed</dt><dd>{dateTime(data.stock.lastSyncedAt)}</dd></div>
          <div className="flex justify-between"><dt className="text-muted">SKUs without stock data</dt><dd>{data.stock.skusWithoutStockCount}</dd></div>
        </dl>
        {data.stock.skusWithoutStockData.length > 0 && <p className="mt-2 break-words font-mono text-xs text-muted">{data.stock.skusWithoutStockData.slice(0, 20).join(', ')}</p>}
        <button className="btn-secondary mt-4" disabled={busy || !data.capabilities.getStock} title={data.capabilities.getStock ? undefined : 'The configured POS adapter cannot read stock'} onClick={async () => { setBusy(true); try { await api(s('pos/stock-sync'), { method: 'POST' }); toast('ok', 'Stock refresh queued.'); await reload(); } catch (e) { toast('error', errorText(e)); } finally { setBusy(false); } }}>
          {busy ? 'Queuing…' : 'Queue stock refresh'}
        </button>
        {!data.capabilities.getStock && <p className="mt-2 text-xs text-muted">Disabled: this adapter cannot read stock.</p>}
      </Card>
      <Card title="Orders by POS sync status" className="lg:col-span-2">
        {Object.keys(data.ordersByPosSyncStatus).length === 0 ? <p className="text-sm text-muted">No orders yet.</p> : <div className="flex flex-wrap gap-4">{Object.entries(data.ordersByPosSyncStatus).map(([k, n]) => <div key={k}><Badge tone={statusTone(k)}>{humanize(k)}</Badge> <b className="ml-1">{n}</b></div>)}</div>}
        {Object.keys(data.deadJobsByType).length > 0 && <p className="mt-3 text-sm text-danger">Failed jobs: {Object.entries(data.deadJobsByType).map(([k, n]) => `${k} (${n})`).join(', ')}</p>}
      </Card>
    </div>
  );
}

type Job = { id: string; type: string; status: string; attempts: number; maxAttempts?: number; lastError: string | null; runAt?: string; createdAt: string; updatedAt?: string };
function Jobs() {
  const { s } = useStore();
  const toast = useToast();
  const [status, setStatus] = useState('dead');
  const { data, error, loading, reload } = useFetch<{ items: Job[] }>(`${s('jobs')}?status=${status}`);
  const [busy, setBusy] = useState<string | null>(null);
  return (
    <>
      <div className="mb-4 max-w-xs">
        <label htmlFor="js" className="sr-only">Job status</label>
        <select id="js" className="field" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="dead">Failed (dead)</option><option value="queued">Queued</option><option value="running">Running</option><option value="succeeded">Succeeded</option>
        </select>
      </div>
      {error && <ErrorNote message={error} onRetry={reload} />}
      {loading && !data && <Loading />}
      {data && (
        <DataTable head={['Job', 'Status', 'Attempts', 'Last error', 'Created', '']} empty={data.items.length === 0 ? <Empty title={`No ${status} jobs`} /> : undefined}>
          {data.items.map((j) => (
            <tr key={j.id}>
              <td className="td font-mono text-xs">{j.type}</td>
              <td className="td"><Badge tone={statusTone(j.status)}>{j.status}</Badge></td>
              <td className="td">{j.attempts}{j.maxAttempts ? ` / ${j.maxAttempts}` : ''}</td>
              <td className="td max-w-xs truncate text-xs text-muted" title={j.lastError ?? ''}>{j.lastError ?? '—'}</td>
              <td className="td text-muted">{dateTime(j.createdAt)}</td>
              <td className="td text-right">{j.status === 'dead' && <button className="btn-secondary" disabled={busy === j.id} onClick={async () => { setBusy(j.id); try { await api(s(`jobs/${j.id}/retry`), { method: 'POST' }); toast('ok', 'Job re-queued.'); await reload(); } catch (e) { toast('error', errorText(e)); } finally { setBusy(null); } }}>Retry</button>}</td>
            </tr>
          ))}
        </DataTable>
      )}
    </>
  );
}

type AuditRow = { id: string; action: string; entityType: string; entityId: string | null; actorType?: string; actorId?: string | null; actorEmail?: string | null; changes?: unknown; createdAt: string };
function Audit() {
  const { s } = useStore();
  const [entityType, setEntityType] = useState('');
  const qs = new URLSearchParams({ limit: '30' });
  if (entityType.trim()) qs.set('entityType', entityType.trim());
  const list = useList<AuditRow>(`${s('audit-logs')}?${qs}`);
  return (
    <>
      <div className="mb-4 max-w-xs"><Field label="Filter by entity type">{(p) => <input {...p} className="field" placeholder="e.g. product, order, promotion" value={entityType} onChange={(e) => setEntityType(e.target.value)} />}</Field></div>
      {list.error && <ErrorNote message={list.error} onRetry={list.reload} />}
      <DataTable head={['When', 'Action', 'Entity', 'By']} empty={!list.loading && list.items.length === 0 && !list.error ? <Empty title="No audit entries" /> : undefined}>
        {list.items.map((a) => (
          <tr key={a.id}>
            <td className="td whitespace-nowrap text-muted">{dateTime(a.createdAt)}</td>
            <td className="td font-medium">{a.action}</td>
            <td className="td">{a.entityType}{a.entityId && <span className="ml-1 font-mono text-xs text-muted">{a.entityId.slice(0, 8)}</span>}</td>
            <td className="td text-muted">{a.actorEmail ?? a.actorType ?? a.actorId ?? '—'}</td>
          </tr>
        ))}
      </DataTable>
      <LoadMore hasMore={list.hasMore} loading={list.loading} onClick={list.loadMore} />
    </>
  );
}

type Sales = { currency: string; daily: { day: string; orders: number; totalPaise: number; discountPaise: number; refundedPaise: number }[]; topSkus: { skuCode: string; title: string; units: number; revenuePaise: number }[] };
const iso = (d: Date) => d.toISOString().slice(0, 10);
function Reports() {
  const { s } = useStore();
  const initial = useMemo(() => ({ from: iso(new Date(Date.now() - 29 * 86_400_000)), to: iso(new Date(Date.now() + 86_400_000)) }), []);
  const [range, setRange] = useState(initial);
  const valid = range.from && range.to && range.to > range.from;
  const { data, error, loading, reload } = useFetch<Sales>(valid ? `${s('reports/sales')}?from=${range.from}&to=${range.to}` : null);
  const totals = data?.daily.reduce((a, d) => ({ orders: a.orders + d.orders, total: a.total + d.totalPaise, discount: a.discount + d.discountPaise, refunded: a.refunded + d.refundedPaise }), { orders: 0, total: 0, discount: 0, refunded: 0 });
  return (
    <>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Field label="From">{(p) => <input {...p} type="date" className="field" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />}</Field>
        <Field label="Up to (not including)">{(p) => <input {...p} type="date" className="field" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />}</Field>
      </div>
      {!valid && <ErrorNote message="Choose an end date after the start date (maximum 366 days)." />}
      {error && <ErrorNote message={error} onRetry={reload} />}
      {loading && !data && <Loading />}
      {data && totals && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-4">
            {[['Orders', String(totals.orders)], ['Order value', money(totals.total)], ['Discounts', money(totals.discount)], ['Refunded', money(totals.refunded)]].map(([k, v]) => <div key={k} className="card p-4"><p className="text-xs uppercase tracking-wide text-muted">{k}</p><p className="mt-1 font-display text-3xl font-semibold text-accent">{v}</p></div>)}
          </div>
          <p className="text-xs text-muted">Excludes cancelled orders. Days are in the store&apos;s timezone.</p>
          <DataTable head={['Day', 'Orders', 'Value', 'Discounts', 'Refunded']} empty={data.daily.length === 0 ? <Empty title="No orders in this period" /> : undefined}>
            {data.daily.map((d) => <tr key={d.day}><td className="td">{d.day}</td><td className="td">{d.orders}</td><td className="td font-medium">{money(d.totalPaise)}</td><td className="td">{money(d.discountPaise)}</td><td className="td">{money(d.refundedPaise)}</td></tr>)}
          </DataTable>
          {data.topSkus.length > 0 && (
            <DataTable head={['SKU', 'Product', 'Units', 'Revenue']}>
              {data.topSkus.map((t) => <tr key={t.skuCode}><td className="td font-mono text-xs">{t.skuCode}</td><td className="td">{t.title}</td><td className="td">{t.units}</td><td className="td font-medium">{money(t.revenuePaise)}</td></tr>)}
            </DataTable>
          )}
        </div>
      )}
    </>
  );
}
