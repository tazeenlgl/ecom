'use client';

import { AnimatePresence, motion } from 'motion/react';
import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { errorMessage, sf } from '@/lib/client-api';
import { money, percentOff } from '@/lib/format';
import type { Product } from '@/lib/types';
import { useCart } from './cart-provider';
import { CloseIcon } from './icons';

/**
 * Quick view: opens over the page, loads the full product, and lets the shopper pick options and add to the bag without
 * leaving the listing. Prices and stock come from the product API; the cart and checkout still re-check them.
 */
export function QuickView({ slug, onClose }: { slug: string | null; onClose: () => void }) {
  const [product, setProduct] = useState<Product | null>(null);
  const [error, setError] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!slug) return;
    let live = true;
    setProduct(null);
    setError(null);
    sf<{ product: Product }>(`products/${encodeURIComponent(slug)}`)
      .then((r) => live && setProduct(r.product))
      .catch((e) => live && setError(errorMessage(e)));
    return () => {
      live = false;
    };
  }, [slug]);

  useEffect(() => {
    if (!slug) return;
    const prevFocus = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      prevFocus?.focus();
    };
  }, [slug, onClose]);

  return (
    <AnimatePresence>
      {slug && (
        <motion.div className="fixed inset-0 z-[60] flex items-end justify-center bg-fg/40 backdrop-blur-sm sm:items-center sm:p-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={product ? `Quick view: ${product.title}` : 'Quick view'}
            className="relative max-h-[92svh] w-full max-w-4xl overflow-y-auto rounded-t-3xl bg-bg shadow-2xl sm:rounded-3xl"
            initial={{ y: 40, opacity: 0.6 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            transition={{ duration: 0.4, ease: [0.3, 1, 0.3, 1] }}
            onClick={(e) => e.stopPropagation()}
          >
            <button ref={closeRef} onClick={onClose} aria-label="Close quick view" className="absolute right-4 top-4 z-10 grid h-10 w-10 place-items-center rounded-full bg-surface shadow-sm ring-1 ring-line transition hover:bg-accent hover:text-accent-fg">
              <CloseIcon />
            </button>
            {error ? (
              <p className="p-10 text-sm text-sale">{error}</p>
            ) : !product ? (
              <div className="grid gap-6 p-6 sm:grid-cols-2" aria-busy="true">
                <div className="skeleton aspect-[4/5] rounded-2xl" />
                <div className="space-y-3 pt-8">
                  <div className="skeleton h-8 w-3/4 rounded" />
                  <div className="skeleton h-5 w-1/3 rounded" />
                  <div className="skeleton h-12 w-full rounded-full" />
                </div>
              </div>
            ) : (
              <QuickViewBody product={product} onDone={onClose} />
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function QuickViewBody({ product, onDone }: { product: Product; onDone: () => void }) {
  const { add, busy } = useCart();
  const variants = product.variants;
  const groups = useMemo(() => {
    const map = new Map<string, { label: string; values: string[] }>();
    for (const v of variants)
      for (const [code, value] of Object.entries(v.options)) {
        const g = map.get(code) ?? { label: v.optionLabels[code] ?? code, values: [] };
        if (!g.values.includes(value)) g.values.push(value);
        map.set(code, g);
      }
    return [...map.entries()];
  }, [variants]);
  const first = variants.find((v) => v.inStock) ?? variants[0];
  const [selected, setSelected] = useState<Record<string, string>>(first?.options ?? {});
  const variant = variants.find((v) => Object.entries(selected).every(([k, val]) => v.options[k] === val)) ?? null;
  const images = product.media.filter((m) => m.kind === 'image');
  const [active, setActive] = useState(0);
  const off = percentOff(variant?.mrpPaise, variant?.pricePaise);
  const canBuy = Boolean(variant?.inStock);
  const isAvailable = (code: string, value: string) => variants.some((v) => v.options[code] === value && v.inStock && Object.entries(selected).every(([k, val]) => k === code || v.options[k] === val));

  return (
    <div className="grid gap-6 p-4 sm:grid-cols-2 sm:gap-8 sm:p-6">
      <div>
        <div className="relative aspect-[4/5] overflow-hidden rounded-2xl bg-line">
          {images[active] && <Image src={images[active].url} alt={images[active].altText ?? product.title} fill sizes="(min-width: 640px) 420px, 100vw" className="object-cover" />}
        </div>
        {images.length > 1 && (
          <div className="no-scrollbar mt-3 flex gap-2 overflow-x-auto">
            {images.map((m, i) => (
              <button key={m.url + i} onClick={() => setActive(i)} aria-label={`Show photo ${i + 1}`} aria-pressed={i === active} className="relative aspect-[4/5] w-14 shrink-0 overflow-hidden rounded-lg opacity-60 transition aria-pressed:opacity-100 aria-pressed:ring-2 aria-pressed:ring-accent">
                <Image src={m.url} alt="" fill sizes="56px" className="object-cover" />
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="flex flex-col sm:pt-8">
        <h2 className="display-title pr-10 text-3xl">{product.title}</h2>
        <div className="mt-3 flex items-baseline gap-3">
          <span className="text-xl font-semibold">{variant ? money(variant.pricePaise) : ''}</span>
          {off > 0 && (
            <>
              <span className="text-sm text-muted line-through">{money(variant!.mrpPaise)}</span>
              <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">{off}% off</span>
            </>
          )}
        </div>
        <p className="mt-1 text-xs text-muted">MRP inclusive of all taxes</p>

        <div className="mt-6 space-y-5">
          {groups.map(([code, g]) => (
            <fieldset key={code}>
              <legend className="label">
                {g.label}: <span className="text-fg normal-case tracking-normal">{selected[code]}</span>
              </legend>
              <div className="flex flex-wrap gap-2">
                {g.values.map((value) => {
                  const on = selected[code] === value;
                  return (
                    <button
                      key={value}
                      onClick={() => setSelected((s) => ({ ...s, [code]: value }))}
                      aria-pressed={on}
                      className={`min-w-11 rounded-full border px-4 py-2 text-sm transition ${on ? 'border-accent bg-accent text-accent-fg' : 'border-line hover:border-accent/50'} ${isAvailable(code, value) ? '' : 'text-muted line-through decoration-muted/60'}`}
                    >
                      {value}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          ))}
        </div>

        <button
          className="btn-primary mt-8 w-full py-3.5"
          disabled={!canBuy || busy}
          onClick={async () => {
            if (variant && (await add(variant.id, 1))) onDone();
          }}
        >
          {!variant ? 'Select options' : canBuy ? 'Add to bag' : variant.stock === 'unknown' ? 'Availability not confirmed' : 'Currently unavailable'}
        </button>
        <Link href={`/p/${product.slug}`} className="mt-4 text-center text-sm underline underline-offset-4 hover:text-accent">
          View full details
        </Link>
      </div>
    </div>
  );
}
