'use client';

import { AnimatePresence, motion } from 'motion/react';
import Image from 'next/image';
import { useEffect, useState } from 'react';
import { CheckIcon } from '@/components/icons';
import { OrderStatus } from '@/components/order-status';
import { errorMessage, sf } from '@/lib/client-api';
import { ApiError } from '@/lib/errors';
import { date, dateTime, humanize, money } from '@/lib/format';
import { startPayment } from '@/lib/payment';
import type { Order } from '@/lib/types';

const STEPS = ['placed', 'confirmed', 'packed', 'shipped', 'delivered'] as const;

function progress(o: Order) {
  if (o.fulfillmentStatus === 'delivered') return 4;
  if (o.fulfillmentStatus === 'shipped' || o.fulfillmentStatus === 'delivery_failed') return 3;
  if (o.fulfillmentStatus === 'packed') return 2;
  if (o.status === 'confirmed' || o.status === 'processing') return 1;
  return 0;
}

export function OrderView({ initial, justPlaced, paymentRetry }: { initial: Order; justPlaced: boolean; paymentRetry: boolean }) {
  const [order, setOrder] = useState(initial);
  const [error, setError] = useState<string | null>(paymentRetry ? 'Your order is saved, but the payment could not start. Please try “Pay now” again.' : null);
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<'cancel' | 'return' | null>(null);

  const reload = async () => setOrder((await sf<{ order: Order }>(`orders/${order.orderNumber}`)).order);

  // Payment is confirmed by the provider webhook; poll briefly while it settles.
  useEffect(() => {
    if (order.paymentMethod !== 'online' || order.paymentStatus !== 'pending') return;
    let n = 0;
    const t = setInterval(async () => {
      n += 1;
      try {
        await reload();
      } catch {
        /* keep polling */
      }
      if (n >= 20) clearInterval(t);
    }, 3000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.paymentStatus, order.paymentMethod]);

  const awaitingPayment = order.paymentMethod === 'online' && order.status === 'pending_payment';
  // The API decides (customerCanCancel); a stale page is corrected by the 409 handling in CancelForm.
  const canCancel = order.actions.canCancel;
  const canReturn = order.fulfillmentStatus === 'delivered' && order.returns.every((r) => ['rejected', 'cancelled'].includes(r.status));
  const step = progress(order);
  const cancelled = order.status === 'cancelled';

  return (
    <div className="space-y-10">
      <AnimatePresence>
        {justPlaced && !cancelled && (
          <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-4 rounded-2xl bg-accent p-6 text-accent-fg">
            <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', delay: 0.2 }} className="flex h-10 w-10 items-center justify-center rounded-full bg-accent-fg/15">
              <CheckIcon />
            </motion.span>
            <div>
              <p className="font-display text-xl">{awaitingPayment ? 'Order saved' : 'Thank you, your order is placed'}</p>
              <p className="text-sm opacity-80">{awaitingPayment ? 'Complete the payment to confirm it.' : 'We’ll keep you updated on its progress here.'}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-3xl">Order {order.orderNumber}</h2>
          <p className="text-sm text-muted">Placed {date(order.placedAt)} · {order.paymentMethod === 'cod' ? 'Cash on delivery' : 'Paid online'} · Payment {humanize(order.paymentStatus).toLowerCase()}</p>
        </div>
        <OrderStatus order={order} />
      </div>

      {error && <p className="rounded-xl bg-sale/10 p-4 text-sm text-sale" role="alert">{error}</p>}

      {awaitingPayment && order.paymentStatus !== 'pending' && (
        <button
          className="btn-primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await startPayment(order.orderNumber);
              await reload();
            } catch (err) {
              setError(errorMessage(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          Pay now {money(order.totalPaise)}
        </button>
      )}
      {awaitingPayment && order.paymentStatus === 'pending' && <p className="text-sm text-muted">Confirming your payment…</p>}

      {!cancelled && (
        <ol className="grid grid-cols-5 gap-2" aria-label="Order progress">
          {STEPS.map((s, i) => (
            <li key={s} className="text-center text-xs">
              <div className="relative h-1 overflow-hidden rounded-full bg-line">
                <motion.div className="absolute inset-y-0 left-0 bg-accent" initial={{ width: 0 }} animate={{ width: i <= step ? '100%' : '0%' }} transition={{ duration: 0.6, delay: i * 0.15 }} />
              </div>
              <span className={`mt-2 block ${i <= step ? '' : 'text-muted'}`}>{humanize(s)}</span>
            </li>
          ))}
        </ol>
      )}

      {order.shipments.length > 0 && (
        <section className="space-y-2">
          {order.shipments.map((s) => (
            <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line p-4 text-sm">
              <span>{s.courier ?? 'Shipment'} {s.trackingNumber && <span className="text-muted">· {s.trackingNumber}</span>}</span>
              <span className="flex items-center gap-3">
                {humanize(s.status)}
                {s.trackingUrl && /^https:\/\//.test(s.trackingUrl) && <a href={s.trackingUrl} target="_blank" rel="noopener noreferrer" className="underline">Track</a>}
              </span>
            </div>
          ))}
        </section>
      )}

      <div className="grid gap-10 lg:grid-cols-[1fr_320px]">
        <section>
          <ul className="divide-y divide-line">
            {order.items.map((i) => (
              <li key={i.id} className="flex gap-4 py-4">
                <div className="relative h-24 w-20 shrink-0 overflow-hidden rounded-lg bg-line">
                  {i.imageUrl && <Image src={i.imageUrl} alt="" fill sizes="80px" className="object-cover" />}
                </div>
                <div className="flex-1 text-sm">
                  <p className="font-medium">{i.productTitle}</p>
                  <p className="text-muted">{i.variantTitle} · Qty {i.quantity}</p>
                </div>
                <span className="text-sm">{money(i.lineTotalPaise)}</span>
              </li>
            ))}
          </ul>
          {order.timeline.length > 0 && (
            <>
              <h3 className="mb-4 mt-10 font-display text-xl">Updates</h3>
              <ol className="relative space-y-5 border-l border-line pl-6">
                {[...order.timeline].reverse().map((e, k) => (
                  <li key={k} className="relative text-sm">
                    <span className="absolute -left-[29px] top-1 h-2.5 w-2.5 rounded-full bg-accent ring-4 ring-bg" />
                    <p>{humanize(e.machine)}: {humanize(e.toState).toLowerCase()}</p>
                    {e.note && <p className="text-muted">{e.note}</p>}
                    <p className="text-xs text-muted">{dateTime(e.createdAt)}</p>
                  </li>
                ))}
              </ol>
            </>
          )}
        </section>

        <aside className="space-y-6">
          <div className="card space-y-2 p-5 text-sm">
            <Row l="Subtotal" v={money(order.subtotalPaise)} />
            {order.discountPaise > 0 && <Row l="Discounts" v={`−${money(order.discountPaise)}`} />}
            <Row l="Shipping" v={order.shippingPaise ? money(order.shippingPaise) : 'Free'} />
            {order.codFeePaise > 0 && <Row l="COD fee" v={money(order.codFeePaise)} />}
            <div className="flex justify-between border-t border-line pt-2 font-medium"><span>Total</span><span>{money(order.totalPaise)}</span></div>
            {order.refundedPaise > 0 && <Row l="Refunded" v={money(order.refundedPaise)} />}
          </div>
          <div className="card p-5 text-sm">
            <p className="label">Delivering to</p>
            <p className="font-medium">{order.shippingAddress.name}</p>
            <p className="text-muted">{[order.shippingAddress.line1, order.shippingAddress.line2, order.shippingAddress.landmark].filter(Boolean).join(', ')}</p>
            <p className="text-muted">{order.shippingAddress.city}, {order.shippingAddress.state} {order.shippingAddress.pincode}</p>
          </div>
          {order.returns.length > 0 && (
            <div className="card p-5 text-sm">
              <p className="label">Returns</p>
              {order.returns.map((r) => <p key={r.id}>{humanize(r.type)} · {humanize(r.status)} · {date(r.createdAt)}</p>)}
            </div>
          )}
          <div className="flex flex-wrap gap-3">
            {canCancel && <button className="btn-outline" onClick={() => setPanel('cancel')}>Cancel order</button>}
            {canReturn && <button className="btn-outline" onClick={() => setPanel('return')}>Return or exchange</button>}
          </div>
        </aside>
      </div>

      <AnimatePresence>
        {panel && (
          <motion.div className="fixed inset-0 z-50 flex items-end justify-center bg-fg/30 sm:items-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setPanel(null)}>
            <motion.div role="dialog" aria-modal="true" className="w-full max-w-lg rounded-t-3xl bg-bg p-6 sm:rounded-3xl" initial={{ y: 40 }} animate={{ y: 0 }} exit={{ y: 40 }} onClick={(e) => e.stopPropagation()}>
              {panel === 'cancel' ? (
                <CancelForm
                  order={order}
                  onDone={(o) => (setOrder(o), setPanel(null))}
                  onStale={async (message) => {
                    // The order changed since this page loaded: refresh it, close the form and say why.
                    setPanel(null);
                    try {
                      await reload();
                    } catch {
                      /* the message below still explains it */
                    }
                    setError(message);
                  }}
                />
              ) : (
                <ReturnForm order={order} onDone={async () => (await reload(), setPanel(null))} />
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Row({ l, v }: { l: string; v: string }) {
  return <div className="flex justify-between"><span className="text-muted">{l}</span><span>{v}</span></div>;
}

function CancelForm({ order, onDone, onStale }: { order: Order; onDone: (o: Order) => void; onStale: (message: string) => void }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          onDone((await sf<{ order: Order }>(`orders/${order.orderNumber}/cancel`, { method: 'POST', body: { reason } })).order);
        } catch (err) {
          // 409: the order moved on (for example it is now being processed). Refresh instead of leaving a dead button.
          if (err instanceof ApiError && err.status === 409) onStale(errorMessage(err));
          else setError(errorMessage(err));
        }
      }}
      className="space-y-4"
    >
      <h3 className="font-display text-2xl">Cancel order {order.orderNumber}?</h3>
      <label className="block"><span className="label">Reason</span><textarea required className="field min-h-24" value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      {error && <p className="text-sm text-sale">{error}</p>}
      <button className="btn-primary w-full">Cancel order</button>
    </form>
  );
}

function ReturnForm({ order, onDone }: { order: Order; onDone: () => void }) {
  const [type, setType] = useState<'return' | 'exchange'>('return');
  const [reason, setReason] = useState('');
  const [qty, setQty] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const items = Object.entries(qty).filter(([, q]) => q > 0).map(([orderItemId, quantity]) => ({ orderItemId, quantity }));
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await sf(`orders/${order.orderNumber}/returns`, { method: 'POST', body: { type, reason, items } });
          onDone();
        } catch (err) {
          setError(errorMessage(err));
        }
      }}
      className="space-y-4"
    >
      <h3 className="font-display text-2xl">Return or exchange</h3>
      <div className="flex gap-2">
        {(['return', 'exchange'] as const).map((t) => (
          <button type="button" key={t} onClick={() => setType(t)} className={`rounded-full border px-4 py-2 text-sm ${type === t ? 'border-fg bg-fg text-bg' : 'border-line'}`}>{humanize(t)}</button>
        ))}
      </div>
      <ul className="space-y-2">
        {order.items.map((i) => (
          <li key={i.id} className="flex items-center justify-between gap-3 text-sm">
            <span className="min-w-0 truncate">{i.productTitle} <span className="text-muted">· {i.variantTitle}</span></span>
            <select className="field w-20 py-2" value={qty[i.id] ?? 0} onChange={(e) => setQty((q) => ({ ...q, [i.id]: Number(e.target.value) }))} aria-label={`Quantity of ${i.productTitle}`}>
              {Array.from({ length: i.quantity + 1 }, (_, n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </li>
        ))}
      </ul>
      <label className="block"><span className="label">Reason</span><textarea required className="field min-h-24" value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      {type === 'exchange' && <p className="text-xs text-muted">Our team will contact you to confirm the replacement size or colour.</p>}
      {error && <p className="text-sm text-sale">{error}</p>}
      <button className="btn-primary w-full" disabled={items.length === 0}>Submit request</button>
    </form>
  );
}
