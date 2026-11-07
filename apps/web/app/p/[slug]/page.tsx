import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ProductDetail } from '@/components/product-detail';
import { RelatedCarousel } from '@/components/related-carousel';
import { isAllowedMediaUrl, parseMediaHosts } from '@/lib/media-hosts';
import { breadcrumbJsonLd, jsonLdScript, productJsonLd, productMetadata } from '@/lib/product-seo';
import { apiOrNull, getStore } from '@/lib/server-api';
import type { Page, Product, ProductSummary } from '@/lib/types';

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
  const editorial = store.settings?.theme?.variant === 'editorial';
  const related = editorial ? await relatedProducts(product) : [];

  return (
    <>
      {/* jsonLdScript escapes "<", so the output cannot break out of the script tag. */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(jsonLd) }} />
      {breadcrumbs && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(breadcrumbs) }} />}
      <ProductDetail product={product} editorial={editorial} offer={store.settings?.productOffer} promo={store.settings?.productPromo} />
      {related.length > 0 && <RelatedCarousel products={related} />}
    </>
  );
}


/** Other products from the product's own category (its deepest breadcrumb). Empty when there is none or the call fails. */
async function relatedProducts(product: Product): Promise<ProductSummary[]> {
  const category = product.breadcrumbs.at(-1)?.slug;
  if (!category) return [];
  const page = await apiOrNull<Page<ProductSummary>>(`products?category=${encodeURIComponent(category)}&limit=13`);
  return (page?.items ?? []).filter((p) => p.id !== product.id).slice(0, 12);
}
