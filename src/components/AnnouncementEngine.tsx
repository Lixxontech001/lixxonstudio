import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Sparkles, ArrowRight, ExternalLink } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { useNavigation } from '../context/NavigationContext';
import {
  recordTelemetry,
  isAnnouncementCapped,
  markAnnouncementDismissed,
} from '../lib/telemetry';
import type { Announcement } from '../types/announcements';

export default function AnnouncementEngine() {
  const { navigate } = useNavigation();
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [activeAnnouncement, setActiveAnnouncement] = useState<Announcement | null>(null);
  const [presentationForm, setPresentationForm] = useState<'modal' | 'toast'>('modal');
  const [isOpen, setIsOpen] = useState(false);
  const [scrollDepth, setScrollDepth] = useState(0);

  const shownRef = useRef(false);
  const startTimeRef = useRef<number>(Date.now());
  const modalRef = useRef<HTMLDivElement>(null);

  // Fetch active announcements from database
  useEffect(() => {
    let isMounted = true;
    async function loadCampaigns() {
      try {
        const { data, error } = await supabase
          .from('announcements')
          .select('*')
          .eq('is_active', true)
          .order('priority', { ascending: false });

        if (!error && Array.isArray(data) && isMounted) {
          setAnnouncements(data as Announcement[]);
        }
      } catch (err) {
        console.debug('[announcement-engine] could not load campaigns:', err);
      }
    }
    loadCampaigns();
    return () => {
      isMounted = false;
    };
  }, []);

  // Track page scroll depth
  useEffect(() => {
    const handleScroll = () => {
      const total = document.documentElement.scrollHeight - window.innerHeight;
      if (total <= 0) return;
      const current = Math.min(100, Math.max(0, Math.round((window.scrollY / total) * 100)));
      setScrollDepth(current);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Behavioral trigger evaluation
  useEffect(() => {
    if (shownRef.current || isOpen || announcements.length === 0) return;

    const pathname = window.location.pathname;

    // Filter candidate announcements based on target audience & routes
    const candidate = announcements.find(ann => {
      // Frequency capping check
      if (isAnnouncementCapped(ann.id, ann.cooldown_minutes || 3)) {
        return false;
      }

      // Route matching
      if (ann.target_audience === 'articles_only') {
        const isArticle = pathname.startsWith('/blog') || pathname.startsWith('/article');
        if (!isArticle) return false;
      }

      return true;
    });

    if (!candidate) return;

    // Check if scroll requirement is met
    const requiredScroll = candidate.scroll_percentage || 0;
    const scrollMet = scrollDepth >= requiredScroll;

    // Timer delay
    const delayMs = (candidate.trigger_delay_seconds || 5) * 1000;
    const timer = setTimeout(() => {
      if (scrollMet || scrollDepth >= requiredScroll) {
        shownRef.current = true;
        setActiveAnnouncement(candidate);
        setPresentationForm(candidate.form_type);
        setIsOpen(true);
        startTimeRef.current = Date.now();

        // Record impression telemetry
        recordTelemetry({
          announcementId: candidate.id,
          formType: candidate.form_type,
          eventType: 'impression',
          pagePath: pathname,
        });
      }
    }, delayMs);

    return () => clearTimeout(timer);
  }, [announcements, scrollDepth, isOpen]);

  const handleDismiss = useCallback(() => {
    if (!activeAnnouncement) return;

    const dwellSec = Math.round((Date.now() - startTimeRef.current) / 1000);
    markAnnouncementDismissed(activeAnnouncement.id);
    setIsOpen(false);

    recordTelemetry({
      announcementId: activeAnnouncement.id,
      formType: presentationForm,
      eventType: 'dismiss',
      dwellSeconds: dwellSec,
    });

    // Session re-engagement timer: If visitor remains on site, fire next announcement or transition to toast
    const nextCandidate = announcements.find(
      a => a.id !== activeAnnouncement.id && !isAnnouncementCapped(a.id, a.cooldown_minutes || 3)
    );

    if (nextCandidate) {
      setTimeout(() => {
        setActiveAnnouncement(nextCandidate);
        // Graceful transition: If modal was dismissed, show toast next time
        setPresentationForm('toast');
        setIsOpen(true);
        startTimeRef.current = Date.now();
        recordTelemetry({
          announcementId: nextCandidate.id,
          formType: 'toast',
          eventType: 'impression',
          metadata: { trigger: 'session_reengagement' },
        });
      }, (activeAnnouncement.cooldown_minutes || 3) * 60 * 1000);
    }
  }, [activeAnnouncement, presentationForm, announcements]);

  // Handle Escape key dismissal
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        handleDismiss();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, handleDismiss]);

  const handleButtonClick = (url: string, btnIndex: 1 | 2) => {
    if (!activeAnnouncement) return;

    const dwellSec = Math.round((Date.now() - startTimeRef.current) / 1000);
    recordTelemetry({
      announcementId: activeAnnouncement.id,
      formType: presentationForm,
      eventType: btnIndex === 1 ? 'click_button1' : 'click_button2',
      dwellSeconds: dwellSec,
      metadata: { target_url: url },
    });

    markAnnouncementDismissed(activeAnnouncement.id);
    setIsOpen(false);

    if (url.startsWith('http')) {
      window.open(url, '_blank', 'noopener,noreferrer');
    } else {
      if (url === '/trending') navigate({ name: 'trending' });
      else if (url === '/collections') navigate({ name: 'collections' });
      else if (url === '/shop') navigate({ name: 'shop' });
      else if (url === '/weekly-digest') navigate({ name: 'weekly-digest' });
      else if (url.startsWith('/blog') || url.startsWith('/article')) {
        const parts = url.split('/').filter(Boolean);
        if (parts[1]) navigate({ name: 'article', slug: parts[1] });
        else navigate({ name: 'home', page: 1 });
      } else {
        window.location.href = url;
      }
    }
  };

  if (!isOpen || !activeAnnouncement) return null;

  // Form 1: Immersive Focus Modal
  if (presentationForm === 'modal') {
    return (
      <div
        className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-charcoal/60 backdrop-blur-md animate-fade-in"
        role="dialog"
        aria-modal="true"
        aria-labelledby="announcement-modal-title"
      >
        <div
          ref={modalRef}
          className="relative bg-white dark:bg-charcoal border border-taupe/40 dark:border-white/10 rounded-sm luxury-shadow-2xl max-w-lg w-full overflow-hidden animate-scale-up"
        >
          {/* Top Banner visual if image exists */}
          {activeAnnouncement.image_url && (
            <div className="w-full h-44 overflow-hidden relative bg-[#FAF8F5]">
              <img
                src={activeAnnouncement.image_url}
                alt={activeAnnouncement.title}
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-charcoal/40 to-transparent" />
            </div>
          )}

          {/* Dismiss button */}
          <button
            onClick={handleDismiss}
            className="absolute top-4 right-4 z-10 p-2 text-charcoal-muted hover:text-charcoal bg-white/80 dark:bg-charcoal/80 rounded-full backdrop-blur-sm transition-colors border border-taupe/30"
            aria-label="Close announcement"
          >
            <X size={16} />
          </button>

          <div className="p-6 sm:p-8">
            {/* Pill badge */}
            <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-bronze/10 text-bronze dark:text-bronze-light rounded-full text-[10px] font-semibold tracking-editorial uppercase mb-3">
              <Sparkles size={12} />
              <span>{activeAnnouncement.badge_text || 'EDITORIAL SPOTLIGHT'}</span>
            </div>

            {/* Headline */}
            <h2
              id="announcement-modal-title"
              className="font-serif text-2xl sm:text-3xl text-charcoal dark:text-white font-normal mb-3 leading-snug"
            >
              {activeAnnouncement.title}
            </h2>

            {/* Description */}
            <p className="text-sm text-charcoal-muted dark:text-white/70 leading-relaxed mb-6">
              {activeAnnouncement.description}
            </p>

            {/* CTAs */}
            <div className="flex flex-col sm:flex-row items-center gap-3 pt-2">
              {activeAnnouncement.button1_label && activeAnnouncement.button1_url && (
                <button
                  onClick={() => handleButtonClick(activeAnnouncement.button1_url, 1)}
                  className="w-full sm:w-auto flex-1 inline-flex items-center justify-center gap-2 px-5 py-3 bg-bronze text-white text-xs tracking-editorial uppercase font-medium rounded-sm hover:bg-bronze-dark transition-all duration-200 shadow-sm"
                >
                  <span>{activeAnnouncement.button1_label}</span>
                  {activeAnnouncement.button1_url.startsWith('http') ? <ExternalLink size={13} /> : <ArrowRight size={13} />}
                </button>
              )}

              {activeAnnouncement.button2_label && activeAnnouncement.button2_url && (
                <button
                  onClick={() => handleButtonClick(activeAnnouncement.button2_url, 2)}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-3 border border-charcoal/30 dark:border-white/30 text-charcoal dark:text-white text-xs tracking-editorial uppercase font-medium rounded-sm hover:bg-charcoal/5 dark:hover:bg-white/5 transition-all duration-200"
                >
                  <span>{activeAnnouncement.button2_label}</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Form 2: Floating Ambient Toast/Card (Bottom-Right or Mobile Bottom-Center)
  return (
    <div
      role="region"
      aria-label="Site announcement"
      className="fixed bottom-6 right-6 z-[65] w-[360px] max-w-[calc(100vw-2rem)] animate-slide-up"
    >
      <div className="bg-white dark:bg-charcoal border border-taupe/40 dark:border-white/10 rounded-sm luxury-shadow-xl p-5 relative overflow-hidden">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 bg-bronze/10 text-bronze dark:text-bronze-light rounded-full text-[9px] font-semibold tracking-editorial uppercase">
            <Sparkles size={11} />
            <span>{activeAnnouncement.badge_text || 'NOTICE'}</span>
          </div>
          <button
            onClick={handleDismiss}
            className="text-charcoal-muted hover:text-charcoal dark:text-white/60 dark:hover:text-white transition-colors"
            aria-label="Dismiss announcement"
          >
            <X size={15} />
          </button>
        </div>

        <h3 className="font-serif text-base text-charcoal dark:text-white font-medium mb-1.5 leading-snug">
          {activeAnnouncement.title}
        </h3>

        <p className="text-xs text-charcoal-muted dark:text-white/70 line-clamp-2 mb-4 leading-relaxed">
          {activeAnnouncement.description}
        </p>

        {activeAnnouncement.button1_label && activeAnnouncement.button1_url && (
          <button
            onClick={() => handleButtonClick(activeAnnouncement.button1_url, 1)}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 bg-charcoal dark:bg-white dark:text-charcoal text-white text-[11px] tracking-editorial uppercase font-medium rounded-sm hover:bg-bronze transition-all"
          >
            <span>{activeAnnouncement.button1_label}</span>
            <ArrowRight size={12} />
          </button>
        )}
      </div>
    </div>
  );
}
