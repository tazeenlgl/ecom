'use client';

import Link from 'next/link';
import { useState } from 'react';
import { z } from 'zod';
import { useSession } from '@/components/session';
import { Badge, Denied, ErrorNote, Field, Modal, PageHeader, DataTable, statusTone, useToast, validate } from '@/components/ui';
import { api, errorText } from '@/lib/client';
import { slugify } from '@/lib/format';
import { useFetch } from '@/lib/hooks';

type Brand = { id: string; name: string; status: string };
const schema = z.object({
  brandId: z.string().min(1, 'Choose a brand.'),
  name: z.string().trim().min(1, 'Enter a name.').max(120),
  slug: z.string().trim().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Lowercase letters, numbers and hyphens only.').max(60),
});

export default function StoresPage() {
  const { stores, can } = useSession();
  const [creating, setCreating] = useState(false);
  if (!can('platform.stores.manage')) return <Denied what="manage stores" />;
  return (
    <>
      <PageHeader title="Stores" subtitle="Every store you can access. New stores start without domains; add one under the store's settings." actions={<button className="btn-primary" onClick={() => setCreating(true)}>New store</button>} />
      <DataTable head={['Store', 'Slug', 'Status', 'Locale', '']}>
        {stores.map((s) => (
          <tr key={s.id}>
            <td className="td font-medium">{s.name}</td>
            <td className="td text-muted">{s.slug}</td>
            <td className="td"><Badge tone={statusTone(s.status)}>{s.status}</Badge></td>
            <td className="td text-muted">{s.locale}</td>
            <td className="td text-right"><Link className="btn-secondary" href={`/s/${s.id}/settings`}>Settings</Link></td>
          </tr>
        ))}
      </DataTable>
      {creating && <CreateStore onClose={() => setCreating(false)} />}
    </>
  );
}

function CreateStore({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const brands = useFetch<{ items: Brand[] }>('brands');
  const [f, setF] = useState({ brandId: '', name: '', slug: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="New store" onClose={onClose}>
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
            await api('stores', { method: 'POST', body: v.data });
            toast('ok', 'Store created. Reloading the store list…');
            window.location.assign('/platform/stores');
          } catch (err) {
            setError(errorText(err));
            setBusy(false);
          }
        }}
      >
        <Field label="Brand" error={errors.brandId}>
          {(p) => (
            <select {...p} className="field" value={f.brandId} onChange={(e) => setF({ ...f, brandId: e.target.value })}>
              <option value="">Select a brand…</option>
              {brands.data?.items.filter((b) => b.status === 'active').map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
        </Field>
        <Field label="Store name" error={errors.name}>{(p) => <input {...p} className="field" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value, slug: f.slug || slugify(e.target.value) })} />}</Field>
        <Field label="Slug" error={errors.slug}>{(p) => <input {...p} className="field" value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value })} />}</Field>
        {brands.error && <ErrorNote message={brands.error} />}
        {error && <ErrorNote message={error} />}
        <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create store'}</button></div>
      </form>
    </Modal>
  );
}
