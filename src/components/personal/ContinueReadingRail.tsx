import { Clock, RefreshCw } from 'lucide-react';
import { Link } from '../../context/NavigationContext';
import { useContinueReading } from '../../hooks/usePersonalisation';
import { progressLabel } from '../../lib/personalisation';

interface ContinueReadingRailProps {
  limit?: number;
  inline?: boolean;
}

export default function ContinueReadingRail({ limit = 3, inline = false }: ContinueReadingRailProps) {
  const { items, loading, error, retry } = useContinueReading(limit);

  if (loading) {
    return <section className="container-wide py-8" aria-busy="true" aria-labelledby="continue-reading-heading">
      <h2 id="continue-reading-heading" className="font-serif text-2xl text-charcoal">Pick Up Where You Left Off</h2>
      <p role="status" className="mt-3 text-sm text-charcoal-muted">Loading your reading list…</p>
    </section>;
  }

  if (error) {
    return <section className="container-wide py-8" aria-labelledby="continue-reading-heading">
      <h2 id="continue-reading-heading" className="font-serif text-2xl text-charcoal">Pick Up Where You Left Off</h2>
      <p className="mt-3 text-sm text-charcoal-muted">Your reading list is unavailable right now.</p>
      <button type="button" onClick={retry} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-sm border border-taupe px-4 py-2 text-sm text-charcoal hover:border-bronze focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
        <RefreshCw size={14} aria-hidden="true" /> Try again
      </button>
    </section>;
  }

  if (items.length === 0 && !inline) return null;

  return (
    <section className="container-wide py-8 md:py-12" aria-labelledby="continue-reading-heading">
      <div className="mb-5 flex items-end justify-between gap-4">
        <h2 id="continue-reading-heading" className="font-serif text-2xl text-charcoal md:text-3xl">Pick Up Where You Left Off</h2>
      </div>
      {items.length === 0 ? (
        <p className="rounded-sm border border-taupe/60 bg-white px-5 py-6 text-sm leading-relaxed text-charcoal-muted">
          Your next article will appear here as you read. Your progress stays private on this device.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => {
            const percent = Math.max(0, Math.min(100, Math.round(item.progress_percent || 0)));
            return (
              <Link key={item.post_id} to={{ name: 'article', slug: item.slug }} className="group flex min-h-32 overflow-hidden rounded-sm border border-taupe/60 bg-white transition-colors hover:border-bronze focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bronze">
                <div className="h-32 w-24 shrink-0 overflow-hidden bg-taupe-light sm:w-28">
                  {item.cover_image && <img src={item.cover_image} alt="" loading="lazy" className="h-full w-full object-cover" />}
                </div>
                <div className="flex min-w-0 flex-1 flex-col justify-center p-4">
                  {item.category_name && <span className="mb-1 text-[10px] uppercase tracking-editorial text-bronze">{item.category_name}</span>}
                  <h3 className="line-clamp-2 font-serif text-base leading-snug text-charcoal group-hover:text-bronze">{item.title}</h3>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-taupe-light" role="progressbar" aria-label={`Reading progress for ${item.title}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
                    <div className="h-full rounded-full bg-bronze" style={{ width: `${percent}%` }} />
                  </div>
                  <p className="mt-2 flex flex-wrap items-center gap-x-1 text-xs text-charcoal-muted">
                    <span>{progressLabel(percent, item.source)}</span><span aria-hidden="true">·</span><Clock size={12} aria-hidden="true" />
                    <span>{item.reading_time_minutes} min read</span>
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
