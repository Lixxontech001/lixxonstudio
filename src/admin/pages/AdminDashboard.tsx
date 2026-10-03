import { useDashboardStats, usePosts } from '../../hooks/useSupabase';
import { useAdminOrders } from '../../hooks/useCommerce';
import { useNavigation } from '../../context/NavigationContext';
import LivePanel from '../components/LivePanel';
import { FileText, CheckCircle, Clock, Calendar, FolderTree, MessageSquare, Plus, Package, DollarSign } from 'lucide-react';

export default function AdminDashboard() {
  const { stats, loading } = useDashboardStats();
  const { posts } = usePosts();
  const { orders } = useAdminOrders();
  const { navigate } = useNavigation();

  const recentArticles = posts.slice(0, 5);
  const totalRevenue = orders.filter(o => o.payment_status === 'paid').reduce((sum, o) => sum + o.amount, 0);
  const paidOrders = orders.filter(o => o.payment_status === 'paid').length;
  const pendingOrders = orders.filter(o => o.payment_status === 'pending').length;
  const recentOrders = orders.slice(0, 5);

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

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-serif text-2xl text-gray-900">Dashboard</h1>
          <p className="text-gray-500 text-sm mt-1">Overview of your editorial content</p>
        </div>
        <button
          onClick={() => navigate({ name: 'admin-article-new' })}
          className="inline-flex items-center gap-2 bg-bronze text-white px-4 py-2.5 rounded text-sm font-medium hover:bg-bronze-dark transition-colors"
        >
          <Plus size={16} /> New Article
        </button>
      </div>

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

      {commerceCards.some(c => c.value !== 0) && (
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
    </div>
  );
}
