'use client';

import { useState } from 'react';
import { z } from 'zod';
import { useSession } from '@/components/session';
import { Badge, Confirm, DataTable, Denied, Empty, ErrorNote, Field, Loading, Modal, PageHeader, statusTone, useToast, validate } from '@/components/ui';
import { api, errorText } from '@/lib/client';
import { dateOnly, slugify } from '@/lib/format';
import { useFetch } from '@/lib/hooks';

type Brand = { id: string; slug: string; name: string; status: 'active' | 'archived'; createdAt: string };
const schema = z.object({ name: z.string().trim().min(1, 'Enter a name.').max(120), slug: z.string().trim().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Lowercase letters, numbers and hyphens only.').max(60) });

export default function BrandsPage() {
  const { can } = useSession();
  const toast = useToast();
  const { data, error, loading, reload } = useFetch<{ items: Brand[] }>(can('platform.brands.manage') ? 'brands' : null);
  const [creating, setCreating] = useState(false);
  const [toggle, setToggle] = useState<Brand | null>(null);
  const [busy, setBusy] = useState(false);

  if (!can('platform.brands.manage')) return <Denied what="manage brands" />;

  return (
    <>
      <PageHeader title="Brands" subtitle="A brand groups one or more stores." actions={<button className="btn-primary" onClick={() => setCreating(true)}>New brand</button>} />
      {error && <ErrorNote message={error} onRetry={reload} />}
      {loading && !data && <Loading />}
      {data && (
        <DataTable head={['Name', 'Slug', 'Status', 'Created', '']} empty={data.items.length === 0 ? <Empty title="No brands yet" /> : undefined}>
          {data.items.map((b) => (
            <tr key={b.id}>
              <td className="td font-medium">{b.name}</td>
              <td className="td text-muted">{b.slug}</td>
              <td className="td"><Badge tone={statusTone(b.status)}>{b.status}</Badge></td>
              <td className="td text-muted">{dateOnly(b.createdAt)}</td>
              <td className="td text-right">
                <button className="btn-secondary" onClick={() => setToggle(b)}>{b.status === 'active' ? 'Archive' : 'Restore'}</button>
              </td>
            </tr>
          ))}
        </DataTable>
      )}
      {creating && <CreateBrand onClose={() => setCreating(false)} onDone={() => { setCreating(false); toast('ok', 'Brand created.'); void reload(); }} />}
      {toggle && (
        <Confirm
          title={toggle.status === 'active' ? 'Archive brand' : 'Restore brand'}
          body={<>Set <b>{toggle.name}</b> to {toggle.status === 'active' ? 'archived' : 'active'}?</>}
          confirmLabel={toggle.status === 'active' ? 'Archive' : 'Restore'}
          danger={toggle.status === 'active'}
          busy={busy}
          onClose={() => setToggle(null)}
          onConfirm={async () => {
            setBusy(true);
            try {
              await api(`brands/${toggle.id}`, { method: 'PATCH', body: { status: toggle.status === 'active' ? 'archived' : 'active' } });
              toast('ok', 'Brand updated.');
              setToggle(null);
              void reload();
            } catch (e) {
              toast('error', errorText(e));
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
    </>
  );
}

function CreateBrand({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ name: '', slug: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="New brand" onClose={onClose}>
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
            await api('brands', { method: 'POST', body: v.data });
            onDone();
          } catch (err) {
            setError(errorText(err));
            setBusy(false);
          }
        }}
      >
        <Field label="Name" error={errors.name}>{(p) => <input {...p} className="field" value={f.name} onChange={(e) => setF({ name: e.target.value, slug: f.slug || slugify(e.target.value) })} />}</Field>
        <Field label="Slug" error={errors.slug} hint="Used in URLs; cannot be changed later.">{(p) => <input {...p} className="field" value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value })} />}</Field>
        {error && <ErrorNote message={error} />}
        <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create brand'}</button></div>
      </form>
    </Modal>
  );
}
