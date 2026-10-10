import { useDashboardStats, usePosts } from '../../hooks/useSupabase';
import { useAdminOrders } from '../../hooks/useCommerce';
import { useNavigation } from '../../context/NavigationContext';
import { useAuth } from '../../context/AuthContext';
import { useAdminRpc, Panel, Notice, Empty } from '../components/ui';
import LivePanel from '../components/LivePanel';
import {
  FileText, CheckCircle, Clock, Calendar, FolderTree, MessageSquare, Plus, Package, DollarSign,
  HeartPulse, Lightbulb, Database, KeyRound, Palette, TrendingUp, Gauge,
} from 'lucide-react';

type HealthSummary = { last: { taken_at: string; critical: number; warning: number; info: number; ok: number } | null; checks: { key: string; label: string; severity: string; detail: string }[]; trend: unknown[] };
type Suggestion = { title: string; impact: string; detail: string; action_route: string | null; action_label: string | null; permission: string | null };
type Metrics = { database_pretty: string; free_tier_limit: number; database_size: number; connections: number };

export default function AdminDashboard() {
  const { stats, loading } = useDashboardStats();
  const { posts } = usePosts();
  const { navigate } = useNavigation();
  const { can, adminAccess, isFounder } = useAuth();

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
    { label: 'Total Articles', value: stats.total, icon: FileText, color: 'bg-gray-100 text-gray-700' },
    { label: 'Published', value: stats.published, icon: CheckCircle, color: 'bg-green-50 text-green-700' },
    { label: 'Drafts', value: stats.drafts, icon: Clock, color: 'bg-amber-50 text-amber-700' },
    { label: 'Scheduled', value: stats.scheduled, icon: Calendar, color: 'bg-blue-50 text-blue-700' },
    { label: 'Categories', value: stats.categories, icon: FolderTree, color: 'bg-purple-50 text-purple-700' },
    { label: 'Pending Comments', value: stats.pendingComments, icon: MessageSquare, color: 'bg-red-50 text-red-700' },
  ];

  const commerceCards = [
    { label: 'Total Revenue', value: `${totalRevenue.toFixed(2)}`, icon: DollarSign, color: 'bg-green-50 text-green-700' },
    { label: 'Paid Orders', value: paidOrders, icon: Package, color: 'bg-blue-50 text-blue-700' },
    { label: 'Pending Orders', value: pendingOrders, icon: Clock, color: 'bg-amber-50 text-amber-700' },
  ];

  const shortcuts = [
    can('team.read') && { label: 'Team & access', hint: `${adminAccess?.role_label || 'role'}${isFounder ? ' · super admin' : ''}`, route: 'admin-access', icon: KeyRound },
    can('ops.health') && { label: 'Health & issues', hint: `${issues.length} open`, route: 'admin-health', icon: HeartPulse },
    can('analytics.read') && { label: 'Advisor', hint: `${(advisor.data as Suggestion[] | null)?.length || 0} suggestions`, route: 'admin-advisor', icon: Lightbulb },
    can('analytics.read') && { label: 'Growth & SEO', hint: 'traffic, search, revenue', route: 'admin-growth', icon: TrendingUp },
    can('data.explore') && { label: 'Data', hint: metrics.data ? `${metrics.data.database_pretty} used` : 'browse tables', route: 'admin-data', icon: Database },
    can('settings.frontend') && { label: 'Front end', hint: 'nav, theme, SEO', route: 'admin-frontend', icon: Palette },
  ].filter(Boolean) as { label: string; hint: string; route: string; icon: typeof FileText }[];

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-serif text-2xl text-gray-900">Dashboard</h1>
          <p className="text-gray-500 text-sm mt-1">
            Overview of your editorial content
            {adminAccess && <> · signed in as <strong className="text-bronze">{adminAccess.role_label || adminAccess.role}</strong>{isFounder && ' (super admin)'}</>}
          </p>
        </div>
        {can('content.write') && (
          <button
            onClick={() => navigate({ name: 'admin-article-new' })}
            className="inline-flex items-center gap-2 bg-bronze text-white px-4 py-2.5 rounded text-sm font-medium hover:bg-bronze-dark transition-colors"
          >
            <Plus size={16} /> New Article
          </button>
        )}
      </div>

      {shortcuts.length > 0 && (
        <Panel title="Super panel" icon={<Gauge size={15} className="text-bronze" />}>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {shortcuts.map(s => {
              const Icon = s.icon;
              return (
                <button key={s.route} onClick={() => navigate({ name: s.route } as never)}
                  className="flex items-center gap-3 text-left border border-taupe/30 rounded-sm px-4 py-3 hover:border-bronze transition-colors">
                  <Icon size={18} className="text-bronze flex-shrink-0" strokeWidth={1.5} />
                  <span className="min-w-0">
                    <span className="block text-sm text-charcoal">{s.label}</span>
                    <span className="block text-[11px] text-charcoal-muted">{s.hint}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </Panel>
      )}

      {canHealth && (topIssues.length > 0 || health.data?.last) && (
        <Panel title="Needs attention" icon={<HeartPulse size={15} className="text-bronze" />}
          actions={<button onClick={() => navigate({ name: 'admin-health' })} className="text-xs text-bronze hover:underline">Open health</button>}>
          {health.data?.last && (
            <p className="text-xs text-charcoal-muted mb-3">
              Last scan {new Date(health.data.last.taken_at).toLocaleString()} · {health.data.last.critical} critical · {health.data.last.warning} warning
            </p>
          )}
          {topIssues.length === 0 ? <Empty>No critical or warning checks.</Empty> : (
            <ul className="space-y-2">
              {topIssues.map(c => (
                <li key={c.key} className="text-sm text-charcoal-light">
                  <span className={`inline-block px-1.5 py-0.5 mr-2 text-[10px] uppercase rounded-sm border ${c.severity === 'critical' ? 'bg-red-100 text-red-700 border-red-200' : 'bg-amber-100 text-amber-800 border-amber-200'}`}>{c.severity}</span>
                  <strong className="text-charcoal">{c.label}</strong> — {c.detail}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}

      {canAnalytics && ideas.length > 0 && (
        <Panel title="Advisor" icon={<Lightbulb size={15} className="text-bronze" />}
          actions={<button onClick={() => navigate({ name: 'admin-advisor' })} className="text-xs text-bronze hover:underline">All suggestions</button>}>
          <ul className="space-y-2">
            {ideas.map(s => (
              <li key={s.title} className="text-sm text-charcoal-light">
                <button className="text-left" onClick={() => s.action_route && navigate({ name: s.action_route } as never)}>
                  <span className={`inline-block px-1.5 py-0.5 mr-2 text-[10px] uppercase rounded-sm border ${s.impact === 'critical' ? 'bg-red-100 text-red-700 border-red-200' : 'bg-blue-50 text-blue-700 border-blue-200'}`}>{s.impact}</span>
                  <strong className="text-charcoal">{s.title}</strong> — {s.detail}
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <div className="mb-8"><LivePanel /></div>

      {loading ? (
        <div className="text-gray-400 text-sm">Loading stats...</div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-10">
          {cards.map(card => {
            const Icon = card.icon;
            return (
              <div key={card.label} className="bg-white border border-gray-200 rounded-lg p-4">
                <div className={`inline-flex items-center justify-center w-9 h-9 rounded ${card.color} mb-3`}>
                  <Icon size={16} strokeWidth={1.5} />
                </div>
                <p className="text-2xl font-serif text-gray-900">{card.value}</p>
                <p className="text-xs text-gray-500 mt-0.5">{card.label}</p>
              </div>
            );
          })}
        </div>
      )}

      <div>
        <h2 className="font-serif text-lg text-gray-900 mb-4">Recent Articles</h2>
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          {recentArticles.length === 0 ? (
            <p className="text-gray-400 text-sm p-6 text-center">No articles yet</p>
          ) : (
            recentArticles.map(post => (
              <button
                key={post.id}
                onClick={() => navigate({ name: 'admin-article-edit', id: post.id })}
                className="flex items-center justify-between w-full px-5 py-3.5 border-b border-gray-100 last:border-0 hover:bg-gray-50 transition-colors text-left"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900 truncate">{post.title}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {post.category?.name || 'Uncategorized'} · {new Date(post.published_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </p>
                </div>
                <span className={`text-xs px-2 py-1 rounded-full ml-3 flex-shrink-0 ${
                  post.status === 'published' ? 'bg-green-50 text-green-700' :
                  post.status === 'draft' ? 'bg-amber-50 text-amber-700' :
                  post.status === 'scheduled' ? 'bg-blue-50 text-blue-700' :
                  'bg-gray-100 text-gray-600'
                }`}>
                  {post.status}
                </span>
              </button>
            ))
          )}
        </div>
      </div>

      {showCommerce && commerceCards.some(c => c.value !== 0) && (
        <div className="mt-10">
          <h2 className="font-serif text-lg text-gray-900 mb-4">Commerce Overview</h2>
          <div className="grid grid-cols-3 gap-4 mb-6">
            {commerceCards.map(card => {
              const Icon = card.icon;
              return (
                <div key={card.label} className="bg-white border border-gray-200 rounded-lg p-4">
                  <div className={`inline-flex items-center justify-center w-9 h-9 rounded ${card.color} mb-3`}>
                    <Icon size={16} strokeWidth={1.5} />
                  </div>
                  <p className="text-2xl font-serif text-gray-900">{card.value}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{card.label}</p>
                </div>
              );
            })}
          </div>
          {recentOrders.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
                <p className="text-sm font-medium text-gray-900">Recent Orders</p>
                <button onClick={() => navigate({ name: 'admin-orders' })} className="text-xs text-bronze hover:underline">View all</button>
              </div>
              {recentOrders.map(o => (
                <div key={o.id} className="flex items-center justify-between px-5 py-3 border-b border-gray-100 last:border-0">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{o.order_number}</p>
                    <p className="text-xs text-gray-500">{o.customer_email}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-gray-900">${o.amount.toFixed(2)}</span>
                    <span className={`text-xs px-2 py-1 rounded-full ${
                      o.payment_status === 'paid' ? 'bg-green-50 text-green-700' :
                      o.payment_status === 'failed' ? 'bg-red-50 text-red-700' :
                      'bg-amber-50 text-amber-700'
                    }`}>{o.payment_status}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {!showCommerce && (
        <div className="mt-8">
          <Notice tone="info">
            Commerce figures are hidden because your role does not hold <code>commerce.read</code>. The database refuses
            those rows too — this is not just a hidden card.
          </Notice>
        </div>
      )}
    </div>
  );
}
