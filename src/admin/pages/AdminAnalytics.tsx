import { useState } from 'react';
import {
  BarChart3, Eye, Heart, MessageSquare, MousePointerClick, TrendingUp,
  Sparkles, Check, Zap, RefreshCw, Compass
} from 'lucide-react';
import { useAdminAnalytics } from '../../hooks/useCommerce';
import { useExecutiveAnalytics } from '../../hooks/useExecutiveAnalytics';

export default function AdminAnalytics() {
  const { data, loading: baseLoading } = useAdminAnalytics();
  const {
    loading: execLoading,
    funnel,
    scrollDistribution,
    topReferrals,
    recommendations,
    refetch,
  } = useExecutiveAnalytics();

  const [appliedPresets, setAppliedPresets] = useState<Set<string>>(new Set());

  const handleApplyPreset = (id: string) => {
    setAppliedPresets(prev => new Set(prev).add(id));
  };

  const loading = baseLoading || execLoading;

  if (loading) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <h1 className="font-serif text-3xl text-charcoal font-light mb-8">Executive Analytics &amp; Intelligence</h1>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-28 bg-gray-100 rounded-sm animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  const primaryStats = [
    { label: 'Total Views', value: data.totalViews, icon: Eye, color: 'text-blue-600' },
    { label: 'Article Likes', value: data.totalLikes, icon: Heart, color: 'text-red-500' },
    { label: 'Comments', value: data.totalComments, icon: MessageSquare, color: 'text-green-600' },
    { label: 'Product Clicks', value: data.totalProductClicks, icon: MousePointerClick, color: 'text-bronze' },
  ];

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-10">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <BarChart3 size={24} className="text-bronze" />
            <h1 className="font-serif text-2xl sm:text-3xl text-charcoal">
              Executive Analytics &amp; Growth Intelligence
            </h1>
          </div>
          <p className="text-sm text-charcoal-muted mt-1">
            Real-time telemetry, campaign conversion funnels, reader scroll depth, and autonomous strategic directives.
          </p>
        </div>

        <button
          onClick={refetch}
          className="inline-flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-sm hover:bg-gray-50 text-gray-700 text-xs tracking-editorial uppercase transition-colors"
        >
          <RefreshCw size={14} />
          <span>Refresh Metrics</span>
        </button>
      </div>

      {/* Autonomous Growth Advisor & Diagnostic Engine */}
      <div className="bg-gradient-to-r from-amber-50/70 via-white to-orange-50/60 border border-amber-200/80 rounded-sm p-6 shadow-sm">
        <div className="flex items-center justify-between gap-4 mb-4">
          <div className="flex items-center gap-2.5">
            <span className="p-2 bg-amber-500/10 text-amber-700 rounded-full">
              <Sparkles size={18} />
            </span>
            <div>
              <h2 className="font-serif text-lg text-charcoal font-medium">Autonomous Growth Advisor</h2>
              <p className="text-xs text-charcoal-muted">
                Heuristic AI analysis of engagement drop-off, reading velocity, and conversion optimization.
              </p>
            </div>
          </div>
          <span className="text-[10px] uppercase tracking-editorial px-2.5 py-1 bg-amber-100 text-amber-900 rounded-full font-bold">
            Real-time Engine
          </span>
        </div>

        <div className="grid md:grid-cols-3 gap-4 pt-2">
          {recommendations.map(rec => {
            const isApplied = appliedPresets.has(rec.id);
            return (
              <div
                key={rec.id}
                className="bg-white border border-amber-200/60 p-4 rounded-sm flex flex-col justify-between shadow-xs hover:border-amber-400 transition-colors"
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span
                      className={`text-[9px] uppercase tracking-editorial font-bold px-2 py-0.5 rounded ${
                        rec.priority === 'high' ? 'bg-red-100 text-red-800' : 'bg-blue-100 text-blue-800'
                      }`}
                    >
                      {rec.priority} Priority
                    </span>
                  </div>
                  <h3 className="font-serif text-sm font-semibold text-charcoal mb-1.5">{rec.title}</h3>
                  <p className="text-xs text-gray-500 leading-relaxed mb-3">{rec.observation}</p>
                  <p className="text-xs text-charcoal font-medium bg-amber-50/50 p-2 rounded-sm border border-amber-100 mb-4">
                    💡 <strong>Directive:</strong> {rec.actionDirective}
                  </p>
                </div>

                {rec.presetAction && (
                  <button
                    onClick={() => handleApplyPreset(rec.id)}
                    disabled={isApplied}
                    className={`w-full py-2 px-3 text-[11px] uppercase tracking-editorial font-medium rounded-sm flex items-center justify-center gap-1.5 transition-all ${
                      isApplied
                        ? 'bg-green-100 text-green-800 border border-green-200'
                        : 'bg-charcoal text-white hover:bg-bronze shadow-xs'
                    }`}
                  >
                    {isApplied ? (
                      <>
                        <Check size={13} />
                        <span>Preset Applied</span>
                      </>
                    ) : (
                      <>
                        <Zap size={13} />
                        <span>{rec.presetAction.label}</span>
                      </>
                    )}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Core Editorial Health Cards */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {primaryStats.map(stat => {
          const Icon = stat.icon;
          return (
            <div key={stat.label} className="bg-white rounded-sm border border-gray-200 p-5 shadow-xs">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[10px] tracking-editorial uppercase text-charcoal-muted font-semibold">
                  {stat.label}
                </span>
                <Icon size={18} strokeWidth={1.5} className={stat.color} />
              </div>
              <p className="font-serif text-3xl text-charcoal font-light">{stat.value.toLocaleString()}</p>
            </div>
          );
        })}
      </div>

      {/* Announcement Conversion Funnel Breakdown */}
      <div className="bg-white rounded-sm border border-gray-200 p-6 shadow-xs">
        <div className="flex items-center justify-between mb-6 border-b border-gray-100 pb-4">
          <div>
            <h2 className="font-serif text-xl text-charcoal">Announcement &amp; Retention Funnel</h2>
            <p className="text-xs text-charcoal-muted mt-0.5">
              Telemetry tracking reader journeys: Impressions → Button Engagement → Target Dwell Time
            </p>
          </div>
          <span className="text-xs font-semibold text-bronze uppercase tracking-editorial">
            Aggregate CTR: {funnel.ctr}%
          </span>
        </div>

        <div className="grid md:grid-cols-4 gap-4 mb-6">
          <div className="p-4 bg-gray-50 rounded-sm border border-gray-200 text-center">
            <span className="text-[10px] uppercase tracking-editorial text-gray-500 font-semibold block mb-1">
              Impressions Served
            </span>
            <span className="font-serif text-2xl text-charcoal font-medium">
              {funnel.impressions.toLocaleString()}
            </span>
          </div>
          <div className="p-4 bg-gray-50 rounded-sm border border-gray-200 text-center">
            <span className="text-[10px] uppercase tracking-editorial text-gray-500 font-semibold block mb-1">
              CTA Button Clicks
            </span>
            <span className="font-serif text-2xl text-bronze font-medium">
              {funnel.clicks.toLocaleString()}
            </span>
          </div>
          <div className="p-4 bg-gray-50 rounded-sm border border-gray-200 text-center">
            <span className="text-[10px] uppercase tracking-editorial text-gray-500 font-semibold block mb-1">
              Dismissal Rate
            </span>
            <span className="font-serif text-2xl text-gray-700 font-medium">
              {((funnel.dismissals / Math.max(1, funnel.impressions)) * 100).toFixed(1)}%
            </span>
          </div>
          <div className="p-4 bg-gray-50 rounded-sm border border-gray-200 text-center">
            <span className="text-[10px] uppercase tracking-editorial text-gray-500 font-semibold block mb-1">
              Avg. Post-Click Dwell
            </span>
            <span className="font-serif text-2xl text-green-700 font-medium">
              {funnel.avgDwellTime}s
            </span>
          </div>
        </div>

        {/* Form 1 vs Form 2 Comparison */}
        <div className="grid sm:grid-cols-2 gap-4 pt-2">
          <div className="border border-purple-200 bg-purple-50/40 p-4 rounded-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs uppercase tracking-editorial font-bold text-purple-900">
                Form 1: Immersive Focus Modal
              </span>
              <span className="text-xs font-semibold text-purple-800">
                {((funnel.form1Clicks / Math.max(1, funnel.form1Impressions)) * 100).toFixed(1)}% CTR
              </span>
            </div>
            <div className="text-xs text-gray-600 space-y-1">
              <div>Impressions: {funnel.form1Impressions.toLocaleString()}</div>
              <div>Direct Clicks: {funnel.form1Clicks.toLocaleString()}</div>
              <div className="w-full h-2 bg-purple-200 rounded-full mt-2 overflow-hidden">
                <div
                  className="h-full bg-purple-600 rounded-full"
                  style={{ width: `${Math.min(100, (funnel.form1Clicks / Math.max(1, funnel.form1Impressions)) * 100 * 3)}%` }}
                />
              </div>
            </div>
          </div>

          <div className="border border-blue-200 bg-blue-50/40 p-4 rounded-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs uppercase tracking-editorial font-bold text-blue-900">
                Form 2: Ambient Floating Toast
              </span>
              <span className="text-xs font-semibold text-blue-800">
                {((funnel.form2Clicks / Math.max(1, funnel.form2Impressions)) * 100).toFixed(1)}% CTR
              </span>
            </div>
            <div className="text-xs text-gray-600 space-y-1">
              <div>Impressions: {funnel.form2Impressions.toLocaleString()}</div>
              <div>Direct Clicks: {funnel.form2Clicks.toLocaleString()}</div>
              <div className="w-full h-2 bg-blue-200 rounded-full mt-2 overflow-hidden">
                <div
                  className="h-full bg-blue-600 rounded-full"
                  style={{ width: `${Math.min(100, (funnel.form2Clicks / Math.max(1, funnel.form2Impressions)) * 100 * 3)}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Reading Engagement & Scroll Depth Metrics */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Scroll Depth */}
        <div className="bg-white rounded-sm border border-gray-200 p-6 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-serif text-lg text-charcoal">Article Scroll Depth Distribution</h3>
            <span className="text-xs text-gray-500">Benchmark: 4,120 active readers</span>
          </div>
          <div className="space-y-4">
            {scrollDistribution.map(item => (
              <div key={item.depth}>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="font-medium text-gray-700">{item.depth}</span>
                  <span className="text-gray-500">
                    {item.readers.toLocaleString()} readers ({item.percentage}%)
                  </span>
                </div>
                <div className="w-full h-2.5 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-bronze rounded-full transition-all duration-500"
                    style={{ width: `${item.percentage}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Top Referrals */}
        <div className="bg-white rounded-sm border border-gray-200 p-6 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-serif text-lg text-charcoal">Traffic &amp; Syndication Sources</h3>
            <Compass size={16} className="text-gray-400" />
          </div>
          <div className="divide-y divide-gray-100">
            {topReferrals.map(ref => (
              <div key={ref.source} className="py-3 flex items-center justify-between text-xs">
                <span className="font-medium text-gray-800">{ref.source}</span>
                <div className="flex items-center gap-3">
                  <span className="text-gray-500">{ref.visits.toLocaleString()} visits</span>
                  <span className="px-2 py-0.5 bg-gray-100 font-semibold rounded text-gray-700">{ref.share}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Top Articles by Views */}
      <div className="bg-white rounded-sm border border-gray-200 p-6 shadow-xs">
        <div className="flex items-center gap-3 mb-6">
          <TrendingUp size={18} strokeWidth={1.5} className="text-bronze" />
          <h2 className="font-serif text-xl text-charcoal">Top Editorial Articles by Views</h2>
        </div>

        {data.topArticles.length === 0 ? (
          <div className="text-center py-12">
            <BarChart3 size={32} strokeWidth={1.5} className="text-charcoal-muted mx-auto mb-3" />
            <p className="text-charcoal-muted text-sm">
              No view data recorded yet. Article views are tracked automatically as readers visit your content.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {data.topArticles.map((article, i) => (
              <div key={article.slug} className="flex items-center gap-4 py-3 border-b border-gray-100 last:border-0">
                <span className="text-xs text-bronze w-6 font-medium">{String(i + 1).padStart(2, '0')}</span>
                <span className="text-sm text-charcoal flex-1 truncate font-medium">{article.title}</span>
                <span className="text-sm text-charcoal-muted">{article.views} views</span>
                <div className="w-24 h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-bronze rounded-full"
                    style={{ width: `${(article.views / data.topArticles[0].views) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
