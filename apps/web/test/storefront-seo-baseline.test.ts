import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Storefront search/social output for products, the sitemap and robots (R1). No network: the API client is mocked.
 * The API resolves canonical address, indexability and meta description; these tests cover how the web app uses them.
 */
const state = vi.hoisted(() => ({ product: null as unknown, pages: [] as unknown[], categories: [] as unknown[], collections: [] as unknown[] }));

vi.mock('@/lib/server-api', () => ({
  apiOrNull: async () => (state.product ? { product: state.product } : null),
  getStore: async () => ({ name: 'Alpha', currency: 'INR', brand: { name: 'Alpha Brand' } }),
  storeHost: async () => 'shop.example.com',
  api: async (path: string) => {
    if (path.startsWith('categories')) return { items: state.categories };
    if (path.startsWith('collections')) return { items: state.collections };
    return state.pages.shift() ?? { items: [], nextCursor: null };
  },
}));
vi.mock('@/components/product-detail', () => ({ ProductDetail: () => null }));

type Variant = { skuCode: string; pricePaise: number; inStock: boolean; stock: 'in_stock' | 'out_of_stock' | 'unknown' };
const variant = (skuCode: string, stock: Variant['stock'], pricePaise = 150_000): Variant => ({ skuCode, pricePaise, stock, inStock: stock === 'in_stock' });
const product = (over: Record<string, unknown> = {}, variants: Variant[] = [variant('A', 'in_stock')]) => ({
  slug: 'kurta',
  title: 'Kurta',
  description: 'A soft cotton kurta.',
  seo: {},
  canonicalUrl: 'https://shop.example.com/p/kurta',
  indexable: true,
  metaDescription: 'A soft cotton kurta.',
  breadcrumbs: [{ name: 'Women', slug: 'women' }, { name: 'Kurtas', slug: 'kurtas' }],
  media: [{ kind: 'image', url: 'https://cdn.example.com/a.jpg', width: 800, height: 1000, altText: 'Front view' }],
  variants,
  ...over,
});

type Script = { props: { dangerouslySetInnerHTML: { __html: string } } };
const scripts = async (p: unknown) => {
  state.product = p;
  const { default: Page } = await import('../app/p/[slug]/page');
  const tree = (await Page({ params: Promise.resolve({ slug: 'kurta' }) })) as { props: { children: unknown[] } };
  return (tree.props.children.filter((c): c is Script => Boolean(c) && typeof c === 'object' && 'props' in (c as object) && 'dangerouslySetInnerHTML' in (c as Script).props)).map((s) => ({ html: s.props.dangerouslySetInnerHTML.__html, data: JSON.parse(s.props.dangerouslySetInnerHTML.__html) }));
};
const metadata = async (p: unknown) => {
  state.product = p;
  const { generateMetadata } = await import('../app/p/[slug]/page');
  return generateMetadata({ params: Promise.resolve({ slug: 'kurta' }) });
};

beforeEach(() => {
  state.product = null;
  state.pages = [];
  state.categories = [];
  state.collections = [];
});

describe('product page metadata', () => {
  it('uses the SEO title when set, otherwise the product title, for the title tag and Open Graph', async () => {
    const withSeo = await metadata(product({ seo: { title: 'SEO title' } }));
    expect(withSeo.title).toBe('SEO title');
    expect(withSeo.openGraph).toMatchObject({ title: 'SEO title' });
    expect(withSeo.twitter).toMatchObject({ title: 'SEO title' });
    expect((await metadata(product())).title).toBe('Kurta');
  });

  it('uses the description the API resolved and never cuts text itself', async () => {
    expect((await metadata(product({ metaDescription: 'Resolved text.' }))).description).toBe('Resolved text.');
    expect((await metadata(product({ metaDescription: null }))).description).toBeUndefined();
  });

  it('emits the canonical address from the API and og:url, and no canonical when there is none', async () => {
    const m = await metadata(product());
    expect(m.alternates).toEqual({ canonical: 'https://shop.example.com/p/kurta' });
    expect((m.openGraph as { url?: string }).url).toBe('https://shop.example.com/p/kurta');
    expect((await metadata(product({ canonicalUrl: null, indexable: false }))).alternates).toBeUndefined();
  });

  it('asks search engines not to index a product the API marks not indexable', async () => {
    expect((await metadata(product())).robots).toBeUndefined();
    expect((await metadata(product({ indexable: false }))).robots).toEqual({ index: false, follow: false });
  });

  it('adds Open Graph image details and a Twitter card that matches the image', async () => {
    const m = await metadata(product());
    expect(m.openGraph).toMatchObject({ siteName: 'Alpha', images: [{ url: 'https://cdn.example.com/a.jpg', width: 800, height: 1000, alt: 'Front view' }] });
    expect(m.twitter).toMatchObject({ card: 'summary_large_image', images: ['https://cdn.example.com/a.jpg'] });
    const bare = await metadata(product({ media: [] }));
    expect(bare.twitter).toMatchObject({ card: 'summary' });
    expect(bare.openGraph).toMatchObject({ images: undefined });
  });

  it('returns no metadata for an unknown product', async () => {
    expect(await metadata(null)).toEqual({});
  });
});

describe('product JSON-LD', () => {
  it('emits one Offer per variant with a two-decimal rupee price, currency and the canonical url', async () => {
    const [ld] = await scripts(product({}, [variant('A', 'in_stock', 150_000), variant('B', 'out_of_stock', 180_050)]));
    expect(ld!.data['@type']).toBe('Product');
    expect(ld!.data['@id']).toBe('https://shop.example.com/p/kurta');
    expect(ld!.data.brand).toEqual({ '@type': 'Brand', name: 'Alpha Brand' });
    expect(ld!.data.offers).toEqual([
      { '@type': 'Offer', sku: 'A', price: '1500.00', priceCurrency: 'INR', url: 'https://shop.example.com/p/kurta', availability: 'https://schema.org/InStock' },
      { '@type': 'Offer', sku: 'B', price: '1800.50', priceCurrency: 'INR', url: 'https://shop.example.com/p/kurta', availability: 'https://schema.org/OutOfStock' },
    ]);
  });

  it('never states availability when the POS stock is unknown', async () => {
    const [ld] = await scripts(product({}, [variant('A', 'unknown'), variant('B', 'in_stock')]));
    const [a, b] = ld!.data.offers;
    expect(a).not.toHaveProperty('availability');
    expect(b.availability).toBe('https://schema.org/InStock');
    expect(JSON.stringify(ld!.data)).not.toContain('OutOfStock');
    // An older API response without the field must not be read as a claim either.
    const [legacy] = await scripts(product({}, [{ skuCode: 'A', pricePaise: 100, inStock: false } as unknown as Variant]));
    expect(legacy!.data.offers[0]).not.toHaveProperty('availability');
  });

  it('adds a breadcrumb list on the canonical origin: home, category chain, product', async () => {
    const [, crumbs] = await scripts(product());
    expect(crumbs!.data['@type']).toBe('BreadcrumbList');
    expect(crumbs!.data.itemListElement).toEqual([
      { '@type': 'ListItem', position: 1, name: 'Alpha', item: 'https://shop.example.com/' },
      { '@type': 'ListItem', position: 2, name: 'Women', item: 'https://shop.example.com/c/women' },
      { '@type': 'ListItem', position: 3, name: 'Kurtas', item: 'https://shop.example.com/c/kurtas' },
      { '@type': 'ListItem', position: 4, name: 'Kurta', item: 'https://shop.example.com/p/kurta' },
    ]);
  });

  it('omits the breadcrumb list without a category or without a canonical address', async () => {
    expect(await scripts(product({ breadcrumbs: [] }))).toHaveLength(1);
    expect(await scripts(product({ canonicalUrl: null }))).toHaveLength(1);
    const [ld] = await scripts(product({ canonicalUrl: null }));
    expect(ld!.data['@id']).toBeUndefined();
    expect(ld!.data.offers[0]).not.toHaveProperty('url');
  });

  it('escapes "<" so hostile text cannot close the script tag', async () => {
    const [ld] = await scripts(product({ title: '</script><img src=x onerror=1>', description: '<b>x</b>' }));
    expect(ld!.html).not.toContain('<');
    expect(ld!.data.name).toBe('</script><img src=x onerror=1>');
  });

  it('writes no keywords anywhere', async () => {
    const m = await metadata(product());
    expect(m).not.toHaveProperty('keywords');
  });
});

describe('sitemap and robots', () => {
  it('uses the update time as lastModified and leaves out products hidden from search engines', async () => {
    state.pages = [
      {
        items: [
          { slug: 'kurta', createdAt: '2026-01-02T00:00:00Z', updatedAt: '2026-03-04T00:00:00Z', noIndex: false },
          { slug: 'hidden', createdAt: '2026-01-02T00:00:00Z', updatedAt: '2026-03-04T00:00:00Z', noIndex: true },
        ],
        nextCursor: null,
      },
    ];
    state.categories = [{ slug: 'kurtas' }];
    const { default: sitemap } = await import('../app/sitemap');
    const entries = await sitemap();
    expect(entries.find((e) => e.url === 'https://shop.example.com/p/kurta')).toMatchObject({ lastModified: '2026-03-04T00:00:00Z' });
    expect(entries.some((e) => e.url.endsWith('/p/hidden'))).toBe(false);
    expect(entries.some((e) => e.url === 'https://shop.example.com/c/kurtas')).toBe(true);
  });

  it('robots.txt blocks account/checkout/login/api and names the store sitemap', async () => {
    const { default: robots } = await import('../app/robots');
    expect(await robots()).toEqual({
      rules: [{ userAgent: '*', allow: '/', disallow: ['/account', '/checkout', '/login', '/api/'] }],
      sitemap: 'https://shop.example.com/sitemap.xml',
    });
  });
});
