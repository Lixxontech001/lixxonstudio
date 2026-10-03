import { Heart, Lightbulb, Sparkles, Bookmark } from 'lucide-react';
import { useArticleReactions } from '../hooks/useFeatures';
import { useToast } from '../context/ToastContext';
import type { ArticleReaction } from '../lib/types';

const REACTION_META: { type: ArticleReaction['reaction_type']; label: string; icon: typeof Heart }[] = [
  { type: 'love', label: 'Love', icon: Heart },
  { type: 'insightful', label: 'Insightful', icon: Lightbulb },
  { type: 'inspiring', label: 'Inspiring', icon: Sparkles },
  { type: 'save', label: 'Save', icon: Bookmark },
];

export default function ArticleReactions({ postId }: { postId: string }) {
  const { reactions, userReactions, toggleReaction, loading } = useArticleReactions(postId);
  const { showToast } = useToast();

  if (loading) return null;

  const handleToggle = (type: ArticleReaction['reaction_type'], label: string) => {
    toggleReaction(type);
    const has = userReactions.has(type);
    if (type === 'save') {
      showToast(has ? 'Removed from saved' : 'Saved for later', 'success');
    } else {
      showToast(has ? `Removed ${label} reaction` : `Reacted with ${label}`, 'success');
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {REACTION_META.map(({ type, label, icon: Icon }) => {
        const hasReacted = userReactions.has(type);
        const count = reactions.find(r => r.reaction_type === type)?.count || 0;
        return (
          <button
            key={type}
            onClick={() => handleToggle(type, label)}
            className={`inline-flex items-center gap-2 px-4 py-2.5 border rounded-sm transition-all duration-300 ${
              hasReacted
                ? 'border-bronze bg-bronze/10 text-bronze'
                : 'border-taupe text-charcoal-muted hover:border-bronze hover:text-bronze'
            }`}
            aria-label={`${hasReacted ? 'Remove' : 'Add'} ${label} reaction`}
          >
            <Icon
              size={16}
              strokeWidth={1.5}
              fill={hasReacted ? 'currentColor' : 'none'}
              className={hasReacted ? 'scale-110 transition-transform' : 'transition-transform'}
            />
            <span className="text-sm font-medium">{count}</span>
            <span className="text-xs hidden sm:inline">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
