import Image from 'next/image';
import Link from 'next/link';
import { ArrowIcon, ReturnIcon, ShieldIcon, TruckIcon } from '@/components/icons';
import { HeroCarousel } from '@/components/hero-carousel';
import { Hero } from '@/components/home-hero';
import { type CategoryChip, MobileCategoryBar } from '@/components/mobile-category-bar';
import { ProductCard } from '@/components/product-card';
import { Reveal } from '@/components/reveal';
import { RichText } from '@/components/rich-text';
import { type HomeItem, planHomepage } from '@/lib/hero-slides';
import { api, getNavigation, getStore } from '@/lib/server-api';
import type { Banner, Block, Category, Collection, HomepageSection, Page, ProductSummary } from '@/lib/types';

export default async function HomePage() {
  const [store, sections, banners, categories, collections] = await Promise.all([
    getStore(),
    api<{ items: Block<HomepageSection>[] }>('content/blocks?kind=homepage_section'),
    api<{ items: Block<Banner>[] }>('content/blocks?kind=banner'),
    api<{ items: Category[] }>('categories'),
    api<{ items: Collection[] }>('collections'),
  ]);

  const editorial = store.settings.theme?.variant === 'editorial';
  const [nav, chips] = editorial ? await Promise.all([getNavigation(), categoryChips(categories.items)]) : [[], [] as CategoryChip[]];

  const items: HomeItem[] = sections.items.length
    ? planHomepage(sections.items)
    : // Sensible default until the store's homepage is set up in the admin.
      ([{ layout: 'hero', heading: store.name, body: store.settings.seo?.defaultDescription, link: { label: 'Shop the collection', href: '/shop' } }, { layout: 'product_grid', heading: 'New arrivals', productLimit: 8 }] satisfies HomepageSection[]).map((section, i) => ({ kind: 'section', key: `default-${i}`, section }));

  return (
    <>
      {editorial && <MobileCategoryBar nav={nav} chips={chips} />}
      {await Promise.all(
        items.map(async (item, i) => {
          if (item.kind === 'carousel') return <HeroCarousel key="hero-carousel" slides={item.slides} />;
          const s = item.section;
          switch (s.layout) {
            case 'hero':
              return <Hero key={i} section={s} />;
            case 'product_grid':
              return <ProductRow key={i} section={s} />;
            case 'collection_grid':
              return <TileGrid key={i} heading={s.heading} tiles={collections.items.map((c) => ({ href: `/collections/${c.slug}`, label: c.title }))} />;
            case 'category_grid': {
              const chosen = s.categorySlugs?.length ? categories.items.filter((c) => s.categorySlugs!.includes(c.slug)) : categories.items.filter((c) => !c.parentId);
              return <TileGrid key={i} heading={s.heading} tiles={chosen.map((c) => ({ href: `/c/${c.slug}`, label: c.name }))} />;
            }
            case 'image_with_text':
              return <ImageWithText key={i} section={s} flip={i % 2 === 1} />;
            case 'rich_text':
              return (
                <Reveal key={i} className="container-x py-20 text-center">
                  {s.heading && <h2 className="display-title mx-auto max-w-3xl text-3xl sm:text-5xl">{s.heading}</h2>}
                  {s.body && <RichText text={s.body} className="prose-store mx-auto mt-6 max-w-2xl text-lg" />}
                </Reveal>
              );
          }
        }),
      )}

      {banners.items.length > 0 && (
        <section className="container-x mt-16 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {banners.items.map((b) => (
            <Reveal key={b.key}>
              <Link href={b.data.link?.href ?? '/shop'} className="group relative block aspect-[3/4] overflow-hidden rounded-2xl bg-line">
                <Image src={b.data.image.url} alt={b.data.image.alt ?? ''} fill sizes="(min-width: 1024px) 25vw, (min-width: 768px) 33vw, 50vw" className="object-cover object-top transition duration-[1.4s] ease-out-expo group-hover:scale-105" />
                {b.data.headline && <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />}
                {b.data.headline && <p className="absolute bottom-6 left-6 right-6 font-display text-3xl text-white">{b.data.headline}</p>}
              </Link>
            </Reveal>
          ))}
        </section>
      )}

      <section className="container-x mt-24 grid gap-8 border-y border-line py-12 sm:grid-cols-3">
        {[
          { icon: TruckIcon, title: 'Delivery across India', body: 'Check your PIN code on any product.' },
          { icon: ReturnIcon, title: 'Easy returns', body: 'Request a return from your account.' },
          { icon: ShieldIcon, title: 'Secure payments', body: 'Pay online or choose cash on delivery where available.' },
        ].map(({ icon: Icon, title, body }, i) => (
          <Reveal key={title} delay={i * 0.1} className="flex gap-4">
            <Icon width={28} height={28} className="shrink-0" />
            <div>
              <p className="font-medium">{title}</p>
              <p className="mt-1 text-sm text-muted">{body}</p>
            </div>
          </Reveal>
        ))}
      </section>
    </>
  );
}

async function ProductRow({ section }: { section: HomepageSection }) {
  const limit = section.productLimit ?? 8;
  const filter = section.collectionSlug ? `collection=${section.collectionSlug}&` : '';
  const page = await api<Page<ProductSummary>>(`products?${filter}limit=${limit}`);
  if (page.items.length === 0) return null;
  const href = section.link?.href ?? (section.collectionSlug ? `/collections/${section.collectionSlug}` : '/shop');
  return (
    <section className="container-x mt-20">
      <Reveal className="mb-8 flex items-end justify-between gap-4">
        <h2 className="display-title text-3xl sm:text-5xl">{section.heading ?? 'Featured'}</h2>
        <Link href={href} className="group flex shrink-0 items-center gap-2 text-sm">
          {section.link?.label ?? 'View all'} <ArrowIcon width={16} height={16} className="transition group-hover:translate-x-1" />
        </Link>
      </Reveal>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-3 xl:grid-cols-4">
        {page.items.map((p, i) => (
          <li key={p.id}>
            <Reveal delay={(i % 4) * 0.08}>
              <ProductCard product={p} />
            </Reveal>
          </li>
        ))}
      </ul>
    </section>
  );
}

function TileGrid({ heading, tiles }: { heading?: string; tiles: { href: string; label: string }[] }) {
  if (tiles.length === 0) return null;
  return (
    <section className="container-x mt-20">
      {heading && (
        <Reveal>
          <h2 className="display-title mb-8 text-3xl sm:text-5xl">{heading}</h2>
        </Reveal>
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {tiles.map((t, i) => (
          <Reveal key={t.href} delay={(i % 4) * 0.06}>
            <Link href={t.href} className="group flex aspect-square flex-col justify-end overflow-hidden rounded-3xl bg-surface p-6 ring-1 ring-line transition duration-500 hover:bg-accent hover:text-accent-fg">
              <span className="font-display text-2xl sm:text-3xl">{t.label}</span>
              <ArrowIcon className="mt-3 -translate-x-2 opacity-0 transition duration-500 group-hover:translate-x-0 group-hover:opacity-100" />
            </Link>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

function ImageWithText({ section, flip }: { section: HomepageSection; flip: boolean }) {
  return (
    <section className="container-x mt-24 grid items-center gap-10 md:grid-cols-2 md:gap-16">
      <Reveal className={flip ? 'md:order-2' : ''}>
        <div className="relative aspect-[4/5] overflow-hidden rounded-3xl bg-line">
          {section.image && <Image src={section.image.url} alt={section.image.alt ?? ''} fill sizes="(min-width: 768px) 50vw, 100vw" className="object-cover" />}
        </div>
      </Reveal>
      <Reveal delay={0.1}>
        {section.heading && <h2 className="display-title text-4xl sm:text-5xl">{section.heading}</h2>}
        {section.body && <RichText text={section.body} className="prose-store mt-6 text-lg" />}
        {section.link && (
          <Link href={section.link.href} className="btn-outline mt-8">
            {section.link.label}
          </Link>
        )}
      </Reveal>
    </section>
  );
}

/** One product photo per top-level category for the phone category row. A category with no products simply has no photo. */
async function categoryChips(categories: Category[]): Promise<CategoryChip[]> {
  const top = categories.filter((c) => !c.parentId).slice(0, 8);
  return Promise.all(
    top.map(async (c) => {
      const page = await api<Page<ProductSummary>>(`products?category=${encodeURIComponent(c.slug)}&limit=1`).catch(() => null);
      return { slug: c.slug, name: c.name, imageUrl: page?.items[0]?.imageUrl ?? null };
    }),
  );
}
