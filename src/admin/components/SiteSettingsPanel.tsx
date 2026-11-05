import { useEffect, useState } from 'react';
import {
  Megaphone, Wrench, ToggleLeft, Loader2, Check, Share2,
  Palette, ShoppingBag, Cookie, Trophy
} from 'lucide-react';
import { supabase, rows } from '../../lib/supabaseClient';
import type { SiteSetting } from '../../lib/types';

type Ann = { enabled: boolean; text: string; link: string; link_label: string; style?: string };
type Maint = { enabled: boolean; message: string };
type Feat = {
  comments: boolean;
  shop: boolean;
  newsletter: boolean;
  qa: boolean;
  glossary: boolean;
  achievements?: boolean;
  trending?: boolean;
  salon?: boolean;
};
type Social = {
  instagram: string;
  discord: string;
  substack: string;
  youtube: string;
  spotify: string;
  pinterest: string;
  twitter: string;
};
type Aesthetics = {
  reading_progress_bar: boolean;
  glassmorphism_nav: boolean;
  font_scale: string;
  theme_override: string;
};
type PrivilegeConfig = {
  points_per_comment: number;
  points_daily_visit: number;
  silver_rank_threshold: number;
  gold_rank_threshold: number;
};
type CommerceConfig = {
  default_currency: string;
  free_shipping_threshold: number;
  tax_notice: string;
};
type PrivacyConfig = {
  cookie_banner_enabled: boolean;
  cookie_banner_text: string;
};

export default function SiteSettingsPanel() {
  const [ann, setAnn] = useState<Ann>({ enabled: false, text: '', link: '', link_label: '', style: 'bronze' });
  const [maint, setMaint] = useState<Maint>({ enabled: false, message: '' });
  const [feat, setFeat] = useState<Feat>({
    comments: true,
    shop: true,
    newsletter: true,
    qa: true,
    glossary: true,
    achievements: true,
    trending: true,
    salon: true,
  });
  const [social, setSocial] = useState<Social>({
    instagram: '',
    discord: '',
    substack: '',
    youtube: '',
    spotify: '',
    pinterest: '',
    twitter: '',
  });
  const [aesthetics, setAesthetics] = useState<Aesthetics>({
    reading_progress_bar: true,
    glassmorphism_nav: true,
    font_scale: 'classic',
    theme_override: 'system',
  });
  const [privilege, setPrivilege] = useState<PrivilegeConfig>({
    points_per_comment: 15,
    points_daily_visit: 5,
    silver_rank_threshold: 250,
    gold_rank_threshold: 600,
  });
  const [commerce, setCommerce] = useState<CommerceConfig>({
    default_currency: 'USD',
    free_shipping_threshold: 50,
    tax_notice: 'Taxes and duties calculated at secure checkout.',
  });
  const [privacy, setPrivacy] = useState<PrivacyConfig>({
    cookie_banner_enabled: true,
    cookie_banner_text: 'We use cookies to remember your reading progress and preferences.',
  });

  const [saving, setSaving] = useState('');
  const [saved, setSaved] = useState('');

  useEffect(() => {
    supabase.from('site_settings').select('key, value, is_public').then(({ data }) => {
      rows<SiteSetting>(data).forEach(s => {
        if (s.key === 'announcement') setAnn(a => ({ ...a, ...(s.value as Partial<Ann>) }));
        if (s.key === 'maintenance') setMaint(m => ({ ...m, ...(s.value as Partial<Maint>) }));
        if (s.key === 'flags') setFeat(f => ({ ...f, ...(s.value as Partial<Feat>) }));
        if (s.key === 'features') setFeat(f => ({ ...f, ...(s.value as Partial<Feat>) }));
        if (s.key === 'social') setSocial(f => ({ ...f, ...(s.value as Partial<Social>) }));
        if (s.key === 'aesthetics') setAesthetics(a => ({ ...a, ...(s.value as Partial<Aesthetics>) }));
        if (s.key === 'privilege') setPrivilege(p => ({ ...p, ...(s.value as Partial<PrivilegeConfig>) }));
        if (s.key === 'commerce') setCommerce(c => ({ ...c, ...(s.value as Partial<CommerceConfig>) }));
        if (s.key === 'privacy') setPrivacy(p => ({ ...p, ...(s.value as Partial<PrivacyConfig>) }));
      });
    });
  }, []);

  const save = async (key: string, value: Record<string, unknown>) => {
    setSaving(key);
    const { error } = await supabase.rpc('admin_set_setting', { p_key: key, p_value: value, p_is_public: true });
    setSaving('');
    setSaved(error ? '' : key);
    setTimeout(() => setSaved(''), 2500);
  };

  const Btn = ({ k, v }: { k: string; v: Record<string, unknown> }) => (
    <button
      onClick={() => save(k, v)}
      disabled={saving === k}
      className="inline-flex items-center gap-2 px-4 py-2 bg-charcoal dark:bg-bronze text-white text-xs rounded-sm hover:bg-bronze dark:hover:bg-bronze-dark transition-colors disabled:opacity-60 shadow-xs"
    >
      {saving === k ? <Loader2 size={12} className="animate-spin" /> : saved === k ? <Check size={12} /> : null}
      {saved === k ? 'Saved' : 'Save Changes'}
    </button>
  );

  const input =
    'w-full border border-taupe/50 dark:border-white/15 dark:bg-[#1C1C1C] dark:text-white px-3 py-2 text-sm rounded-sm focus:outline-none focus:border-bronze';

  return (
    <div className="space-y-6">
      {/* 1. Announcement Bar */}
      <div className="bg-white dark:bg-[#161616] border border-taupe/30 dark:border-white/10 rounded-sm p-6 shadow-xs">
        <h3 className="text-sm font-medium text-charcoal dark:text-white mb-1 flex items-center gap-2">
          <Megaphone size={16} className="text-bronze" /> Announcement Bar &amp; Banner
        </h3>
        <p className="text-xs text-charcoal-muted dark:text-gray-400 mb-4">
          Shown at the very top of public site pages until dismissed. Updating the message displays it anew to all readers.
        </p>
        <div className="grid gap-3">
          <label className="flex items-center gap-2 text-sm text-charcoal dark:text-white cursor-pointer">
            <input
              type="checkbox"
              checked={ann.enabled}
              onChange={e => setAnn({ ...ann, enabled: e.target.checked })}
              className="accent-bronze"
            />
            <span>Enable Announcement Banner</span>
          </label>
          <input
            value={ann.text}
            onChange={e => setAnn({ ...ann, text: e.target.value })}
            maxLength={180}
            placeholder="e.g. New Guide: The Winter Lipid Barrier Repair Routine"
            className={input}
          />
          <div className="grid sm:grid-cols-2 gap-3">
            <input
              value={ann.link}
              onChange={e => setAnn({ ...ann, link: e.target.value })}
              placeholder="Link (e.g. /trending or /collections)"
              className={input}
            />
            <input
              value={ann.link_label}
              onChange={e => setAnn({ ...ann, link_label: e.target.value })}
              placeholder="Button Label (e.g. Read Guide)"
              className={input}
            />
          </div>
          <div>
            <Btn k="announcement" v={ann} />
          </div>
        </div>
      </div>

      {/* 2. Reader Experience & Aesthetics */}
      <div className="bg-white dark:bg-[#161616] border border-taupe/30 dark:border-white/10 rounded-sm p-6 shadow-xs">
        <h3 className="text-sm font-medium text-charcoal dark:text-white mb-1 flex items-center gap-2">
          <Palette size={16} className="text-bronze" /> Editorial Aesthetics &amp; Reader Experience
        </h3>
        <p className="text-xs text-charcoal-muted dark:text-gray-400 mb-4">
          Control reading layout enhancements, header transparency, and typographic scaling across public articles.
        </p>
        <div className="grid sm:grid-cols-2 gap-4 mb-4">
          <label className="flex items-center gap-2 text-sm text-charcoal dark:text-white cursor-pointer">
            <input
              type="checkbox"
              checked={aesthetics.reading_progress_bar}
              onChange={e => setAesthetics({ ...aesthetics, reading_progress_bar: e.target.checked })}
              className="accent-bronze"
            />
            <span>Reading Progress Indicator Bar</span>
          </label>
          <label className="flex items-center gap-2 text-sm text-charcoal dark:text-white cursor-pointer">
            <input
              type="checkbox"
              checked={aesthetics.glassmorphism_nav}
              onChange={e => setAesthetics({ ...aesthetics, glassmorphism_nav: e.target.checked })}
              className="accent-bronze"
            />
            <span>Glassmorphic Frosted Header</span>
          </label>
        </div>
        <div className="grid sm:grid-cols-2 gap-3 mb-4">
          <div>
            <label className="block text-xs text-charcoal-muted dark:text-gray-400 mb-1">Typography Scale</label>
            <select
              value={aesthetics.font_scale}
              onChange={e => setAesthetics({ ...aesthetics, font_scale: e.target.value })}
              className={input}
            >
              <option value="classic">Classic Editorial (16px base)</option>
              <option value="large">Elevated Readability (18px base)</option>
              <option value="compact">Compact Architectural</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-charcoal-muted dark:text-gray-400 mb-1">Default Theme Preference</label>
            <select
              value={aesthetics.theme_override}
              onChange={e => setAesthetics({ ...aesthetics, theme_override: e.target.value })}
              className={input}
            >
              <option value="system">Follow Reader System Setting</option>
              <option value="light">Always Default Light Theme</option>
              <option value="dark">Always Default Dark Theme</option>
            </select>
          </div>
        </div>
        <Btn k="aesthetics" v={aesthetics} />
      </div>

      {/* 3. Privilege Points & Salon Ranks */}
      <div className="bg-white dark:bg-[#161616] border border-taupe/30 dark:border-white/10 rounded-sm p-6 shadow-xs">
        <h3 className="text-sm font-medium text-charcoal dark:text-white mb-1 flex items-center gap-2">
          <Trophy size={16} className="text-bronze" /> Reader Privileges &amp; Reputation Points
        </h3>
        <p className="text-xs text-charcoal-muted dark:text-gray-400 mb-4">
          Set how readers accumulate reputation points and unlock tiered salon protocols and private archives.
        </p>
        <div className="grid sm:grid-cols-2 gap-3 mb-4">
          <div>
            <label className="block text-xs text-charcoal-muted dark:text-gray-400 mb-1">Points per Verified Comment</label>
            <input
              type="number"
              min={1}
              value={privilege.points_per_comment}
              onChange={e => setPrivilege({ ...privilege, points_per_comment: Number(e.target.value) })}
              className={input}
            />
          </div>
          <div>
            <label className="block text-xs text-charcoal-muted dark:text-gray-400 mb-1">Points per Daily Visit</label>
            <input
              type="number"
              min={1}
              value={privilege.points_daily_visit}
              onChange={e => setPrivilege({ ...privilege, points_daily_visit: Number(e.target.value) })}
              className={input}
            />
          </div>
          <div>
            <label className="block text-xs text-charcoal-muted dark:text-gray-400 mb-1">Silver Scholar Rank Threshold</label>
            <input
              type="number"
              min={50}
              value={privilege.silver_rank_threshold}
              onChange={e => setPrivilege({ ...privilege, silver_rank_threshold: Number(e.target.value) })}
              className={input}
            />
          </div>
          <div>
            <label className="block text-xs text-charcoal-muted dark:text-gray-400 mb-1">Gold Archivist Rank Threshold</label>
            <input
              type="number"
              min={100}
              value={privilege.gold_rank_threshold}
              onChange={e => setPrivilege({ ...privilege, gold_rank_threshold: Number(e.target.value) })}
              className={input}
            />
          </div>
        </div>
        <Btn k="privilege" v={privilege} />
      </div>

      {/* 4. Social & Community URLs */}
      <div className="bg-white dark:bg-[#161616] border border-taupe/30 dark:border-white/10 rounded-sm p-6 shadow-xs">
        <h3 className="text-sm font-medium text-charcoal dark:text-white mb-1 flex items-center gap-2">
          <Share2 size={16} className="text-bronze" /> Social Networks &amp; Community Links
        </h3>
        <p className="text-xs text-charcoal-muted dark:text-gray-400 mb-4">
          Powers footer social icons, sharing cards, and author community channels.
        </p>
        <div className="grid sm:grid-cols-2 gap-3 mb-4">
          {(Object.keys(social) as (keyof Social)[]).map(k => (
            <div key={k}>
              <label className="block text-xs capitalize text-charcoal-muted dark:text-gray-400 mb-1">{k} Profile</label>
              <input
                value={social[k]}
                onChange={e => setSocial({ ...social, [k]: e.target.value })}
                placeholder={`https://${k}.com/lixxonstudio`}
                className={input}
              />
            </div>
          ))}
        </div>
        <Btn k="social" v={social} />
      </div>

      {/* 5. Shop & Commerce Display */}
      <div className="bg-white dark:bg-[#161616] border border-taupe/30 dark:border-white/10 rounded-sm p-6 shadow-xs">
        <h3 className="text-sm font-medium text-charcoal dark:text-white mb-1 flex items-center gap-2">
          <ShoppingBag size={16} className="text-bronze" /> Commerce &amp; Storefront Defaults
        </h3>
        <p className="text-xs text-charcoal-muted dark:text-gray-400 mb-4">
          Default currency and shipping message displayed in the shop and cart drawer.
        </p>
        <div className="grid sm:grid-cols-2 gap-3 mb-4">
          <div>
            <label className="block text-xs text-charcoal-muted dark:text-gray-400 mb-1">Default Display Currency</label>
            <select
              value={commerce.default_currency}
              onChange={e => setCommerce({ ...commerce, default_currency: e.target.value })}
              className={input}
            >
              <option value="USD">USD ($ United States Dollar)</option>
              <option value="GBP">GBP (£ British Pound)</option>
              <option value="EUR">EUR (€ Euro)</option>
              <option value="CAD">CAD (CA$ Canadian Dollar)</option>
              <option value="AUD">AUD (A$ Australian Dollar)</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-charcoal-muted dark:text-gray-400 mb-1">Free Shipping / Guide Threshold ($)</label>
            <input
              type="number"
              value={commerce.free_shipping_threshold}
              onChange={e => setCommerce({ ...commerce, free_shipping_threshold: Number(e.target.value) })}
              className={input}
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs text-charcoal-muted dark:text-gray-400 mb-1">Checkout Legal / Tax Notice</label>
            <input
              value={commerce.tax_notice}
              onChange={e => setCommerce({ ...commerce, tax_notice: e.target.value })}
              className={input}
            />
          </div>
        </div>
        <Btn k="commerce" v={commerce} />
      </div>

      {/* 6. Feature Flags */}
      <div className="bg-white dark:bg-[#161616] border border-taupe/30 dark:border-white/10 rounded-sm p-6 shadow-xs">
        <h3 className="text-sm font-medium text-charcoal dark:text-white mb-4 flex items-center gap-2">
          <ToggleLeft size={16} className="text-bronze" /> Public Feature Toggles
        </h3>
        <div className="grid sm:grid-cols-4 gap-3 mb-4">
          {(Object.keys(feat) as (keyof Feat)[]).map(k => (
            <label key={k} className="flex items-center gap-2 text-sm text-charcoal dark:text-white capitalize cursor-pointer">
              <input
                type="checkbox"
                checked={feat[k]}
                onChange={e => setFeat({ ...feat, [k]: e.target.checked })}
                className="accent-bronze"
              />
              <span>{k === 'qa' ? 'Reader Q&A' : k}</span>
            </label>
          ))}
        </div>
        <Btn k="flags" v={feat} />
      </div>

      {/* 7. Cookie Consent & Privacy */}
      <div className="bg-white dark:bg-[#161616] border border-taupe/30 dark:border-white/10 rounded-sm p-6 shadow-xs">
        <h3 className="text-sm font-medium text-charcoal dark:text-white mb-1 flex items-center gap-2">
          <Cookie size={16} className="text-bronze" /> Cookie Consent &amp; Privacy Notice
        </h3>
        <p className="text-xs text-charcoal-muted dark:text-gray-400 mb-4">
          Control the bottom privacy banner shown to initial visitors.
        </p>
        <div className="grid gap-3 mb-4">
          <label className="flex items-center gap-2 text-sm text-charcoal dark:text-white cursor-pointer">
            <input
              type="checkbox"
              checked={privacy.cookie_banner_enabled}
              onChange={e => setPrivacy({ ...privacy, cookie_banner_enabled: e.target.checked })}
              className="accent-bronze"
            />
            <span>Enable Cookie Banner</span>
          </label>
          <input
            value={privacy.cookie_banner_text}
            onChange={e => setPrivacy({ ...privacy, cookie_banner_text: e.target.value })}
            className={input}
          />
        </div>
        <Btn k="privacy" v={privacy} />
      </div>

      {/* 8. Maintenance Mode */}
      <div className="bg-white dark:bg-[#161616] border border-taupe/30 dark:border-white/10 rounded-sm p-6 shadow-xs">
        <h3 className="text-sm font-medium text-charcoal dark:text-white mb-1 flex items-center gap-2">
          <Wrench size={16} className="text-bronze" /> Maintenance Mode
        </h3>
        <p className="text-xs text-charcoal-muted dark:text-gray-400 mb-4">
          Public visitors see a branded holding page; authenticated administrators retain full access.
        </p>
        <div className="grid gap-3">
          <label className="flex items-center gap-2 text-sm text-charcoal dark:text-white cursor-pointer">
            <input
              type="checkbox"
              checked={maint.enabled}
              onChange={e => setMaint({ ...maint, enabled: e.target.checked })}
              className="accent-bronze"
            />
            <span>{maint.enabled ? <span className="text-red-600 dark:text-red-400 font-medium">Site is currently in maintenance mode</span> : 'Enable Maintenance Holding Page'}</span>
          </label>
          <input
            value={maint.message}
            onChange={e => setMaint({ ...maint, message: e.target.value })}
            maxLength={240}
            placeholder="Message displayed to visitors (e.g. We are performing seasonal curation updates.)"
            className={input}
          />
          <div>
            <Btn k="maintenance" v={maint} />
          </div>
        </div>
      </div>
    </div>
  );
}
