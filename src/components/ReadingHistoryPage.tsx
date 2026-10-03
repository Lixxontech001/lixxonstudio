import { useEffect, useState } from 'react';
import { Clock, Trash2, BookOpen, ArrowRight } from 'lucide-react';
import { Link } from '../context/NavigationContext';
import { useReadingHistory } from '../hooks/useFeatures';
import { Helmet } from 'react-helmet-async';
import EmptyState from './EmptyState';

export default function ReadingHistoryPage() {
  const { history, clearHistory } = useReadingHistory();
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => { window.scrollTo(0, 0); }, []);

  return (
    <main className="container-wide py-12 md:py-16">
      <Helmet>
        <title>Reading History | Lixxon Studio</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>

      <div className="flex items-start justify-between mb-10 flex-wrap gap-4">
        <div>
          <p className="text-[10px] tracking-ultra-wide uppercase text-bronze mb-3">Your Activity</p>
          <h1 className="font-serif text-3xl md:text-5xl text-charcoal font-light">Reading History</h1>
          <p className="text-charcoal-muted text-base mt-3 max-w-md">Articles you have recently read, stored privately on this device.</p>
        </div>
        {history.length > 0 && (
          <button
            onClick={() => confirmClear ? clearHistory() : setConfirmClear(true)}
            onMouseLeave={() => setConfirmClear(false)}
            className="inline-flex items-center gap-2 px-4 py-2.5 border border-taupe text-charcoal-muted text-xs tracking-editorial uppercase rounded-sm hover:border-red-300 hover:text-red-600 transition-all"
          >
            <Trash2 size={14} /> {confirmClear ? 'Click again to confirm' : 'Clear History'}
          </button>
        )}
      </div>

      {history.length === 0 ? (
        <div className="max-w-md mx-auto text-center py-20">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-taupe-light mb-6">
            <BookOpen size={24} strokeWidth={1.5} className="text-bronze" />
          </div>
          <h2 className="font-serif text-2xl text-charcoal font-light mb-3">No reading history yet</h2>
          <p className="text-charcoal-muted text-sm leading-relaxed mb-8">
            Articles you read will appear here so you can easily return to them.
          </p>
          <Link to={{ name: 'home', page: 1 }} className="inline-flex items-center gap-2 px-6 py-3 bg-charcoal text-white text-xs tracking-editorial uppercase font-medium rounded-sm hover:bg-bronze transition-all">
            Browse Magazine <ArrowRight size={14} />
          </Link>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-10 max-w-5xl">
          {history.map(item => (
            <Link key={item.id} to={{ name: 'article', slug: item.slug }} className="group flex flex-col">
              <div className="img-zoom rounded-sm overflow-hidden luxury-shadow aspect-[4/5] bg-taupe-light">
                {item.cover_image && <img src={item.cover_image} alt={item.title} className="w-full h-full object-cover" loading="lazy" />}
              </div>
              <div className="mt-4">
                <h3 className="font-serif text-lg text-charcoal leading-snug group-hover:text-bronze transition-colors duration-300 line-clamp-2">{item.title}</h3>
                <div className="flex items-center gap-2 mt-3 text-[11px] text-charcoal-muted">
                  <Clock size={10} strokeWidth={1.5} />
                  {new Date(item.read_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
