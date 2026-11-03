export type TrendingCategory = 'all' | 'skincare' | 'fashion' | 'wellness' | 'others';
export type TrendingItemType = 'product' | 'debate' | 'ingredient' | 'update';

export interface TrendingMetadata {
  // Product spotlight
  brand?: string;
  badge?: string;
  why_trending?: string;
  rating_score?: number;
  affiliate_url?: string;
  price?: string;

  // Community discussion & debates
  topic_headline?: string;
  counter_arguments?: string;
  community_takeaway?: string;
  discussion_url?: string;

  // Ingredient & science argument
  controversy?: string;
  consensus?: string;
  study_summary?: string;
  study_url?: string;

  // Editorial breaking update
  source_name?: string;
  source_url?: string;
  timestamp_label?: string;
}

export interface TrendingItem {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  content?: string;
  category: TrendingCategory;
  item_type: TrendingItemType;
  metadata: TrendingMetadata;
  destination_url: string;
  cover_image: string;
  upvotes: number;
  views_count: number;
  clicks_count: number;
  read_time_minutes: number;
  priority_order: number;
  is_pinned: boolean;
  is_archived: boolean;
  expires_at: string | null;
  created_at: string;
  updated_at?: string;
}
