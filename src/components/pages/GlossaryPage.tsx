import { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { BookA, Search } from 'lucide-react';
import { useGlossaryTerms } from '../../hooks/useV3';
import { FeedSkeleton } from '../Skeletons';

/** A–Z skincare & beauty glossary (the same terms power hover definitions inside articles). */
export default function GlossaryPage() {
  const { terms, loading } = useGlossaryTerms();
  const [q, setQ] = useState('');
  const [letter, setLetter] = useState('');
  useEffect(() => { window.scrollTo(0, 0); }, []);
  const letters = useMemo(() => Array.from(new Set(terms.map(t => t.term[0]?.toUpperCase()))).sort(), [terms]);
  const list = useMemo(() => terms.filter(t => (!letter || t.term[0]?.toUpperCase() === letter) && (!q || `${t.term} ${t.definition}`.toLowerCase().includes(q.toLowerCase()))), [terms, q, letter]);
  const grouped = useMemo(() => { const g: Record<string, typeof terms> = {}; list.forEach(t => { const l = t.term[0]?.toUpperCase() || '#'; (g[l] ||= []).push(t); }); return g; }, [list]);

  return (
    <main className="container-narrow py-16 md:py-24">
      <Helmet>
        <title>Beauty Glossary | Lixxon Studio</title>
        <meta name="description" content="Plain-English definitions of skincare and beauty terms, from AHAs to zinc oxide." />
        <script type="application/ld+json">{JSON.stringify({ '@context': 'https://schema.org', '@type': 'DefinedTermSet', name: 'Lixxon Studio Beauty Glossary', hasDefinedTerm: terms.slice(0, 200).map(t => ({ '@type': 'DefinedTerm', name: t.term, description: t.definition })) })}</script>
      </Helmet>
      <header className="text-center mb-10">
        <BookA size={28} strokeWidth={1.25} className="mx-auto text-bronze mb-4" />
        <h1 className="font-serif text-4xl md:text-5xl text-charcoal mb-3">The Glossary</h1>
        <p className="text-charcoal-light">Every term we use, explained without the jargon. Hover any of these inside an article for a quick definition.</p>
      </header>
      <div className="relative mb-6">
        <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-charcoal-muted" />
        <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Search terms…" aria-label="Search glossary" className="w-full pl-11 pr-4 py-3 border border-taupe rounded-sm text-sm bg-white focus:outline-none focus:border-bronze" />
      </div>
      <nav aria-label="Jump to letter" className="flex flex-wrap gap-1 mb-10">
        <button onClick={() => setLetter('')} className={`w-8 h-8 text-xs rounded-sm ${!letter ? 'bg-charcoal text-white' : 'hover:bg-taupe-light'}`}>All</button>
        {letters.map(l => <button key={l} onClick={() => setLetter(l === letter ? '' : l)} className={`w-8 h-8 text-xs rounded-sm ${letter === l ? 'bg-charcoal text-white' : 'hover:bg-taupe-light'}`}>{l}</button>)}
      </nav>
      {loading ? <FeedSkeleton /> : list.length === 0 ? <p className="text-charcoal-muted text-center">No terms match.</p> : (
        Object.keys(grouped).sort().map(l => (
          <section key={l} className="mb-10" aria-labelledby={`g-${l}`}>
            <h2 id={`g-${l}`} className="font-serif text-3xl text-bronze mb-4 border-b border-taupe/40 pb-2">{l}</h2>
            <dl className="space-y-5">
              {grouped[l].map(t => (
                <div key={t.id} id={t.slug}>
                  <dt className="font-medium text-charcoal flex items-baseline gap-3">{t.term}{t.category && <span className="text-[10px] tracking-editorial uppercase text-charcoal-muted">{t.category}</span>}</dt>
                  <dd className="text-[15px] leading-relaxed text-charcoal-light mt-1">{t.definition}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))
      )}
    </main>
  );
}
