import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ProductDetail } from '@/components/product-detail';
import { apiOrNull, getStore } from '@/lib/server-api';
import type { Product } from '@/lib/types';

type Props = { params: Promise<{ slug: string }> };

const load = async (slug: string) => (await apiOrNull<{ product: Product }>(`products/${encodeURIComponent(slug)}`))?.product ?? null;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const product = await load((await params).slug);
  if (!product) return {};
  const image = product.media.find((m) => m.kind === 'image');
  const description = product.seo?.description ?? product.description?.slice(0, 160) ?? undefined;
  return {
    title: product.seo?.title ?? product.title,
    description,
    openGraph: { title: product.title, description, images: image ? [{ url: image.url }] : undefined },
  };
}

export default async function ProductPage({ params }: Props) {
  const { slug } = await params;
  const [product, store] = await Promise.all([load(slug), getStore()]);
  if (!product) notFound();

  const prices = product.variants.map((v) => v.pricePaise);
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.title,
    description: product.description ?? undefined,
    image: product.media.filter((m) => m.kind === 'image').map((m) => m.url),
    sku: product.variants[0]?.skuCode,
    brand: { '@type': 'Brand', name: store.brand.name },
    offers: prices.length
      ? {
          '@type': 'AggregateOffer',
          priceCurrency: store.currency,
          lowPrice: Math.min(...prices) / 100,
          highPrice: Math.max(...prices) / 100,
          offerCount: prices.length,
          availability: product.variants.some((v) => v.inStock) ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
        }
      : undefined,
  };

  return (
    <>
      {/* JSON.stringify output with "<" escaped cannot break out of the script tag. */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />
      <ProductDetail product={product} />
    </>
  );
}
