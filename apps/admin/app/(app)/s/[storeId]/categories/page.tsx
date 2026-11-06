'use client';

import { useState } from 'react';
import { z } from 'zod';
import { useStore } from '@/components/store-context';
import { Badge, DataTable, Denied, Empty, ErrorNote, Field, Loading, Modal, PageHeader, useToast, validate } from '@/components/ui';
import { api, errorText } from '@/lib/client';
import { slugify } from '@/lib/format';
import { useFetch } from '@/lib/hooks';

type Category = { id: string; slug: string; name: string; description: string | null; parentId: string | null; position: number; isActive: boolean };
const schema = z.object({
  name: z.string().trim().min(1, 'Enter a name.').max(120),
  slug: z.string().trim().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Lowercase letters, numbers and hyphens only.').max(120),
  position: z.string().regex(/^\d{1,4}$/, 'Whole number, 0 or more.'),
  description: z.string().max(2000),
});

export default function CategoriesPage() {
  const { s, can } = useStore();
  const { data, error, loading, reload } = useFetch<{ items: Category[] }>(can('catalogue.read') ? s('categories') : null);
  const [editing, setEditing] = useState<Category | 'new' | null>(null);
  if (!can('catalogue.read')) return <Denied what="view categories" />;
  const items = [...(data?.items ?? [])].sort((a, b) => a.position - b.position);
  const name = (id: string | null) => items.find((c) => c.id === id)?.name ?? '—';
  return (
    <>
      <PageHeader title="Categories" subtitle="Categories can have subcategories (choose a parent)." actions={can('catalogue.write') && <button className="btn-primary" onClick={() => setEditing('new')}>New category</button>} />
      {error && <ErrorNote message={error} onRetry={reload} />}
      {loading && !data && <Loading />}
      {data && (
        <DataTable head={['Name', 'Slug', 'Parent', 'Order', 'Visible', '']} empty={items.length === 0 ? <Empty title="No categories yet" /> : undefined}>
          {items.map((c) => (
            <tr key={c.id}>
              <td className="td font-medium">{c.parentId ? '↳ ' : ''}{c.name}</td>
              <td className="td text-muted">{c.slug}</td>
              <td className="td text-muted">{c.parentId ? name(c.parentId) : '—'}</td>
              <td className="td">{c.position}</td>
              <td className="td"><Badge tone={c.isActive ? 'ok' : 'neutral'}>{c.isActive ? 'Visible' : 'Hidden'}</Badge></td>
              <td className="td text-right">{can('catalogue.write') && <button className="btn-secondary" onClick={() => setEditing(c)}>Edit</button>}</td>
            </tr>
          ))}
        </DataTable>
      )}
      {editing && <CategoryModal category={editing === 'new' ? null : editing} all={items} onClose={() => setEditing(null)} onDone={async () => { setEditing(null); await reload(); }} />}
    </>
  );
}

function CategoryModal({ category, all, onClose, onDone }: { category: Category | null; all: Category[]; onClose: () => void; onDone: () => Promise<void> }) {
  const { s } = useStore();
  const toast = useToast();
  const [f, setF] = useState({ name: category?.name ?? '', slug: category?.slug ?? '', position: String(category?.position ?? all.length + 1), description: category?.description ?? '', parentId: category?.parentId ?? '', isActive: category?.isActive ?? true });
  const [slugTouched, setSlugTouched] = useState(Boolean(category));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={category ? `Edit ${category.name}` : 'New category'} onClose={onClose}>
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
          const body = { name: v.data.name, slug: v.data.slug, position: Number(v.data.position), description: v.data.description.trim() || null, parentId: f.parentId || null, isActive: f.isActive };
          try {
            await api(category ? s(`categories/${category.id}`) : s('categories'), { method: category ? 'PATCH' : 'POST', body });
            toast('ok', category ? 'Category saved.' : 'Category created.');
            await onDone();
          } catch (err) {
            setError(errorText(err));
            setBusy(false);
          }
        }}
      >
        <Field label="Name" error={errors.name}>{(p) => <input {...p} className="field" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value, slug: slugTouched ? f.slug : slugify(e.target.value) })} />}</Field>
        <Field label="Slug" error={errors.slug}>{(p) => <input {...p} className="field" value={f.slug} onChange={(e) => (setSlugTouched(true), setF({ ...f, slug: e.target.value }))} />}</Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Parent category">
            {(p) => (
              <select {...p} className="field" value={f.parentId} onChange={(e) => setF({ ...f, parentId: e.target.value })}>
                <option value="">None (top level)</option>
                {all.filter((c) => c.id !== category?.id && !c.parentId).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
          </Field>
          <Field label="Display order" error={errors.position}>{(p) => <input {...p} inputMode="numeric" className="field" value={f.position} onChange={(e) => setF({ ...f, position: e.target.value })} />}</Field>
        </div>
        <Field label="Description (optional)" error={errors.description}>{(p) => <textarea {...p} className="field" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />}</Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /> Visible on the storefront</label>
        {error && <ErrorNote message={error} />}
        <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></div>
      </form>
    </Modal>
  );
}
