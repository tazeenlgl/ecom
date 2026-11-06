'use client';

import { useState } from 'react';
import { useSession } from '@/components/session';
import { ErrorNote, Field, Modal, useToast } from '@/components/ui';
import { api, errorText } from '@/lib/client';

type Grant = { id: string; role: string; storeId: string | null };

/**
 * Grant and revoke roles. Limitation: the API has no endpoint that lists an administrator's existing grants,
 * so only grants made while this dialog is open can be revoked from here.
 */
export function RolesModal({ admin, onClose }: { admin: { id: string; name: string; email: string }; onClose: () => void }) {
  const { roles, stores } = useSession();
  const toast = useToast();
  const [role, setRole] = useState('store_manager');
  const [scope, setScope] = useState('');
  const [granted, setGranted] = useState<Grant[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = (key: string) => roles.find((r) => r.key === key)?.label ?? key;
  const where = (id: string | null) => (id ? stores.find((s) => s.id === id)?.name ?? id : 'All stores (platform-wide)');

  return (
    <Modal title={`Roles for ${admin.name}`} onClose={onClose} wide>
      <div className="space-y-4">
        <p className="rounded-lg bg-accent-soft px-3 py-2 text-xs text-accent">
          The API cannot list an administrator&apos;s existing role grants. Grants you add in this window are shown below and can be revoked; older grants must be revoked with their grant id through the API.
        </p>
        {granted.length > 0 && (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {granted.map((g) => (
              <li key={g.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span>
                  {label(g.role)} — {where(g.storeId)}
                </span>
                <button
                  className="btn-danger"
                  onClick={async () => {
                    try {
                      await api(`admin-users/${admin.id}/roles/${g.id}`, { method: 'DELETE' });
                      setGranted((r) => r.filter((x) => x.id !== g.id));
                      toast('ok', 'Role revoked.');
                    } catch (e) {
                      toast('error', errorText(e));
                    }
                  }}
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        )}
        <form
          className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              const r = await api<{ grant: Grant }>(`admin-users/${admin.id}/roles`, { method: 'POST', body: { role, storeId: scope || null } });
              setGranted((g) => [...g, r.grant]);
              toast('ok', 'Role granted.');
            } catch (err) {
              setError(errorText(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="Role">
            {(p) => (
              <select {...p} className="field" value={role} onChange={(e) => setRole(e.target.value)}>
                {roles.map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Scope" hint="Store-scoped grants only apply to that store.">
            {(p) => (
              <select {...p} className="field" value={scope} onChange={(e) => setScope(e.target.value)}>
                <option value="">All stores (platform-wide)</option>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} only
                  </option>
                ))}
              </select>
            )}
          </Field>
          <button className="btn-primary" disabled={busy}>
            {busy ? 'Granting…' : 'Grant role'}
          </button>
        </form>
        {error && <ErrorNote message={error} />}
      </div>
    </Modal>
  );
}
