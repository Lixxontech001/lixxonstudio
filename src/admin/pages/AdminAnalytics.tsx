import { BarChart3, Eye, Heart, MessageSquare, MousePointerClick, TrendingUp } from 'lucide-react';
import { useAdminAnalytics } from '../../hooks/useCommerce';

export default function AdminAnalytics() {
  const { data, loading } = useAdminAnalytics();

  if (loading) {
    return (
      <div>
        <h1 className="font-serif text-3xl text-charcoal font-light mb-8">Content Performance</h1>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <div key={i} className="skeleton h-28 rounded-sm" />)}
        </div>
      </div>
    );
  }

  const stats = [
    { label: 'Total Views', value: data.totalViews, icon: Eye, color: 'text-blue-600' },
    { label: 'Total Likes', value: data.totalLikes, icon: Heart, color: 'text-red-500' },
    { label: 'Comments', value: data.totalComments, icon: MessageSquare, color: 'text-green-600' },
    { label: 'Product Clicks', value: data.totalProductClicks, icon: MousePointerClick, color: 'text-bronze' },
  ];

  return (
    <div>
      <div className="mb-8">
        <h1 className="font-serif text-3xl text-charcoal font-light">Content Performance</h1>
        <p className="text-sm text-charcoal-muted mt-1">First-party analytics for your editorial content</p>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
        {stats.map(stat => {
          const Icon = stat.icon;
          return (
            <div key={stat.label} className="bg-white rounded-sm border border-taupe/30 p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[10px] tracking-editorial uppercase text-charcoal-muted">{stat.label}</span>
                <Icon size={18} strokeWidth={1.5} className={stat.color} />
              </div>
              <p className="font-serif text-3xl text-charcoal font-light">{stat.value.toLocaleString()}</p>
            </div>
          );
        })}
      </div>

      <div className="bg-white rounded-sm border border-taupe/30 p-6">
        <div className="flex items-center gap-3 mb-6">
          <TrendingUp size={18} strokeWidth={1.5} className="text-bronze" />
          <h2 className="font-serif text-xl text-charcoal">Top Articles by Views</h2>
        </div>

        {data.topArticles.length === 0 ? (
          <div className="text-center py-12">
            <BarChart3 size={32} strokeWidth={1.5} className="text-charcoal-muted mx-auto mb-3" />
            <p className="text-charcoal-muted text-sm">No view data yet. Article views are tracked automatically as readers visit your content.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {data.topArticles.map((article, i) => (
              <div key={article.slug} className="flex items-center gap-4 py-3 border-b border-taupe/30 last:border-0">
                <span className="text-xs text-bronze w-6 font-medium">{String(i + 1).padStart(2, '0')}</span>
                <span className="text-sm text-charcoal flex-1 truncate">{article.title}</span>
                <span className="text-sm text-charcoal-muted">{article.views} views</span>
                <div className="w-24 h-2 bg-taupe-light rounded-full overflow-hidden">
                  <div className="h-full bg-bronze rounded-full" style={{ width: `${(article.views / data.topArticles[0].views) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
