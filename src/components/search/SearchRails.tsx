import { Clock, Flame, History, Bookmark, X, TrendingUp } from 'lucide-react';
import { prettifySlug, type SearchState } from '../../lib/searchQuery';
import type { SavedSearch } from '../../hooks/useSearch';

interface RailsProps {
  history: string[];
  trending: { query: string; searches: number }[];
  saved: SavedSearch[];
  loadingSaved?: boolean;
  onRun: (query: string) => void;
  onClearHistory: () => void;
  onRemoveSaved: (id: string) => void;
  onApplySaved: (saved: SavedSearch) => void;
  onOpenSaved: (saved: SavedSearch) => void;
}

/** Empty-search state: recent, saved and trending searches — never a blank page. */
export default function SearchRails({
  history,
  trending,
  saved,
  loadingSaved,
  onRun,
  onClearHistory,
  onRemoveSaved,
  onApplySaved,
  onOpenSaved,
}: RailsProps) {
  const hasAnything = history.length > 0 || trending.length > 0 || saved.length > 0;

  return (
    <div className="grid md:grid-cols-3 gap-10 max-w-5xl mx-auto text-left">
      <section aria-labelledby="rail-recent">
        <h2 id="rail-recent" className="flex items-center gap-2 text-xs tracking-editorial uppercase text-bronze mb-4">
          <History size={13} aria-hidden="true" /> Recent searches
        </h2>
        {history.length === 0 ? (
          <p className="text-sm text-charcoal-muted">Searches you run appear here, on this device.</p>
        ) : (
          <>
            <ul className="flex flex-wrap gap-2">
              {history.map((term) => (
                <li key={term}>
                  <button
                    type="button"
                    onClick={() => onRun(term)}
                    className="inline-flex items-center gap-1.5 px-3 min-h-[36px] bg-taupe-light/60 text-charcoal-muted text-xs rounded-full border border-taupe/30 hover:border-bronze hover:text-bronze transition-all"
                  >
                    <Clock size={10} aria-hidden="true" /> {term}
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={onClearHistory}
              className="mt-4 min-h-[44px] text-xs text-charcoal-muted hover:text-bronze transition-colors"
            >
              Clear history
            </button>
          </>
        )}
      </section>

      <section aria-labelledby="rail-trending">
        <h2 id="rail-trending" className="flex items-center gap-2 text-xs tracking-editorial uppercase text-bronze mb-4">
          <Flame size={13} aria-hidden="true" /> Trending this fortnight
        </h2>
        {trending.length === 0 ? (
          <p className="text-sm text-charcoal-muted">Trending searches appear once readers start searching.</p>
        ) : (
          <ol className="space-y-2">
            {trending.map((entry, index) => (
              <li key={entry.query}>
                <button
                  type="button"
                  onClick={() => onRun(entry.query)}
                  className="w-full flex items-center gap-3 min-h-[44px] text-left text-sm text-charcoal hover:text-bronze transition-colors"
                >
                  <span className="text-charcoal-muted text-xs w-4">{index + 1}</span>
                  <TrendingUp size={13} className="text-bronze" aria-hidden="true" />
                  <span className="flex-1 truncate">{prettifySlug(entry.query)}</span>
                </button>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section aria-labelledby="rail-saved">
        <h2 id="rail-saved" className="flex items-center gap-2 text-xs tracking-editorial uppercase text-bronze mb-4">
          <Bookmark size={13} aria-hidden="true" /> Saved searches
        </h2>
        {loadingSaved ? (
          <div className="space-y-3" aria-hidden="true">
            <div className="skeleton h-9 w-full rounded-full" />
            <div className="skeleton h-9 w-2/3 rounded-full" />
          </div>
        ) : saved.length === 0 ? (
          <p className="text-sm text-charcoal-muted">
            Save a search and it is one tap away next time — locally, or across devices when you are signed in.
          </p>
        ) : (
          <ul className="space-y-2">
            {saved.map((entry) => (
              <li key={entry.id} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => (entry.local ? onApplySaved(entry) : onOpenSaved(entry))}
                  className="flex-1 min-h-[44px] text-left text-sm text-charcoal hover:text-bronze transition-colors truncate"
                >
                  {entry.label}
                </button>
                <button
                  type="button"
                  onClick={() => onRemoveSaved(entry.id)}
                  aria-label={`Remove saved search ${entry.label}`}
                  className="inline-flex items-center justify-center w-11 h-11 text-charcoal-muted hover:text-bronze"
                >
                  <X size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {!hasAnything && (
        <p className="md:col-span-3 text-center text-sm text-charcoal-muted mt-4">
          Try “niacinamide”, “capsule wardrobe”, “SPF” — typos are fine.
        </p>
      )}
    </div>
  );
}

/** “People also searched” chips shown under a result set. */
export function PeopleAlsoSearched({ queries, onRun }: { queries: string[]; onRun: (query: string) => void }) {
  if (queries.length === 0) return null;
  return (
    <section aria-labelledby="also-searched" className="mt-14 border-t border-taupe/30 pt-8">
      <h2 id="also-searched" className="text-xs tracking-editorial uppercase text-bronze mb-4">
        People also searched
      </h2>
      <ul className="flex flex-wrap gap-2">
        {queries.map((term) => (
          <li key={term}>
            <button
              type="button"
              onClick={() => onRun(term)}
              className="px-3 min-h-[36px] bg-taupe-light/60 text-charcoal-muted text-xs rounded-full border border-taupe/30 hover:border-bronze hover:text-bronze transition-all"
            >
              {term}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** “No results” state with a way forward instead of a dead end. */
export function NoResults({
  query,
  onRun,
  trending,
}: {
  query: string;
  onRun: (query: string) => void;
  trending: { query: string; searches: number }[];
}) {
  return (
    <div className="max-w-xl mx-auto text-center py-12">
      <h2 className="font-serif text-2xl text-charcoal font-light mb-3">Nothing matched “{query}”</h2>
      <p className="text-charcoal-muted text-sm leading-relaxed mb-8">
        Typos are usually fine, so this is probably a gap in our library rather than in your spelling. Try a broader
        word, drop a filter, or tell us what you were looking for — we write what readers ask for.
      </p>
      {trending.length > 0 && (
        <div className="mb-8">
          <p className="text-[10px] tracking-ultra-wide uppercase text-bronze mb-3">Readers are searching for</p>
          <ul className="flex flex-wrap gap-2 justify-center">
            {trending.slice(0, 5).map((entry) => (
              <li key={entry.query}>
                <button
                  type="button"
                  onClick={() => onRun(entry.query)}
                  className="px-3 min-h-[36px] bg-taupe-light/60 text-charcoal-muted text-xs rounded-full border border-taupe/30 hover:border-bronze hover:text-bronze"
                >
                  {entry.query}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export type { SearchState };
