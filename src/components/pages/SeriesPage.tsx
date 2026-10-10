import { displayImageUrl } from '../../lib/images';
import { useEffect } from 'react';
import { Helmet } from 'react-helmet-async';
import { Layers, Clock, ArrowRight } from 'lucide-react';
import { Link } from '../../context/NavigationContext';
import { useSeriesBySlug, useAllSeries } from '../../hooks/useV3';
import { FeedSkeleton } from '../Skeletons';
import EmptyState from '../EmptyState';
import { renderMarkdown } from '../../lib/markdown';

export function SeriesIndexPage() {
  const { series, loading } = useAllSeries();
  useEffect(() => { window.scrollTo(0, 0); }, []);
  return (
    <main className="container-wide py-16 md:py-24">
      <Helmet><title>Series | Lixxon Studio</title><meta name="description" content="Multi-part guides from Lixxon Studio, best read in order." /></Helmet>
      <header className="mb-12 text-center">
        <p className="text-[11px] tracking-editorial uppercase text-bronze mb-3">Series</p>
        <h1 className="font-serif text-4xl md:text-5xl text-charcoal">Guides worth reading in order</h1>
      </header>
      {loading ? <FeedSkeleton /> : series.length === 0 ? <EmptyState message="No series published yet." /> : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
          {series.map(s => (
            <Link key={s.id} to={{ name: 'series', slug: s.slug }} className="group block bg-white border border-taupe/30 rounded-sm overflow-hidden luxury-shadow hover:luxury-shadow-lg transition-all">
              <div className="aspect-[16/9] bg-taupe-light overflow-hidden">{s.cover_image && <img src={displayImageUrl(s.cover_image)} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" />}</div>
              <div className="p-6">
                <p className="flex items-center gap-2 text-[10px] tracking-editorial uppercase text-bronze mb-2"><Layers size={12} /> {s.count} part{s.count === 1 ? '' : 's'}</p>
                <h2 className="font-serif text-2xl text-charcoal group-hover:text-bronze transition-colors">{s.title}</h2>
                {s.description && <div className="text-sm text-charcoal-light mt-2 line-clamp-3" dangerouslySetInnerHTML={{ __html: renderMarkdown(s.description) }} />}
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}

export default function SeriesPage({ slug }: { slug: string }) {
  const { series, posts, loading } = useSeriesBySlug(slug);
  useEffect(() => { window.scrollTo(0, 0); }, [slug]);
  if (loading) return <main className="container-narrow py-16"><FeedSkeleton /></main>;
  if (!series) return <EmptyState message="Series not found" />;
  const total = posts.reduce((s, p) => s + (p.reading_time_minutes || 0), 0);
  return (
    <main className="container-narrow py-16 md:py-24">
      <Helmet>
        <title>{series.title} | Lixxon Studio</title>
        <meta name="description" content={series.description || series.title} />
        <script type="application/ld+json">{JSON.stringify({ '@context': 'https://schema.org', '@type': 'ItemList', name: series.title, itemListElement: posts.map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: `${window.location.origin}/blog/${p.slug}`, name: p.title })) })}</script>
      </Helmet>
      <header className="mb-12">
        <Link to={{ name: 'series-index' }} className="text-[11px] tracking-editorial uppercase text-bronze hover:underline">← All series</Link>
        <h1 className="font-serif text-4xl md:text-5xl text-charcoal mt-4 mb-4">{series.title}</h1>
        {series.description && <div className="text-lg text-charcoal-light leading-relaxed" dangerouslySetInnerHTML={{ __html: renderMarkdown(series.description) }} />}
        <p className="flex items-center gap-4 text-xs text-charcoal-muted mt-4"><span className="flex items-center gap-1"><Layers size={12} /> {posts.length} parts</span><span className="flex items-center gap-1"><Clock size={12} /> {total} min total</span></p>
      </header>
      <ol className="space-y-6">
        {posts.map((p, i) => (
          <li key={p.id}>
            <Link to={{ name: 'article', slug: p.slug }} className="group flex gap-6 items-start p-5 border border-taupe/40 rounded-sm bg-white/60 hover:border-bronze transition-colors">
              <span className="font-serif text-3xl text-bronze/70 leading-none w-10 flex-shrink-0">{String(i + 1).padStart(2, '0')}</span>
              <div className="flex-1 min-w-0">
                <h2 className="font-serif text-xl md:text-2xl text-charcoal group-hover:text-bronze transition-colors leading-snug">{p.title}</h2>
                {p.excerpt && <p className="text-sm text-charcoal-light mt-2 line-clamp-2">{p.excerpt}</p>}
                <p className="text-[11px] text-charcoal-muted mt-3 flex items-center gap-3"><span>{p.reading_time_minutes} min read</span>{localStorage.getItem(`resume_${p.id}`) && <span className="text-bronze">In progress</span>}</p>
              </div>
              <ArrowRight size={18} className="text-charcoal-muted group-hover:text-bronze group-hover:translate-x-1 transition-all flex-shrink-0 mt-2" />
            </Link>
          </li>
        ))}
      </ol>
    </main>
  );
}
