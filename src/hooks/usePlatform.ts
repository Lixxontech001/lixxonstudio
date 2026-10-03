import { useEffect, useState, useCallback } from 'react';
import { supabase, rows } from '../lib/supabaseClient';
import { submitForm } from '../lib/api';

// ==================== FINGERPRINT (shared) ====================
function getFingerprint(): string {
  const stored = localStorage.getItem('fp');
  if (stored && stored.length >= 10) return stored;
  const parts = [navigator.userAgent, navigator.language, screen.width + 'x' + screen.height, new Date().getTimezoneOffset().toString(), Math.random().toString(36).slice(2)];
  const raw = parts.join('|');
  let hash = 0;
  for (let i = 0; i < raw.length; i++) { hash = ((hash << 5) - hash) + raw.charCodeAt(i); hash |= 0; }
  const fp = 'fp_' + Math.abs(hash).toString(36) + raw.length.toString(36);
  localStorage.setItem('fp', fp);
  return fp;
}

// ==================== READING LISTS ====================
export function useReadingLists() {
  const [lists, setLists] = useState<{ id: string; name: string; description: string | null; is_public: boolean; share_token: string | null; created_at: string }[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    setLoading(true);
    const fp = getFingerprint();
    const { data: { session } } = await supabase.auth.getSession();
    const q = supabase.from('reading_lists').select('*').order('created_at', { ascending: false });
    const { data } = await (session?.user ? q.or(`fingerprint.eq.${fp},user_id.eq.${session.user.id}`) : q.eq('fingerprint', fp));
    setLists((data || []) as typeof lists);
    setLoading(false);
  }, []);

  useEffect(() => { refetch(); }, [refetch]);

  const createList = useCallback(async (name: string, description?: string) => {
    const fp = getFingerprint();
    const { data: { session } } = await supabase.auth.getSession();
    const { data, error } = await supabase.from('reading_lists').insert({ fingerprint: fp, name: name.trim(), description: description?.trim() || null, user_id: session?.user?.id || null }).select().single();
    if (!error && data) { await refetch(); return data; }
    return null;
  }, [refetch]);

  const deleteList = useCallback(async (id: string) => {
    await supabase.from('reading_lists').delete().eq('id', id);
    await refetch();
  }, [refetch]);

  return { lists, loading, createList, deleteList, refetch };
}

export function useReadingListItems(listId: string | null) {
  const [items, setItems] = useState<{ id: string; post_id: string; sort_order: number; post: { id: string; title: string; slug: string; cover_image: string | null; excerpt: string | null; reading_time_minutes: number } }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!listId) { setLoading(false); return; }
    let cancelled = false;
    const fetch = async () => {
      setLoading(true);
      const { data } = await supabase.from('reading_list_items')
        .select('id, post_id, sort_order, post:posts(id, title, slug, cover_image, excerpt, reading_time_minutes)')
        .eq('list_id', listId).order('sort_order', { ascending: true });
      if (cancelled) return;
      setItems(rows<typeof items[number]>(data));
      setLoading(false);
    };
    fetch();
    return () => { cancelled = true; };
  }, [listId]);

  const addPost = useCallback(async (listId: string, postId: string) => {
    const { count } = await supabase.from('reading_list_items').select('*', { count: 'exact', head: true }).eq('list_id', listId);
    await supabase.from('reading_list_items').insert({ list_id: listId, post_id: postId, sort_order: count || 0 });
  }, []);

  const removePost = useCallback(async (itemId: string) => {
    await supabase.from('reading_list_items').delete().eq('id', itemId);
    setItems(prev => prev.filter(i => i.id !== itemId));
  }, []);

  return { items, loading, addPost, removePost };
}

// ==================== SEARCH HISTORY ====================
export function useSearchHistory() {
  const [history, setHistory] = useState<string[]>([]);

  useEffect(() => {
    const fp = getFingerprint();
    supabase.from('search_history').select('query').eq('fingerprint', fp).order('created_at', { ascending: false }).limit(10).then(({ data }) => {
      if (data) setHistory([...new Set(data.map((d: { query: string }) => d.query))].slice(0, 8));
    });
  }, []);

  const logSearch = useCallback((query: string) => {
    if (!query.trim()) return;
    const fp = getFingerprint();
    supabase.from('search_history').insert({ fingerprint: fp, query: query.trim() }).then(() => {});
    setHistory(prev => [query, ...prev.filter(q => q !== query)].slice(0, 8));
  }, []);

  const clearHistory = useCallback(() => {
    const fp = getFingerprint();
    supabase.from('search_history').delete().eq('fingerprint', fp).then(() => {});
    setHistory([]);
  }, []);

  return { history, logSearch, clearHistory };
}

// ==================== CONTENT TEMPLATES ====================
export function useContentTemplates() {
  const [templates, setTemplates] = useState<{ id: string; name: string; description: string | null; content: string; category: string | null; icon: string }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const fetch = async () => {
      setLoading(true);
      const { data } = await supabase.from('content_templates').select('*').order('name');
      if (cancelled) return;
      setTemplates((data || []) as typeof templates);
      setLoading(false);
    };
    fetch();
    return () => { cancelled = true; };
  }, []);

  const saveTemplate = useCallback(async (name: string, description: string, content: string, category?: string) => {
    const { data, error } = await supabase.from('content_templates').insert({ name, description, content, category: category || null }).select().single();
    if (!error && data) setTemplates(prev => [...prev, data]);
    return data;
  }, []);

  const deleteTemplate = useCallback(async (id: string) => {
    await supabase.from('content_templates').delete().eq('id', id);
    setTemplates(prev => prev.filter(t => t.id !== id));
  }, []);

  return { templates, loading, saveTemplate, deleteTemplate };
}

// ==================== ARTICLE VERSIONS ====================
export function useArticleVersions(postId: string | null) {
  const [versions, setVersions] = useState<{ id: string; title: string; content: string | null; excerpt: string | null; saved_at: string; version_note: string | null }[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    if (!postId) { setLoading(false); return; }
    setLoading(true);
    const { data } = await supabase.from('article_versions').select('id, title, content, excerpt, saved_at, version_note').eq('post_id', postId).order('saved_at', { ascending: false });
    setVersions((data || []) as typeof versions);
    setLoading(false);
  }, [postId]);

  useEffect(() => { refetch(); }, [refetch]);

  const saveVersion = useCallback(async (postId: string, title: string, content: string, excerpt: string, note?: string) => {
    await supabase.from('article_versions').insert({ post_id: postId, title, content, excerpt, version_note: note || null });
    await refetch();
  }, [refetch]);

  const restoreVersion = useCallback(async (versionId: string) => {
    const { data } = await supabase.from('article_versions').select('title, content, excerpt').eq('id', versionId).maybeSingle();
    return data as { title: string; content: string; excerpt: string } | null;
  }, []);

  const deleteVersion = useCallback(async (id: string) => {
    await supabase.from('article_versions').delete().eq('id', id);
    await refetch();
  }, [refetch]);

  return { versions, loading, saveVersion, restoreVersion, deleteVersion, refetch };
}

// ==================== SOCIAL SHARES TRACKING ====================
export function trackSocialShare(postId: string, platform: string) {
  const fp = getFingerprint();
  supabase.from('social_shares').insert({ post_id: postId, platform, fingerprint: fp }).then(() => {});
}

export function useSocialShareCounts(postId: string | null) {
  const [counts, setCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!postId) return;
    let cancelled = false;
    const fetch = async () => {
      const { data } = await supabase.from('social_shares').select('platform').eq('post_id', postId);
      if (cancelled) return;
      const c: Record<string, number> = {};
      (data || []).forEach((s: { platform: string }) => { c[s.platform] = (c[s.platform] || 0) + 1; });
      setCounts(c);
    };
    fetch();
    return () => { cancelled = true; };
  }, [postId]);

  return counts;
}

// ==================== COMMENT LIKES ====================
export function useCommentLikes(commentId: string | null) {
  const [count, setCount] = useState(0);
  const [liked, setLiked] = useState(false);

  useEffect(() => {
    if (!commentId) return;
    let cancelled = false;
    const fetch = async () => {
      const { count } = await supabase.from('comment_likes').select('*', { count: 'exact', head: true }).eq('comment_id', commentId);
      if (cancelled) return;
      setCount(count || 0);
      const fp = getFingerprint();
      const { data } = await supabase.from('comment_likes').select('id').eq('comment_id', commentId).eq('fingerprint', fp).maybeSingle();
      if (cancelled) return;
      setLiked(!!data);
    };
    fetch();
    return () => { cancelled = true; };
  }, [commentId]);

  const toggle = useCallback(async () => {
    if (!commentId) return;
    const fp = getFingerprint();
    if (liked) {
      await supabase.from('comment_likes').delete().eq('comment_id', commentId).eq('fingerprint', fp);
      setLiked(false); setCount(c => Math.max(0, c - 1));
    } else {
      await supabase.from('comment_likes').insert({ comment_id: commentId, fingerprint: fp });
      setLiked(true); setCount(c => c + 1);
    }
  }, [commentId, liked]);

  return { count, liked, toggle };
}

// ==================== ARTICLE RATINGS ====================
export function useArticleRating(postId: string | null) {
  const [avgRating, setAvgRating] = useState(0);
  const [totalRatings, setTotalRatings] = useState(0);
  const [userRating, setUserRating] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!postId) { setLoading(false); return; }
    let cancelled = false;
    const fetch = async () => {
      setLoading(true);
      const { data } = await supabase.from('article_ratings').select('rating').eq('post_id', postId);
      if (cancelled) return;
      const ratings = (data || []).map((r: { rating: number }) => r.rating);
      setTotalRatings(ratings.length);
      setAvgRating(ratings.length > 0 ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0);
      const fp = getFingerprint();
      const { data: userData } = await supabase.from('article_ratings').select('rating').eq('post_id', postId).eq('fingerprint', fp).maybeSingle();
      if (cancelled) return;
      if (userData) setUserRating((userData as { rating: number }).rating);
      setLoading(false);
    };
    fetch();
    return () => { cancelled = true; };
  }, [postId]);

  const rate = useCallback(async (rating: number) => {
    if (!postId) return;
    const fp = getFingerprint();
    if (userRating > 0) {
      await supabase.from('article_ratings').update({ rating }).eq('post_id', postId).eq('fingerprint', fp);
    } else {
      await supabase.from('article_ratings').insert({ post_id: postId, fingerprint: fp, rating });
    }
    setUserRating(rating);
    const { data } = await supabase.from('article_ratings').select('rating').eq('post_id', postId);
    const ratings = (data || []).map((r: { rating: number }) => r.rating);
    setTotalRatings(ratings.length);
    setAvgRating(ratings.length > 0 ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0);
  }, [postId, userRating]);

  return { avgRating, totalRatings, userRating, rate, loading };
}

// ==================== USER FEEDBACK ====================
export function useSubmitFeedback() {
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  const submit = useCallback(async (type: string, message: string, email?: string) => {
    setSubmitting(true); setSuccess(false);
    const fp = getFingerprint();
    try {
      await submitForm('feedback', { type, message: message.trim(), email: email?.trim() || null, fingerprint: fp, page_url: window.location.href });
      setSubmitting(false); setSuccess(true); return true;
    } catch {
      setSubmitting(false); return false;
    }
  }, []);

  return { submit, submitting, success };
}

// ==================== REVIEW HELPFULNESS ====================
export function useReviewHelpfulness(reviewId: string | null) {
  const [helpfulCount, setHelpfulCount] = useState(0);
  const [unhelpfulCount, setUnhelpfulCount] = useState(0);
  const [userVote, setUserVote] = useState<boolean | null>(null);

  useEffect(() => {
    if (!reviewId) return;
    let cancelled = false;
    const fetch = async () => {
      const { data } = await supabase.from('review_helpfulness').select('is_helpful').eq('review_id', reviewId);
      if (cancelled) return;
      const votes = (data || []) as { is_helpful: boolean }[];
      setHelpfulCount(votes.filter(v => v.is_helpful).length);
      setUnhelpfulCount(votes.filter(v => !v.is_helpful).length);
      const fp = getFingerprint();
      const { data: userData } = await supabase.from('review_helpfulness').select('is_helpful').eq('review_id', reviewId).eq('fingerprint', fp).maybeSingle();
      if (cancelled) return;
      if (userData) setUserVote((userData as { is_helpful: boolean }).is_helpful);
    };
    fetch();
    return () => { cancelled = true; };
  }, [reviewId]);

  const vote = useCallback(async (isHelpful: boolean) => {
    if (!reviewId) return;
    const fp = getFingerprint();
    if (userVote === isHelpful) {
      await supabase.from('review_helpfulness').delete().eq('review_id', reviewId).eq('fingerprint', fp);
      setUserVote(null);
      if (isHelpful) setHelpfulCount(c => c - 1); else setUnhelpfulCount(c => c - 1);
    } else if (userVote !== null) {
      await supabase.from('review_helpfulness').update({ is_helpful: isHelpful }).eq('review_id', reviewId).eq('fingerprint', fp);
      setUserVote(isHelpful);
      if (isHelpful) { setHelpfulCount(c => c + 1); setUnhelpfulCount(c => c - 1); }
      else { setUnhelpfulCount(c => c + 1); setHelpfulCount(c => c - 1); }
    } else {
      await supabase.from('review_helpfulness').insert({ review_id: reviewId, fingerprint: fp, is_helpful: isHelpful });
      setUserVote(isHelpful);
      if (isHelpful) setHelpfulCount(c => c + 1); else setUnhelpfulCount(c => c + 1);
    }
  }, [reviewId, userVote]);

  return { helpfulCount, unhelpfulCount, userVote, vote };
}

// ==================== GIFT CARDS ====================
export function useValidateGiftCard() {
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validate = useCallback(async (code: string): Promise<{ balance: number } | null> => {
    setValidating(true); setError(null);
    const { data, error: qError } = await supabase.from('gift_cards').select('balance, is_active, expires_at').eq('code', code.toUpperCase().trim()).maybeSingle();
    setValidating(false);
    if (qError || !data) { setError('Invalid gift card code.'); return null; }
    if (!data.is_active) { setError('This gift card is not active.'); return null; }
    if (data.expires_at && new Date(data.expires_at) < new Date()) { setError('This gift card has expired.'); return null; }
    if (data.balance <= 0) { setError('This gift card has no remaining balance.'); return null; }
    return { balance: data.balance };
  }, []);

  return { validate, validating, error };
}

// ==================== PRODUCT BUNDLES ====================
export function useProductBundles() {
  const [bundles, setBundles] = useState<{ id: string; name: string; slug: string; description: string | null; cover_image: string | null; bundle_price: number; items: { product_id: string; product: { id: string; name: string; slug: string; image_url: string | null; price: string } }[] }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const fetch = async () => {
      setLoading(true);
      const { data } = await supabase.from('product_bundles').select('*, items:product_bundle_items(product_id, product:products(id, name, slug, image_url, price))').eq('is_active', true).order('sort_order', { ascending: true });
      if (cancelled) return;
      setBundles((data || []) as typeof bundles);
      setLoading(false);
    };
    fetch();
    return () => { cancelled = true; };
  }, []);

  return { bundles, loading };
}

// ==================== ABANDONED CARTS ====================
export function trackAbandonedCart(items: { id: string; name: string; price: number; quantity: number; image_url: string | null }[]) {
  const fp = getFingerprint();
  supabase.from('abandoned_carts').upsert({
    fingerprint: fp,
    cart_data: JSON.stringify(items),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'fingerprint' }).then(() => {});
}

export function clearAbandonedCart() {
  const fp = getFingerprint();
  supabase.from('abandoned_carts').delete().eq('fingerprint', fp).then(() => {});
}

// ==================== ADMIN ACTIVITY LOG ====================
export function logAdminAction(action: string, entityType?: string, entityId?: string, description?: string) {
  supabase.from('admin_activity_log').insert({
    action, entity_type: entityType || null, entity_id: entityId || null,
    description: description || null, performed_by: 'admin',
  }).then(() => {});
}

export function useAdminActivityLog() {
  const [logs, setLogs] = useState<{ id: string; action: string; entity_type: string | null; entity_id: string | null; description: string | null; performed_by: string | null; created_at: string }[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('admin_activity_log').select('*').order('created_at', { ascending: false }).limit(100);
    setLogs((data || []) as typeof logs);
    setLoading(false);
  }, []);

  useEffect(() => { refetch(); }, [refetch]);

  return { logs, loading, refetch };
}

// ==================== ADMIN: ALL SUBSCRIBERS WITH PREFERENCES ====================
export function useAdminSubscribersWithPrefs() {
  const [subscribers, setSubscribers] = useState<{ id: string; email: string; created_at: string; status: string; preferences: { preferred_categories: string[]; frequency: string } | null }[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    setLoading(true);
    const { data: subs } = await supabase.from('newsletter_subscribers').select('*').order('created_at', { ascending: false });
    if (!subs) { setLoading(false); return; }
    const emails = subs.map(s => s.email);
    const { data: prefs } = await supabase.from('newsletter_preferences').select('email, preferred_categories, frequency').in('email', emails);
    const prefsMap = new Map((prefs || []).map((p: { email: string; preferred_categories: string[]; frequency: string }) => [p.email, p]));
    setSubscribers(subs.map(s => ({ ...s, preferences: prefsMap.get(s.email) || null })) as typeof subscribers);
    setLoading(false);
  }, []);

  useEffect(() => { refetch(); }, [refetch]);

  return { subscribers, loading, refetch };
}

// ==================== ADMIN: PROMO CODES CRUD ====================
export function useAdminPromoCodes() {
  const [codes, setCodes] = useState<{ id: string; code: string; description: string | null; discount_type: string; discount_value: number; is_active: boolean; max_uses: number | null; use_count: number; expires_at: string | null; created_at: string }[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('promo_codes').select('*').order('created_at', { ascending: false });
    setCodes((data || []) as typeof codes);
    setLoading(false);
  }, []);

  useEffect(() => { refetch(); }, [refetch]);

  const create = useCallback(async (code: string, discountType: string, discountValue: number, maxUses?: number, expiresAt?: string, description?: string) => {
    const { error } = await supabase.from('promo_codes').insert({
      code: code.toUpperCase().trim(), discount_type: discountType, discount_value: discountValue,
      max_uses: maxUses || null, expires_at: expiresAt || null, description: description || null, is_active: true,
    });
    if (!error) await refetch();
    return !error;
  }, [refetch]);

  const toggle = useCallback(async (id: string, isActive: boolean) => {
    await supabase.from('promo_codes').update({ is_active: isActive }).eq('id', id);
    await refetch();
  }, [refetch]);

  const remove = useCallback(async (id: string) => {
    await supabase.from('promo_codes').delete().eq('id', id);
    await refetch();
  }, [refetch]);

  return { codes, loading, create, toggle, remove, refetch };
}

// ==================== ADMIN: PRODUCT REVIEWS MODERATION ====================
export function useAdminProductReviews() {
  const [reviews, setReviews] = useState<{ id: string; product_id: string; customer_email: string; author_name: string; rating: number; content: string | null; is_approved: boolean; created_at: string; product: { name: string } | null }[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('admin_reviews').select('*, product:products(name)').order('created_at', { ascending: false });
    setReviews((data || []) as typeof reviews);
    setLoading(false);
  }, []);

  useEffect(() => { refetch(); }, [refetch]);

  const approve = useCallback(async (id: string, approved: boolean) => {
    await supabase.from('product_reviews').update({ is_approved: approved }).eq('id', id);
    await refetch();
  }, [refetch]);

  const remove = useCallback(async (id: string) => {
    await supabase.from('product_reviews').delete().eq('id', id);
    await refetch();
  }, [refetch]);

  return { reviews, loading, approve, remove, refetch };
}

// ==================== ADMIN: POLL MANAGEMENT ====================
export function useAdminPolls() {
  const [polls, setPolls] = useState<{ id: string; post_id: string; question: string; options: string[]; is_active: boolean; created_at: string; post: { title: string; slug: string } | null }[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('article_polls').select('*, post:posts(title, slug)').order('created_at', { ascending: false });
    setPolls((data || []) as typeof polls);
    setLoading(false);
  }, []);

  useEffect(() => { refetch(); }, [refetch]);

  const toggle = useCallback(async (id: string, isActive: boolean) => {
    await supabase.from('article_polls').update({ is_active: isActive }).eq('id', id);
    await refetch();
  }, [refetch]);

  const remove = useCallback(async (id: string) => {
    await supabase.from('article_polls').delete().eq('id', id);
    await refetch();
  }, [refetch]);

  const create = useCallback(async (postId: string, question: string, options: string[]) => {
    const { error } = await supabase.from('article_polls').insert({ post_id: postId, question: question.trim(), options, is_active: true });
    if (!error) await refetch();
    return !error;
  }, [refetch]);

  return { polls, loading, toggle, remove, create, refetch };
}

// ==================== ADMIN: REFUND REQUESTS ====================
export function useAdminRefundRequests() {
  const [refunds, setRefunds] = useState<{ id: string; order_id: string; customer_email: string; reason: string; status: string; amount: number | null; created_at: string; order: { order_number: string } | null }[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('refund_requests').select('*, order:orders(order_number)').order('created_at', { ascending: false });
    setRefunds((data || []) as typeof refunds);
    setLoading(false);
  }, []);

  useEffect(() => { refetch(); }, [refetch]);

  const updateStatus = useCallback(async (id: string, status: string) => {
    await supabase.from('refund_requests').update({ status, resolved_at: new Date().toISOString() }).eq('id', id);
    await refetch();
  }, [refetch]);

  return { refunds, loading, updateStatus, refetch };
}

// ==================== ADMIN: ABANDONED CARTS ====================
export function useAdminAbandonedCarts() {
  const [carts, setCarts] = useState<{ id: string; fingerprint: string; cart_data: string; email: string | null; recovered: boolean; created_at: string; updated_at: string }[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('abandoned_carts').select('*').order('updated_at', { ascending: false }).limit(50);
    setCarts((data || []) as typeof carts);
    setLoading(false);
  }, []);

  useEffect(() => { refetch(); }, [refetch]);

  const markRecovered = useCallback(async (id: string) => {
    await supabase.from('abandoned_carts').update({ recovered: true }).eq('id', id);
    await refetch();
  }, [refetch]);

  return { carts, loading, markRecovered, refetch };
}

// ==================== ADMIN: USER FEEDBACK ====================
export function useAdminFeedback() {
  const [feedback, setFeedback] = useState<{ id: string; type: string; message: string; page_url: string | null; email: string | null; created_at: string }[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('user_feedback').select('*').order('created_at', { ascending: false }).limit(100);
    setFeedback((data || []) as typeof feedback);
    setLoading(false);
  }, []);

  useEffect(() => { refetch(); }, [refetch]);

  const remove = useCallback(async (id: string) => {
    await supabase.from('user_feedback').delete().eq('id', id);
    await refetch();
  }, [refetch]);

  return { feedback, loading, remove, refetch };
}

// ==================== ADMIN: GIFT CARDS ====================
export function useAdminGiftCards() {
  const [cards, setCards] = useState<{ id: string; code: string; initial_balance: number; balance: number; buyer_email: string | null; recipient_email: string | null; is_active: boolean; expires_at: string | null; created_at: string }[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('gift_cards').select('*').order('created_at', { ascending: false });
    setCards((data || []) as typeof cards);
    setLoading(false);
  }, []);

  useEffect(() => { refetch(); }, [refetch]);

  const create = useCallback(async (code: string, balance: number, buyerEmail?: string, recipientEmail?: string, message?: string) => {
    const { error } = await supabase.from('gift_cards').insert({
      code: code.toUpperCase().trim(), initial_balance: balance, balance,
      buyer_email: buyerEmail || null, recipient_email: recipientEmail || null, message: message || null,
      is_active: true,
    });
    if (!error) await refetch();
    return !error;
  }, [refetch]);

  const remove = useCallback(async (id: string) => {
    await supabase.from('gift_cards').delete().eq('id', id);
    await refetch();
  }, [refetch]);

  return { cards, loading, create, remove, refetch };
}

// ==================== ADMIN: SOCIAL SHARES ANALYTICS ====================
export function useAdminSocialShares() {
  const [stats, setStats] = useState<{ platform: string; count: number }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const fetch = async () => {
      setLoading(true);
      const { data } = await supabase.from('social_shares').select('platform');
      if (cancelled) return;
      const counts: Record<string, number> = {};
      (data || []).forEach((s: { platform: string }) => { counts[s.platform] = (counts[s.platform] || 0) + 1; });
      setStats(Object.entries(counts).map(([platform, count]) => ({ platform, count })).sort((a, b) => b.count - a.count));
      setLoading(false);
    };
    fetch();
    return () => { cancelled = true; };
  }, []);

  return { stats, loading };
}

// ==================== TAG SUGGESTIONS ====================
const COMMON_TAGS = [
  'skincare', 'retinol', 'vitamin c', 'hyaluronic acid', 'sunscreen', 'cleanser',
  'moisturizer', 'serum', 'exfoliation', 'acne', 'anti-aging', 'hydration',
  'style', 'capsule wardrobe', 'minimalist', 'sustainable', 'fashion', 'outfit',
  'wellness', 'sleep', 'nutrition', 'mindfulness', 'meditation', 'exercise',
  'stress', 'mental health', 'self-care', 'routine', 'morning routine', 'evening routine',
  'ingredients', 'dermatology', 'beauty', 'lifestyle', 'intentional living', 'slow living',
];

export function suggestTags(content: string, existingTags: string[]): string[] {
  const lower = content.toLowerCase();
  const words = lower.split(/\s+/);
  const wordFreq: Record<string, number> = {};
  words.forEach(w => {
    const clean = w.replace(/[^a-z]/g, '');
    if (clean.length > 3) wordFreq[clean] = (wordFreq[clean] || 0) + 1;
  });

  const suggested = COMMON_TAGS.filter(tag => {
    if (existingTags.includes(tag)) return false;
    return lower.includes(tag);
  });

  const freqTags = Object.entries(wordFreq)
    .filter(([, freq]) => freq >= 3)
    .filter(([word]) => !existingTags.includes(word) && word.length > 4)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([word]) => word);

  return [...new Set([...suggested, ...freqTags])].slice(0, 10);
}

// ==================== MOST READ THIS WEEK ====================
export function useMostReadThisWeek() {
  const [posts, setPosts] = useState<{ id: string; title: string; slug: string; cover_image: string | null; category: { name: string; slug: string } | null }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const fetch = async () => {
      setLoading(true);
      const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
      const { data } = await supabase.from('article_views').select('post_id, post:posts(id, title, slug, cover_image, category:categories(name, slug))').gt('created_at', sevenDaysAgo).order('created_at', { ascending: false });
      if (cancelled) return;
      const viewCount: Record<string, number> = {};
      const postMap: Record<string, { id: string; title: string; slug: string; cover_image: string | null; category: { name: string; slug: string } | null }> = {};
      rows<{ post_id: string; post: { id: string; title: string; slug: string; cover_image: string | null; category: { name: string; slug: string } | null } | null }>(data).forEach((v) => {
        if (!v.post) return;
        viewCount[v.post_id] = (viewCount[v.post_id] || 0) + 1;
        postMap[v.post_id] = v.post;
      });
      const sorted = Object.entries(viewCount).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id]) => postMap[id]).filter(Boolean);
      setPosts(sorted);
      setLoading(false);
    };
    fetch();
    return () => { cancelled = true; };
  }, []);

  return { posts, loading };
}

// ==================== RANDOM ARTICLE ====================
export function useRandomArticle() {
  const [loading, setLoading] = useState(false);

  const getRandom = useCallback(async (): Promise<{ slug: string } | null> => {
    setLoading(true);
    const { count } = await supabase.from('posts').select('*', { count: 'exact', head: true }).eq('status', 'published');
    if (!count || count === 0) { setLoading(false); return null; }
    const randomOffset = Math.floor(Math.random() * count);
    const { data } = await supabase.from('posts').select('slug').eq('status', 'published').range(randomOffset, randomOffset).maybeSingle();
    setLoading(false);
    return data as { slug: string } | null;
  }, []);

  return { getRandom, loading };
}
