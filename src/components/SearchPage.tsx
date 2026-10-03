import { useState, useEffect } from 'react';
import { Search, ArrowRight, Clock, X, History } from 'lucide-react';
import { useNavigation, Link } from '../context/NavigationContext';
import { useSearchPosts } from '../hooks/useSupabase';
import { useSearchHistory } from '../hooks/usePlatform';
import { Helmet } from 'react-helmet-async';
import Pagination from './Pagination';
import EmptyState from './EmptyState';

interface SearchPageProps {
  query: string;
  page: number;
}

export default function SearchPage({ query, page }: SearchPageProps) {
  const { navigate } = useNavigation();
  const { posts, total, totalPages, loading } = useSearchPosts(query, page);
  const [inputValue, setInputValue] = useState(query);
  const { history, logSearch, clearHistory } = useSearchHistory();

  useEffect(() => {
    setInputValue(query);
  }, [query]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [page, query]);

  useEffect(() => {
    if (query.trim()) logSearch(query);
  }, [query, logSearch]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputValue.trim()) {
      navigate({ name: 'search', query: inputValue.trim(), page: 1 });
    }
  };

  const buildRoute = (p: number) => ({ name: 'search' as const, query, page: p });

  return (
    <main className="container-wide py-12 md:py-16">
      <Helmet>
        <title>{query ? `Search: ${query} | Lixxon Studio` : 'Search | Lixxon Studio'}</title>
        <meta name="description" content={`Search results for "${query}" on Lixxon Studio`} />
      </Helmet>

      <div className="max-w-2xl mx-auto text-center mb-12">
        <p className="text-[10px] tracking-ultra-wide uppercase text-bronze mb-4">Search</p>
        <h1 className="font-serif text-3xl md:text-5xl text-charcoal font-light">
          {query ? `Results for "${query}"` : 'Search the Magazine'}
        </h1>

        <form onSubmit={handleSubmit} className="mt-8 relative">
          <Search size={18} strokeWidth={1.5} className="absolute left-4 top-1/2 -translate-y-1/2 text-charcoal-muted" />
          <input
            type="text"
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            placeholder="Search articles, topics..."
            aria-label="Search articles"
            className="w-full bg-white border border-taupe/50 pl-12 pr-4 py-4 text-charcoal placeholder:text-charcoal-muted/50 focus:outline-none focus:border-bronze transition-colors rounded-sm"
          />
        </form>

        {query && !loading && (
          <p className="text-charcoal-muted text-sm mt-4">
            {total} {total === 1 ? 'article' : 'articles'} found
          </p>
        )}

        {!query && history.length > 0 && (
          <div className="mt-8 max-w-md mx-auto">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs text-charcoal-muted flex items-center gap-1.5"><History size={12} /> Recent Searches</span>
              <button onClick={clearHistory} className="text-xs text-charcoal-muted hover:text-bronze transition-colors">Clear</button>
            </div>
            <div className="flex flex-wrap gap-2 justify-center">
              {history.map((h, i) => (
                <button key={i} onClick={() => navigate({ name: 'search', query: h, page: 1 })} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-taupe-light/60 text-charcoal-muted text-xs rounded-full border border-taupe/30 hover:border-bronze hover:text-bronze transition-all">
                  <Clock size={10} /> {h}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {loading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-12 max-w-5xl mx-auto">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="flex flex-col">
              <div className="skeleton aspect-[4/5] rounded-sm" />
              <div className="mt-4 space-y-3">
                <div className="skeleton h-3 w-20 rounded-full" />
                <div className="skeleton h-5 w-full" />
              </div>
            </div>
          ))}
        </div>
      ) : !query ? (
        <EmptyState message="Type a search query above to find articles" />
      ) : posts.length === 0 ? (
        <div className="max-w-md mx-auto text-center py-16">
          <Search size={40} strokeWidth={1} className="text-taupe mx-auto mb-4" />
          <h2 className="font-serif text-2xl text-charcoal font-light mb-3">No articles found</h2>
          <p className="text-charcoal-muted text-sm leading-relaxed mb-8">
            We could not find anything matching "{query}". Try a different keyword, or browse the magazine by category.
          </p>
          <Link
            to={{ name: 'home', page: 1 }}
            className="inline-flex items-center gap-2 px-6 py-3 bg-charcoal text-white text-xs tracking-editorial uppercase font-medium rounded-sm hover:bg-bronze transition-all"
          >
            Browse Magazine <ArrowRight size={14} />
          </Link>
        </div>
      ) : (
        <>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-12 max-w-5xl mx-auto">
            {posts.map(post => (
              <Link
                key={post.id}
                to={{ name: 'article', slug: post.slug }}
                className="group flex flex-col text-left"
              >
                <div className="img-zoom rounded-sm overflow-hidden luxury-shadow relative aspect-[4/5]">
                  {post.cover_image && (
                    <img src={post.cover_image} alt={post.title} className="w-full h-full object-cover" loading="lazy" />
                  )}
                  {post.category && (
                    <span className="absolute top-4 left-4 text-[9px] tracking-editorial uppercase text-white bg-charcoal/60 backdrop-blur-md px-3 py-1.5 rounded-full">
                      {post.category.name}
                    </span>
                  )}
                </div>
                <div className="mt-5">
                  <h3 className="font-serif text-xl text-charcoal leading-snug group-hover:text-bronze transition-colors duration-300 line-clamp-3">
                    {post.title}
                  </h3>
                  {post.excerpt && (
                    <p className="text-charcoal-muted text-sm mt-2.5 leading-relaxed line-clamp-2">{post.excerpt}</p>
                  )}
                  <div className="flex items-center gap-3 mt-4 text-[11px] text-charcoal-muted">
                    <span>{new Date(post.published_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                    <span className="text-taupe-dark">·</span>
                    <span className="flex items-center gap-1"><Clock size={10} strokeWidth={1.5} /> {post.reading_time_minutes} min</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
          <Pagination currentPage={page} totalPages={totalPages} buildRoute={buildRoute} />
        </>
      )}
    </main>
  );
}
