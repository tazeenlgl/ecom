import { RichText } from '@/components/rich-text';
import { api } from '@/lib/server-api';

export const metadata = { title: 'FAQs' };

export default async function FaqPage() {
  const { items } = await api<{ items: { slug: string; title: string; body: string }[] }>('faqs');
  return (
    <div className="container-x max-w-3xl py-16">
      <p className="eyebrow">Help</p>
      <h1 className="display-title mt-3 text-4xl sm:text-6xl">Frequently asked questions</h1>
      {items.length === 0 ? (
        <p className="mt-10 text-muted">No questions have been added yet.</p>
      ) : (
        <div className="mt-10 divide-y divide-line border-y border-line">
          {items.map((f) => (
            <details key={f.slug} className="group py-5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-lg">
                {f.title}
                <span className="text-2xl font-light transition group-open:rotate-45">+</span>
              </summary>
              <RichText text={f.body} className="prose-store mt-4" />
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
