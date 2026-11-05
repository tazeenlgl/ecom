'use client';

import { useState } from 'react';
import { AddressForm } from '@/components/address-form';
import { errorMessage, sf } from '@/lib/client-api';
import type { Address } from '@/lib/types';

export function AddressBook({ initial }: { initial: Address[] }) {
  const [list, setList] = useState(initial);
  const [editing, setEditing] = useState<Address | 'new' | null>(initial.length ? null : 'new');
  const [error, setError] = useState<string | null>(null);

  const saved = (a: Address) => {
    setList((l) => {
      const rest = l.filter((x) => x.id !== a.id).map((x) => (a.isDefault ? { ...x, isDefault: false } : x));
      return [...rest, a];
    });
    setEditing(null);
  };

  return (
    <section>
      <div className="mb-6 flex items-center justify-between">
        <h2 className="font-display text-2xl">Addresses</h2>
        {editing === null && <button className="btn-outline" onClick={() => setEditing('new')}>Add address</button>}
      </div>
      {error && <p className="mb-4 text-sm text-sale">{error}</p>}
      {editing !== null ? (
        <AddressForm initial={editing === 'new' ? undefined : editing} onSaved={saved} onCancel={() => setEditing(null)} />
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
                <button
                  className="text-sale underline"
                  onClick={async () => {
                    try {
                      await sf(`me/addresses/${a.id}`, { method: 'DELETE' });
                      setList((l) => l.filter((x) => x.id !== a.id));
                    } catch (err) {
                      setError(errorMessage(err));
                    }
                  }}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
