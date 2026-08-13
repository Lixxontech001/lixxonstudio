import { useState } from 'react';
import { ArrowRight, Check, Mail, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';

export default function Newsletter() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    if (!valid) {
      setStatus('error');
      return;
    }
    setStatus('submitting');
    const { error } = await supabase
      .from('newsletter_subscribers')
      .insert({ email: email.trim() });
    if (error) {
      if (error.code === '23505') {
        setStatus('success');
      } else {
        setStatus('error');
        return;
      }
    } else {
      setStatus('success');
    }
    setEmail('');
    setTimeout(() => setStatus('idle'), 5000);
  };

  return (
    <section className="container-wide py-20">
      <div className="relative bg-charcoal rounded-sm overflow-hidden px-8 py-16 md:px-16 md:py-20 text-center">
        <div className="absolute top-0 left-0 w-40 h-40 bg-bronze/10 rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-0 w-60 h-60 bg-bronze/5 rounded-full blur-3xl" />

        <div className="relative z-10 max-w-xl mx-auto">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full border border-white/20 mb-6">
            <Mail size={18} strokeWidth={1.5} className="text-bronze-light" />
          </div>
          <p className="text-[10px] tracking-ultra-wide uppercase text-bronze mb-4">The Daily Reset</p>
          <h2 className="font-serif text-3xl md:text-4xl text-white font-light leading-tight">
            Slow mornings, better skin, quieter mind.
          </h2>
          <p className="text-white/50 text-base mt-5 leading-relaxed max-w-md mx-auto">
            Join 12,000 readers getting our daily edit of skincare science, intentional style, and minimalist wellness, delivered each morning.
          </p>

          <form onSubmit={handleSubmit} className="mt-10 flex flex-col sm:flex-row gap-3 max-w-md mx-auto">
            <input
              type="email"
              value={email}
              onChange={e => { setEmail(e.target.value); setStatus('idle'); }}
              placeholder="your@email.com"
              className="flex-1 bg-white/5 border border-white/20 px-5 py-3.5 text-white placeholder:text-white/30 focus:outline-none focus:border-bronze transition-colors rounded-sm"
            />
            <button
              type="submit"
              disabled={status === 'submitting'}
              className="flex items-center justify-center gap-2 px-7 py-3.5 bg-bronze text-white text-xs tracking-editorial uppercase font-medium hover:bg-bronze-dark transition-all duration-500 whitespace-nowrap rounded-sm disabled:opacity-60"
            >
              {status === 'submitting' ? (
                <><Loader2 size={14} className="animate-spin" /> Subscribing</>
              ) : status === 'success' ? (
                <><Check size={14} /> Subscribed</>
              ) : (
                <>Subscribe <ArrowRight size={14} /></>
              )}
            </button>
          </form>

          {status === 'error' && (
            <p className="text-bronze-light text-sm mt-4 animate-fade-in">Please enter a valid email address.</p>
          )}
          {status === 'success' && (
            <p className="text-bronze-light text-sm mt-4 animate-fade-in">
              Welcome to The Daily Reset. Check your inbox for confirmation.
            </p>
          )}
          <p className="text-white/30 text-xs mt-5">No spam. Unsubscribe anytime.</p>
        </div>
      </div>
    </section>
  );
}
