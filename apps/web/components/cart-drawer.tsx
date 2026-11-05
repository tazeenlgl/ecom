'use client';

import { AnimatePresence, motion } from 'motion/react';
import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { money } from '@/lib/format';
import { useCart } from './cart-provider';
import { CloseIcon, MinusIcon, PlusIcon } from './icons';

export function CartDrawer() {
  const { view, open, setOpen, update, remove, busy, error, applyCoupon, removeCoupon } = useCart();
  const quote = view?.quote;
  const lines = quote?.lines ?? [];
  const [code, setCode] = useState('');
  const [couponError, setCouponError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, setOpen]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-50 bg-fg/30 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpen(false)}
          />
          <motion.aside
            role="dialog"
            aria-modal="true"
            aria-label="Shopping bag"
            className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col bg-bg shadow-2xl"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 32, stiffness: 320 }}
          >
            <header className="flex items-center justify-between border-b border-line px-6 py-5">
              <h2 className="font-display text-2xl">Your bag</h2>
              <button className="btn-ghost rounded-full" onClick={() => setOpen(false)} aria-label="Close bag">
                <CloseIcon />
              </button>
            </header>

            {lines.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
                <p className="font-display text-xl">Your bag is empty</p>
                <p className="text-sm text-muted">Pieces you add will appear here.</p>
                <Link href="/shop" className="btn-primary mt-2" onClick={() => setOpen(false)}>
                  Start shopping
                </Link>
              </div>
            ) : (
              <>
                <ul className="flex-1 divide-y divide-line overflow-y-auto px-6">
                  <AnimatePresence initial={false}>
                    {lines.map((line) => (
                      <motion.li
                        key={line.itemId}
                        layout
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, x: 40 }}
                        className="flex gap-4 py-5"
                      >
                        <Link href={`/p/${line.productSlug}`} onClick={() => setOpen(false)} className="relative h-28 w-22 shrink-0 overflow-hidden rounded-lg bg-line">
                          {line.imageUrl && <Image src={line.imageUrl} alt="" fill sizes="88px" className="object-cover" />}
                        </Link>
                        <div className="flex min-w-0 flex-1 flex-col">
                          <div className="flex justify-between gap-2">
                            <Link href={`/p/${line.productSlug}`} onClick={() => setOpen(false)} className="truncate text-sm font-medium">
                              {line.productTitle}
                            </Link>
                            <span className="text-sm">{money(line.lineTotalPaise)}</span>
                          </div>
                          <p className="text-xs text-muted">{line.variantTitle}</p>
                          {line.discountPaise > 0 && <p className="mt-1 text-xs text-sale">You save {money(line.discountPaise)}</p>}
                          {(!line.sellable || (line.availableQuantity !== null && line.availableQuantity < line.quantity)) && (
                            <p className="mt-1 text-xs text-sale">{line.sellable ? `Only ${line.availableQuantity} left` : 'No longer available'}</p>
                          )}
                          <div className="mt-auto flex items-center justify-between pt-3">
                            <div className="flex items-center rounded-full border border-line">
                              <button
                                className="p-2 disabled:opacity-30"
                                aria-label="Decrease quantity"
                                disabled={busy || line.quantity <= 1}
                                onClick={() => update(line.itemId, line.quantity - 1)}
                              >
                                <MinusIcon width={14} height={14} />
                              </button>
                              <span className="w-6 text-center text-sm tabular-nums">{line.quantity}</span>
                              <button
                                className="p-2 disabled:opacity-30"
                                aria-label="Increase quantity"
                                disabled={busy || line.quantity >= 10}
                                onClick={() => update(line.itemId, line.quantity + 1)}
                              >
                                <PlusIcon width={14} height={14} />
                              </button>
                            </div>
                            <button className="text-xs text-muted underline-offset-4 hover:underline" onClick={() => remove(line.itemId)}>
                              Remove
                            </button>
                          </div>
                        </div>
                      </motion.li>
                    ))}
                  </AnimatePresence>
                </ul>

                <footer className="space-y-4 border-t border-line px-6 py-5">
                  {view?.cart.couponCode ? (
                    <div className="flex items-center justify-between rounded-xl bg-accent/5 px-4 py-3 text-sm">
                      <span>
                        Code <strong>{view.cart.couponCode}</strong> applied
                      </span>
                      <button className="text-xs underline" onClick={() => removeCoupon()}>
                        Remove
                      </button>
                    </div>
                  ) : (
                    <form
                      className="flex gap-2"
                      onSubmit={async (e) => {
                        e.preventDefault();
                        if (!code.trim()) return;
                        const err = await applyCoupon(code.trim());
                        setCouponError(err);
                        if (!err) setCode('');
                      }}
                    >
                      <input className="field py-2.5" placeholder="Coupon code" value={code} onChange={(e) => setCode(e.target.value)} aria-label="Coupon code" />
                      <button className="btn-outline px-5 py-2.5">Apply</button>
                    </form>
                  )}
                  {couponError && <p className="text-xs text-sale">{couponError}</p>}
                  {error && <p className="text-xs text-sale">{error}</p>}

                  <dl className="space-y-1.5 text-sm">
                    <div className="flex justify-between">
                      <dt className="text-muted">Subtotal</dt>
                      <dd>{money(quote!.subtotalPaise)}</dd>
                    </div>
                    {quote!.discountPaise > 0 && (
                      <div className="flex justify-between text-sale">
                        <dt>Discounts</dt>
                        <dd>−{money(quote!.discountPaise)}</dd>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <dt className="text-muted">Shipping</dt>
                      <dd className="text-muted">Calculated at checkout</dd>
                    </div>
                    <div className="flex justify-between pt-2 text-base font-medium">
                      <dt>Estimated total</dt>
                      <dd>{money(quote!.totalPaise)}</dd>
                    </div>
                  </dl>
                  <Link href="/checkout" className="btn-primary w-full" onClick={() => setOpen(false)}>
                    Checkout
                  </Link>
                  <p className="text-center text-xs text-muted">Shipping and final total are confirmed at checkout.</p>
                </footer>
              </>
            )}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
