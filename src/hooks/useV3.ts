/**
 * Data hooks for the v3 feature set (series, glossary, Q&A, profiles, badges, currency,
 * site settings, bundles, headline tests). All public reads go through RLS; all public
 * writes go through the `submit-form` edge function.
 */
import { useCallback, useEffect, useState } from 'react';
import { supabase, rows } from '../lib/supabaseClient';
import { useAuth } from '../context/AuthContext';
import type { ArticleSeries, GlossaryTerm, ArticleQuestion, PostWithRelations, UserProfile, SiteSetting, ProductBundle, Product } from '../lib/types';

// ------------------------------------------------------------------ series
export function useSeries(seriesId: string | null | undefined) {
  const [series, setSeries] = useState<ArticleSeries | null>(null);
  const [posts, setPosts] = useState<Pick<PostWithRelations, 'id' | 'title' | 'slug' | 'series_order' | 'reading_time_minutes'>[]>([]);
  useEffect(() => {
    if (!seriesId) { setSeries(null); setPosts([]); return; }
    let on = true;
    (async () => {
      const [s, p] = await Promise.all([
        supabase.from('article_series').select('*').eq('id', seriesId).maybeSingle(),
        supabase.from('posts').select('id, title, slug, series_order, reading_time_minutes').eq('series_id', seriesId).eq('status', 'published').order('series_order', { ascending: true }),
      ]);
      if (!on) return;
      setSeries((s.data as ArticleSeries) || null);
      setPosts(rows(p.data));
    })();
    return () => { on = false; };
  }, [seriesId]);
  return { series, posts };
}

export function useSeriesBySlug(slug: string) {
  const [series, setSeries] = useState<ArticleSeries | null>(null);
  const [posts, setPosts] = useState<PostWithRelations[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let on = true;
    setLoading(true);
    (async () => {
      const { data: s } = await supabase.from('article_series').select('*').eq('slug', slug).maybeSingle();
      if (!on) return;
      setSeries((s as ArticleSeries) || null);
      if (s) {
        const { data: p } = await supabase.from('posts').select('*, category:categories(*), author:authors(*)').eq('series_id', s.id).eq('status', 'published').order('series_order', { ascending: true });
        if (on) setPosts(rows(p));
      }
      setLoading(false);
    })();
    return () => { on = false; };
  }, [slug]);
  return { series, posts, loading };
}

export function useAllSeries() {
  const [list, setList] = useState<(ArticleSeries & { count: number })[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let on = true;
    (async () => {
      const { data } = await supabase.from('article_series').select('*, posts(count)').eq('is_active', true).order('created_at', { ascending: false });
      if (!on) return;
      setList(rows<ArticleSeries & { posts: { count: number }[] }>(data).map(s => ({ ...s, count: s.posts?.[0]?.count || 0 })));
      setLoading(false);
    })();
    return () => { on = false; };
  }, []);
  return { series: list, loading };
}

// ------------------------------------------------------------------ glossary
export function useGlossaryTerms() {
  const [terms, setTerms] = useState<GlossaryTerm[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let on = true;
    supabase.from('glossary_terms').select('*').order('term').then(({ data }) => { if (on) { setTerms(rows(data)); setLoading(false); } });
    return () => { on = false; };
  }, []);
  return { terms, loading };
}

// ------------------------------------------------------------------ reader Q&A
export function useArticleQuestions(postId: string) {
  const [questions, setQuestions] = useState<ArticleQuestion[]>([]);
  useEffect(() => {
    let on = true;
    supabase.from('article_questions').select('id, post_id, author_name, question, answer, answered_by, answered_at, is_public, upvotes, created_at')
      .eq('post_id', postId).eq('is_public', true).order('upvotes', { ascending: false }).limit(20)
      .then(({ data }) => { if (on) setQuestions(rows(data)); });
    return () => { on = false; };
  }, [postId]);
  return { questions };
}

// ------------------------------------------------------------------ profile, cloud bookmarks, badges
export function useProfile() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    if (!user) { setProfile(null); setLoading(false); return; }
    const { data } = await supabase.from('user_profiles').select('*').eq('user_id', user.id).maybeSingle();
    setProfile((data as UserProfile) || null);
    setLoading(false);
  }, [user]);
  useEffect(() => { reload(); }, [reload]);
  const save = useCallback(async (patch: Partial<UserProfile>) => {
    if (!user) return { error: 'Not signed in' };
    const { error } = await supabase.from('user_profiles').upsert({ user_id: user.id, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
    if (!error) await reload();
    return { error: error?.message || null };
  }, [user, reload]);
  return { profile, loading, save };
}

export function usePublicProfile(handle: string) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [badges, setBadges] = useState<string[]>([]);
  const [lists, setLists] = useState<{ id: string; name: string; description: string | null; share_token: string | null; items: number }[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let on = true;
    (async () => {
      const { data } = await supabase.from('user_profiles').select('*').eq('handle', handle).eq('is_public', true).maybeSingle();
      if (!on) return;
      setProfile((data as UserProfile) || null);
      if (data) {
        const [b, l] = await Promise.all([
          supabase.from('user_badges').select('badge').eq('user_id', data.user_id),
          supabase.from('reading_lists').select('id, name, description, share_token, reading_list_items(count)').eq('user_id', data.user_id).eq('is_public', true),
        ]);
        if (!on) return;
        setBadges(rows<{ badge: string }>(b.data).map(x => x.badge));
        setLists(rows<{ id: string; name: string; description: string | null; share_token: string | null; reading_list_items: { count: number }[] }>(l.data).map(x => ({ ...x, items: x.reading_list_items?.[0]?.count || 0 })));
      }
      setLoading(false);
    })();
    return () => { on = false; };
  }, [handle]);
  return { profile, badges, lists, loading };
}

export const BADGES: Record<string, { label: string; description: string; emoji: string }> = {
  first_read: { label: 'First Page', description: 'Read your first article while signed in', emoji: '📖' },
  ten_articles: { label: 'Regular', description: 'Ten reading days', emoji: '☕' },
  fifty_articles: { label: 'Devotee', description: 'Fifty reading days', emoji: '🏛️' },
  streak_7: { label: 'Seven Days', description: 'Read on 7 consecutive days', emoji: '🔥' },
  streak_30: { label: 'A Whole Month', description: 'Read on 30 consecutive days', emoji: '🌙' },
  curator: { label: 'Curator', description: 'Saved 5 articles to your bookmarks', emoji: '🗂️' },
  patron: { label: 'Patron', description: 'Made your first purchase', emoji: '🛍️' },
};

export function useBadges() {
  const { user } = useAuth();
  const [badges, setBadges] = useState<{ badge: string; earned_at: string }[]>([]);
  const refresh = useCallback(async () => {
    if (!user) { setBadges([]); return; }
    // server-side evaluation of streaks/counts; idempotent
    await supabase.rpc('award_badges').then(() => undefined, () => undefined);
    const { data } = await supabase.from('user_badges').select('badge, earned_at').eq('user_id', user.id).order('earned_at');
    setBadges(rows(data));
  }, [user]);
  useEffect(() => { refresh(); }, [refresh]);
  return { badges, refresh };
}

/** Bookmarks: localStorage for guests, synced to `user_bookmarks` when signed in. */
export function useCloudBookmarks() {
  const { user } = useAuth();
  const sync = useCallback(async () => {
    if (!user) return;
    let local: { id: string; title: string; slug: string; saved_at: number }[] = [];
    try { local = JSON.parse(localStorage.getItem('lixxon_bookmarks') || '[]'); } catch { /* ignore */ }
    if (local.length) {
      await supabase.from('user_bookmarks').upsert(local.map(b => ({ user_id: user.id, post_id: b.id })), { onConflict: 'user_id,post_id', ignoreDuplicates: true });
    }
    const { data } = await supabase.from('user_bookmarks').select('post_id, created_at, post:posts(id, title, slug)').eq('user_id', user.id);
    const remote = rows<{ post_id: string; created_at: string; post: { id: string; title: string; slug: string } | null }>(data)
      .filter(r => r.post)
      .map(r => ({ id: r.post_id, title: r.post!.title, slug: r.post!.slug, saved_at: new Date(r.created_at).getTime() }));
    localStorage.setItem('lixxon_bookmarks', JSON.stringify(remote));
    remote.forEach(r => localStorage.setItem(`bookmark_${r.id}`, '1'));
    window.dispatchEvent(new Event('lixxon:bookmarks'));
  }, [user]);
  useEffect(() => { sync(); }, [sync]);
  const toggle = useCallback(async (postId: string, on: boolean) => {
    if (!user) return;
    if (on) await supabase.from('user_bookmarks').upsert({ user_id: user.id, post_id: postId }, { onConflict: 'user_id,post_id' });
    else await supabase.from('user_bookmarks').delete().eq('user_id', user.id).eq('post_id', postId);
  }, [user]);
  return { toggle, sync };
}

// ------------------------------------------------------------------ currency
let ratesCache: Record<string, number> | null = null;
export function useCurrencyRates() {
  const [rates, setRates] = useState<Record<string, number>>(ratesCache || { USD: 1 });
  useEffect(() => {
    if (ratesCache) return;
    let on = true;
    supabase.from('currency_rates').select('code, rate').then(({ data }) => {
      const map: Record<string, number> = { USD: 1 };
      rows<{ code: string; rate: number | string }>(data).forEach(r => { map[r.code] = Number(r.rate); });
      ratesCache = map;
      if (on) setRates(map);
    });
    return () => { on = false; };
  }, []);
  return rates;
}

// ------------------------------------------------------------------ site settings (public)
let settingsCache: Record<string, Record<string, unknown>> | null = null;
export function useSiteSettings() {
  const [settings, setSettings] = useState<Record<string, Record<string, unknown>>>(settingsCache || {});
  useEffect(() => {
    if (settingsCache) return;
    let on = true;
    supabase.from('site_settings').select('key, value').eq('is_public', true).then(({ data }) => {
      const map: Record<string, Record<string, unknown>> = {};
      rows<SiteSetting>(data).forEach(s => { map[s.key] = s.value || {}; });
      settingsCache = map;
      if (on) setSettings(map);
    });
    return () => { on = false; };
  }, []);
  return settings;
}

// ------------------------------------------------------------------ bundles
export function useBundlesForProduct(productId: string | null) {
  const [bundles, setBundles] = useState<ProductBundle[]>([]);
  useEffect(() => {
    if (!productId) return;
    let on = true;
    (async () => {
      const { data: links } = await supabase.from('product_bundle_items').select('bundle_id').eq('product_id', productId);
      const ids = rows<{ bundle_id: string }>(links).map(l => l.bundle_id);
      if (!ids.length) { if (on) setBundles([]); return; }
      const { data } = await supabase.from('product_bundles').select('*, items:product_bundle_items(product:products(*))').in('id', ids).eq('is_active', true);
      if (on) setBundles(rows<ProductBundle>(data));
    })();
    return () => { on = false; };
  }, [productId]);
  return { bundles };
}

export function useComparableProducts(ids: string[]) {
  const [products, setProducts] = useState<Product[]>([]);
  const key = ids.join(',');
  useEffect(() => {
    if (!ids.length) { setProducts([]); return; }
    let on = true;
    supabase.from('products').select('*').in('id', ids).then(({ data }) => { if (on) setProducts(rows<Product>(data).sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id))); });
    return () => { on = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return { products };
}

// ------------------------------------------------------------------ headline A/B
export function pickHeadline(post: { id: string; title: string; alt_title?: string | null }): { title: string; variant: 'a' | 'b' } {
  if (!post.alt_title) return { title: post.title, variant: 'a' };
  const key = `hl_${post.id}`;
  let v = sessionStorage.getItem(key) as 'a' | 'b' | null;
  if (!v) { v = Math.random() < 0.5 ? 'a' : 'b'; sessionStorage.setItem(key, v); }
  return { title: v === 'b' ? post.alt_title : post.title, variant: v };
}
const tracked = new Set<string>();
export function trackHeadline(postId: string, variant: 'a' | 'b', event: 'impression' | 'click') {
  const k = `${postId}:${variant}:${event}`;
  if (tracked.has(k)) return;
  tracked.add(k);
  supabase.rpc('track_headline', { p_post_id: postId, p_variant: variant, p_event: event }).then(() => undefined, () => undefined);
}
