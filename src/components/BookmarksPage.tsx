import { useEffect, useState } from 'react';
import { Bookmark, ArrowRight, Clock } from 'lucide-react';
import { Link, useNavigation } from '../context/NavigationContext';
import { Helmet } from 'react-helmet-async';

interface BookmarkItem {
  id: string;
  title: string;
  slug: string;
  saved_at: number;
}

export default function BookmarksPage() {
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>([]);
  const { navigate } = useNavigation();

  useEffect(() => {
    window.scrollTo(0, 0);
    try {
      const stored = JSON.parse(localStorage.getItem('lixxon_bookmarks') || '[]');
      setBookmarks(stored);
    } catch { /* ignore */ }
  }, []);

  const removeBookmark = (id: string, title: string) => {
    localStorage.removeItem(`bookmark_${id}`);
    const stored = JSON.parse(localStorage.getItem('lixxon_bookmarks') || '[]');
    const filtered = stored.filter((b: BookmarkItem) => b.id !== id);
    localStorage.setItem('lixxon_bookmarks', JSON.stringify(filtered));
    setBookmarks(filtered);
  };

  return (
    <main className="container-wide py-12 md:py-16">
      <Helmet>
        <title>Bookmarks | Lixxon Studio</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>

      <div className="mb-10">
        <p className="text-[10px] tracking-ultra-wide uppercase text-bronze mb-3">Saved</p>
        <h1 className="font-serif text-3xl md:text-5xl text-charcoal font-light">Your Bookmarks</h1>
        <p className="text-charcoal-muted text-base mt-3 max-w-md">Articles you have saved to revisit later.</p>
      </div>

      {bookmarks.length === 0 ? (
        <div className="max-w-md mx-auto text-center py-20">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-taupe-light mb-6">
            <Bookmark size={24} strokeWidth={1.5} className="text-bronze" />
          </div>
          <h2 className="font-serif text-2xl text-charcoal font-light mb-3">No bookmarks yet</h2>
          <p className="text-charcoal-muted text-sm leading-relaxed mb-8">
            Look for the bookmark icon on any article to save it for later.
          </p>
          <Link to={{ name: 'home', page: 1 }} className="inline-flex items-center gap-2 px-6 py-3 bg-charcoal text-white text-xs tracking-editorial uppercase font-medium rounded-sm hover:bg-bronze transition-all">
            Browse Magazine <ArrowRight size={14} />
          </Link>
        </div>
      ) : (
        <div className="max-w-3xl space-y-4">
          {bookmarks.map(item => (
            <div key={item.id} className="flex items-center gap-4 p-5 bg-white border border-taupe/30 rounded-sm luxury-shadow hover:luxury-shadow-lg transition-all duration-300">
              <Link to={{ name: 'article', slug: item.slug }} className="flex-1 min-w-0">
                <h3 className="font-serif text-lg text-charcoal leading-snug line-clamp-2">{item.title}</h3>
                <div className="flex items-center gap-2 mt-2 text-[11px] text-charcoal-muted">
                  <Clock size={10} strokeWidth={1.5} />
                  Saved {new Date(item.saved_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </div>
              </Link>
              <button
                onClick={() => removeBookmark(item.id, item.title)}
                className="w-9 h-9 rounded-full border border-taupe flex items-center justify-center text-charcoal-muted hover:text-red-500 hover:border-red-300 transition-all flex-shrink-0"
                aria-label="Remove bookmark"
              >
                <Bookmark size={14} strokeWidth={1.5} fill="currentColor" />
              </button>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
