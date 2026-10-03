
import { ThumbsUp, ThumbsDown } from 'lucide-react';
import { useReviewHelpfulness } from '../hooks/usePlatform';

export default function ReviewHelpfulness({ reviewId }: { reviewId: string }) {
  const { helpfulCount, unhelpfulCount, userVote, vote } = useReviewHelpfulness(reviewId);

  return (
    <div className="flex items-center gap-3 mt-3">
      <span className="text-xs text-charcoal-muted">Was this helpful?</span>
      <button
        onClick={() => vote(true)}
        className={`inline-flex items-center gap-1.5 text-xs transition-colors ${userVote === true ? 'text-bronze font-medium' : 'text-charcoal-muted hover:text-bronze'}`}
        aria-label="Mark as helpful"
      >
        <ThumbsUp size={12} strokeWidth={1.5} fill={userVote === true ? 'currentColor' : 'none'} /> Yes ({helpfulCount})
      </button>
      <button
        onClick={() => vote(false)}
        className={`inline-flex items-center gap-1.5 text-xs transition-colors ${userVote === false ? 'text-bronze font-medium' : 'text-charcoal-muted hover:text-bronze'}`}
        aria-label="Mark as not helpful"
      >
        <ThumbsDown size={12} strokeWidth={1.5} fill={userVote === false ? 'currentColor' : 'none'} /> No ({unhelpfulCount})
      </button>
    </div>
  );
}
