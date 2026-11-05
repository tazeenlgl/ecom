'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useStore } from '@/components/store-context';
import { Badge, DataTable, Denied, Empty, ErrorNote, LoadMore, PageHeader, statusTone } from '@/components/ui';
import { dateOnly } from '@/lib/format';
import { useDebounced, useList } from '@/lib/hooks';

type Product = { id: string; slug: string; title: string; status: string; updatedAt: string };

export default function ProductsPage() {
  const { storeId, s, can } = useStore();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const dq = useDebounced(q);
  const qs = new URLSearchParams({ limit: '25' });
  if (dq.trim()) qs.set('q', dq.trim());
  if (status) qs.set('status', status);
  const list = useList<Product>(can('catalogue.read') ? `${s('products')}?${qs}` : null);

  if (!can('catalogue.read')) return <Denied what="view the catalogue" />;
  return (
    <>
      <PageHeader title="Products" subtitle="Search matches the product title." actions={can('catalogue.write') && <Link className="btn-primary" href={`/s/${storeId}/products/new`}>New product</Link>} />
      <div className="mb-4 flex flex-wrap gap-3">
        <div className="min-w-56 flex-1">
          <label htmlFor="q" className="sr-only">Search products</label>
          <input id="q" className="field" placeholder="Search by title…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div>
          <label htmlFor="st" className="sr-only">Status</label>
          <select id="st" className="field" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            <option value="published">Published</option>
            <option value="draft">Draft</option>
            <option value="archived">Archived</option>
          </select>
        </div>
      </div>
      {list.error && <ErrorNote message={list.error} onRetry={list.reload} />}
      <DataTable head={['Product', 'Slug', 'Status', 'Updated']} empty={!list.loading && list.items.length === 0 && !list.error ? <Empty title="No products found" hint={dq || status ? 'Try clearing the search or filter.' : 'Create the first product.'} /> : undefined}>
        {list.items.map((p) => (
          <tr key={p.id} className="hover:bg-accent-soft/30">
            <td className="td font-medium"><Link className="text-accent hover:underline" href={`/s/${storeId}/products/${p.id}`}>{p.title}</Link></td>
            <td className="td text-muted">{p.slug}</td>
            <td className="td"><Badge tone={statusTone(p.status)}>{p.status}</Badge></td>
            <td className="td text-muted">{dateOnly(p.updatedAt)}</td>
          </tr>
        ))}
      </DataTable>
      {list.loading && <p className="py-4 text-center text-sm text-muted" role="status">Loading…</p>}
      <LoadMore hasMore={list.hasMore} loading={list.loading} onClick={list.loadMore} />
    </>
  );
}
