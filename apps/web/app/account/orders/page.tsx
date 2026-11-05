import Link from 'next/link';
import { OrderStatus } from '@/components/order-status';
import { date, money } from '@/lib/format';
import { api } from '@/lib/server-api';
import type { OrderSummary, Page } from '@/lib/types';

export const metadata = { title: 'Your orders' };

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ cursor?: string }> }) {
  const { cursor } = await searchParams;
  const page = await api<Page<OrderSummary>>(`orders?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
  return (
    <section>
      <h2 className="mb-6 font-display text-2xl">Orders</h2>
      {page.items.length === 0 ? (
        <p className="text-sm text-muted">You haven’t placed any orders yet.</p>
      ) : (
        <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
          {page.items.map((o) => (
            <li key={o.id}>
              <Link href={`/account/orders/${o.orderNumber}`} className="grid grid-cols-2 items-center gap-3 p-5 transition hover:bg-fg/[0.02] sm:grid-cols-4">
                <span className="font-medium">{o.orderNumber}</span>
                <span className="text-sm text-muted">{date(o.placedAt ?? o.createdAt)}</span>
                <OrderStatus order={o} />
                <span className="text-right">{money(o.totalPaise)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {page.nextCursor && (
        <Link href={`/account/orders?cursor=${encodeURIComponent(page.nextCursor)}`} className="btn-outline mt-6">Older orders</Link>
      )}
    </section>
  );
}
