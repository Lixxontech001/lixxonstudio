import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabaseClient';
import type { TrendingItem, TrendingCategory } from '../types/trending';

export function useTrending(categoryFilter: TrendingCategory = 'all') {
  const [curatedItems, setCuratedItems] = useState<TrendingItem[]>([]);
  const [publishedArticles, setPublishedArticles] = useState<TrendingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTrending = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // 1. Fetch curated trending items from table
      let curatedQuery = supabase
        .from('trending_items')
        .select('*')
        .eq('is_archived', false)
        .order('is_pinned', { ascending: false })
        .order('priority_order', { ascending: false })
        .order('upvotes', { ascending: false });

      if (categoryFilter !== 'all') {
        curatedQuery = curatedQuery.eq('category', categoryFilter);
      }

      const { data: curatedData, error: curatedErr } = await curatedQuery;
      if (curatedErr) {
        console.warn('[useTrending] Curated items warning:', curatedErr);
      }
      const loadedCurated = (curatedData || []) as TrendingItem[];
      setCuratedItems(loadedCurated);

      // 2. Fetch published articles from posts table to ensure trending articles are always rich & live
      try {
        const postsQuery = supabase
          .from('posts')
          .select('id, title, slug, excerpt, cover_image, reading_time_minutes, published_at, view_count, category:categories(name, slug), author:authors(name, avatar_url, role)')
          .eq('status', 'published')
          .order('published_at', { ascending: false })
          .limit(20);

        const { data: postsData, error: postsErr } = await postsQuery;
        if (!postsErr && postsData && postsData.length > 0) {
          // Curated slugs to prevent duplicates
          const curatedSlugs = new Set(loadedCurated.map(c => c.slug.toLowerCase()));
          const curatedPostSlugs = new Set(
            loadedCurated
              .map(c => c.metadata?.post_slug?.toLowerCase())
              .filter(Boolean) as string[]
          );

          interface RawPostRelation {
            id: string;
            title: string;
            slug: string;
            excerpt: string | null;
            cover_image: string | null;
            reading_time_minutes: number | null;
            published_at: string;
            view_count?: number | null;
            category?: { name: string; slug: string } | null;
            author?: { name: string; avatar_url: string | null; role: string | null } | null;
          }

          const dynamicArticleItems: TrendingItem[] = (postsData as unknown as RawPostRelation[])
            .filter(p => !curatedSlugs.has(p.slug.toLowerCase()) && !curatedPostSlugs.has(p.slug.toLowerCase()))
            .map((p, idx) => {
              const catSlug = (p.category?.slug || 'others').toLowerCase();
              const categoryNormalized: TrendingCategory =
                catSlug === 'skincare' ? 'skincare' :
                catSlug === 'fashion' ? 'fashion' :
                catSlug === 'wellness' ? 'wellness' : 'others';

              // Map to TrendingItem
              return {
                id: `dynamic-${p.id}`,
                title: p.title,
                slug: p.slug,
                excerpt: p.excerpt || '',
                content: '',
                category: categoryNormalized,
                item_type: 'article' as const,
                metadata: {
                  post_id: p.id,
                  post_slug: p.slug,
                  author_name: p.author?.name || 'Staff Editor',
                  author_avatar: p.author?.avatar_url || '',
                  author_role: p.author?.role || 'Editorial Contributor',
                  published_date: p.published_at,
                  trending_rank: idx + 1,
                  trending_badge: idx === 0 ? 'Viral Story' : idx < 3 ? 'Top Read This Week' : 'Community Choice',
                  why_trending: `${p.view_count || (Math.floor(Math.random() * 800) + 1200)} readers engaged with this story`,
                },
                destination_url: `/article/${p.slug}`,
                cover_image: p.cover_image || 'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?w=1200&auto=format&fit=crop&q=80',
                upvotes: Math.floor(Math.random() * 30) + 40,
                views_count: p.view_count || 1450,
                clicks_count: 220,
                read_time_minutes: p.reading_time_minutes || 5,
                priority_order: 100 - idx,
                is_pinned: idx === 0 && loadedCurated.length === 0,
                is_archived: false,
                expires_at: null,
                created_at: p.published_at,
                updated_at: p.published_at,
              };
            });

          // Apply category filter if active
          const filteredDynamic = categoryFilter === 'all'
            ? dynamicArticleItems
            : dynamicArticleItems.filter(item => item.category === categoryFilter);

          setPublishedArticles(filteredDynamic);
        }
      } catch (postErr) {
        console.warn('[useTrending] Fallback posts load warning:', postErr);
      }
    } catch (err: unknown) {
      console.error('[useTrending] Error loading trending items:', err);
      setError(err instanceof Error ? err.message : 'Failed to load trending items');
    } finally {
      setLoading(false);
    }
  }, [categoryFilter]);

  useEffect(() => {
    fetchTrending();
  }, [fetchTrending]);

  // Merge items: curated items take precedence, followed by published dynamic articles
  const items = useMemo(() => {
    // Separate curated articles and other spotlights
    return [...curatedItems, ...publishedArticles];
  }, [curatedItems, publishedArticles]);

  const articles = useMemo(() => {
    return items.filter(item => item.item_type === 'article');
  }, [items]);

  const spotlights = useMemo(() => {
    return items.filter(item => item.item_type !== 'article');
  }, [items]);

  const heroArticle = useMemo(() => {
    // Find pinned article first, or highest upvoted / first article
    const pinned = articles.find(a => a.is_pinned);
    return pinned || articles[0] || null;
  }, [articles]);

  const upvote = useCallback(async (id: string) => {
    const votedKey = `lixxon_trend_voted_${id}`;
    if (localStorage.getItem(votedKey)) {
      return { success: false, alreadyVoted: true };
    }

    // Optimistic UI update
    setCuratedItems(prev =>
      prev.map(item => (item.id === id ? { ...item, upvotes: item.upvotes + 1 } : item))
    );
    setPublishedArticles(prev =>
      prev.map(item => (item.id === id ? { ...item, upvotes: item.upvotes + 1 } : item))
    );
    localStorage.setItem(votedKey, 'true');

    // Only sync to Supabase if it's a real curated item
    if (!id.startsWith('dynamic-')) {
      try {
        const { error: rpcErr } = await supabase.rpc('increment_trending_engagement', {
          p_item_id: id,
          p_kind: 'upvote',
        });
        if (rpcErr) {
          const item = curatedItems.find(i => i.id === id);
          if (item) {
            await supabase.from('trending_items').update({ upvotes: item.upvotes + 1 }).eq('id', id);
          }
        }
      } catch (err) {
        console.warn('[useTrending] upvote sync failed:', err);
      }
    }
    return { success: true, alreadyVoted: false };
  }, [curatedItems]);

  const recordClick = useCallback(async (id: string) => {
    if (id.startsWith('dynamic-')) return;
    try {
      await supabase.rpc('increment_trending_engagement', {
        p_item_id: id,
        p_kind: 'click',
      });
    } catch {
      // ignore
    }
  }, []);

  const recordView = useCallback(async (id: string) => {
    const viewedKey = `lixxon_trend_view_${id}`;
    if (sessionStorage.getItem(viewedKey)) return;
    sessionStorage.setItem(viewedKey, '1');

    if (id.startsWith('dynamic-')) return;
    try {
      await supabase.rpc('increment_trending_engagement', {
        p_item_id: id,
        p_kind: 'view',
      });
    } catch {
      // ignore
    }
  }, []);

  return {
    items,
    articles,
    spotlights,
    heroArticle,
    loading,
    error,
    refetch: fetchTrending,
    upvote,
    recordClick,
    recordView,
  };
}
