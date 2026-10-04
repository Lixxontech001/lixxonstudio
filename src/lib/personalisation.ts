export interface ContinueReadingItem {
  post_id: string;
  slug: string;
  title: string;
  cover_image: string | null;
  category_name: string | null;
  reading_time_minutes: number;
  progress_percent: number;
  updated_at: string;
  source: 'progress' | 'recent' | string;
}

export interface ReaderTopCategory {
  name: string;
  slug: string;
  count: number;
}

export interface ReaderInsights {
  articles_read: number;
  days_active: number;
  current_streak: number;
  longest_streak: number;
  minutes_read: number;
  top_categories: ReaderTopCategory[];
  first_read_day: string;
  last_read_day: string;
}

export interface ForYouItem {
  post_id: string;
  slug: string;
  title: string;
  excerpt: string;
  cover_image: string | null;
  category_name: string | null;
  category_slug: string | null;
  author_name: string | null;
  published_at: string;
  reading_time_minutes: number;
  reason: string;
  score: number;
}

export function progressLabel(percent: number, source?: string): string {
  if (source === 'recent') return 'Just opened';
  const value = Math.max(0, Math.min(100, Math.round(Number.isFinite(percent) ? percent : 0)));
  if (value >= 95) return 'Finished';
  if (value <= 0) return 'Just started';
  return `${value}% through`;
}

export function insightsSummary(insights: Pick<ReaderInsights, 'articles_read' | 'minutes_read' | 'days_active'>): string {
  const articles = Math.max(0, insights.articles_read || 0);
  const minutes = Math.max(0, insights.minutes_read || 0);
  const days = Math.max(0, insights.days_active || 0);
  if (articles === 0 && days === 0) return 'Your reading journey starts with one good story.';
  return `${articles} ${articles === 1 ? 'article' : 'articles'} · ${minutes} ${minutes === 1 ? 'minute' : 'minutes'} · ${days} active ${days === 1 ? 'day' : 'days'}`;
}

export function streakNudge(currentStreak: number, longestStreak: number): string {
  if (currentStreak >= 7) return `Wonderful rhythm — ${currentStreak} days of reading and counting.`;
  if (currentStreak >= 2) return `Lovely momentum. Come back tomorrow to keep your ${currentStreak}-day streak alive.`;
  if (currentStreak === 1) return 'A lovely start. Come back tomorrow and keep your reading rhythm going.';
  if (longestStreak >= 2) return `Your best run is ${longestStreak} days. One story is a lovely way to begin again.`;
  return 'A fresh start is always one good story away.';
}

export function feedHeading(personalised: boolean): string {
  return personalised ? 'For You' : 'Readers Are Loving';
}

export function topCategoryName(categories: unknown): string | null {
  if (!Array.isArray(categories)) return null;
  const first = categories.find((item): item is ReaderTopCategory =>
    Boolean(item && typeof item === 'object' && typeof (item as ReaderTopCategory).name === 'string')
  );
  return first?.name || null;
}
