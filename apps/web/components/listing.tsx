import Link from 'next/link';
import { api } from '@/lib/server-api';
import type { Category, Page, ProductSummary } from '@/lib/types';
import { ProductGrid } from './product-grid';
import { Reveal } from './reveal';

/** Shared listing page: heading, category chips and an infinite product grid. */
export async function Listing({
  eyebrow,
  title,
  description,
  filter,
  activeCategory,
}: {
  eyebrow?: string;
  title: string;
  description?: string | null;
  filter: Record<string, string>;
  activeCategory?: string;
}) {
  const query = new URLSearchParams(filter).toString();
  const [page, categories] = await Promise.all([
    api<Page<ProductSummary>>(`products?${query}${query ? '&' : ''}limit=24`),
    api<{ items: Category[] }>('categories'),
  ]);
  const topLevel = categories.items.filter((c) => !c.parentId);

  return (
    <div className="container-x">
      <Reveal className="py-12 sm:py-16">
        {eyebrow && <p className="eyebrow mb-3">{eyebrow}</p>}
        <h1 className="display-title text-4xl sm:text-6xl">{title}</h1>
        {description && <p className="mt-4 max-w-xl text-muted">{description}</p>}
      </Reveal>

      {topLevel.length > 0 && (
        <nav aria-label="Categories" className="-mx-4 mb-10 flex gap-2 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
          <Link href="/shop" className={`shrink-0 rounded-full border px-4 py-2 text-sm transition ${!activeCategory ? 'border-fg bg-fg text-bg' : 'border-line hover:border-fg'}`}>
            All
          </Link>
          {topLevel.map((c) => (
            <Link
              key={c.id}
              href={`/c/${c.slug}`}
              className={`shrink-0 rounded-full border px-4 py-2 text-sm transition ${activeCategory === c.slug ? 'border-fg bg-fg text-bg' : 'border-line hover:border-fg'}`}
            >
              {c.name}
            </Link>
          ))}
        </nav>
      )}

      <ProductGrid initial={page} query={query} />
    </div>
  );
}
