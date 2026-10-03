import { useState, type ReactNode, type FormEvent } from 'react';
import { Helmet } from 'react-helmet-async';
import { Mail, Loader2, KeyRound, Check, User as UserIcon, ShieldCheck } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

/**
 * Wraps customer-only pages. Shows a passwordless sign-in (magic link + 6-digit code)
 * when there is no session. Orders/downloads are then filtered by RLS on the JWT email —
 * nobody can read another customer's data by typing an email any more.
 */
export default function CustomerGate({ children, title = 'Your Account', intro }: { children: ReactNode; title?: string; intro?: string }) {
  const { session, loading, signInWithMagicLink, verifyOtp } = useAuth();
  const [email, setEmail] = useState(() => localStorage.getItem('lixxon_customer_email') || '');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  if (loading) {
    return <main className="container-narrow py-24"><div className="skeleton h-10 w-48 mx-auto rounded-sm" /><div className="skeleton h-40 mt-6 rounded-sm" /></main>;
  }
  if (session) return <>{children}</>;

  const sendLink = async (e: FormEvent) => {
    e.preventDefault();
    const em = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) { setError('Please enter a valid email address.'); return; }
    setBusy(true); setError('');
    const { error: err } = await signInWithMagicLink(em, window.location.href);
    setBusy(false);
    if (err) { setError(err.includes('rate') ? 'Too many requests — please wait a minute and try again.' : err); return; }
    localStorage.setItem('lixxon_customer_email', em);
    setSent(true); setStep('code');
  };

  const submitCode = async (e: FormEvent) => {
    e.preventDefault();
    if (code.trim().length < 6) { setError('Enter the 6-digit code from the email.'); return; }
    setBusy(true); setError('');
    const { error: err } = await verifyOtp(email, code);
    setBusy(false);
    if (err) setError('That code is invalid or expired. Request a new one.');
  };

  return (
    <main>
      <Helmet><title>{title} | Lixxon Studio</title><meta name="robots" content="noindex, nofollow" /></Helmet>
      <section className="container-narrow py-16 md:py-24 text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-taupe-light mb-8">
          <UserIcon size={24} strokeWidth={1.5} className="text-bronze" />
        </div>
        <h1 className="font-serif text-4xl text-charcoal font-light">{title}</h1>
        <p className="text-charcoal-muted text-base mt-4 max-w-md mx-auto leading-relaxed">
          {intro || 'Sign in with the email you used at checkout. We’ll send a secure link — no password to remember.'}
        </p>

        {step === 'email' ? (
          <form onSubmit={sendLink} className="mt-8 max-w-sm mx-auto" noValidate>
            <label htmlFor="gate-email" className="sr-only">Email address</label>
            <input id="gate-email" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="your@email.com"
              className="w-full bg-white border border-taupe/50 px-4 py-3.5 text-charcoal placeholder:text-charcoal-muted/50 focus:outline-none focus:border-bronze transition-colors rounded-sm text-center" />
            {error && <p role="alert" className="text-xs text-red-600 mt-2">{error}</p>}
            <button type="submit" disabled={busy} className="w-full mt-3 inline-flex items-center justify-center gap-3 px-8 py-4 bg-charcoal text-white text-xs tracking-editorial uppercase font-medium hover:bg-bronze transition-all duration-500 rounded-sm disabled:opacity-60">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />} Email me a sign-in link
            </button>
          </form>
        ) : (
          <form onSubmit={submitCode} className="mt-8 max-w-sm mx-auto" noValidate>
            {sent && (
              <p className="inline-flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 px-4 py-2.5 rounded-sm mb-4">
                <Check size={14} /> Link sent to <strong>{email}</strong>
              </p>
            )}
            <p className="text-xs text-charcoal-muted mb-3">Click the link in the email, or enter the 6-digit code it contains:</p>
            <label htmlFor="gate-code" className="sr-only">6-digit code</label>
            <input id="gate-code" inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} placeholder="123456"
              className="w-full bg-white border border-taupe/50 px-4 py-3.5 text-charcoal text-center tracking-[0.5em] text-lg focus:outline-none focus:border-bronze rounded-sm" />
            {error && <p role="alert" className="text-xs text-red-600 mt-2">{error}</p>}
            <button type="submit" disabled={busy} className="w-full mt-3 inline-flex items-center justify-center gap-3 px-8 py-4 bg-charcoal text-white text-xs tracking-editorial uppercase font-medium hover:bg-bronze transition-all duration-500 rounded-sm disabled:opacity-60">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />} Verify code
            </button>
            <button type="button" onClick={() => { setStep('email'); setSent(false); setCode(''); setError(''); }} className="text-xs text-charcoal-muted hover:text-bronze mt-4 tracking-editorial uppercase">Use a different email</button>
          </form>
        )}

        <p className="inline-flex items-center gap-2 text-[11px] text-charcoal-muted mt-10"><ShieldCheck size={13} className="text-bronze" /> Your orders are only visible to the verified owner of the email.</p>
      </section>
    </main>
  );
}
