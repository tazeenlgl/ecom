import { getCustomer } from '@/lib/server-api';
import { CheckoutClient } from './checkout-client';

export const metadata = { title: 'Checkout', robots: { index: false } };

export default async function CheckoutPage() {
  const customer = await getCustomer();
  return (
    <div className="container-x py-10 sm:py-14">
      <h1 className="display-title text-4xl sm:text-5xl">Checkout</h1>
      <CheckoutClient signedIn={Boolean(customer)} />
    </div>
  );
}
