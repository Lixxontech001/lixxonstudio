import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';
import type { Product, ShopCategory, Collection, Order, DownloadEntitlement, NewsletterSubscriber } from '../lib/types';

// ==================== PUBLIC COMMERCE HOOKS ====================

export function useShopProducts(categorySlug?: string | null) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const fetch = async () => {
      setLoading(true);
      let query = supabase
        .from('products')
        .select('*')
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: false });

      if (categorySlug) {
        const { data: catData } = await supabase
          .from('shop_categories')
          .select('id')
          .eq('slug', categorySlug)
          .maybeSingle();
        if (catData) {
          query = query.eq('shop_category_id', catData.id);
        }
      }

      const { data } = await query;
      if (cancelled) return;
      setProducts((data || []) as Product[]);
      setLoading(false);
    };
    fetch();
    return () => { cancelled = true; };
  }, [categorySlug]);

  return { products, loading };
}

export function useShopProduct(slug: string | null) {
  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!slug) { setLoading(false); return; }
    let cancelled = false;
    const fetch = async () => {
      setLoading(true);
      const { data } = await supabase
        .from('products')
        .select('*')
        .eq('slug', slug)
        .eq('is_active', true)
        .maybeSingle();
      if (cancelled) return;
      setProduct(data as Product | null);
      setLoading(false);
    };
    fetch();
    return () => { cancelled = true; };
  }, [slug]);

  return { product, loading };
}

export function useShopCategories() {
  const [categories, setCategories] = useState<ShopCategory[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const fetch = async () => {
      const { data } = await supabase
        .from('shop_categories')
        .select('*')
        .eq('is_active', true)
        .order('sort_order', { ascending: true });
      if (cancelled) return;
      setCategories((data || []) as ShopCategory[]);
      setLoading(false);
    };
    fetch();
    return () => { cancelled = true; };
  }, []);

  return { categories, loading };
}

export function useFeaturedShopProducts() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const fetch = async () => {
      const { data } = await supabase
        .from('products')
        .select('*')
        .eq('is_active', true)
        .eq('is_featured', true)
        .order('sort_order', { ascending: true })
        .limit(4);
      if (cancelled) return;
      setProducts((data || []) as Product[]);
      setLoading(false);
    };
    fetch();
    return () => { cancelled = true; };
  }, []);

  return { products, loading };
}

export function useCollections() {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const fetch = async () => {
      const { data } = await supabase
        .from('collections')
        .select('*')
        .eq('is_active', true)
        .order('sort_order', { ascending: true });
      if (cancelled) return;
      setCollections((data || []) as Collection[]);
      setLoading(false);
    };
    fetch();
    return () => { cancelled = true; };
  }, []);

  return { collections, loading };
}

export function useCollection(slug: string | null) {
  const [collection, setCollection] = useState<Collection | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!slug) { setLoading(false); return; }
    let cancelled = false;
    const fetch = async () => {
      setLoading(true);
      const { data } = await supabase
        .from('collections')
        .select('*, items:collection_items(*, post:posts(*, category:categories(*), author:authors(*)))')
        .eq('slug', slug)
        .eq('is_active', true)
        .maybeSingle();
      if (cancelled) return;
      if (data) {
        const sorted = (data.items || []).sort((a: { sort_order: number }, b: { sort_order: number }) => a.sort_order - b.sort_order);
        setCollection({ ...data, items: sorted });
      } else {
        setCollection(null);
      }
      setLoading(false);
    };
    fetch();
    return () => { cancelled = true; };
  }, [slug]);

  return { collection, loading };
}

export function useArticleProducts(postId: string | null) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!postId) { setLoading(false); return; }
    let cancelled = false;
    const fetch = async () => {
      setLoading(true);
      const { data } = await supabase
        .from('article_products')
        .select('product:products(*)')
        .eq('post_id', postId)
        .order('sort_order', { ascending: true });
      if (cancelled) return;
      const items = (data || []).map((r: { product: Product }) => r.product).filter(Boolean) as Product[];
      setProducts(items);
      setLoading(false);
    };
    fetch();
    return () => { cancelled = true; };
  }, [postId]);

  return { products, loading };
}

// ==================== ORDER / DOWNLOAD HOOKS ====================

export function useCustomerOrders(email: string | null) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!email) { setLoading(false); return; }
    let cancelled = false;
    const fetch = async () => {
      setLoading(true);
      const { data } = await supabase
        .from('orders')
        .select('*, items:order_items(*)')
        .eq('customer_email', email)
        .order('created_at', { ascending: false });
      if (cancelled) return;
      setOrders((data || []) as Order[]);
      setLoading(false);
    };
    fetch();
    return () => { cancelled = true; };
  }, [email]);

  return { orders, loading };
}

export function useDownloadEntitlements(email: string | null) {
  const [entitlements, setEntitlements] = useState<DownloadEntitlement[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!email) { setLoading(false); return; }
    let cancelled = false;
    const fetch = async () => {
      setLoading(true);
      const { data } = await supabase
        .from('download_entitlements')
        .select('*, product:products(*)')
        .eq('customer_email', email)
        .order('created_at', { ascending: false });
      if (cancelled) return;
      setEntitlements((data || []) as DownloadEntitlement[]);
      setLoading(false);
    };
    fetch();
    return () => { cancelled = true; };
  }, [email]);

  return { entitlements, loading };
}

export function trackArticleView(postId: string) {
  try {
    supabase.from('article_views').insert({ post_id: postId }).then(() => {});
  } catch { /* non-critical */ }
}

export function trackProductClick(productId: string, source?: string) {
  try {
    supabase.from('product_clicks').insert({ product_id: productId, source }).then(() => {});
  } catch { /* non-critical */ }
}

// ==================== ADMIN COMMERCE HOOKS ====================

export function useAdminProducts() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const fetch = async () => {
      const { data } = await supabase
        .from('products')
        .select('*')
        .order('created_at', { ascending: false });
      if (cancelled) return;
      setProducts((data || []) as Product[]);
      setLoading(false);
    };
    fetch();
    return () => { cancelled = true; };
  }, []);

  return { products, loading, setProducts };
}

export function useAdminOrders() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('orders')
      .select('*, items:order_items(*)')
      .order('created_at', { ascending: false });
    setOrders((data || []) as Order[]);
    setLoading(false);
  }, []);

  useEffect(() => { refetch(); }, [refetch]);

  return { orders, loading, refetch };
}

export function useAdminCustomers() {
  const [customers, setCustomers] = useState<{ id: string; email: string; name: string | null; created_at: string; updated_at: string }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const fetch = async () => {
      const { data } = await supabase
        .from('customers')
        .select('*')
        .order('created_at', { ascending: false });
      if (cancelled) return;
      setCustomers(data || []);
      setLoading(false);
    };
    fetch();
    return () => { cancelled = true; };
  }, []);

  return { customers, loading };
}

export function useAdminNewsletterSubscribers() {
  const [subscribers, setSubscribers] = useState<NewsletterSubscriber[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const fetch = async () => {
      const { data } = await supabase
        .from('newsletter_subscribers')
        .select('*')
        .order('created_at', { ascending: false });
      if (cancelled) return;
      setSubscribers((data || []) as NewsletterSubscriber[]);
      setLoading(false);
    };
    fetch();
    return () => { cancelled = true; };
  }, []);

  return { subscribers, loading };
}

export function useAdminCollections() {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const fetch = async () => {
      const { data } = await supabase
        .from('collections')
        .select('*')
        .order('sort_order', { ascending: true });
      if (cancelled) return;
      setCollections((data || []) as Collection[]);
      setLoading(false);
    };
    fetch();
    return () => { cancelled = true; };
  }, []);

  return { collections, loading, setCollections };
}

export function useAdminAnalytics() {
  const [data, setData] = useState({
    totalViews: 0,
    totalLikes: 0,
    totalComments: 0,
    totalProductClicks: 0,
    topArticles: [] as { title: string; slug: string; views: number }[],
    recentViews: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const fetch = async () => {
      setLoading(true);
      const [viewsR, likesR, commentsR, clicksR] = await Promise.all([
        supabase.from('article_views').select('*', { count: 'exact', head: true }),
        supabase.from('article_likes').select('*', { count: 'exact', head: true }),
        supabase.from('comments').select('*', { count: 'exact', head: true }),
        supabase.from('product_clicks').select('*', { count: 'exact', head: true }),
      ]);

      // Top articles by views
      const { data: topData } = await supabase
        .from('article_views')
        .select('post_id, post:posts(title, slug)')
        .order('created_at', { ascending: false })
        .limit(500);

      const viewCounts = new Map<string, { title: string; slug: string; views: number }>();
      (topData || []).forEach((r: { post_id: string; post?: { title: string; slug: string } }) => {
        if (!r.post_id || !r.post) return;
        const existing = viewCounts.get(r.post_id);
        if (existing) {
          existing.views++;
        } else {
          viewCounts.set(r.post_id, { title: r.post.title, slug: r.post.slug, views: 1 });
        }
      });
      const topArticles = Array.from(viewCounts.values()).sort((a, b) => b.views - a.views).slice(0, 10);

      if (cancelled) return;
      setData({
        totalViews: viewsR.count || 0,
        totalLikes: likesR.count || 0,
        totalComments: commentsR.count || 0,
        totalProductClicks: clicksR.count || 0,
        topArticles,
        recentViews: viewsR.count || 0,
      });
      setLoading(false);
    };
    fetch();
    return () => { cancelled = true; };
  }, []);

  return { data, loading };
}
