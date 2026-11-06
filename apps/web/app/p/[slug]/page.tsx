import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ProductDetail } from '@/components/product-detail';
import { isAllowedMediaUrl, parseMediaHosts } from '@/lib/media-hosts';
import { breadcrumbJsonLd, jsonLdScript, productJsonLd, productMetadata } from '@/lib/product-seo';
import { apiOrNull, getStore } from '@/lib/server-api';
import type { Product } from '@/lib/types';

type Props = { params: Promise<{ slug: string }> };

const mediaHosts = () => parseMediaHosts(process.env.MEDIA_ALLOWED_HOSTS);

const load = async (slug: string) => (await apiOrNull<{ product: Product }>(`products/${encodeURIComponent(slug)}`))?.product ?? null;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const [product, store] = await Promise.all([load((await params).slug), getStore()]);
  if (!product) return {};
  // Only images on allowed hosts are published to search engines and social networks.
  const image = product.media.find((m) => m.kind === 'image' && isAllowedMediaUrl(m.url, mediaHosts()));
  return productMetadata(product, store, image ? { url: image.url, width: image.width, height: image.height, alt: image.altText } : undefined);
}

export default async function ProductPage({ params }: Props) {
  const { slug } = await params;
  const [product, store] = await Promise.all([load(slug), getStore()]);
  if (!product) notFound();

  const jsonLd = productJsonLd(product, store, product.media.filter((m) => m.kind === 'image' && isAllowedMediaUrl(m.url, mediaHosts())).map((m) => m.url));
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
