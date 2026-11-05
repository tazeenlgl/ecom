import { api } from '@/lib/server-api';
import type { Address } from '@/lib/types';
import { AddressBook } from './address-book';

export const metadata = { title: 'Addresses' };

export default async function AddressesPage() {
  const { items } = await api<{ items: Address[] }>('me/addresses');
  return <AddressBook initial={items} />;
}
