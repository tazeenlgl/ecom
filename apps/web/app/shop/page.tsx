import type { Metadata } from 'next';
import { Listing } from '@/components/listing';

type Props = { searchParams: Promise<{ q?: string }> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { q } = await searchParams;
  return { title: q ? `Search: ${q}` : 'Shop all', robots: q ? { index: false } : undefined };
}

export default async function ShopPage({ searchParams }: Props) {
  const { q } = await searchParams;
  const term = q?.trim().slice(0, 100);
  return term ? (
    <Listing eyebrow="Search" title={`“${term}”`} filter={{ q: term }} />
  ) : (
    <Listing eyebrow="The collection" title="Shop all" filter={{}} />
  );
}
