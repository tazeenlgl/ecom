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
export function themeStyle(theme: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(theme ?? {})) {
    const cssVar = THEME_KEYS[key];
    if (cssVar && /^#[0-9a-fA-F]{6}$/.test(value)) out[cssVar] = value;
  }
  return out;
}
