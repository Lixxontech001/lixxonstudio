import { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { BookA, Search, Volume2, Shield, Sparkles, Copy, Check, Filter } from 'lucide-react';
import { useGlossaryTerms } from '../../hooks/useV3';
import { FeedSkeleton } from '../Skeletons';

const CATEGORIES = [
  'All',
  'Clinical Actives',
  'Peptides',
  'Exfoliating Acids',
  'Lipids & Ceramides',
  'Botanicals',
  'Antioxidants',
];

/** Advanced A–Z skincare & formulation glossary. */
export default function GlossaryPage() {
  const { terms, loading } = useGlossaryTerms();
  const [q, setQ] = useState('');
  const [letter, setLetter] = useState('');
  const [activeCategory, setActiveCategory] = useState('All');
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const handleCopyDefinition = (text: string, slug: string) => {
    if (navigator?.clipboard) {
      navigator.clipboard.writeText(text);
      setCopiedSlug(slug);
      setTimeout(() => setCopiedSlug(null), 2500);
    }
  };

  const letters = useMemo(() => Array.from(new Set(terms.map(t => t.term[0]?.toUpperCase()))).sort(), [terms]);

  const list = useMemo(() => {
    return terms.filter(t => {
      const matchLetter = !letter || t.term[0]?.toUpperCase() === letter;
      const matchCat = activeCategory === 'All' || (t.category && t.category.toLowerCase().includes(activeCategory.toLowerCase()));
      const matchQ =
        !q ||
        `${t.term} ${t.definition} ${t.category || ''} ${t.skin_suitability || ''}`
          .toLowerCase()
          .includes(q.toLowerCase());
      return matchLetter && matchCat && matchQ;
    });
  }, [terms, q, letter, activeCategory]);

  const grouped = useMemo(() => {
    const g: Record<string, typeof terms> = {};
    list.forEach(t => {
      const l = t.term[0]?.toUpperCase() || '#';
      (g[l] ||= []).push(t);
    });
    return g;
  }, [list]);

  return (
    <main className="container-narrow py-16 md:py-24 text-charcoal dark:text-[#E8E2D9] transition-colors duration-300">
      <Helmet>
        <title>Scientific Skincare &amp; Formulation Glossary | Lixxon Studio</title>
        <meta
          name="description"
          content="Plain-English, biochemically verified definitions of active skincare ingredients, peptides, barrier lipids, and clinical formulation terminology."
        />
        <script type="application/ld+json">
          {JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'DefinedTermSet',
            name: 'Lixxon Studio Skincare Formulation Glossary',
            hasDefinedTerm: terms.slice(0, 200).map(t => ({
              '@type': 'DefinedTerm',
              name: t.term,
              description: t.definition,
            })),
          })}
        </script>
      </Helmet>

      {/* Header */}
      <header className="text-center mb-12">
        <div className="w-12 h-12 rounded-full bg-bronze/10 text-bronze dark:bg-bronze/20 dark:text-bronze-light flex items-center justify-center mx-auto mb-4">
          <BookA size={24} strokeWidth={1.5} />
        </div>
        <p className="text-xs tracking-editorial uppercase text-bronze font-semibold mb-2">
          Evidence-Based Formulation Library
        </p>
        <h1 className="font-serif text-4xl md:text-5xl text-charcoal dark:text-white mb-4 tracking-tight">
          The Scientific Glossary
        </h1>
        <p className="text-charcoal-light dark:text-gray-300 max-w-xl mx-auto text-sm sm:text-base leading-relaxed">
          Every active ingredient, peptide bond, and dermatological term explained with precision. Hover any of these
          inside our editorial articles for instantaneous formulation definitions.
        </p>
      </header>

      {/* Search Bar */}
      <div className="relative mb-6">
        <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-charcoal-muted" />
        <input
          type="search"
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search ingredients, barrier lipids, peptides, concerns…"
          aria-label="Search glossary"
          className="w-full pl-11 pr-4 py-3.5 border border-taupe/60 dark:border-white/15 rounded-sm text-sm bg-white dark:bg-[#1A1A1A] text-charcoal dark:text-white placeholder:text-charcoal-muted/60 focus:outline-none focus:border-bronze shadow-xs transition-colors"
        />
      </div>

      {/* Category Pills */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-2 mb-6 no-scrollbar">
        <span className="text-xs text-charcoal-muted dark:text-gray-400 flex items-center gap-1 mr-1 flex-shrink-0">
          <Filter size={12} /> Filter:
        </span>
        {CATEGORIES.map(c => (
          <button
            key={c}
            onClick={() => setActiveCategory(c)}
            className={`px-3 py-1.5 text-xs rounded-full transition-all duration-300 whitespace-nowrap ${
              activeCategory === c
                ? 'bg-charcoal text-white dark:bg-bronze dark:text-white shadow-xs'
                : 'bg-taupe-light/40 dark:bg-white/5 text-charcoal-muted dark:text-gray-400 border border-taupe/30 dark:border-white/10 hover:border-bronze'
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      {/* Alphabet Jump Bar */}
      <nav aria-label="Jump to letter" className="flex flex-wrap gap-1 mb-12">
        <button
          onClick={() => setLetter('')}
          className={`w-8 h-8 text-xs font-medium rounded-sm transition-colors ${
            !letter
              ? 'bg-charcoal text-white dark:bg-bronze dark:text-white shadow-xs'
              : 'hover:bg-taupe-light dark:hover:bg-white/10 text-charcoal-muted dark:text-gray-400'
          }`}
        >
          All
        </button>
        {letters.map(l => (
          <button
            key={l}
            onClick={() => setLetter(l === letter ? '' : l)}
            className={`w-8 h-8 text-xs font-medium rounded-sm transition-colors ${
              letter === l
                ? 'bg-charcoal text-white dark:bg-bronze dark:text-white shadow-xs'
                : 'hover:bg-taupe-light dark:hover:bg-white/10 text-charcoal-muted dark:text-gray-400'
            }`}
          >
            {l}
          </button>
        ))}
      </nav>

      {/* Grouped Alphabetical Term Sections */}
      {loading ? (
        <FeedSkeleton />
      ) : list.length === 0 ? (
        <div className="text-center py-16 bg-white dark:bg-[#1A1A1A] border border-taupe/30 dark:border-white/10 rounded-sm p-8">
          <p className="text-charcoal-muted dark:text-gray-400 mb-2">No ingredients or terms match your search.</p>
          <button
            onClick={() => {
              setQ('');
              setLetter('');
              setActiveCategory('All');
            }}
            className="text-xs text-bronze hover:underline dark:text-bronze-light font-medium uppercase tracking-editorial"
          >
            Reset Filters
          </button>
        </div>
      ) : (
        Object.keys(grouped)
          .sort()
          .map(l => (
            <section key={l} className="mb-14" aria-labelledby={`g-${l}`}>
              <h2
                id={`g-${l}`}
                className="font-serif text-3xl text-bronze dark:text-bronze-light mb-6 border-b border-taupe/40 dark:border-white/10 pb-2 flex items-baseline justify-between"
              >
                <span>{l}</span>
                <span className="text-xs font-mono font-normal text-charcoal-muted dark:text-gray-500">
                  {grouped[l].length} {grouped[l].length === 1 ? 'entry' : 'entries'}
                </span>
              </h2>

              <dl className="space-y-6">
                {grouped[l].map(t => (
                  <div
                    key={t.id}
                    id={t.slug}
                    className="p-5 rounded-sm bg-white dark:bg-[#161616] border border-taupe/20 dark:border-white/5 hover:border-bronze/40 dark:hover:border-bronze/40 transition-all duration-300 shadow-xs"
                  >
                    <dt className="flex items-center justify-between gap-3 flex-wrap">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-serif text-lg font-medium text-charcoal dark:text-white">
                          {t.term}
                        </span>
                        {t.pronunciation && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-mono text-bronze dark:text-bronze-light bg-bronze/10 dark:bg-bronze/20 px-2 py-0.5 rounded">
                            <Volume2 size={11} /> {t.pronunciation}
                          </span>
                        )}
                        {t.category && (
                          <span className="text-[10px] tracking-editorial uppercase text-charcoal-muted dark:text-gray-400 px-2 py-0.5 bg-taupe-light/50 dark:bg-white/5 rounded">
                            {t.category}
                          </span>
                        )}
                      </div>

                      <button
                        onClick={() => handleCopyDefinition(t.definition, t.slug)}
                        className="inline-flex items-center gap-1 text-[11px] text-charcoal-muted hover:text-bronze dark:text-gray-400 dark:hover:text-bronze-light transition-colors"
                        title="Copy definition"
                      >
                        {copiedSlug === t.slug ? (
                          <>
                            <Check size={12} className="text-green-600" /> Copied
                          </>
                        ) : (
                          <>
                            <Copy size={12} /> Copy
                          </>
                        )}
                      </button>
                    </dt>

                    <dd className="text-[14px] leading-relaxed text-charcoal-light dark:text-gray-300 mt-2.5">
                      {t.definition}
                    </dd>

                    {(t.skin_suitability || t.synergies) && (
                      <div className="mt-3.5 pt-3 border-t border-taupe/15 dark:border-white/5 flex flex-wrap items-center gap-3 text-xs">
                        {t.skin_suitability && (
                          <span className="text-emerald-700 dark:text-emerald-300 flex items-center gap-1.5 font-medium">
                            <Shield size={12} /> Suitable for: {t.skin_suitability}
                          </span>
                        )}
                        {t.synergies && (
                          <span className="text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
                            <Sparkles size={12} className="text-bronze" /> {t.synergies}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </dl>
            </section>
          ))
      )}
    </main>
  );
}
