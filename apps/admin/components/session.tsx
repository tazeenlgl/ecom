'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { hasPermission, type Grant, type RoleDef } from '@/lib/permissions';

export type StoreSummary = { id: string; brandId: string; slug: string; name: string; status: string; currency: string; locale: string; timezone: string };
export type SessionData = { admin: { id: string; email: string; name: string }; grants: Grant[]; roles: RoleDef[]; stores: StoreSummary[] };

const Ctx = createContext<SessionData | null>(null);

export function SessionProvider({ value, children }: { value: SessionData; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  const s = useContext(Ctx);
  if (!s) throw new Error('SessionProvider missing');
  return {
    ...s,
    /** UI-only permission check (the API enforces the real one). storeId null = platform scope. */
    can: (permission: string, storeId: string | null = null) => hasPermission(s.grants, s.roles, permission, storeId),
    roleLabels: (storeId: string | null) =>
      s.grants.filter((g) => g.storeId === null || g.storeId === storeId).map((g) => `${s.roles.find((r) => r.key === g.role)?.label ?? g.role}${g.storeId ? '' : ' (platform)'}`),
  };
}
