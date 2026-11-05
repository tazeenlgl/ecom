'use client';

import { useId, useState } from 'react';
import { errorMessage, sf } from '@/lib/client-api';
import { INDIAN_STATES, type Address } from '@/lib/types';

const empty = { name: '', phone: '', line1: '', line2: '', landmark: '', city: '', state: '', pincode: '', isDefault: false };

type Values = typeof empty;
type Checked = 'name' | 'phone' | 'pincode' | 'line1' | 'city' | 'state';

/** Same rules the API enforces (see apps/api customers routes); these only give earlier, clearer feedback. */
const rules: Record<Checked, (f: Values) => string | null> = {
  name: (f) => (f.name.trim() ? null : 'Enter your full name.'),
  phone: (f) => (/^[6-9]\d{9}$/.test(f.phone.trim()) ? null : 'Enter a valid 10-digit Indian mobile number.'),
  pincode: (f) => (/^[1-9]\d{5}$/.test(f.pincode.trim()) ? null : 'Enter a valid 6-digit PIN code.'),
  line1: (f) => (f.line1.trim() ? null : 'Enter the flat, house or building.'),
  city: (f) => (f.city.trim() ? null : 'Enter your city.'),
  state: (f) => (f.state ? null : 'Select your state.'),
};
const order: Checked[] = ['name', 'phone', 'pincode', 'line1', 'city', 'state'];

/**
 * `defaultLocked`: the address is (or, being the first, will be) the default, which cannot be switched off by
 * editing it; choose another address as the default instead. Omit it to leave the choice to the customer.
 */
export function AddressForm({ initial, onSaved, onCancel, defaultLocked }: { initial?: Address; onSaved: (a: Address) => void; onCancel?: () => void; defaultLocked?: 'current' | 'first' }) {
  const uid = useId();
  const [f, setF] = useState({ ...empty, ...initial, line2: initial?.line2 ?? '', landmark: initial?.landmark ?? '', phone: initial?.phone?.replace(/^\+?91/, '') ?? '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState<Partial<Record<Checked, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF((s) => ({ ...s, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value }));

  const id = (k: string) => `${uid}-${k}`;
  const problems = Object.fromEntries(order.map((k) => [k, rules[k](f)])) as Record<Checked, string | null>;
  const shown = (k: Checked) => (submitted || touched[k] ? problems[k] : null);
  const blur = (k: Checked) => () => setTouched((t) => ({ ...t, [k]: true }));
  const field = (k: Checked, label: string, className?: string) => ({ id: id(k), label, className, error: shown(k), required: true as const });

  return (
    <form
      noValidate
      aria-label={initial ? 'Edit address' : 'New address'}
      className="grid gap-4 sm:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const firstBad = order.find((k) => problems[k]);
        if (firstBad) {
          setSubmitted(true);
          setError(null);
          document.getElementById(id(firstBad))?.focus();
          return;
        }
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
      <Field {...field('name', 'Full name', 'sm:col-span-2')}>
        {(p) => <input {...p} className="field" autoComplete="name" value={f.name} onChange={set('name')} onBlur={blur('name')} />}
      </Field>
      <Field {...field('phone', 'Mobile number')}>
        {(p) => <input {...p} className="field" type="tel" inputMode="numeric" autoComplete="tel-national" maxLength={10} value={f.phone} onChange={set('phone')} onBlur={blur('phone')} />}
      </Field>
      <Field {...field('pincode', 'PIN code')}>
        {(p) => <input {...p} className="field" inputMode="numeric" autoComplete="postal-code" maxLength={6} pattern="[1-9][0-9]{5}" value={f.pincode} onChange={set('pincode')} onBlur={blur('pincode')} />}
      </Field>
      <Field {...field('line1', 'Flat, house, building', 'sm:col-span-2')}>
        {(p) => <input {...p} className="field" autoComplete="address-line1" value={f.line1} onChange={set('line1')} onBlur={blur('line1')} />}
      </Field>
      <Field id={id('line2')} label="Area, street (optional)" className="sm:col-span-2">
        {(p) => <input {...p} className="field" autoComplete="address-line2" value={f.line2} onChange={set('line2')} />}
      </Field>
      <Field id={id('landmark')} label="Landmark (optional)" className="sm:col-span-2">
        {(p) => <input {...p} className="field" value={f.landmark} onChange={set('landmark')} />}
      </Field>
      <Field {...field('city', 'City')}>
        {(p) => <input {...p} className="field" autoComplete="address-level2" value={f.city} onChange={set('city')} onBlur={blur('city')} />}
      </Field>
      <Field {...field('state', 'State')}>
        {(p) => (
          <select {...p} className="field" autoComplete="address-level1" value={f.state} onChange={set('state')} onBlur={blur('state')}>
            <option value="" disabled>Select state</option>
            {INDIAN_STATES.map((s) => <option key={s}>{s}</option>)}
          </select>
        )}
      </Field>
      <div className="sm:col-span-2">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={defaultLocked ? true : f.isDefault}
            disabled={Boolean(defaultLocked)}
            aria-describedby={defaultLocked ? id('default-hint') : undefined}
            onChange={set('isDefault')}
            className="accent-[var(--brand-accent)]"
          />{' '}
          Make this my default address
        </label>
        {defaultLocked && (
          <p id={id('default-hint')} className="mt-1 text-xs text-muted">
            {defaultLocked === 'first' ? 'Your first address is saved as your default.' : 'This is your default address. To change it, make another address the default.'}
          </p>
        )}
      </div>
      {submitted && order.some((k) => problems[k]) && (
        <p className="text-sm text-sale sm:col-span-2" role="alert">Please fix the highlighted fields.</p>
      )}
      {error && <p className="text-sm text-sale sm:col-span-2" role="alert">{error}</p>}
      <div className="flex gap-3 sm:col-span-2">
        <button className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save address'}</button>
        {onCancel && <button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  );
}

type ControlProps = { id: string; 'aria-invalid'?: true; 'aria-describedby'?: string; 'aria-required'?: true; required?: true };

function Field({ id, label, error, required, className = '', children }: { id: string; label: string; error?: string | null; required?: true; className?: string; children: (p: ControlProps) => React.ReactNode }) {
  const errId = `${id}-error`;
  return (
    <div className={className}>
      <label htmlFor={id} className="label">{label}</label>
      {children({ id, required, 'aria-required': required, 'aria-invalid': error ? true : undefined, 'aria-describedby': error ? errId : undefined })}
      {error && <p id={errId} className="mt-1.5 text-xs text-sale">{error}</p>}
    </div>
  );
}
