'use client';

import { useState } from 'react';
import { z } from 'zod';
import { useStore } from '@/components/store-context';
import { Badge, DataTable, Denied, Empty, ErrorNote, Field, Loading, Modal, PageHeader, useToast, validate } from '@/components/ui';
import { api, errorText } from '@/lib/client';
import { fromPaise, money, toPaise } from '@/lib/format';
import { useFetch } from '@/lib/hooks';

type Zone = { id: string; name: string; pincodePrefixes: string[]; chargePaise: number; freeAbovePaise: number | null; codAvailable: boolean; codFeePaise: number; estimatedDaysMin: number | null; estimatedDaysMax: number | null; isActive: boolean };

export default function ShippingPage() {
  const { s, can } = useStore();
  const { data, error, loading, reload } = useFetch<{ items: Zone[] }>(can('store.read') ? s('shipping-zones') : null);
  const [editing, setEditing] = useState<Zone | 'new' | null>(null);
  if (!can('store.read')) return <Denied what="view shipping zones" />;
  return (
    <>
      <PageHeader title="Shipping zones" subtitle="Delivery charges, free-shipping thresholds and cash-on-delivery by PIN code prefix." actions={can('shipping.write') && <button className="btn-primary" onClick={() => setEditing('new')}>New zone</button>} />
      {error && <ErrorNote message={error} onRetry={reload} />}
      {loading && !data && <Loading />}
      {data && (
        <DataTable head={['Zone', 'PIN prefixes', 'Charge', 'Free above', 'COD', 'Delivery', 'Status', '']} empty={data.items.length === 0 ? <Empty title="No shipping zones" hint="Without a zone, customers cannot check out." /> : undefined}>
          {data.items.map((z) => (
            <tr key={z.id}>
              <td className="td font-medium">{z.name}</td>
              <td className="td font-mono text-xs">{z.pincodePrefixes.join(', ')}</td>
              <td className="td">{money(z.chargePaise)}</td>
              <td className="td">{z.freeAbovePaise ? money(z.freeAbovePaise) : '—'}</td>
              <td className="td">{z.codAvailable ? `Yes (${money(z.codFeePaise)} fee)` : 'No'}</td>
              <td className="td text-muted">{z.estimatedDaysMin ? `${z.estimatedDaysMin}–${z.estimatedDaysMax ?? z.estimatedDaysMin} days` : '—'}</td>
              <td className="td"><Badge tone={z.isActive ? 'ok' : 'neutral'}>{z.isActive ? 'Active' : 'Off'}</Badge></td>
              <td className="td text-right">{can('shipping.write') && <button className="btn-secondary" onClick={() => setEditing(z)}>Edit</button>}</td>
            </tr>
          ))}
        </DataTable>
      )}
      {editing && <ZoneModal zone={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onDone={async () => { setEditing(null); await reload(); }} />}
    </>
  );
}

const money0 = z.string().refine((v) => toPaise(v) !== null, 'Enter an amount in rupees.');
const schema = z.object({
  name: z.string().trim().min(1, 'Enter a name.').max(120),
  prefixes: z.string().refine((v) => v.split(',').map((x) => x.trim()).filter(Boolean).length > 0 && v.split(',').map((x) => x.trim()).filter(Boolean).every((x) => /^\d{1,6}$/.test(x)), 'Enter PIN prefixes (1–6 digits) separated by commas.'),
  charge: money0,
  freeAbove: z.string().refine((v) => v === '' || toPaise(v) !== null, 'Enter an amount in rupees.'),
  codFee: money0,
  min: z.string().regex(/^\d{0,3}$/, 'Whole number.'),
  max: z.string().regex(/^\d{0,3}$/, 'Whole number.'),
});

function ZoneModal({ zone, onClose, onDone }: { zone: Zone | null; onClose: () => void; onDone: () => Promise<void> }) {
  const { s } = useStore();
  const toast = useToast();
  const [f, setF] = useState({ name: zone?.name ?? '', prefixes: zone?.pincodePrefixes.join(', ') ?? '', charge: zone ? fromPaise(zone.chargePaise) : '', freeAbove: fromPaise(zone?.freeAbovePaise), codFee: zone ? fromPaise(zone.codFeePaise) : '0', min: String(zone?.estimatedDaysMin ?? ''), max: String(zone?.estimatedDaysMax ?? ''), codAvailable: zone?.codAvailable ?? false, isActive: zone?.isActive ?? true });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  return (
    <Modal title={zone ? `Edit ${zone.name}` : 'New shipping zone'} onClose={onClose} wide>
      <form
        noValidate
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const v = validate(schema, f);
          const er = { ...v.errors };
          if (f.min && f.max && Number(f.max) < Number(f.min)) er.max = 'Cannot be less than the minimum.';
          setErrors(er);
          if (!v.data || Object.keys(er).length) return;
          setBusy(true);
          setError(null);
          try {
            await api(zone ? s(`shipping-zones/${zone.id}`) : s('shipping-zones'), { method: zone ? 'PATCH' : 'POST', body: { name: v.data.name, pincodePrefixes: v.data.prefixes.split(',').map((x) => x.trim()).filter(Boolean), chargePaise: toPaise(f.charge)!, freeAbovePaise: f.freeAbove ? toPaise(f.freeAbove) : null, codAvailable: f.codAvailable, codFeePaise: toPaise(f.codFee)!, estimatedDaysMin: f.min ? Number(f.min) : null, estimatedDaysMax: f.max ? Number(f.max) : null, isActive: f.isActive } });
            toast('ok', zone ? 'Zone saved.' : 'Zone created.');
            await onDone();
          } catch (err) {
            setError(errorText(err));
            setBusy(false);
          }
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Zone name" error={errors.name}>{(p) => <input {...p} className="field" value={f.name} onChange={set('name')} />}</Field>
          <Field label="PIN prefixes" error={errors.prefixes} hint="e.g. 11, 12 or 400001. A customer's PIN matches the longest prefix.">{(p) => <input {...p} className="field" value={f.prefixes} onChange={set('prefixes')} />}</Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Delivery charge (₹)" error={errors.charge}>{(p) => <input {...p} inputMode="decimal" className="field" value={f.charge} onChange={set('charge')} />}</Field>
          <Field label="Free above (₹, optional)" error={errors.freeAbove}>{(p) => <input {...p} inputMode="decimal" className="field" value={f.freeAbove} onChange={set('freeAbove')} />}</Field>
          <Field label="COD fee (₹)" error={errors.codFee}>{(p) => <input {...p} inputMode="decimal" className="field" value={f.codFee} onChange={set('codFee')} />}</Field>
          <Field label="Delivery days, from" error={errors.min}>{(p) => <input {...p} inputMode="numeric" className="field" value={f.min} onChange={set('min')} />}</Field>
          <Field label="Delivery days, to" error={errors.max}>{(p) => <input {...p} inputMode="numeric" className="field" value={f.max} onChange={set('max')} />}</Field>
        </div>
        <div className="flex gap-6 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={f.codAvailable} onChange={set('codAvailable')} /> Cash on delivery available</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={f.isActive} onChange={set('isActive')} /> Zone active</label>
        </div>
        {error && <ErrorNote message={error} />}
        <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save zone'}</button></div>
      </form>
    </Modal>
  );
}
