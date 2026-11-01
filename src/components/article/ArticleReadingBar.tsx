import { useState, useEffect } from 'react';
import { Bookmark, Share2, List, Maximize2, Minimize2, Check, ArrowUp } from 'lucide-react';
import { Link } from '../../context/NavigationContext';

export interface ArticleReadingBarProps {
  title: string;
  authorName?: string;
  categoryName?: string;
  categorySlug?: string;
  progress: number;
  timeRemaining: number | null;
  bookmarked: boolean;
  onToggleBookmark: () => void;
  headings: { id: string; text: string }[];
  activeHeading: string;
  focusMode: boolean;
  onToggleFocusMode: () => void;
}

export default function ArticleReadingBar({
  title,
  authorName,
  categoryName,
  categorySlug,
  progress,
  timeRemaining,
  bookmarked,
  onToggleBookmark,
  headings,
  activeHeading,
  focusMode,
  onToggleFocusMode,
}: ArticleReadingBarProps) {
  const [visible, setVisible] = useState(false);
  const [showToc, setShowToc] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      // Reveal the sticky header once user has scrolled past 320px
      const y = window.scrollY;
      setVisible(y > 320);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const handleShare = () => {
    if (navigator.share) {
      navigator.share({ title, url: window.location.href }).catch(() => undefined);
    } else {
      navigator.clipboard.writeText(window.location.href).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    }
  };

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <>
      {/* Top 3px Progress Bar (Always active while reading) */}
      <div
        className="fixed top-0 left-0 right-0 h-[3px] bg-taupe/20 z-50 pointer-events-none"
        role="progressbar"
        aria-valuenow={Math.round(progress)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="h-full bg-bronze transition-all duration-150 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Floating Reader Toolbar (Visible on scroll) */}
      <div
        className={`fixed top-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-b border-taupe/40 transition-all duration-300 transform shadow-sm ${
          visible ? 'translate-y-0 opacity-100' : '-translate-y-full opacity-0 pointer-events-none'
        }`}
      >
        <div className="container-wide h-14 flex items-center justify-between gap-4">
          {/* Left: Article Meta & Progress */}
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={scrollToTop}
              className="p-1.5 text-charcoal-muted hover:text-bronze transition-colors flex-shrink-0"
              title="Scroll to top"
              aria-label="Scroll to top"
            >
              <ArrowUp size={16} />
            </button>
            <div className="min-w-0">
              <h2 className="text-xs md:text-sm font-serif text-charcoal font-medium truncate max-w-md">
                {title}
              </h2>
              <p className="text-[10px] text-charcoal-muted flex items-center gap-2 mt-0.5">
                {authorName && <span>By {authorName}</span>}
                {categoryName && (
                  <>
                    <span>·</span>
                    <span className="text-bronze uppercase tracking-wider">{categoryName}</span>
                  </>
                )}
                <span>·</span>
                <span className="font-mono text-bronze">{Math.round(progress)}% read</span>
                {timeRemaining !== null && timeRemaining > 0 && (
                  <span className="hidden sm:inline">({timeRemaining} min left)</span>
                )}
              </p>
            </div>
          </div>

          {/* Right: Actions */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {/* Table of Contents Popover Trigger */}
            {headings.length > 2 && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowToc(!showToc)}
                  className={`p-2 rounded-sm text-xs flex items-center gap-1.5 transition-colors ${
                    showToc ? 'bg-bronze text-white' : 'text-charcoal-muted hover:text-charcoal hover:bg-taupe-light/50'
                  }`}
                  aria-label="Toggle Table of Contents"
                  title="Table of Contents"
                >
                  <List size={16} />
                  <span className="hidden md:inline text-[11px] tracking-editorial uppercase">Contents</span>
                </button>

                {showToc && (
                  <div className="absolute right-0 top-full mt-2 w-72 max-h-80 overflow-y-auto bg-white border border-taupe/40 rounded-sm shadow-xl p-3 space-y-1.5 animate-fade-in z-50">
                    <p className="text-[10px] font-semibold tracking-editorial uppercase text-bronze pb-1 border-b border-taupe/20">
                      Table of Contents
                    </p>
                    {headings.map(h => (
                      <a
                        key={h.id}
                        href={`#${h.id}`}
                        onClick={() => setShowToc(false)}
                        className={`block text-xs py-1.5 px-2 rounded transition-colors ${
                          activeHeading === h.id
                            ? 'bg-bronze/10 text-bronze font-medium'
                            : 'text-charcoal-muted hover:text-charcoal hover:bg-taupe-light/30'
                        }`}
                      >
                        {h.text}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Focus / Zen Reading Mode Toggle */}
            <button
              type="button"
              onClick={onToggleFocusMode}
              className={`p-2 rounded-sm text-charcoal-muted hover:text-charcoal hover:bg-taupe-light/50 transition-colors ${
                focusMode ? 'text-bronze bg-bronze/10' : ''
              }`}
              title={focusMode ? 'Exit Zen Focus Mode' : 'Enter Zen Focus Mode'}
              aria-label="Toggle focus mode"
            >
              {focusMode ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>

            {/* Bookmark */}
            <button
              type="button"
              onClick={onToggleBookmark}
              className={`p-2 rounded-sm transition-colors ${
                bookmarked ? 'text-bronze' : 'text-charcoal-muted hover:text-bronze hover:bg-taupe-light/50'
              }`}
              title={bookmarked ? 'Remove bookmark' : 'Bookmark article'}
              aria-label="Bookmark"
            >
              <Bookmark size={16} fill={bookmarked ? 'currentColor' : 'none'} />
            </button>

            {/* Share */}
            <button
              type="button"
              onClick={handleShare}
              className="p-2 rounded-sm text-charcoal-muted hover:text-charcoal hover:bg-taupe-light/50 transition-colors"
              title="Share article"
              aria-label="Share article"
            >
              {copied ? <Check size={16} className="text-green-600" /> : <Share2 size={16} />}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
