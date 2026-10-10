/**
 * Admin deep links normally belong in NavigationContext, which is intentionally
 * frozen for this work. Resolve these protected automation paths at the admin
 * boundary so direct loads, refresh and back/forward remain usable.
 */
export type AutomationAdminRoute = 'admin-automation-keys' | 'admin-automation-brains' | 'admin-automation-check' | 'admin-automation-articles' | 'admin-automation-runs' | 'admin-automation-video-look' | 'admin-automation-distribution';

const PATH_TO_ROUTE: Record<string, AutomationAdminRoute> = {
  '/admin/automation/keys': 'admin-automation-keys',
  '/admin/automation/brains': 'admin-automation-brains',
  '/admin/automation/check': 'admin-automation-check',
  '/admin/automation/articles': 'admin-automation-articles',
  '/admin/automation/runs': 'admin-automation-runs',
  '/admin/automation/distribution': 'admin-automation-distribution',
  '/admin/automation/video-look': 'admin-automation-video-look',
};

export function resolveAutomationAdminRoute(pathname: string): AutomationAdminRoute | null {
  const path = pathname.split('?', 1)[0].replace(/\/+$/, '') || '/';
  return PATH_TO_ROUTE[path] ?? null;
}
