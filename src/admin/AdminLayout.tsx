import { type ReactNode, useState } from 'react';
import { useNavigation } from '../context/NavigationContext';
import { useAuth } from '../context/AuthContext';
import {
  LayoutDashboard, FileText, FolderTree, Users, MessageSquare,
  Image, Star, Settings, LogOut, PenLine, ExternalLink,
  ShoppingBag, Package, UserCircle, FolderHeart, Mail,
  BarChart3, ShieldCheck, ChevronDown, ChevronRight, Inbox,
  Tag, RotateCcw, ShoppingCart,
  Activity, FileCode, Gift, Share2, Calendar,
  Layers, BookA, MessageCircleQuestion, DatabaseBackup, Moon, Sun,
  Database, HeartPulse, TrendingUp, Lightbulb, Sparkles, Palette, KeyRound
} from 'lucide-react';
import { canAccess } from './permissions';
import { useTheme } from '../context/ThemeContext';
import type { LucideIcon } from 'lucide-react';

interface NavItem {
  label: string;
  route: { name: string };
  href?: string;
  icon: LucideIcon;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

const NAV_SECTIONS: NavSection[] = [
  {
    title: 'Operations',
    items: [
      { label: 'Team & access', route: { name: 'admin-access' }, icon: KeyRound },
      { label: 'Health & issues', route: { name: 'admin-health' }, icon: HeartPulse },
      { label: 'Advisor', route: { name: 'admin-advisor' }, icon: Lightbulb },
      { label: 'Admin AI', route: { name: 'admin-ai' }, icon: Sparkles },
      { label: 'Growth & SEO', route: { name: 'admin-growth' }, icon: TrendingUp },
      { label: 'Data explorer', route: { name: 'admin-data' }, icon: Database },
      { label: 'Front end', route: { name: 'admin-frontend' }, icon: Palette },
      { label: 'Automation keys', route: { name: 'admin-automation-keys' }, href: '/admin/automation/keys', icon: KeyRound },
      { label: 'System Check', route: { name: 'admin-automation-check' }, href: '/admin/automation/check', icon: HeartPulse },
    ],
  },
  {
    title: 'Editorial',
    items: [
      { label: 'Dashboard', route: { name: 'admin-dashboard' }, icon: LayoutDashboard },
      { label: 'Articles', route: { name: 'admin-articles' }, icon: FileText },
      { label: 'Article queue & calendar', route: { name: 'admin-automation-articles' }, href: '/admin/automation/articles', icon: Calendar },
      { label: 'Categories', route: { name: 'admin-categories' }, icon: FolderTree },
      { label: 'Authors', route: { name: 'admin-authors' }, icon: Users },
      { label: 'Comments', route: { name: 'admin-comments' }, icon: MessageSquare },
      { label: 'Messages', route: { name: 'admin-messages' }, icon: Inbox },
      { label: 'Media', route: { name: 'admin-media' }, icon: Image },
      { label: 'Featured', route: { name: 'admin-featured' }, icon: Star },
      { label: 'Series', route: { name: 'admin-series' }, icon: Layers },
      { label: 'Glossary', route: { name: 'admin-glossary' }, icon: BookA },
      { label: 'Reader Questions', route: { name: 'admin-questions' }, icon: MessageCircleQuestion },
      { label: 'Settings', route: { name: 'admin-settings' }, icon: Settings },
    ],
  },
  {
    title: 'Commerce',
    items: [
      { label: 'Products', route: { name: 'admin-products' }, icon: ShoppingBag },
      { label: 'Orders', route: { name: 'admin-orders' }, icon: Package },
      { label: 'Customers', route: { name: 'admin-customers' }, icon: UserCircle },
      { label: 'Promo Codes', route: { name: 'admin-promo-codes' }, icon: Tag },
      { label: 'Gift Cards', route: { name: 'admin-gift-cards' }, icon: Gift },
      { label: 'Reviews', route: { name: 'admin-reviews' }, icon: Star },
      { label: 'Refunds', route: { name: 'admin-refunds' }, icon: RotateCcw },
      { label: 'Abandoned Carts', route: { name: 'admin-abandoned-carts' }, icon: ShoppingCart },
    ],
  },
  {
    title: 'Marketing',
    items: [
      { label: 'Collections', route: { name: 'admin-collections' }, icon: FolderHeart },
      { label: 'Newsletter', route: { name: 'admin-newsletter' }, icon: Mail },
      { label: 'Subscriber Prefs', route: { name: 'admin-subscribers-prefs' }, icon: Calendar },
      { label: 'Sponsored', route: { name: 'admin-sponsored' }, icon: ShieldCheck },
      { label: 'Polls', route: { name: 'admin-polls' }, icon: BarChart3 },
      { label: 'Social Shares', route: { name: 'admin-social-shares' }, icon: Share2 },
    ],
  },
  {
    title: 'Analytics',
    items: [
      { label: 'Content Performance', route: { name: 'admin-analytics' }, icon: BarChart3 },
      { label: 'Activity Log', route: { name: 'admin-activity-log' }, icon: Activity },
    ],
  },
  {
    title: 'Tools',
    items: [
      { label: 'Content Templates', route: { name: 'admin-content-templates' }, icon: FileCode },
      { label: 'Feedback', route: { name: 'admin-feedback' }, icon: MessageSquare },
      { label: 'Backups & Jobs', route: { name: 'admin-backups' }, icon: DatabaseBackup },
      { label: 'Security (2FA)', route: { name: 'admin-security' }, icon: ShieldCheck },
    ],
  },
];

export default function AdminLayout({ children }: { children: ReactNode }) {
  const { route, navigate } = useNavigation();
  const { theme, toggleTheme } = useTheme();
  const { signOut, adminAccess, email } = useAuth();
  const sections = NAV_SECTIONS.map(sec => ({ ...sec, items: sec.items.filter(i => canAccess(adminAccess, i.route.name)) })).filter(sec => sec.items.length > 0);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['Super panel', 'Operations', 'Editorial', 'Commerce', 'Marketing', 'Analytics']));

  const handleSignOut = async () => {
    await signOut();
    navigate({ name: 'admin-login' });
  };

  const toggleSection = (title: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col lg:flex-row">
      <aside className="lg:w-60 bg-gray-900 text-white flex-shrink-0 lg:min-h-screen sticky top-0 z-30">
        <div className="p-5 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <PenLine size={18} strokeWidth={1.5} className="text-bronze" />
            <span className="font-serif text-lg">Lixxon Studio</span>
          </div>
          <p className="text-xs text-gray-500 mt-1 tracking-wider uppercase">Editorial CMS</p>
          {adminAccess && (
            <p className="text-[10px] text-gray-500 mt-2 truncate" title={email || ''}>
              <span className="text-bronze uppercase tracking-wider">{adminAccess.role_label || adminAccess.role}</span>
              {adminAccess.is_founder && <span className="ml-1 text-amber-400" title="Protected super admin">★</span>}
              {' · '}{email}
            </p>
          )}
        </div>

        <nav className="p-3 space-y-1 overflow-x-auto lg:overflow-x-hidden flex lg:flex-col gap-0.5">
          {sections.map(section => {
            const isExpanded = expandedSections.has(section.title);
            return (
              <div key={section.title} className="lg:space-y-0.5">
                <button
                  onClick={() => toggleSection(section.title)}
                  className="hidden lg:flex items-center gap-1.5 w-full px-3 py-1.5 text-[10px] tracking-editorial uppercase text-gray-500 hover:text-gray-300 transition-colors"
                >
                  {isExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                  {section.title}
                </button>
                <div className={`lg:${isExpanded ? 'block' : 'hidden'} flex lg:block gap-0.5`}>
                  {section.items.map(item => {
                    const currentPath = window.location.pathname.replace(/\/+$/, '') || '/';
                    const isActive = route.name === item.route.name || (item.href !== undefined && currentPath === item.href);
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.route.name}
                        type="button"
                        onClick={() => item.href ? window.location.assign(item.href) : navigate(item.route as never)}
                        aria-current={isActive ? 'page' : undefined}
                        className={`flex min-h-11 items-center gap-3 px-3 py-2.5 rounded text-sm transition-colors whitespace-nowrap ${
                          isActive ? 'bg-bronze text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800'
                        }`}
                      >
                        <Icon size={16} strokeWidth={1.5} />
                        {item.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {/* Theme toggle — same remembered preference as the public site */}
          <button
            onClick={toggleTheme}
            className="flex items-center gap-3 px-3 py-2.5 rounded text-sm text-gray-400 hover:text-white hover:bg-gray-800 transition-colors whitespace-nowrap"
            aria-label={theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'}
            aria-pressed={theme === 'dark'}
          >
            {theme === 'light' ? <Moon size={16} strokeWidth={1.5} /> : <Sun size={16} strokeWidth={1.5} />}
            Theme
          </button>
        </nav>

        <div className="p-3 mt-auto border-t border-gray-800 hidden lg:block">
          <button
            onClick={() => navigate({ name: 'home', page: 1 })}
            className="flex items-center gap-3 px-3 py-2.5 rounded text-sm text-gray-400 hover:text-white hover:bg-gray-800 transition-colors w-full"
          >
            <ExternalLink size={16} strokeWidth={1.5} />
            View Site
          </button>
          <button
            onClick={handleSignOut}
            className="flex items-center gap-3 px-3 py-2.5 rounded text-sm text-gray-400 hover:text-white hover:bg-gray-800 transition-colors w-full"
          >
            <LogOut size={16} strokeWidth={1.5} />
            Sign Out
          </button>
        </div>
      </aside>

      <main className="flex-1 min-w-0">
        <div className="max-w-6xl mx-auto p-6 lg:p-10">
          {children}
        </div>
      </main>
    </div>
  );
}
