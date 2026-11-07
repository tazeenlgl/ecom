'use client';

import { AnimatePresence, motion } from 'motion/react';
import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useState } from 'react';
import { colourHex } from '@/lib/colours';
import { money, percentOff } from '@/lib/format';
import type { ProductSummary } from '@/lib/types';
import { QuickView } from './quick-view';

/**
 * Card data. The optional fields are ready for the backend: until the product list sends them, the card simply leaves the
 * hover photo, label and colour dots out (a discount badge is still shown when there is a real discount).
 */
export type TileProduct = ProductSummary & {
  hoverImageUrl?: string | null;
  badge?: string | null;
  swatches?: { name: string; hex?: string | null }[];
};

export type ProductTab = { key: string; label: string; href: string; products: TileProduct[] };

/** Editorial homepage block: heading with pill tabs, then an edge-to-edge grid of product cards. Tabs switch instantly. */
export function ProductTabs({ heading, tabs }: { heading: string; tabs: ProductTab[] }) {
  const [active, setActive] = useState(0);
  const [quick, setQuick] = useState<string | null>(null);
  const close = useCallback(() => setQuick(null), []);
  if (!tabs.length) return null;
  const tab = tabs[active]!;

  return (
    <section className="mt-16 lg:mt-24" aria-labelledby="product-tabs-heading">
      <div className="container-x flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <h2 id="product-tabs-heading" className="display-title text-3xl sm:text-4xl lg:text-5xl">{heading}</h2>
        <div role="tablist" aria-label={heading} className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          {tabs.map((t, i) => (
            <button
              key={t.key}
              role="tab"
              id={`pt-tab-${t.key}`}
              aria-selected={i === active}
              aria-controls="pt-panel"
              onClick={() => setActive(i)}
              className="relative shrink-0 rounded-full border border-line bg-surface px-5 py-2 text-sm transition-colors hover:border-accent/50 aria-selected:border-accent aria-selected:text-accent-fg"
            >
              {i === active && <motion.span layoutId="pt-pill" className="absolute inset-0 -z-0 rounded-full bg-accent" transition={{ type: 'spring', damping: 30, stiffness: 320 }} />}
              <span className="relative">{t.label}</span>
            </button>
          ))}
        </div>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.ul
          key={tab.key}
          id="pt-panel"
          role="tabpanel"
          aria-labelledby={`pt-tab-${tab.key}`}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.35, ease: [0.3, 1, 0.3, 1] }}
          className="grid-products mt-8 border-t border-l border-line bg-surface"
        >
          {tab.products.map((p, i) => (
            <li key={p.id} className="border-r border-b border-line">
              <ProductTile product={p} priority={i < 2} onQuickView={setQuick} />
            </li>
          ))}
        </motion.ul>
      </AnimatePresence>
      <div className="container-x mt-6 flex justify-center">
        <Link href={tab.href} className="text-sm underline underline-offset-4 hover:text-accent">
          View all {tab.label}
        </Link>
      </div>

      <QuickView slug={quick} onClose={close} />
    </section>
  );
}

const EyeIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

/**
 * One card. At rest: photo on a soft backdrop, corner label, name and price. On hover (or keyboard focus): a second photo
 * wipes in when there is one, a quick-view eye appears, colour dots show along the photo's foot, and the price row turns
 * into "Choose options" (which opens the quick view). Touch screens keep the eye visible since there is no hover.
 */
export function ProductTile({ product: p, priority = false, onQuickView }: { product: TileProduct; priority?: boolean; onQuickView: (slug: string) => void }) {
  const off = percentOff(p.maxMrpPaise, p.minPricePaise);
  const badge = p.badge ?? p.label ?? (off > 0 ? `${off}% off` : null);
  const swatches = p.swatches ?? p.colours?.map((name) => ({ name, hex: colourHex(name) }));
  return (
    <div className="group/tile relative">
      <Link href={`/p/${p.slug}`} className="block">
        <div className="relative aspect-[4/5] overflow-hidden bg-[radial-gradient(ellipse_at_center,var(--brand-surface)_0%,var(--brand-accent-soft)_80%)]">
          {p.imageUrl ? (
            <Image src={p.imageUrl} alt={p.title} fill priority={priority} sizes="(min-width: 1280px) 20vw, (min-width: 1024px) 25vw, (min-width: 768px) 33vw, 50vw" className="object-cover object-top transition duration-[1.2s] ease-editorial group-hover/tile:scale-[1.04]" />
          ) : (
            <div className="flex h-full items-center justify-center font-display text-5xl text-muted/40">{p.title.slice(0, 1)}</div>
          )}
          {p.hoverImageUrl && (
            <Image
              src={p.hoverImageUrl}
              alt=""
              fill
              sizes="(min-width: 1280px) 20vw, (min-width: 1024px) 25vw, (min-width: 768px) 33vw, 50vw"
              className="object-cover object-top transition-[clip-path] duration-700 ease-editorial [clip-path:inset(0_100%_0_0)] group-hover/tile:[clip-path:inset(0_0_0_0)]"
            />
          )}
          {badge && <span className="absolute left-3 top-3 rounded-md bg-surface px-2.5 py-1.5 text-[11px] font-medium text-fg shadow-sm">{badge}</span>}
          {swatches && swatches.length > 0 && (
            <div className="absolute inset-x-0 bottom-0 flex translate-y-full items-center justify-between bg-surface/90 px-3 py-2 text-[11px] backdrop-blur transition duration-500 ease-editorial group-hover/tile:translate-y-0">
              <span className="text-muted">Colour</span>
              <span className="flex gap-1.5">
                {swatches.slice(0, 5).map((s) => (
                  <span key={s.name} title={s.name} className="h-3.5 w-3.5 rounded-full ring-1 ring-line" style={{ background: s.hex ?? 'var(--brand-line)' }} />
                ))}
              </span>
            </div>
          )}
        </div>
        <div className="px-4 pt-3.5 pb-4">
          <h3 className="truncate text-[13px] text-fg/85">{p.title}</h3>
          <p className="mt-1 flex h-5 items-baseline gap-2 text-sm transition duration-300 lg:group-hover/tile:-translate-y-1 lg:group-hover/tile:opacity-0">
            <span className="font-semibold">{p.minPricePaise !== null ? money(p.minPricePaise) : ''}</span>
            {off > 0 && <span className="text-xs text-muted line-through">{money(p.maxMrpPaise)}</span>}
          </p>
        </div>
      </Link>
      <button
        type="button"
        onClick={() => onQuickView(p.slug)}
        aria-label={`Quick view: ${p.title}`}
        className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full bg-surface text-fg shadow-sm ring-1 ring-line transition duration-300 hover:bg-accent hover:text-accent-fg focus-visible:opacity-100 lg:translate-y-1 lg:opacity-0 lg:group-hover/tile:translate-y-0 lg:group-hover/tile:opacity-100"
      >
        <EyeIcon />
      </button>
      <button
        type="button"
        onClick={() => onQuickView(p.slug)}
        tabIndex={-1}
        aria-hidden="true"
        className="absolute bottom-4 left-4 hidden translate-y-1 items-center gap-1.5 text-sm font-medium text-accent opacity-0 transition duration-300 group-hover/tile:translate-y-0 group-hover/tile:opacity-100 lg:flex"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-accent" /> Choose options
      </button>
    </div>
  );
}
