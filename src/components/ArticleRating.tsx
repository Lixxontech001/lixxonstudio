import { useState, useEffect } from 'react';
import { Star } from 'lucide-react';
import { useArticleRating } from '../hooks/usePlatform';
import { useToast } from '../context/ToastContext';

export default function ArticleRating({ postId }: { postId: string }) {
  const { avgRating, totalRatings, userRating, rate, loading } = useArticleRating(postId);
  const { showToast } = useToast();
  const [hoverRating, setHoverRating] = useState(0);

  if (loading) return null;

  const handleRate = (rating: number) => {
    rate(rating);
    showToast(userRating > 0 ? 'Rating updated' : 'Thanks for rating!', 'success');
  };

  return (
    <div className="flex items-center gap-4 px-5 py-3 bg-taupe-light/40 rounded-sm border border-taupe/30">
      <div className="flex items-center gap-1">
        {[1, 2, 3, 4, 5].map(n => (
          <button
            key={n}
            onClick={() => handleRate(n)}
            onMouseEnter={() => setHoverRating(n)}
            onMouseLeave={() => setHoverRating(0)}
            aria-label={`Rate ${n} stars`}
            className="transition-transform hover:scale-110"
          >
            <Star
              size={20}
              strokeWidth={1.5}
              fill={n <= (hoverRating || userRating) ? 'currentColor' : 'none'}
              className={n <= (hoverRating || userRating) ? 'text-bronze' : 'text-taupe-dark'}
            />
          </button>
        ))}
      </div>
      <div className="text-sm">
        {totalRatings > 0 ? (
          <span className="text-charcoal-muted">
            <strong className="text-charcoal">{avgRating.toFixed(1)}</strong> ({totalRatings} {totalRatings === 1 ? 'rating' : 'ratings'})
          </span>
        ) : (
          <span className="text-charcoal-muted">Rate this article</span>
        )}
      </div>
    </div>
  );
}
