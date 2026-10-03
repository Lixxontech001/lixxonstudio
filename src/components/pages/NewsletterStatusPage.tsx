import { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { MailCheck, MailX, Loader2 } from 'lucide-react';
import { submitForm, ApiError } from '../../lib/api';
import { Link } from '../../context/NavigationContext';

/** Double opt-in confirmation + one-click unsubscribe landing pages (links come from the emails). */
export default function NewsletterStatusPage({ mode, token }: { mode: 'confirm' | 'unsubscribe'; token: string }) {
  const [state, setState] = useState<'busy' | 'ok' | 'error'>('busy');
  const [message, setMessage] = useState('');
  useEffect(() => {
    window.scrollTo(0, 0);
    let on = true;
    submitForm(mode === 'confirm' ? 'newsletter_confirm' : 'newsletter_unsubscribe', { token })
      .then(res => { if (!on) return; setState('ok'); setMessage(mode === 'confirm' ? `You're in${res.email ? `, ${res.email}` : ''}. Expect one thoughtful email a week — no noise.` : 'You have been unsubscribed. We are sorry to see you go.'); })
      .catch((e: ApiError) => { if (!on) return; setState('error'); setMessage(e.message || 'That link is invalid or has expired.'); });
    return () => { on = false; };
  }, [mode, token]);
  return (
    <main className="container-narrow py-24 text-center">
      <Helmet><title>{mode === 'confirm' ? 'Subscription confirmed' : 'Unsubscribed'} | Lixxon Studio</title><meta name="robots" content="noindex" /></Helmet>
      {state === 'busy' ? <Loader2 size={28} className="mx-auto animate-spin text-bronze" /> : state === 'ok' ? <MailCheck size={32} strokeWidth={1.25} className="mx-auto text-bronze" /> : <MailX size={32} strokeWidth={1.25} className="mx-auto text-red-500" />}
      <h1 className="font-serif text-4xl text-charcoal mt-6 mb-3">{state === 'busy' ? 'One moment…' : state === 'ok' ? (mode === 'confirm' ? 'Subscription confirmed' : 'Unsubscribed') : 'Something went wrong'}</h1>
      <p className="text-charcoal-light max-w-md mx-auto" role="status">{message}</p>
      <div className="mt-8 flex justify-center gap-4 text-sm">
        <Link to={{ name: 'home', page: 1 }} className="text-bronze hover:underline">Back to the magazine</Link>
        {mode === 'unsubscribe' && state === 'ok' && <Link to={{ name: 'newsletter-preferences' }} className="text-charcoal-muted hover:text-bronze">Prefer fewer emails instead?</Link>}
      </div>
    </main>
  );
}
