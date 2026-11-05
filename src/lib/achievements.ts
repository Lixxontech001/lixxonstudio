import type { ReaderRank, SalonPrivilege, AchievementBadge } from '../types/privileges';
import { supabase } from './supabaseClient';
import { getFingerprint } from '../hooks/useFeatures';

const STORAGE_KEY = 'lixxon_reader_achievements_v1';
const POINTS_KEY = 'lixxon_reader_points_v1';

export const RANKS: ReaderRank[] = [
  {
    tier: 1,
    title: 'Bronze Reader',
    badge: '🥉',
    minPoints: 0,
    nextTierPoints: 200,
    perks: ['Community Reader Pass', 'Standard Bookmarking', 'Audio Narration'],
  },
  {
    tier: 2,
    title: 'Silver Scholar',
    badge: '🥈',
    minPoints: 200,
    nextTierPoints: 500,
    perks: ['The Secret Editorial Vault Access', 'Offline Reading Mode & PDF Export', 'Formulation Synergy Analyzer'],
  },
  {
    tier: 3,
    title: 'Gold Connoisseur',
    badge: '🥇',
    minPoints: 500,
    nextTierPoints: 1000,
    perks: ['VIP Priority Question Desk', 'Luxury Ambiance Themes (Noir & Emerald)', '15% Patron Boutique Perk'],
  },
  {
    tier: 4,
    title: 'Platinum Luminary',
    badge: '👑',
    minPoints: 1000,
    nextTierPoints: null,
    perks: ['Permanent Editorial Board Recognition', 'Full Archives Access', 'Uncapped Masterclass Downloads'],
  },
];

export const BADGE_DEFINITIONS: Omit<AchievementBadge, 'unlocked' | 'unlockedAt'>[] = [
  {
    key: 'first_read',
    label: 'First Page',
    description: 'Read your first editorial piece or scientific deep dive on Lixxon Studio.',
    emoji: '📖',
    category: 'reading',
    requirement: 'Read 1 article',
    points: 50,
  },
  {
    key: 'deep_dive_scholar',
    label: 'Deep Dive Scholar',
    description: 'Completed a 10-minute long-form clinical study with full scroll immersion.',
    emoji: '🔬',
    category: 'reading',
    requirement: 'Finish a long-form article',
    points: 75,
  },
  {
    key: 'ten_articles',
    label: 'Regular Reader',
    description: 'Immersed in daily skincare science, formulation guides, and intentional style.',
    emoji: '☕',
    category: 'reading',
    requirement: 'Read across 10 different articles',
    points: 150,
  },
  {
    key: 'streak_7',
    label: '7-Day Habit',
    description: 'Read every single day for a full week without breaking the cadence.',
    emoji: '🔥',
    category: 'streak',
    requirement: '7 consecutive reading days',
    points: 200,
  },
  {
    key: 'curator_elite',
    label: 'Master Curator',
    description: 'Curated 5 or more articles into your private reference library.',
    emoji: '🗂️',
    category: 'collection',
    requirement: 'Save 5 bookmarks',
    points: 100,
  },
  {
    key: 'social_ambassador',
    label: 'Editorial Ambassador',
    description: 'Shared an insightful article or scientific takeaway with colleagues or friends.',
    emoji: '✨',
    category: 'community',
    requirement: 'Share a story or quote',
    points: 75,
  },
  {
    key: 'formulation_master',
    label: 'Formulation Master',
    description: 'Explored ingredients and ran a compatibility check in the Salon Concierge.',
    emoji: '🧪',
    category: 'vault',
    requirement: 'Use the ingredient analyzer',
    points: 120,
  },
  {
    key: 'vault_explorer',
    label: 'Vault Insider',
    description: 'Unlocked and entered the Secret Editorial Vault archives.',
    emoji: '🏛️',
    category: 'vault',
    requirement: 'Reach Silver rank & visit Vault',
    points: 250,
  },
];

export const SALON_PRIVILEGES: Omit<SalonPrivilege, 'isUnlocked'>[] = [
  {
    id: 'vault',
    title: 'The Secret Editorial Vault',
    tagline: 'Exclusive unreleased formulations & masterclasses',
    description: 'Unpublished clinical investigations, rare ingredient dossiers, and salon protocols reserved for dedicated readers.',
    icon: '🏛️',
    minTier: 2,
    requiredPoints: 200,
    actionLabel: 'Enter The Vault →',
    actionType: 'route',
    actionTarget: '/vault',
  },
  {
    id: 'analyzer',
    title: 'Salon Formulation Concierge',
    tagline: 'Active ingredient conflict & routine analyzer',
    description: 'Test potential contraindications (e.g. Retinoids + AHAs, Copper Peptides + Vitamin C) and construct a balanced AM/PM routine.',
    icon: '🧪',
    minTier: 1,
    requiredPoints: 100,
    actionLabel: 'Launch Concierge',
    actionType: 'modal',
    actionTarget: 'formulation-analyzer',
  },
  {
    id: 'offline_pdf',
    title: 'Editorial PDF & Offline Reader',
    tagline: 'Preserve stories in high-res print layout',
    description: 'Save articles for airplane reading and export beautifully typeset editorial PDFs with typography intact.',
    icon: '📄',
    minTier: 1,
    requiredPoints: 50,
    actionLabel: 'Available in Article Reader',
    actionType: 'route',
    actionTarget: '/trending',
  },
  {
    id: 'ambiance_themes',
    title: 'Luxury Ambiance Themes',
    tagline: 'Paper Parchment, Noir Luxe & Emerald Salon',
    description: 'Custom aesthetic reading environments with tailored contrast and serif letter-spacing for evening focus.',
    icon: '🕯️',
    minTier: 3,
    requiredPoints: 500,
    actionLabel: 'Configure in Profile',
    actionType: 'route',
    actionTarget: '/account',
  },
  {
    id: 'patron_perk',
    title: 'Studio Boutique 15% Privilege',
    tagline: 'Honorary discount on digital wellness guides',
    description: 'Claim a permanent 15% patron privilege code applicable across all curated digital guides in the Studio shop.',
    icon: '🛍️',
    minTier: 3,
    requiredPoints: 500,
    actionLabel: 'Copy Promo Code (SALON15)',
    actionType: 'copy',
    actionTarget: 'SALON15',
  },
];

export function getLocalPoints(): number {
  try {
    const val = localStorage.getItem(POINTS_KEY);
    return val ? Math.max(0, parseInt(val, 10) || 0) : 50; // Welcome starting points!
  } catch {
    return 50;
  }
}

export function setLocalPoints(points: number): void {
  try {
    localStorage.setItem(POINTS_KEY, String(points));
    window.dispatchEvent(new CustomEvent('lixxon:points_updated', { detail: points }));
  } catch {
    // Ignore storage errors
  }
}

export function getUnlockedBadgeKeys(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : ['first_read']; // Default unlocked welcome badge
    return new Set(Array.isArray(parsed) ? parsed : ['first_read']);
  } catch {
    return new Set(['first_read']);
  }
}

export function awardPoints(amount: number, reason?: string): number {
  const current = getLocalPoints();
  const next = current + amount;
  setLocalPoints(next);

  // Sync to database if available
  const fp = getFingerprint();
  supabase.auth.getUser().then(({ data }) => {
    const userId = data.user?.id || null;
    supabase
      .from('reader_achievements')
      .insert({
        user_id: userId,
        device_fingerprint: fp,
        badge_key: reason || 'points_bonus',
        points: amount,
        metadata: { awarded_at: new Date().toISOString() },
      })
      .then(null, () => undefined);
  }, () => undefined);

  return next;
}

export function unlockBadge(badgeKey: string): boolean {
  const current = getUnlockedBadgeKeys();
  if (current.has(badgeKey)) return false;

  current.add(badgeKey);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(current)));
  } catch {
    // Ignore
  }

  const def = BADGE_DEFINITIONS.find(b => b.key === badgeKey);
  if (def) {
    awardPoints(def.points, badgeKey);
  }

  window.dispatchEvent(
    new CustomEvent('lixxon:badge_unlocked', {
      detail: { badgeKey, badge: def },
    })
  );

  return true;
}

export function getReaderRank(points: number): { rank: ReaderRank; progress: number } {
  const safePoints = Number.isFinite(points) ? Math.max(0, points) : 50;
  let matchedRank = RANKS[0];
  for (const r of RANKS) {
    if (safePoints >= r.minPoints) {
      matchedRank = r;
    }
  }

  let progress = 100;
  if (matchedRank.nextTierPoints) {
    const span = matchedRank.nextTierPoints - matchedRank.minPoints;
    const currentInTier = safePoints - matchedRank.minPoints;
    progress = Math.min(100, Math.max(0, Math.round((currentInTier / span) * 100)));
  }

  return { rank: matchedRank || RANKS[0], progress: Number.isFinite(progress) ? progress : 0 };
}
