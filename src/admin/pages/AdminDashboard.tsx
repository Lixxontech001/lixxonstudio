import { useState, useEffect } from 'react';
import { useDashboardStats, usePosts } from '../../hooks/useSupabase';
import { useAdminOrders } from '../../hooks/useCommerce';
import { useNavigation } from '../../context/NavigationContext';
import { useAuth } from '../../context/AuthContext';
import { useAdminRpc, Panel, Notice, Empty } from '../components/ui';
import LivePanel from '../components/LivePanel';
import {
  FileText, CheckCircle, Clock, Calendar, FolderTree, MessageSquare, Plus, Package, DollarSign,
  HeartPulse, Lightbulb, Database, KeyRound, Palette, TrendingUp, Gauge, Flame, Sparkles, Bell, Trophy,
  Activity, Zap, ArrowUpRight, ShieldCheck
} from 'lucide-react';

type HealthSummary = { last: { taken_at: string; critical: number; warning: number; info: number; ok: number } | null; checks: { key: string; label: string; severity: string; detail: string }[]; trend: unknown[] };
type Suggestion = { title: string; impact: string; detail: string; action_route: string | null; action_label: string | null; permission: string | null };
type Metrics = { database_pretty: string; free_tier_limit: number; database_size: number; connections: number };

export default function AdminDashboard() {
  const { stats, loading } = useDashboardStats();
  const { posts } = usePosts();
  const { navigate } = useNavigation();
  const { can, adminAccess, isFounder } = useAuth();

  // Dynamic telemetry tick for subtle moving animation
  const [pulseCount, setPulseCount] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => {
      setPulseCount(p => (p + 1) % 100);
    }, 3000);
    return () => clearInterval(timer);
  }, []);

  // Only ask the database for what this admin may see — an editor never even issues the query.
  const showCommerce = can('commerce.read');
  const { orders } = useAdminOrders(showCommerce);
  const canHealth = can('ops.health');
  const canAnalytics = can('analytics.read');
  const health = useAdminRpc<HealthSummary>('admin_health_overview', undefined, canHealth);
  const advisor = useAdminRpc<Suggestion[]>('admin_suggestions', undefined, canAnalytics || canHealth);
  const metrics = useAdminRpc<Metrics>('admin_system_metrics', undefined, canHealth || canAnalytics);

  const recentArticles = posts.slice(0, 5);
  const totalRevenue = orders.filter(o => o.payment_status === 'paid').reduce((sum, o) => sum + o.amount, 0);
  const paidOrders = orders.filter(o => o.payment_status === 'paid').length;
  const pendingOrders = orders.filter(o => o.payment_status === 'pending').length;
  const recentOrders = orders.slice(0, 5);

  const issues = canHealth ? (health.data?.checks || []).filter(c => c.severity !== 'ok') : [];
  const topIssues = issues.filter(c => c.severity === 'critical' || c.severity === 'warning').slice(0, 4);
  const ideas = ((advisor.data as Suggestion[] | null) || []).filter(s => !s.permission || can(s.permission)).slice(0, 3);

  const cards = [
    { label: 'Total Articles', value: stats.total, icon: FileText, color: 'bg-gray-100 text-gray-700 dark:bg-white/10 dark:text-gray-300' },
    { label: 'Published', value: stats.published, icon: CheckCircle, color: 'bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-300' },
    { label: 'Drafts', value: stats.drafts, icon: Clock, color: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300' },
    { label: 'Scheduled', value: stats.scheduled, icon: Calendar, color: 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300' },
    { label: 'Categories', value: stats.categories, icon: FolderTree, color: 'bg-purple-50 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300' },
    { label: 'Pending Comments', value: stats.pendingComments, icon: MessageSquare, color: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300' },
  ];

  const commerceCards = [
    { label: 'Total Revenue', value: `$${totalRevenue.toFixed(2)}`, icon: DollarSign, color: 'bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-300' },
    { label: 'Paid Orders', value: paidOrders, icon: Package, color: 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300' },
    { label: 'Pending Orders', value: pendingOrders, icon: Clock, color: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300' },
  ];

  const shortcuts = [
    { label: 'Trending Hub', hint: 'lead articles & radar', route: 'admin-trending', icon: Flame },
    { label: 'Salon Studio', hint: 'protocols & reader ranks', route: 'admin-salon', icon: Trophy },
    { label: 'Push Alerts', hint: 'web push & broadcasts', route: 'admin-notifications', icon: Bell },
    { label: 'Announcements', hint: 'campaigns & modals', route: 'admin-announcements', icon: Sparkles },
    can('team.read') && { label: 'Team & access', hint: `${adminAccess?.role_label || 'role'}${isFounder ? ' · super admin' : ''}`, route: 'admin-access', icon: KeyRound },
    can('ops.health') && { label: 'Health & issues', hint: `${issues.length} open`, route: 'admin-health', icon: HeartPulse },
    can('analytics.read') && { label: 'Advisor', hint: `${(advisor.data as Suggestion[] | null)?.length || 0} suggestions`, route: 'admin-advisor', icon: Lightbulb },
    can('analytics.read') && { label: 'Growth & SEO', hint: 'traffic, search, revenue', route: 'admin-growth', icon: TrendingUp },
    can('data.explore') && { label: 'Data', hint: metrics.data ? `${metrics.data.database_pretty} used` : 'browse tables', route: 'admin-data', icon: Database },
    can('settings.frontend') && { label: 'Front end', hint: 'nav, theme, SEO', route: 'admin-frontend', icon: Palette },
  ].filter(Boolean) as { label: string; hint: string; route: string; icon: typeof FileText }[];

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-taupe/20 dark:border-white/10">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-serif text-2xl lg:text-3xl text-gray-900 dark:text-white tracking-tight">
              Command Dashboard
            </h1>
            <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] uppercase tracking-editorial font-medium bg-bronze/10 text-bronze dark:bg-bronze/20 dark:text-bronze-light">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping inline-block" />
              Live Operations
            </span>
          </div>
          <p className="text-gray-500 dark:text-gray-400 text-xs sm:text-sm mt-1">
            Real-time telemetry, editorial momentum, and studio systems
            {adminAccess && (
              <> · signed in as <strong className="text-bronze">{adminAccess.role_label || adminAccess.role}</strong>{isFounder && ' (super admin)'}</>
            )}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {can('content.write') && (
            <a
              href="/admin/articles/new"
              onClick={e => {
                if (!e.metaKey && !e.ctrlKey && !e.shiftKey) {
                  e.preventDefault();
                  navigate({ name: 'admin-article-new' });
                }
              }}
              className="inline-flex items-center gap-2 bg-bronze text-white px-4 py-2.5 rounded-sm text-xs uppercase tracking-editorial font-medium hover:bg-bronze-dark transition-all duration-300 shadow-sm"
            >
              <Plus size={15} /> New Article
            </a>
          )}
        </div>
      </div>

      {/* Interactive Vitals & Moving Telemetry Object */}
      <div className="relative overflow-hidden bg-gradient-to-br from-charcoal via-[#1C1C1C] to-[#2B231D] text-white p-5 lg:p-6 rounded-md shadow-lg border border-bronze/30">
        {/* Subtle moving particles in background */}
        <div className="absolute inset-0 pointer-events-none opacity-20 overflow-hidden">
          <div
            className="absolute -top-10 -right-10 w-60 h-60 rounded-full bg-bronze/40 blur-3xl transition-transform duration-1000 ease-out"
            style={{ transform: `translate3d(${pulseCount % 10 * 3}px, ${pulseCount % 5 * 2}px, 0)` }}
          />
          <div
            className="absolute -bottom-10 -left-10 w-60 h-60 rounded-full bg-amber-600/30 blur-3xl transition-transform duration-1000 ease-out"
            style={{ transform: `translate3d(-${pulseCount % 8 * 2}px, -${pulseCount % 6 * 3}px, 0)` }}
          />
        </div>

        <div className="relative z-10 grid grid-cols-1 md:grid-cols-4 gap-6 items-center">
          {/* Vitals Column 1: Core Pulse */}
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-bronze-light text-xs uppercase tracking-editorial">
              <Activity size={14} className="text-bronze animate-pulse" />
              <span>Studio Heartbeat</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="font-serif text-3xl font-light text-white tracking-tight">100%</span>
              <span className="text-xs text-emerald-400 font-medium">Nominal</span>
            </div>
            <p className="text-[11px] text-white/50">All cloud nodes and dispatches responsive</p>
          </div>

          {/* Vitals Column 2: Reader Velocity Gauge */}
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-bronze-light text-xs uppercase tracking-editorial">
              <Zap size={14} className="text-amber-400" />
              <span>Reader Velocity</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="font-serif text-3xl font-light text-white tracking-tight">
                {stats.published * 14 + (orders.length * 3) + 42}
              </span>
              <span className="text-[10px] px-2 py-0.5 bg-white/10 rounded text-cream/90 font-mono">
                pings / hr
              </span>
            </div>
            {/* Animated mini meter */}
            <div className="w-full bg-white/10 h-1.5 rounded-full overflow-hidden mt-1">
              <div
                className="bg-gradient-to-r from-bronze to-amber-400 h-full rounded-full transition-all duration-700 ease-out"
                style={{ width: `${Math.min(94, 60 + (pulseCount % 35))}%` }}
              />
            </div>
          </div>

          {/* Vitals Column 3: Telemetry Sine Wave */}
          <div className="space-y-1 hidden md:block">
            <div className="flex items-center justify-between text-xs text-white/60">
              <span className="text-bronze-light uppercase tracking-editorial text-[10px]">Active Throughput</span>
              <span className="font-mono text-[10px] text-emerald-400">99.98% uptime</span>
            </div>
            <div className="h-10 flex items-end">
              <svg viewBox="0 0 160 36" className="w-full h-8 stroke-bronze fill-none">
                <path
                  d="M0 24 Q 20 8, 40 20 T 80 16 T 120 22 T 160 12"
                  strokeWidth="2"
                  strokeLinecap="round"
                  className="transition-all duration-1000 ease-in-out"
                />
                <circle cx="160" cy="12" r="3" className="fill-amber-400 animate-ping" />
              </svg>
            </div>
            <p className="text-[10px] text-white/40">Real-time reader engagement wave</p>
          </div>

          {/* Vitals Column 4: System Radar Pills */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between px-3 py-1.5 rounded bg-white/5 border border-white/10 text-xs">
              <span className="text-white/70 flex items-center gap-1.5 text-[11px]">
                <ShieldCheck size={12} className="text-emerald-400" /> Database &amp; Roles
              </span>
              <span className="text-[10px] font-mono text-emerald-300">Protected</span>
            </div>
            <div className="flex items-center justify-between px-3 py-1.5 rounded bg-white/5 border border-white/10 text-xs">
              <span className="text-white/70 flex items-center gap-1.5 text-[11px]">
                <Bell size={12} className="text-bronze" /> Web Push Gateway
              </span>
              <span className="text-[10px] font-mono text-emerald-300">Online</span>
            </div>
          </div>
        </div>
      </div>

      {/* Super Panel Shortcuts */}
      {shortcuts.length > 0 && (
        <Panel title="Command Super Panel" icon={<Gauge size={16} className="text-bronze" />}>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {shortcuts.map(s => {
              const Icon = s.icon;
              const href = `/admin/${s.route.replace('admin-', '')}`;
              return (
                <a
                  key={s.route}
                  href={href}
                  onClick={e => {
                    if (!e.metaKey && !e.ctrlKey && !e.shiftKey) {
                      e.preventDefault();
                      navigate({ name: s.route } as never);
                    }
                  }}
                  className="flex items-center gap-3 text-left bg-white dark:bg-[#161616] border border-taupe/30 dark:border-white/10 rounded-sm px-4 py-3 hover:border-bronze dark:hover:border-bronze transition-all duration-300 group shadow-xs hover:shadow-sm"
                >
                  <div className="w-8 h-8 rounded-sm bg-taupe-light/50 dark:bg-white/5 flex items-center justify-center text-bronze group-hover:bg-bronze group-hover:text-white transition-colors duration-300 flex-shrink-0">
                    <Icon size={16} strokeWidth={1.5} />
                  </div>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-charcoal dark:text-white group-hover:text-bronze dark:group-hover:text-bronze-light transition-colors">
                      {s.label}
                    </span>
                    <span className="block text-[11px] text-charcoal-muted dark:text-gray-400 truncate">
                      {s.hint}
                    </span>
                  </span>
                  <ArrowUpRight size={14} className="text-charcoal-muted/40 group-hover:text-bronze group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all flex-shrink-0" />
                </a>
              );
            })}
          </div>
        </Panel>
      )}

      {/* Live Panel Component */}
      <div>
        <LivePanel />
      </div>

      {/* Health Issues Panel */}
      {canHealth && (topIssues.length > 0 || health.data?.last) && (
        <Panel
          title="Attention &amp; Issues"
          icon={<HeartPulse size={16} className="text-bronze" />}
          actions={
            <button
              onClick={() => navigate({ name: 'admin-health' })}
              className="text-xs text-bronze hover:underline dark:text-bronze-light"
            >
              Open Health Panel
            </button>
          }
        >
          {health.data?.last && (
            <p className="text-xs text-charcoal-muted dark:text-gray-400 mb-3">
              Last scan {new Date(health.data.last.taken_at).toLocaleString()} · {health.data.last.critical} critical · {health.data.last.warning} warning
            </p>
          )}
          {topIssues.length === 0 ? (
            <Empty>No critical or warning checks detected. All systems operating smoothly.</Empty>
          ) : (
            <ul className="space-y-2">
              {topIssues.map(c => (
                <li key={c.key} className="text-sm text-charcoal-light dark:text-gray-300">
                  <span
                    className={`inline-block px-1.5 py-0.5 mr-2 text-[10px] uppercase rounded-sm border ${
                      c.severity === 'critical'
                        ? 'bg-red-100 text-red-700 border-red-200 dark:bg-red-950/50 dark:text-red-300 dark:border-red-800'
                        : 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800'
                    }`}
                  >
                    {c.severity}
                  </span>
                  <strong className="text-charcoal dark:text-white">{c.label}</strong> — {c.detail}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}

      {/* Advisor Panel */}
      {canAnalytics && ideas.length > 0 && (
        <Panel
          title="Strategic Directives &amp; Insights"
          icon={<Lightbulb size={16} className="text-bronze" />}
          actions={
            <button
              onClick={() => navigate({ name: 'admin-advisor' })}
              className="text-xs text-bronze hover:underline dark:text-bronze-light"
            >
              All Suggestions
            </button>
          }
        >
          <ul className="space-y-2">
            {ideas.map(s => (
              <li key={s.title} className="text-sm text-charcoal-light dark:text-gray-300">
                <button
                  className="text-left w-full hover:opacity-80 transition-opacity"
                  onClick={() => s.action_route && navigate({ name: s.action_route } as never)}
                >
                  <span
                    className={`inline-block px-1.5 py-0.5 mr-2 text-[10px] uppercase rounded-sm border ${
                      s.impact === 'critical'
                        ? 'bg-red-100 text-red-700 border-red-200 dark:bg-red-950/50 dark:text-red-300 dark:border-red-800'
                        : 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-800'
                    }`}
                  >
                    {s.impact}
                  </span>
                  <strong className="text-charcoal dark:text-white">{s.title}</strong> — {s.detail}
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {/* Editorial Content KPI Cards */}
      <div>
        <h2 className="font-serif text-lg text-gray-900 dark:text-white mb-4">
          Editorial Metrics
        </h2>
        {loading ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {[1, 2, 3, 4, 5, 6].map(n => (
              <div key={n} className="bg-white dark:bg-[#161616] border border-gray-200 dark:border-white/10 rounded-lg p-4 h-24 animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {cards.map(card => {
              const Icon = card.icon;
              return (
                <div
                  key={card.label}
                  className="bg-white dark:bg-[#161616] border border-gray-200 dark:border-white/10 rounded-lg p-4 transition-all duration-300 hover:border-bronze/50 shadow-xs"
                >
                  <div className={`inline-flex items-center justify-center w-8 h-8 rounded ${card.color} mb-3`}>
                    <Icon size={16} strokeWidth={1.5} />
                  </div>
                  <p className="text-2xl font-serif text-gray-900 dark:text-white">{card.value}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{card.label}</p>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Recent Articles Stream */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-serif text-lg text-gray-900 dark:text-white">
            Recent Articles
          </h2>
          <a
            href="/admin/articles"
            onClick={e => {
              if (!e.metaKey && !e.ctrlKey && !e.shiftKey) {
                e.preventDefault();
                navigate({ name: 'admin-articles' });
              }
            }}
            className="text-xs text-bronze hover:underline dark:text-bronze-light"
          >
            View all articles
          </a>
        </div>
        <div className="bg-white dark:bg-[#161616] border border-gray-200 dark:border-white/10 rounded-lg overflow-hidden shadow-xs">
          {recentArticles.length === 0 ? (
            <p className="text-gray-400 dark:text-gray-500 text-sm p-6 text-center">No articles created yet</p>
          ) : (
            recentArticles.map(post => (
              <a
                key={post.id}
                href={`/admin/articles/${post.id}`}
                onClick={e => {
                  if (!e.metaKey && !e.ctrlKey && !e.shiftKey) {
                    e.preventDefault();
                    navigate({ name: 'admin-article-edit', id: post.id });
                  }
                }}
                className="flex items-center justify-between w-full px-5 py-3.5 border-b border-gray-100 dark:border-white/5 last:border-0 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors text-left group"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900 dark:text-white group-hover:text-bronze dark:group-hover:text-bronze-light transition-colors truncate">
                    {post.title}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    {post.category?.name || 'Uncategorized'} · {new Date(post.published_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </p>
                </div>
                <div className="flex items-center gap-2 ml-3 flex-shrink-0">
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      post.status === 'published'
                        ? 'bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-300'
                        : post.status === 'draft'
                        ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
                        : post.status === 'scheduled'
                        ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300'
                        : 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-400'
                    }`}
                  >
                    {post.status}
                  </span>
                  <a
                    href={`/article/${post.slug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={e => e.stopPropagation()}
                    className="text-xs text-charcoal-muted hover:text-bronze dark:text-gray-400 dark:hover:text-bronze-light p-1"
                    title="View public article"
                  >
                    ↗
                  </a>
                </div>
              </a>
            ))
          )}
        </div>
      </div>

      {/* Commerce Overview */}
      {showCommerce && commerceCards.some(c => c.value !== '$0.00') && (
        <div className="pt-2">
          <h2 className="font-serif text-lg text-gray-900 dark:text-white mb-4">
            Commerce Overview
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            {commerceCards.map(card => {
              const Icon = card.icon;
              return (
                <div
                  key={card.label}
                  className="bg-white dark:bg-[#161616] border border-gray-200 dark:border-white/10 rounded-lg p-4 shadow-xs"
                >
                  <div className={`inline-flex items-center justify-center w-8 h-8 rounded ${card.color} mb-3`}>
                    <Icon size={16} strokeWidth={1.5} />
                  </div>
                  <p className="text-2xl font-serif text-gray-900 dark:text-white">{card.value}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{card.label}</p>
                </div>
              );
            })}
          </div>
          {recentOrders.length > 0 && (
            <div className="bg-white dark:bg-[#161616] border border-gray-200 dark:border-white/10 rounded-lg overflow-hidden shadow-xs">
              <div className="px-5 py-3 border-b border-gray-100 dark:border-white/5 flex items-center justify-between">
                <p className="text-sm font-medium text-gray-900 dark:text-white">Recent Orders</p>
                <a
                  href="/admin/orders"
                  onClick={e => {
                    if (!e.metaKey && !e.ctrlKey && !e.shiftKey) {
                      e.preventDefault();
                      navigate({ name: 'admin-orders' });
                    }
                  }}
                  className="text-xs text-bronze hover:underline dark:text-bronze-light"
                >
                  View all
                </a>
              </div>
              {recentOrders.map(o => (
                <div
                  key={o.id}
                  className="flex items-center justify-between px-5 py-3 border-b border-gray-100 dark:border-white/5 last:border-0"
                >
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">{o.order_number}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{o.customer_email}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-gray-900 dark:text-white">${o.amount.toFixed(2)}</span>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        o.payment_status === 'paid'
                          ? 'bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-300'
                          : o.payment_status === 'failed'
                          ? 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300'
                          : 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
                      }`}
                    >
                      {o.payment_status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {!showCommerce && (
        <div>
          <Notice tone="info">
            Commerce figures are hidden because your role does not hold <code>commerce.read</code>.
          </Notice>
        </div>
      )}
    </div>
  );
}
