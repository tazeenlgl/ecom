'use client';

import { AnimatePresence, motion } from 'motion/react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { sf } from '@/lib/client-api';
import { money } from '@/lib/format';
import type { Page, ProductSummary } from '@/lib/types';
import { CloseIcon, SearchIcon } from './icons';

/** Instant search: debounced title search against the products endpoint. */
export function SearchOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<ProductSummary[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => input.current?.focus(), 50);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setResults([]);
      return;
    }
    setLoading(true);
    const ctrl = { cancelled: false };
    const t = setTimeout(async () => {
      try {
        const page = await sf<Page<ProductSummary>>(`products?q=${encodeURIComponent(term)}&limit=6`);
        if (!ctrl.cancelled) setResults(page.items);
      } catch {
        if (!ctrl.cancelled) setResults([]);
      } finally {
        if (!ctrl.cancelled) setLoading(false);
      }
    }, 220);
    return () => {
      ctrl.cancelled = true;
      clearTimeout(t);
    };
  }, [q]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 bg-bg/97 backdrop-blur-xl"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          role="dialog"
          aria-modal="true"
          aria-label="Search"
        >
          <div className="container-x pt-6">
            <div className="flex justify-end">
              <button className="btn-ghost rounded-full" onClick={onClose} aria-label="Close search">
                <CloseIcon />
              </button>
            </div>
            <form
              className="mx-auto mt-8 max-w-3xl"
              onSubmit={(e) => {
                e.preventDefault();
                if (q.trim()) router.push(`/shop?q=${encodeURIComponent(q.trim())}`);
              }}
            >
              <label className="flex items-center gap-4 border-b-2 border-accent pb-3">
                <SearchIcon width={28} height={28} />
                <input
                  ref={input}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search products"
                  className="w-full bg-transparent font-display text-3xl outline-none placeholder:text-muted/50 sm:text-5xl"
                  aria-label="Search products"
                />
              </label>
            </form>
            <div className="mx-auto mt-10 max-w-3xl">
              {loading && <p className="text-sm text-muted">Searching…</p>}
              {!loading && q.trim().length >= 2 && results.length === 0 && <p className="text-sm text-muted">No products match “{q.trim()}”.</p>}
              <ul className="grid grid-cols-2 gap-6 sm:grid-cols-3">
                {results.map((p, i) => (
                  <motion.li key={p.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
                    <Link href={`/p/${p.slug}`} className="group block" onClick={onClose}>
                      <div className="relative aspect-[4/5] overflow-hidden rounded-xl bg-line">
                        {p.imageUrl && <Image src={p.imageUrl} alt="" fill sizes="240px" className="object-cover transition duration-700 group-hover:scale-105" />}
                      </div>
                      <p className="mt-2 text-sm">{p.title}</p>
                      <p className="text-sm text-muted">{money(p.minPricePaise)}</p>
                    </Link>
                  </motion.li>
                ))}
              </ul>
              {results.length > 0 && (
                <Link href={`/shop?q=${encodeURIComponent(q.trim())}`} className="btn-outline mt-8" onClick={onClose}>
                  See all results
                </Link>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
