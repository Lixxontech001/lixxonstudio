import { Flame } from 'lucide-react';
import { useReadingStreak } from '../hooks/useFeatures';

export default function ReadingStreakBadge() {
  const { streak } = useReadingStreak();

  if (streak < 2) return null;

  return (
    <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-bronze/10 text-bronze rounded-full text-xs font-medium">
      <Flame size={12} className="text-bronze" />
      <span>{streak} day reading streak</span>
    </div>
  );
}
