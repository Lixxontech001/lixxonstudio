import { useState, useEffect, type RefObject } from 'react';
import { X, ArrowUpRight, BookmarkCheck } from 'lucide-react';

interface ArticleEnhancementsProps {
  postId: string;
  containerRef: RefObject<HTMLDivElement | null>;
  readingTimeMinutes?: number;
}

export default function ArticleEnhancements({
  postId,
  containerRef,
}: ArticleEnhancementsProps) {
  // Lightbox state
  const [lightboxImg, setLightboxImg] = useState<{ src: string; alt?: string } | null>(null);

  // Resume reading prompt state
  const [savedPos, setSavedPos] = useState<number | null>(null);
  const [showResumeBanner, setShowResumeBanner] = useState(false);

  // Check saved position on load
  useEffect(() => {
    const key = `lixxon_pos_${postId}`;
    const stored = localStorage.getItem(key);
    if (stored) {
      const pos = parseInt(stored, 10);
      if (pos > 450 && pos < document.body.scrollHeight - 600) {
        setSavedPos(pos);
        setShowResumeBanner(true);
        // auto-hide after 8 seconds
        const t = setTimeout(() => setShowResumeBanner(false), 8000);
        return () => clearTimeout(t);
      }
    }
  }, [postId]);

  // Track position periodically
  useEffect(() => {
    const key = `lixxon_pos_${postId}`;
    let timer: number;
    const handleScroll = () => {
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (window.scrollY > 400) {
          localStorage.setItem(key, String(Math.round(window.scrollY)));
        }
      }, 500);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleScroll);
      clearTimeout(timer);
    };
  }, [postId]);

  // Delegated click handler on prose container for images and code blocks
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Attach click listeners to images inside article
    const images = container.querySelectorAll<HTMLImageElement>('img');
    const handleImageClick = (e: MouseEvent) => {
      const target = e.currentTarget as HTMLImageElement;
      if (target && target.src) {
        setLightboxImg({ src: target.src, alt: target.alt || '' });
      }
    };

    images.forEach(img => {
      img.style.cursor = 'zoom-in';
      img.title = 'Click to view full image';
      img.addEventListener('click', handleImageClick);
    });

    // Add copy buttons to pre/code blocks
    const preBlocks = container.querySelectorAll<HTMLPreElement>('pre');
    preBlocks.forEach(pre => {
      if (pre.querySelector('.copy-code-btn')) return;
      pre.style.position = 'relative';

      const btn = document.createElement('button');
      btn.className =
        'copy-code-btn absolute top-2 right-2 px-2 py-1 bg-charcoal/80 text-white text-[10px] tracking-editorial uppercase rounded-xs hover:bg-bronze transition-all opacity-80 hover:opacity-100 flex items-center gap-1';
      btn.innerText = 'Copy';
      btn.onclick = async e => {
        e.preventDefault();
        const code = pre.querySelector('code')?.innerText || pre.innerText;
        try {
          await navigator.clipboard.writeText(code);
          btn.innerText = 'Copied!';
          btn.classList.add('bg-emerald-600');
          setTimeout(() => {
            btn.innerText = 'Copy';
            btn.classList.remove('bg-emerald-600');
          }, 2000);
        } catch {
          // ignore
        }
      };
      pre.appendChild(btn);
    });

    return () => {
      images.forEach(img => {
        img.removeEventListener('click', handleImageClick);
      });
    };
  }, [containerRef]);

  // Close lightbox on Escape key
  useEffect(() => {
    if (!lightboxImg) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightboxImg(null);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [lightboxImg]);

  const resumeReading = () => {
    if (savedPos != null) {
      window.scrollTo({ top: savedPos, behavior: 'smooth' });
      setShowResumeBanner(false);
    }
  };

  return (
    <>
      {/* Resume Reading Floating Toast */}
      {showResumeBanner && savedPos != null && (
        <div className="fixed bottom-6 left-6 z-50 animate-slide-up max-w-sm">
          <div className="bg-charcoal text-white text-xs px-4 py-3 rounded-md shadow-2xl flex items-center gap-3 border border-taupe/20 backdrop-blur-md">
            <BookmarkCheck size={16} className="text-bronze flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="font-medium">Resume where you left off?</p>
              <p className="text-[11px] text-white/60">Saved reading position detected</p>
            </div>
            <button
              onClick={resumeReading}
              className="px-3 py-1 bg-bronze text-white text-[11px] tracking-editorial uppercase font-medium rounded-xs hover:bg-bronze-dark transition-all whitespace-nowrap"
            >
              Resume
            </button>
            <button
              onClick={() => setShowResumeBanner(false)}
              className="text-white/40 hover:text-white p-1"
              aria-label="Dismiss"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Image Lightbox Modal */}
      {lightboxImg && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md p-4 animate-fade-in"
          onClick={() => setLightboxImg(null)}
        >
          <div
            className="relative max-w-5xl max-h-[90vh] flex flex-col items-center"
            onClick={e => e.stopPropagation()}
          >
            <button
              onClick={() => setLightboxImg(null)}
              className="absolute -top-10 right-0 text-white/70 hover:text-white flex items-center gap-1 text-xs tracking-editorial uppercase"
            >
              <X size={16} /> Close (ESC)
            </button>

            <img
              src={lightboxImg.src}
              alt={lightboxImg.alt || ''}
              className="max-h-[82vh] max-w-full object-contain rounded-sm shadow-2xl"
            />

            {lightboxImg.alt && (
              <p className="text-white/70 text-xs text-center mt-3 max-w-2xl italic font-serif">
                {lightboxImg.alt}
              </p>
            )}

            <div className="mt-2 flex items-center gap-4">
              <a
                href={lightboxImg.src}
                target="_blank"
                rel="noreferrer"
                className="text-[11px] text-bronze-light hover:underline inline-flex items-center gap-1 uppercase tracking-editorial"
              >
                <ArrowUpRight size={12} /> Open original image
              </a>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
