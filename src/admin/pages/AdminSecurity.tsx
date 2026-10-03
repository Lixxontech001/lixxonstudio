import { useEffect, useState } from 'react';
import { ShieldCheck, Smartphone, Loader2, Trash2, KeyRound } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';

type Factor = { id: string; friendly_name?: string; factor_type: string; status: string; created_at: string };

/** Admin 2FA — Supabase Auth TOTP (free). Enrolment shows a QR for any authenticator app. */
export default function AdminSecurity() {
  const [factors, setFactors] = useState<Factor[]>([]);
  const [enrol, setEnrol] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [aal, setAal] = useState('');
  const [pw, setPw] = useState({ a: '', b: '' });

  const load = async () => {
    const { data } = await supabase.auth.mfa.listFactors();
    setFactors((data?.all || []) as Factor[]);
    const { data: lvl } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    setAal(lvl?.currentLevel || '');
  };
  useEffect(() => { load(); }, []);

  const start = async () => {
    setBusy(true); setMsg('');
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Authenticator app' });
    setBusy(false);
    if (error || !data) { setMsg(error?.message || 'Could not start enrolment'); return; }
    setEnrol({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
  };
  const verify = async () => {
    if (!enrol) return; setBusy(true); setMsg('');
    const { data: ch, error: e1 } = await supabase.auth.mfa.challenge({ factorId: enrol.id });
    if (e1 || !ch) { setBusy(false); setMsg(e1?.message || 'Challenge failed'); return; }
    const { error } = await supabase.auth.mfa.verify({ factorId: enrol.id, challengeId: ch.id, code: code.trim() });
    setBusy(false);
    if (error) { setMsg('That code did not match. Try the next one.'); return; }
    setEnrol(null); setCode(''); setMsg('Two-factor authentication is on. You will be asked for a code at every admin sign-in.'); load();
  };
  const remove = async (f: Factor) => { if (!confirm('Turn off two-factor authentication?')) return; await supabase.auth.mfa.unenroll({ factorId: f.id }); load(); };
  const changePassword = async () => {
    if (pw.a.length < 12) { setMsg('Use at least 12 characters.'); return; }
    if (pw.a !== pw.b) { setMsg('Passwords do not match.'); return; }
    setBusy(true); const { error } = await supabase.auth.updateUser({ password: pw.a }); setBusy(false);
    setMsg(error ? error.message : 'Password updated.'); if (!error) setPw({ a: '', b: '' });
  };
  const verified = factors.filter(f => f.status === 'verified');

  return (
    <div>
      <div className="mb-6"><h1 className="font-serif text-2xl text-charcoal flex items-center gap-2"><ShieldCheck size={20} className="text-bronze" /> Security</h1><p className="text-sm text-charcoal-muted mt-1">Protect the admin account. Current session assurance: <code className="text-xs bg-taupe-light px-1.5 py-0.5 rounded">{aal || '…'}</code></p></div>
      <div className="bg-white rounded-sm border border-taupe/30 p-6 mb-6">
        <h2 className="flex items-center gap-2 text-sm font-medium text-charcoal mb-1"><Smartphone size={16} className="text-bronze" /> Two-factor authentication (TOTP)</h2>
        <p className="text-sm text-charcoal-light mb-4">Works with Google Authenticator, 1Password, Authy, Bitwarden… No SMS, no cost.</p>
        {verified.length > 0 ? (
          <ul className="space-y-2">{verified.map(f => <li key={f.id} className="flex items-center justify-between text-sm border border-taupe/30 rounded-sm px-4 py-3"><span>{f.friendly_name || 'Authenticator'} · enabled {new Date(f.created_at).toLocaleDateString()}</span><button onClick={() => remove(f)} className="p-1.5 text-charcoal-muted hover:text-red-600" aria-label="Remove factor"><Trash2 size={14} /></button></li>)}</ul>
        ) : enrol ? (
          <div className="grid sm:grid-cols-[180px,1fr] gap-6 items-start">
            <img src={enrol.qr} alt="Scan this QR code with your authenticator app" className="w-44 h-44 border border-taupe/30 rounded-sm bg-white" />
            <div>
              <p className="text-sm text-charcoal-light">Scan the code, or enter this key manually:</p>
              <code className="block my-2 text-xs break-all bg-taupe-light px-2 py-1.5 rounded">{enrol.secret}</code>
              <div className="flex gap-2 mt-3"><input value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" placeholder="6-digit code" className="w-36 border border-taupe/50 px-3 py-2 text-sm rounded-sm tracking-widest focus:outline-none focus:border-bronze" /><button onClick={verify} disabled={busy || code.length !== 6} className="px-4 py-2 bg-bronze text-white text-sm rounded-sm disabled:opacity-60">{busy ? <Loader2 size={14} className="animate-spin" /> : 'Verify & enable'}</button><button onClick={() => setEnrol(null)} className="px-3 py-2 text-sm text-charcoal-muted">Cancel</button></div>
            </div>
          </div>
        ) : (
          <button onClick={start} disabled={busy} className="px-4 py-2 bg-charcoal text-white text-sm rounded-sm hover:bg-bronze disabled:opacity-60">{busy ? <Loader2 size={14} className="animate-spin" /> : 'Set up 2FA'}</button>
        )}
      </div>
      <div className="bg-white rounded-sm border border-taupe/30 p-6">
        <h2 className="flex items-center gap-2 text-sm font-medium text-charcoal mb-4"><KeyRound size={16} className="text-bronze" /> Change password</h2>
        <div className="grid sm:grid-cols-2 gap-3 max-w-lg">
          <input type="password" autoComplete="new-password" value={pw.a} onChange={e => setPw(p => ({ ...p, a: e.target.value }))} placeholder="New password (12+ chars)" className="border border-taupe/50 px-3 py-2 text-sm rounded-sm focus:outline-none focus:border-bronze" />
          <input type="password" autoComplete="new-password" value={pw.b} onChange={e => setPw(p => ({ ...p, b: e.target.value }))} placeholder="Repeat" className="border border-taupe/50 px-3 py-2 text-sm rounded-sm focus:outline-none focus:border-bronze" />
        </div>
        <button onClick={changePassword} disabled={busy} className="mt-3 px-4 py-2 border border-taupe/50 text-sm rounded-sm hover:border-bronze disabled:opacity-60">Update password</button>
      </div>
      {msg && <p className="mt-4 text-sm text-charcoal-light" role="status">{msg}</p>}
    </div>
  );
}
