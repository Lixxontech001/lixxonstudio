import { Flame, RefreshCw, Sparkles } from 'lucide-react';
import { useReaderInsights } from '../../hooks/usePersonalisation';
import { insightsSummary, streakNudge, topCategoryName } from '../../lib/personalisation';

export default function ReaderInsightsCard() {
  const { insights, loading, error, retry } = useReaderInsights();

  if (loading) return <section className="rounded-sm border border-taupe/60 bg-white p-5 md:p-7" aria-busy="true">
    <p role="status" className="text-sm text-charcoal-muted">Loading your reading insights…</p>
  </section>;

  if (error) return <section className="rounded-sm border border-taupe/60 bg-white p-5 md:p-7">
    <p className="text-sm text-charcoal-muted">Your reading insights are unavailable right now.</p>
    <button type="button" onClick={retry} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-sm border border-taupe px-4 py-2 text-sm text-charcoal hover:border-bronze focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
      <RefreshCw size={14} aria-hidden="true" /> Try again
    </button>
  </section>;

  const hasRead = insights.articles_read > 0 || insights.days_active > 0;
  const favourite = topCategoryName(insights.top_categories);

  return (
    <section className="rounded-sm border border-taupe/60 bg-white p-5 md:p-7" aria-labelledby="reader-insights-heading">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-bronze/10 text-bronze"><Flame size={18} aria-hidden="true" /></div>
        <div className="min-w-0 flex-1">
          <h2 id="reader-insights-heading" className="font-serif text-xl text-charcoal md:text-2xl">Your reading rhythm</h2>
          <p className="mt-1 text-sm leading-relaxed text-charcoal-muted">{streakNudge(insights.current_streak, insights.longest_streak)}</p>
        </div>
      </div>
      {hasRead ? (
        <>
          <p className="mt-5 text-sm text-charcoal">{insightsSummary(insights)}</p>
          {insights.top_categories.length > 0 && <div className="mt-4 flex flex-wrap gap-2" aria-label="Favourite topics">
            {insights.top_categories.slice(0, 3).map((category) => <span key={category.slug} className="rounded-full border border-taupe px-3 py-1.5 text-xs text-charcoal-muted">{category.name}</span>)}
          </div>}
          {insights.longest_streak > 0 && <p className="mt-4 flex items-center gap-2 text-xs text-charcoal-muted"><Sparkles size={13} className="text-bronze" aria-hidden="true" /> Best run: {insights.longest_streak} {insights.longest_streak === 1 ? 'day' : 'days'}</p>}
          {favourite && <p className="sr-only">Your favourite topic is {favourite}.</p>}
        </>
      ) : (
        <div className="mt-5 rounded-sm bg-taupe-light/50 p-4">
          <p className="text-sm leading-relaxed text-charcoal-muted">Read an article to start your private reading journal. We’ll help you keep a gentle rhythm and find more stories you love.</p>
        </div>
      )}
    </section>
  );
}
