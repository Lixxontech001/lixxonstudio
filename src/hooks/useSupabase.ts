import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';
import type { PostWithRelations, Category, Product, Author, Comment, MediaItem } from '../lib/types';

const PAGE_SIZE = 9;

interface PaginatedResult {
  posts: PostWithRelations[];
  total: number;
  totalPages: number;
  loading: boolean;
  error: string | null;
  retry: () => void;
}

export function usePaginatedPosts(categorySlug: string | null, page: number): PaginatedResult {
  const [posts, setPosts] = useState<PostWithRelations[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const fetchPage = async () => {
      setLoading(true);
      setError(null);
      const from = (page - 1) * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      try {
        let query = supabase
          .from('posts')
          .select('*, category:categories(*), author:authors(*)', { count: 'exact' })
          .eq('status', 'published')
          .order('published_at', { ascending: false })
          .range(from, to);

        if (categorySlug) {
          const { data: catData, error: categoryError } = await supabase
            .from('categories')
            .select('id')
            .eq('slug', categorySlug)
            .maybeSingle();
          if (categoryError) throw categoryError;
          if (catData) {
            query = query.eq('category_id', catData.id);
          }
        }

        const { data, count, error: queryError } = await query;
        if (cancelled) return;
        if (queryError) throw queryError;
        setPosts((data || []) as PostWithRelations[]);
        setTotal(count || 0);
      } catch (fetchError) {
        if (!cancelled) {
          setError(fetchError instanceof Error ? fetchError.message : 'Unable to load stories.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchPage();
    return () => { cancelled = true; };
  }, [categorySlug, page, retryKey]);

  const retry = useCallback(() => setRetryKey((key) => key + 1), []);

  return {
    posts,
    total,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    loading,
    error,
    retry,
  };
}

interface SearchResult {
  posts: PostWithRelations[];
  total: number;
  totalPages: number;
  loading: boolean;
}

export function useSearchPosts(query: string, page: number): SearchResult {
  const [posts, setPosts] = useState<PostWithRelations[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const search = async () => {
      if (!query.trim()) {
        setPosts([]);
        setTotal(0);
        setLoading(false);
        return;
      }
      setLoading(true);
      const from = (page - 1) * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      const searchTerm = query.trim();

      const { data, count, error } = await supabase
        .from('posts')
        .select('*, category:categories(*), author:authors(*)', { count: 'exact' })
        .eq('status', 'published')
        .or(`title.ilike.%${searchTerm}%,excerpt.ilike.%${searchTerm}%`)
        .order('published_at', { ascending: false })
        .range(from, to);

      if (cancelled) return;
      if (!error && data) {
        setPosts(data as PostWithRelations[]);
        setTotal(count || 0);
      }
      setLoading(false);
    };
    search();
    return () => { cancelled = false; };
  }, [query, page]);

  return {
    posts,
    total,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    loading,
  };
}

export function usePosts() {
  const [posts, setPosts] = useState<PostWithRelations[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const fetchPosts = async () => {
      setLoading(true);
      setError(null);
      try {
        const { data, error: queryError } = await supabase
          .from('posts')
          .select('*, category:categories(*), author:authors(*)')
          .eq('status', 'published')
          .order('published_at', { ascending: false });
        if (cancelled) return;
        if (queryError) throw queryError;
        setPosts((data || []) as PostWithRelations[]);
      } catch (fetchError) {
        if (!cancelled) {
          setError(fetchError instanceof Error ? fetchError.message : 'Unable to load stories.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchPosts();
    return () => { cancelled = true; };
  }, [retryKey]);

  const retry = useCallback(() => setRetryKey((key) => key + 1), []);

  return { posts, loading, error, retry };
}

export function usePostBySlug(slug: string | null) {
  const [post, setPost] = useState<PostWithRelations | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!slug) { setLoading(false); return; }
    let cancelled = false;
    const fetchPost = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('posts')
        .select('*, category:categories(*), author:authors(*)')
        .eq('slug', slug)
        .maybeSingle();
      if (cancelled) return;
      if (!error) setPost(data as PostWithRelations | null);
      setLoading(false);
    };
    fetchPost();
    return () => { cancelled = true; };
  }, [slug]);

  return { post, loading };
}

export function useCategories() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const fetchCategories = async () => {
      const { data } = await supabase
        .from('categories')
        .select('*')
        .order('sort_order', { ascending: true });
      if (cancelled) return;
      setCategories(data || []);
      setLoading(false);
    };
    fetchCategories();
    return () => { cancelled = true; };
  }, []);

  return { categories, loading };
}

export function useProducts() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const fetchProducts = async () => {
      const { data } = await supabase
        .from('products')
        .select('*')
        .eq('is_active', true)
        .order('created_at', { ascending: false });
      if (cancelled) return;
      setProducts(data || []);
      setLoading(false);
    };
    fetchProducts();
    return () => { cancelled = true; };
  }, []);

  return { products, loading };
}

export function useLikeCount(postId: string | null) {
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!postId) { setLoading(false); return; }
    let cancelled = false;
    const fetchCount = async () => {
      const { count } = await supabase
        .from('article_likes')
        .select('*', { count: 'exact', head: true })
        .eq('post_id', postId);
      if (cancelled) return;
      setCount(count || 0);
      setLoading(false);
    };
    fetchCount();
    return () => { cancelled = true; };
  }, [postId]);

  return { count, setCount, loading };
}

export function useLike(postId: string | null) {
  const { count, setCount, loading } = useLikeCount(postId);
  const [liked, setLiked] = useState(false);

  useEffect(() => {
    if (!postId) return;
    const key = `liked_${postId}`;
    setLiked(localStorage.getItem(key) === '1');
  }, [postId]);

  const toggleLike = useCallback(async () => {
    if (!postId) return;
    const fingerprint = getFingerprint();
    const key = `liked_${postId}`;
    const isLiked = localStorage.getItem(key) === '1';

    if (isLiked) {
      setLiked(false);
      localStorage.removeItem(key);
      setCount(c => Math.max(0, c - 1));
      await supabase.from('article_likes')
        .delete()
        .eq('post_id', postId)
        .eq('fingerprint', fingerprint);
    } else {
      setLiked(true);
      localStorage.setItem(key, '1');
      setCount(c => c + 1);
      await supabase.from('article_likes')
        .insert({ post_id: postId, fingerprint });
    }
  }, [postId, setCount]);

  return { count, liked, toggleLike, loading };
}

function getFingerprint(): string {
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

// ==================== ADMIN HOOKS ====================

export function useAdminPosts(page: number, filters: { status?: string; category?: string; search?: string }) {
  const [posts, setPosts] = useState<PostWithRelations[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const fetchPosts = async () => {
      setLoading(true);
      const from = (page - 1) * 15;
      const to = from + 14;

      let query = supabase
        .from('posts')
        .select('*, category:categories(*), author:authors(*)', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(from, to);

      if (filters.status && filters.status !== 'all') {
        query = query.eq('status', filters.status);
      }
      if (filters.category && filters.category !== 'all') {
        query = query.eq('category_id', filters.category);
      }
      if (filters.search) {
        query = query.ilike('title', `%${filters.search}%`);
      }

      const { data, count, error } = await query;
      if (cancelled) return;
      if (!error && data) {
        setPosts(data as PostWithRelations[]);
        setTotal(count || 0);
      }
      setLoading(false);
    };
    fetchPosts();
    return () => { cancelled = true; };
  }, [page, filters.status, filters.category, filters.search]);

  return {
    posts,
    total,
    totalPages: Math.max(1, Math.ceil(total / 15)),
    loading,
  };
}

export function useAdminPost(id: string | null) {
  const [post, setPost] = useState<PostWithRelations | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) { setLoading(false); return; }
    let cancelled = false;
    const fetchPost = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('posts')
        .select('*, category:categories(*), author:authors(*)')
        .eq('id', id)
        .maybeSingle();
      if (cancelled) return;
      if (!error) setPost(data as PostWithRelations | null);
      setLoading(false);
    };
    fetchPost();
    return () => { cancelled = true; };
  }, [id]);

  return { post, loading };
}

export function useAdminAuthors() {
  const [authors, setAuthors] = useState<Author[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const fetchAuthors = async () => {
      const { data } = await supabase
        .from('authors')
        .select('*')
        .order('created_at', { ascending: true });
      if (cancelled) return;
      setAuthors(data || []);
      setLoading(false);
    };
    fetchAuthors();
    return () => { cancelled = true; };
  }, []);

  return { authors, loading };
}

export type AdminComment = Comment & { post: { title: string; slug: string } | null };

export function useAdminComments(page: number) {
  const [comments, setComments] = useState<AdminComment[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const fetchComments = async () => {
      setLoading(true);
      const from = (page - 1) * 20;
      const to = from + 19;
      const { data, count } = await supabase
        .from('admin_comments')
        .select('*, post:posts(title,slug)', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(from, to);
      if (cancelled) return;
      setComments((data || []) as unknown as AdminComment[]);
      setTotal(count || 0);
      setLoading(false);
    };
    fetchComments();
    return () => { cancelled = true; };
  }, [page]);

  return {
    comments,
    total,
    totalPages: Math.max(1, Math.ceil(total / 20)),
    loading,
  };
}

export function useAdminMedia() {
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const fetchMedia = async () => {
      const { data } = await supabase
        .from('media')
        .select('*')
        .order('created_at', { ascending: false });
      if (cancelled) return;
      setMedia(data || []);
      setLoading(false);
    };
    fetchMedia();
    return () => { cancelled = true; };
  }, []);

  return { media, loading, setMedia };
}

export function useDashboardStats() {
  const [stats, setStats] = useState({
    total: 0,
    published: 0,
    drafts: 0,
    scheduled: 0,
    categories: 0,
    pendingComments: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const fetchStats = async () => {
      const [totalR, publishedR, draftsR, scheduledR, catR, commentsR] = await Promise.all([
        supabase.from('posts').select('*', { count: 'exact', head: true }),
        supabase.from('posts').select('*', { count: 'exact', head: true }).eq('status', 'published'),
        supabase.from('posts').select('*', { count: 'exact', head: true }).eq('status', 'draft'),
        supabase.from('posts').select('*', { count: 'exact', head: true }).eq('status', 'scheduled'),
        supabase.from('categories').select('*', { count: 'exact', head: true }),
        supabase.from('admin_comments').select('id', { count: 'exact', head: true }).eq('is_approved', false),
      ]);
      if (cancelled) return;
      setStats({
        total: totalR.count || 0,
        published: publishedR.count || 0,
        drafts: draftsR.count || 0,
        scheduled: scheduledR.count || 0,
        categories: catR.count || 0,
        pendingComments: commentsR.count || 0,
      });
      setLoading(false);
    };
    fetchStats();
    return () => { cancelled = true; };
  }, []);

  return { stats, loading };
}
