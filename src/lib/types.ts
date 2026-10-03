export interface Category {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  sort_order: number;
  banner_image: string | null;
  seo_title: string | null;
  seo_description: string | null;
  is_active: boolean;
}

export interface Author {
  id: string;
  name: string;
  slug: string;
  bio: string | null;
  avatar_url: string | null;
  role: string | null;
  social_links: { twitter?: string; instagram?: string; linkedin?: string; website?: string } | null;
  is_active: boolean;
}

export type PostStatus = 'draft' | 'scheduled' | 'published' | 'archived';

export interface Post {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  content: string | null;
  cover_image: string | null;
  cover_image_alt: string | null;
  category_id: string | null;
  author_id: string | null;
  published_at: string;
  scheduled_at: string | null;
  reading_time_minutes: number;
  featured: boolean;
  editors_pick: boolean;
  tags: string[];
  status: PostStatus;
  seo_title: string | null;
  seo_description: string | null;
  canonical_url: string | null;
  created_at: string;
  updated_at: string;
  category?: Category | null;
  author?: Author | null;
  // v3
  takeaways?: string[] | null;
  alt_title?: string | null;
  faq?: { q: string; a: string }[] | null;
  series_id?: string | null;
  series_order?: number | null;
  allow_comments?: boolean;
  view_count?: number;
}

export interface ArticleSeries {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  cover_image: string | null;
  is_active: boolean;
  created_at: string;
}

export interface GlossaryTerm {
  id: string;
  term: string;
  slug: string;
  definition: string;
  category: string | null;
  created_at: string;
}

export interface ArticleQuestion {
  id: string;
  post_id: string;
  author_name: string;
  author_email?: string;
  question: string;
  answer: string | null;
  answered_by: string | null;
  answered_at: string | null;
  is_public: boolean;
  upvotes: number;
  created_at: string;
}

export interface UserProfile {
  user_id: string;
  display_name: string | null;
  handle: string | null;
  bio: string | null;
  is_public: boolean;
  preferred_categories: string[];
  font_size: string;
  theme: string;
  created_at: string;
  updated_at: string;
}

export interface SiteSetting {
  key: string;
  value: Record<string, unknown>;
  is_public: boolean;
  updated_at?: string;
}

export interface MediaItem {
  id: string;
  url: string;
  alt_text: string | null;
  title: string | null;
  caption: string | null;
  file_name: string | null;
  file_size: number | null;
  mime_type: string | null;
  width: number | null;
  height: number | null;
  created_at: string;
}

export interface RelatedArticle {
  id: string;
  post_id: string;
  related_post_id: string;
  sort_order: number;
}

export type ProductType = 'digital' | 'affiliate' | 'physical' | 'sponsored';

export interface Product {
  id: string;
  name: string;
  brand: string | null;
  description: string | null;
  image_url: string | null;
  price: string | null;
  affiliate_url: string | null;
  category: string | null;
  slug: string | null;
  what_it_is: string | null;
  what_its_used_for: string | null;
  why_we_recommend: string | null;
  key_ingredients: string | null;
  is_digital: boolean;
  file_path: string | null;
  preview_file_path: string | null;
  currency: string | null;
  sku: string | null;
  product_type: ProductType | string;
  is_featured: boolean;
  is_active: boolean;
  sort_order: number;
  what_is_included: string | null;
  seo_title: string | null;
  seo_description: string | null;
  shop_category_id: string | null;
  updated_at: string;
  sponsor_name: string | null;
  is_sponsored: boolean;
  disclosure_text: string | null;
  created_at: string;
  tags: string[] | null;
  // v3
  price_cents?: number | null;
  pay_what_you_want?: boolean;
  min_price_cents?: number | null;
  compare_attributes?: Record<string, string | number | boolean> | null;
  stock_status?: 'in_stock' | 'low' | 'out_of_stock' | 'coming_soon';
  gallery?: string[] | null;
}

export interface ProductBundle {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  bundle_price: number;
  is_active: boolean;
  items?: { product: Product }[];
}

export interface Comment {
  id: string;
  post_id: string;
  parent_id: string | null;
  author_name: string;
  author_email: string;
  content: string;
  is_visible: boolean;
  is_approved: boolean;
  admin_reply: boolean;
  created_at: string;
  replies?: Comment[];
}

export interface ShopCategory {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  sort_order: number;
  is_active: boolean;
}

export interface Collection {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  cover_image: string | null;
  is_featured: boolean;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  items?: CollectionItem[];
}

export interface CollectionItem {
  id: string;
  collection_id: string;
  post_id: string;
  sort_order: number;
  post?: PostWithRelations;
}

export interface Order {
  id: string;
  order_number: string;
  customer_email: string;
  customer_name: string | null;
  status: string;
  payment_status: string;
  payment_reference: string | null;
  payment_provider: string;
  amount: number;
  currency: string;
  subtotal?: number | null;
  discount_amount?: number;
  promo_code?: string | null;
  gift_card_code?: string | null;
  gift_card_amount?: number;
  paid_at?: string | null;
  meta?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  items?: OrderItem[];
}

export interface OrderItem {
  id: string;
  order_id: string;
  product_id: string | null;
  product_name: string;
  product_slug: string | null;
  price: number;
  quantity: number;
  file_path: string | null;
}

export interface Customer {
  id: string;
  email: string;
  name: string | null;
  created_at: string;
  updated_at: string;
}

export interface DownloadEntitlement {
  id: string;
  order_id: string;
  customer_email: string;
  product_id: string;
  file_path: string;
  download_token: string;
  download_count: number;
  max_downloads: number;
  expires_at: string | null;
  created_at: string;
  product?: Product;
}

export interface SponsoredContent {
  id: string;
  post_id: string;
  sponsor_name: string;
  campaign_name: string | null;
  start_date: string | null;
  end_date: string | null;
  is_active: boolean;
}

export interface NewsletterSubscriber {
  id: string;
  email: string;
  created_at: string;
  status: string;
  source: string | null;
  updated_at: string;
}

export interface PromoCode {
  id: string;
  code: string;
  description: string | null;
  discount_type: 'percentage' | 'fixed';
  discount_value: number;
  is_active: boolean;
  max_uses: number | null;
  use_count: number;
  expires_at: string | null;
  created_at: string;
}

export interface ProductReview {
  id: string;
  product_id: string;
  customer_email?: string; // admin-only (column revoked from public roles)
  author_name: string;
  rating: number;
  content: string | null;
  is_approved: boolean;
  created_at: string;
}

export interface ArticlePoll {
  id: string;
  post_id: string;
  question: string;
  options: string[];
  is_active: boolean;
  created_at: string;
}

export interface ArticleReaction {
  reaction_type: 'love' | 'insightful' | 'inspiring' | 'save';
  count: number;
}

export interface NewsletterPreference {
  id: string;
  email: string;
  preferred_categories: string[];
  frequency: 'daily' | 'weekly';
  updated_at: string;
}

export type PostWithRelations = Post & {
  category: Category | null;
  author: Author | null;
};
