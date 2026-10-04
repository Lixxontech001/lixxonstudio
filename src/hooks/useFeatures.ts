import { useEffect, useState, useCallback } from 'react';
import { supabase, rows } from '../lib/supabaseClient';
import { submitForm, ApiError } from '../lib/api';
import type { ArticlePoll, ArticleReaction, ProductReview, PromoCode } from '../lib/types';

// ==================== PROMO CODES ====================

export function usePromoCode() {
  const [appliedCode, setAppliedCode] = useState<PromoCode | null>(null);
  const [discount, setDiscount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const applyCode = useCallback(async (code: string, subtotal: number) => {
    setLoading(true);
    setError(null);
    const { data, error: qError } = await supabase
      .from('promo_codes')
      .select('*')
      .eq('code', code.toUpperCase().trim())
      .eq('is_active', true)
      .maybeSingle();

    if (qError || !data) {
      setError('Invalid or expired promo code.');
      setAppliedCode(null);
      setDiscount(0);
      setLoading(false);
      return;
    }

    const promo = data as PromoCode;
    if (promo.expires_at && new Date(promo.expires_at) < new Date()) {
      setError('This promo code has expired.');
      setAppliedCode(null);
      setDiscount(0);
      setLoading(false);
      return;
    }

    if (promo.max_uses !== null && promo.use_count >= promo.max_uses) {
      setError('This promo code has reached its usage limit.');
      setAppliedCode(null);
      setDiscount(0);
      setLoading(false);
      return;
    }

    let calcDiscount = 0;
    if (promo.discount_type === 'percentage') {
      calcDiscount = (subtotal * promo.discount_value) / 100;
    } else {
      calcDiscount = Math.min(promo.discount_value, subtotal);
    }

    setAppliedCode(promo);
    setDiscount(calcDiscount);
    setLoading(false);
  }, []);

  const removeCode = useCallback(() => {
    setAppliedCode(null);
    setDiscount(0);
    setError(null);
  }, []);

  return { appliedCode, discount, loading, error, applyCode, removeCode };
}

// ==================== PRODUCT REVIEWS ====================

export function useProductReviews(productId: string | null) {
  const [reviews, setReviews] = useState<ProductReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [avgRating, setAvgRating] = useState(0);

  useEffect(() => {
    if (!productId) { setLoading(false); return; }
    let cancelled = false;
    const fetch = async () => {
      setLoading(true);
      const { data } = await supabase
        .from('product_reviews')
        .select('id, product_id, author_name, rating, content, verified_purchase, is_approved, created_at')
        .eq('product_id', productId)
        .eq('is_approved', true)
        .order('created_at', { ascending: false });
      if (cancelled) return;
      const items = (data || []) as ProductReview[];
      setReviews(items);
      setAvgRating(items.length > 0 ? items.reduce((sum, r) => sum + r.rating, 0) / items.length : 0);
      setLoading(false);
    };
    fetch();
    return () => { cancelled = true; };
  }, [productId]);

  return { reviews, loading, avgRating };
}

export function useSubmitReview() {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const submit = useCallback(async (productId: string, email: string, name: string, rating: number, content: string) => {
    setSubmitting(true);
    setError(null);
    setSuccess(false);
    try {
      await submitForm('review', { product_id: productId, customer_email: email.trim(), author_name: name.trim(), rating, content: content.trim() });
      setSubmitting(false); setSuccess(true); return true;
    } catch (e) {
      setSubmitting(false);
      setError(e instanceof ApiError ? e.message : 'Could not submit your review. Please try again.');
      return false;
    }
  }, []);

  return { submit, submitting, error, success };
}

// ==================== ARTICLE POLLS ====================

export function useArticlePoll(postId: string | null) {
  const [poll, setPoll] = useState<ArticlePoll | null>(null);
  const [votes, setVotes] = useState<number[]>([]);
  const [userVote, setUserVote] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!postId) { setLoading(false); return; }
    let cancelled = false;
    const fetchPoll = async () => {
      setLoading(true);
      const { data } = await supabase
        .from('article_polls')
        .select('*')
        .eq('post_id', postId)
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      if (data) {
        const p = data as ArticlePoll;
        setPoll(p);
        const { data: voteData } = await supabase
          .from('article_poll_votes')
          .select('option_index')
          .eq('poll_id', p.id);
        if (cancelled) return;
        const allVotes = (voteData || []).map((v: { option_index: number }) => v.option_index);
        const counts = Array.isArray(p.options) ? p.options.map((_, i) => allVotes.filter(v => v === i).length) : [];
        setVotes(counts);

        const fp = getFingerprint();
        const { data: userVoteData } = await supabase
          .from('article_poll_votes')
          .select('option_index')
          .eq('poll_id', p.id)
          .eq('voter_fingerprint', fp)
          .maybeSingle();
        if (cancelled) return;
        if (userVoteData) setUserVote((userVoteData as { option_index: number }).option_index);
      }
      setLoading(false);
    };
    fetchPoll();
    return () => { cancelled = true; };
  }, [postId]);

  const castVote = useCallback(async (optionIndex: number) => {
    if (!poll || userVote !== null) return;
    const fp = getFingerprint();
    const { error } = await supabase
      .from('article_poll_votes')
      .insert({ poll_id: poll.id, option_index: optionIndex, voter_fingerprint: fp });
    if (!error) {
      setUserVote(optionIndex);
      setVotes(prev => prev.map((v, i) => i === optionIndex ? v + 1 : v));
    }
  }, [poll, userVote]);

  return { poll, votes, userVote, castVote, loading };
}

// ==================== ARTICLE REACTIONS ====================

const REACTION_TYPES: ArticleReaction['reaction_type'][] = ['love', 'insightful', 'inspiring', 'save'];

export function useArticleReactions(postId: string | null) {
  const [reactions, setReactions] = useState<ArticleReaction[]>([]);
  const [userReactions, setUserReactions] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!postId) { setLoading(false); return; }
    let cancelled = false;
    const fetch = async () => {
      setLoading(true);
      const { data } = await supabase
        .from('article_reactions')
        .select('reaction_type')
        .eq('post_id', postId);
      if (cancelled) return;
      const counts: Record<string, number> = {};
      (data || []).forEach((r: { reaction_type: string }) => {
        counts[r.reaction_type] = (counts[r.reaction_type] || 0) + 1;
      });
      const list: ArticleReaction[] = REACTION_TYPES.map(type => ({
        reaction_type: type,
        count: counts[type] || 0,
      }));
      setReactions(list);

      const fp = getFingerprint();
      const { data: userData } = await supabase
        .from('article_reactions')
        .select('reaction_type')
        .eq('post_id', postId)
        .eq('fingerprint', fp);
      if (cancelled) return;
      setUserReactions(new Set((userData || []).map((r: { reaction_type: string }) => r.reaction_type)));
      setLoading(false);
    };
    fetch();
    return () => { cancelled = true; };
  }, [postId]);

  const toggleReaction = useCallback(async (reactionType: ArticleReaction['reaction_type']) => {
    if (!postId) return;
    const fp = getFingerprint();
    const hasReacted = userReactions.has(reactionType);

    if (hasReacted) {
      await supabase.from('article_reactions')
        .delete()
        .eq('post_id', postId)
        .eq('reaction_type', reactionType)
        .eq('fingerprint', fp);
      setUserReactions(prev => {
        const next = new Set(prev);
        next.delete(reactionType);
        return next;
      });
      setReactions(prev => prev.map(r =>
        r.reaction_type === reactionType ? { ...r, count: Math.max(0, r.count - 1) } : r
      ));
    } else {
      await supabase.from('article_reactions')
        .insert({ post_id: postId, reaction_type: reactionType, fingerprint: fp });
      setUserReactions(prev => {
        const next = new Set(prev);
        next.add(reactionType);
        return next;
      });
      setReactions(prev => prev.map(r =>
        r.reaction_type === reactionType ? { ...r, count: r.count + 1 } : r
      ));
    }
  }, [postId, userReactions]);

  return { reactions, userReactions, toggleReaction, loading };
}

// ==================== READING STREAK ====================

export function useReadingStreak() {
  const [streak, setStreak] = useState(0);
  const [totalDays, setTotalDays] = useState(0);

  useEffect(() => {
    const fp = getFingerprint();
    let cancelled = false;
    const fetch = async () => {
      const { data } = await supabase
        .from('reading_sessions')
        .select('read_date')
        .eq('fingerprint', fp)
        .order('read_date', { ascending: false });
      if (cancelled) return;
      const dates = (data || []).map((d: { read_date: string }) => d.read_date);
      setTotalDays(dates.length);

      if (dates.length === 0) { setStreak(0); return; }

      let currentStreak = 0;
      const today = new Date();
      const todayStr = today.toISOString().split('T')[0];
      const yesterdayStr = new Date(today.getTime() - 86400000).toISOString().split('T')[0];

      if (dates[0] === todayStr || dates[0] === yesterdayStr) {
        currentStreak = 1;
        const dateSet = new Set(dates);
        let checkDate = dates[0] === todayStr ? new Date(today.getTime() - 86400000) : new Date(today.getTime() - 2 * 86400000);
        while (dateSet.has(checkDate.toISOString().split('T')[0])) {
          currentStreak++;
          checkDate = new Date(checkDate.getTime() - 86400000);
        }
      }
      setStreak(currentStreak);
    };
    fetch();
    return () => { cancelled = true; };
  }, []);

  const recordReadingDay = useCallback(async (postId?: string) => {
    const fp = getFingerprint();
    const today = new Date().toISOString().split('T')[0];
    const { data: { session } } = await supabase.auth.getSession();
    await supabase.from('reading_sessions')
      .upsert({ fingerprint: fp, read_date: today, post_id: postId || null, user_id: session?.user?.id || null }, { onConflict: 'fingerprint,read_date' });
  }, []);

  return { streak, totalDays, recordReadingDay };
}

// ==================== LIVE READER COUNT ====================

export function useLiveReaderCount(postId: string | null) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!postId) return;
    let cancelled = false;
    const fp = getFingerprint();

    const heartbeat = async () => {
      await supabase.from('article_active_readers')
        .upsert({ post_id: postId, fingerprint: fp, last_heartbeat: new Date().toISOString() }, { onConflict: 'post_id,fingerprint' });

      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const { count } = await supabase
        .from('article_active_readers')
        .select('*', { count: 'exact', head: true })
        .eq('post_id', postId)
        .gt('last_heartbeat', fiveMinAgo);
      if (!cancelled) setCount(count || 0);
    };

    heartbeat();
    const interval = setInterval(heartbeat, 30000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [postId]);

  return count;
}

// ==================== AUTHOR PROFILE ====================

export function useAuthorPosts(authorSlug: string | null) {
  const [author, setAuthor] = useState<{ id: string; name: string; slug: string; bio: string | null; avatar_url: string | null; role: string | null; social_links: { twitter?: string; instagram?: string; linkedin?: string; website?: string } | null } | null>(null);
  const [posts, setPosts] = useState<{ id: string; title: string; slug: string; excerpt: string | null; cover_image: string | null; published_at: string; reading_time_minutes: number; category: { name: string; slug: string } | null }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (!authorSlug) { setAuthor(null); setPosts([]); setLoading(false); return; }
    let cancelled = false;
    const fetchAuthorPosts = async () => {
      setLoading(true);
      setError(null);
      try {
        const { data: authorData, error: authorError } = await supabase
          .from('authors')
          .select('*')
          .eq('slug', authorSlug)
          .maybeSingle();
        if (cancelled) return;
        if (authorError) throw authorError;
        if (!authorData) {
          setAuthor(null);
          setPosts([]);
          return;
        }
        setAuthor(authorData);
        const { data: postData, error: postsError } = await supabase
          .from('posts')
          .select('id, title, slug, excerpt, cover_image, published_at, reading_time_minutes, category:categories(name, slug)')
          .eq('author_id', authorData.id)
          .eq('status', 'published')
          .order('published_at', { ascending: false });
        if (cancelled) return;
        if (postsError) throw postsError;
        setPosts(rows<typeof posts[number]>(postData));
      } catch (fetchError) {
        if (!cancelled) setError(fetchError instanceof Error ? fetchError.message : 'Unable to load this author.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void fetchAuthorPosts();
    return () => { cancelled = true; };
  }, [authorSlug, retryKey]);

  const retry = useCallback(() => setRetryKey((key) => key + 1), []);
  return { author, posts, loading, error, retry };
}

// ==================== TAG-BASED BROWSING ====================

const TAG_PAGE_SIZE = 9;

export function useTagPosts(tag: string, page: number) {
  const [posts, setPosts] = useState<{ id: string; title: string; slug: string; excerpt: string | null; cover_image: string | null; published_at: string; reading_time_minutes: number; category: { name: string; slug: string } | null }[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (!tag) { setPosts([]); setTotal(0); setError(null); setLoading(false); return; }
    let cancelled = false;
    const fetchTagPosts = async () => {
      setLoading(true);
      setError(null);
      const from = (page - 1) * TAG_PAGE_SIZE;
      const to = from + TAG_PAGE_SIZE - 1;
      try {
        const { data, count, error: queryError } = await supabase
          .from('posts')
          .select('*, category:categories(name, slug)', { count: 'exact' })
          .eq('status', 'published')
          .contains('tags', [tag])
          .order('published_at', { ascending: false })
          .range(from, to);
        if (cancelled) return;
        if (queryError) throw queryError;
        setPosts((data || []) as typeof posts);
        setTotal(count || 0);
      } catch (fetchError) {
        if (!cancelled) setError(fetchError instanceof Error ? fetchError.message : 'Unable to load these stories.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void fetchTagPosts();
    return () => { cancelled = true; };
  }, [tag, page, retryKey]);

  const retry = useCallback(() => setRetryKey((key) => key + 1), []);
  return {
    posts,
    total,
    totalPages: Math.max(1, Math.ceil(total / TAG_PAGE_SIZE)),
    loading,
    error,
    retry,
  };
}

// ==================== LIVE SEARCH AUTOCOMPLETE ====================

export function useLiveSearch(query: string) {
  const [suggestions, setSuggestions] = useState<{ title: string; slug: string; category: string | null }[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!query.trim() || query.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(async () => {
      const { data } = await supabase
        .from('posts')
        .select('title, slug, category:categories(name)')
        .eq('status', 'published')
        .or(`title.ilike.%${query.trim()}%,excerpt.ilike.%${query.trim()}%`)
        .order('published_at', { ascending: false })
        .limit(6);
      if (cancelled) return;
      const items = rows<{ title: string; slug: string; category: { name: string } | null }>(data).map((d) => ({
        title: d.title,
        slug: d.slug,
        category: d.category?.name || null,
      }));
      setSuggestions(items);
      setLoading(false);
    }, 200);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query]);

  return { suggestions, loading };
}

// ==================== WEEKLY DIGEST ====================

export function useWeeklyDigest() {
  const [posts, setPosts] = useState<{ id: string; title: string; slug: string; excerpt: string | null; cover_image: string | null; published_at: string; reading_time_minutes: number; category: { name: string; slug: string } | null }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const fetch = async () => {
      setLoading(true);
      const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
      const { data } = await supabase
        .from('posts')
        .select('id, title, slug, excerpt, cover_image, published_at, reading_time_minutes, category:categories(name, slug)')
        .eq('status', 'published')
        .gt('published_at', sevenDaysAgo)
        .order('published_at', { ascending: false })
        .limit(12);
      if (cancelled) return;
      setPosts(rows<typeof posts[number]>(data));
      setLoading(false);
    };
    fetch();
    return () => { cancelled = true; };
  }, []);

  return { posts, loading };
}

// ==================== PERSONALIZED RECOMMENDATIONS ====================

export function usePersonalizedRecommendations() {
  const [posts, setPosts] = useState<{ id: string; title: string; slug: string; excerpt: string | null; cover_image: string | null; published_at: string; reading_time_minutes: number; category: { name: string; slug: string } | null }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const fetch = async () => {
      setLoading(true);
      const historyRaw = localStorage.getItem('lixxon_reading_history');
      const history: { id: string; category_id?: string; tags?: string[] }[] = historyRaw ? JSON.parse(historyRaw) : [];
      if (history.length === 0) { setLoading(false); return; }

      const readIds = new Set(history.map(h => h.id));
      const categoryIds = new Set(history.map(h => h.category_id).filter(Boolean) as string[]);
      const tags = new Set(history.flatMap(h => h.tags || []));

      const query = supabase
        .from('posts')
        .select('id, title, slug, excerpt, cover_image, published_at, reading_time_minutes, category:categories(name, slug)')
        .eq('status', 'published')
        .order('published_at', { ascending: false })
        .limit(50);

      const { data } = await query;
      if (cancelled) return;
      const allPosts = rows<typeof posts[number]>(data);
      const unread = allPosts.filter(p => !readIds.has(p.id));

      const scored = unread.map(p => {
        let score = 0;
        const pCatId = (p as unknown as { category_id: string | null }).category_id;
        if (pCatId && categoryIds.has(pCatId)) score += 10;
        const pTags = (p as unknown as { tags: string[] | null }).tags || [];
        pTags.forEach(t => { if (tags.has(t)) score += 5; });
        return { post: p, score };
      }).sort((a, b) => b.score - a.score);

      setPosts(scored.slice(0, 4).map(s => s.post));
      setLoading(false);
    };
    fetch();
    return () => { cancelled = true; };
  }, []);

  return { posts, loading };
}

// ==================== RECENTLY VIEWED PRODUCTS ====================

const RECENT_PRODUCTS_KEY = 'lixxon_recent_products';

export function trackProductView(productId: string, name: string, slug: string, image_url: string | null) {
  try {
    const stored = JSON.parse(localStorage.getItem(RECENT_PRODUCTS_KEY) || '[]');
    const filtered = stored.filter((p: { id: string }) => p.id !== productId);
    filtered.unshift({ id: productId, name, slug, image_url, viewed_at: Date.now() });
    localStorage.setItem(RECENT_PRODUCTS_KEY, JSON.stringify(filtered.slice(0, 8)));
  } catch { /* ignore */ }
}

export function useRecentlyViewedProducts() {
  const [products, setProducts] = useState<{ id: string; name: string; slug: string; image_url: string | null }[]>([]);

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(RECENT_PRODUCTS_KEY) || '[]');
      setProducts(stored);
    } catch { /* ignore */ }
  }, []);

  return products;
}

// ==================== NEWSLETTER PREFERENCES ====================

export function useNewsletterPreferences(email: string | null) {
  const [preferences, setPreferences] = useState<{ preferred_categories: string[]; frequency: 'daily' | 'weekly' } | null>(null);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!email) return;
    setLoading(true);
    const { data } = await supabase
      .from('newsletter_preferences')
      .select('preferred_categories, frequency')
      .eq('email', email)
      .maybeSingle();
    if (data) {
      setPreferences(data as typeof preferences);
    } else {
      setPreferences({ preferred_categories: [], frequency: 'daily' });
    }
    setLoading(false);
  }, [email]);

  const save = useCallback(async (prefs: { preferred_categories: string[]; frequency: 'daily' | 'weekly' }) => {
    if (!email) return;
    setLoading(true);
    setSaved(false);
    try {
      await submitForm('newsletter_prefs', { email, ...prefs });
      setPreferences(prefs);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save preferences.');
      setLoading(false);
      return;
    }
    setLoading(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 4000);
  }, [email]);

  return { preferences, loading, saved, error, load, save };
}

// ==================== HELPERS ====================

export function getFingerprint(): string {
  const stored = localStorage.getItem('fp');
  if (stored && stored.length >= 10) return stored;
  const fp = generateFingerprint();
  localStorage.setItem('fp', fp);
  return fp;
}

function generateFingerprint(): string {
  const parts = [
    navigator.userAgent,
    navigator.language,
    screen.width + 'x' + screen.height,
    new Date().getTimezoneOffset().toString(),
    Math.random().toString(36).slice(2),
  ];
  const raw = parts.join('|');
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    hash = ((hash << 5) - hash) + raw.charCodeAt(i);
    hash |= 0;
  }
  return 'fp_' + Math.abs(hash).toString(36) + raw.length.toString(36);
}

// ==================== READING HISTORY ====================

export function recordReadingHistory(post: { id: string; title: string; slug: string; category_id: string | null; tags: string[] | null; cover_image: string | null }) {
  try {
    const stored = JSON.parse(localStorage.getItem('lixxon_reading_history') || '[]');
    const filtered = stored.filter((p: { id: string }) => p.id !== post.id);
    filtered.unshift({
      id: post.id,
      title: post.title,
      slug: post.slug,
      category_id: post.category_id,
      tags: post.tags,
      cover_image: post.cover_image,
      read_at: Date.now(),
    });
    localStorage.setItem('lixxon_reading_history', JSON.stringify(filtered.slice(0, 30)));
  } catch { /* ignore */ }
}

export function useReadingHistory() {
  const [history, setHistory] = useState<{ id: string; title: string; slug: string; cover_image: string | null; read_at: number }[]>([]);

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('lixxon_reading_history') || '[]');
      setHistory(stored);
    } catch { /* ignore */ }
  }, []);

  const clearHistory = useCallback(() => {
    localStorage.removeItem('lixxon_reading_history');
    setHistory([]);
  }, []);

  return { history, clearHistory };
}
