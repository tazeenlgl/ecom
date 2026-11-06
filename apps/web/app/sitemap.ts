import type { MetadataRoute } from 'next';
import { api, storeHost } from '@/lib/server-api';
import type { Category, Collection, Page, ProductSummary } from '@/lib/types';

/** Per-store sitemap: the host decides which store's catalogue is listed. Products hidden from search engines are left out. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = `https://${await storeHost()}`;
  const [categories, collections] = await Promise.all([api<{ items: Category[] }>('categories'), api<{ items: Collection[] }>('collections')]);
  const products: ProductSummary[] = [];
  let cursor: string | null = null;
  do {
    const page: Page<ProductSummary> = await api(`products?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    products.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor && products.length < 5000);
  return [
    { url: base, changeFrequency: 'daily', priority: 1 },
    { url: `${base}/shop`, changeFrequency: 'daily' },
    ...categories.items.map((c) => ({ url: `${base}/c/${c.slug}` })),
    ...collections.items.map((c) => ({ url: `${base}/collections/${c.slug}` })),
    ...products.filter((p) => !p.noIndex).map((p) => ({ url: `${base}/p/${p.slug}`, lastModified: p.updatedAt })),
  ];
}
