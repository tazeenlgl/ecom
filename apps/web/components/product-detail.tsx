'use client';

import { AnimatePresence, motion } from 'motion/react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { errorMessage, sf } from '@/lib/client-api';
import { money, percentOff } from '@/lib/format';
import type { Product, Serviceability } from '@/lib/types';
import { useCart } from './cart-provider';
import { CheckIcon, CloseIcon, ReturnIcon, TruckIcon } from './icons';
import { DiscountStrip, type FeatureTab, KeyFeatures, Lightbox, MobileGallery } from './product-editorial';
import { RichText } from './rich-text';

export function ProductDetail({ product, editorial = false, offer, promo }: { product: Product; editorial?: boolean; offer?: { code: string; text: string }; promo?: { title: string; text: string } }) {
  const { add, busy } = useCart();
  const router = useRouter();
  const variants = product.variants;

  // Option groups (e.g. colour, size) derived from the variants' options.
  const groups = useMemo(() => {
    const map = new Map<string, { label: string; values: string[] }>();
    for (const v of variants) {
      for (const [code, value] of Object.entries(v.options)) {
        const g = map.get(code) ?? { label: v.optionLabels[code] ?? code, values: [] };
        if (!g.values.includes(value)) g.values.push(value);
        map.set(code, g);
      }
    }
    return [...map.entries()];
  }, [variants]);

  const firstAvailable = variants.find((v) => v.inStock) ?? variants[0];
  const [selected, setSelected] = useState<Record<string, string>>(firstAvailable?.options ?? {});
  const variant = variants.find((v) => Object.entries(selected).every(([k, val]) => v.options[k] === val)) ?? null;
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);
  const [sizeChart, setSizeChart] = useState(false);

  const images = useMemo(() => {
    const all = product.media.filter((m) => m.kind === 'image');
    const forVariant = variant ? all.filter((m) => m.variantId === variant.id) : [];
    return forVariant.length ? [...forVariant, ...all.filter((m) => !m.variantId)] : all;
  }, [product.media, variant]);
  const [active, setActive] = useState(0);
  const [lightbox, setLightbox] = useState<number | null>(null);
  useEffect(() => setActive(0), [variant?.id]);

  // Remember recently viewed products in this browser only.
  useEffect(() => {
    try {
      const key = 'sf_recent';
      const list = JSON.parse(localStorage.getItem(key) ?? '[]') as string[];
      localStorage.setItem(key, JSON.stringify([product.slug, ...list.filter((s) => s !== product.slug)].slice(0, 12)));
    } catch {
      /* storage unavailable */
    }
  }, [product.slug]);

  const isAvailable = (code: string, value: string) =>
    variants.some((v) => v.options[code] === value && v.inStock && Object.entries(selected).every(([k, val]) => k === code || v.options[k] === val));

  const atcRef = useRef<HTMLDivElement>(null);
  const [showSticky, setShowSticky] = useState(false);
  useEffect(() => {
    const el = atcRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setShowSticky(!e!.isIntersecting && e!.boundingClientRect.top < 0));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const onAdd = async () => {
    if (!variant) return;
    if (await add(variant.id, qty)) {
      setAdded(true);
      setTimeout(() => setAdded(false), 1800);
    }
  };

  // Buy it now: the same cart add, then straight to the existing checkout (prices and stock are re-checked there).
  const onBuyNow = async () => {
    if (!variant) return;
    if (await add(variant.id, qty)) router.push('/checkout');
  };

  const off = percentOff(variant?.mrpPaise, variant?.pricePaise);
  const canBuy = Boolean(variant?.inStock);

  return (
    <div className="container-x pt-6 lg:pt-10 ed:max-lg:pt-0">
      <div className="grid gap-10 lg:grid-cols-[1.25fr_1fr] lg:gap-16 ed:lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)] ed:lg:gap-8">
        {/* Gallery */}
        <div className="lg:sticky lg:top-24 lg:self-start ed:hidden">
          <div className="min-w-0 flex-1">
            <Zoomable src={images[active]?.url} alt={images[active]?.altText ?? product.title} />
          </div>
          {images.length > 1 && (
            <div className="mt-3 flex gap-3 overflow-x-auto pb-1 ed:lg:mt-0 ed:lg:max-h-[calc(100svh-8rem)] ed:lg:flex-col ed:lg:overflow-x-visible ed:lg:overflow-y-auto ed:lg:p-1 no-scrollbar">
              {images.map((m, i) => (
                <button
                  key={m.url + i}
                  onClick={() => setActive(i)}
                  aria-label={`Image ${i + 1}`}
                  className={`relative aspect-[4/5] w-20 shrink-0 overflow-hidden rounded-lg transition ed:lg:w-16 ed:lg:rounded-xl ${i === active ? 'ring-2 ring-fg ring-offset-2 ring-offset-bg' : 'opacity-60 hover:opacity-100'}`}
                >
                  <Image src={m.url} alt="" fill sizes="80px" className="object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>

        {editorial && images.length > 0 && (
          <div className="lg:hidden">
            <MobileGallery images={images} title={product.title} onOpen={setLightbox} />
          </div>
        )}

        {/* Editorial desktop gallery: every photo stacked, with a floating thumbnail rail that scrolls to each one */}
        {images.length > 0 && (
          <div className="relative hidden ed:lg:block">
            {images.length > 1 && (
              <div className="pointer-events-none absolute inset-y-0 left-3 z-10">
                <div className="pointer-events-auto sticky top-28 flex w-14 flex-col gap-1.5 rounded-2xl bg-surface p-1.5 shadow-sm ring-1 ring-line">
                  {images.map((m, i) => (
                    <button key={m.url + i} aria-label={`Go to image ${i + 1}`} onClick={() => document.getElementById(`pimg-${i}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })} className="relative aspect-[4/5] overflow-hidden rounded-lg opacity-70 transition hover:opacity-100">
                      <Image src={m.url} alt="" fill sizes="48px" className="object-cover" />
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="space-y-3">
              {images.map((m, i) => (
                <motion.button
                  key={m.url + i}
                  id={`pimg-${i}`}
                  onClick={() => setLightbox(i)}
                  aria-label={`Open photo ${i + 1}`}
                  initial={{ opacity: 0, y: 24 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: '-10%' }}
                  transition={{ duration: 0.8, ease: [0.3, 1, 0.3, 1] }}
                  className="group relative block aspect-[4/5] w-full scroll-mt-24 cursor-zoom-in overflow-hidden rounded-3xl bg-line"
                >
                  <Image src={m.url} alt={m.altText ?? product.title} fill priority={i === 0} sizes="(min-width: 1024px) 60vw, 100vw" className="object-cover transition duration-[1.2s] ease-editorial group-hover:scale-[1.03]" />
                </motion.button>
              ))}
            </div>
          </div>
        )}

        {/* Buy box */}
        <div className="ed:max-lg:relative ed:max-lg:z-10 ed:max-lg:-mt-[5.5rem] ed:max-lg:shadow-[0_-12px_40px_-20px_rgb(31_22_38/0.25)] ed:rounded-3xl ed:bg-surface ed:p-6 ed:ring-1 ed:ring-line ed:lg:sticky ed:lg:top-24 ed:lg:max-h-[calc(100svh-7rem)] ed:lg:self-start ed:lg:overflow-y-auto ed:lg:p-8 no-scrollbar">
          {editorial && offer && <DiscountStrip code={offer.code} text={offer.text} />}
          <motion.h1 initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }} className="display-title text-4xl sm:text-5xl">
            {product.title}
          </motion.h1>

          <div className="mt-4 flex items-baseline gap-3">
            <span className="text-2xl">{variant ? money(variant.pricePaise) : ''}</span>
            {off > 0 && (
              <>
                <span className="text-muted line-through">{money(variant!.mrpPaise)}</span>
                <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">{off}% off</span>
              </>
            )}
          </div>
          <p className="mt-1 text-xs text-muted">MRP inclusive of all taxes</p>

          <div className="mt-8 space-y-6">
            {groups.map(([code, g]) => (
              <fieldset key={code}>
                <div className="mb-3 flex items-center justify-between">
                  <legend className="label mb-0">
                    {g.label}: <span className="text-fg normal-case tracking-normal">{selected[code]}</span>
                  </legend>
                  {product.sizeChart && /size/i.test(code + g.label) && (
                    <button className="text-xs underline underline-offset-4" onClick={() => setSizeChart(true)}>
                      Size guide
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {g.values.map((value) => {
                    const on = selected[code] === value;
                    const ok = isAvailable(code, value);
                    return (
                      <button
                        key={value}
                        onClick={() => setSelected((s) => ({ ...s, [code]: value }))}
                        aria-pressed={on}
                        className={`relative min-w-12 rounded-full border px-4 py-2.5 text-sm transition ed:aria-pressed:bg-accent ed:aria-pressed:text-accent-fg ${on ? 'border-accent text-accent' : 'border-line hover:border-accent/50'} ${ok ? '' : 'text-muted line-through decoration-muted/60'}`}
                      >
                        {on && <motion.span layoutId={`opt-${code}`} className="absolute inset-0 -z-10 rounded-full bg-accent-soft" />}
                        {value}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            ))}
          </div>

          {editorial && canBuy && (
            <p className="mt-6 flex items-center gap-2.5 text-sm text-emerald-800">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inset-0 animate-ping rounded-full bg-emerald-500/50 motion-reduce:hidden" />
                <span className="relative h-2.5 w-2.5 rounded-full bg-emerald-600 ring-4 ring-emerald-600/15" />
              </span>
              In stock, ready to ship
            </p>
          )}

          <div ref={atcRef} className="mt-8 flex gap-3 ed:mt-4">
            <div className="flex items-center rounded-full border border-line ed:bg-surface">
              <button className="px-4 py-3" aria-label="Decrease quantity" onClick={() => setQty((q) => Math.max(1, q - 1))}>
                −
              </button>
              <span className="w-6 text-center tabular-nums">{qty}</span>
              <button className="px-4 py-3" aria-label="Increase quantity" onClick={() => setQty((q) => Math.min(10, q + 1))}>
                +
              </button>
            </div>
            <button className="btn-primary flex-1 overflow-hidden ed:py-3.5" disabled={!canBuy || busy} onClick={onAdd}>
              <AnimatePresence mode="wait" initial={false}>
                <motion.span key={added ? 'added' : 'add'} initial={{ y: 16, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -16, opacity: 0 }} className="flex items-center gap-2">
                  {added ? (
                    <>
                      <CheckIcon width={16} height={16} /> Added to bag
                    </>
                  ) : !variant ? (
                    'Select options'
                  ) : canBuy ? (
                    'Add to bag'
                  ) : variant.stock === 'unknown' ? (
                    // The POS has not reported this SKU: say so rather than claim it is sold out.
                    'Availability not confirmed'
                  ) : (
                    'Currently unavailable'
                  )}
                </motion.span>
              </AnimatePresence>
            </button>
          </div>

          {editorial && (
            <button type="button" className="btn-outline mt-3 w-full border-fg/80 py-3.5 text-fg hover:border-accent" disabled={!canBuy || busy} onClick={onBuyNow}>
              Buy it now
            </button>
          )}

          <PincodeCheck />

          <div className="mt-10 divide-y divide-line border-y border-line ed:mt-4 ed:rounded-2xl ed:border ed:px-5">
            {product.description && (
              <Accordion title="Description" defaultOpen>
                <RichText text={product.description} />
              </Accordion>
            )}
            {!editorial && product.attributes.length > 0 && (
              <Accordion title="Details">
                <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
                  {product.attributes.map((a) => (
                    <div key={a.code} className="contents">
                      <dt className="text-muted">{a.label}</dt>
                      <dd>{Array.isArray(a.value) ? a.value.join(', ') : String(a.value)}</dd>
                    </div>
                  ))}
                </dl>
              </Accordion>
            )}
            {!editorial && <Specifications value={product.specifications} />}
            {editorial && product.sizeChart && (
              <Accordion title="Size guide">
                <ChartTable chart={product.sizeChart.chart} />
                {product.sizeChart.notes && <p className="mt-3 text-sm text-muted">{product.sizeChart.notes}</p>}
              </Accordion>
            )}
            <Accordion title="Shipping & returns">
              <div className="space-y-3 text-sm text-fg/80">
                <p className="flex gap-3"><TruckIcon className="shrink-0" /> Delivery time and charges depend on your PIN code and are confirmed at checkout.</p>
                <p className="flex gap-3"><ReturnIcon className="shrink-0" /> Returns and exchanges can be requested from your orders after delivery.</p>
              </div>
            </Accordion>
          </div>
          {editorial && promo && (
            <div className="mt-4 flex gap-3 rounded-2xl bg-accent-soft px-5 py-4 text-accent">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true" className="mt-0.5 shrink-0">
                <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" strokeLinejoin="round" />
              </svg>
              <div>
                <p className="text-sm font-semibold">{promo.title}</p>
                <p className="mt-0.5 text-xs text-accent/85">{promo.text}</p>
              </div>
            </div>
          )}
          {variant && <p className="mt-4 text-xs text-muted">SKU {variant.skuCode}</p>}
        </div>
      </div>

      {editorial && <KeyFeatures tabs={featureTabs(product)} />}
      <Lightbox images={images} index={lightbox} title={product.title} onClose={() => setLightbox(null)} onIndex={setLightbox} />

      {/* Sticky add-to-bag on mobile once the main button scrolls away */}
      <AnimatePresence>
        {showSticky && (
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="fixed inset-x-0 bottom-0 z-30 flex items-center gap-4 border-t border-line bg-bg/95 px-4 py-3 backdrop-blur-xl lg:hidden"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">{product.title}</p>
              <p className="text-sm font-medium">{variant ? money(variant.pricePaise) : ''}</p>
            </div>
            <button className="btn-primary px-5" disabled={!canBuy || busy} onClick={onAdd}>
              {added ? 'Added' : 'Add to bag'}
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {sizeChart && product.sizeChart && (
          <motion.div className="fixed inset-0 z-50 flex items-end justify-center bg-fg/30 sm:items-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setSizeChart(false)}>
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label="Size guide"
              className="max-h-[85vh] w-full max-w-2xl overflow-auto rounded-t-3xl bg-bg p-6 sm:rounded-3xl"
              initial={{ y: 40 }}
              animate={{ y: 0 }}
              exit={{ y: 40 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-display text-2xl">{product.sizeChart.name}</h2>
                <button className="btn-ghost rounded-full" onClick={() => setSizeChart(false)} aria-label="Close size guide">
                  <CloseIcon />
                </button>
              </div>
              <ChartTable chart={product.sizeChart.chart} />
              {product.sizeChart.notes && <p className="mt-4 text-sm text-muted">{product.sizeChart.notes}</p>}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Zoomable({ src, alt }: { src?: string; alt: string }) {
  const [origin, setOrigin] = useState<string | null>(null);
  return (
    <div
      className="relative aspect-[4/5] cursor-zoom-in overflow-hidden rounded-3xl bg-line"
      onMouseMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        setOrigin(`${((e.clientX - r.left) / r.width) * 100}% ${((e.clientY - r.top) / r.height) * 100}%`);
      }}
      onMouseLeave={() => setOrigin(null)}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        {src && (
          <motion.div key={src} className="absolute inset-0" initial={{ opacity: 0, scale: 1.03 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.5 }}>
            <Image
              src={src}
              alt={alt}
              fill
              priority
              sizes="(min-width: 1024px) 55vw, 100vw"
              className="object-cover transition-transform duration-300"
              style={origin ? { transform: 'scale(1.8)', transformOrigin: origin } : undefined}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Accordion({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button className="flex w-full items-center justify-between py-5 text-left text-sm font-medium ed:py-4 ed:text-[15px] ed:font-semibold" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {title}
        <motion.span animate={{ rotate: open ? 45 : 0 }} className="text-xl font-light leading-none">
          +
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }} className="overflow-hidden">
            <div className="pb-6">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function specEntries(value: unknown): (readonly [string, unknown])[] {
  if (!value || typeof value !== 'object') return [];
  return Array.isArray(value)
    ? value.filter((x): x is { label: string; value: unknown } => typeof x === 'object' && x !== null && 'label' in x).map((x) => [x.label, x.value] as const)
    : Object.entries(value as Record<string, unknown>);
}

const DefList = ({ rows }: { rows: (readonly [string, unknown])[] }) => (
  <dl className="divide-y divide-line text-sm">
    {rows.map(([k, v]) => (
      <div key={k} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-6 py-4">
        <dt className="text-muted">{k}</dt>
        <dd>{Array.isArray(v) ? v.join(', ') : typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)}</dd>
      </div>
    ))}
  </dl>
);

/** Editorial key-features tabs, built only from data the product already has. */
function featureTabs(product: Product): FeatureTab[] {
  const tabs: FeatureTab[] = [];
  if (product.attributes.length) tabs.push({ label: 'Details', content: <DefList rows={product.attributes.map((a) => [a.label, a.value] as const)} /> });
  const specs = specEntries(product.specifications);
  if (specs.length) tabs.push({ label: 'Specifications', content: <DefList rows={specs} /> });
  // Without real product details the block would only repeat the delivery note already in the buy box.
  if (!tabs.length) return [];
  tabs.push({
    label: 'Delivery & returns',
    content: (
      <div className="space-y-4 text-sm text-fg/80">
        <p className="flex gap-3"><TruckIcon className="shrink-0" /> Delivery time and charges depend on your PIN code and are confirmed at checkout.</p>
        <p className="flex gap-3"><ReturnIcon className="shrink-0" /> Returns and exchanges can be requested from your orders after delivery.</p>
      </div>
    ),
  });
  return tabs;
}

function Specifications({ value }: { value: unknown }) {
  const entries = specEntries(value);
  if (entries.length === 0) return null;
  return (
    <Accordion title="Specifications">
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
        {entries.map(([k, v]) => (
          <div key={String(k)} className="contents">
            <dt className="text-muted">{String(k)}</dt>
            <dd>{typeof v === 'object' ? JSON.stringify(v) : String(v)}</dd>
          </div>
        ))}
      </dl>
    </Accordion>
  );
}

/** Size charts are admin-defined JSON: either { headers, rows } or an array of row objects. */
function ChartTable({ chart }: { chart: unknown }) {
  let headers: string[] = [];
  let rows: unknown[][] = [];
  if (chart && typeof chart === 'object' && 'headers' in chart && 'rows' in chart) {
    const c = chart as { headers: string[]; rows: unknown[][] };
    headers = c.headers;
    rows = c.rows;
  } else if (Array.isArray(chart) && chart.length && typeof chart[0] === 'object') {
    headers = Object.keys(chart[0] as object);
    rows = chart.map((r) => headers.map((h) => (r as Record<string, unknown>)[h]));
  }
  if (!headers.length) return <pre className="text-xs">{JSON.stringify(chart, null, 2)}</pre>;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr>{headers.map((h) => <th key={h} className="border-b border-line py-2 pr-4 text-left font-medium">{h}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="odd:bg-fg/[0.02]">{r.map((c, j) => <td key={j} className="py-2 pr-4">{String(c ?? '')}</td>)}</tr>
        ))}
      </tbody>
    </table>
  );
}

function PincodeCheck() {
  const [pin, setPin] = useState('');
  const [result, setResult] = useState<Serviceability | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="mt-6 rounded-2xl bg-surface p-4 ring-1 ring-line"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        setResult(null);
        if (!/^[1-9]\d{5}$/.test(pin)) return setError('Enter a valid 6-digit PIN code.');
        try {
          setResult(await sf<Serviceability>(`shipping/serviceability?pincode=${pin}`));
        } catch (err) {
          setError(errorMessage(err));
        }
      }}
    >
      <label className="label" htmlFor="pin">Check delivery</label>
      <div className="flex gap-2">
        <input id="pin" inputMode="numeric" maxLength={6} className="field py-2.5" placeholder="PIN code" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
        <button className="btn-outline px-5 py-2.5">Check</button>
      </div>
      {error && <p className="mt-2 text-xs text-sale">{error}</p>}
      {result && (
        <p className="mt-3 text-sm">
          {result.serviceable ? (
            <>
              Delivers to {result.pincode}
              {result.estimatedDays ? ` in ${result.estimatedDays[0]}–${result.estimatedDays[1]} days` : ''}.{' '}
              {result.chargePaise === 0 ? 'Free shipping.' : result.freeAbovePaise ? `Free shipping above ${money(result.freeAbovePaise)}.` : ''}
              {result.codAvailable ? ' Cash on delivery available.' : ''}
            </>
          ) : (
            <span className="text-sale">Sorry, we don’t deliver to {result.pincode} yet.</span>
          )}
        </p>
      )}
    </form>
  );
}
