export type ReaderRankTier = 1 | 2 | 3 | 4;

export interface ReaderRank {
  tier: ReaderRankTier;
  title: string;
  badge: string;
  minPoints: number;
  nextTierPoints: number | null;
  perks: string[];
}

export interface SalonPrivilege {
  id: string;
  title: string;
  tagline: string;
  description: string;
  icon: string;
  minTier: ReaderRankTier;
  requiredPoints: number;
  isUnlocked: boolean;
  actionLabel: string;
  actionType: 'modal' | 'route' | 'download' | 'copy';
  actionTarget: string;
}

export interface AchievementBadge {
  key: string;
  label: string;
  description: string;
  emoji: string;
  category: 'reading' | 'streak' | 'collection' | 'community' | 'vault';
  requirement: string;
  points: number;
  unlocked: boolean;
  unlockedAt?: string | null;
}

