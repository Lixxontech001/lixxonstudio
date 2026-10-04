import { BookOpen, ArrowRight } from 'lucide-react';
import { Link } from '../../context/NavigationContext';
import type { GlossaryRow } from '../../lib/searchQuery';

/**
 * Ingredient knowledge card: when the query names something in the glossary
 * (including through a synonym — "nicotinamide" finds Niacinamide), the reader
 * gets the definition before the result list, plus routes into the articles and
 * products that mention it.
 */
export default function KnowledgeCard({ term, query }: { term: GlossaryRow; query: string }) {
  const searchTerm = term.term;

  return (
    <section
      className="border border-taupe/40 bg-white rounded-sm p-6 md:p-8 mb-10"
      aria-label={`Glossary: ${term.term}`}
    >
      <div className="flex items-start gap-4">
        <span className="inline-flex items-center justify-center w-11 h-11 rounded-full bg-taupe-light shrink-0" aria-hidden="true">
          <BookOpen size={18} strokeWidth={1.5} className="text-bronze" />
        </span>
        <div className="min-w-0">
          <p className="text-[10px] tracking-ultra-wide uppercase text-bronze mb-1">
            From the glossary{term.category ? ` · ${term.category}` : ''}
          </p>
          <h2 className="font-serif text-2xl text-charcoal font-light">{term.term}</h2>
          <p className="text-charcoal-muted text-sm leading-relaxed mt-3">{term.definition}</p>

          <div className="flex flex-wrap items-center gap-3 mt-5">
            <Link
              to={{ name: 'glossary' }}
              className="inline-flex items-center gap-2 min-h-[44px] px-4 text-xs tracking-editorial uppercase bg-charcoal text-white rounded-sm hover:bg-bronze transition-colors"
            >
              Open the glossary <ArrowRight size={14} />
            </Link>
            <Link
              to={{ name: 'search', query: searchTerm, page: 1 }}
              className="inline-flex items-center gap-2 min-h-[44px] px-4 text-xs tracking-editorial uppercase border border-taupe/40 text-charcoal-muted rounded-sm hover:border-bronze hover:text-bronze transition-colors"
            >
              Everything on {searchTerm}
            </Link>
            {query.toLowerCase() !== searchTerm.toLowerCase() && (
              <span className="text-[11px] text-charcoal-muted">
                You searched “{query}” — same thing as {searchTerm}.
              </span>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
