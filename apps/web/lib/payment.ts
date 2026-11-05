'use client';

import { sf } from './client-api';
import type { PaymentStart } from './types';

type PaytmClient = {
  provider: 'paytm';
  mid: string;
  orderId: string;
  txnToken: string;
  amount: string;
  checkoutScriptUrl: string;
};

type PaytmWindow = Window & {
  Paytm?: { CheckoutJS: { init: (config: unknown) => Promise<void>; invoke: () => void; close?: () => void } };
};

function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    if (document.querySelector(`script[src="${CSS.escape(src)}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load the payment page. Please try again.'));
    document.head.appendChild(s);
  });
}

/**
 * Starts an online payment for an order and, for Paytm, opens the JS Checkout.
 * Resolves when the shopper finishes or closes the payment window. The order is
 * only marked paid by the API's verified webhook, so callers then show the order
 * page, which polls the payment status.
 */
export async function startPayment(orderNumber: string): Promise<void> {
  const { payment } = await sf<PaymentStart>(`orders/${encodeURIComponent(orderNumber)}/payments`, { method: 'POST' });
  const client = payment.client as Partial<PaytmClient>;
  if (client.provider !== 'paytm' || !client.checkoutScriptUrl) return;

  await loadScript(client.checkoutScriptUrl);
  const w = window as PaytmWindow;
  if (!w.Paytm?.CheckoutJS) throw new Error('The payment page did not load. Please try again.');

  await new Promise<void>((resolve) => {
    void w.Paytm!.CheckoutJS.init({
      root: '',
      flow: 'DEFAULT',
      data: { orderId: client.orderId, token: client.txnToken, tokenType: 'TXN_TOKEN', amount: client.amount },
      merchant: { redirect: false },
      handler: {
        notifyMerchant: (eventName: string) => {
          if (eventName === 'APP_CLOSED') resolve();
        },
        transactionStatus: () => {
          w.Paytm?.CheckoutJS.close?.();
          resolve();
        },
      },
    }).then(() => w.Paytm!.CheckoutJS.invoke());
  });
}
