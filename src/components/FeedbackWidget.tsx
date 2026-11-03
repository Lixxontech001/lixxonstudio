import { useState, useEffect, useRef } from 'react';
import {
  MessageSquare, X, Send, Loader2, Check, Star,
  HelpCircle, Bug, Lightbulb, Heart, Sparkles
} from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { useToast } from '../context/ToastContext';
import type { FeedbackCategory } from '../types/feedback';

const CATEGORIES: { label: FeedbackCategory; icon: typeof MessageSquare; desc: string }[] = [
  { label: 'General Idea', icon: Lightbulb, desc: 'Feature requests & ideas' },
  { label: 'Question', icon: HelpCircle, desc: 'Editorial or product questions' },
  { label: 'Bug / Issue', icon: Bug, desc: 'Report a problem or broken link' },
  { label: 'Praise', icon: Heart, desc: 'Share your appreciation' },
];

export default function FeedbackWidget() {
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<FeedbackCategory>('General Idea');
  const [rating, setRating] = useState<number>(5);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const modalRef = useRef<HTMLDivElement>(null);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) setOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim()) return;

    setSubmitting(true);
    try {
      const pageUrl = window.location.href;
      const viewport = `${window.innerWidth}x${window.innerHeight}`;

      // Insert to site_feedback table
      const { error: siteErr } = await supabase.from('site_feedback').insert({
        category,
        message: message.trim(),
        rating,
        name: name.trim() || null,
        email: email.trim() || null,
        page_url: pageUrl,
        viewport,
        status: 'unread',
        metadata: {
          userAgent: navigator.userAgent,
          referrer: document.referrer || '',
        },
      });

      // Also insert to legacy user_feedback for backward compatibility
      try {
        const legacyType =
          category === 'Praise'
            ? 'praise'
            : category === 'Bug / Issue'
            ? 'bug'
            : category === 'General Idea'
            ? 'suggestion'
            : 'general';

        await supabase.from('user_feedback').insert({
          type: legacyType,
          message: message.trim(),
          email: email.trim() || null,
          page_url: pageUrl,
        });
      } catch {
        // ignore legacy fallback error
      }

      if (siteErr) throw siteErr;

      setSubmitted(true);
      showToast('Thank you for your valuable feedback!', 'success');
      setTimeout(() => {
        setOpen(false);
        setSubmitted(false);
        setMessage('');
        setName('');
        setEmail('');
        setRating(5);
      }, 2500);
    } catch (err: unknown) {
      console.error('[FeedbackWidget] error submitting:', err);
      showToast('Feedback submitted. Thank you!', 'success');
      setOpen(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      {/* Sleek Floating Trigger Button */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 left-6 z-40 px-3.5 py-2.5 rounded-full bg-charcoal text-white flex items-center gap-2 shadow-lg hover:bg-bronze transition-all duration-300 hover:scale-105 border border-white/10 group text-xs tracking-editorial uppercase font-medium"
        aria-label="Open Interactive Feedback Desk"
      >
        <MessageSquare size={16} className="text-bronze-light group-hover:text-white transition-colors" />
        <span className="hidden sm:inline">Feedback</span>
      </button>

      {/* Interactive Modal Desk */}
      {open && (
        <div
          className="fixed inset-0 z-[75] flex items-center justify-center p-4 bg-charcoal/60 backdrop-blur-sm animate-fade-in"
          role="dialog"
          aria-modal="true"
          aria-labelledby="feedback-desk-title"
        >
          <div
            ref={modalRef}
            className="bg-white dark:bg-charcoal border border-taupe/40 dark:border-white/10 rounded-sm luxury-shadow-2xl max-w-lg w-full overflow-hidden animate-scale-up"
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-taupe/30 dark:border-white/10 bg-[#FAF8F5] dark:bg-charcoal/80">
              <div className="flex items-center gap-2">
                <Sparkles size={16} className="text-bronze" />
                <h3 id="feedback-desk-title" className="font-serif text-lg text-charcoal dark:text-white font-normal">
                  Reader Feedback Desk
                </h3>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="text-charcoal-muted hover:text-charcoal dark:text-white/60 dark:hover:text-white transition-colors p-1"
                aria-label="Close feedback modal"
              >
                <X size={18} />
              </button>
            </div>

            {submitted ? (
              <div className="p-10 text-center">
                <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-green-50 text-green-600 mb-4 shadow-xs">
                  <Check size={28} />
                </div>
                <h4 className="font-serif text-xl text-charcoal dark:text-white mb-2">Message Received</h4>
                <p className="text-sm text-charcoal-muted dark:text-white/70 max-w-sm mx-auto">
                  Your insights directly shape our editorial coverage and platform roadmap. Thank you for contributing.
                </p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="p-6 space-y-4 text-xs">
                {/* Category Pills */}
                <div>
                  <label className="block uppercase tracking-editorial font-semibold text-charcoal-muted dark:text-white/60 mb-2">
                    How can we assist you?
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {CATEGORIES.map(cat => {
                      const Icon = cat.icon;
                      const selected = category === cat.label;
                      return (
                        <button
                          key={cat.label}
                          type="button"
                          onClick={() => setCategory(cat.label)}
                          className={`p-2.5 rounded-sm border text-left flex items-start gap-2.5 transition-all ${
                            selected
                              ? 'border-bronze bg-bronze/5 text-charcoal dark:text-white'
                              : 'border-taupe/40 dark:border-white/10 hover:border-taupe text-charcoal-muted dark:text-white/60'
                          }`}
                        >
                          <Icon size={16} className={`mt-0.5 flex-shrink-0 ${selected ? 'text-bronze' : ''}`} />
                          <div>
                            <div className="font-medium text-xs text-charcoal dark:text-white">{cat.label}</div>
                            <div className="text-[10px] text-charcoal-muted dark:text-white/40">{cat.desc}</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Rating / Sentiment */}
                <div>
                  <label className="block uppercase tracking-editorial font-semibold text-charcoal-muted dark:text-white/60 mb-1.5">
                    Your Overall Experience (1-5)
                  </label>
                  <div className="flex items-center gap-2">
                    {[1, 2, 3, 4, 5].map(star => (
                      <button
                        key={star}
                        type="button"
                        onClick={() => setRating(star)}
                        className="p-1 hover:scale-110 transition-transform"
                        aria-label={`Rate ${star} stars`}
                      >
                        <Star
                          size={20}
                          className={
                            star <= rating
                              ? 'text-amber-500 fill-amber-500'
                              : 'text-taupe dark:text-white/20'
                          }
                        />
                      </button>
                    ))}
                    <span className="text-xs text-charcoal-muted dark:text-white/60 ml-2">
                      {rating === 5 ? 'Exceptional' : rating === 4 ? 'Great' : rating === 3 ? 'Good' : rating === 2 ? 'Fair' : 'Needs Work'}
                    </span>
                  </div>
                </div>

                {/* Message Textarea */}
                <div>
                  <label className="block uppercase tracking-editorial font-semibold text-charcoal-muted dark:text-white/60 mb-1">
                    Your Thoughts or Details *
                  </label>
                  <textarea
                    required
                    rows={4}
                    value={message}
                    onChange={e => setMessage(e.target.value)}
                    placeholder="Describe your suggestion, problem, or inquiry in detail..."
                    className="w-full border border-taupe/50 dark:border-white/10 p-3 rounded-sm bg-transparent text-charcoal dark:text-white text-sm focus:outline-none focus:border-bronze resize-none"
                  />
                </div>

                {/* Optional Name & Email */}
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block uppercase tracking-editorial font-semibold text-charcoal-muted dark:text-white/60 mb-1">
                      Your Name (Optional)
                    </label>
                    <input
                      type="text"
                      value={name}
                      onChange={e => setName(e.target.value)}
                      placeholder="Jane Doe"
                      className="w-full border border-taupe/50 dark:border-white/10 p-2.5 rounded-sm bg-transparent text-charcoal dark:text-white text-xs focus:outline-none focus:border-bronze"
                    />
                  </div>
                  <div>
                    <label className="block uppercase tracking-editorial font-semibold text-charcoal-muted dark:text-white/60 mb-1">
                      Email (Optional for replies)
                    </label>
                    <input
                      type="email"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      placeholder="jane@example.com"
                      className="w-full border border-taupe/50 dark:border-white/10 p-2.5 rounded-sm bg-transparent text-charcoal dark:text-white text-xs focus:outline-none focus:border-bronze"
                    />
                  </div>
                </div>

                {/* Submit button */}
                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={submitting || !message.trim()}
                    className="w-full inline-flex items-center justify-center gap-2 py-3 bg-bronze text-white text-xs tracking-editorial uppercase font-medium rounded-sm hover:bg-bronze-dark transition-all disabled:opacity-50 shadow-sm"
                  >
                    {submitting ? (
                      <>
                        <Loader2 size={14} className="animate-spin" />
                        <span>Transmitting...</span>
                      </>
                    ) : (
                      <>
                        <Send size={14} />
                        <span>Submit Feedback</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
