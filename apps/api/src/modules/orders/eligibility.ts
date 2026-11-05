import type { orders } from '../../db/schema.js';

type OrderLike = Pick<typeof orders.$inferSelect, 'status' | 'fulfillmentStatus'>;

/**
 * Customer self-service cancellation: only before the store has started working on the order.
 * This is deliberately narrower than what staff can do (`cancelOrder` also allows a packed order): once an order is
 * `processing` or `packed`, the customer has to contact the store.
 *
 * This is the single source of truth. The cancel endpoint enforces it inside its transaction (authoritative), and the
 * order presenter reports it as `actions.canCancel`, so the storefront never offers a cancel the API would refuse.
 */
export const CUSTOMER_CANCELLABLE_STATUSES = ['pending_payment', 'confirmed'] as const;

export function customerCanCancel(order: OrderLike): boolean {
  return (CUSTOMER_CANCELLABLE_STATUSES as readonly string[]).includes(order.status) && order.fulfillmentStatus === 'unfulfilled';
}

/**
 * What `cancelOrder` will refund when this order is cancelled: the whole unrefunded amount of an online payment that
 * has been collected, otherwise nothing (unpaid and cash-on-delivery orders have no money to return).
 * Shared by `cancelOrder` and the order presenter so the amount shown before confirming is the amount refunded.
 */
export function cancelRefundPaise(order: Pick<typeof orders.$inferSelect, 'paymentStatus' | 'totalPaise' | 'refundedPaise'>): number {
  return order.paymentStatus === 'paid' ? Math.max(0, order.totalPaise - order.refundedPaise) : 0;
}
