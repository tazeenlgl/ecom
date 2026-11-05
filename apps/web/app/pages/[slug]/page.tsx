import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { RichText } from '@/components/rich-text';
import { date } from '@/lib/format';
import { apiOrNull } from '@/lib/server-api';
import type { ContentPage } from '@/lib/types';

type Props = { params: Promise<{ slug: string }> };
const load = async (slug: string) => (await apiOrNull<{ page: ContentPage }>(`pages/${encodeURIComponent(slug)}`))?.page ?? null;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const page = await load((await params).slug);
  return page ? { title: page.seo?.title ?? page.title, description: page.seo?.description } : {};
}

export default async function ContentPageView({ params }: Props) {
  const page = await load((await params).slug);
  if (!page) notFound();
  return (
    <article className="container-x max-w-3xl py-16">
      <p className="eyebrow">{page.kind === 'policy' ? 'Policy' : 'Information'}</p>
      <h1 className="display-title mt-3 text-4xl sm:text-6xl">{page.title}</h1>
      <p className="mt-3 text-xs text-muted">Updated {date(page.updatedAt)}</p>
      <RichText text={page.body} className="prose-store mt-10 text-lg" />
    </article>
  );
}
