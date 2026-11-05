'use client';

import { motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { sf } from '@/lib/client-api';
import type { Page, ProductSummary } from '@/lib/types';
import { ProductCard } from './product-card';

/** Product grid with infinite scroll (cursor pagination through the BFF). */
export function ProductGrid({ initial, query }: { initial: Page<ProductSummary>; query: string }) {
  const [items, setItems] = useState(initial.items);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [loading, setLoading] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setItems(initial.items);
    setCursor(initial.nextCursor);
  }, [initial]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || !cursor) return;
    const io = new IntersectionObserver(async ([entry]) => {
      if (!entry?.isIntersecting || loading) return;
      setLoading(true);
      try {
        const sep = query ? '&' : '';
        const page = await sf<Page<ProductSummary>>(`products?${query}${sep}limit=24&cursor=${encodeURIComponent(cursor)}`);
        setItems((prev) => [...prev, ...page.items]);
        setCursor(page.nextCursor);
      } finally {
        setLoading(false);
      }
    }, { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [cursor, loading, query]);

  if (items.length === 0) {
    return (
      <div className="py-24 text-center">
        <p className="font-display text-2xl">Nothing here yet</p>
        <p className="mt-2 text-sm text-muted">Try another search or browse all products.</p>
      </div>
    );
  }

  return (
    <>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-3 xl:grid-cols-4">
        {items.map((p, i) => (
          <motion.li
            key={p.id}
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-40px' }}
            transition={{ duration: 0.7, delay: (i % 4) * 0.06, ease: [0.16, 1, 0.3, 1] }}
          >
            <ProductCard product={p} priority={i < 4} />
          </motion.li>
        ))}
      </ul>
      <div ref={sentinel} aria-hidden />
      {loading && (
        <div className="mt-10 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="skeleton aspect-[4/5] rounded-2xl" />
          ))}
        </div>
      )}
    </>
  );
}
