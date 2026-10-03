import { useState } from 'react';
import { Mail, Send, Check, Loader2, X } from 'lucide-react';
import { useToast } from '../context/ToastContext';

export default function EmailArticleButton({ title, url }: { title: string; url: string }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [senderName, setSenderName] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const { showToast } = useToast();

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setSending(true);
    // Open mailto as a fallback since we don't have an email edge function
    const subject = encodeURIComponent(`${senderName || 'Someone'} shared an article with you: ${title}`);
    const body = encodeURIComponent(`I thought you might enjoy this article from Lixxon Studio:\n\n${title}\n${url}\n\n${senderName ? `— ${senderName}` : ''}`);
    window.location.href = `mailto:${email.trim()}?subject=${subject}&body=${body}`;
    setSending(false);
    setSent(true);
    showToast('Email draft opened in your mail app', 'success');
    setTimeout(() => { setOpen(false); setSent(false); setEmail(''); setSenderName(''); }, 2500);
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 px-5 py-3 border border-taupe rounded-sm text-charcoal text-sm hover:border-bronze transition-all"
        aria-label="Email this article"
      >
        <Mail size={16} strokeWidth={1.5} /> Email
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 animate-fade-in" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-sm max-w-md w-full mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-taupe/30">
              <h3 className="font-serif text-lg text-charcoal">Email This Article</h3>
              <button onClick={() => setOpen(false)} className="text-charcoal-muted hover:text-charcoal" aria-label="Close">
                <X size={18} />
              </button>
            </div>
            {sent ? (
              <div className="p-8 text-center">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-green-50 mb-4">
                  <Check size={24} className="text-green-600" />
                </div>
                <p className="text-sm text-charcoal">Opening your email app...</p>
              </div>
            ) : (
              <form onSubmit={handleSend} className="p-5 space-y-3">
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="Recipient's email"
                  required
                  className="w-full border border-taupe/50 px-3 py-2.5 text-sm rounded-sm focus:outline-none focus:border-bronze"
                />
                <input
                  type="text"
                  value={senderName}
                  onChange={e => setSenderName(e.target.value)}
                  placeholder="Your name (optional)"
                  className="w-full border border-taupe/50 px-3 py-2.5 text-sm rounded-sm focus:outline-none focus:border-bronze"
                />
                <button
                  type="submit"
                  disabled={sending || !email.trim()}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-bronze text-white text-xs tracking-editorial uppercase font-medium rounded-sm hover:bg-bronze-dark transition-all disabled:opacity-50"
                >
                  {sending ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                  Send Article
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
