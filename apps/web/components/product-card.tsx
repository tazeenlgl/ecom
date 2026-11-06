import Image from 'next/image';
import Link from 'next/link';
import { money, percentOff } from '@/lib/format';
import type { ProductSummary } from '@/lib/types';

export function ProductCard({ product, priority = false }: { product: ProductSummary; priority?: boolean }) {
  const off = percentOff(product.maxMrpPaise, product.minPricePaise);
  return (
    <Link href={`/p/${product.slug}`} className="group block">
      <div className="relative aspect-[4/5] overflow-hidden rounded-2xl bg-line">
        {product.imageUrl ? (
          <Image
            src={product.imageUrl}
            alt={product.title}
            fill
            priority={priority}
            sizes="(min-width: 1280px) 25vw, (min-width: 768px) 33vw, 50vw"
            className="object-cover transition duration-[1.2s] ease-out-expo group-hover:scale-[1.06]"
          />
        ) : (
          <div className="flex h-full items-center justify-center font-display text-4xl text-muted/40">{product.title.slice(0, 1)}</div>
        )}
        {off > 0 && <span className="absolute left-3 top-3 rounded-full bg-accent px-2.5 py-1 text-[11px] font-medium tracking-wide text-accent-fg">−{off}%</span>}
        <span className="absolute inset-x-3 bottom-3 translate-y-3 rounded-full bg-bg/90 py-2.5 text-center text-xs font-medium tracking-wide opacity-0 backdrop-blur transition duration-500 ease-out-expo group-hover:translate-y-0 group-hover:opacity-100">
          View product
        </span>
      </div>
      <div className="mt-3 flex items-start justify-between gap-3">
        <h3 className="text-sm leading-snug">{product.title}</h3>
        <p className="shrink-0 text-right text-sm">
          {product.minPricePaise !== null ? money(product.minPricePaise) : ''}
          {off > 0 && <span className="block text-xs text-muted line-through">{money(product.maxMrpPaise)}</span>}
        </p>
      </div>
    </Link>
  );
}
