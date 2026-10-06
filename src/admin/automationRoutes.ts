/**
 * Admin deep links normally belong in NavigationContext, which is intentionally
 * frozen for this work. Resolve these protected automation paths at the admin
 * boundary so direct loads, refresh and back/forward remain usable.
 */
export type AutomationAdminRoute = 'admin-automation-keys' | 'admin-automation-check' | 'admin-automation-articles';

const PATH_TO_ROUTE: Record<string, AutomationAdminRoute> = {
  '/admin/automation/keys': 'admin-automation-keys',
  '/admin/automation/check': 'admin-automation-check',
  '/admin/automation/articles': 'admin-automation-articles',
};

export function resolveAutomationAdminRoute(pathname: string): AutomationAdminRoute | null {
  const path = pathname.split('?', 1)[0].replace(/\/+$/, '') || '/';
  return PATH_TO_ROUTE[path] ?? null;
}
