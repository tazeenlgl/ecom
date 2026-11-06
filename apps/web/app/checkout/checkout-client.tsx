'use client';

import { AnimatePresence, motion } from 'motion/react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AddressForm } from '@/components/address-form';
import { useCart } from '@/components/cart-provider';
import { CheckIcon, ShieldIcon } from '@/components/icons';
import { SignIn } from '@/components/sign-in';
import { ApiError } from '@/lib/errors';
import { errorMessage, sf } from '@/lib/client-api';
import { money } from '@/lib/format';
import { startPayment } from '@/lib/payment';
import type { Address, Order, Quote } from '@/lib/types';

export function CheckoutClient({ signedIn }: { signedIn: boolean }) {
  const router = useRouter();
  const { view, loaded, refresh } = useCart();
  const [addresses, setAddresses] = useState<Address[] | null>(null);
  const [addressId, setAddressId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [method, setMethod] = useState<'online' | 'cod'>('online');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idempotencyKey = useRef<string | null>(null);

  useEffect(() => {
    if (!signedIn) return;
    sf<{ items: Address[] }>('me/addresses').then(({ items }) => {
      setAddresses(items);
      setAddressId((items.find((a) => a.isDefault) ?? items[0])?.id ?? null);
      if (items.length === 0) setAdding(true);
    }, (err) => setError(errorMessage(err)));
  }, [signedIn]);

  const requote = useCallback(async () => {
    if (!addressId) return;
    setQuoting(true);
    setError(null);
    try {
      setQuote((await sf<{ quote: Quote }>('checkout/quote', { method: 'POST', body: { addressId, paymentMethod: method } })).quote);
    } catch (err) {
      setQuote(null);
      setError(errorMessage(err));
    } finally {
      setQuoting(false);
    }
  }, [addressId, method]);

  useEffect(() => {
    idempotencyKey.current = null; // a different request needs a new key
    if (view?.quote.lines.length) void requote();
  }, [requote, view]);

  if (!signedIn) {
    return (
      <div className="mx-auto mt-10 max-w-sm">
        <p className="mb-6 text-center text-sm text-muted">Sign in with your mobile number to continue. Your bag is kept.</p>
        <SignIn onSignedIn={async () => (await refresh(), router.refresh())} />
      </div>
    );
  }

  const lines = (quote ?? view?.quote)?.lines ?? [];
  if (loaded && (!view || view.quote.lines.length === 0)) {
    return (
      <div className="py-24 text-center">
        <p className="font-display text-2xl">Your bag is empty</p>
        <Link href="/shop" className="btn-primary mt-6">Continue shopping</Link>
      </div>
    );
  }

  const blocking = quote?.issues ?? [];
  const canPlace = Boolean(quote && addressId && blocking.length === 0 && !quoting && !placing);
  // Why the button is disabled, in plain words (null while it is enabled or an error message is already shown).
  const payHint = canPlace || placing
    ? null
    : !addressId
      ? adding || addresses?.length === 0
        ? 'Save your delivery address to continue.'
        : 'Select a delivery address to continue.'
      : blocking.length > 0
        ? 'Fix the item issues above to continue.'
        : quoting || (!quote && !error)
          ? 'Updating your total…'
          : null;

  const place = async () => {
    if (!quote || !addressId) return;
    setPlacing(true);
    setError(null);
    idempotencyKey.current ??= crypto.randomUUID();
    try {
      const { order } = await sf<{ order: Order }>('checkout/orders', {
        method: 'POST',
        headers: { 'idempotency-key': idempotencyKey.current },
        body: { addressId, paymentMethod: method, expectedTotalPaise: quote.totalPaise },
      });
      idempotencyKey.current = null;
      await refresh();
      let paymentNote = '';
      if (order.paymentMethod === 'online') {
        // The order exists now; if payment cannot start, the order page offers "Pay now" again.
        try {
          await startPayment(order.orderNumber);
        } catch {
          paymentNote = '&payment=retry';
        }
      }
      router.push(`/account/orders/${order.orderNumber}?placed=1${paymentNote}`);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'price_changed') {
        const details = err.details as { quote?: Quote } | undefined;
        if (details?.quote) setQuote(details.quote);
        idempotencyKey.current = null;
      }
      setError(errorMessage(err));
      setPlacing(false);
    }
  };

  return (
    <div className="mt-10 grid gap-12 lg:grid-cols-[1fr_420px]">
      <div className="space-y-12">
        <Step n={1} title="Delivery address">
          {addresses === null ? (
            <div className="skeleton h-24 rounded-2xl" />
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                {addresses.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    aria-pressed={addressId === a.id}
                    onClick={() => setAddressId(a.id)}
                    className={`relative rounded-2xl border p-5 text-left text-sm transition ${addressId === a.id ? 'border-fg bg-surface shadow-sm' : 'border-line hover:border-fg/40'}`}
                  >
                    {addressId === a.id && <CheckIcon className="absolute right-4 top-4" width={18} height={18} />}
                    <p className="font-medium">{a.name}</p>
                    <p className="mt-1 text-muted">{[a.line1, a.line2, a.landmark].filter(Boolean).join(', ')}</p>
                    <p className="text-muted">{a.city}, {a.state} {a.pincode}</p>
                    <p className="mt-1 text-muted">{a.phone}</p>
                  </button>
                ))}
              </div>
              <AnimatePresence initial={false}>
                {adding ? (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="mt-6 overflow-hidden">
                    <AddressForm
                      onSaved={(a) => {
                        setAddresses((list) => [...(list ?? []).map((x) => (a.isDefault ? { ...x, isDefault: false } : x)), a]);
                        setAddressId(a.id);
                        setAdding(false);
                      }}
                      onCancel={addresses.length ? () => setAdding(false) : undefined}
                    />
                  </motion.div>
                ) : (
                  <button className="btn-outline mt-4" onClick={() => setAdding(true)}>Add a new address</button>
                )}
              </AnimatePresence>
            </>
          )}
        </Step>

        <Step n={2} title="Payment">
          <div className="grid gap-3 sm:grid-cols-2">
            {([
              ['online', 'Pay online', 'UPI, cards, netbanking and wallets'],
              ['cod', 'Cash on delivery', quote?.codFeePaise ? `${money(quote.codFeePaise)} fee` : 'Pay when it arrives'],
            ] as const).map(([value, title, sub]) => (
              <button
                key={value}
                type="button"
                aria-pressed={method === value}
                onClick={() => setMethod(value)}
                className={`relative rounded-2xl border p-5 text-left transition ${method === value ? 'border-fg bg-surface shadow-sm' : 'border-line hover:border-fg/40'}`}
              >
                {method === value && <CheckIcon className="absolute right-4 top-4" width={18} height={18} />}
                <p className="font-medium">{title}</p>
                <p className="mt-1 text-sm text-muted">{sub}</p>
              </button>
            ))}
          </div>
        </Step>
      </div>

      <aside className="lg:sticky lg:top-24 lg:self-start">
        <div className="card p-6">
          <h2 className="font-display text-2xl">Order summary</h2>
          <ul className="mt-6 max-h-72 space-y-4 overflow-y-auto pr-1">
            {lines.map((l) => (
              <li key={l.itemId} className="flex gap-3 text-sm">
                <div className="relative h-16 w-13 shrink-0 overflow-hidden rounded-md bg-line">
                  {l.imageUrl && <Image src={l.imageUrl} alt="" fill sizes="52px" className="object-cover" />}
                  <span className="absolute -right-0 -top-0 rounded-bl-md bg-fg px-1.5 text-[10px] text-bg">{l.quantity}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate">{l.productTitle}</p>
                  <p className="text-xs text-muted">{l.variantTitle}</p>
                </div>
                <span>{money(l.lineTotalPaise)}</span>
              </li>
            ))}
          </ul>

          {quote && (
            <dl className={`mt-6 space-y-2 border-t border-line pt-4 text-sm transition ${quoting ? 'opacity-50' : ''}`}>
              <Row label="Subtotal" value={money(quote.subtotalPaise)} />
              {quote.itemDiscountPaise > 0 && <Row label="Discounts" value={`−${money(quote.itemDiscountPaise)}`} sale />}
              <Row label="Shipping" value={quote.shippingPaise - quote.shippingDiscountPaise <= 0 ? 'Free' : money(quote.shippingPaise - quote.shippingDiscountPaise)} />
              {quote.codFeePaise > 0 && <Row label="COD fee" value={money(quote.codFeePaise)} />}
              {quote.appliedPromotions.map((p) => (
                <p key={p.name} className="text-xs text-sale">✓ {p.name}{p.couponCode ? ` (${p.couponCode})` : ''}</p>
              ))}
              <div className="flex justify-between border-t border-line pt-3 text-lg font-medium">
                <dt>Total</dt>
                <dd>{money(quote.totalPaise)}</dd>
              </div>
              <p className="text-xs text-muted">Includes {money(quote.taxPaise)} GST</p>
              {quote.shipping?.estimatedDays && (
                <p className="text-xs text-muted">Arrives in {quote.shipping.estimatedDays[0]}–{quote.shipping.estimatedDays[1]} days</p>
              )}
            </dl>
          )}

          {blocking.length > 0 && (
            <ul className="mt-4 space-y-1 rounded-xl bg-sale/10 p-3 text-xs text-sale">
              {blocking.map((i, k) => <li key={k}>{i.message}</li>)}
            </ul>
          )}
          {error && <p className="mt-4 text-sm text-sale" role="alert">{error}</p>}

          <button className="btn-primary mt-6 w-full py-4" disabled={!canPlace} onClick={place} aria-describedby={payHint ? 'pay-hint' : undefined}>
            {placing ? 'Placing order…' : method === 'online' ? `Pay ${quote ? money(quote.totalPaise) : ''}` : 'Place order'}
          </button>
          {payHint && <p id="pay-hint" className="mt-3 text-center text-sm text-muted" role="status">{payHint}</p>}
          <p className="mt-4 flex items-center justify-center gap-2 text-xs text-muted">
            <ShieldIcon width={14} height={14} /> Prices are confirmed by the store before your order is placed.
          </p>
        </div>
      </aside>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-5 flex items-center gap-3 font-display text-2xl">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-fg text-sm text-bg">{n}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Row({ label, value, sale }: { label: string; value: string; sale?: boolean }) {
  return (
    <div className={`flex justify-between ${sale ? 'text-sale' : ''}`}>
      <dt className={sale ? '' : 'text-muted'}>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
