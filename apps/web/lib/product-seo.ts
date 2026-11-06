import type { Product } from './types';

/**
 * Pure builders for product search/social output. The API resolves canonical address, indexability and the meta
 * description (apps/api/src/modules/catalogue/seo.ts); this file only shapes them for Next.js metadata and JSON-LD.
 */

type StoreInfo = { name: string; currency: string; brand: { name: string } };

const AVAILABILITY = { in_stock: 'https://schema.org/InStock', out_of_stock: 'https://schema.org/OutOfStock' } as const;

export function productMetadata(product: Product, store: Pick<StoreInfo, 'name'>, image?: { url: string; width?: number | null; height?: number | null; alt?: string | null }) {
  const title = product.seo?.title ?? product.title;
  const description = product.metaDescription ?? undefined;
  const images = image ? [{ url: image.url, width: image.width ?? undefined, height: image.height ?? undefined, alt: image.alt ?? product.title }] : undefined;
  return {
    title,
    description,
    alternates: product.canonicalUrl ? { canonical: product.canonicalUrl } : undefined,
    robots: product.indexable ? undefined : { index: false, follow: false },
    openGraph: { title, description, url: product.canonicalUrl ?? undefined, siteName: store.name, type: 'website' as const, images },
    twitter: { card: image ? ('summary_large_image' as const) : ('summary' as const), title, description, images: image ? [image.url] : undefined },
  };
}

/** Product JSON-LD with one Offer per variant. `availability` is stated only when the POS has told us the stock. */
export function productJsonLd(product: Product, store: StoreInfo, imageUrls: string[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    ...(product.canonicalUrl ? { '@id': product.canonicalUrl, url: product.canonicalUrl } : {}),
    name: product.title,
    description: product.description ?? undefined,
    image: imageUrls,
    sku: product.variants[0]?.skuCode,
    brand: { '@type': 'Brand', name: store.brand.name },
    offers: product.variants.map((v) => {
      const availability = v.stock === 'unknown' || v.stock === undefined ? undefined : AVAILABILITY[v.stock];
      return {
        '@type': 'Offer',
        sku: v.skuCode,
        price: (v.pricePaise / 100).toFixed(2),
        priceCurrency: store.currency,
        ...(product.canonicalUrl ? { url: product.canonicalUrl } : {}),
        ...(availability ? { availability } : {}),
      };
    }),
  };
}

/** Home > category chain > product, with absolute addresses on the canonical origin. Null when it cannot be stated. */
export function breadcrumbJsonLd(product: Product, storeName: string) {
  if (!product.canonicalUrl || product.breadcrumbs.length === 0) return null;
  const origin = new URL(product.canonicalUrl).origin;
  const trail = [
    { name: storeName, url: `${origin}/` },
    ...product.breadcrumbs.map((c) => ({ name: c.name, url: `${origin}/c/${c.slug}` })),
    { name: product.title, url: product.canonicalUrl },
  ];
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((t, i) => ({ '@type': 'ListItem', position: i + 1, name: t.name, item: t.url })),
  };
}

/** JSON.stringify output with "<" escaped cannot close a script tag. */
export const jsonLdScript = (data: unknown) => JSON.stringify(data).replace(/</g, '\\u003c');
