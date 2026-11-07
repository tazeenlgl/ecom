'use client';

import Image from 'next/image';
import Link from 'next/link';
import { type CSSProperties, useCallback, useEffect, useRef, useState } from 'react';
import { ArrowIcon } from './icons';
import { Reveal } from './reveal';

export type CategoryTile = { href: string; label: string; imageUrl: string | null };

const Chevron = ({ dir }: { dir: 'left' | 'right' }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
    <path d={dir === 'left' ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7'} strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/**
 * Editorial "Shop by category" slider. Phones show exactly two tiles; tablets three; on a computer every category fits in one
 * row (up to five), and anything beyond slides. Arrows sit on the row's edges whenever there is more to see (hidden otherwise,
 * dimmed at either end), with a progress bar underneath. Swipe on touch, drag with a mouse, or use the arrow keys when the row
 * has focus. Tiles snap into place.
 */
export function CategoryShowcase({ heading, tiles }: { heading?: string; tiles: CategoryTile[] }) {
  const track = useRef<HTMLUListElement>(null);
  const [state, setState] = useState({ start: true, end: true, progress: 1 });
  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null);

  const update = useCallback(() => {
    const el = track.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const view = el.clientWidth / el.scrollWidth;
    setState({ start: el.scrollLeft < 4, end: el.scrollLeft >= max - 4, progress: max <= 4 ? 1 : view + (el.scrollLeft / max) * (1 - view) });
  }, []);
  useEffect(() => {
    update();
    const el = track.current;
    if (!el) return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [update]);

  /** Moves by one page of tiles (what is currently in view), never past the ends. */
  const move = (dir: 1 | -1) => {
    const el = track.current;
    const tile = el?.querySelector('li');
    if (!el || !tile) return;
    const step = tile.getBoundingClientRect().width + parseFloat(getComputedStyle(el).columnGap || '0');
    const perView = Math.max(1, Math.floor((el.clientWidth + 1) / step));
    el.scrollBy({ left: dir * step * perView, behavior: 'smooth' });
  };

  if (tiles.length === 0) return null;
  const scrollable = !(state.start && state.end);
  const n = tiles.length;
  // Tile width = (row width − gaps) / tiles per view. Tiles per view is the store's setting (phone, tablet, computer from the
  // --cat-* variables), capped by how many categories there are so a short list fills the row instead of leaving a gap.
  const vars = {
    '--per-phone': `min(${n}, var(--cat-m, 2))`,
    '--per-sm': `min(${n}, var(--cat-t, 3))`,
    '--per-lg': `min(${n}, var(--cat-d, 5))`,
  } as CSSProperties;

  const arrow = 'absolute top-1/2 z-10 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-fg shadow-md ring-1 ring-black/5 backdrop-blur transition hover:bg-accent hover:text-accent-fg disabled:pointer-events-none disabled:opacity-0 sm:h-11 sm:w-11';

  return (
    <section className="mt-14 lg:mt-24" aria-labelledby={heading ? 'shop-by-category' : undefined} aria-roledescription="carousel">
      <div className="container-x flex items-end justify-between gap-4">
        <Reveal>
          <p className="eyebrow">Categories</p>
          {heading && <h2 id="shop-by-category" className="display-title mt-2 text-3xl sm:text-4xl lg:text-5xl">{heading}</h2>}
        </Reveal>
        <Link href="/shop" className="group flex shrink-0 items-center gap-2 text-sm hover:text-accent">
          <span className="hidden sm:inline">View all</span>
          <span className="grid h-9 w-9 place-items-center rounded-full ring-1 ring-line transition group-hover:bg-accent group-hover:text-accent-fg group-hover:ring-accent" aria-hidden="true">
            <ArrowIcon width={16} height={16} />
          </span>
          <span className="sr-only sm:hidden">View all categories</span>
        </Link>
      </div>

      <div className="relative mt-6 sm:mt-8">
        <ul
          ref={track}
          style={vars}
          tabIndex={scrollable ? 0 : -1}
          aria-label={heading ?? 'Categories'}
          onScroll={update}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') (e.preventDefault(), move(1));
            if (e.key === 'ArrowLeft') (e.preventDefault(), move(-1));
          }}
          onPointerDown={(e) => {
            if (e.pointerType !== 'mouse' || !scrollable) return;
            drag.current = { x: e.clientX, left: e.currentTarget.scrollLeft, moved: false };
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d) return;
            const dx = e.clientX - d.x;
            if (Math.abs(dx) > 5) {
              d.moved = true;
              e.currentTarget.style.scrollSnapType = 'none';
              e.currentTarget.scrollLeft = d.left - dx;
            }
          }}
          onPointerUp={(e) => {
            if (!drag.current) return;
            e.currentTarget.style.scrollSnapType = '';
            setTimeout(() => (drag.current = null), 0);
          }}
          onPointerLeave={(e) => {
            if (drag.current) e.currentTarget.style.scrollSnapType = '';
            drag.current = null;
          }}
          onClickCapture={(e) => {
            // A drag should not also open the tile under the mouse.
            if (drag.current?.moved) e.preventDefault();
          }}
          className="no-scrollbar container-x flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto overscroll-x-contain outline-none select-none focus-visible:ring-2 focus-visible:ring-accent/40 sm:scroll-px-6 sm:gap-4 lg:scroll-px-10 lg:gap-5"
        >
          {tiles.map((t, i) => (
            <li
              key={t.href}
              className="w-[calc((100%-(var(--per-phone)-1)*0.75rem)/var(--per-phone))] shrink-0 snap-start sm:w-[calc((100%-(var(--per-sm)-1)*1rem)/var(--per-sm))] lg:w-[calc((100%-(var(--per-lg)-1)*1.25rem)/var(--per-lg))]"
            >
              <Reveal delay={(i % 5) * 0.07}>
                <Link href={t.href} draggable={false} className="group relative block aspect-[3/4] overflow-hidden rounded-2xl bg-accent-soft ring-1 ring-line/60 sm:rounded-3xl">
                  {t.imageUrl ? (
                    <Image
                      src={t.imageUrl}
                      alt=""
                      fill
                      draggable={false}
                      sizes="(min-width: 1024px) 22vw, (min-width: 768px) 25vw, (min-width: 640px) 33vw, 50vw"
                      className="object-cover object-top transition duration-[1.6s] ease-editorial group-hover:scale-[1.06]"
                    />
                  ) : (
                    <span className="absolute inset-0 grid place-items-center font-display text-6xl text-accent/25">{t.label.slice(0, 1)}</span>
                  )}
                  <span className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/5 to-transparent transition duration-700 group-hover:from-black/80" />
                  <span className="absolute left-2.5 top-2.5 rounded-full bg-white/85 px-2 py-0.5 text-[10px] font-medium tabular-nums text-fg backdrop-blur sm:left-4 sm:top-4 sm:px-2.5 sm:py-1 sm:text-[11px]">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span className="absolute inset-x-3 bottom-3 flex items-end justify-between gap-2 text-white sm:inset-x-5 sm:bottom-5">
                    <span className="font-display text-lg leading-tight sm:text-2xl lg:text-[1.75rem]">{t.label}</span>
                    {/* Small arrow on phones; a "Shop now" pill that slides up on hover on larger screens. */}
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white text-fg sm:hidden" aria-hidden="true">
                      <ArrowIcon width={13} height={13} />
                    </span>
                  </span>
                  <span className="absolute inset-x-5 bottom-5 hidden translate-y-2 justify-end opacity-0 transition duration-500 ease-editorial group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100 sm:flex">
                    <span className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-xs font-medium text-fg shadow-sm">
                      Shop now <ArrowIcon width={14} height={14} />
                    </span>
                  </span>
                </Link>
              </Reveal>
            </li>
          ))}
        </ul>

        {scrollable && (
          <>
            <button type="button" onClick={() => move(-1)} disabled={state.start} aria-label="Previous categories" className={`${arrow} left-2 sm:left-3 lg:left-6`}>
              <Chevron dir="left" />
            </button>
            <button type="button" onClick={() => move(1)} disabled={state.end} aria-label="Next categories" className={`${arrow} right-2 sm:right-3 lg:right-6`}>
              <Chevron dir="right" />
            </button>
          </>
        )}
      </div>

      {scrollable && (
        <div className="container-x mt-5">
          <div className="mx-auto h-0.5 max-w-xs overflow-hidden rounded-full bg-line" aria-hidden="true">
            <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${Math.round(state.progress * 100)}%` }} />
          </div>
        </div>
      )}
    </section>
  );
}
