'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { z } from 'zod';
import { useStore } from '@/components/store-context';
import { Badge, Card, Confirm, Denied, ErrorNote, Field, Loading, Modal, PageHeader, statusTone, useToast, validate } from '@/components/ui';
import { api, errorText } from '@/lib/client';
import { dateTime, humanize, money, toPaise } from '@/lib/format';
import { useFetch } from '@/lib/hooks';

type Order = {
  id: string; orderNumber: string; status: string; paymentStatus: string; fulfillmentStatus: string; posSyncStatus: string; paymentMethod: string;
  subtotalPaise: number; discountPaise: number; shippingPaise: number; codFeePaise: number; taxPaise: number; totalPaise: number; refundedPaise: number;
  customerSnapshot: { name?: string | null; phone?: string; email?: string | null } | null;
  shippingAddress: { name?: string; phone?: string; line1?: string; line2?: string | null; landmark?: string | null; city?: string; state?: string; pincode?: string } | null;
  appliedPromotions: { name: string; couponCode?: string | null }[] | null;
  posOrderRef: string | null; placedAt: string; cancelledAt: string | null;
};
type Item = { id: string; productTitle: string; variantTitle: string; skuCode: string; quantity: number; unitPricePaise: number; discountPaise: number; lineTotalPaise: number };
type EventRow = { id: string; machine: string; fromState: string | null; toState: string | null; actorType: string; note: string | null; isPublic: boolean; createdAt: string };
type Payment = { id: string; provider: string; providerRef: string | null; status: string; amountPaise: number; createdAt: string };
type Refund = { id: string; amountPaise: number; reason: string; status: string; createdAt: string };
type Shipment = { id: string; status: string; courier: string | null; trackingNumber: string | null; trackingUrl: string | null; createdAt: string };
type ReturnReq = { id: string; type: 'return' | 'exchange'; status: string; reason: string; resolutionNote: string | null; createdAt: string };
type Detail = { order: Order; items: Item[]; timeline: EventRow[]; payments: Payment[]; refunds: Refund[]; shipments: Shipment[]; returns: ReturnReq[] };

type Action = 'processing' | 'completed' | 'cancel' | 'note' | 'shipment' | 'refund' | 'cod' | 'posSynced' | null;

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { storeId, s, can } = useStore();
  const { data, error, loading, reload } = useFetch<Detail>(can('orders.read') ? s(`orders/${id}`) : null);
  const [action, setAction] = useState<Action>(null);
  const [ret, setRet] = useState<ReturnReq | null>(null);
  if (!can('orders.read')) return <Denied what="view orders" />;
  if (error) return <ErrorNote message={error} onRetry={reload} />;
  if (loading && !data) return <Loading />;
  if (!data) return null;
  const { order: o, items } = data;
  const manage = can('orders.manage');
  const open = o.status !== 'cancelled' && o.status !== 'completed';
  const done = async () => { setAction(null); setRet(null); await reload(); };

  return (
    <>
      <PageHeader
        title={`Order ${o.orderNumber}`}
        subtitle={<span className="flex flex-wrap items-center gap-2"><Badge tone={statusTone(o.status)}>{humanize(o.status)}</Badge><Badge tone={statusTone(o.paymentStatus)}>Payment: {humanize(o.paymentStatus)}</Badge><Badge tone={statusTone(o.fulfillmentStatus)}>{humanize(o.fulfillmentStatus)}</Badge> placed {dateTime(o.placedAt)} · <Link className="text-accent hover:underline" href={`/s/${storeId}/orders`}>All orders</Link></span>}
        actions={manage && (
          <>
            {o.status === 'confirmed' && <button className="btn-secondary" onClick={() => setAction('processing')}>Mark processing</button>}
            {o.status === 'processing' && <button className="btn-secondary" onClick={() => setAction('completed')}>Mark completed</button>}
            {(o.status === 'confirmed' || o.status === 'processing') && data.shipments.length === 0 && <button className="btn-primary" onClick={() => setAction('shipment')}>Create shipment</button>}
            {o.paymentMethod === 'cod' && o.paymentStatus !== 'paid' && o.paymentStatus !== 'cod_collected' && o.status !== 'cancelled' && <button className="btn-secondary" onClick={() => setAction('cod')}>Record COD collected</button>}
            <button className="btn-secondary" onClick={() => setAction('note')}>Add note</button>
            {open && <button className="btn-danger" onClick={() => setAction('cancel')}>Cancel order</button>}
          </>
        )}
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <Card title="Items">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-muted"><th className="pb-2 font-medium">Item</th><th className="pb-2 font-medium">Qty</th><th className="pb-2 text-right font-medium">Price</th><th className="pb-2 text-right font-medium">Total</th></tr></thead>
              <tbody className="divide-y divide-line">
                {items.map((i) => (
                  <tr key={i.id}><td className="py-2">{i.productTitle}<span className="block text-xs text-muted">{i.variantTitle} · {i.skuCode}</span></td><td>{i.quantity}</td><td className="text-right">{money(i.unitPricePaise)}</td><td className="text-right font-medium">{money(i.lineTotalPaise)}</td></tr>
                ))}
              </tbody>
            </table>
            <dl className="mt-4 space-y-1 border-t border-line pt-3 text-sm">
              <Line k="Subtotal" v={money(o.subtotalPaise)} />
              {o.discountPaise > 0 && <Line k="Discounts" v={`−${money(o.discountPaise)}`} />}
              <Line k="Shipping" v={money(o.shippingPaise)} />
              {o.codFeePaise > 0 && <Line k="COD fee" v={money(o.codFeePaise)} />}
              <Line k="Total" v={money(o.totalPaise)} bold />
              <Line k="Includes GST" v={money(o.taxPaise)} muted />
              {o.refundedPaise > 0 && <Line k="Refunded" v={money(o.refundedPaise)} />}
            </dl>
            {o.appliedPromotions && o.appliedPromotions.length > 0 && <p className="mt-3 text-xs text-muted">Promotions: {o.appliedPromotions.map((p) => p.name + (p.couponCode ? ` (${p.couponCode})` : '')).join(', ')}</p>}
          </Card>

          <Card title="Shipments" actions={manage && data.shipments.length > 0 && <button className="btn-secondary" onClick={() => setAction('shipment')}>Add shipment</button>}>
            {data.shipments.length === 0 ? <p className="text-sm text-muted">No shipments yet.</p> : data.shipments.map((sh) => <ShipmentRow key={sh.id} shipment={sh} canManage={manage} onChange={reload} />)}
          </Card>

          <Card title="Returns and exchanges">
            {data.returns.length === 0 ? <p className="text-sm text-muted">No return requests.</p> : (
              <ul className="divide-y divide-line text-sm">
                {data.returns.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                    <span><b className="font-medium">{humanize(r.type)}</b> <Badge tone={statusTone(r.status)}>{humanize(r.status)}</Badge><span className="block text-xs text-muted">{r.reason}{r.resolutionNote ? ` — ${r.resolutionNote}` : ''}</span></span>
                    {manage && !['completed', 'rejected', 'cancelled'].includes(r.status) && <button className="btn-secondary" onClick={() => setRet(r)}>Update</button>}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Timeline">
            <ol className="space-y-3 text-sm">
              {[...data.timeline].reverse().map((e) => (
                <li key={e.id} className="border-l-2 border-accent/30 pl-3">
                  <p><b className="font-medium">{humanize(e.machine)}</b>{e.toState ? ` → ${humanize(e.toState)}` : ''}{!e.isPublic && <span className="ml-2 text-xs text-muted">(internal)</span>}</p>
                  {e.note && <p className="text-muted">{e.note}</p>}
                  <p className="text-xs text-muted">{dateTime(e.createdAt)} · {e.actorType}</p>
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Customer">
            <p className="text-sm font-medium">{o.customerSnapshot?.name ?? '—'}</p>
            <p className="text-sm text-muted">{o.customerSnapshot?.phone}{o.customerSnapshot?.email ? ` · ${o.customerSnapshot.email}` : ''}</p>
            {o.shippingAddress && (
              <address className="mt-3 text-sm not-italic text-muted">
                {o.shippingAddress.name}<br />{[o.shippingAddress.line1, o.shippingAddress.line2, o.shippingAddress.landmark].filter(Boolean).join(', ')}<br />{o.shippingAddress.city}, {o.shippingAddress.state} {o.shippingAddress.pincode}<br />{o.shippingAddress.phone}
              </address>
            )}
          </Card>
          <Card title="Payments" actions={can('refunds.manage') && o.refundedPaise < o.totalPaise && data.payments.some((p) => p.status === 'captured' || p.status === 'succeeded' || p.status === 'paid') && <button className="btn-secondary" onClick={() => setAction('refund')}>Refund</button>}>
            {data.payments.length === 0 ? <p className="text-sm text-muted">{o.paymentMethod === 'cod' ? 'Cash on delivery: no online payment.' : 'No payment attempts.'}</p> : (
              <ul className="space-y-2 text-sm">{data.payments.map((p) => <li key={p.id} className="flex justify-between gap-2"><span>{p.provider} <Badge tone={statusTone(p.status)}>{humanize(p.status)}</Badge></span><span>{money(p.amountPaise)}</span></li>)}</ul>
            )}
            {data.refunds.length > 0 && (
              <div className="mt-4 border-t border-line pt-3">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Refunds</p>
                <ul className="space-y-2 text-sm">{data.refunds.map((r) => <RefundRow key={r.id} refund={r} canManage={can('refunds.manage')} onChange={reload} />)}</ul>
              </div>
            )}
          </Card>
          <Card title="POS">
            <p className="text-sm"><Badge tone={statusTone(o.posSyncStatus)}>{humanize(o.posSyncStatus)}</Badge>{o.posOrderRef && <span className="ml-2 text-xs text-muted">ref {o.posOrderRef}</span>}</p>
            {can('pos.manage') && ['failed', 'manual_required'].includes(o.posSyncStatus) && (
              <div className="mt-3 flex gap-2">
                <RetryPos orderId={o.id} onDone={reload} />
                <button className="btn-secondary" onClick={() => setAction('posSynced')}>Mark entered manually</button>
              </div>
            )}
          </Card>
        </div>
      </div>

      {(action === 'processing' || action === 'completed') && <StatusConfirm to={action} orderId={o.id} onClose={() => setAction(null)} onDone={done} />}
      {action === 'cancel' && <CancelModal order={o} orderId={o.id} onClose={() => setAction(null)} onDone={done} />}
      {action === 'note' && <TextModal title="Add internal note" label="Note" field="note" path={s(`orders/${o.id}/notes`)} onClose={() => setAction(null)} onDone={done} />}
      {action === 'shipment' && <ShipmentModal orderId={o.id} onClose={() => setAction(null)} onDone={done} />}
      {action === 'refund' && <RefundModal order={o} onClose={() => setAction(null)} onDone={done} />}
      {action === 'cod' && <CodConfirm order={o} onClose={() => setAction(null)} onDone={done} />}
      {action === 'posSynced' && <TextModal title="Mark entered in POS" label="POS order reference" field="posOrderRef" path={s(`orders/${o.id}/pos-sync/mark-synced`)} onClose={() => setAction(null)} onDone={done} />}
      {ret && <ReturnModal ret={ret} onClose={() => setRet(null)} onDone={done} />}
    </>
  );
}

function Line({ k, v, bold, muted }: { k: string; v: string; bold?: boolean; muted?: boolean }) {
  return <div className={`flex justify-between ${bold ? 'text-base font-semibold' : ''} ${muted ? 'text-xs text-muted' : ''}`}><dt className={bold ? '' : 'text-muted'}>{k}</dt><dd>{v}</dd></div>;
}

function useRun() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>, ok: string, then: () => Promise<void> | void) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      toast('ok', ok);
      await then();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };
  return { busy, error, run };
}

function CodConfirm({ order, onClose, onDone }: { order: Order; onClose: () => void; onDone: () => Promise<void> }) {
  const { s } = useStore();
  const { busy, error, run } = useRun();
  return (
    <Confirm
      title="Record cash collected"
      body={<><p>Record that <b>{money(order.totalPaise)}</b> was collected in cash on delivery for {order.orderNumber}?</p>{error && <div className="mt-3"><ErrorNote message={error} /></div>}</>}
      confirmLabel="Record collection"
      busy={busy}
      onClose={onClose}
      onConfirm={() => run(() => api(s(`orders/${order.id}/cod-collected`), { method: 'POST' }), 'Cash collection recorded.', onDone)}
    />
  );
}

function StatusConfirm({ to, orderId, onClose, onDone }: { to: 'processing' | 'completed'; orderId: string; onClose: () => void; onDone: () => Promise<void> }) {
  const { s } = useStore();
  const { busy, error, run } = useRun();
  return (
    <Confirm title={`Mark ${to}`} body={<><p>Move this order to <b>{to}</b>? Orders only move forward.</p>{error && <div className="mt-3"><ErrorNote message={error} /></div>}</>} confirmLabel={`Mark ${to}`} busy={busy} onClose={onClose} onConfirm={() => run(() => api(s(`orders/${orderId}/status`), { method: 'POST', body: { to } }), `Order marked ${to}.`, onDone)} />
  );
}

function CancelModal({ order, orderId, onClose, onDone }: { order: Order; orderId: string; onClose: () => void; onDone: () => Promise<void> }) {
  const { s } = useStore();
  const { busy, error, run } = useRun();
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal title={`Cancel ${order.orderNumber}`} onClose={onClose}>
      <form noValidate className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (!reason.trim()) return setErr('Enter a reason.'); setErr(null); void run(() => api(s(`orders/${orderId}/cancel`), { method: 'POST', body: { reason: reason.trim() } }), 'Order cancelled.', onDone); }}>
        <p className="text-sm text-muted">Only unshipped orders can be cancelled. {order.paymentStatus === 'paid' ? 'A refund is queued for the captured payment.' : ''}</p>
        <Field label="Reason" error={err}>{(p) => <textarea {...p} className="field" value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
        {error && <ErrorNote message={error} />}
        <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={onClose}>Keep order</button><button className="btn-danger" disabled={busy}>{busy ? 'Cancelling…' : 'Cancel order'}</button></div>
      </form>
    </Modal>
  );
}

function TextModal({ title, label, field, path, onClose, onDone }: { title: string; label: string; field: string; path: string; onClose: () => void; onDone: () => Promise<void> }) {
  const { busy, error, run } = useRun();
  const [v, setV] = useState('');
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal title={title} onClose={onClose}>
      <form noValidate className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (!v.trim()) return setErr(`Enter the ${label.toLowerCase()}.`); setErr(null); void run(() => api(path, { method: 'POST', body: { [field]: v.trim() } }), 'Saved.', onDone); }}>
        <Field label={label} error={err}>{(p) => <textarea {...p} className="field" value={v} onChange={(e) => setV(e.target.value)} />}</Field>
        {error && <ErrorNote message={error} />}
        <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></div>
      </form>
    </Modal>
  );
}

function ShipmentModal({ orderId, onClose, onDone }: { orderId: string; onClose: () => void; onDone: () => Promise<void> }) {
  const { s } = useStore();
  const { busy, error, run } = useRun();
  const [f, setF] = useState({ courier: '', trackingNumber: '', trackingUrl: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const schema = z.object({ courier: z.string().trim().max(80), trackingNumber: z.string().trim().max(80), trackingUrl: z.string().trim().refine((u) => u === '' || /^https?:\/\//.test(u), 'Must start with http:// or https://').max(500) });
  return (
    <Modal title="Create shipment" onClose={onClose}>
      <form noValidate className="space-y-4" onSubmit={(e) => { e.preventDefault(); const v = validate(schema, f); setErrors(v.errors); if (!v.data) return; void run(() => api(s(`orders/${orderId}/shipments`), { method: 'POST', body: { courier: v.data!.courier || undefined, trackingNumber: v.data!.trackingNumber || undefined, trackingUrl: v.data!.trackingUrl || undefined } }), 'Shipment created.', onDone); }}>
        <p className="text-sm text-muted">Shipments are recorded manually; no courier is contacted.</p>
        <Field label="Courier (optional)" error={errors.courier}>{(p) => <input {...p} className="field" value={f.courier} onChange={(e) => setF({ ...f, courier: e.target.value })} />}</Field>
        <Field label="Tracking number (optional)" error={errors.trackingNumber}>{(p) => <input {...p} className="field" value={f.trackingNumber} onChange={(e) => setF({ ...f, trackingNumber: e.target.value })} />}</Field>
        <Field label="Tracking link (optional)" error={errors.trackingUrl}>{(p) => <input {...p} className="field" value={f.trackingUrl} onChange={(e) => setF({ ...f, trackingUrl: e.target.value })} />}</Field>
        {error && <ErrorNote message={error} />}
        <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create shipment'}</button></div>
      </form>
    </Modal>
  );
}

const SHIP_STATES = ['packed', 'shipped', 'in_transit', 'out_for_delivery', 'delivered', 'delivery_failed', 'rto_initiated', 'rto_delivered', 'cancelled'];
function ShipmentRow({ shipment: sh, canManage, onChange }: { shipment: Shipment; canManage: boolean; onChange: () => Promise<void> }) {
  const { s } = useStore();
  const { busy, error, run } = useRun();
  const [to, setTo] = useState('');
  return (
    <div className="mb-3 rounded-lg border border-line p-3 text-sm last:mb-0">
      <p className="flex flex-wrap items-center gap-2"><Badge tone={statusTone(sh.status)}>{humanize(sh.status)}</Badge>{sh.courier} {sh.trackingNumber && <span className="font-mono text-xs">{sh.trackingNumber}</span>}{sh.trackingUrl && <a className="text-accent underline" href={sh.trackingUrl} target="_blank" rel="noopener noreferrer">Track</a>}</p>
      {canManage && (
        <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (!to) return; void run(() => api(s(`shipments/${sh.id}/events`), { method: 'POST', body: { status: to, occurredAt: new Date().toISOString() } }), 'Tracking updated.', async () => { setTo(''); await onChange(); }); }}>
          <div className="w-44"><label htmlFor={`ev-${sh.id}`} className="label">Record event</label><select id={`ev-${sh.id}`} className="field py-1.5" value={to} onChange={(e) => setTo(e.target.value)}><option value="">Choose…</option>{SHIP_STATES.map((x) => <option key={x} value={x}>{humanize(x)}</option>)}</select></div>
          <button className="btn-secondary" disabled={busy || !to}>{busy ? 'Saving…' : 'Record'}</button>
        </form>
      )}
      {error && <div className="mt-2"><ErrorNote message={error} /></div>}
    </div>
  );
}

function ReturnModal({ ret, onClose, onDone }: { ret: ReturnReq; onClose: () => void; onDone: () => Promise<void> }) {
  const { s } = useStore();
  const { busy, error, run } = useRun();
  const options: Record<string, string[]> = { requested: ['approved', 'rejected', 'cancelled'], approved: ['received', 'cancelled'], received: ['completed'] };
  const [to, setTo] = useState(options[ret.status]?.[0] ?? '');
  const [note, setNote] = useState('');
  return (
    <Modal title={`${humanize(ret.type)} request`} onClose={onClose}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void run(() => api(s(`returns/${ret.id}/status`), { method: 'POST', body: { to, ...(note.trim() ? { note: note.trim() } : {}) } }), 'Request updated.', onDone); }}>
        <p className="text-sm text-muted">Customer's reason: {ret.reason}</p>
        <Field label="Move to">{(p) => <select {...p} className="field" value={to} onChange={(e) => setTo(e.target.value)}>{(options[ret.status] ?? []).map((x) => <option key={x} value={x}>{humanize(x)}</option>)}</select>}</Field>
        <Field label="Note (optional)">{(p) => <textarea {...p} className="field" value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
        {error && <ErrorNote message={error} />}
        <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy || !to}>{busy ? 'Saving…' : 'Update'}</button></div>
      </form>
    </Modal>
  );
}

function RefundModal({ order, onClose, onDone }: { order: Order; onClose: () => void; onDone: () => Promise<void> }) {
  const { s } = useStore();
  const { busy, error, run } = useRun();
  const max = order.totalPaise - order.refundedPaise;
  const [f, setF] = useState({ amount: String(max / 100), reason: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [key] = useState(() => crypto.randomUUID());
  return (
    <Modal title={`Refund ${order.orderNumber}`} onClose={onClose}>
      <form
        noValidate
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const paise = toPaise(f.amount);
          const er: Record<string, string> = {};
          if (!paise || paise <= 0) er.amount = 'Enter an amount in rupees.';
          else if (paise > max) er.amount = `Cannot exceed ${money(max)} (what is left to refund).`;
          if (!f.reason.trim()) er.reason = 'Enter a reason.';
          setErrors(er);
          if (Object.keys(er).length) return;
          void run(() => api(s(`orders/${order.id}/refunds`), { method: 'POST', headers: { 'idempotency-key': key }, body: { amountPaise: paise, reason: f.reason.trim() } }), 'Refund requested. It is processed by the payment provider.', onDone);
        }}
      >
        <p className="text-sm text-muted">This sends a refund request to the payment provider for the captured payment. It cannot be undone.</p>
        <Field label="Amount (₹)" error={errors.amount} hint={`Up to ${money(max)}`}>{(p) => <input {...p} inputMode="decimal" className="field" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />}</Field>
        <Field label="Reason" error={errors.reason}>{(p) => <textarea {...p} className="field" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />}</Field>
        {error && <ErrorNote message={error} />}
        <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-danger" disabled={busy}>{busy ? 'Requesting…' : 'Request refund'}</button></div>
      </form>
    </Modal>
  );
}

function RefundRow({ refund, canManage, onChange }: { refund: Refund; canManage: boolean; onChange: () => Promise<void> }) {
  const { s } = useStore();
  const toast = useToast();
  const [ref, setRef] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <li>
      <div className="flex justify-between gap-2"><span>{money(refund.amountPaise)} <Badge tone={statusTone(refund.status)}>{humanize(refund.status)}</Badge></span><span className="text-xs text-muted">{dateTime(refund.createdAt)}</span></div>
      <p className="text-xs text-muted">{refund.reason}</p>
      {canManage && ['pending', 'failed', 'manual_required'].includes(refund.status) && (
        open ? (
          <form className="mt-2 flex gap-2" onSubmit={async (e) => { e.preventDefault(); if (!ref.trim()) return; setBusy(true); try { await api(s(`refunds/${refund.id}/mark-succeeded`), { method: 'POST', body: { reference: ref.trim() } }); toast('ok', 'Refund recorded as paid.'); await onChange(); } catch (err) { toast('error', errorText(err)); setBusy(false); } }}>
            <label className="sr-only" htmlFor={`rf-${refund.id}`}>Payment reference</label>
            <input id={`rf-${refund.id}`} className="field py-1.5" placeholder="Reference (e.g. UPI txn id)" value={ref} onChange={(e) => setRef(e.target.value)} />
            <button className="btn-secondary" disabled={busy}>Save</button>
          </form>
        ) : <button className="btn-ghost mt-1 text-xs" onClick={() => setOpen(true)}>Record as paid outside the provider</button>
      )}
    </li>
  );
}

function RetryPos({ orderId, onDone }: { orderId: string; onDone: () => Promise<void> }) {
  const { s } = useStore();
  const { busy, error, run } = useRun();
  return <><button className="btn-secondary" disabled={busy} onClick={() => run(() => api(s(`orders/${orderId}/pos-sync/retry`), { method: 'POST' }), 'POS submission re-queued.', onDone)}>{busy ? 'Queuing…' : 'Retry POS sync'}</button>{error && <span className="text-xs text-danger">{error}</span>}</>;
}
