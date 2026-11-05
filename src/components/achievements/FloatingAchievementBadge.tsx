import { useState, useEffect } from 'react';
import { Sparkles, X } from 'lucide-react';
import { useAchievements } from '../../hooks/useAchievements';

interface FloatingAchievementBadgeProps {
  onOpenSalon: () => void;
}

export default function FloatingAchievementBadge({ onOpenSalon }: FloatingAchievementBadgeProps) {
  const { points, rank } = useAchievements();
  const [recentUnlock, setRecentUnlock] = useState<string | null>(null);
  const [minimized, setMinimized] = useState(false);

  useEffect(() => {
    const handleUnlock = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && detail.badge) {
        setRecentUnlock(detail.badge.label);
        setTimeout(() => setRecentUnlock(null), 5000);
      }
    };

    window.addEventListener('lixxon:badge_unlocked', handleUnlock);
    return () => window.removeEventListener('lixxon:badge_unlocked', handleUnlock);
  }, []);

  if (minimized) {
    return (
      <button
        type="button"
        onClick={() => setMinimized(false)}
        className="fixed bottom-6 right-6 z-40 w-11 h-11 rounded-full bg-charcoal text-white dark:bg-white dark:text-charcoal border border-white/20 shadow-2xl flex items-center justify-center hover:bg-bronze transition-all hover:scale-105"
        title="Open Reader Privileges & Points"
        aria-label="Open Reader Privileges & Points"
      >
        <span className="text-base">{rank?.badge || '🥉'}</span>
      </button>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 z-40 flex flex-col items-end gap-2 pointer-events-auto">
      {/* Celebration Notification Toast */}
      {recentUnlock && (
        <div className="bg-bronze text-white px-4 py-2.5 rounded-sm shadow-xl border border-bronze-light/30 flex items-center gap-2 text-xs animate-in slide-in-from-bottom-2 fade-in duration-300">
          <Sparkles size={14} className="text-amber-200" />
          <span>
            Milestone Unlocked: <strong>{recentUnlock}</strong>!
          </span>
        </div>
      )}

      {/* Floating Pill */}
      <div className="bg-charcoal/95 dark:bg-[#1E1E1E]/95 backdrop-blur-md text-white border border-white/15 rounded-full luxury-shadow-lg px-3.5 py-1.5 flex items-center gap-2.5 group hover:border-bronze/60 transition-all">
        <button
          type="button"
          onClick={onOpenSalon}
          className="flex items-center gap-2 text-left"
        >
          <span className="text-base flex-shrink-0">{rank?.badge || '🥉'}</span>
          <div className="flex flex-col">
            <span className="text-[10px] tracking-editorial uppercase text-bronze-light font-medium leading-none">
              {rank?.title || 'Reader'}
            </span>
            <span className="text-xs font-serif font-medium text-white/90 leading-tight">
              {(points || 0).toLocaleString()} pts
            </span>
          </div>
        </button>

        <div className="h-4 w-[1px] bg-white/20 ml-0.5" />

        <button
          type="button"
          onClick={() => setMinimized(true)}
          className="text-white/40 hover:text-white p-1 transition-colors"
          title="Minimize floating badge"
          aria-label="Minimize floating badge"
        >
          <X size={12} />
        </button>
      </div>
    </div>
  );
}
