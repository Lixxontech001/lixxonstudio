export interface Category {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  sort_order: number;
}

export interface Author {
  id: string;
  name: string;
  slug: string;
  bio: string | null;
  avatar_url: string | null;
  role: string | null;
}

export interface Post {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  content: string | null;
  cover_image: string | null;
  category_id: string | null;
  author_id: string | null;
  published_at: string;
  reading_time_minutes: number;
  featured: boolean;
  editors_pick: boolean;
  tags: string[];
  category?: Category | null;
  author?: Author | null;
}

export interface Product {
  id: string;
  name: string;
  brand: string | null;
  description: string | null;
  image_url: string | null;
  price: string | null;
  affiliate_url: string | null;
  category: string | null;
}

export type PostWithRelations = Post & {
  category: Category | null;
  author: Author | null;
};
