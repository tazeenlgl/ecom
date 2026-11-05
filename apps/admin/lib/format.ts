const inrWhole = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const inrPaise = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Money is integer paise everywhere in the API. Whole rupees show no decimals; otherwise always two (₹4,049.10). */
export function money(paise: number | null | undefined): string {
  if (paise === null || paise === undefined) return '—';
  return (paise % 100 === 0 ? inrWhole : inrPaise).format(paise / 100);
}

/** Rupees typed in a form (e.g. "4499" or "4,499.50") to integer paise, or null when not a valid amount. */
export function toPaise(input: string): number | null {
  const clean = input.replace(/[,\s₹]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  return Math.round(Number(clean) * 100);
}

export const fromPaise = (paise: number | null | undefined): string => (paise === null || paise === undefined ? '' : String(paise / 100));

export function dateTime(v: string | null | undefined): string {
  if (!v) return '—';
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(v));
}

export function dateOnly(v: string | null | undefined): string {
  if (!v) return '—';
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(v));
}

export const humanize = (s: string): string => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

/** Local datetime input value ("2026-11-05T10:30") to an ISO string, or null when empty. */
export const localToIso = (v: string): string | null => (v ? new Date(v).toISOString() : null);
export const isoToLocal = (v: string | null | undefined): string => {
  if (!v) return '';
  const d = new Date(v);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

export const slugify = (s: string): string => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120);
