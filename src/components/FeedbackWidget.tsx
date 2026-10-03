import { useState } from 'react';
import { MessageSquare, X, Send, Loader2, Check } from 'lucide-react';
import { useSubmitFeedback } from '../hooks/usePlatform';

export default function FeedbackWidget() {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<'general' | 'bug' | 'suggestion' | 'praise'>('general');
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const { submit, submitting, success } = useSubmitFeedback();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim()) return;
    const ok = await submit(type, message, email);
    if (ok) {
      setTimeout(() => { setOpen(false); setMessage(''); setEmail(''); }, 2000);
    }
  };

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-40 w-12 h-12 rounded-full bg-charcoal text-white flex items-center justify-center luxury-shadow-lg hover:bg-bronze transition-all duration-300 hover:scale-110"
        aria-label="Send feedback"
      >
        <MessageSquare size={20} strokeWidth={1.5} />
      </button>

      {/* Panel */}
      {open && (
        <div className="fixed bottom-6 right-6 z-50 w-[340px] max-w-[calc(100vw-2rem)] animate-fade-up">
          <div className="bg-white rounded-sm luxury-shadow-lg border border-taupe/30 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-taupe/30">
              <h3 className="font-serif text-lg text-charcoal">Share Feedback</h3>
              <button onClick={() => setOpen(false)} className="text-charcoal-muted hover:text-charcoal transition-colors" aria-label="Close">
                <X size={18} />
              </button>
            </div>
            {success ? (
              <div className="p-8 text-center">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-green-50 mb-4">
                  <Check size={24} className="text-green-600" />
                </div>
                <p className="text-sm text-charcoal">Thank you! Your feedback has been received.</p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="p-5 space-y-3">
                <div className="flex flex-wrap gap-2">
                  {([
                    { value: 'general', label: 'General' },
                    { value: 'suggestion', label: 'Suggestion' },
                    { value: 'bug', label: 'Bug Report' },
                    { value: 'praise', label: 'Praise' },
                  ] as const).map(t => (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => setType(t.value)}
                      className={`px-3 py-1.5 text-xs rounded-full transition-all ${type === t.value ? 'bg-charcoal text-white' : 'bg-taupe-light text-charcoal-muted hover:bg-taupe'}`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                <textarea
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  placeholder="Tell us what you think..."
                  rows={4}
                  required
                  maxLength={1000}
                  className="w-full border border-taupe/50 px-3 py-2.5 text-sm rounded-sm focus:outline-none focus:border-bronze transition-colors resize-none"
                />
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="Email (optional)"
                  className="w-full border border-taupe/50 px-3 py-2.5 text-sm rounded-sm focus:outline-none focus:border-bronze transition-colors"
                />
                <button
                  type="submit"
                  disabled={submitting || !message.trim()}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-bronze text-white text-xs tracking-editorial uppercase font-medium rounded-sm hover:bg-bronze-dark transition-all disabled:opacity-50"
                >
                  {submitting ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                  Send Feedback
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
