import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  getLocalPoints,
  getUnlockedBadgeKeys,
  awardPoints as libAwardPoints,
  unlockBadge as libUnlockBadge,
  getReaderRank,
  RANKS,
  BADGE_DEFINITIONS,
  SALON_PRIVILEGES,
} from '../lib/achievements';
import type { SalonPrivilege, AchievementBadge } from '../types/privileges';

export function useAchievements() {
  const [points, setPoints] = useState<number>(getLocalPoints);
  const [unlockedKeys, setUnlockedKeys] = useState<Set<string>>(getUnlockedBadgeKeys);

  // Sync state on custom window events
  useEffect(() => {
    const handlePoints = () => setPoints(getLocalPoints());
    const handleBadges = () => setUnlockedKeys(getUnlockedBadgeKeys());

    window.addEventListener('lixxon:points_updated', handlePoints);
    window.addEventListener('lixxon:badge_unlocked', handleBadges);

    return () => {
      window.removeEventListener('lixxon:points_updated', handlePoints);
      window.removeEventListener('lixxon:badge_unlocked', handleBadges);
    };
  }, []);

  // Daily Reading Streak & Points Bonus (awards once per calendar day)
  useEffect(() => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const lastVisit = localStorage.getItem('lixxon_last_bonus_date');
      if (lastVisit !== today) {
        localStorage.setItem('lixxon_last_bonus_date', today);
        libAwardPoints(25, 'daily_visit_bonus');
      }
    } catch {
      // Ignore
    }
  }, []);

  const { rank, progress } = useMemo(() => getReaderRank(points), [points]);

  const badges = useMemo<AchievementBadge[]>(() => {
    return BADGE_DEFINITIONS.map(def => ({
      ...def,
      unlocked: unlockedKeys.has(def.key),
    }));
  }, [unlockedKeys]);

  const privileges = useMemo<SalonPrivilege[]>(() => {
    return SALON_PRIVILEGES.map(priv => ({
      ...priv,
      isUnlocked: points >= priv.requiredPoints,
    }));
  }, [points]);

  const award = useCallback((amount: number, reason?: string) => {
    const next = libAwardPoints(amount, reason);
    setPoints(next);
    return next;
  }, []);

  const unlock = useCallback((badgeKey: string) => {
    const res = libUnlockBadge(badgeKey);
    if (res) {
      setUnlockedKeys(getUnlockedBadgeKeys());
      setPoints(getLocalPoints());
    }
    return res;
  }, []);

  return {
    points,
    rank,
    progress,
    badges,
    privileges,
    ranks: RANKS,
    awardPoints: award,
    unlockBadge: unlock,
    hasPrivilege: (id: string) => {
      const priv = privileges.find(p => p.id === id);
      return priv ? priv.isUnlocked : false;
    },
  };
}
