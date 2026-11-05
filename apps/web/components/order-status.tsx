import { humanize } from '@/lib/format';

const tone: Record<string, string> = {
  pending_payment: 'bg-amber-500/10 text-amber-800',
  confirmed: 'bg-sky-500/10 text-sky-800',
  processing: 'bg-sky-500/10 text-sky-800',
  completed: 'bg-emerald-500/10 text-emerald-800',
  cancelled: 'bg-fg/5 text-muted',
};

export function OrderStatus({ order }: { order: { status: string; fulfillmentStatus: string } }) {
  const label = order.status === 'confirmed' && order.fulfillmentStatus !== 'unfulfilled' ? order.fulfillmentStatus : order.status;
  return <span className={`rounded-full px-3 py-1 text-xs font-medium ${tone[order.status] ?? 'bg-fg/5'}`}>{humanize(label)}</span>;
}
