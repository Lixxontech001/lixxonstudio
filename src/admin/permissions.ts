import type { AdminAccess } from '../context/AuthContext';

/**
 * Route → permission map.
 *
 * The *permissions themselves* live in the database (`admin_permissions`, `admin_roles`,
 * `role_permissions`, `admin_permission_overrides`); this file only says which capability
 * a screen needs. If a route names a permission the database does not know about, nobody
 * gets in — the database wins by default.
 *
 * The real enforcement is RLS (see `20261004200000_admin_rbac.sql`): hiding a nav item is
 * convenience, not security.
 */
export const ROUTE_PERMISSIONS: Record<string, string> = {
  'admin-dashboard': 'content.read',
  'admin-articles': 'content.read',
  'admin-article-new': 'content.write',
  'admin-article-edit': 'content.write',
  'admin-categories': 'taxonomy.manage',
  'admin-authors': 'taxonomy.manage',
  'admin-series': 'taxonomy.manage',
  'admin-glossary': 'taxonomy.manage',
  'admin-media': 'media.read',
  'admin-featured': 'collections.manage',
  'admin-collections': 'collections.manage',
  'admin-collection-new': 'collections.manage',
  'admin-collection-edit': 'collections.manage',
  'admin-comments': 'content.moderate',
  'admin-reviews': 'content.moderate',
  'admin-questions': 'content.moderate',
  'admin-messages': 'content.moderate',
  'admin-feedback': 'content.moderate',
  'admin-newsletter': 'marketing.newsletter',
  'admin-subscribers-prefs': 'marketing.newsletter',
  'admin-sponsored': 'marketing.campaigns',
  'admin-polls': 'marketing.campaigns',
  'admin-social-shares': 'marketing.campaigns',
  'admin-content-templates': 'content.write',
  'admin-products': 'commerce.pricing',
  'admin-product-new': 'commerce.pricing',
  'admin-product-edit': 'commerce.pricing',
  'admin-promo-codes': 'commerce.pricing',
  'admin-gift-cards': 'commerce.pricing',
  'admin-orders': 'commerce.read',
  'admin-customers': 'commerce.read',
  'admin-abandoned-carts': 'commerce.read',
  'admin-refunds': 'commerce.refunds',
  'admin-analytics': 'analytics.read',
  'admin-growth': 'analytics.read',
  'admin-activity-log': 'audit.read',
  'admin-team': 'team.read',
  'admin-access': 'team.read',
  'admin-backups': 'ops.backups',
  'admin-health': 'ops.health',
  'admin-advisor': 'ops.health',
  'admin-data': 'data.explore',
  'admin-settings': 'settings.read',
  'admin-frontend': 'settings.frontend',
  // 'admin-security' (own 2FA), 'admin', 'admin-login' need no capability
};

/** Does this admin hold the capability (owners/founders always do)? */
export function can(access: AdminAccess | null, permission: string): boolean {
  if (!access || access.status !== 'active') return false;
  if (access.is_founder || access.is_owner) return true;
  return access.permissions.includes(permission);
}

/**
 * Route-level gate used by AdminApp and AdminLayout.
 * Non-admin routes are public; admin routes without an entry in ROUTE_PERMISSIONS
 * require a signed-in, active admin.
 */
export function canAccess(access: AdminAccess | null, routeName: string): boolean {
  if (!routeName.startsWith('admin')) return true;
  if (routeName === 'admin' || routeName === 'admin-login') return true;
  if (!access) return false;
  if (access.is_founder || access.is_owner) return true;
  if (access.status !== 'active') return false;
  const needed = ROUTE_PERMISSIONS[routeName];
  if (!needed) return true; // e.g. admin-security: any active admin
  return access.permissions.includes(needed);
}

/** Convenience for pages that want the required permission of the current route. */
export function routePermission(routeName: string): string | null {
  return ROUTE_PERMISSIONS[routeName] ?? null;
}
