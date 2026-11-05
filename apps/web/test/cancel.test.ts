import { describe, expect, it } from 'vitest';
import { cancelRefundNotice } from '../lib/cancel';

const order = (paymentMethod: string, cancelRefund: { amountPaise: number } | null) => ({ paymentMethod, actions: { canCancel: true, cancelRefund, canReturn: false, returnWindowEndsAt: null } }) as never;

describe('cancelRefundNotice', () => {
  it('states the amount the server says will be refunded', () => {
    const n = cancelRefundNotice(order('online', { amountPaise: 449_900 }));
    expect(n.refundPaise).toBe(449_900);
    expect(n.text).toContain('4,499');
    expect(n.text).toContain('original payment method');
  });
  it('says nothing is owed for cash on delivery', () => {
    const n = cancelRefundNotice(order('cod', null));
    expect(n.refundPaise).toBe(0);
    expect(n.text).toMatch(/cash-on-delivery/);
    expect(n.text).toMatch(/nothing to refund/);
  });
  it('says nothing is owed for an online order with no confirmed payment', () => {
    const n = cancelRefundNotice(order('online', null));
    expect(n.refundPaise).toBe(0);
    expect(n.text).toMatch(/No payment has been confirmed/);
  });
  it('never invents an amount: a zero or missing refund shows no figure', () => {
    expect(cancelRefundNotice(order('online', { amountPaise: 0 })).refundPaise).toBe(0);
    expect(cancelRefundNotice(order('online', null)).text).not.toMatch(/₹/);
  });
});
