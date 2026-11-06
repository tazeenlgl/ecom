/**
 * Pure helpers that turn stored catalogue data into search/social metadata. They use only the product's own
 * fields and never invent text. Rules: docs/product-management/SEO_AND_CONTENT_GENERATION.md (Part C).
 */

export type StockState = 'in_stock' | 'out_of_stock' | 'unknown';

/** `available` is the POS cache value; a missing row (null) means the POS never told us, which is not "out of stock". */
export const stockState = (available: number | null | undefined): StockState => (available === null || available === undefined ? 'unknown' : available > 0 ? 'in_stock' : 'out_of_stock');

/** Plain text for snippets: bullet markers, URLs and line breaks removed, whitespace collapsed. */
export function plainText(input: string | null | undefined): string {
  if (!input) return '';
  return input
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Abbreviations whose full stop does not end a sentence ("Rs. 500", "No. 5").
const ABBREVIATIONS = /\b(Rs|No|Mr|Mrs|Ms|Dr|St|approx|vs|etc)\./g;
const DOT = '\u0000';

export function sentences(text: string): string[] {
  return text
    .replace(ABBREVIATIONS, (_m, word: string) => `${word}${DOT}`)
    .split(/(?<=[.!?।])\s+/)
    .map((s) => s.split(DOT).join('.').trim())
    .filter(Boolean);
}

/**
 * Meta description from a product description: whole sentences that fit in `max` characters. A first sentence that
 * is already too long is NOT cut (a mechanical cut ends mid-word); the result is null and the caller omits the tag.
 */
export function metaDescription(description: string | null | undefined, max = 155): string | null {
  const parts = sentences(plainText(description));
  let out = '';
  for (const sentence of parts) {
    const next = out ? `${out} ${sentence}` : sentence;
    if (next.length > max) break;
    out = next;
  }
  return out || null;
}

/**
 * The canonical address of a product: the store's primary verified domain, never the request host or alias.
 * An admin-set canonical is honoured only when it is https, on one of the store's verified domains, and has no
 * query or fragment. Without a verified primary domain there is no canonical (and the page is not indexable).
 */
export function canonicalProductUrl(input: { primaryHost: string | null; verifiedHosts: string[]; slug: string; override?: string | null }): string | null {
  if (!input.primaryHost) return null;
  const own = `https://${input.primaryHost}/p/${input.slug}`;
  if (!input.override) return own;
  try {
    const url = new URL(input.override);
    if (url.protocol !== 'https:' || url.search || url.hash || url.username || url.password) return own;
    return input.verifiedHosts.includes(url.hostname.toLowerCase()) ? `https://${url.host}${url.pathname.replace(/\/+$/, '') || '/'}` : own;
  } catch {
    return own;
  }
}

export type Crumb = { name: string; slug: string };

/** Root-to-leaf category chain for the product's first category, or [] when it has none. Guards against cycles. */
export function breadcrumbChain(all: { id: string; parentId: string | null; slug: string; name: string }[], leafId: string | undefined): Crumb[] {
  if (!leafId) return [];
  const byId = new Map(all.map((c) => [c.id, c]));
  const chain: Crumb[] = [];
  const seen = new Set<string>();
  for (let cur = byId.get(leafId); cur && !seen.has(cur.id) && chain.length < 6; cur = cur.parentId ? byId.get(cur.parentId) : undefined) {
    seen.add(cur.id);
    chain.unshift({ name: cur.name, slug: cur.slug });
  }
  return chain;
}
