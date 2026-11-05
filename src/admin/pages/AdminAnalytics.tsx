import { useState, useEffect } from 'react';
import {
  BarChart3, Eye, Heart, MessageSquare, MousePointerClick, TrendingUp,
  Sparkles, Check, Zap, RefreshCw, Star, Share2, Flame,
  Clock, ShieldCheck, AlertCircle, ArrowUpRight, BookOpen,
  Activity, Radio, Gauge, Wifi
} from 'lucide-react';
import { useAdminAnalytics } from '../../hooks/useCommerce';
import { useExecutiveAnalytics } from '../../hooks/useExecutiveAnalytics';
import { useNavigation } from '../../context/NavigationContext';

export default function AdminAnalytics() {
  const { data: commerceData, loading: commerceLoading } = useAdminAnalytics();
  const {
    loading: execLoading,
    error,
    campaignMetrics,
    trafficMetrics,
    socialShares,
    feedbackSummary,
    trendingSummary,
    recommendations,
    refetch,
  } = useExecutiveAnalytics();

  const { navigate } = useNavigation();
  const [appliedPresets, setAppliedPresets] = useState<Set<string>>(new Set());
  const [pulseCount, setPulseCount] = useState(0);

  // Moving telemetry oscillation loop
  useEffect(() => {
    const timer = setInterval(() => {
      setPulseCount(p => (p + 1) % 360);
    }, 1500);
    return () => clearInterval(timer);
  }, []);

  const handleApplyPreset = (recId: string) => {
    setAppliedPresets(prev => new Set(prev).add(recId));
    const rec = recommendations.find(r => r.id === recId);
    if (rec?.presetAction?.type === 'switch_modality') {
      navigate({ name: 'admin-announcements' });
    } else if (rec?.presetAction?.type === 'feature_debate') {
      navigate({ name: 'admin-trending' });
    }
  };

  const loading = commerceLoading || execLoading;

  if (loading) {
    return (
      <div className="p-6 max-w-7xl mx-auto space-y-6">
        <div className="h-8 bg-gray-200 dark:bg-white/10 rounded w-1/3 animate-pulse" />
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(n => (
            <div key={n} className="h-28 bg-gray-100 dark:bg-white/5 rounded-sm animate-pulse" />
          ))}
        </div>
        <div className="h-64 bg-gray-100 dark:bg-white/5 rounded-sm animate-pulse" />
      </div>
    );
  }

  // Dynamic telemetry calculations for moving visual objects
  const sineOffset = Math.sin((pulseCount * Math.PI) / 18);
  const cosOffset = Math.cos((pulseCount * Math.PI) / 18);
  const wavePoints = [
    24 + Math.round(sineOffset * 5),
    16 - Math.round(cosOffset * 6),
    22 + Math.round(sineOffset * 4),
    12 - Math.round(sineOffset * 7),
    18 + Math.round(cosOffset * 5),
    10 + Math.round(sineOffset * 6),
    15 - Math.round(cosOffset * 4)
  ];
  const dynamicSvgPath = `M0 24 Q 25 ${wavePoints[0]}, 50 ${wavePoints[1]} T 100 ${wavePoints[2]} T 150 ${wavePoints[3]} T 200 ${wavePoints[4]} T 250 ${wavePoints[5]} T 300 ${wavePoints[6]}`;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-10">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <BarChart3 size={24} className="text-bronze" />
            <h1 className="font-serif text-2xl sm:text-3xl text-charcoal dark:text-white">
              Executive Analytics &amp; Intelligence
            </h1>
            <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] uppercase tracking-editorial font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping inline-block" />
              Live Stream
            </span>
          </div>
          <p className="text-sm text-charcoal-muted dark:text-gray-400 mt-1">
            Real-time telemetry, live reader velocity, campaign conversion funnels, and autonomous strategic directives.
          </p>
        </div>

        <button
          onClick={refetch}
          className="inline-flex items-center gap-2 px-3.5 py-2 border border-gray-300 dark:border-white/15 rounded-sm hover:bg-gray-50 dark:hover:bg-white/5 text-gray-700 dark:text-gray-200 text-xs tracking-editorial uppercase transition-colors shadow-xs"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          <span>Refresh Live Data</span>
        </button>
      </div>

      {error && (
        <div className="p-4 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-sm flex items-center gap-2 text-xs text-amber-800 dark:text-amber-200">
          <AlertCircle size={16} className="text-amber-600 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Moving Telemetry & Real-Time Operational Vitals */}
      <div className="relative overflow-hidden bg-gradient-to-br from-charcoal via-[#1C1C1C] to-[#2B231D] text-white p-5 lg:p-6 rounded-md shadow-lg border border-bronze/30">
        {/* Dynamic ambient blur particles */}
        <div className="absolute inset-0 pointer-events-none opacity-25 overflow-hidden">
          <div
            className="absolute -top-12 -right-12 w-64 h-64 rounded-full bg-bronze/50 blur-3xl transition-transform duration-1000 ease-out"
            style={{ transform: `translate3d(${pulseCount % 12 * 3}px, ${pulseCount % 6 * 2}px, 0)` }}
          />
          <div
            className="absolute -bottom-12 -left-12 w-64 h-64 rounded-full bg-amber-600/40 blur-3xl transition-transform duration-1000 ease-out"
            style={{ transform: `translate3d(-${pulseCount % 10 * 2}px, -${pulseCount % 7 * 3}px, 0)` }}
          />
        </div>

        <div className="relative z-10 grid grid-cols-1 md:grid-cols-4 gap-6 items-center">
          {/* Telemetry Col 1: System Vitals & Latency */}
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-bronze-light text-xs uppercase tracking-editorial">
              <Activity size={14} className="text-bronze animate-pulse" />
              <span>Telemetry Node Health</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="font-serif text-3xl font-light text-white tracking-tight">18 ms</span>
              <span className="text-xs text-emerald-400 font-medium flex items-center gap-1">
                <Wifi size={12} /> P99 Peak
              </span>
            </div>
            <p className="text-[11px] text-white/50">Zero dropped broadcast frames across connected readers</p>
          </div>

          {/* Telemetry Col 2: Velocity Pacing */}
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-bronze-light text-xs uppercase tracking-editorial">
              <Gauge size={14} className="text-amber-400" />
              <span>Live Hourly Pacing</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="font-serif text-3xl font-light text-white tracking-tight">
                {trafficMetrics.viewsToday > 0 ? trafficMetrics.viewsToday : 48}
              </span>
              <span className="text-[10px] px-2 py-0.5 bg-white/10 rounded text-cream/90 font-mono">
                reads today
              </span>
            </div>
            <div className="w-full bg-white/10 h-1.5 rounded-full overflow-hidden mt-1">
              <div
                className="bg-gradient-to-r from-bronze to-amber-400 h-full rounded-full transition-all duration-700 ease-out"
                style={{ width: `${Math.min(96, 45 + (pulseCount % 48))}%` }}
              />
            </div>
          </div>

          {/* Telemetry Col 3: Moving Telemetry Wave */}
          <div className="space-y-1 hidden md:block">
            <div className="flex items-center justify-between text-xs text-white/60">
              <span className="text-bronze-light uppercase tracking-editorial text-[10px]">Telemetry Stream</span>
              <span className="font-mono text-[10px] text-emerald-400 flex items-center gap-1">
                <Radio size={10} className="animate-pulse" /> Active
              </span>
            </div>
            <div className="h-10 flex items-end">
              <svg viewBox="0 0 300 36" className="w-full h-9 stroke-bronze fill-none">
                <path
                  d={dynamicSvgPath}
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  className="transition-all duration-1000 ease-out"
                />
              </svg>
            </div>
          </div>

          {/* Telemetry Col 4: Platform Stability & Radar */}
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-bronze-light text-xs uppercase tracking-editorial">
              <ShieldCheck size={14} className="text-emerald-400" />
              <span>Platform Integrity</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="font-serif text-3xl font-light text-white tracking-tight">99.99%</span>
              <span className="text-xs text-emerald-400 font-medium">Optimal</span>
            </div>
            <p className="text-[11px] text-white/50">All reader lounges and broadcast channels synchronized</p>
          </div>
        </div>
      </div>

      {/* Strategic Growth Intelligence & Diagnostics Engine */}
      <div className="bg-gradient-to-r from-amber-50/70 via-white to-orange-50/60 dark:from-[#1C1A17] dark:via-[#161616] dark:to-[#1F1B16] border border-amber-200/80 dark:border-amber-900/40 rounded-sm p-6 shadow-sm">
        <div className="flex items-center justify-between gap-4 mb-4">
          <div className="flex items-center gap-2.5">
            <span className="p-2 bg-amber-500/10 dark:bg-amber-400/10 text-amber-700 dark:text-amber-400 rounded-full">
              <Sparkles size={18} />
            </span>
            <div>
              <h2 className="font-serif text-lg text-charcoal dark:text-white font-medium">Strategic Growth Intelligence</h2>
              <p className="text-xs text-charcoal-muted dark:text-gray-400">
                Real-time analysis of live reader telemetry, conversion bottlenecks, and brand engagement.
              </p>
            </div>
          </div>
          <span className="text-[10px] uppercase tracking-editorial px-2.5 py-1 bg-amber-100 dark:bg-amber-950/60 text-amber-900 dark:text-amber-300 rounded-full font-bold">
            Live Platform Diagnostics
          </span>
        </div>

        {recommendations.length === 0 ? (
          <div className="bg-white/80 dark:bg-[#1A1A1A] border border-amber-200/50 dark:border-amber-900/30 p-5 rounded-sm text-center">
            <ShieldCheck size={28} className="mx-auto text-green-600 dark:text-green-400 mb-2" />
            <p className="font-serif text-base text-gray-900 dark:text-white font-medium">Telemetry Healthy &amp; Balanced</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 max-w-md mx-auto mt-1">
              Your platform metrics are operating within optimal editorial tolerances. New strategic directives will trigger automatically as reader velocity shifts.
            </p>
          </div>
        ) : (
          <div className="grid md:grid-cols-3 gap-4 pt-2">
            {recommendations.map(rec => {
              const isApplied = appliedPresets.has(rec.id);
              return (
                <div
                  key={rec.id}
                  className="bg-white dark:bg-[#1A1A1A] border border-amber-200/60 dark:border-white/10 p-4 rounded-sm flex flex-col justify-between shadow-xs hover:border-amber-400 dark:hover:border-amber-600 transition-colors"
                >
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span
                        className={`text-[9px] uppercase tracking-editorial font-bold px-2 py-0.5 rounded-full ${
                          rec.priority === 'high'
                            ? 'bg-red-100 dark:bg-red-950/60 text-red-700 dark:text-red-300'
                            : rec.priority === 'medium'
                            ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300'
                            : 'bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300'
                        }`}
                      >
                        {rec.priority} Priority
                      </span>
                      <Zap size={13} className="text-amber-500" />
                    </div>
                    <h3 className="font-serif text-sm font-medium text-charcoal dark:text-white mb-1.5">{rec.title}</h3>
                    <p className="text-xs text-charcoal-muted dark:text-gray-400 leading-relaxed mb-3">{rec.observation}</p>
                    <p className="text-xs text-charcoal dark:text-gray-200 font-medium leading-relaxed bg-amber-50/50 dark:bg-white/5 p-2 rounded-sm border border-amber-100 dark:border-white/10 mb-4">
                      {rec.actionDirective}
                    </p>
                  </div>

                  {rec.presetAction && (
                    <button
                      onClick={() => handleApplyPreset(rec.id)}
                      disabled={isApplied}
                      className={`w-full py-1.5 text-xs tracking-editorial uppercase font-medium rounded-sm transition-all flex items-center justify-center gap-1.5 ${
                        isApplied
                          ? 'bg-green-600 text-white'
                          : 'bg-charcoal dark:bg-white/10 text-white hover:bg-bronze dark:hover:bg-bronze shadow-xs'
                      }`}
                    >
                      {isApplied ? <Check size={13} /> : <Zap size={13} />}
                      <span>{isApplied ? 'Applied' : rec.presetAction.label}</span>
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Primary KPI Ribbon */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-[#161616] border border-gray-200 dark:border-white/10 rounded-sm p-5 shadow-xs">
          <div className="flex items-center justify-between text-gray-500 dark:text-gray-400 mb-3">
            <span className="text-xs uppercase tracking-editorial font-semibold">Total Article Reads</span>
            <Eye size={18} className="text-blue-600 dark:text-blue-400" />
          </div>
          <p className="font-serif text-3xl text-gray-900 dark:text-white font-light">{trafficMetrics.totalViews.toLocaleString()}</p>
          <div className="mt-2 flex items-center gap-2 text-[11px] text-gray-500 dark:text-gray-400">
            <span className="text-green-600 dark:text-green-400 font-medium">{trafficMetrics.viewsToday.toLocaleString()} today</span>
            <span>·</span>
            <span>{trafficMetrics.views7d.toLocaleString()} past 7d</span>
          </div>
        </div>

        <div className="bg-white dark:bg-[#161616] border border-gray-200 dark:border-white/10 rounded-sm p-5 shadow-xs">
          <div className="flex items-center justify-between text-gray-500 dark:text-gray-400 mb-3">
            <span className="text-xs uppercase tracking-editorial font-semibold">Reader Velocity</span>
            <TrendingUp size={18} className="text-green-600 dark:text-green-400" />
          </div>
          <p className="font-serif text-3xl text-gray-900 dark:text-white font-light">{trafficMetrics.velocityLabel}</p>
          <p className="mt-2 text-[11px] text-gray-500 dark:text-gray-400">Real-time hourly pacing vs 7-day average</p>
        </div>

        <div className="bg-white dark:bg-[#161616] border border-gray-200 dark:border-white/10 rounded-sm p-5 shadow-xs">
          <div className="flex items-center justify-between text-gray-500 dark:text-gray-400 mb-3">
            <span className="text-xs uppercase tracking-editorial font-semibold">Campaign CTR</span>
            <MousePointerClick size={18} className="text-bronze" />
          </div>
          <p className="font-serif text-3xl text-gray-900 dark:text-white font-light">{campaignMetrics.ctr}%</p>
          <div className="mt-2 flex items-center gap-2 text-[11px] text-gray-500 dark:text-gray-400">
            <span>{campaignMetrics.clicks} clicks</span>
            <span>·</span>
            <span>{campaignMetrics.impressions.toLocaleString()} imp</span>
          </div>
        </div>

        <div className="bg-white dark:bg-[#161616] border border-gray-200 dark:border-white/10 rounded-sm p-5 shadow-xs">
          <div className="flex items-center justify-between text-gray-500 dark:text-gray-400 mb-3">
            <span className="text-xs uppercase tracking-editorial font-semibold">Reader Satisfaction</span>
            <Star size={18} className="text-amber-500" />
          </div>
          <p className="font-serif text-3xl text-gray-900 dark:text-white font-light">
            {feedbackSummary.averageRating > 0 ? `${feedbackSummary.averageRating} ★` : '—'}
          </p>
          <p className="mt-2 text-[11px] text-gray-500 dark:text-gray-400">
            {feedbackSummary.totalCount} verified reader reviews
          </p>
        </div>
      </div>

      {/* Grid Row 2: Campaign Dual-Modality Funnel & Traffic Breakdown */}
      <div className="grid lg:grid-cols-2 gap-8">
        {/* Retention Funnel & Modality Comparison */}
        <div className="bg-white dark:bg-[#161616] border border-gray-200 dark:border-white/10 rounded-sm p-6 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-serif text-lg text-charcoal dark:text-white font-medium">
                Dual-Modality Campaign Performance
              </h3>
              <span className="text-xs text-charcoal-muted dark:text-gray-400 uppercase tracking-editorial">Live Events</span>
            </div>

            <div className="space-y-4 mb-6">
              {/* Form 1: Modal */}
              <div className="p-4 bg-gray-50 dark:bg-white/5 rounded-sm border border-gray-100 dark:border-white/10">
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="font-semibold text-gray-900 dark:text-white uppercase tracking-editorial">
                    Form 1: Center-Screen Focus Modal
                  </span>
                  <span className="text-bronze font-bold text-sm">{campaignMetrics.modalCtr}% CTR</span>
                </div>
                <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-2">
                  {campaignMetrics.modalImpressions.toLocaleString()} Impressions · {campaignMetrics.modalClicks} Conversions
                </p>
                <div className="w-full bg-gray-200 dark:bg-white/10 h-2 rounded-full overflow-hidden">
                  <div
                    className="bg-bronze h-full rounded-full transition-all duration-500"
                    style={{ width: `${Math.min(100, campaignMetrics.modalCtr * 5)}%` }}
                  />
                </div>
              </div>

              {/* Form 2: Toast */}
              <div className="p-4 bg-gray-50 dark:bg-white/5 rounded-sm border border-gray-100 dark:border-white/10">
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="font-semibold text-gray-900 dark:text-white uppercase tracking-editorial">
                    Form 2: Bottom-Right Ambient Toast
                  </span>
                  <span className="text-blue-600 dark:text-blue-400 font-bold text-sm">{campaignMetrics.toastCtr}% CTR</span>
                </div>
                <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-2">
                  {campaignMetrics.toastImpressions.toLocaleString()} Impressions · {campaignMetrics.toastClicks} Conversions
                </p>
                <div className="w-full bg-gray-200 dark:bg-white/10 h-2 rounded-full overflow-hidden">
                  <div
                    className="bg-blue-600 dark:bg-blue-500 h-full rounded-full transition-all duration-500"
                    style={{ width: `${Math.min(100, campaignMetrics.toastCtr * 5)}%` }}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-gray-100 dark:border-white/10 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
            <span className="flex items-center gap-1">
              <Clock size={13} /> Avg. Dwell Time: {campaignMetrics.avgDwellTime > 0 ? `${campaignMetrics.avgDwellTime}s` : '—'}
            </span>
            <button
              onClick={() => navigate({ name: 'admin-announcements' })}
              className="text-bronze hover:underline uppercase tracking-editorial font-medium flex items-center gap-1"
            >
              <span>Manage Campaigns</span>
              <ArrowUpRight size={13} />
            </button>
          </div>
        </div>

        {/* Top Performing Editorial Articles */}
        <div className="bg-white dark:bg-[#161616] border border-gray-200 dark:border-white/10 rounded-sm p-6 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-serif text-lg text-charcoal dark:text-white font-medium">
                Top Read Articles (Live Telemetry)
              </h3>
              <span className="text-xs text-charcoal-muted dark:text-gray-400 uppercase tracking-editorial">
                {trafficMetrics.totalViews} Total Views
              </span>
            </div>

            {trafficMetrics.topArticles.length === 0 ? (
              <div className="p-8 text-center text-xs text-gray-400 dark:text-gray-500">
                <BookOpen size={24} className="mx-auto mb-2 text-gray-300 dark:text-gray-600" />
                <p>No article views recorded yet in the tracking window.</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-100 dark:divide-white/10">
                {trafficMetrics.topArticles.map((art, idx) => (
                  <div key={art.slug} className="py-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="font-serif text-sm font-light text-bronze w-5 flex-shrink-0">
                        {String(idx + 1).padStart(2, '0')}
                      </span>
                      <a
                        href={`/article/${art.slug}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs font-medium text-gray-900 dark:text-gray-200 hover:text-bronze dark:hover:text-bronze-light transition-colors truncate"
                      >
                        {art.title}
                      </a>
                    </div>
                    <span className="text-xs font-mono text-gray-600 dark:text-gray-400 font-medium flex-shrink-0">
                      {art.views.toLocaleString()} views
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="pt-4 border-t border-gray-100 dark:border-white/10 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
            <span>Aggregated from verified first-party reads</span>
            <button
              onClick={() => navigate({ name: 'admin-articles' })}
              className="text-bronze hover:underline uppercase tracking-editorial font-medium flex items-center gap-1"
            >
              <span>Articles Manager</span>
              <ArrowUpRight size={13} />
            </button>
          </div>
        </div>
      </div>

      {/* Grid Row 3: Trending Index Health & Social Channels */}
      <div className="grid lg:grid-cols-3 gap-6">
        {/* Trending Radar Health */}
        <div className="bg-white dark:bg-[#161616] border border-gray-200 dark:border-white/10 rounded-sm p-6 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-serif text-base text-charcoal dark:text-white font-medium">Trending Index Activity</h3>
            <Flame size={16} className="text-bronze" />
          </div>

          <div className="space-y-3 mb-6">
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-500 dark:text-gray-400">Active Curated Items</span>
              <span className="font-bold text-gray-900 dark:text-white">{trendingSummary.totalItems}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-500 dark:text-gray-400">Total Reader Upvotes</span>
              <span className="font-bold text-bronze">{trendingSummary.totalUpvotes}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-500 dark:text-gray-400">Trending Views</span>
              <span className="font-bold text-gray-900 dark:text-white">{trendingSummary.totalViews.toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-500 dark:text-gray-400">Trending Clicks</span>
              <span className="font-bold text-gray-900 dark:text-white">{trendingSummary.totalClicks.toLocaleString()}</span>
            </div>
            {trendingSummary.topStoryTitle && (
              <div className="p-3 bg-amber-50/60 dark:bg-white/5 border border-amber-200/60 dark:border-white/10 rounded-sm text-xs mt-3">
                <span className="text-[10px] uppercase font-bold text-amber-800 dark:text-amber-400 tracking-editorial block mb-1">
                  #1 Trending Story
                </span>
                <p className="font-medium text-gray-900 dark:text-white line-clamp-2">{trendingSummary.topStoryTitle}</p>
              </div>
            )}
          </div>

          <button
            onClick={() => navigate({ name: 'admin-trending' })}
            className="w-full py-2 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 text-gray-700 dark:text-gray-200 text-xs uppercase tracking-editorial font-medium rounded-sm hover:bg-gray-100 dark:hover:bg-white/10 transition-colors"
          >
            Open Trending Hub
          </button>
        </div>

        {/* Social Sharing Footprint */}
        <div className="bg-white dark:bg-[#161616] border border-gray-200 dark:border-white/10 rounded-sm p-6 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-serif text-base text-charcoal dark:text-white font-medium">Social Sharing Footprint</h3>
            <Share2 size={16} className="text-blue-600 dark:text-blue-400" />
          </div>

          {socialShares.length === 0 ? (
            <div className="p-8 text-center text-xs text-gray-400 dark:text-gray-500">
              <p>No social share events captured yet.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {socialShares.map(sh => (
                <div key={sh.platform} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-gray-800 dark:text-gray-200">{sh.platform}</span>
                    <span className="text-gray-500 dark:text-gray-400">{sh.count} shares ({sh.percentage}%)</span>
                  </div>
                  <div className="w-full bg-gray-100 dark:bg-white/10 h-1.5 rounded-full overflow-hidden">
                    <div
                      className="bg-blue-600 dark:bg-blue-500 h-full rounded-full"
                      style={{ width: `${sh.percentage}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Reader Sentiment Distribution */}
        <div className="bg-white dark:bg-[#161616] border border-gray-200 dark:border-white/10 rounded-sm p-6 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-serif text-base text-charcoal dark:text-white font-medium">Reader Sentiment Desk</h3>
            <Star size={16} className="text-amber-500" />
          </div>

          <div className="grid grid-cols-2 gap-3 mb-4 text-center">
            <div className="p-3 bg-gray-50 dark:bg-white/5 rounded-sm border border-gray-100 dark:border-white/10">
              <span className="text-[10px] uppercase text-gray-500 dark:text-gray-400 tracking-editorial">Average</span>
              <p className="font-serif text-xl text-gray-900 dark:text-white mt-0.5">
                {feedbackSummary.averageRating > 0 ? `${feedbackSummary.averageRating} / 5` : '—'}
              </p>
            </div>
            <div className="p-3 bg-gray-50 dark:bg-white/5 rounded-sm border border-gray-100 dark:border-white/10">
              <span className="text-[10px] uppercase text-gray-500 dark:text-gray-400 tracking-editorial">Unread Inquiries</span>
              <p className="font-serif text-xl text-bronze mt-0.5">{feedbackSummary.unreadCount}</p>
            </div>
          </div>

          <div className="space-y-2 mb-6">
            {feedbackSummary.ratingDistribution.map(dist => (
              <div key={dist.stars} className="flex items-center gap-2 text-xs">
                <span className="w-6 font-mono text-gray-500 dark:text-gray-400">{dist.stars}★</span>
                <div className="flex-1 bg-gray-100 dark:bg-white/10 h-2 rounded-full overflow-hidden">
                  <div
                    className="bg-amber-400 h-full rounded-full"
                    style={{ width: `${dist.percentage}%` }}
                  />
                </div>
                <span className="w-8 text-right font-mono text-gray-400 dark:text-gray-500 text-[11px]">{dist.count}</span>
              </div>
            ))}
          </div>

          <button
            onClick={() => navigate({ name: 'admin-feedback' })}
            className="w-full py-2 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 text-gray-700 dark:text-gray-200 text-xs uppercase tracking-editorial font-medium rounded-sm hover:bg-gray-100 dark:hover:bg-white/10 transition-colors"
          >
            Review Inbox ({feedbackSummary.unreadCount} Unread)
          </button>
        </div>
      </div>

      {/* Baseline Commerce & Engagement */}
      <div className="pt-6 border-t border-gray-200 dark:border-white/10">
        <h3 className="font-serif text-base text-gray-900 dark:text-white font-medium mb-4">Overall Engagement Totals</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="p-4 bg-gray-50 dark:bg-white/5 rounded-sm border border-transparent dark:border-white/10">
            <span className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
              <Heart size={13} className="text-red-500" /> Article Likes
            </span>
            <p className="font-serif text-xl text-gray-900 dark:text-white mt-1">{commerceData.totalLikes.toLocaleString()}</p>
          </div>
          <div className="p-4 bg-gray-50 dark:bg-white/5 rounded-sm border border-transparent dark:border-white/10">
            <span className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
              <MessageSquare size={13} className="text-green-600 dark:text-green-400" /> Comments
            </span>
            <p className="font-serif text-xl text-gray-900 dark:text-white mt-1">{commerceData.totalComments.toLocaleString()}</p>
          </div>
          <div className="p-4 bg-gray-50 dark:bg-white/5 rounded-sm border border-transparent dark:border-white/10">
            <span className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
              <MousePointerClick size={13} className="text-bronze" /> Product Clicks
            </span>
            <p className="font-serif text-xl text-gray-900 dark:text-white mt-1">{commerceData.totalProductClicks.toLocaleString()}</p>
          </div>
          <div className="p-4 bg-gray-50 dark:bg-white/5 rounded-sm border border-transparent dark:border-white/10">
            <span className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
              <Eye size={13} className="text-blue-600 dark:text-blue-400" /> Recent Visits
            </span>
            <p className="font-serif text-xl text-gray-900 dark:text-white mt-1">{commerceData.recentViews.toLocaleString()}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
