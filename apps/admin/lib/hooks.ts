'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorText } from './client';

/** GET a path through the BFF. Pass null to skip. `reload()` refetches (use after a write). */
export function useFetch<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!path) return;
    const mine = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const r = await api<T>(path);
      if (mine === seq.current) setData(r);
    } catch (e) {
      if (mine === seq.current) setError(errorText(e));
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    setData(null);
    void load();
  }, [load]);

  return { data, error, loading, reload: load };
}

type Page<T> = { items: T[]; nextCursor?: string | null };

/** Cursor-paginated list. Changing `path` (incl. its query string) restarts from the first page. */
export function useList<T>(path: string | null) {
  const [items, setItems] = useState<T[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const seq = useRef(0);

  const fetchPage = useCallback(
    async (cursor: string | null, append: boolean) => {
      if (!path) return;
      const mine = ++seq.current;
      setLoading(true);
      setError(null);
      try {
        const sep = path.includes('?') ? '&' : '?';
        const r = await api<Page<T>>(cursor ? `${path}${sep}cursor=${encodeURIComponent(cursor)}` : path);
        if (mine !== seq.current) return;
        setItems((cur) => (append ? [...cur, ...r.items] : r.items));
        setNext(r.nextCursor ?? null);
      } catch (e) {
        if (mine === seq.current) setError(errorText(e));
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    },
    [path],
  );

  useEffect(() => {
    setItems([]);
    setNext(null);
    void fetchPage(null, false);
  }, [fetchPage]);

  return { items, error, loading, hasMore: Boolean(next), loadMore: () => fetchPage(next, true), reload: () => fetchPage(null, false) };
}

export function useDebounced<T>(value: T, ms = 350): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
