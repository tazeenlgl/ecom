import { describe, expect, it } from 'vitest';
import { breadcrumbChain, canonicalProductUrl, metaDescription, plainText, sentences, stockState } from '../src/modules/catalogue/seo.js';

describe('stockState', () => {
  it('treats a SKU the POS never reported as unknown, not out of stock', () => {
    expect(stockState(null)).toBe('unknown');
    expect(stockState(undefined)).toBe('unknown');
    expect(stockState(0)).toBe('out_of_stock');
    expect(stockState(3)).toBe('in_stock');
  });
});

describe('plainText', () => {
  it('removes bullet markers, links and line breaks', () => {
    expect(plainText('Soft cotton.\n- machine wash\n* cool iron\nSee https://x.example/a for care.')).toBe('Soft cotton. machine wash cool iron See for care.');
    expect(plainText(null)).toBe('');
  });
});

describe('metaDescription', () => {
  it('uses whole sentences that fit and never cuts a sentence', () => {
    const text = 'A soft cotton kurta. It has a relaxed fit. The seams are hand finished and the fabric is pre-washed for a gentle feel.';
    const out = metaDescription(text, 60)!;
    expect(out).toBe('A soft cotton kurta. It has a relaxed fit.');
    expect(text.startsWith(out)).toBe(true);
  });

  it('returns null rather than cutting a first sentence that is too long', () => {
    expect(metaDescription('word '.repeat(60), 155)).toBeNull();
    expect(metaDescription('', 155)).toBeNull();
    expect(metaDescription(null)).toBeNull();
    expect(metaDescription('- one\n- two')).toBe('one two');
  });

  it('accepts a sentence of exactly the limit and rejects one character more', () => {
    const exact = `${'a'.repeat(154)}.`;
    expect(exact).toHaveLength(155);
    expect(metaDescription(exact, 155)).toBe(exact);
    expect(metaDescription(`${'a'.repeat(155)}.`, 155)).toBeNull();
  });

  it('does not split on abbreviations and handles Devanagari full stops', () => {
    expect(sentences('Priced at Rs. 500 only. Free delivery.')).toEqual(['Priced at Rs. 500 only.', 'Free delivery.']);
    expect(sentences('यह एक कुर्ता है। यह मुलायम है।')).toEqual(['यह एक कुर्ता है।', 'यह मुलायम है।']);
    expect(metaDescription('यह एक कुर्ता है। यह मुलायम है।', 155)).toBe('यह एक कुर्ता है। यह मुलायम है।');
  });

  it('keeps hostile text as text (no markup is interpreted)', () => {
    expect(metaDescription('<script>alert(1)</script> Nice.', 155)).toBe('<script>alert(1)</script> Nice.');
  });
});

describe('canonicalProductUrl', () => {
  const base = { primaryHost: 'shop.example.com', verifiedHosts: ['shop.example.com', 'alias.example.com'], slug: 'kurta' };
  it('uses the primary verified domain, never an alias or the request host', () => {
    expect(canonicalProductUrl(base)).toBe('https://shop.example.com/p/kurta');
  });
  it('has no canonical without a verified primary domain', () => {
    expect(canonicalProductUrl({ ...base, primaryHost: null })).toBeNull();
  });
  it('honours an override only on a verified domain of the same store, over https, without query or credentials', () => {
    expect(canonicalProductUrl({ ...base, override: 'https://alias.example.com/p/other/' })).toBe('https://alias.example.com/p/other');
    for (const bad of ['https://elsewhere.example/p/x', 'http://alias.example.com/p/x', 'https://alias.example.com/p/x?utm=1', 'https://alias.example.com/p/x#a', 'https://u:p@alias.example.com/p/x', 'javascript:alert(1)', 'not a url']) {
      expect(canonicalProductUrl({ ...base, override: bad }), bad).toBe('https://shop.example.com/p/kurta');
    }
  });
});

describe('breadcrumbChain', () => {
  const cats = [
    { id: 'a', parentId: null, slug: 'women', name: 'Women' },
    { id: 'b', parentId: 'a', slug: 'kurtas', name: 'Kurtas' },
  ];
  it('returns the root-to-leaf chain', () => {
    expect(breadcrumbChain(cats, 'b')).toEqual([{ name: 'Women', slug: 'women' }, { name: 'Kurtas', slug: 'kurtas' }]);
  });
  it('is empty without a category and survives a parent cycle', () => {
    expect(breadcrumbChain(cats, undefined)).toEqual([]);
    const cyc = [{ id: 'x', parentId: 'y', slug: 'x', name: 'X' }, { id: 'y', parentId: 'x', slug: 'y', name: 'Y' }];
    expect(breadcrumbChain(cyc, 'x').length).toBeLessThanOrEqual(2);
  });
});
