import { money } from './format';
import type { Order } from './types';

export type CancelRefundNotice = { refundPaise: number; text: string };

/**
 * What to tell the customer about money before they confirm a cancellation. The amount comes from the server
 * (`actions.cancelRefund`, the same number the cancel will refund); when there is none, the text says why, using
 * only facts already on the order.
 */
export function cancelRefundNotice(order: Pick<Order, 'paymentMethod' | 'actions'>): CancelRefundNotice {
  const refund = order.actions.cancelRefund;
  if (refund && refund.amountPaise > 0) {
    return { refundPaise: refund.amountPaise, text: `${money(refund.amountPaise)} will be refunded to your original payment method.` };
  }
  return {
    refundPaise: 0,
    text:
      order.paymentMethod === 'cod'
        ? 'This is a cash-on-delivery order, so no payment has been taken and there is nothing to refund.'
        : 'No payment has been confirmed for this order, so there is nothing to refund.',
  };
}
