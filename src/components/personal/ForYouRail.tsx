import { displayImageUrl } from '../../lib/images';
import { Clock, RefreshCw, Sparkles } from 'lucide-react';
import { Link } from '../../context/NavigationContext';
import { useForYouFeed } from '../../hooks/usePersonalisation';
import { feedHeading } from '../../lib/personalisation';

export default function ForYouRail({ limit = 6 }: { limit?: number }) {
  const { items, loading, error, retry, personalised } = useForYouFeed(limit);
  const heading = feedHeading(personalised);

  if (loading) return <section className="container-wide py-8" aria-busy="true" aria-labelledby="for-you-heading">
    <h2 id="for-you-heading" className="font-serif text-2xl text-charcoal">{heading}</h2>
    <p role="status" className="mt-3 text-sm text-charcoal-muted">Finding stories for you…</p>
  </section>;
  if (!error && items.length === 0) return null;

  return (
    <section className="bg-taupe-light/40 py-10 md:py-14" aria-labelledby="for-you-heading">
      <div className="container-wide">
        <div className="mb-6 flex items-center gap-3">
          <Sparkles size={16} strokeWidth={1.5} className="text-bronze" aria-hidden="true" />
          <h2 id="for-you-heading" className="font-serif text-2xl text-charcoal md:text-3xl">{heading}</h2>
          <div className="h-px flex-1 bg-taupe" />
        </div>
        {error ? (
          <div className="rounded-sm border border-taupe bg-white p-5">
            <p className="text-sm text-charcoal-muted">We couldn’t load these recommendations.</p>
            <button type="button" onClick={retry} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-sm border border-taupe px-4 py-2 text-sm text-charcoal hover:border-bronze focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
              <RefreshCw size={14} aria-hidden="true" /> Try again
            </button>
          </div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item) => (
              <Link key={item.post_id} to={{ name: 'article', slug: item.slug }} className="group flex min-h-full flex-col overflow-hidden rounded-sm border border-taupe/60 bg-white transition-colors hover:border-bronze focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bronze">
                {item.cover_image && <div className="aspect-[16/10] overflow-hidden bg-taupe-light"><img src={displayImageUrl(item.cover_image)} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.02]" /></div>}
                <div className="flex flex-1 flex-col p-5">
                  <span className="mb-3 inline-flex w-fit items-center rounded-full border border-bronze/30 bg-bronze/5 px-3 py-1 text-[10px] tracking-editorial text-bronze">{item.reason}</span>
                  <h3 className="font-serif text-lg leading-snug text-charcoal group-hover:text-bronze">{item.title}</h3>
                  {item.excerpt && <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-charcoal-muted">{item.excerpt}</p>}
                  <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 pt-4 text-xs text-charcoal-muted">
                    {item.category_name && <span>{item.category_name}</span>}
                    {item.category_name && <span aria-hidden="true">·</span>}
                    <Clock size={12} aria-hidden="true" /><span>{item.reading_time_minutes} min read</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
