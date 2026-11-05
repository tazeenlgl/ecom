import Link from 'next/link';
import { OrderStatus } from '@/components/order-status';
import { date, money } from '@/lib/format';
import { api, getCustomer } from '@/lib/server-api';
import type { OrderSummary, Page } from '@/lib/types';
import { ProfileForm } from './profile-form';

export const metadata = { title: 'Your account' };

export default async function AccountPage() {
  const [customer, orders] = await Promise.all([getCustomer(), api<Page<OrderSummary>>('orders?limit=3')]);
  return (
    <div className="space-y-12">
      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-2xl">Recent orders</h2>
          <Link href="/account/orders" className="text-sm underline-offset-4 hover:underline">View all</Link>
        </div>
        {orders.items.length === 0 ? (
          <p className="text-sm text-muted">No orders yet. <Link href="/shop" className="underline">Start shopping</Link></p>
        ) : (
          <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
            {orders.items.map((o) => (
              <li key={o.id}>
                <Link href={`/account/orders/${o.orderNumber}`} className="flex flex-wrap items-center justify-between gap-3 p-5 transition hover:bg-fg/[0.02]">
                  <div>
                    <p className="font-medium">{o.orderNumber}</p>
                    <p className="text-xs text-muted">{date(o.placedAt ?? o.createdAt)}</p>
                  </div>
                  <OrderStatus order={o} />
                  <span>{money(o.totalPaise)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h2 className="mb-4 font-display text-2xl">Profile</h2>
        <p className="mb-4 text-sm text-muted">Mobile: {customer!.phone}</p>
        <ProfileForm name={customer!.name ?? ''} email={customer!.email ?? ''} />
      </section>
    </div>
  );
}
