import { useEffect, useState } from 'react';
import { Megaphone, Wrench, ToggleLeft, Loader2, Check, Share2 } from 'lucide-react';
import { supabase, rows } from '../../lib/supabaseClient';
import type { SiteSetting } from '../../lib/types';

type Ann = { enabled: boolean; text: string; link: string; link_label: string };
type Maint = { enabled: boolean; message: string };
type Feat = { comments: boolean; shop: boolean; newsletter: boolean; qa: boolean; glossary: boolean };
type Social = { instagram: string; pinterest: string; twitter: string; youtube: string };

/** Live site settings stored in `site_settings` (public rows are read by the storefront on load). */
export default function SiteSettingsPanel() {
  const [ann, setAnn] = useState<Ann>({ enabled: false, text: '', link: '', link_label: '' });
  const [maint, setMaint] = useState<Maint>({ enabled: false, message: '' });
  const [feat, setFeat] = useState<Feat>({ comments: true, shop: true, newsletter: true, qa: true, glossary: true });
  const [social, setSocial] = useState<Social>({ instagram: '', pinterest: '', twitter: '', youtube: '' });
  const [siteUrl, setSiteUrl] = useState('https://lixxonstudio.com');
  const [saving, setSaving] = useState('');
  const [saved, setSaved] = useState('');

  useEffect(() => {
    supabase.from('site_settings').select('key, value, is_public').then(({ data }) => {
      rows<SiteSetting>(data).forEach(s => {
        if (s.key === 'announcement') setAnn(a => ({ ...a, ...(s.value as Partial<Ann>) }));
        if (s.key === 'maintenance') setMaint(m => ({ ...m, ...(s.value as Partial<Maint>) }));
        // `flags` is the canonical key now; `features` is kept in step by admin_set_setting().
        if (s.key === 'flags') setFeat(f => ({ ...f, ...(s.value as Partial<Feat>) }));
        if (s.key === 'features') setFeat(f => ({ ...f, ...(s.value as Partial<Feat>) }));
        if (s.key === 'social') setSocial(f => ({ ...f, ...(s.value as Partial<Social>) }));
        if (s.key === 'site_url' && typeof s.value.url === 'string') setSiteUrl(s.value.url);
      });
    });
  }, []);

  // Goes through the RPC (not a raw upsert) so the key is validated, the capability is
  // checked server-side and the change lands in the audit trail with a diff.
  const save = async (key: string, value: Record<string, unknown>) => {
    setSaving(key);
    const { error } = await supabase.rpc('admin_set_setting', { p_key: key, p_value: value, p_is_public: true });
    setSaving(''); setSaved(error ? '' : key); setTimeout(() => setSaved(''), 2000);
  };
  const Btn = ({ k, v }: { k: string; v: Record<string, unknown> }) => (
    <button onClick={() => save(k, v)} disabled={saving === k} className="inline-flex items-center gap-2 px-4 py-2 bg-charcoal text-white text-xs rounded-sm hover:bg-bronze disabled:opacity-60">{saving === k ? <Loader2 size={12} className="animate-spin" /> : saved === k ? <Check size={12} /> : null} Save</button>
  );
  const input = 'w-full border border-taupe/50 px-3 py-2 text-sm rounded-sm focus:outline-none focus:border-bronze';

  return (
    <>
      <div className="bg-white border border-taupe/30 rounded-sm p-6 mb-6">
        <h3 className="text-sm font-medium text-charcoal mb-1 flex items-center gap-2"><Megaphone size={16} className="text-bronze" /> Announcement bar</h3>
        <p className="text-xs text-charcoal-muted mb-4">Shown at the very top of every page until the reader dismisses it. Change the text to show it again.</p>
        <div className="grid gap-3">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={ann.enabled} onChange={e => setAnn({ ...ann, enabled: e.target.checked })} /> Enabled</label>
          <input value={ann.text} onChange={e => setAnn({ ...ann, text: e.target.value })} maxLength={160} placeholder="e.g. New guide: The Winter Barrier Repair Routine" className={input} />
          <div className="grid sm:grid-cols-2 gap-3"><input value={ann.link} onChange={e => setAnn({ ...ann, link: e.target.value })} placeholder="Link (optional, e.g. /blog/winter-barrier)" className={input} /><input value={ann.link_label} onChange={e => setAnn({ ...ann, link_label: e.target.value })} placeholder="Link label" className={input} /></div>
          <div><Btn k="announcement" v={ann} /></div>
        </div>
      </div>
      <div className="bg-white border border-taupe/30 rounded-sm p-6 mb-6">
        <h3 className="text-sm font-medium text-charcoal mb-1 flex items-center gap-2"><Wrench size={16} className="text-bronze" /> Maintenance mode</h3>
        <p className="text-xs text-charcoal-muted mb-4">Readers see a holding page; admins keep full access.</p>
        <div className="grid gap-3">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={maint.enabled} onChange={e => setMaint({ ...maint, enabled: e.target.checked })} /> {maint.enabled ? <span className="text-red-600 font-medium">Site is in maintenance mode</span> : 'Enable maintenance mode'}</label>
          <input value={maint.message} onChange={e => setMaint({ ...maint, message: e.target.value })} maxLength={240} placeholder="Message to readers" className={input} />
          <div><Btn k="maintenance" v={maint} /></div>
        </div>
      </div>
      <div className="bg-white border border-taupe/30 rounded-sm p-6 mb-6">
        <h3 className="text-sm font-medium text-charcoal mb-4 flex items-center gap-2"><ToggleLeft size={16} className="text-bronze" /> Feature flags</h3>
        <div className="grid sm:grid-cols-3 gap-3 mb-4">{(Object.keys(feat) as (keyof Feat)[]).map(k => <label key={k} className="flex items-center gap-2 text-sm capitalize"><input type="checkbox" checked={feat[k]} onChange={e => setFeat({ ...feat, [k]: e.target.checked })} /> {k === 'qa' ? 'Reader Q&A' : k}</label>)}</div>
        <Btn k="flags" v={feat} />
      </div>
      <div className="bg-white border border-taupe/30 rounded-sm p-6 mb-6">
        <h3 className="text-sm font-medium text-charcoal mb-4 flex items-center gap-2"><Share2 size={16} className="text-bronze" /> Site URL & social profiles</h3>
        <div className="grid gap-3">
          <label className="text-xs text-charcoal-muted">Canonical site URL (used in emails, sitemap, RSS)<input value={siteUrl} onChange={e => setSiteUrl(e.target.value)} className={input + ' mt-1'} /></label>
          <div className="grid sm:grid-cols-2 gap-3">{(Object.keys(social) as (keyof Social)[]).map(k => <input key={k} value={social[k]} onChange={e => setSocial({ ...social, [k]: e.target.value })} placeholder={`${k} URL`} className={input} />)}</div>
          <div className="flex gap-2"><button onClick={async () => { await save('site_url', { url: siteUrl.replace(/\/+$/, '') }); await save('social', social); }} disabled={!!saving} className="inline-flex items-center gap-2 px-4 py-2 bg-charcoal text-white text-xs rounded-sm hover:bg-bronze disabled:opacity-60">{saving ? <Loader2 size={12} className="animate-spin" /> : null} Save</button></div>
        </div>
      </div>
    </>
  );
}
