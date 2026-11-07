'use client';

import { AnimatePresence, motion } from 'motion/react';
import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import type { Media } from '@/lib/types';
import { CloseIcon } from './icons';

/** Pieces of the editorial product page (only rendered for stores with the editorial look). */

const Chevron = ({ dir }: { dir: 'left' | 'right' }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    <path d={dir === 'left' ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7'} strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** Full-screen photo viewer with arrows, keyboard and swipe-free fallbacks (Esc closes, arrow keys move). */
export function Lightbox({ images, index, title, onClose, onIndex }: { images: Media[]; index: number | null; title: string; onClose: () => void; onIndex: (i: number) => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const open = index !== null;
  useEffect(() => {
    if (!open) return;
    const prevFocus = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') onIndex(((index ?? 0) + 1) % images.length);
      if (e.key === 'ArrowLeft') onIndex(((index ?? 0) - 1 + images.length) % images.length);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      prevFocus?.focus();
    };
  }, [open, index, images.length, onClose, onIndex]);

  const img = index !== null ? images[index] : undefined;
  return (
    <AnimatePresence>
      {open && img && (
        <motion.div role="dialog" aria-modal="true" aria-label={`${title} photos`} className="fixed inset-0 z-[60] bg-bg/95 backdrop-blur-xl" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div key={img.url} className="absolute inset-4 bottom-20 sm:inset-16" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.45, ease: [0.3, 1, 0.3, 1] }}>
              <Image src={img.url} alt={img.altText ?? title} fill sizes="100vw" className="object-contain" />
            </motion.div>
          </AnimatePresence>
          <button ref={closeRef} onClick={onClose} aria-label="Close photos" className="absolute right-4 top-4 grid h-11 w-11 place-items-center rounded-full bg-surface shadow-sm ring-1 ring-line transition hover:bg-accent hover:text-accent-fg">
            <CloseIcon />
          </button>
          {images.length > 1 && (
            <div className="absolute inset-x-0 bottom-5 flex items-center justify-center gap-4">
              <button onClick={() => onIndex((index! - 1 + images.length) % images.length)} aria-label="Previous photo" className="grid h-11 w-11 place-items-center rounded-full bg-surface ring-1 ring-line transition hover:bg-accent hover:text-accent-fg"><Chevron dir="left" /></button>
              <span className="min-w-14 text-center text-sm tabular-nums text-muted">{index! + 1} / {images.length}</span>
              <button onClick={() => onIndex((index! + 1) % images.length)} aria-label="Next photo" className="grid h-11 w-11 place-items-center rounded-full bg-surface ring-1 ring-line transition hover:bg-accent hover:text-accent-fg"><Chevron dir="right" /></button>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Phone and tablet gallery: a swipeable full-width slider with arrows and a counter. Tapping a photo opens the viewer. */
export function MobileGallery({ images, title, onOpen }: { images: Media[]; title: string; onOpen: (i: number) => void }) {
  const track = useRef<HTMLDivElement>(null);
  const [current, setCurrent] = useState(0);
  useEffect(() => {
    track.current?.scrollTo({ left: 0 });
    setCurrent(0);
  }, [images]);
  const go = (i: number) => {
    const el = track.current;
    if (el) el.scrollTo({ left: el.clientWidth * i, behavior: 'smooth' });
  };
  return (
    <div className="relative -mx-4 sm:-mx-6">
      <div
        ref={track}
        className="no-scrollbar flex snap-x snap-mandatory overflow-x-auto"
        onScroll={(e) => setCurrent(Math.round(e.currentTarget.scrollLeft / e.currentTarget.clientWidth))}
      >
        {images.map((m, i) => (
          <button key={m.url + i} onClick={() => onOpen(i)} aria-label={`Open photo ${i + 1}`} className="relative aspect-[4/5] w-full shrink-0 snap-center bg-line">
            <Image src={m.url} alt={m.altText ?? title} fill priority={i === 0} sizes="100vw" className="object-cover" />
          </button>
        ))}
      </div>
      {images.length > 1 && (
        <>
          <button onClick={() => go(Math.max(0, current - 1))} disabled={current === 0} aria-label="Previous photo" className="absolute left-3 top-[40%] grid h-10 w-10 place-items-center rounded-full bg-surface/85 shadow-sm backdrop-blur transition disabled:opacity-0">
            <Chevron dir="left" />
          </button>
          <button onClick={() => go(Math.min(images.length - 1, current + 1))} disabled={current === images.length - 1} aria-label="Next photo" className="absolute right-3 top-[40%] grid h-10 w-10 place-items-center rounded-full bg-surface/85 shadow-sm backdrop-blur transition disabled:opacity-0">
            <Chevron dir="right" />
          </button>
          <div className="absolute inset-x-0 bottom-14 flex justify-center gap-1.5" aria-hidden="true">
            {images.map((m, i) => (
              <span key={m.url + i} className={`h-1.5 rounded-full bg-surface transition-all duration-500 ease-editorial ${i === current ? 'w-6' : 'w-1.5 opacity-60'}`} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * "Where's the discount?" strip on top of the buy box. The code and text come from the store's productOffer setting (Admin);
 * nothing is shown without it, and checkout still validates the coupon.
 */
export function DiscountStrip({ code, text }: { code: string; text: string }) {
  const [open, setOpen] = useState(true);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked: the code is still visible to copy by hand */
    }
  };
  return (
    <div className="-mx-6 -mt-6 mb-6 overflow-hidden rounded-t-3xl bg-fg text-bg lg:-mx-8 lg:-mt-8">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between px-6 py-4 text-left text-sm font-medium lg:px-8">
        Where’s the discount?
        <motion.svg animate={{ rotate: open ? 0 : 180 }} transition={{ duration: 0.3 }} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M6 15l6-6 6 6" strokeLinecap="round" strokeLinejoin="round" />
        </motion.svg>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.35, ease: [0.3, 1, 0.3, 1] }} className="overflow-hidden">
            <div className="flex items-center justify-between gap-4 border-t border-bg/15 px-6 py-4 lg:px-8">
              <div className="min-w-0">
                <p className="text-sm font-semibold tracking-[0.08em]">{code}</p>
                <p className="mt-1 text-xs text-bg/75">{text}</p>
              </div>
              <button type="button" onClick={copy} aria-label={copied ? 'Code copied' : `Copy code ${code}`} className="grid h-9 min-w-9 shrink-0 place-items-center rounded-full px-2 text-xs transition hover:bg-bg/15">
                {copied ? (
                  'Copied'
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                    <rect x="8" y="8" width="12" height="12" rx="3" />
                    <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
                  </svg>
                )}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <span className="sr-only" aria-live="polite">{copied ? 'Code copied' : ''}</span>
    </div>
  );
}

export type FeatureTab ={ label: string; content: React.ReactNode };

/** Numbered tabs (01 Details, 02 …) shown under the product, like a key-features block. Only tabs with content are passed in. */
export function KeyFeatures({ tabs }: { tabs: FeatureTab[] }) {
  const [active, setActive] = useState(0);
  if (!tabs.length) return null;
  return (
    <section className="mt-16 rounded-3xl bg-surface p-6 ring-1 ring-line sm:p-10 lg:mt-24 lg:p-14" aria-labelledby="key-features">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] lg:gap-16">
        <div>
          <p className="eyebrow">Key features</p>
          <h2 id="key-features" className="display-title mt-3 text-4xl sm:text-5xl">The details</h2>
          <div role="tablist" aria-label="Product details" className="mt-8 flex flex-wrap gap-2 lg:flex-col lg:items-start">
            {tabs.map((t, i) => (
              <button
                key={t.label}
                role="tab"
                id={`kf-tab-${i}`}
                aria-selected={i === active}
                aria-controls={`kf-panel-${i}`}
                onClick={() => setActive(i)}
                className="relative rounded-full px-5 py-2.5 text-sm transition-colors aria-selected:text-accent-fg lg:px-0 lg:py-1 lg:font-display lg:text-2xl lg:aria-selected:text-accent"
              >
                {i === active && <motion.span layoutId="kf-pill" className="absolute inset-0 -z-10 rounded-full bg-accent lg:hidden" transition={{ type: 'spring', damping: 30, stiffness: 300 }} />}
                <span className="mr-2 text-xs tabular-nums opacity-70 lg:align-top">{String(i + 1).padStart(2, '0')}</span>
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={active}
            role="tabpanel"
            id={`kf-panel-${active}`}
            aria-labelledby={`kf-tab-${active}`}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.35, ease: [0.3, 1, 0.3, 1] }}
            className="self-center"
          >
            {tabs[active]!.content}
          </motion.div>
        </AnimatePresence>
      </div>
    </section>
  );
}
