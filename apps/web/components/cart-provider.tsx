'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError } from '@/lib/errors';
import { errorMessage, sf } from '@/lib/client-api';
import type { CartView } from '@/lib/types';

type CartContextValue = {
  view: CartView | null;
  /** True once the first cart load finished (view stays null when there is no cart). */
  loaded: boolean;
  count: number;
  open: boolean;
  busy: boolean;
  error: string | null;
  setOpen: (open: boolean) => void;
  refresh: () => Promise<void>;
  add: (variantId: string, quantity?: number) => Promise<boolean>;
  update: (itemId: string, quantity: number) => Promise<void>;
  remove: (itemId: string) => Promise<void>;
  applyCoupon: (code: string) => Promise<string | null>;
  removeCoupon: () => Promise<void>;
};

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<CartView | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setView(await sf<CartView>('cart'));
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setView(null);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = useCallback(async (fn: () => Promise<CartView>) => {
    setBusy(true);
    setError(null);
    try {
      setView(await fn());
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const value = useMemo<CartContextValue>(
    () => ({
      view,
      loaded,
      count: view?.quote.lines.reduce((n, l) => n + l.quantity, 0) ?? 0,
      open,
      busy,
      error,
      setOpen,
      refresh,
      add: async (variantId, quantity = 1) => {
        const ok = await run(() => sf<CartView>('cart/items', { method: 'POST', body: { variantId, quantity } }));
        if (ok) setOpen(true);
        return ok;
      },
      update: async (itemId, quantity) => {
        // Optimistic: reflect the new quantity at once, then replace with the server quote.
        setView((v) => (v ? { ...v, quote: { ...v.quote, lines: v.quote.lines.map((l) => (l.itemId === itemId ? { ...l, quantity } : l)) } } : v));
        await run(() => sf<CartView>(`cart/items/${itemId}`, { method: 'PATCH', body: { quantity } }));
      },
      remove: async (itemId) => {
        setView((v) => (v ? { ...v, quote: { ...v.quote, lines: v.quote.lines.filter((l) => l.itemId !== itemId) } } : v));
        await run(() => sf<CartView>(`cart/items/${itemId}`, { method: 'DELETE' }));
      },
      applyCoupon: async (code) => {
        try {
          setView(await sf<CartView>('cart/coupon', { method: 'PUT', body: { code } }));
          return null;
        } catch (err) {
          return errorMessage(err);
        }
      },
      removeCoupon: async () => {
        await run(() => sf<CartView>('cart/coupon', { method: 'DELETE' }));
      },
    }),
    [view, loaded, open, busy, error, refresh, run],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used inside CartProvider');
  return ctx;
}
