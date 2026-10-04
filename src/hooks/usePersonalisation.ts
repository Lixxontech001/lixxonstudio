import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { reportRequestError } from '../lib/requestStatus';
import { getFingerprint } from './useFeatures';
import type { ContinueReadingItem, ForYouItem, ReaderInsights } from '../lib/personalisation';

export const TRENDING_REASON = 'Popular with readers this week';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'We could not load your reading recommendations.';
}

/** Persist a reading milestone without interrupting the article experience. */
export async function saveReadingProgress(postId: string, percent: number): Promise<void> {
  try {
    const progress = Math.max(0, Math.min(100, Math.round(Number.isFinite(percent) ? percent : 0)));
    await supabase.rpc('record_reading_progress', {
      p_fingerprint: getFingerprint(),
      p_post_id: postId,
      p_progress: progress,
    });
  } catch {
    // Progress sync is deliberately best-effort: it must never interrupt reading
    // or raise the route-level request error notice.
  }
}

interface TrackerState {
  postId: string | null;
  highestSeen: number;
  highestSaved: number;
  lastSavedAt: number;
  pending: number;
  timer: ReturnType<typeof setTimeout> | null;
}

const MILESTONES = [25, 50, 75, 90, 100];
const MILESTONE_THROTTLE_MS = 5000;

/** Save the highest milestone reached, throttling intermediate writes per article. */
export function useReadingProgressTracker(postId: string | null | undefined, percent: number): void {
  const stateRef = useRef<TrackerState>({
    postId: null,
    highestSeen: 0,
    highestSaved: 0,
    lastSavedAt: 0,
    pending: 0,
    timer: null,
  });

  useEffect(() => {
    const state = stateRef.current;
    if (!postId) return;
    if (state.postId !== postId) {
      if (state.timer) clearTimeout(state.timer);
      state.postId = postId;
      state.highestSeen = 0;
      state.highestSaved = 0;
      state.lastSavedAt = 0;
      state.pending = 0;
      state.timer = null;
    }
    if (!Number.isFinite(percent) || percent < 10) return;

    const crossedMilestones = MILESTONES.filter((value) => percent >= value);
    const milestone = crossedMilestones[crossedMilestones.length - 1] || 0;
    if (milestone <= state.highestSeen) return;
    state.highestSeen = milestone;

    if (milestone === 100) {
      if (state.timer) clearTimeout(state.timer);
      state.timer = null;
      state.pending = 0;
      state.highestSaved = 100;
      state.lastSavedAt = Date.now();
      void saveReadingProgress(postId, 100);
      return;
    }

    const savePending = () => {
      const pending = state.pending;
      state.timer = null;
      state.pending = 0;
      if (pending <= state.highestSaved) return;
      state.highestSaved = pending;
      state.lastSavedAt = Date.now();
      void saveReadingProgress(postId, pending);
    };

    const wait = MILESTONE_THROTTLE_MS - (Date.now() - state.lastSavedAt);
    if (wait <= 0) {
      state.pending = milestone;
      savePending();
    } else {
      state.pending = Math.max(state.pending, milestone);
      if (!state.timer) state.timer = setTimeout(savePending, wait);
    }
  }, [postId, percent]);

  useEffect(() => () => {
    const timer = stateRef.current.timer;
    if (timer) clearTimeout(timer);
  }, []);
}

interface RpcRows<T> {
  items: T[];
  loading: boolean;
  error: string | null;
  retry: () => void;
}

function useRpcRows<T>(functionName: string, args: Record<string, number>): RpcRows<T> {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const argsKey = JSON.stringify(args);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const { data, error: rpcError } = await supabase.rpc(functionName, {
          p_fingerprint: getFingerprint(),
          ...(JSON.parse(argsKey) as Record<string, number>),
        });
        if (rpcError) throw rpcError;
        const rows = Array.isArray(data) ? data as T[] : data ? [data as T] : [];
        if (!cancelled) setItems(rows);
      } catch (fetchError) {
        if (!cancelled) {
          setItems([]);
          setError(errorMessage(fetchError));
          reportRequestError('supabase');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [functionName, argsKey, retryKey]);

  const retry = useCallback(() => setRetryKey((value) => value + 1), []);
  return { items, loading, error, retry };
}

export function useContinueReading(limit = 3): RpcRows<ContinueReadingItem> {
  return useRpcRows<ContinueReadingItem>('continue_reading', { p_limit: limit });
}

const EMPTY_INSIGHTS: ReaderInsights = {
  articles_read: 0,
  days_active: 0,
  current_streak: 0,
  longest_streak: 0,
  minutes_read: 0,
  top_categories: [],
  first_read_day: new Date().toISOString().slice(0, 10),
  last_read_day: new Date().toISOString().slice(0, 10),
};

export function useReaderInsights(days = 90) {
  const result = useRpcRows<ReaderInsights>('reader_insights', { p_days: days });
  return {
    insights: result.items[0] || EMPTY_INSIGHTS,
    loading: result.loading,
    error: result.error,
    retry: result.retry,
  };
}

export function useForYouFeed(limit = 6) {
  const result = useRpcRows<ForYouItem>('for_you_feed', { p_limit: limit });
  const personalised = result.items.some((item) => item.reason !== TRENDING_REASON);
  return { ...result, personalised };
}
