/**
 * Mirror of apps/api/src/modules/iam/permissions.ts `hasPermission`, fed by GET /roles and GET /me.
 * This only decides what the UI shows. The API re-checks every request, so hiding a control is never the protection.
 */
export type Grant = { role: string; storeId: string | null };
export type RoleDef = { key: string; label: string; permissions: string[] };

export const PLATFORM_PERMISSIONS = ['platform.brands.manage', 'platform.stores.manage', 'platform.domains.manage', 'platform.admins.manage'];

export function hasPermission(grants: Grant[], roles: RoleDef[], permission: string, storeId: string | null): boolean {
  return grants.some((g) => {
    const role = roles.find((r) => r.key === g.role);
    if (!role || !role.permissions.includes(permission)) return false;
    if (g.storeId === null) return true;
    if (PLATFORM_PERMISSIONS.includes(permission)) return false;
    return storeId !== null && g.storeId === storeId;
  });
}
