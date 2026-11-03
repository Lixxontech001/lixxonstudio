import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';
import type { TrendingItem, TrendingCategory } from '../types/trending';

export function useTrending(categoryFilter: TrendingCategory = 'all') {
  const [items, setItems] = useState<TrendingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTrending = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let query = supabase
        .from('trending_items')
        .select('*')
        .eq('is_archived', false)
        .order('is_pinned', { ascending: false })
        .order('priority_order', { ascending: false })
        .order('upvotes', { ascending: false });

      if (categoryFilter !== 'all') {
        query = query.eq('category', categoryFilter);
      }

      const { data, error: err } = await query;
      if (err) throw err;
      setItems((data || []) as TrendingItem[]);
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

  const upvote = useCallback(async (id: string) => {
    const votedKey = `lixxon_trend_voted_${id}`;
    if (localStorage.getItem(votedKey)) {
      return { success: false, alreadyVoted: true };
    }

    // Optimistic UI update
    setItems(prev =>
      prev.map(item => (item.id === id ? { ...item, upvotes: item.upvotes + 1 } : item))
    );
    localStorage.setItem(votedKey, 'true');

    try {
      const { error: rpcErr } = await supabase.rpc('increment_trending_engagement', {
        p_item_id: id,
        p_kind: 'upvote',
      });
      if (rpcErr) {
        // Fallback direct update
        const item = items.find(i => i.id === id);
        if (item) {
          await supabase.from('trending_items').update({ upvotes: item.upvotes + 1 }).eq('id', id);
        }
      }
      return { success: true, alreadyVoted: false };
    } catch (err) {
      console.warn('[useTrending] upvote sync failed:', err);
      return { success: true, alreadyVoted: false };
    }
  }, [items]);

  const recordClick = useCallback(async (id: string) => {
    try {
      await supabase.rpc('increment_trending_engagement', {
        p_item_id: id,
        p_kind: 'click',
      });
    } catch {
      // ignore non-blocking telemetry
    }
  }, []);

  const recordView = useCallback(async (id: string) => {
    const viewedKey = `lixxon_trend_view_${id}`;
    if (sessionStorage.getItem(viewedKey)) return;
    sessionStorage.setItem(viewedKey, '1');

    try {
      await supabase.rpc('increment_trending_engagement', {
        p_item_id: id,
        p_kind: 'view',
      });
    } catch {
      // ignore
    }
  }, []);

  return { items, loading, error, refetch: fetchTrending, upvote, recordClick, recordView };
}
