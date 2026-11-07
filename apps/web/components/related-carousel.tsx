'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { money, percentOff } from '@/lib/format';
import type { ProductSummary } from '@/lib/types';

const Arrow = ({ dir }: { dir: 'left' | 'right' }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    <path d={dir === 'left' ? 'M19 12H5m6-6l-6 6 6 6' : 'M5 12h14m-6-6l6 6-6 6'} strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/**
 * "You may also like" slider for the editorial product page: edge-to-edge white cards split by hairlines, a soft backdrop behind
 * each photo, a corner badge only when there is a real discount, and round arrows at the edges. Swipe or scroll on touch.
 */
export function RelatedCarousel({ products }: { products: ProductSummary[] }) {
  const track = useRef<HTMLUListElement>(null);
  const [edges, setEdges] = useState({ start: true, end: false });

  const update = useCallback(() => {
    const el = track.current;
    if (!el) return;
    setEdges({ start: el.scrollLeft < 8, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 8 });
  }, []);
  useEffect(() => {
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [update]);

  const move = (dir: 1 | -1) => {
    const el = track.current;
    const card = el?.querySelector('li');
    if (el && card) el.scrollBy({ left: dir * card.getBoundingClientRect().width, behavior: 'smooth' });
  };

  return (
    <section className="mt-16 lg:mt-24" aria-labelledby="related">
      <div className="container-x flex items-end justify-between gap-4">
        <h2 id="related" className="display-title text-3xl sm:text-4xl lg:text-5xl">You may also like</h2>
      </div>
      <div className="relative mt-8">
        <ul ref={track} onScroll={update} className="no-scrollbar flex snap-x snap-mandatory overflow-x-auto border-y border-line bg-surface">
          {products.map((p, i) => {
            const off = percentOff(p.maxMrpPaise, p.minPricePaise);
            return (
              <li key={p.id} className="w-[calc(100%/(var(--prod-m,2)+0.4))] shrink-0 snap-start border-r border-line md:w-[calc(100%/(var(--prod-t,3)+0.4))] lg:w-[calc(100%/(var(--prod-d,4)+0.4))]">
                <Link href={`/p/${p.slug}`} className="group block">
                  <div className="relative aspect-[4/5] overflow-hidden bg-[radial-gradient(ellipse_at_center,var(--brand-surface)_0%,var(--brand-accent-soft)_75%)]">
                    {p.imageUrl ? (
                      <Image
                        src={p.imageUrl}
                        alt={p.title}
                        fill
                        priority={i < 2}
                        sizes="(min-width: 1280px) 22vw, (min-width: 1024px) 23vw, (min-width: 768px) 31vw, 72vw"
                        className="object-cover object-top transition duration-[1.2s] ease-editorial group-hover:scale-[1.05]"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center font-display text-5xl text-muted/40">{p.title.slice(0, 1)}</div>
                    )}
                    {off > 0 && <span className="absolute left-3 top-3 rounded-md bg-surface px-2.5 py-1.5 text-xs font-medium text-fg shadow-sm">{off}% off</span>}
                    <span className="absolute inset-x-3 bottom-3 translate-y-2 rounded-full bg-surface/95 py-2.5 text-center text-xs font-medium opacity-0 shadow-sm backdrop-blur transition duration-500 ease-editorial group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100">
                      View product
                    </span>
                  </div>
                  <div className="px-4 pt-4 pb-5 sm:px-5">
                    <h3 className="truncate text-sm text-fg/85 transition-colors group-hover:text-accent">{p.title}</h3>
                    <p className="mt-1.5 flex items-baseline gap-2 text-sm">
                      <span className="font-semibold">{p.minPricePaise !== null ? money(p.minPricePaise) : ''}</span>
                      {off > 0 && <span className="text-xs text-muted line-through">{money(p.maxMrpPaise)}</span>}
                    </p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
        {products.length > 1 && (
          <>
            <button
              type="button"
              onClick={() => move(-1)}
              aria-label="Previous products"
              disabled={edges.start}
              className="absolute left-3 top-[40%] hidden h-12 w-12 place-items-center rounded-2xl bg-surface shadow-md ring-1 ring-line transition hover:bg-accent hover:text-accent-fg disabled:pointer-events-none disabled:opacity-0 md:grid"
            >
              <Arrow dir="left" />
            </button>
            <button
              type="button"
              onClick={() => move(1)}
              aria-label="Next products"
              disabled={edges.end}
              className="absolute right-3 top-[40%] hidden h-12 w-12 place-items-center rounded-2xl bg-surface shadow-md ring-1 ring-line transition hover:bg-accent hover:text-accent-fg disabled:pointer-events-none disabled:opacity-0 md:grid"
            >
              <Arrow dir="right" />
            </button>
          </>
        )}
      </div>
    </section>
  );
}
