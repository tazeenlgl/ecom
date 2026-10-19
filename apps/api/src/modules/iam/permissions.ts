/**
 * Permissions and roles are defined in code (versioned and reviewed with the
 * routes that check them). The database only stores which admin holds which
 * role, and for which store (`admin_role_assignments`).
 */

export const PLATFORM_PERMISSIONS = [
  'platform.brands.manage',
  'platform.stores.manage',
  'platform.domains.manage',
  'platform.admins.manage',
] as const;

export const STORE_PERMISSIONS = [
  'store.read',
  'store.settings.manage',
  'audit.read',
  'catalogue.read',
  'catalogue.write',
  'pricing.write',
  'promotions.write',
  'shipping.write',
  'content.write',
  'customers.read',
  'orders.read',
  'orders.manage',
  'refunds.manage',
  'pos.manage',
  'jobs.manage',
  'reports.read',
] as const;

export type PlatformPermission = (typeof PLATFORM_PERMISSIONS)[number];
export type StorePermission = (typeof STORE_PERMISSIONS)[number];
export type Permission = PlatformPermission | StorePermission;

export const ROLES = {
  platform_owner: { label: 'Platform owner', permissions: [...PLATFORM_PERMISSIONS, ...STORE_PERMISSIONS] },
  store_manager: { label: 'Store manager', permissions: [...STORE_PERMISSIONS] },
  catalogue_editor: {
    label: 'Catalogue editor',
    permissions: ['store.read', 'catalogue.read', 'catalogue.write', 'pricing.write', 'promotions.write', 'content.write'],
  },
  order_manager: {
    label: 'Order manager',
    permissions: ['store.read', 'catalogue.read', 'customers.read', 'orders.read', 'orders.manage', 'refunds.manage', 'reports.read'],
  },
  support: { label: 'Customer support', permissions: ['store.read', 'catalogue.read', 'customers.read', 'orders.read'] },
} as const satisfies Record<string, { label: string; permissions: readonly Permission[] }>;

export type RoleKey = keyof typeof ROLES;
export const ROLE_KEYS = Object.keys(ROLES) as RoleKey[];

export const isPlatformPermission = (p: Permission): p is PlatformPermission =>
  (PLATFORM_PERMISSIONS as readonly string[]).includes(p);

export type RoleGrant = { role: string; storeId: string | null };

/**
 * Whether the grants allow `permission`. Platform permissions require a
 * platform-scope grant (storeId null). Store permissions require a grant for
 * that store or a platform-scope grant.
 */
export function hasPermission(grants: RoleGrant[], permission: Permission, storeId: string | null): boolean {
  return grants.some((g) => {
    const role = ROLES[g.role as RoleKey];
    if (!role || !(role.permissions as readonly Permission[]).includes(permission)) return false;
    if (g.storeId === null) return true;
    if (isPlatformPermission(permission)) return false;
    return storeId !== null && g.storeId === storeId;
  });
}
