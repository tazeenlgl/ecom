'use client';

import { useRef, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { AddressForm } from '@/components/address-form';
import { Dialog } from '@/components/dialog';
import { errorMessage, sf } from '@/lib/client-api';
import type { Address } from '@/lib/types';

export function AddressBook({ initial }: { initial: Address[] }) {
  const [list, setList] = useState(initial);
  const [editing, setEditing] = useState<Address | 'new' | null>(initial.length ? null : 'new');
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<Address | null>(null);
  const [deleting, setDeleting] = useState(false);
  const deleteInFlight = useRef(false);

  // The server decides which address is the default (the first one, or the newest after a delete), so reload the
  // list instead of working it out here. If that fails the page still shows what it had.
  const reload = async () => {
    try {
      setList((await sf<{ items: Address[] }>('me/addresses')).items);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const saved = async () => {
    setEditing(null);
    await reload();
  };

  const remove = async (address: Address) => {
    if (deleteInFlight.current) return;
    deleteInFlight.current = true;
    setDeleting(true);
    try {
      await sf(`me/addresses/${address.id}`, { method: 'DELETE' });
      setConfirming(null);
      await reload();
    } catch (err) {
      setConfirming(null);
      setError(errorMessage(err));
    } finally {
      deleteInFlight.current = false;
      setDeleting(false);
    }
  };

  return (
    <section>
      <div className="mb-6 flex items-center justify-between">
        <h2 className="font-display text-2xl">Addresses</h2>
        {editing === null && <button className="btn-outline" onClick={() => setEditing('new')}>Add address</button>}
      </div>
      {error && <p className="mb-4 text-sm text-sale" role="alert">{error}</p>}
      {editing !== null ? (
        <AddressForm
          initial={editing === 'new' ? undefined : editing}
          defaultLocked={editing === 'new' ? (list.length === 0 ? 'first' : undefined) : editing.isDefault ? 'current' : undefined}
          onSaved={saved}
          onCancel={() => setEditing(null)}
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {list.map((a) => (
            <li key={a.id} className="card p-5 text-sm">
              <div className="flex items-start justify-between gap-2">
                <p className="font-medium">{a.name}</p>
                {a.isDefault && <span className="rounded-full bg-accent/10 px-2 py-0.5 text-xs text-accent">Default</span>}
              </div>
              <p className="mt-1 text-muted">{[a.line1, a.line2, a.landmark].filter(Boolean).join(', ')}</p>
              <p className="text-muted">{a.city}, {a.state} {a.pincode}</p>
              <p className="text-muted">{a.phone}</p>
              <div className="mt-4 flex gap-4 text-xs">
                <button className="underline" onClick={() => setEditing(a)}>Edit</button>
                <button className="text-sale underline" onClick={() => (setError(null), setConfirming(a))}>Delete</button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <AnimatePresence>
        {confirming && (
          <Dialog title="Delete this address?" busy={deleting} onClose={() => setConfirming(null)}>
            <div className="space-y-4">
              <p className="text-sm text-muted">
                {confirming.name}, {[confirming.line1, confirming.line2].filter(Boolean).join(', ')}, {confirming.city} {confirming.pincode}
              </p>
              {confirming.isDefault && list.length > 1 && <p className="text-sm">Your most recently added address will become your default. Orders you have already placed are not affected.</p>}
              {(!confirming.isDefault || list.length === 1) && <p className="text-sm">Orders you have already placed are not affected.</p>}
              <div className="flex flex-col gap-3 sm:flex-row-reverse">
                <button className="btn-primary w-full" disabled={deleting} onClick={() => remove(confirming)}>{deleting ? 'Deleting…' : 'Delete address'}</button>
                <button className="btn-outline w-full" disabled={deleting} onClick={() => setConfirming(null)}>Keep address</button>
              </div>
            </div>
          </Dialog>
        )}
      </AnimatePresence>
    </section>
  );
}
