'use client';

import { useState } from 'react';
import { errorMessage, sf } from '@/lib/client-api';
import { INDIAN_STATES, type Address } from '@/lib/types';

const empty = { name: '', phone: '', line1: '', line2: '', landmark: '', city: '', state: '', pincode: '', isDefault: false };

export function AddressForm({ initial, onSaved, onCancel }: { initial?: Address; onSaved: (a: Address) => void; onCancel?: () => void }) {
  const [f, setF] = useState({ ...empty, ...initial, line2: initial?.line2 ?? '', landmark: initial?.landmark ?? '', phone: initial?.phone?.replace(/^\+?91/, '') ?? '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF((s) => ({ ...s, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value }));

  return (
    <form
      className="grid gap-4 sm:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          const body = { ...f, line2: f.line2 || null, landmark: f.landmark || null };
          const { address } = initial
            ? await sf<{ address: Address }>(`me/addresses/${initial.id}`, { method: 'PATCH', body })
            : await sf<{ address: Address }>('me/addresses', { method: 'POST', body });
          onSaved(address);
        } catch (err) {
          setError(errorMessage(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <Field label="Full name" className="sm:col-span-2"><input required className="field" autoComplete="name" value={f.name} onChange={set('name')} /></Field>
      <Field label="Mobile number"><input required className="field" inputMode="numeric" autoComplete="tel-national" maxLength={10} value={f.phone} onChange={set('phone')} /></Field>
      <Field label="PIN code"><input required className="field" inputMode="numeric" autoComplete="postal-code" maxLength={6} pattern="[1-9][0-9]{5}" value={f.pincode} onChange={set('pincode')} /></Field>
      <Field label="Flat, house, building" className="sm:col-span-2"><input required className="field" autoComplete="address-line1" value={f.line1} onChange={set('line1')} /></Field>
      <Field label="Area, street (optional)" className="sm:col-span-2"><input className="field" autoComplete="address-line2" value={f.line2} onChange={set('line2')} /></Field>
      <Field label="Landmark (optional)" className="sm:col-span-2"><input className="field" value={f.landmark} onChange={set('landmark')} /></Field>
      <Field label="City"><input required className="field" autoComplete="address-level2" value={f.city} onChange={set('city')} /></Field>
      <Field label="State">
        <select required className="field" value={f.state} onChange={set('state')}>
          <option value="" disabled>Select state</option>
          {INDIAN_STATES.map((s) => <option key={s}>{s}</option>)}
        </select>
      </Field>
      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input type="checkbox" checked={f.isDefault} onChange={set('isDefault')} className="accent-[var(--brand-accent)]" /> Make this my default address
      </label>
      {error && <p className="text-sm text-sale sm:col-span-2" role="alert">{error}</p>}
      <div className="flex gap-3 sm:col-span-2">
        <button className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save address'}</button>
        {onCancel && <button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  );
}

function Field({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="label">{label}</span>
      {children}
    </label>
  );
}
