import { cookies, headers } from 'next/headers';
import { cache } from 'react';
import { clientIpFromHeaders, trustedProxyHops } from './client-ip';
import { ApiError } from './errors';
import type { Block, Customer, Link, Store } from './types';

/** Cookie names. Both are httpOnly: browser JavaScript never sees the tokens. */
export const SESSION_COOKIE = 'sf_session';
export const CART_COOKIE = 'sf_cart';

export const API_URL = (process.env.API_URL ?? 'http://localhost:4000').replace(/\/$/, '');

/** The storefront host the API resolves the store from. */
export async function storeHost(): Promise<string> {
  const override = process.env.STORE_HOST_OVERRIDE?.trim();
  if (override) return override;
  const h = await headers();
  return (h.get('x-forwarded-host') ?? h.get('host') ?? '').split(',')[0]!.trim();
}

/** Headers for a server-to-server call: forwarded host, client IP and the shopper's tokens. */
export async function upstreamHeaders(extra: Record<string, string> = {}): Promise<Record<string, string>> {
  const [h, jar, host] = await Promise.all([headers(), cookies(), storeHost()]);
  const out: Record<string, string> = { accept: 'application/json', 'x-forwarded-host': host, 'x-forwarded-proto': 'https', ...extra };
  // Never copy the browser's own header: forward a client IP only when it can be derived through trusted proxies.
  const ip = clientIpFromHeaders(h, trustedProxyHops());
  if (ip) out['x-forwarded-for'] = ip;
  const session = jar.get(SESSION_COOKIE)?.value;
  if (session) out.authorization = `Bearer ${session}`;
  const cart = jar.get(CART_COOKIE)?.value;
  if (cart) out['x-cart-token'] = cart;
  return out;
}

/** Server-side call to /v1/storefront/*. Never cached: responses depend on the host and the shopper. */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}/v1/storefront/${path.replace(/^\//, '')}`, {
    ...init,
    headers: await upstreamHeaders((init.headers as Record<string, string>) ?? {}),
    cache: 'no-store',
  });
  if (res.status === 204) return undefined as T;
  const body = (await res.json().catch(() => null)) as { error?: { code: string; message: string; details?: unknown } } | null;
  if (!res.ok) throw new ApiError(res.status, body?.error?.code ?? 'error', body?.error?.message ?? res.statusText, body?.error?.details);
  return body as T;
}

/** Like `api` but returns null on 404 (and on 401 for signed-in-only data). */
export async function apiOrNull<T>(path: string): Promise<T | null> {
  try {
    return await api<T>(path);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 401)) return null;
    throw err;
  }
}

/**
 * Local-preview branding override (apps/web/.env.local only, leave unset elsewhere): shows another display
 * name and logo without touching the store's database record. Real stores set both in their admin settings.
 */
function withPreviewBrand(store: Store): Store {
  const name = process.env.STOREFRONT_BRAND_NAME?.trim();
  if (!name) return store;
  const logoUrl = process.env.STOREFRONT_LOGO_URL?.trim();
  return { ...store, name, brand: { ...store.brand, name }, settings: { ...store.settings, ...(logoUrl ? { logoUrl } : {}) } };
}

/**
 * The editorial storefront look is opt-in per store: `settings.theme.variant = "editorial"` (set in the store's settings).
 * STOREFRONT_EDITORIAL_STORES (comma-separated store slugs) turns it on for a local preview without editing the store record.
 */
function withVariant(store: Store): Store {
  if (store.settings.theme?.variant) return store;
  const slugs = (process.env.STOREFRONT_EDITORIAL_STORES ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return slugs.includes(store.slug) ? { ...store, settings: { ...store.settings, theme: { ...store.settings.theme, variant: 'editorial' } } } : store;
}

/**
 * Local preview only: STOREFRONT_PREVIEW_OFFER="CODE|text" shows a product-page offer when the store has none and the app is not a
 * production build. It is display only; checkout accepts the code only if a real coupon with that code exists.
 */
function withPreviewOffer(store: Store): Store {
  const raw = process.env.STOREFRONT_PREVIEW_OFFER;
  if (process.env.NODE_ENV === 'production') return store;
  const settings = { ...store.settings };
  const [offerCode, offerText] = (raw ?? '').split('|').map((s) => s.trim());
  if (!settings.productOffer && offerCode && offerText) settings.productOffer = { code: offerCode, text: offerText };
  // STOREFRONT_PREVIEW_PROMO="Title|text" does the same for the product-page promo note.
  const [title, note] = (process.env.STOREFRONT_PREVIEW_PROMO ?? '').split('|').map((s) => s.trim());
  if (!settings.productPromo && title && note) settings.productPromo = { title, text: note };
  // STOREFRONT_PREVIEW_LAYOUT="productsPhone,productsComputer,categoriesPhone,categoriesComputer" (e.g. 2,4,2,5) previews cards per row.
  const n = (process.env.STOREFRONT_PREVIEW_LAYOUT ?? '').split(',').map((x) => Number(x.trim()));
  if (!settings.layout && n.length === 4 && n.every(Number.isInteger)) settings.layout = { products: { mobile: n[0]!, desktop: n[1]! }, categories: { mobile: n[2]!, desktop: n[3]! } };
  return { ...store, settings };
}

export const getStore = cache(async () => withPreviewOffer(withVariant(withPreviewBrand((await api<{ store: Store }>('store')).store))));

/** True when the store has a published content page with this slug (used to show footer links only for pages that exist). */
export const pageExists = cache(async (slug: string): Promise<boolean> => (await apiOrNull<{ page: unknown }>(`pages/${encodeURIComponent(slug)}`)) !== null);

export const getNavigation =cache(async (): Promise<Link[]> => {
  const { items } = await api<{ items: Block<{ items: Link[] }>[] }>('content/blocks?kind=navigation');
  return items[0]?.data.items ?? [];
});

export const getCustomer = cache(async (): Promise<Customer | null> => {
  const jar = await cookies();
  if (!jar.get(SESSION_COOKIE)) return null;
  return (await apiOrNull<{ customer: Customer }>('me'))?.customer ?? null;
});

export function pageTitle(store: Store, title?: string) {
  if (!title) return store.name;
  const tpl = store.settings.seo?.titleTemplate;
  return tpl?.includes('%s') ? tpl.replace('%s', title) : `${title} | ${store.name}`;
}
