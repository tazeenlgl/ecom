const inrWhole = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const inrPaise = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Money is integer paise everywhere in the API. Whole rupees show no decimals; otherwise always two (₹559.80). */
export function money(paise: number | null | undefined) {
  if (paise === null || paise === undefined) return '';
  return (paise % 100 === 0 ? inrWhole : inrPaise).format(paise / 100);
}

export function percentOff(mrp: number | null | undefined, price: number | null | undefined) {
  if (!mrp || !price || mrp <= price) return 0;
  return Math.round(((mrp - price) / mrp) * 100);
}

export function date(value: string | null | undefined) {
  if (!value) return '';
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value));
}

export function dateTime(value: string) {
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(value));
}

export function humanize(state: string) {
  return state.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

/** Map brand theme settings (hex colours only) to CSS custom properties. */
const THEME_KEYS: Record<string, string> = {
  background: '--brand-bg',
  foreground: '--brand-fg',
  text: '--brand-fg',
  muted: '--brand-muted',
  border: '--brand-line',
  surface: '--brand-surface',
  primary: '--brand-accent',
  accent: '--brand-accent',
  primaryForeground: '--brand-accent-fg',
  sale: '--brand-sale',
};
const clamp = (n: number | undefined, lo: number, hi: number, fallback: number) => (Number.isInteger(n) ? Math.min(hi, Math.max(lo, n as number)) : fallback);

/**
 * Cards per row set by the store (phone and computer) for products and categories, as CSS variables. The tablet count is
 * derived (never more than the computer count, at least 3 when it fits) so a store only has to think about two sizes.
 */
export function layoutStyle(layout: { products?: { mobile: number; desktop: number }; categories?: { mobile: number; desktop: number } } | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, prefix, dm, dd] of [['products', 'prod', 2, 4], ['categories', 'cat', 2, 5]] as const) {
    const m = clamp(layout?.[key]?.mobile, 1, 3, dm);
    const d = clamp(layout?.[key]?.desktop, 2, 6, dd);
    out[`--${prefix}-m`] = String(m);
    out[`--${prefix}-t`] = String(Math.min(d, Math.max(m, 3)));
    out[`--${prefix}-d`] = String(d);
  }
  return out;
}

export function themeStyle(theme: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(theme ?? {})) {
    const cssVar = THEME_KEYS[key];
    if (cssVar && /^#[0-9a-fA-F]{6}$/.test(value)) out[cssVar] = value;
  }
  return out;
}
