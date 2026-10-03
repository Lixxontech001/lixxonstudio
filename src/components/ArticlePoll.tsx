import { useArticlePoll } from '../hooks/useFeatures';
import { BarChart3 } from 'lucide-react';

export default function ArticlePollComponent({ postId }: { postId: string }) {
  const { poll, votes, userVote, castVote, loading } = useArticlePoll(postId);

  if (loading || !poll) return null;

  const totalVotes = votes.reduce((sum, v) => sum + v, 0);
  const options = Array.isArray(poll.options) ? poll.options : [];

  return (
    <div className="my-10 p-6 bg-taupe-light/40 rounded-sm border border-taupe/30">
      <div className="flex items-center gap-2 mb-4">
        <BarChart3 size={16} strokeWidth={1.5} className="text-bronze" />
        <p className="text-[10px] tracking-editorial uppercase text-bronze">Quick Poll</p>
      </div>
      <h3 className="font-serif text-xl text-charcoal mb-5">{poll.question}</h3>
      <div className="space-y-3">
        {options.map((option, i) => {
          const count = votes[i] || 0;
          const pct = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
          const isSelected = userVote === i;
          return (
            <button
              key={i}
              onClick={() => castVote(i)}
              disabled={userVote !== null}
              className={`w-full text-left relative overflow-hidden rounded-sm border transition-all duration-300 ${
                isSelected ? 'border-bronze' : 'border-taupe/50 hover:border-bronze/50'
              } ${userVote !== null ? 'cursor-default' : 'cursor-pointer'}`}
            >
              {userVote !== null && (
                <div
                  className={`absolute inset-0 transition-all duration-500 ${isSelected ? 'bg-bronze/15' : 'bg-taupe/20'}`}
                  style={{ width: `${pct}%` }}
                />
              )}
              <div className="relative px-4 py-3 flex items-center justify-between">
                <span className={`text-sm ${isSelected ? 'text-charcoal font-medium' : 'text-charcoal-muted'}`}>
                  {option}
                </span>
                {userVote !== null && (
                  <span className="text-sm text-charcoal-muted flex-shrink-0 ml-3">{pct}%</span>
                )}
              </div>
            </button>
          );
        })}
      </div>
      {userVote !== null && (
        <p className="text-xs text-charcoal-muted mt-4">
          {totalVotes} {totalVotes === 1 ? 'vote' : 'votes'} total
        </p>
      )}
    </div>
  );
}
