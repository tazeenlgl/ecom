'use client';

import { useState } from 'react';
import { z } from 'zod';
import { useStore } from '@/components/store-context';
import { Badge, DataTable, Denied, Empty, ErrorNote, Field, Loading, Modal, PageHeader, statusTone, useToast, validate } from '@/components/ui';
import { api, errorText } from '@/lib/client';
import { dateTime, fromPaise, humanize, isoToLocal, localToIso, money, toPaise } from '@/lib/format';
import { useFetch } from '@/lib/hooks';

type Kind = 'percentage' | 'fixed_amount' | 'buy_x_get_y' | 'free_shipping';
type Promotion = { id: string; name: string; kind: Kind; config: Record<string, number>; eligibility: Record<string, unknown>; minSubtotalPaise: number; requiresCoupon: boolean; priority: number; stackable: boolean; status: 'active' | 'inactive'; startsAt: string | null; endsAt: string | null; usageLimit: number | null; perCustomerLimit: number | null; timesUsed: number };
type Coupon = { id: string; code: string; isActive: boolean; usageLimit: number | null; timesUsed?: number };

const describe = (p: Promotion) =>
  p.kind === 'percentage' ? `${p.config.percentBps! / 100}% off${p.config.maxDiscountPaise ? `, up to ${money(p.config.maxDiscountPaise)}` : ''}` :
  p.kind === 'fixed_amount' ? `${money(p.config.amountPaise)} off` :
  p.kind === 'buy_x_get_y' ? `Buy ${p.config.buyQuantity}, get ${p.config.getQuantity} at ${p.config.getDiscountBps! / 100}% off` : 'Free shipping';

export default function PromotionsPage() {
  const { s, can } = useStore();
  const { data, error, loading, reload } = useFetch<{ items: Promotion[] }>(can('catalogue.read') ? s('promotions') : null);
  const [editing, setEditing] = useState<Promotion | 'new' | null>(null);
  const [coupons, setCoupons] = useState<Promotion | null>(null);
  const write = can('promotions.write');
  if (!can('catalogue.read')) return <Denied what="view promotions" />;
  return (
    <>
      <PageHeader title="Promotions" subtitle="Automatic discounts and coupon-code offers." actions={write && <button className="btn-primary" onClick={() => setEditing('new')}>New promotion</button>} />
      {error && <ErrorNote message={error} onRetry={reload} />}
      {loading && !data && <Loading />}
      {data && (
        <DataTable head={['Promotion', 'Offer', 'Applies', 'Valid', 'Used', 'Status', '']} empty={data.items.length === 0 ? <Empty title="No promotions yet" /> : undefined}>
          {data.items.map((p) => (
            <tr key={p.id}>
              <td className="td font-medium">{p.name}</td>
              <td className="td">{describe(p)}{p.minSubtotalPaise > 0 && <span className="block text-xs text-muted">min. {money(p.minSubtotalPaise)}</span>}</td>
              <td className="td text-muted">{p.requiresCoupon ? 'With coupon code' : 'Automatically'}</td>
              <td className="td text-xs text-muted">{p.startsAt || p.endsAt ? `${p.startsAt ? dateTime(p.startsAt) : 'Now'} → ${p.endsAt ? dateTime(p.endsAt) : 'No end'}` : 'Always'}</td>
              <td className="td">{p.timesUsed}{p.usageLimit ? ` / ${p.usageLimit}` : ''}</td>
              <td className="td"><Badge tone={statusTone(p.status)}>{p.status}</Badge></td>
              <td className="td text-right">
                <div className="flex justify-end gap-2">
                  {p.requiresCoupon && <button className="btn-secondary" onClick={() => setCoupons(p)}>Coupons</button>}
                  {write && <button className="btn-secondary" onClick={() => setEditing(p)}>Edit</button>}
                </div>
              </td>
            </tr>
          ))}
        </DataTable>
      )}
      {editing && <PromotionModal promotion={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onDone={async () => { setEditing(null); await reload(); }} />}
      {coupons && <CouponsModal promotion={coupons} onClose={() => setCoupons(null)} />}
    </>
  );
}

const schema = z.object({
  name: z.string().trim().min(1, 'Enter a name.').max(160),
  percent: z.string(), maxDiscount: z.string(), amount: z.string(), buyQuantity: z.string(), getQuantity: z.string(), getPercent: z.string(),
  minSubtotal: z.string().refine((v) => v === '' || toPaise(v) !== null, 'Enter an amount in rupees.'),
  priority: z.string().regex(/^-?\d{1,4}$/, 'Whole number.'),
  usageLimit: z.string().regex(/^\d*$/, 'Whole number.'), perCustomerLimit: z.string().regex(/^\d*$/, 'Whole number.'),
});

function PromotionModal({ promotion, onClose, onDone }: { promotion: Promotion | null; onClose: () => void; onDone: () => Promise<void> }) {
  const { s } = useStore();
  const toast = useToast();
  const c = promotion?.config ?? {};
  const [kind, setKind] = useState<Kind>(promotion?.kind ?? 'percentage');
  const [f, setF] = useState({
    name: promotion?.name ?? '', percent: c.percentBps ? String(c.percentBps / 100) : '', maxDiscount: fromPaise(c.maxDiscountPaise), amount: fromPaise(c.amountPaise),
    buyQuantity: String(c.buyQuantity ?? ''), getQuantity: String(c.getQuantity ?? ''), getPercent: c.getDiscountBps ? String(c.getDiscountBps / 100) : '',
    minSubtotal: promotion?.minSubtotalPaise ? fromPaise(promotion.minSubtotalPaise) : '', priority: String(promotion?.priority ?? 0),
    usageLimit: promotion?.usageLimit ? String(promotion.usageLimit) : '', perCustomerLimit: promotion?.perCustomerLimit ? String(promotion.perCustomerLimit) : '',
    requiresCoupon: promotion?.requiresCoupon ?? false, stackable: promotion?.stackable ?? false, status: promotion?.status ?? 'active', startsAt: isoToLocal(promotion?.startsAt), endsAt: isoToLocal(promotion?.endsAt),
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value });

  const buildConfig = (): { config?: Record<string, number>; errors: Record<string, string> } => {
    const er: Record<string, string> = {};
    const pct = (v: string) => (/^\d{1,3}(\.\d{1,2})?$/.test(v) && Number(v) > 0 && Number(v) <= 100 ? Math.round(Number(v) * 100) : null);
    if (kind === 'percentage') {
      const bps = pct(f.percent);
      if (!bps) er.percent = 'Enter a percentage between 0.01 and 100.';
      const max = f.maxDiscount ? toPaise(f.maxDiscount) : undefined;
      if (f.maxDiscount && !max) er.maxDiscount = 'Enter an amount in rupees.';
      return { errors: er, config: bps ? { percentBps: bps, ...(max ? { maxDiscountPaise: max } : {}) } : undefined };
    }
    if (kind === 'fixed_amount') {
      const a = toPaise(f.amount);
      if (!a) er.amount = 'Enter an amount in rupees.';
      return { errors: er, config: a ? { amountPaise: a } : undefined };
    }
    if (kind === 'buy_x_get_y') {
      const b = Number(f.buyQuantity), g = Number(f.getQuantity), d = pct(f.getPercent);
      if (!Number.isInteger(b) || b < 1) er.buyQuantity = 'Whole number, 1 or more.';
      if (!Number.isInteger(g) || g < 1) er.getQuantity = 'Whole number, 1 or more.';
      if (!d) er.getPercent = 'Enter a percentage between 0.01 and 100.';
      return { errors: er, config: Object.keys(er).length ? undefined : { buyQuantity: b, getQuantity: g, getDiscountBps: d! } };
    }
    return { errors: er, config: {} };
  };

  return (
    <Modal title={promotion ? `Edit ${promotion.name}` : 'New promotion'} onClose={onClose} wide>
      <form
        noValidate
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const v = validate(schema, f);
          const cfg = buildConfig();
          const all = { ...v.errors, ...cfg.errors };
          if (f.startsAt && f.endsAt && new Date(f.endsAt) <= new Date(f.startsAt)) all.endsAt = 'The end must be after the start.';
          setErrors(all);
          if (!v.data || !cfg.config || Object.keys(all).length) return;
          const body = {
            name: v.data.name, config: cfg.config, minSubtotalPaise: f.minSubtotal ? toPaise(f.minSubtotal)! : 0, requiresCoupon: f.requiresCoupon, stackable: f.stackable,
            priority: Number(f.priority), status: f.status, startsAt: localToIso(f.startsAt), endsAt: localToIso(f.endsAt),
            usageLimit: f.usageLimit ? Number(f.usageLimit) : null, perCustomerLimit: f.perCustomerLimit ? Number(f.perCustomerLimit) : null,
          };
          setBusy(true);
          setError(null);
          try {
            await api(promotion ? s(`promotions/${promotion.id}`) : s('promotions'), { method: promotion ? 'PATCH' : 'POST', body: promotion ? body : { ...body, kind, eligibility: {} } });
            toast('ok', promotion ? 'Promotion saved.' : 'Promotion created.');
            await onDone();
          } catch (err) {
            setError(errorText(err));
            setBusy(false);
          }
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" error={errors.name}>{(p) => <input {...p} className="field" value={f.name} onChange={set('name')} />}</Field>
          <Field label="Discount type" hint={promotion ? 'The type cannot be changed after creation.' : undefined}>
            {(p) => (
              <select {...p} className="field" value={kind} disabled={Boolean(promotion)} onChange={(e) => setKind(e.target.value as Kind)}>
                {(['percentage', 'fixed_amount', 'buy_x_get_y', 'free_shipping'] as Kind[]).map((k) => <option key={k} value={k}>{humanize(k)}</option>)}
              </select>
            )}
          </Field>
        </div>
        {kind === 'percentage' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Percent off" error={errors.percent}>{(p) => <input {...p} inputMode="decimal" className="field" value={f.percent} onChange={set('percent')} />}</Field>
            <Field label="Maximum discount (₹, optional)" error={errors.maxDiscount}>{(p) => <input {...p} inputMode="decimal" className="field" value={f.maxDiscount} onChange={set('maxDiscount')} />}</Field>
          </div>
        )}
        {kind === 'fixed_amount' && <Field label="Amount off (₹)" error={errors.amount}>{(p) => <input {...p} inputMode="decimal" className="field" value={f.amount} onChange={set('amount')} />}</Field>}
        {kind === 'buy_x_get_y' && (
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Buy quantity" error={errors.buyQuantity}>{(p) => <input {...p} inputMode="numeric" className="field" value={f.buyQuantity} onChange={set('buyQuantity')} />}</Field>
            <Field label="Get quantity" error={errors.getQuantity}>{(p) => <input {...p} inputMode="numeric" className="field" value={f.getQuantity} onChange={set('getQuantity')} />}</Field>
            <Field label="Discount on those (%)" error={errors.getPercent}>{(p) => <input {...p} inputMode="decimal" className="field" value={f.getPercent} onChange={set('getPercent')} />}</Field>
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Minimum order (₹, optional)" error={errors.minSubtotal}>{(p) => <input {...p} inputMode="decimal" className="field" value={f.minSubtotal} onChange={set('minSubtotal')} />}</Field>
          <Field label="Total uses limit (optional)" error={errors.usageLimit}>{(p) => <input {...p} inputMode="numeric" className="field" value={f.usageLimit} onChange={set('usageLimit')} />}</Field>
          <Field label="Uses per customer (optional)" error={errors.perCustomerLimit}>{(p) => <input {...p} inputMode="numeric" className="field" value={f.perCustomerLimit} onChange={set('perCustomerLimit')} />}</Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Starts (optional)">{(p) => <input {...p} type="datetime-local" className="field" value={f.startsAt} onChange={set('startsAt')} />}</Field>
          <Field label="Ends (optional)" error={errors.endsAt}>{(p) => <input {...p} type="datetime-local" className="field" value={f.endsAt} onChange={set('endsAt')} />}</Field>
          <Field label="Priority" error={errors.priority} hint="Higher runs first.">{(p) => <input {...p} inputMode="numeric" className="field" value={f.priority} onChange={set('priority')} />}</Field>
        </div>
        <div className="flex flex-wrap items-center gap-6 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={f.requiresCoupon} onChange={set('requiresCoupon')} /> Requires a coupon code</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={f.stackable} onChange={set('stackable')} /> Can combine with other promotions</label>
          <label className="flex items-center gap-2">Status
            <select className="field w-32 py-1.5" value={f.status} onChange={set('status')}><option value="active">Active</option><option value="inactive">Inactive</option></select>
          </label>
        </div>
        <p className="text-xs text-muted">Applies to all products. Restricting a promotion to specific products or collections is not available in this form yet.</p>
        {error && <ErrorNote message={error} />}
        <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save promotion'}</button></div>
      </form>
    </Modal>
  );
}

function CouponsModal({ promotion, onClose }: { promotion: Promotion; onClose: () => void }) {
  const { s, can } = useStore();
  const toast = useToast();
  const { data, error, loading, reload } = useFetch<{ items: Coupon[] }>(s(`promotions/${promotion.id}/coupons`));
  const [code, setCode] = useState('');
  const [limit, setLimit] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  return (
    <Modal title={`Coupons for ${promotion.name}`} onClose={onClose}>
      {error && <ErrorNote message={error} onRetry={reload} />}
      {loading && !data && <Loading />}
      {data && (data.items.length === 0 ? <p className="mb-4 text-sm text-muted">No coupon codes yet.</p> : (
        <ul className="mb-4 divide-y divide-line rounded-lg border border-line">
          {data.items.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <span><span className="font-mono font-medium">{c.code}</span>{c.usageLimit ? <span className="ml-2 text-xs text-muted">limit {c.usageLimit}</span> : null}</span>
              <span className="flex items-center gap-2">
                <Badge tone={c.isActive ? 'ok' : 'neutral'}>{c.isActive ? 'Active' : 'Off'}</Badge>
                {can('promotions.write') && (
                  <button className="btn-secondary" onClick={async () => {
                    try { await api(s(`coupons/${c.id}`), { method: 'PATCH', body: { isActive: !c.isActive } }); toast('ok', c.isActive ? 'Coupon deactivated.' : 'Coupon activated.'); await reload(); } catch (e) { toast('error', errorText(e)); }
                  }}>{c.isActive ? 'Turn off' : 'Turn on'}</button>
                )}
              </span>
            </li>
          ))}
        </ul>
      ))}
      {can('promotions.write') && (
        <form
          className="grid gap-3 sm:grid-cols-[1fr_8rem_auto] sm:items-end"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!/^[A-Za-z0-9_-]{3,40}$/.test(code)) return setFormError('Use 3–40 letters, numbers, - or _.');
            if (limit && !/^\d+$/.test(limit)) return setFormError('Limit must be a whole number.');
            setBusy(true);
            setFormError(null);
            try {
              await api(s(`promotions/${promotion.id}/coupons`), { method: 'POST', body: { code, usageLimit: limit ? Number(limit) : null } });
              toast('ok', 'Coupon created.');
              setCode('');
              setLimit('');
              await reload();
            } catch (err) {
              setFormError(errorText(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="New code">{(p) => <input {...p} className="field uppercase" value={code} onChange={(e) => setCode(e.target.value)} />}</Field>
          <Field label="Use limit">{(p) => <input {...p} inputMode="numeric" className="field" placeholder="None" value={limit} onChange={(e) => setLimit(e.target.value)} />}</Field>
          <button className="btn-primary" disabled={busy}>{busy ? 'Adding…' : 'Add'}</button>
        </form>
      )}
      {formError && <div className="mt-3"><ErrorNote message={formError} /></div>}
    </Modal>
  );
}
