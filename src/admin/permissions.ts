import type { AdminRole } from '../context/AuthContext';

/** UI-level map of which admin routes each role may open. The DB enforces the real rules. */
const MODERATOR: string[] = ['admin', 'admin-dashboard', 'admin-comments', 'admin-reviews', 'admin-questions', 'admin-messages', 'admin-feedback', 'admin-security'];
const EDITOR: string[] = [...MODERATOR, 'admin-articles', 'admin-article-new', 'admin-article-edit', 'admin-categories', 'admin-authors', 'admin-media', 'admin-featured',
  'admin-collections', 'admin-collection-new', 'admin-collection-edit', 'admin-newsletter', 'admin-subscribers-prefs', 'admin-polls', 'admin-social-shares',
  'admin-analytics', 'admin-content-templates', 'admin-glossary', 'admin-series', 'admin-sponsored'];

export function canAccess(role: AdminRole, routeName: string): boolean {
  if (!routeName.startsWith('admin')) return true;
  if (role === 'owner') return true;
  if (role === 'editor') return EDITOR.includes(routeName);
  if (role === 'moderator') return MODERATOR.includes(routeName);
  return false;
}
