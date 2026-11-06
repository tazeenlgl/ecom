'use client';

import { useRouter } from 'next/navigation';
import { useStore } from '@/components/store-context';
import { Denied, PageHeader } from '@/components/ui';
import { api } from '@/lib/client';
import { ProductForm, type ProductFormValues } from '../product-form';

export default function NewProductPage() {
  const { storeId, s, can } = useStore();
  const router = useRouter();
  if (!can('catalogue.write')) return <Denied what="create products" />;
  return (
    <>
      <PageHeader title="New product" subtitle="Products start as drafts. Add variants, prices and photos, then publish." />
      <ProductForm
        submitLabel="Create draft"
        onSubmit={async (v: ProductFormValues) => {
          const r = await api<{ product: { id: string } }>(s('products'), { method: 'POST', body: v });
          router.push(`/s/${storeId}/products/${r.product.id}`);
        }}
      />
    </>
  );
}
