'use client';

import { useState } from 'react';
import { z } from 'zod';
import { useSession } from '@/components/session';
import { RolesModal } from './roles-modal';
import { Badge, Confirm, DataTable, Denied, ErrorNote, Field, Loading, Modal, PageHeader, statusTone, useToast, validate } from '@/components/ui';
import { api, errorText } from '@/lib/client';
import { dateTime } from '@/lib/format';
import { useFetch } from '@/lib/hooks';

type AdminUser = { id: string; email: string; name: string; status: 'active' | 'disabled'; lastLoginAt: string | null; createdAt: string };
type GrantRow = { id: string; role: string; storeId: string | null };

const createSchema = z.object({ email: z.email('Enter a valid email.').max(200), name: z.string().trim().min(1, 'Enter a name.').max(120), password: z.string().min(12, 'At least 12 characters.').max(200) });

export default function AdminsPage() {
  const { can, admin: me } = useSession();
  const toast = useToast();
  const { data, error, loading, reload } = useFetch<{ items: AdminUser[] }>(can('platform.admins.manage') ? 'admin-users' : null);
  const [creating, setCreating] = useState(false);
  const [roles, setRoles] = useState<AdminUser | null>(null);
  const [toggle, setToggle] = useState<AdminUser | null>(null);
  const [busy, setBusy] = useState(false);

  if (!can('platform.admins.manage')) return <Denied what="manage administrators" />;

  return (
    <>
      <PageHeader title="Administrators" subtitle="Staff accounts and their role grants. Multi-factor authentication is not available yet." actions={<button className="btn-primary" onClick={() => setCreating(true)}>New administrator</button>} />
      {error && <ErrorNote message={error} onRetry={reload} />}
      {loading && !data && <Loading />}
      {data && (
        <DataTable head={['Name', 'Email', 'Status', 'Last sign-in', '']}>
          {data.items.map((a) => (
            <tr key={a.id}>
              <td className="td font-medium">{a.name}{a.id === me.id && <span className="ml-2 text-xs text-muted">(you)</span>}</td>
              <td className="td">{a.email}</td>
              <td className="td"><Badge tone={statusTone(a.status)}>{a.status}</Badge></td>
              <td className="td text-muted">{dateTime(a.lastLoginAt)}</td>
              <td className="td text-right">
                <div className="flex justify-end gap-2">
                  <button className="btn-secondary" onClick={() => setRoles(a)}>Roles</button>
                  <button className="btn-secondary" disabled={a.id === me.id} title={a.id === me.id ? 'You cannot disable your own account here' : undefined} onClick={() => setToggle(a)}>{a.status === 'active' ? 'Disable' : 'Enable'}</button>
                </div>
              </td>
            </tr>
          ))}
        </DataTable>
      )}
      {creating && <CreateAdmin onClose={() => setCreating(false)} onDone={() => { setCreating(false); toast('ok', 'Administrator created. Grant a role so they can sign in to something.'); void reload(); }} />}
      {roles && <RolesModal admin={roles} onClose={() => setRoles(null)} />}
      {toggle && (
        <Confirm
          title={toggle.status === 'active' ? 'Disable administrator' : 'Enable administrator'}
          body={<>{toggle.status === 'active' ? 'Disabling ends their access immediately.' : 'Re-enable access for'} <b>{toggle.email}</b>?</>}
          confirmLabel={toggle.status === 'active' ? 'Disable' : 'Enable'}
          danger={toggle.status === 'active'}
          busy={busy}
          onClose={() => setToggle(null)}
          onConfirm={async () => {
            setBusy(true);
            try {
              await api(`admin-users/${toggle.id}`, { method: 'PATCH', body: { status: toggle.status === 'active' ? 'disabled' : 'active' } });
              toast('ok', 'Account updated.');
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

function CreateAdmin({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ email: '', name: '', password: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="New administrator" onClose={onClose}>
      <form
        noValidate
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const v = validate(createSchema, f);
          setErrors(v.errors);
          if (!v.data) return;
          setBusy(true);
          setError(null);
          try {
            await api('admin-users', { method: 'POST', body: v.data });
            onDone();
          } catch (err) {
            setError(errorText(err));
            setBusy(false);
          }
        }}
      >
        <Field label="Name" error={errors.name}>{(p) => <input {...p} className="field" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
        <Field label="Email" error={errors.email}>{(p) => <input {...p} type="email" className="field" autoComplete="off" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />}</Field>
        <Field label="Initial password" error={errors.password} hint="Share it securely; they should change it. Minimum 12 characters.">{(p) => <input {...p} type="password" className="field" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />}</Field>
        {error && <ErrorNote message={error} />}
        <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create'}</button></div>
      </form>
    </Modal>
  );
}

