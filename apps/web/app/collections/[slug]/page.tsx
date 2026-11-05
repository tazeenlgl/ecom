import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Listing } from '@/components/listing';
import { api } from '@/lib/server-api';
import type { Collection } from '@/lib/types';

type Props = { params: Promise<{ slug: string }> };

async function find(slug: string) {
  const { items } = await api<{ items: Collection[] }>('collections');
  return items.find((c) => c.slug === slug) ?? null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const c = await find((await params).slug);
  if (!c) return {};
  return { title: c.seo?.title ?? c.title, description: c.seo?.description ?? c.description ?? undefined };
}

export default async function CollectionPage({ params }: Props) {
  const { slug } = await params;
  const c = await find(slug);
  if (!c) notFound();
  return <Listing eyebrow="Collection" title={c.title} description={c.description} filter={{ collection: slug }} />;
}
