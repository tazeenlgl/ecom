import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Listing } from '@/components/listing';
import { api } from '@/lib/server-api';
import type { Category } from '@/lib/types';

type Props = { params: Promise<{ slug: string }> };

async function find(slug: string) {
  const { items } = await api<{ items: Category[] }>('categories');
  return items.find((c) => c.slug === slug) ?? null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const category = await find((await params).slug);
  if (!category) return {};
  return { title: category.seo?.title ?? category.name, description: category.seo?.description ?? category.description ?? undefined };
}

export default async function CategoryPage({ params }: Props) {
  const { slug } = await params;
  const category = await find(slug);
  if (!category) notFound();
  return <Listing eyebrow="Category" title={category.name} description={category.description} filter={{ category: slug }} activeCategory={slug} />;
}
