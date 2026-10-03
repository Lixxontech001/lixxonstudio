import { ArrowLeft, ArrowRight, Layers } from 'lucide-react';
import { Link } from '../../context/NavigationContext';
import { useSeries } from '../../hooks/useV3';

/** Multi-part series navigation: list of parts + prev/next. */
export default function SeriesNav({ seriesId, currentPostId, variant = 'top' }: { seriesId?: string | null; currentPostId: string; variant?: 'top' | 'bottom' }) {
  const { series, posts } = useSeries(seriesId);
  if (!series || posts.length < 2) return null;
  const idx = posts.findIndex(p => p.id === currentPostId);
  const prev = idx > 0 ? posts[idx - 1] : null;
  const next = idx >= 0 && idx < posts.length - 1 ? posts[idx + 1] : null;

  if (variant === 'bottom') {
    return (
      <nav aria-label="Series navigation" className="my-12 grid sm:grid-cols-2 gap-4">
        {prev ? (
          <Link to={{ name: 'article', slug: prev.slug }} className="group p-5 border border-taupe/50 rounded-sm hover:border-bronze transition-colors">
            <span className="flex items-center gap-2 text-[10px] tracking-editorial uppercase text-charcoal-muted"><ArrowLeft size={12} /> Previous in series</span>
            <span className="block mt-2 font-serif text-lg text-charcoal group-hover:text-bronze transition-colors">{prev.title}</span>
          </Link>
        ) : <span />}
        {next && (
          <Link to={{ name: 'article', slug: next.slug }} className="group p-5 border border-taupe/50 rounded-sm hover:border-bronze transition-colors text-right">
            <span className="flex items-center justify-end gap-2 text-[10px] tracking-editorial uppercase text-charcoal-muted">Next in series <ArrowRight size={12} /></span>
            <span className="block mt-2 font-serif text-lg text-charcoal group-hover:text-bronze transition-colors">{next.title}</span>
          </Link>
        )}
      </nav>
    );
  }

  return (
    <details className="my-8 border border-taupe/50 rounded-sm bg-white/60 open:bg-white print:hidden" open={posts.length <= 6}>
      <summary className="cursor-pointer list-none px-5 py-4 flex items-center justify-between gap-4">
        <span className="flex items-center gap-2 text-sm text-charcoal">
          <Layers size={16} strokeWidth={1.5} className="text-bronze" />
          <span className="font-medium">{series.title}</span>
          <span className="text-charcoal-muted">· Part {idx + 1} of {posts.length}</span>
        </span>
        <span onClick={e => e.stopPropagation()}><Link to={{ name: 'series', slug: series.slug }} className="text-xs text-bronze hover:underline">View series</Link></span>
      </summary>
      <ol className="px-5 pb-4 space-y-2">
        {posts.map((p, i) => (
          <li key={p.id} className={`flex items-baseline gap-3 text-sm ${p.id === currentPostId ? 'text-bronze font-medium' : 'text-charcoal-light'}`}>
            <span className="font-serif text-xs w-5 text-charcoal-muted">{i + 1}.</span>
            {p.id === currentPostId ? <span aria-current="page">{p.title}</span> : <Link to={{ name: 'article', slug: p.slug }} className="hover:text-bronze transition-colors">{p.title}</Link>}
            <span className="ml-auto text-[11px] text-charcoal-muted whitespace-nowrap">{p.reading_time_minutes} min</span>
          </li>
        ))}
      </ol>
    </details>
  );
}
