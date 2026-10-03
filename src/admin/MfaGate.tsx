import { useEffect, useState, type ReactNode } from 'react';
import { Smartphone, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';

/**
 * Step-up to AAL2 when the signed-in admin has a verified TOTP factor. The DB's is_admin()
 * already refuses aal1 sessions for such users, so this is the matching UX.
 */
export default function MfaGate({ children, onVerified }: { children: ReactNode; onVerified?: () => void }) {
  const [state, setState] = useState<'checking' | 'ok' | 'need'>('checking');
  const [factorId, setFactorId] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (data?.nextLevel === 'aal2' && data.currentLevel !== 'aal2') {
        const { data: f } = await supabase.auth.mfa.listFactors();
        const totp = f?.totp?.find(x => x.status === 'verified');
        if (totp) { setFactorId(totp.id); setState('need'); return; }
      }
      setState('ok');
    })();
  }, []);

  const verify = async () => {
    setBusy(true); setError('');
    const { data: ch, error: e1 } = await supabase.auth.mfa.challenge({ factorId });
    if (e1 || !ch) { setBusy(false); setError(e1?.message || 'Could not start challenge'); return; }
    const { error } = await supabase.auth.mfa.verify({ factorId, challengeId: ch.id, code: code.trim() });
    setBusy(false);
    if (error) { setError('Incorrect code. Try again.'); setCode(''); return; }
    onVerified?.();
    setState('ok');
  };

  if (state === 'checking') return <div className="min-h-screen flex items-center justify-center bg-gray-50"><Loader2 className="animate-spin text-gray-400" /></div>;
  if (state === 'ok') return <>{children}</>;
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
      <form onSubmit={e => { e.preventDefault(); verify(); }} className="w-full max-w-sm bg-white border border-gray-200 rounded-sm p-8 text-center">
        <Smartphone size={28} className="mx-auto text-bronze mb-4" />
        <h1 className="font-serif text-2xl text-charcoal mb-1">Two-factor check</h1>
        <p className="text-sm text-gray-500 mb-6">Enter the 6-digit code from your authenticator app.</p>
        <input autoFocus inputMode="numeric" value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} className="w-40 mx-auto block text-center text-2xl tracking-[0.4em] border border-gray-300 rounded-sm py-2 focus:outline-none focus:border-bronze" aria-label="Authentication code" />
        {error && <p className="text-sm text-red-600 mt-3">{error}</p>}
        <button disabled={busy || code.length !== 6} className="mt-6 w-full py-3 bg-charcoal text-white text-sm rounded-sm hover:bg-bronze disabled:opacity-60">{busy ? <Loader2 size={16} className="animate-spin mx-auto" /> : 'Verify'}</button>
        <button type="button" onClick={() => supabase.auth.signOut().then(() => location.assign('/admin/login'))} className="mt-3 text-xs text-gray-400 hover:text-charcoal">Sign out</button>
      </form>
    </div>
  );
}
