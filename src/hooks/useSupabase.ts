import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import type { PostWithRelations, Category, Product } from '../lib/types';

export function usePosts() {
  const [posts, setPosts] = useState<PostWithRelations[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const fetchPosts = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('posts')
        .select(`
          *,
          category:categories(*),
          author:authors(*)
        `)
        .order('published_at', { ascending: false });

      if (cancelled) return;
      if (error) {
        setError(error.message);
      } else {
        setPosts((data || []) as PostWithRelations[]);
      }
      setLoading(false);
    };
    fetchPosts();
    return () => { cancelled = true; };
  }, []);

  return { posts, loading, error };
}

export function usePostBySlug(slug: string | null) {
  const [post, setPost] = useState<PostWithRelations | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    const fetchPost = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('posts')
        .select(`
          *,
          category:categories(*),
          author:authors(*)
        `)
        .eq('slug', slug)
        .maybeSingle();

      if (cancelled) return;
      if (error) {
        setError(error.message);
      } else {
        setPost(data as PostWithRelations | null);
      }
      setLoading(false);
    };
    fetchPost();
    return () => { cancelled = true; };
  }, [slug]);

  return { post, loading, error };
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
