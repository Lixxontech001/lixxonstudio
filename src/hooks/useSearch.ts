import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { reportRequestError } from '../lib/requestStatus';
import {
  effectiveSort,
  type GlossaryRow,
  expandTerms,
  hasSearchIntent,
  normaliseQuery,
  SEARCH_PAGE_SIZE,
  type SearchFilters,
  type SearchResultRow,
  type SearchState,
  type SynonymRow,
} from '../lib/searchQuery';

const SYNONYM_CACHE_KEY = 'lixxon_search_synonyms_v1';
const SYNONYM_TTL_MS = 6 * 60 * 60 * 1000;
const DEBOUNCE_MS = 220;

interface CachedSynonyms {
  fetchedAt: number;
  rows: SynonymRow[];
}

function readSynonymCache(): SynonymRow[] | null {
  try {
    const raw = localStorage.getItem(SYNONYM_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedSynonyms;
    if (!parsed?.rows || !Array.isArray(parsed.rows)) return null;
    if (Date.now() - (parsed.fetchedAt ?? 0) > SYNONYM_TTL_MS) return null;
    return parsed.rows;
  } catch {
    return null;
  }
}

function writeSynonymCache(rows: SynonymRow[]): void {
  try {
    localStorage.setItem(SYNONYM_CACHE_KEY, JSON.stringify({ fetchedAt: Date.now(), rows } satisfies CachedSynonyms));
  } catch {
    /* storage disabled — expansion still works from the in-memory copy */
  }
}

/**
 * The admin-editable synonym table. Small, changes rarely, cached for six hours
 * in the browser so instant search never waits on it.
 */
export function useSearchSynonyms(): { rows: SynonymRow[]; reload: () => void } {
  const [rows, setRows] = useState<SynonymRow[]>(() => readSynonymCache() ?? []);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (readSynonymCache()) return;
    let cancelled = false;
    supabase
      .from('search_synonyms')
      .select('id, term, synonyms')
      .order('term')
      .then(({ data, error }) => {
        if (cancelled || error || !data) return;
        const clean = (data as SynonymRow[]).filter((row) => row?.term && Array.isArray(row.synonyms));
        setRows(clean);
        writeSynonymCache(clean);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const reload = useCallback(() => {
    try {
      localStorage.removeItem(SYNONYM_CACHE_KEY);
    } catch {
      /* ignore */
    }
    setRows([]);
    setReloadKey((key) => key + 1);
  }, []);

  return { rows, reload };
}

export interface SearchOutcome {
  results: SearchResultRow[];
  total: number;
  terms: string[];
  loading: boolean;
  /** True while a newer query is in flight over previously rendered results. */
  refreshing: boolean;
  error: string | null;
  retry: () => void;
}

const emptyOutcome: SearchOutcome = {
  results: [],
  total: 0,
  terms: [],
  loading: false,
  refreshing: false,
  error: null,
  retry: () => {},
};

/**
 * Debounced, typo-tolerant instant search.
 *
 * Previous results stay on screen while the next request is in flight (so the
 * grid never flashes empty), stale responses are discarded, and every failure
 * ends in a visible, retryable error — the Batch 1 promise, kept.
 */
export function useSearch(state: SearchState, synonyms: SynonymRow[] = []): SearchOutcome {
  const [outcome, setOutcome] = useState<SearchOutcome>(emptyOutcome);
  const [retryKey, setRetryKey] = useState(0);
  const requestId = useRef(0);
  const hasResults = useRef(false);

  const enabled = hasSearchIntent(state);
  const sort = effectiveSort(state);
  const terms = useMemo(() => expandTerms(state.query, synonyms), [state.query, synonyms]);
  const stateKey = useMemo(
    () =>
      JSON.stringify([
        normaliseQuery(state.query),
        state.filters,
        sort,
        state.page,
        terms.length,
      ]),
    [state.query, state.filters, sort, state.page, terms.length],
  );

  useEffect(() => {
    if (!enabled) {
      hasResults.current = false;
      setOutcome(emptyOutcome);
      return;
    }

    let cancelled = false;
    const id = ++requestId.current;
    const timer = window.setTimeout(async () => {
      setOutcome((prev) => ({
        ...prev,
        loading: !hasResults.current,
        refreshing: hasResults.current,
        error: null,
      }));

      const from = (state.page - 1) * SEARCH_PAGE_SIZE;
      const filters: SearchFilters = state.filters;
      const { data, error } = await supabase.rpc('search_everything', {
        p_query: normaliseQuery(state.query),
        p_terms: terms,
        p_kind: filters.kind,
        p_category: filters.category,
        p_author: filters.author,
        p_tag: filters.tag,
        p_min_minutes: filters.minMinutes,
        p_max_minutes: filters.maxMinutes,
        p_date_from: filters.dateFrom,
        p_date_to: filters.dateTo,
        p_sort: sort,
        p_limit: SEARCH_PAGE_SIZE,
        p_offset: from,
      });

      if (cancelled || id !== requestId.current) return;

      if (error) {
        reportRequestError('supabase');
        setOutcome((prev) => ({
          ...prev,
          loading: false,
          refreshing: false,
          error:
            error.message?.includes('timed out') || error.message?.includes('timeout')
              ? 'Search took too long. Please try again.'
              : 'We could not run that search.',
        }));
        return;
      }

      const rows = (data ?? []) as SearchResultRow[];
      const total = rows.length ? Number(rows[0].total_count) || rows.length : 0;
      hasResults.current = rows.length > 0;
      setOutcome({
        results: rows,
        total,
        terms,
        loading: false,
        refreshing: false,
        error: null,
        retry: () => setRetryKey((key) => key + 1),
      });
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // stateKey captures every input that changes the query
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, stateKey, retryKey]);

  const retry = useCallback(() => {
    hasResults.current = false;
    setRetryKey((key) => key + 1);
  }, []);

  return { ...outcome, retry };
}

export function useTrendingSearches(limit = 8): { queries: { query: string; searches: number }[]; loading: boolean } {
  const [queries, setQueries] = useState<{ query: string; searches: number }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    supabase
      .rpc('trending_searches', { p_limit: limit })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (!error && data) setQueries(data as { query: string; searches: number }[]);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [limit]);

  return { queries, loading };
}

export function usePeopleAlsoSearched(query: string, limit = 6): string[] {
  const [queries, setQueries] = useState<string[]>([]);
  const clean = normaliseQuery(query);

  useEffect(() => {
    if (clean.length < 3) {
      setQueries([]);
      return;
    }
    let cancelled = false;
    supabase
      .rpc('people_also_searched', { p_query: clean, p_limit: limit })
      .then(({ data, error }) => {
        if (cancelled || error || !data) return;
        setQueries((data as { query: string }[]).map((row) => row.query).filter(Boolean));
      });
    return () => {
      cancelled = true;
    };
  }, [clean, limit]);

  return queries;
}

export interface RelatedPost {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  cover_image: string | null;
  category_name: string | null;
  category_slug: string | null;
  reading_time_minutes: number | null;
  published_at: string | null;
  reason: 'co-read' | 'tags' | 'category' | string;
}

/** Related articles (tags + category + people who read both), computed in SQL. */
export function useRelatedPosts(postId: string | null, limit = 4): { posts: RelatedPost[]; loading: boolean } {
  const [posts, setPosts] = useState<RelatedPost[]>([]);
  const [loading, setLoading] = useState(Boolean(postId));

  useEffect(() => {
    if (!postId) {
      setPosts([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    supabase
      .rpc('related_posts', { p_post_id: postId, p_limit: limit })
      .then(({ data, error }) => {
        if (cancelled) return;
        setPosts(!error && data ? (data as RelatedPost[]) : []);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [postId, limit]);

  return { posts, loading };
}

// ---------------------------------------------------------------- saved searches

export interface SavedSearch {
  id: string;
  label: string;
  query: string;
  filters: SearchFilters;
  local: boolean;
}

const LOCAL_SAVED_KEY = 'lixxon_saved_searches_v1';

function readLocalSaved(): SavedSearch[] {
  try {
    const raw = localStorage.getItem(LOCAL_SAVED_KEY);
    const parsed = raw ? (JSON.parse(raw) as SavedSearch[]) : [];
    return Array.isArray(parsed) ? parsed.map((row) => ({ ...row, local: true })) : [];
  } catch {
    return [];
  }
}

function writeLocalSaved(rows: SavedSearch[]): void {
  try {
    localStorage.setItem(LOCAL_SAVED_KEY, JSON.stringify(rows));
  } catch {
    /* ignore */
  }
}

/**
 * Saved searches: local by default (no account needed), synced to the account
 * when signed in so they follow the reader between devices.
 */
export function useSavedSearches(): {
  saved: SavedSearch[];
  loading: boolean;
  save: (label: string, state: SearchState) => Promise<void>;
  remove: (id: string) => Promise<void>;
} {
  const [local, setLocal] = useState<SavedSearch[]>(() => readLocalSaved());
  const [account, setAccount] = useState<SavedSearch[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session?.user) {
          if (!cancelled) setLoading(false);
          return;
        }
        const { data } = await supabase
          .from('saved_searches')
          .select('id, label, query, filters')
          .order('created_at', { ascending: false })
          .limit(50);
        if (!cancelled && data) {
          setAccount(
            (data as { id: string; label: string; query: string; filters: SearchFilters }[]).map((row) => ({
              ...row,
              filters: row.filters ?? {},
              local: false,
            })) as SavedSearch[],
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const save = useCallback(async (label: string, state: SearchState) => {
    const cleanLabel = label.trim().slice(0, 80) || normaliseQuery(state.query) || 'Saved search';
    const entry: SavedSearch = {
      id: `local-${Date.now()}`,
      label: cleanLabel,
      query: state.query,
      filters: state.filters,
      local: true,
    };
    let signedIn = false;
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      signedIn = Boolean(session?.user);
    } catch {
      signedIn = false;
    }

    if (signedIn) {
      const { data, error } = await supabase
        .from('saved_searches')
        .insert({ user_id: (await supabase.auth.getUser()).data.user?.id, label: cleanLabel, query: state.query, filters: state.filters })
        .select('id, label, query, filters')
        .maybeSingle();
      if (!error && data) {
        setAccount((prev) => [{ ...(data as SavedSearch), local: false }, ...prev.filter((row) => row.id !== entry.id)]);
        return;
      }
    }
    setLocal((prev) => {
      const next = [entry, ...prev.filter((row) => !(row.query === entry.query && row.label === entry.label))].slice(0, 12);
      writeLocalSaved(next);
      return next;
    });
  }, []);

  const remove = useCallback(async (id: string) => {
    if (id.startsWith('local-')) {
      setLocal((prev) => {
        const next = prev.filter((row) => row.id !== id);
        writeLocalSaved(next);
        return next;
      });
      return;
    }
    await supabase.from('saved_searches').delete().eq('id', id);
    setAccount((prev) => prev.filter((row) => row.id !== id));
  }, []);

  return { saved: [...account, ...local], loading, save, remove };
}


// ---------------------------------------------------------------- glossary cards

let glossaryCache: GlossaryRow[] | null = null;

/** Glossary terms (cached for the session) — powers the ingredient knowledge card. */
export function useGlossaryTerms(): GlossaryRow[] {
  const [rows, setRows] = useState<GlossaryRow[]>(glossaryCache ?? []);

  useEffect(() => {
    if (glossaryCache) return;
    let cancelled = false;
    supabase
      .from('glossary_terms')
      .select('id, term, slug, definition, category')
      .order('term')
      .then(({ data, error }) => {
        if (cancelled || error || !data) return;
        glossaryCache = data as GlossaryRow[];
        setRows(glossaryCache);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return rows;
}
