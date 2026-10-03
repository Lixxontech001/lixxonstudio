import { useEffect, useState, type FormEvent } from 'react';
import { Helmet } from 'react-helmet-async';
import { User, Award, Globe, Lock, Loader2, Check, Link2, LogOut, Trash2 } from 'lucide-react';
import CustomerGate from './CustomerGate';
import { useAuth } from '../../context/AuthContext';
import { useProfile, useBadges, BADGES } from '../../hooks/useV3';
import { useToast } from '../../context/ToastContext';
import { Link } from '../../context/NavigationContext';
import { getDisplayCurrency, setDisplayCurrency } from '../../lib/money';
import { useCurrencyRates } from '../../hooks/useV3';
import { supabase } from '../../lib/supabaseClient';

function Inner() {
  const { email, signOut } = useAuth();
  const { profile, loading, save } = useProfile();
  const { badges } = useBadges();
  const { showToast } = useToast();
  const rates = useCurrencyRates();
  const [form, setForm] = useState({ display_name: '', handle: '', bio: '', is_public: false });
  const [busy, setBusy] = useState(false);
  const [currency, setCurrency] = useState(getDisplayCurrency());
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (profile) setForm({ display_name: profile.display_name || '', handle: profile.handle || '', bio: profile.bio || '', is_public: profile.is_public });
    supabase.rpc('claim_my_orders').then(() => undefined, () => undefined); // link past guest orders to this account
  }, [profile]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (form.is_public && !/^[a-z0-9_]{3,30}$/.test(form.handle)) { showToast('Choose a handle (3–30 lowercase letters, numbers or _) to make your profile public.', 'error'); return; }
    setBusy(true);
    const { error } = await save({ display_name: form.display_name.trim() || null, handle: form.handle.trim() || null, bio: form.bio.trim() || null, is_public: form.is_public });
    setBusy(false);
    if (error) showToast(error.includes('duplicate') ? 'That handle is taken.' : error, 'error'); else showToast('Profile saved', 'success');
  };

  const exportData = async () => {
    setExporting(true);
    const [o, b, p] = await Promise.all([
      supabase.from('orders').select('order_number, created_at, status, payment_status, amount, currency'),
      supabase.from('user_bookmarks').select('post_id, created_at'),
      supabase.from('user_profiles').select('*').maybeSingle(),
    ]);
    const blob = new Blob([JSON.stringify({ exported_at: new Date().toISOString(), email, profile: p.data, orders: o.data, bookmarks: b.data, local: { reading_history: JSON.parse(localStorage.getItem('lixxon_reading_history') || '[]'), bookmarks: JSON.parse(localStorage.getItem('lixxon_bookmarks') || '[]') } }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'lixxon-studio-my-data.json'; a.click();
    setExporting(false);
  };

  const initials = (form.display_name || email || '?').split(/[\s@]/).filter(Boolean).slice(0, 2).map(s => s[0].toUpperCase()).join('');

  return (
    <main className="container-narrow py-16 md:py-20">
      <Helmet><title>Profile & preferences | Lixxon Studio</title><meta name="robots" content="noindex" /></Helmet>
      <nav className="text-xs text-charcoal-muted mb-6"><Link to={{ name: 'account' }} className="hover:text-bronze">Account</Link> / Profile</nav>
      <div className="flex items-center gap-5 mb-10">
        <div className="w-16 h-16 rounded-full bg-charcoal text-cream flex items-center justify-center font-serif text-2xl" aria-hidden>{initials}</div>
        <div><h1 className="font-serif text-3xl text-charcoal">{form.display_name || 'Your profile'}</h1><p className="text-sm text-charcoal-muted">{email}</p></div>
      </div>

      {loading ? <div className="skeleton h-40 rounded-sm" /> : (
        <form onSubmit={submit} className="grid gap-5 p-6 md:p-8 bg-white/70 border border-taupe/40 rounded-sm">
          <h2 className="flex items-center gap-2 font-serif text-xl text-charcoal"><User size={18} className="text-bronze" /> About you</h2>
          <label className="text-sm"><span className="block text-[11px] tracking-editorial uppercase text-charcoal-muted mb-1">Display name</span><input value={form.display_name} onChange={e => setForm(f => ({ ...f, display_name: e.target.value }))} maxLength={60} className="w-full px-4 py-3 border border-taupe rounded-sm bg-white focus:outline-none focus:border-bronze" /></label>
          <label className="text-sm"><span className="block text-[11px] tracking-editorial uppercase text-charcoal-muted mb-1">Handle</span><div className="flex items-center border border-taupe rounded-sm bg-white focus-within:border-bronze"><span className="pl-4 text-charcoal-muted">lixxonstudio.com/reader/</span><input value={form.handle} onChange={e => setForm(f => ({ ...f, handle: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') }))} maxLength={30} className="flex-1 px-1 py-3 bg-transparent focus:outline-none" /></div></label>
          <label className="text-sm"><span className="block text-[11px] tracking-editorial uppercase text-charcoal-muted mb-1">Bio</span><textarea value={form.bio} onChange={e => setForm(f => ({ ...f, bio: e.target.value }))} maxLength={280} rows={3} className="w-full px-4 py-3 border border-taupe rounded-sm bg-white focus:outline-none focus:border-bronze" /><span className="text-[11px] text-charcoal-muted">{form.bio.length}/280</span></label>
          <label className="flex items-start gap-3 text-sm cursor-pointer"><input type="checkbox" checked={form.is_public} onChange={e => setForm(f => ({ ...f, is_public: e.target.checked }))} className="mt-1 accent-bronze" /><span><span className="flex items-center gap-2 font-medium text-charcoal">{form.is_public ? <Globe size={14} className="text-bronze" /> : <Lock size={14} />} Public reader profile</span><span className="text-charcoal-muted">Shows your name, bio, badges and any reading lists you have marked as shared. Your email is never shown.</span></span></label>
          <div className="flex flex-wrap items-center gap-4">
            <button disabled={busy} className="inline-flex items-center gap-2 px-6 py-3 bg-charcoal text-white text-xs tracking-editorial uppercase rounded-sm hover:bg-bronze disabled:opacity-60">{busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Save</button>
            {profile?.is_public && profile.handle && <Link to={{ name: 'reader', handle: profile.handle }} className="inline-flex items-center gap-1.5 text-xs text-bronze hover:underline"><Link2 size={13} /> View public profile</Link>}
          </div>
        </form>
      )}

      <section className="mt-10 p-6 md:p-8 bg-white/70 border border-taupe/40 rounded-sm" aria-labelledby="badges-h">
        <h2 id="badges-h" className="flex items-center gap-2 font-serif text-xl text-charcoal mb-5"><Award size={18} className="text-bronze" /> Achievements</h2>
        <ul className="grid sm:grid-cols-2 gap-3">
          {Object.entries(BADGES).map(([key, b]) => { const got = badges.find(x => x.badge === key); return (
            <li key={key} className={`flex items-center gap-4 p-4 rounded-sm border ${got ? 'border-bronze/50 bg-bronze/5' : 'border-taupe/40 opacity-60'}`}>
              <span className="text-2xl" aria-hidden>{b.emoji}</span>
              <div><p className="text-sm font-medium text-charcoal">{b.label}</p><p className="text-xs text-charcoal-muted">{b.description}</p>{got && <p className="text-[10px] text-bronze mt-1">Earned {new Date(got.earned_at).toLocaleDateString()}</p>}</div>
            </li>); })}
        </ul>
      </section>

      <section className="mt-10 p-6 md:p-8 bg-white/70 border border-taupe/40 rounded-sm" aria-labelledby="prefs-h">
        <h2 id="prefs-h" className="font-serif text-xl text-charcoal mb-5">Preferences</h2>
        <label className="text-sm block max-w-xs"><span className="block text-[11px] tracking-editorial uppercase text-charcoal-muted mb-1">Show prices in</span>
          <select value={currency} onChange={e => { setCurrency(e.target.value); setDisplayCurrency(e.target.value); }} className="w-full px-4 py-3 border border-taupe rounded-sm bg-white focus:outline-none focus:border-bronze">
            {['USD', ...Object.keys(rates).filter(c => c !== 'USD').sort()].map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <span className="text-[11px] text-charcoal-muted">Display only — you are always charged in USD.</span>
        </label>
        <div className="mt-6 flex flex-wrap gap-4 text-sm">
          <Link to={{ name: 'newsletter-preferences' }} className="text-bronze hover:underline">Newsletter preferences</Link>
          <Link to={{ name: 'account-refunds' }} className="text-bronze hover:underline">Request a refund</Link>
        </div>
      </section>

      <section className="mt-10 p-6 md:p-8 border border-taupe/40 rounded-sm" aria-labelledby="privacy-h">
        <h2 id="privacy-h" className="font-serif text-xl text-charcoal mb-3">Your data</h2>
        <p className="text-sm text-charcoal-light mb-4">Download everything we hold about this account, or sign out everywhere. To delete your account entirely, <Link to={{ name: 'contact' }} className="text-bronze hover:underline">contact us</Link> and we will remove it within 7 days.</p>
        <div className="flex flex-wrap gap-3">
          <button onClick={exportData} disabled={exporting} className="inline-flex items-center gap-2 px-5 py-2.5 border border-taupe text-xs tracking-editorial uppercase rounded-sm hover:border-bronze">{exporting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} className="rotate-180" />} Export my data</button>
          <button onClick={() => signOut()} className="inline-flex items-center gap-2 px-5 py-2.5 border border-taupe text-xs tracking-editorial uppercase rounded-sm hover:border-red-400 hover:text-red-600"><LogOut size={13} /> Sign out</button>
        </div>
      </section>
    </main>
  );
}

export default function AccountProfilePage() {
  return <CustomerGate title="Your profile" intro="Sign in to manage your profile, badges and preferences."><Inner /></CustomerGate>;
}
