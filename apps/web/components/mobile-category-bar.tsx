import Image from 'next/image';
import Link from 'next/link';
import type { Link as NavLink } from '@/lib/types';

export type CategoryChip = { slug: string; name: string; imageUrl: string | null };

/**
 * Phone-only strip at the top of the editorial homepage: tabs built from the store's own navigation, then a row of rounded
 * category thumbnails (a product photo from that category). Nothing here is invented; it only appears when a store opts into the editorial look.
 */
export function MobileCategoryBar({ nav, chips }: { nav: NavLink[]; chips: CategoryChip[] }) {
  const tabs = nav.filter((n) => n.href !== '/shop');
  return (
    <div className="md:hidden">
      <nav aria-label="Browse" className="no-scrollbar flex gap-1 overflow-x-auto border-b border-line px-4">
        <Link href="/" aria-current="page" className="-mb-px shrink-0 rounded-t-2xl border border-b-0 border-line bg-surface px-5 py-3 text-sm font-medium">
          All
        </Link>
        {tabs.map((t) => (
          <Link key={t.href + t.label} href={t.href} className="shrink-0 px-5 py-3 text-sm text-fg/80 hover:text-accent">
            {t.label}
          </Link>
        ))}
      </nav>
      {chips.length > 0 && (
        <ul className="no-scrollbar flex gap-4 overflow-x-auto px-4 py-4">
          {chips.map((c) => (
            <li key={c.slug} className="w-[72px] shrink-0">
              <Link href={`/c/${c.slug}`} className="group block text-center">
                <span className="relative mx-auto block h-[72px] w-[72px] overflow-hidden rounded-2xl bg-line">
                  {c.imageUrl && <Image src={c.imageUrl} alt="" fill sizes="72px" className="object-cover object-top transition duration-500 ease-editorial group-hover:scale-105" />}
                </span>
                <span className="mt-2 block text-[11px] leading-tight">{c.name}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
