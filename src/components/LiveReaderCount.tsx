
import { useLiveReaderCount } from '../hooks/useFeatures';

export default function LiveReaderCount({ postId }: { postId: string }) {
  const count = useLiveReaderCount(postId);

  if (count < 2) return null;

  return (
    <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-charcoal/5 text-charcoal-muted rounded-full text-xs">
      <span className="relative flex w-2 h-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-60"></span>
        <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
      </span>
      <span>{count} reading now</span>
    </div>
  );
}
