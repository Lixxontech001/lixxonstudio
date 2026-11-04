import { useEffect, useState, useMemo } from 'react';
import { Bookmark, ArrowRight, Clock, Trash2, Download, Search, Flame, Share2, Check } from 'lucide-react';
import { Link, useNavigation } from '../context/NavigationContext';
import { useToast } from '../context/ToastContext';
import { Helmet } from 'react-helmet-async';

interface BookmarkItem {
  id: string;
  title: string;
  slug: string;
  saved_at: number;
}

export default function BookmarksPage() {
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null);
  const { showToast } = useToast();
  const { navigate } = useNavigation();

  useEffect(() => {
    window.scrollTo(0, 0);
    try {
      const stored = JSON.parse(localStorage.getItem('lixxon_bookmarks') || '[]');
      setBookmarks(stored);
    } catch {
      /* ignore */
    }
  }, []);

  const removeBookmark = (id: string, slug: string) => {
    localStorage.removeItem(`bookmark_${id}`);
    const stored = JSON.parse(localStorage.getItem('lixxon_bookmarks') || '[]');
    const filtered = stored.filter((b: BookmarkItem) => b.id !== id && b.slug !== slug);
    localStorage.setItem('lixxon_bookmarks', JSON.stringify(filtered));
    setBookmarks(filtered);
    showToast('Removed from saved bookmarks', 'info');
  };

  const clearAllBookmarks = () => {
    if (!confirm('Clear all saved bookmarks from your library?')) return;
    bookmarks.forEach(b => localStorage.removeItem(`bookmark_${b.id}`));
    localStorage.setItem('lixxon_bookmarks', JSON.stringify([]));
    setBookmarks([]);
    showToast('All bookmarks cleared', 'info');
  };

  const exportBookmarks = () => {
    if (bookmarks.length === 0) return;
    const markdown = [
      '# My Lixxon Studio Reading List',
      `Exported on ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`,
      '',
      ...bookmarks.map((b, i) => `${i + 1}. [${b.title}](${window.location.origin}/article/${b.slug})`),
      '',
      '---',
      'Curated via Lixxon Studio (https://lixxonstudio.com)'
    ].join('\n');

    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `lixxon-reading-list-${new Date().toISOString().slice(0, 10)}.md`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('Reading list exported as Markdown', 'success');
  };

  const handleShareStory = async (slug: string, title: string) => {
    const url = `${window.location.origin}/article/${slug}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedSlug(slug);
      showToast(`Link copied for "${title}"`, 'success');
      setTimeout(() => setCopiedSlug(null), 2500);
    } catch {
      showToast('Could not copy link', 'error');
    }
  };

  const filteredBookmarks = useMemo(() => {
    if (!searchQuery.trim()) return bookmarks;
    const q = searchQuery.toLowerCase();
    return bookmarks.filter(b => b.title.toLowerCase().includes(q) || b.slug.toLowerCase().includes(q));
  }, [bookmarks, searchQuery]);

  const estimatedReadingTime = bookmarks.length * 5; // average 5 mins per article

  return (
    <main className="container-wide max-w-4xl mx-auto py-12 md:py-16 px-4 sm:px-6">
      <Helmet>
        <title>Saved Library & Bookmarks | Lixxon Studio</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>

      {/* Header and Quick Stats */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-10 pb-8 border-b border-taupe/40">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-bronze/10 text-bronze rounded-full text-xs font-medium tracking-editorial uppercase mb-3">
            <Bookmark size={13} fill="currentColor" />
            <span>Personal Editorial Vault</span>
          </div>
          <h1 className="font-serif text-3xl sm:text-4xl md:text-5xl text-charcoal font-light tracking-tight">
            Saved Bookmarks
          </h1>
          <p className="text-charcoal-muted text-sm sm:text-base mt-2">
            Articles and cultural stories you have reserved for deep, undisturbed reading.
          </p>
        </div>

        {bookmarks.length > 0 && (
          <div className="flex items-center gap-2">
            <button
              onClick={exportBookmarks}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-white border border-taupe rounded-sm text-xs font-medium text-charcoal hover:border-bronze hover:text-bronze transition-all"
              title="Export as Markdown list"
            >
              <Download size={13} />
              <span>Export</span>
            </button>
            <button
              onClick={clearAllBookmarks}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-white border border-taupe rounded-sm text-xs font-medium text-charcoal-muted hover:text-red-600 hover:border-red-300 transition-all"
              title="Clear all saved bookmarks"
            >
              <Trash2 size={13} />
              <span>Clear</span>
            </button>
          </div>
        )}
      </div>

      {/* Stats Bar */}
      {bookmarks.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-8 bg-white border border-taupe/40 p-4 rounded-sm">
          <div>
            <span className="text-[10px] tracking-editorial uppercase text-charcoal-muted">Saved Stories</span>
            <p className="font-serif text-2xl text-charcoal mt-0.5">{bookmarks.length}</p>
          </div>
          <div>
            <span className="text-[10px] tracking-editorial uppercase text-charcoal-muted">Est. Catch-up Time</span>
            <p className="font-serif text-2xl text-bronze mt-0.5">~{estimatedReadingTime} min</p>
          </div>
          <div className="col-span-2 sm:col-span-1 flex items-center sm:justify-end">
            <button
              onClick={() => navigate({ name: 'trending' })}
              className="inline-flex items-center gap-1.5 text-xs tracking-editorial uppercase font-medium text-bronze hover:text-charcoal transition-colors"
            >
              <Flame size={13} />
              <span>Explore Trending</span>
              <ArrowRight size={13} />
            </button>
          </div>
        </div>
      )}

      {/* Filter and Search */}
      {bookmarks.length > 3 && (
        <div className="mb-6">
          <div className="relative">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-charcoal-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search through saved bookmarks..."
              aria-label="Search saved bookmarks"
              className="w-full bg-white border border-taupe/50 pl-10 pr-4 py-2 text-xs rounded-sm focus:outline-none focus:border-bronze transition-colors"
            />
          </div>
        </div>
      )}

      {/* List Content */}
      {bookmarks.length === 0 ? (
        <div className="max-w-md mx-auto text-center py-20 bg-white border border-taupe/30 rounded-sm p-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-taupe-light mb-6">
            <Bookmark size={24} strokeWidth={1.5} className="text-bronze" />
          </div>
          <h2 className="font-serif text-2xl text-charcoal font-light mb-2">No bookmarks saved yet</h2>
          <p className="text-charcoal-muted text-sm leading-relaxed mb-6">
            Click the bookmark icon on any article or trending story to build your private reading collection.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              to={{ name: 'trending' }}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-2.5 bg-bronze text-white text-xs tracking-editorial uppercase font-medium rounded-sm hover:bg-bronze-dark transition-all"
            >
              <Flame size={14} />
              <span>Browse Trending</span>
            </Link>
            <Link
              to={{ name: 'home', page: 1 }}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-2.5 bg-charcoal text-white text-xs tracking-editorial uppercase font-medium rounded-sm hover:bg-bronze transition-all"
            >
              <span>Explore Magazine</span>
            </Link>
          </div>
        </div>
      ) : filteredBookmarks.length === 0 ? (
        <div className="text-center py-12 bg-white border border-taupe/30 rounded-sm p-8">
          <p className="text-sm text-charcoal-muted">No bookmarks match "{searchQuery}"</p>
          <button
            onClick={() => setSearchQuery('')}
            className="mt-3 text-xs uppercase tracking-editorial font-medium text-bronze hover:underline"
          >
            Clear Search
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredBookmarks.map((item, index) => (
            <div
              key={item.id}
              className="flex items-center justify-between gap-4 p-5 bg-white border border-taupe/40 rounded-sm luxury-shadow hover:border-bronze/50 hover:luxury-shadow-lg transition-all duration-300 group"
            >
              <div className="flex items-start gap-4 min-w-0 flex-1">
                <span className="font-serif text-lg text-bronze/40 font-light w-6 pt-0.5 flex-shrink-0">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <Link to={{ name: 'article', slug: item.slug }} className="flex-1 min-w-0">
                  <h3 className="font-serif text-base sm:text-lg text-charcoal leading-snug group-hover:text-bronze transition-colors line-clamp-2">
                    {item.title}
                  </h3>
                  <div className="flex items-center gap-3 mt-1.5 text-[11px] text-charcoal-muted">
                    <span className="flex items-center gap-1">
                      <Clock size={11} /> Saved {new Date(item.saved_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                    <span>·</span>
                    <span>~5 min read</span>
                  </div>
                </Link>
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => handleShareStory(item.slug, item.title)}
                  className="p-2 text-charcoal-muted hover:text-charcoal transition-colors rounded"
                  title="Copy link"
                  aria-label="Copy link"
                >
                  {copiedSlug === item.slug ? <Check size={14} className="text-green-600" /> : <Share2 size={14} />}
                </button>

                <button
                  onClick={() => removeBookmark(item.id, item.slug)}
                  className="p-2 text-charcoal-muted hover:text-red-500 transition-colors rounded"
                  title="Remove bookmark"
                  aria-label={`Remove ${item.title}`}
                >
                  <Bookmark size={15} fill="currentColor" className="text-bronze hover:text-red-500" />
                </button>

                <Link
                  to={{ name: 'article', slug: item.slug }}
                  className="hidden sm:inline-flex items-center gap-1 text-[11px] tracking-editorial uppercase font-medium text-bronze hover:text-charcoal pl-2"
                >
                  <span>Read</span>
                  <ArrowRight size={12} />
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
