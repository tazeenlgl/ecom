import { notFound } from 'next/navigation';
import { apiOrNull } from '@/lib/server-api';
import type { Order } from '@/lib/types';
import { OrderView } from './order-view';

type Props = { params: Promise<{ orderNumber: string }>; searchParams: Promise<{ placed?: string; payment?: string }> };

export async function generateMetadata({ params }: Props) {
  return { title: `Order ${(await params).orderNumber}` };
}

export default async function OrderPage({ params, searchParams }: Props) {
  const [{ orderNumber }, { placed, payment }] = await Promise.all([params, searchParams]);
  const data = await apiOrNull<{ order: Order }>(`orders/${encodeURIComponent(orderNumber)}`);
  if (!data) notFound();
  return <OrderView initial={data.order} justPlaced={placed === '1'} paymentRetry={payment === 'retry'} />;
}
