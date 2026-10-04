import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search as SearchIcon, X, BookmarkPlus, SearchX } from 'lucide-react';
import { Helmet } from 'react-helmet-async';
import { useNavigation } from '../context/NavigationContext';
import { useToast } from '../context/ToastContext';
import Pagination from './Pagination';
import QueryStatusNotice from './QueryStatusNotice';
import EmptyState from './EmptyState';
import SearchResultCard from './search/SearchResultCard';
import KnowledgeCard from './search/KnowledgeCard';
import SearchRails, { NoResults, PeopleAlsoSearched } from './search/SearchRails';
import { FilterChips, FilterRail, FilterSheet } from './search/SearchFilters';
import { useSearchHistory } from '../hooks/usePlatform';
import {
  useGlossaryTerms,
  usePeopleAlsoSearched,
  useSavedSearches,
  useSearch,
  useSearchSynonyms,
  useTrendingSearches,
} from '../hooks/useSearch';
import {
  buildSearchQuery,
  effectiveSort,
  expansionNote,
  hasSearchIntent,
  matchGlossaryTerm,
  parseSearchParams,
  prettifySlug,
  SEARCH_PAGE_SIZE,
  totalPages,
  type SearchState,
} from '../lib/searchQuery';

interface SearchPageProps {
  query: string;
  page: number;
}

const INSTANT_DEBOUNCE_MS = 350;

export default function SearchPage({ query, page }: SearchPageProps) {
  const { navigate } = useNavigation();
  const { showToast } = useToast();

  const [state, setState] = useState<SearchState>(() => {
    const fromUrl = parseSearchParams(window.location.search);
    return { ...fromUrl, query: query || fromUrl.query, page: page || fromUrl.page };
  });
  const [inputValue, setInputValue] = useState(state.query);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const resultsRef = useRef<HTMLDivElement | null>(null);

  const { rows: synonyms } = useSearchSynonyms();
  const glossary = useGlossaryTerms();
  const { history, logSearch, clearHistory } = useSearchHistory();
  const trending = useTrendingSearches(6);
  const { saved, loading: savedLoading, save, remove } = useSavedSearches();

  const outcome = useSearch(state, synonyms);
  const alsoSearched = usePeopleAlsoSearched(state.query, 6);
  const sort = effectiveSort(state);
  const intent = hasSearchIntent(state);
  const pages = totalPages(outcome.total, SEARCH_PAGE_SIZE);
  const knowledgeTerm = useMemo(
    () => matchGlossaryTerm(state.query, outcome.terms, glossary),
    [state.query, outcome.terms, glossary],
  );
  const note = useMemo(() => expansionNote(state.query, synonyms), [state.query, synonyms]);

  // ---- URL + router sync -------------------------------------------------
  // Query and page are router state; filters ride along as query-string extras
  // so a shared/reloaded link reproduces exactly what the reader saw.
  useEffect(() => {
    setState((prev) => (prev.query === query && prev.page === page ? prev : { ...prev, query, page }));
    setInputValue(query);
  }, [query, page]);

  useEffect(() => {
    const onPop = () => {
      const parsed = parseSearchParams(window.location.search);
      setState((prev) => ({ ...prev, filters: parsed.filters, sort: parsed.sort }));
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // Whatever changes state, the address bar ends up describing it exactly —
  // including the filters that the router itself does not know about.
  useEffect(() => {
    const path = `/search${buildSearchQuery(state)}`;
    if (window.location.pathname + window.location.search !== path) {
      window.history.replaceState({}, '', path);
    }
  }, [state]);

  const commit = useCallback(
    (next: Partial<SearchState>, options: { push?: boolean } = {}) => {
      setState((prev) => {
        const merged: SearchState = { ...prev, ...next };
        if (next.query !== undefined || next.filters) merged.page = next.page ?? 1;
        if (options.push && (merged.query !== prev.query || merged.page !== prev.page)) {
          navigate({ name: 'search', query: merged.query, page: merged.page });
        }
        const path = `/search${buildSearchQuery(merged)}`;
        if (window.location.pathname + window.location.search !== path) {
          window.history.replaceState({}, '', path);
        }
        return merged;
      });
    },
    [navigate],
  );

  const runSearch = useCallback(
    (nextQuery: string) => {
      const clean = nextQuery.trim();
      setInputValue(clean);
      commit({ query: clean, page: 1 }, { push: true });
    },
    [commit],
  );

  // Instant search: commit typed input after a pause, without spamming history.
  useEffect(() => {
    if (inputValue === state.query) return;
    const timer = window.setTimeout(() => commit({ query: inputValue.trim(), page: 1 }), INSTANT_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [inputValue, state.query, commit]);

  // Record successful searches (and their result counts) once the reader pauses.
  useEffect(() => {
    if (!state.query.trim() || outcome.loading || outcome.error) return;
    const timer = window.setTimeout(() => logSearch(state.query, outcome.total), 900);
    return () => window.clearTimeout(timer);
  }, [state.query, outcome.loading, outcome.error, outcome.total, logSearch]);

  useEffect(() => {
    setActiveIndex(-1);
  }, [state.query, state.filters, state.page]);

  // ---- keyboard navigation over results ----------------------------------
  const resultNodes = () => Array.from(resultsRef.current?.querySelectorAll<HTMLAnchorElement>('[data-search-result]') ?? []);

  const moveFocus = useCallback((delta: number) => {
    const nodes = resultNodes();
    if (nodes.length === 0) return;
    setActiveIndex((prev) => {
      const next = Math.max(0, Math.min(nodes.length - 1, prev + delta));
      nodes[next]?.focus();
      nodes[next]?.scrollIntoView({ block: 'nearest' });
      return next;
    });
  }, []);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveFocus(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveFocus(-1);
    } else if (event.key === 'Escape') {
      setActiveIndex(-1);
      (event.target as HTMLElement).blur?.();
    }
  };

  const clearEverything = () => {
    setInputValue('');
    commit({ query: '', filters: parseSearchParams('').filters, page: 1 });
  };

  const onSaveSearch = async () => {
    const label =
      state.query.trim() ||
      `${prettifySlug(state.filters.category ?? '') || 'All'}${state.filters.tag ? ` #${state.filters.tag}` : ''}`.trim();
    await save(label, state);
    showToast(`Saved “${label}” — find it under Saved searches`, 'success');
  };

  const applySaved = (entry: { query: string; filters: SearchState['filters'] }) => {
    setInputValue(entry.query);
    commit({ query: entry.query, filters: entry.filters, page: 1 }, { push: true });
  };

  const filterPanelProps = {
    filters: state.filters,
    sort,
    query: state.query,
    onChange: (filters: SearchState['filters']) => commit({ filters }),
    onSortChange: (nextSort: SearchState['sort']) => commit({ sort: nextSort }),
    onClearAll: () => commit({ filters: parseSearchParams('').filters }),
  };

  const showResults = intent && !outcome.error;
  const showEmptyLibrary = !intent && history.length === 0 && trending.queries.length === 0 && saved.length === 0;

  return (
    <main className="container-wide py-12 md:py-16">
      <Helmet>
        <title>{state.query ? `Search: ${state.query} | Lixxon Studio` : 'Search | Lixxon Studio'}</title>
        <meta name="description" content="Search every Lixxon Studio article and product — typos welcome." />
        <meta name="robots" content="noindex, follow" />
      </Helmet>

      <div className="max-w-2xl mx-auto text-center mb-10">
        <p className="text-[10px] tracking-ultra-wide uppercase text-bronze mb-4">Search</p>
        <h1 className="font-serif text-3xl md:text-5xl text-charcoal font-light">
          {state.query ? `Results for “${state.query}”` : 'Search the Magazine'}
        </h1>

        <form
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            runSearch(inputValue);
          }}
          className="mt-8 relative"
        >
          <label htmlFor="search-input" className="sr-only">
            Search articles, products and glossary terms
          </label>
          <SearchIcon
            size={18}
            strokeWidth={1.5}
            className="absolute left-4 top-1/2 -translate-y-1/2 text-charcoal-muted"
            aria-hidden="true"
          />
          <input
            id="search-input"
            type="search"
            value={inputValue}
            onChange={(event) => setInputValue(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search articles, topics, products…"
            autoComplete="off"
            enterKeyHint="search"
            aria-describedby="search-hint"
            aria-controls="search-results"
            className="w-full bg-white border border-taupe/50 pl-12 pr-12 py-4 min-h-[56px] text-charcoal placeholder:text-charcoal-muted/50 focus:outline-none focus:border-bronze transition-colors rounded-sm"
          />
          {inputValue && (
            <button
              type="button"
              onClick={() => {
                setInputValue('');
                commit({ query: '', page: 1 });
              }}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex items-center justify-center w-11 h-11 text-charcoal-muted hover:text-bronze"
            >
              <X size={16} />
            </button>
          )}
        </form>

        <p id="search-hint" className="sr-only">
          Results update as you type. Use the up and down arrow keys to move through results, and Enter to open one.
        </p>

        <QueryStatusNotice
          loading={outcome.loading}
          hasData={outcome.results.length > 0}
          error={outcome.error}
          onRetry={outcome.retry}
          unavailableTitle="Search unavailable"
          errorMessage="We could not run that search right now."
        />

        {state.query && !outcome.loading && !outcome.error && (
          <p className="text-charcoal-muted text-sm mt-4" aria-live="polite">
            {outcome.total} {outcome.total === 1 ? 'result' : 'results'}
            {note.length > 0 && <span className="text-charcoal-muted/80"> · also looking for {note.join(', ')}</span>}
            {outcome.refreshing && <span className="text-charcoal-muted/60"> · updating…</span>}
          </p>
        )}
      </div>

      {showResults && (
        <FilterChips
          filters={state.filters}
          onChange={(filters) => commit({ filters })}
          onClearAll={() => commit({ filters: parseSearchParams('').filters })}
          onOpenSheet={() => setSheetOpen(true)}
        />
      )}

      <div className="flex gap-10 items-start">
        {showResults && <FilterRail {...filterPanelProps} />}

        <div className="flex-1 min-w-0">
          {knowledgeTerm && showResults && <KnowledgeCard term={knowledgeTerm} query={state.query} />}

          {!intent ? (
            showEmptyLibrary ? (
              <EmptyState message="Search the magazine" />
            ) : (
              <SearchRails
                history={history}
                trending={trending.queries}
                saved={saved}
                loadingSaved={savedLoading}
                onRun={runSearch}
                onClearHistory={clearHistory}
                onRemoveSaved={(id) => {
                  remove(id);
                }}
                onApplySaved={(entry) => applySaved(entry)}
                onOpenSaved={(entry) => applySaved(entry)}
              />
            )
          ) : outcome.error ? null : outcome.loading ? (
            <div
              className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-12"
              aria-busy="true"
              aria-label="Loading results"
            >
              {[...Array(6)].map((_, index) => (
                <div key={index} className="flex flex-col">
                  <div className="skeleton aspect-[4/5] rounded-sm" />
                  <div className="mt-4 space-y-3">
                    <div className="skeleton h-3 w-20 rounded-full" />
                    <div className="skeleton h-5 w-full" />
                  </div>
                </div>
              ))}
            </div>
          ) : outcome.results.length === 0 ? (
            <NoResults query={state.query} onRun={runSearch} trending={trending.queries} />
          ) : (
            <>
              <div className="flex items-center justify-between mb-6">
                <p className="text-xs text-charcoal-muted">
                  Showing {(state.page - 1) * SEARCH_PAGE_SIZE + 1}–
                  {(state.page - 1) * SEARCH_PAGE_SIZE + outcome.results.length} of {outcome.total}
                </p>
                <button
                  type="button"
                  onClick={onSaveSearch}
                  className="inline-flex items-center gap-2 min-h-[44px] px-3 text-xs text-charcoal-muted border border-taupe/40 rounded-full hover:border-bronze hover:text-bronze transition-colors"
                >
                  <BookmarkPlus size={13} aria-hidden="true" /> Save this search
                </button>
              </div>

              <div
                ref={resultsRef}
                id="search-results"
                role="region"
                aria-label="Search results"
                onKeyDown={onKeyDown}
                className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-12"
              >
                {outcome.results.map((row, index) => (
                  <SearchResultCard key={`${row.result_kind}-${row.id}`} row={row} active={index === activeIndex} />
                ))}
              </div>

              <Pagination
                currentPage={state.page}
                totalPages={pages}
                buildRoute={(nextPage) => ({ name: 'search', query: state.query, page: nextPage })}
              />

              <PeopleAlsoSearched queries={alsoSearched} onRun={runSearch} />

              <div className="mt-10 text-center">
                <button
                  type="button"
                  onClick={clearEverything}
                  className="inline-flex items-center gap-2 text-xs text-charcoal-muted hover:text-bronze transition-colors min-h-[44px]"
                >
                  <SearchX size={14} aria-hidden="true" /> Start a new search
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <FilterSheet {...filterPanelProps} open={sheetOpen} onClose={() => setSheetOpen(false)} />
    </main>
  );
}
