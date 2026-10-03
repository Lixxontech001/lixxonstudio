
import { ThumbsUp } from 'lucide-react';
import { useCommentLikes } from '../hooks/usePlatform';

export default function CommentLikeButton({ commentId }: { commentId: string }) {
  const { count, liked, toggle } = useCommentLikes(commentId);

  return (
    <button
      onClick={toggle}
      className={`inline-flex items-center gap-1.5 text-xs transition-colors ${liked ? 'text-bronze' : 'text-charcoal-muted hover:text-bronze'}`}
      aria-label={liked ? 'Unlike comment' : 'Like comment'}
    >
      <ThumbsUp size={12} strokeWidth={1.5} fill={liked ? 'currentColor' : 'none'} />
      {count > 0 && <span>{count}</span>}
    </button>
  );
}
