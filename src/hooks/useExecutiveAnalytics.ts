import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';

export interface CampaignMetrics {
  impressions: number;
  clicks: number;
  dismissals: number;
  ctr: number;
  avgDwellTime: number;
  modalImpressions: number;
  modalClicks: number;
  modalCtr: number;
  toastImpressions: number;
  toastClicks: number;
  toastCtr: number;
}

export interface TrafficMetrics {
  totalViews: number;
  viewsToday: number;
  views7d: number;
  views30d: number;
  velocityLabel: string;
  topArticles: { title: string; slug: string; views: number }[];
}

export interface ShareBreakdown {
  platform: string;
  count: number;
  percentage: number;
}

export interface FeedbackSummary {
  totalCount: number;
  averageRating: number;
  unreadCount: number;
  praiseCount: number;
  bugCount: number;
  ideaCount: number;
  questionCount: number;
  ratingDistribution: { stars: number; count: number; percentage: number }[];
}

export interface TrendingSummary {
  totalItems: number;
  totalUpvotes: number;
  totalViews: number;
  totalClicks: number;
  topStoryTitle: string | null;
  categoryBreakdown: { category: string; count: number }[];
}

export interface GrowthRecommendation {
  id: string;
  priority: 'high' | 'medium' | 'low';
  title: string;
  observation: string;
  actionDirective: string;
  presetAction?: {
    type: 'switch_modality' | 'adjust_trigger' | 'feature_debate';
    label: string;
  };
}

export function useExecutiveAnalytics() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [campaignMetrics, setCampaignMetrics] = useState<CampaignMetrics>({
    impressions: 0,
    clicks: 0,
    dismissals: 0,
    ctr: 0,
    avgDwellTime: 0,
    modalImpressions: 0,
    modalClicks: 0,
    modalCtr: 0,
    toastImpressions: 0,
    toastClicks: 0,
    toastCtr: 0,
  });

  const [trafficMetrics, setTrafficMetrics] = useState<TrafficMetrics>({
    totalViews: 0,
    viewsToday: 0,
    views7d: 0,
    views30d: 0,
    velocityLabel: 'Stable',
    topArticles: [],
  });

  const [socialShares, setSocialShares] = useState<ShareBreakdown[]>([]);
  const [feedbackSummary, setFeedbackSummary] = useState<FeedbackSummary>({
    totalCount: 0,
    averageRating: 0,
    unreadCount: 0,
    praiseCount: 0,
    bugCount: 0,
    ideaCount: 0,
    questionCount: 0,
    ratingDistribution: [],
  });

  const [trendingSummary, setTrendingSummary] = useState<TrendingSummary>({
    totalItems: 0,
    totalUpvotes: 0,
    totalViews: 0,
    totalClicks: 0,
    topStoryTitle: null,
    categoryBreakdown: [],
  });

  const [recommendations, setRecommendations] = useState<GrowthRecommendation[]>([]);

  const fetchRealAnalytics = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const now = new Date();
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

      // Parallel queries across real database tables
      const [
        announcementEventsRes,
        articleViewsTotalRes,
        articleViewsTodayRes,
        articleViews7dRes,
        articleViews30dRes,
        topViewsRes,
        socialSharesRes,
        feedbackRes,
        trendingRes,
      ] = await Promise.all([
        // 1. Announcement Events
        supabase.from('announcement_events').select('event_type, form_type, dwell_seconds').limit(2000),

        // 2. Article Views (Counts & Time Windows)
        supabase.from('article_views').select('*', { count: 'exact', head: true }),
        supabase.from('article_views').select('*', { count: 'exact', head: true }).gte('created_at', oneDayAgo),
        supabase.from('article_views').select('*', { count: 'exact', head: true }).gte('created_at', sevenDaysAgo),
        supabase.from('article_views').select('*', { count: 'exact', head: true }).gte('created_at', thirtyDaysAgo),

        // 3. Top Viewed Articles
        supabase.from('article_views').select('post_id, post:posts(title, slug)').order('created_at', { ascending: false }).limit(600),

        // 4. Social Shares by Platform
        supabase.from('social_shares').select('platform, created_at').limit(1000),

        // 5. Site Feedback
        supabase.from('site_feedback').select('category, rating, status, created_at').limit(1000),

        // 6. Trending Items
        supabase.from('trending_items').select('title, category, upvotes, views_count, clicks_count, is_pinned, is_archived').eq('is_archived', false),
      ]);

      // --- Process Announcement Events ---
      const events = announcementEventsRes.data || [];
      let impressions = 0;
      let clicks = 0;
      let dismissals = 0;
      let dwellSum = 0;
      let dwellCount = 0;
      let modalImp = 0;
      let modalClk = 0;
      let toastImp = 0;
      let toastClk = 0;

      for (const ev of events) {
        if (ev.event_type === 'impression') {
          impressions++;
          if (ev.form_type === 'modal') modalImp++;
          else toastImp++;
        } else if (ev.event_type === 'click_button1' || ev.event_type === 'click_button2') {
          clicks++;
          if (ev.form_type === 'modal') modalClk++;
          else toastClk++;
          if (ev.dwell_seconds && ev.dwell_seconds > 0) {
            dwellSum += ev.dwell_seconds;
            dwellCount++;
          }
        } else if (ev.event_type === 'dismiss') {
          dismissals++;
        }
      }

      const totalCtr = impressions > 0 ? Number(((clicks / impressions) * 100).toFixed(1)) : 0;
      const modalCtr = modalImp > 0 ? Number(((modalClk / modalImp) * 100).toFixed(1)) : 0;
      const toastCtr = toastImp > 0 ? Number(((toastClk / toastImp) * 100).toFixed(1)) : 0;
      const avgDwellTime = dwellCount > 0 ? Math.round(dwellSum / dwellCount) : 0;

      const computedCampaign: CampaignMetrics = {
        impressions,
        clicks,
        dismissals,
        ctr: totalCtr,
        avgDwellTime,
        modalImpressions: modalImp,
        modalClicks: modalClk,
        modalCtr,
        toastImpressions: toastImp,
        toastClicks: toastClk,
        toastCtr,
      };
      setCampaignMetrics(computedCampaign);

      // --- Process Traffic Metrics ---
      const totalViews = articleViewsTotalRes.count || 0;
      const viewsToday = articleViewsTodayRes.count || 0;
      const views7d = articleViews7dRes.count || 0;
      const views30d = articleViews30dRes.count || 0;

      // Calculate velocity label
      const avgDaily7d = views7d / 7;
      let velocityLabel = 'Steady';
      if (viewsToday > avgDaily7d * 1.4 && viewsToday > 5) {
        velocityLabel = 'Surging (+40%)';
      } else if (viewsToday < avgDaily7d * 0.7 && avgDaily7d > 5) {
        velocityLabel = 'Moderating';
      } else if (viewsToday > 0) {
        velocityLabel = 'Active';
      } else {
        velocityLabel = 'Awaiting Visits';
      }

      // Top Articles calculation
      interface RawViewRow {
        post_id: string;
        post?: { title: string; slug: string } | null;
      }
      const rawTop = (topViewsRes.data || []) as unknown as RawViewRow[];
      const viewMap = new Map<string, { title: string; slug: string; views: number }>();
      rawTop.forEach(r => {
        if (!r.post_id || !r.post) return;
        const exist = viewMap.get(r.post_id);
        if (exist) {
          exist.views++;
        } else {
          viewMap.set(r.post_id, { title: r.post.title, slug: r.post.slug, views: 1 });
        }
      });
      const topArticles = Array.from(viewMap.values())
        .sort((a, b) => b.views - a.views)
        .slice(0, 5);

      setTrafficMetrics({
        totalViews,
        viewsToday,
        views7d,
        views30d,
        velocityLabel,
        topArticles,
      });

      // --- Process Social Shares ---
      const shares = socialSharesRes.data || [];
      const platformMap = new Map<string, number>();
      shares.forEach(s => {
        const plat = (s.platform || 'direct').toLowerCase();
        platformMap.set(plat, (platformMap.get(plat) || 0) + 1);
      });
      const totalSharesCount = shares.length;
      const shareBreakdown: ShareBreakdown[] = Array.from(platformMap.entries())
        .map(([platform, count]) => ({
          platform: platform.charAt(0).toUpperCase() + platform.slice(1),
          count,
          percentage: totalSharesCount > 0 ? Number(((count / totalSharesCount) * 100).toFixed(1)) : 0,
        }))
        .sort((a, b) => b.count - a.count);

      setSocialShares(shareBreakdown);

      // --- Process Site Feedback ---
      const fbList = feedbackRes.data || [];
      let totalRatingSum = 0;
      let ratedCount = 0;
      let unread = 0;
      let praise = 0;
      let bug = 0;
      let idea = 0;
      let question = 0;
      const starCounts = [0, 0, 0, 0, 0]; // 1 to 5 stars

      for (const fb of fbList) {
        if (fb.status === 'unread') unread++;
        if (fb.category === 'praise') praise++;
        else if (fb.category === 'bug') bug++;
        else if (fb.category === 'idea') idea++;
        else if (fb.category === 'question') question++;

        if (fb.rating && fb.rating >= 1 && fb.rating <= 5) {
          totalRatingSum += fb.rating;
          ratedCount++;
          starCounts[fb.rating - 1]++;
        }
      }

      const averageRating = ratedCount > 0 ? Number((totalRatingSum / ratedCount).toFixed(1)) : 0;
      const ratingDistribution = [5, 4, 3, 2, 1].map(stars => ({
        stars,
        count: starCounts[stars - 1],
        percentage: ratedCount > 0 ? Number(((starCounts[stars - 1] / ratedCount) * 100).toFixed(1)) : 0,
      }));

      setFeedbackSummary({
        totalCount: fbList.length,
        averageRating,
        unreadCount: unread,
        praiseCount: praise,
        bugCount: bug,
        ideaCount: idea,
        questionCount: question,
        ratingDistribution,
      });

      // --- Process Trending Items ---
      const trends = trendingRes.data || [];
      let tUpvotes = 0;
      let tViews = 0;
      let tClicks = 0;
      const catCountMap = new Map<string, number>();
      let topStory: string | null = null;
      let maxEngagement = -1;

      for (const t of trends) {
        tUpvotes += t.upvotes || 0;
        tViews += t.views_count || 0;
        tClicks += t.clicks_count || 0;
        const cat = t.category || 'others';
        catCountMap.set(cat, (catCountMap.get(cat) || 0) + 1);

        const score = (t.upvotes || 0) * 3 + (t.clicks_count || 0) * 2 + (t.views_count || 0);
        if (score > maxEngagement) {
          maxEngagement = score;
          topStory = t.title;
        }
      }

      const catBreakdown = Array.from(catCountMap.entries()).map(([category, count]) => ({
        category: category.charAt(0).toUpperCase() + category.slice(1),
        count,
      }));

      setTrendingSummary({
        totalItems: trends.length,
        totalUpvotes: tUpvotes,
        totalViews: tViews,
        totalClicks: tClicks,
        topStoryTitle: topStory,
        categoryBreakdown: catBreakdown,
      });

      // --- Generate Real Heuristic AI Recommendations ---
      const generatedRecs: GrowthRecommendation[] = [];

      // 1. Modality CTR comparison
      if (modalImp > 10 && toastImp > 10) {
        if (toastCtr > modalCtr * 1.25) {
          generatedRecs.push({
            id: 'rec_toast_preference',
            priority: 'high',
            title: 'Ambient Toast Outperforming Modal',
            observation: `Toast CTR (${toastCtr}%) is higher than Modal CTR (${modalCtr}%). Readers prefer ambient engagement.`,
            actionDirective: 'Transition primary lead campaigns to ambient toast modality to maximize reader retention.',
            presetAction: {
              type: 'switch_modality',
              label: 'Default to Toast Modality',
            },
          });
        } else if (modalCtr > toastCtr * 1.25) {
          generatedRecs.push({
            id: 'rec_modal_lead',
            priority: 'medium',
            title: 'High-Impact Focus Modal Dominance',
            observation: `Modal CTR (${modalCtr}%) exceeds Toast CTR (${toastCtr}%). Readers are converting on center-screen announcements.`,
            actionDirective: 'Deploy center-screen focus modals for high-priority editorial dispatches and seasonal capsules.',
          });
        }
      } else if (impressions === 0) {
        generatedRecs.push({
          id: 'rec_no_campaigns',
          priority: 'high',
          title: 'No Announcement Campaign Telemetry',
          observation: 'Zero announcement impressions have been recorded in the active period.',
          actionDirective: 'Activate a campaign in Admin → Announcements to engage readers and test retention formats.',
        });
      }

      // 2. Feedback Sentiment Alert
      if (feedbackRes.data && feedbackRes.data.length > 0) {
        if (averageRating > 0 && averageRating < 4.0) {
          generatedRecs.push({
            id: 'rec_rating_alert',
            priority: 'high',
            title: 'Reader Satisfaction Optimization',
            observation: `Average reader satisfaction rating is currently ${averageRating}/5.0 based on ${ratedCount} reviews.`,
            actionDirective: 'Inspect the Feedback Inbox for recurring user concerns or bug reports to protect brand sentiment.',
          });
        }
        if (unread > 0) {
          generatedRecs.push({
            id: 'rec_unread_feedback',
            priority: 'medium',
            title: `${unread} Unread Reader Inquiry in Inbox`,
            observation: 'Readers have submitted actionable feedback that has not yet been reviewed or resolved.',
            actionDirective: 'Review submissions in Admin → Feedback Inbox and use the direct reply shortcut.',
          });
        }
      }

      // 3. Trending Coverage
      if (trends.length === 0) {
        generatedRecs.push({
          id: 'rec_feature_trending',
          priority: 'medium',
          title: 'Curate Pinned Lead Story in Trending Hub',
          observation: 'No custom editorial articles are currently curated in the Trending Index.',
          actionDirective: 'Select high-performing published articles in Admin → Trending Hub to establish the #01 Hero showcase.',
        });
      } else {
        const hasPinned = trends.some(t => t.is_pinned);
        if (!hasPinned) {
          generatedRecs.push({
            id: 'rec_pin_hero',
            priority: 'medium',
            title: 'Pin Lead #01 Trending Story',
            observation: 'The Trending Index has curated items but none are explicitly pinned as the #01 Hero Showcase.',
            actionDirective: 'Pin your top editorial story in Admin → Trending Hub to elevate homepage and hub presence.',
          });
        }
      }

      // 4. Traffic Velocity directive
      if (viewsToday > 0 && views7d > 0) {
        generatedRecs.push({
          id: 'rec_traffic_momentum',
          priority: 'low',
          title: `Traffic Velocity: ${velocityLabel}`,
          observation: `${viewsToday.toLocaleString()} views today across published articles (${views7d.toLocaleString()} over 7 days).`,
          actionDirective: 'Leverage traffic momentum by scheduling fresh editorial content in the queue.',
        });
      }

      setRecommendations(generatedRecs);
    } catch (err: unknown) {
      console.error('[useExecutiveAnalytics] Error loading real telemetry:', err);
      setError(err instanceof Error ? err.message : 'Failed to load executive analytics');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRealAnalytics();
  }, [fetchRealAnalytics]);

  return {
    loading,
    error,
    campaignMetrics,
    trafficMetrics,
    socialShares,
    feedbackSummary,
    trendingSummary,
    recommendations,
    refetch: fetchRealAnalytics,
  };
}
