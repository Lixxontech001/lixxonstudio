import { Heart } from 'lucide-react';
import { useLike } from '../hooks/useSupabase';

export default function ArticleLike({ postId }: { postId: string }) {
  const { count, liked, toggleLike, loading } = useLike(postId);

  return (
    <button
      onClick={toggleLike}
      disabled={loading}
      className="group inline-flex items-center gap-2.5 px-6 py-3 border border-taupe rounded-sm transition-all duration-300 hover:border-bronze"
      aria-label={liked ? 'Unlike article' : 'Like article'}
    >
      <Heart
        size={18}
        strokeWidth={1.5}
        fill={liked ? 'currentColor' : 'none'}
        className={`transition-all duration-300 ${liked ? 'text-bronze scale-110' : 'text-charcoal-muted group-hover:text-bronze'}`}
      />
      <span className="text-sm font-medium text-charcoal">
        {count} {count === 1 ? 'Like' : 'Likes'}
      </span>
    </button>
  );
}
