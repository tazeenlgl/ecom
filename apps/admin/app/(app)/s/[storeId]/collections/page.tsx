'use client';

import { useState } from 'react';
import { z } from 'zod';
import { useStore } from '@/components/store-context';
import { Badge, DataTable, Denied, Empty, ErrorNote, Field, Loading, Modal, PageHeader, useToast, validate } from '@/components/ui';
import { api, errorText } from '@/lib/client';
import { slugify } from '@/lib/format';
import { useFetch, useList } from '@/lib/hooks';

type Collection = { id: string; slug: string; title: string; description: string | null; isActive: boolean };
const schema = z.object({ title: z.string().trim().min(1, 'Enter a title.').max(160), slug: z.string().trim().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Lowercase letters, numbers and hyphens only.').max(120), description: z.string().max(2000) });

export default function CollectionsPage() {
  const { s, can } = useStore();
  const { data, error, loading, reload } = useFetch<{ items: Collection[] }>(can('catalogue.read') ? s('collections') : null);
  const [editing, setEditing] = useState<Collection | 'new' | null>(null);
  const [products, setProducts] = useState<Collection | null>(null);
  if (!can('catalogue.read')) return <Denied what="view collections" />;
  return (
    <>
      <PageHeader title="Collections" subtitle="Hand-picked groups of products, shown at /collections/<slug>." actions={can('catalogue.write') && <button className="btn-primary" onClick={() => setEditing('new')}>New collection</button>} />
      {error && <ErrorNote message={error} onRetry={reload} />}
      {loading && !data && <Loading />}
      {data && (
        <DataTable head={['Title', 'Slug', 'Visible', '']} empty={data.items.length === 0 ? <Empty title="No collections yet" /> : undefined}>
          {data.items.map((c) => (
            <tr key={c.id}>
              <td className="td font-medium">{c.title}</td>
              <td className="td text-muted">{c.slug}</td>
              <td className="td"><Badge tone={c.isActive ? 'ok' : 'neutral'}>{c.isActive ? 'Visible' : 'Hidden'}</Badge></td>
              <td className="td text-right">
                {can('catalogue.write') && (
                  <div className="flex justify-end gap-2">
                    <button className="btn-secondary" onClick={() => setProducts(c)}>Set products</button>
                    <button className="btn-secondary" onClick={() => setEditing(c)}>Edit</button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </DataTable>
      )}
      {editing && <CollectionModal collection={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onDone={async () => { setEditing(null); await reload(); }} />}
      {products && <ProductsModal collection={products} onClose={() => setProducts(null)} />}
    </>
  );
}

function CollectionModal({ collection, onClose, onDone }: { collection: Collection | null; onClose: () => void; onDone: () => Promise<void> }) {
  const { s } = useStore();
  const toast = useToast();
  const [f, setF] = useState({ title: collection?.title ?? '', slug: collection?.slug ?? '', description: collection?.description ?? '', isActive: collection?.isActive ?? true });
  const [slugTouched, setSlugTouched] = useState(Boolean(collection));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={collection ? `Edit ${collection.title}` : 'New collection'} onClose={onClose}>
      <form
        noValidate
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const v = validate(schema, f);
          setErrors(v.errors);
          if (!v.data) return;
          setBusy(true);
          setError(null);
          try {
            await api(collection ? s(`collections/${collection.id}`) : s('collections'), { method: collection ? 'PATCH' : 'POST', body: { title: v.data.title, slug: v.data.slug, description: v.data.description.trim() || null, isActive: f.isActive } });
            toast('ok', collection ? 'Collection saved.' : 'Collection created.');
            await onDone();
          } catch (err) {
            setError(errorText(err));
            setBusy(false);
          }
        }}
      >
        <Field label="Title" error={errors.title}>{(p) => <input {...p} className="field" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value, slug: slugTouched ? f.slug : slugify(e.target.value) })} />}</Field>
        <Field label="Slug" error={errors.slug}>{(p) => <input {...p} className="field" value={f.slug} onChange={(e) => (setSlugTouched(true), setF({ ...f, slug: e.target.value }))} />}</Field>
        <Field label="Description (optional)" error={errors.description}>{(p) => <textarea {...p} className="field" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />}</Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /> Visible on the storefront</label>
        {error && <ErrorNote message={error} />}
        <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></div>
      </form>
    </Modal>
  );
}

function ProductsModal({ collection, onClose }: { collection: Collection; onClose: () => void }) {
  const { s } = useStore();
  const toast = useToast();
  const list = useList<{ id: string; title: string }>(`${s('products')}?status=published&limit=100`);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal title={`Products in ${collection.title}`} onClose={onClose} wide>
      <p className="mb-3 rounded-lg bg-warn/10 px-3 py-2 text-xs text-warn">The API cannot read a collection&apos;s current products. Saving <b>replaces</b> the whole list with the products ticked below, in the order shown.</p>
      {list.error && <ErrorNote message={list.error} />}
      <ul className="max-h-80 divide-y divide-line overflow-y-auto rounded-lg border border-line">
        {list.items.map((p) => (
          <li key={p.id}>
            <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-accent-soft/40">
              <input type="checkbox" checked={picked.includes(p.id)} onChange={() => setPicked((c) => (c.includes(p.id) ? c.filter((x) => x !== p.id) : [...c, p.id]))} />
              {p.title}
            </label>
          </li>
        ))}
      </ul>
      {list.hasMore && <button className="btn-ghost mt-2" onClick={list.loadMore}>Load more products</button>}
      {error && <div className="mt-3"><ErrorNote message={error} /></div>}
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button
          className="btn-primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await api(s(`collections/${collection.id}/products`), { method: 'PUT', body: { productIds: picked } });
              toast('ok', `Collection now has ${picked.length} product(s).`);
              onClose();
            } catch (e) {
              setError(errorText(e));
              setBusy(false);
            }
          }}
        >
          {busy ? 'Saving…' : `Replace with ${picked.length} product(s)`}
        </button>
      </div>
    </Modal>
  );
}
