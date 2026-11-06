import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ProductDetail } from '@/components/product-detail';
import { breadcrumbJsonLd, jsonLdScript, productJsonLd, productMetadata } from '@/lib/product-seo';
import { apiOrNull, getStore } from '@/lib/server-api';
import type { Product } from '@/lib/types';

type Props = { params: Promise<{ slug: string }> };

const load = async (slug: string) => (await apiOrNull<{ product: Product }>(`products/${encodeURIComponent(slug)}`))?.product ?? null;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const [product, store] = await Promise.all([load((await params).slug), getStore()]);
  if (!product) return {};
  const image = product.media.find((m) => m.kind === 'image');
  return productMetadata(product, store, image ? { url: image.url, width: image.width, height: image.height, alt: image.altText } : undefined);
}

export default async function ProductPage({ params }: Props) {
  const { slug } = await params;
  const [product, store] = await Promise.all([load(slug), getStore()]);
  if (!product) notFound();

  const jsonLd = productJsonLd(product, store, product.media.filter((m) => m.kind === 'image').map((m) => m.url));
  const breadcrumbs = breadcrumbJsonLd(product, store.name);

  return (
    <>
      {/* jsonLdScript escapes "<", so the output cannot break out of the script tag. */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(jsonLd) }} />
      {breadcrumbs && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(breadcrumbs) }} />}
      <ProductDetail product={product} />
    </>
  );
}
