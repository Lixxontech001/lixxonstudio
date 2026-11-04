import { useState } from 'react';
import {
  Trophy, Sparkles, Lock, CheckCircle2, X, Check
} from 'lucide-react';
import { useAchievements } from '../../hooks/useAchievements';
import { useNavigation } from '../../context/NavigationContext';
import type { SalonPrivilege } from '../../types/privileges';

interface SalonPrivilegesModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenAnalyzer?: () => void;
}

export default function SalonPrivilegesModal({
  isOpen,
  onClose,
  onOpenAnalyzer,
}: SalonPrivilegesModalProps) {
  const { points, rank, progress, badges, privileges } = useAchievements();
  const { navigate } = useNavigation();
  const [activeTab, setActiveTab] = useState<'privileges' | 'badges'>('privileges');
  const [copiedCode, setCopiedCode] = useState(false);

  if (!isOpen) return null;

  const handlePrivilegeAction = (priv: SalonPrivilege) => {
    if (!priv.isUnlocked) return;

    if (priv.actionType === 'copy') {
      navigator.clipboard.writeText(priv.actionTarget).then(() => {
        setCopiedCode(true);
        setTimeout(() => setCopiedCode(false), 2500);
      });
      return;
    }

    if (priv.actionType === 'modal' && priv.actionTarget === 'formulation-analyzer') {
      onClose();
      if (onOpenAnalyzer) onOpenAnalyzer();
      return;
    }

    if (priv.actionType === 'route') {
      onClose();
      if (priv.actionTarget === '/vault') {
        navigate({ name: 'vault' });
      } else if (priv.actionTarget === '/trending') {
        navigate({ name: 'trending' });
      } else if (priv.actionTarget === '/account') {
        navigate({ name: 'account' });
      } else {
        window.location.href = priv.actionTarget;
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-charcoal/60 backdrop-blur-sm transition-opacity duration-300"
        onClick={onClose}
      />

      {/* Modal Box */}
      <div className="relative w-full max-w-2xl bg-white dark:bg-[#1E1E1E] rounded-sm shadow-2xl border border-taupe/40 dark:border-white/10 overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-200">
        {/* Header Hero */}
        <div className="px-6 py-6 border-b border-taupe/30 dark:border-white/10 bg-gradient-to-br from-[#FAF7F2] via-white to-[#F2EFE9] dark:from-[#242424] dark:to-[#181818] relative">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-bronze/15 text-bronze flex items-center justify-center text-2xl flex-shrink-0 shadow-xs border border-bronze/20">
                {rank.badge}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] tracking-ultra-wide uppercase text-bronze font-bold">
                    Salon Reputation Tier {rank.tier}
                  </span>
                  <span className="bg-charcoal text-white dark:bg-white dark:text-charcoal text-[9px] px-2 py-0.5 rounded-full font-mono uppercase">
                    Level {rank.tier}
                  </span>
                </div>
                <h2 className="font-serif text-2xl text-charcoal dark:text-white font-light">
                  {rank.title}
                </h2>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-charcoal-muted hover:text-charcoal dark:text-white/60 dark:hover:text-white transition-colors"
              aria-label="Close privileges"
            >
              <X size={18} />
            </button>
          </div>

          {/* Progress Bar & Points Summary */}
          <div className="mt-5 bg-white/80 dark:bg-black/30 backdrop-blur-xs p-4 rounded-sm border border-taupe/40 dark:border-white/5 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-charcoal-muted dark:text-white/60 font-medium">
                Reputation Points: <strong className="text-bronze font-serif text-base ml-1">{points.toLocaleString()} pts</strong>
              </span>
              <span className="text-[11px] text-charcoal-muted dark:text-white/50">
                {rank.nextTierPoints ? `${points} / ${rank.nextTierPoints} to next rank` : 'Top Tier Achieved'}
              </span>
            </div>

            {/* Progress track */}
            <div className="w-full h-2 bg-taupe/30 dark:bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-bronze to-bronze-light transition-all duration-500 rounded-full"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </div>

        {/* Tab Controls */}
        <div className="flex border-b border-taupe/20 dark:border-white/10 px-6 bg-porcelain dark:bg-[#181818] text-xs uppercase tracking-editorial font-medium">
          <button
            type="button"
            onClick={() => setActiveTab('privileges')}
            className={`py-3 px-4 border-b-2 -mb-[1px] transition-colors flex items-center gap-2 ${
              activeTab === 'privileges'
                ? 'border-bronze text-bronze'
                : 'border-transparent text-charcoal-muted dark:text-white/50 hover:text-charcoal'
            }`}
          >
            <Sparkles size={13} /> Exclusive Privileges ({privileges.filter(p => p.isUnlocked).length}/{privileges.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('badges')}
            className={`py-3 px-4 border-b-2 -mb-[1px] transition-colors flex items-center gap-2 ${
              activeTab === 'badges'
                ? 'border-bronze text-bronze'
                : 'border-transparent text-charcoal-muted dark:text-white/50 hover:text-charcoal'
            }`}
          >
            <Trophy size={13} /> Reader Milestones ({badges.filter(b => b.unlocked).length}/{badges.length})
          </button>
        </div>

        {/* Modal Body */}
        <div className="overflow-y-auto p-6 space-y-4 flex-1">
          {activeTab === 'privileges' ? (
            <div className="space-y-3">
              {privileges.map(priv => (
                <div
                  key={priv.id}
                  className={`p-4 rounded-sm border transition-all ${
                    priv.isUnlocked
                      ? 'bg-white dark:bg-[#242424] border-bronze/40 dark:border-bronze/30 shadow-xs'
                      : 'bg-taupe-light/20 dark:bg-white/5 border-taupe/30 dark:border-white/5 opacity-75'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <span className="text-2xl flex-shrink-0 mt-0.5">{priv.icon}</span>
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="font-serif text-base text-charcoal dark:text-white font-medium">
                            {priv.title}
                          </h4>
                          {priv.isUnlocked ? (
                            <span className="bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 text-[9px] uppercase tracking-editorial px-2 py-0.5 rounded-full font-medium flex items-center gap-1 border border-emerald-200 dark:border-emerald-800/30">
                              <CheckCircle2 size={10} /> Unlocked
                            </span>
                          ) : (
                            <span className="bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-white/50 text-[9px] uppercase tracking-editorial px-2 py-0.5 rounded-full font-medium flex items-center gap-1">
                              <Lock size={10} /> Requires {priv.requiredPoints} pts
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-bronze font-medium mt-0.5">{priv.tagline}</p>
                        <p className="text-xs text-charcoal-muted dark:text-white/60 leading-relaxed mt-1">
                          {priv.description}
                        </p>
                      </div>
                    </div>

                    <div className="flex-shrink-0 pt-1">
                      {priv.isUnlocked ? (
                        <button
                          type="button"
                          onClick={() => handlePrivilegeAction(priv)}
                          className="px-3 py-1.5 bg-bronze text-white text-[11px] tracking-editorial uppercase font-semibold rounded-sm hover:bg-bronze-dark transition-all flex items-center gap-1.5 shadow-xs"
                        >
                          <span>{priv.actionLabel}</span>
                          {copiedCode && priv.actionType === 'copy' ? <Check size={12} /> : null}
                        </button>
                      ) : (
                        <span className="text-[11px] text-charcoal-muted dark:text-white/40 font-mono">
                          +{priv.requiredPoints - points} pts to unlock
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {badges.map(b => (
                <div
                  key={b.key}
                  className={`p-3.5 rounded-sm border flex items-start gap-3 transition-all ${
                    b.unlocked
                      ? 'bg-white dark:bg-[#242424] border-bronze/30 shadow-xs'
                      : 'bg-taupe-light/20 dark:bg-white/5 border-taupe/20 dark:border-white/5 opacity-60'
                  }`}
                >
                  <span className="text-2xl flex-shrink-0">{b.emoji}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-1">
                      <h4 className="font-serif text-sm text-charcoal dark:text-white font-medium truncate">
                        {b.label}
                      </h4>
                      <span className="text-[10px] text-bronze font-bold font-mono">
                        +{b.points} pts
                      </span>
                    </div>
                    <p className="text-[11px] text-charcoal-muted dark:text-white/60 line-clamp-2 mt-0.5">
                      {b.description}
                    </p>
                    <span className="text-[10px] text-charcoal-muted/80 dark:text-white/40 italic block mt-1">
                      {b.requirement}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-porcelain dark:bg-[#181818] border-t border-taupe/30 dark:border-white/10 flex items-center justify-between">
          <p className="text-[11px] text-charcoal-muted dark:text-white/40">
            Earn +25 pts daily by reading, bookmarking, and completing editorial series.
          </p>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-charcoal text-white dark:bg-white dark:text-charcoal text-xs tracking-editorial uppercase font-medium rounded-sm hover:bg-bronze transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
