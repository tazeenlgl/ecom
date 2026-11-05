'use client';

import { useParams } from 'next/navigation';
import { useSession } from './session';

/** The active store (from the URL) plus a store-scoped permission check. */
export function useStore() {
  const { storeId } = useParams<{ storeId: string }>();
  const session = useSession();
  const store = session.stores.find((s) => s.id === storeId)!;
  return {
    storeId,
    store,
    /** Path under /v1/admin/stores/:storeId, e.g. s('products'). */
    s: (path = '') => `stores/${storeId}${path ? `/${path}` : ''}`,
    can: (permission: string) => session.can(permission, storeId),
  };
}
