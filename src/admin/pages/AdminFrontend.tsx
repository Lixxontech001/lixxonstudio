import { useEffect, useMemo, useState } from 'react';
import {
  Palette, Plus, Trash2, ArrowUp, ArrowDown, Save, RotateCcw, Eye, Code2, Megaphone, Wrench, Flag, Menu as MenuIcon,
} from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../context/AuthContext';
import { invalidateSiteConfig } from '../../hooks/useSiteConfig';
import { Panel, Btn, Notice, Loading, useAdminAction } from '../components/ui';

type SettingRow = { key: string; value: Record<string, unknown>; is_public: boolean; updated_at: string };
type Dict = Record<string, Record<string, unknown>>;

const HOME_SECTIONS: { id: string; label: string }[] = [
  { id: 'hero', label: 'Hero' },
  { id: 'trending', label: 'Trending' },
  { id: 'editors_picks', label: 'Editors’ picks' },
  { id: 'for_you', label: 'For you' },
  { id: 'latest', label: 'Latest' },
  { id: 'shop', label: 'Shop' },
  { id: 'newsletter', label: 'Newsletter' },
];
const FLAG_LABELS: Record<string, string> = {
  comments: 'Comments', shop: 'Shop', newsletter: 'Newsletter', qa: 'Reader questions', glossary: 'Glossary',
  tts: 'Listen (text to speech)', personalisation: 'Personalisation', picks: 'Editors’ picks', search: 'Search',
};
const ACCENTS = ['#9C6647', '#85543A', '#2F4538', '#1F3A5F', '#7A2E2E', '#4A3B6B'];

const KEY_TABS = [
  { key: 'homepage', label: 'Homepage', icon: <Eye size={13} /> },
  { key: 'nav_menu', label: 'Navigation', icon: <MenuIcon size={13} /> },
  { key: 'footer', label: 'Footer', icon: <MenuIcon size={13} /> },
  { key: 'theme', label: 'Theme', icon: <Palette size={13} /> },
  { key: 'seo_defaults', label: 'SEO', icon: <Code2 size={13} /> },
  { key: 'redirects', label: 'Redirects', icon: <ArrowDown size={13} /> },
  { key: 'flags', label: 'Feature flags', icon: <Flag size={13} /> },
  { key: 'announcement', label: 'Announcement', icon: <Megaphone size={13} /> },
  { key: 'maintenance', label: 'Maintenance', icon: <Wrench size={13} /> },
  { key: 'custom_head', label: 'Custom <head>', icon: <Code2 size={13} /> },
];

export default function AdminFrontend() {
  const { can } = useAuth();
  const [settings, setSettings] = useState<Dict>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState('homepage');
  const action = useAdminAction();
  const canWrite = can('settings.frontend');

  const load = async () => {
    setLoading(true);
    const { data, error: e } = await supabase.rpc('admin_site_settings');
    if (e) setError(e.message);
    else {
      const map: Dict = {};
      ((data || []) as SettingRow[]).forEach(r => { map[r.key] = r.value || {}; });
      setSettings(map);
      setError(null);
    }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const save = (key: string, value: unknown) => action.run(key, async () => {
    const { error: e } = await supabase.rpc('admin_set_setting', { p_key: key, p_value: value, p_is_public: true });
    if (!e) { invalidateSiteConfig(); await load(); }
    return { error: e?.message || null, text: e ? '' : 'Saved — the live site picks this up on the next page load.' };
  });

  const reset = (key: string) => {
    if (!confirm(`Reset "${key}" to the shipped defaults?`)) return;
    action.run(`reset-${key}`, async () => {
      const { error: e } = await supabase.rpc('admin_reset_setting', { p_key: key });
      if (!e) { invalidateSiteConfig(); await load(); }
      return { error: e?.message || null, text: e ? '' : 'Reset.' };
    });
  };

  const value = (key: string) => settings[key] || {};
  const busy = action.busy === tab;
  const current = useMemo(() => KEY_TABS.find(t => t.key === tab)!, [tab]);

  if (!can('settings.read')) {
    return <Notice tone="warn">You need the <code>settings.read</code> permission to open this screen.</Notice>;
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="font-serif text-2xl text-charcoal flex items-center gap-2"><Palette size={20} className="text-bronze" /> Front end</h1>
          <p className="text-sm text-charcoal-muted mt-1">
            Everything here is a row in <code>site_settings</code>. The storefront reads it on load, so a change goes live without a deploy — and it is audited like any other write.
          </p>
        </div>
        <Btn variant="ghost" onClick={load} busy={loading}>Reload from database</Btn>
      </div>

      {!canWrite && <Notice tone="warn">You can preview the configuration, but editing needs <code>settings.frontend</code>.</Notice>}
      {action.message && <div className="my-4"><Notice tone={action.message.tone}>{action.message.text}</Notice></div>}
      {error && <div className="my-4"><Notice tone="error">{error}</Notice></div>}

      <div className="flex flex-wrap gap-1 mb-5 border-b border-taupe/30">
        {KEY_TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex items-center gap-2 px-3 py-2 text-xs border-b-2 -mb-px ${tab === t.key ? 'border-bronze text-charcoal' : 'border-transparent text-charcoal-muted hover:text-charcoal'}`}>
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {loading ? <Loading /> : (
        <Panel title={current.label}
          actions={<>
            <Btn variant="ghost" icon={<RotateCcw size={13} />} onClick={() => reset(tab)} disabled={!canWrite} busy={action.busy === `reset-${tab}`}>Reset to default</Btn>
            <Btn variant="ghost" onClick={load}>Preview saved value</Btn>
          </>}>
          {tab === 'homepage' && <HomepageEditor value={value('homepage')} onSave={v => save('homepage', v)} busy={busy} disabled={!canWrite} />}
          {tab === 'nav_menu' && <NavEditor value={value('nav_menu')} onSave={v => save('nav_menu', v)} busy={busy} disabled={!canWrite} />}
          {tab === 'footer' && <FooterEditor value={value('footer')} onSave={v => save('footer', v)} busy={busy} disabled={!canWrite} />}
          {tab === 'theme' && <ThemeEditor value={value('theme')} onSave={v => save('theme', v)} busy={busy} disabled={!canWrite} />}
          {tab === 'seo_defaults' && <SeoEditor value={value('seo_defaults')} onSave={v => save('seo_defaults', v)} busy={busy} disabled={!canWrite} />}
          {tab === 'redirects' && <RedirectEditor value={value('redirects')} onSave={v => save('redirects', v)} busy={busy} disabled={!canWrite} />}
          {tab === 'flags' && <FlagsEditor value={value('flags')} onSave={v => save('flags', v)} busy={busy} disabled={!canWrite} />}
          {tab === 'announcement' && <SimpleForm key="announcement" fields={[['text', 'Text'], ['link', 'Link (optional)'], ['link_label', 'Link label']]} bools={[['enabled', 'Show the bar on every page']]} value={value('announcement')} onSave={v => save('announcement', v)} busy={busy} disabled={!canWrite} />}
          {tab === 'maintenance' && <SimpleForm key="maintenance" fields={[['message', 'Message shown to visitors']]} bools={[['enabled', 'Take the public site offline']]} value={value('maintenance')} onSave={v => save('maintenance', v)} busy={busy} disabled={!canWrite} />}
          {tab === 'custom_head' && <JsonEditor value={value('custom_head')} onSave={v => save('custom_head', v)} busy={busy} disabled={!canWrite}
            hint="Injected into <head> for every page (analytics snippets, verification meta tags). Scripts and iframes are stripped." />}
        </Panel>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ helpers */

function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2 mb-2">{children}</div>;
}

const input = 'border border-taupe/50 px-3 py-2 text-sm rounded-sm focus:outline-none focus:border-bronze bg-white';

function SaveBar({ onSave, busy, disabled, children }: { onSave: () => void; busy: boolean; disabled: boolean; children?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 mt-5 pt-4 border-t border-taupe/20">
      <Btn onClick={onSave} busy={busy} disabled={disabled} icon={<Save size={13} />}>Save</Btn>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ homepage */

function HomepageEditor({ value, onSave, busy, disabled }: { value: Record<string, unknown>; onSave: (v: unknown) => void; busy: boolean; disabled: boolean }) {
  const initial = useMemo(() => {
    const rows = Array.isArray(value.sections) ? (value.sections as { id: string; enabled?: boolean }[]) : [];
    const byId = new Map(rows.map(r => [r.id, r.enabled !== false]));
    const known = rows.filter(r => HOME_SECTIONS.some(s => s.id === r.id)).map(r => ({ id: r.id, enabled: r.enabled !== false }));
    const missing = HOME_SECTIONS.filter(s => !byId.has(s.id)).map(s => ({ id: s.id, enabled: false }));
    return [...known, ...missing];
  }, [value]);
  const [rows, setRows] = useState(initial);
  useEffect(() => setRows(initial), [initial]);

  const move = (i: number, delta: number) => {
    const next = [...rows];
    const j = i + delta;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setRows(next);
  };

  return (
    <>
      <p className="text-xs text-charcoal-muted mb-4">Drag order with the arrows — the homepage renders the enabled sections top to bottom.</p>
      {rows.map((r, i) => {
        const label = HOME_SECTIONS.find(s => s.id === r.id)?.label || r.id;
        return (
          <Row key={r.id}>
            <label className="flex items-center gap-2 text-sm text-charcoal w-52">
              <input type="checkbox" checked={r.enabled} disabled={disabled} onChange={e => setRows(rows.map(x => x.id === r.id ? { ...x, enabled: e.target.checked } : x))} />
              {label}
            </label>
            <button className="p-1.5 text-charcoal-muted hover:text-bronze disabled:opacity-40" disabled={disabled} onClick={() => move(i, -1)} aria-label={`Move ${label} up`}><ArrowUp size={13} /></button>
            <button className="p-1.5 text-charcoal-muted hover:text-bronze disabled:opacity-40" disabled={disabled} onClick={() => move(i, 1)} aria-label={`Move ${label} down`}><ArrowDown size={13} /></button>
            <span className="text-[11px] text-charcoal-muted">{r.id}</span>
          </Row>
        );
      })}
      <SaveBar onSave={() => onSave({ sections: rows })} busy={busy} disabled={disabled} />
    </>
  );
}

/* ------------------------------------------------------------------ nav */

type NavItem = { label: string; href: string; children?: { label: string; href: string }[] };

function NavEditor({ value, onSave, busy, disabled }: { value: Record<string, unknown>; onSave: (v: unknown) => void; busy: boolean; disabled: boolean }) {
  const [items, setItems] = useState<NavItem[]>(Array.isArray(value.items) ? (value.items as NavItem[]) : []);
  useEffect(() => setItems(Array.isArray(value.items) ? (value.items as NavItem[]) : []), [value]);

  const set = (i: number, patch: Partial<NavItem>) => setItems(items.map((it, j) => j === i ? { ...it, ...patch } : it));

  return (
    <>
      <p className="text-xs text-charcoal-muted mb-4">Leave the list empty to keep the built-in menu. Hrefs are relative (<code>/blog</code>) or absolute.</p>
      {items.map((it, i) => (
        <div key={i} className="border border-taupe/30 rounded-sm p-3 mb-2">
          <Row>
            <input className={`${input} w-44`} value={it.label} disabled={disabled} placeholder="Label" onChange={e => set(i, { label: e.target.value })} />
            <input className={`${input} flex-1 min-w-[180px]`} value={it.href} disabled={disabled} placeholder="/blog" onChange={e => set(i, { href: e.target.value })} />
            <button className="p-1.5 text-charcoal-muted hover:text-bronze disabled:opacity-40" disabled={disabled} onClick={() => i > 0 && setItems(items.map((x, j) => j === i - 1 ? items[i] : j === i ? items[i - 1] : x))} aria-label="Move up"><ArrowUp size={13} /></button>
            <button className="p-1.5 text-charcoal-muted hover:text-red-600 disabled:opacity-40" disabled={disabled} onClick={() => setItems(items.filter((_, j) => j !== i))} aria-label="Remove item"><Trash2 size={13} /></button>
          </Row>
          {(it.children || []).map((c, ci) => (
            <Row key={ci}>
              <span className="text-[11px] text-charcoal-muted pl-4">↳</span>
              <input className={`${input} w-40`} value={c.label} disabled={disabled} onChange={e => set(i, { children: (it.children || []).map((x, j) => j === ci ? { ...x, label: e.target.value } : x) })} />
              <input className={`${input} flex-1 min-w-[150px]`} value={c.href} disabled={disabled} onChange={e => set(i, { children: (it.children || []).map((x, j) => j === ci ? { ...x, href: e.target.value } : x) })} />
              <button className="p-1.5 text-charcoal-muted hover:text-red-600" disabled={disabled} onClick={() => set(i, { children: (it.children || []).filter((_, j) => j !== ci) })} aria-label="Remove sub-item"><Trash2 size={13} /></button>
            </Row>
          ))}
          <button className="text-[11px] text-bronze underline mt-1 disabled:opacity-40" disabled={disabled} onClick={() => set(i, { children: [...(it.children || []), { label: '', href: '' }] })}>+ sub-item</button>
        </div>
      ))}
      <Btn variant="ghost" disabled={disabled} icon={<Plus size={13} />} onClick={() => setItems([...items, { label: '', href: '' }])}>Add menu item</Btn>
      <SaveBar onSave={() => onSave({ items: items.filter(i => i.label && i.href) })} busy={busy} disabled={disabled} />
    </>
  );
}

/* ------------------------------------------------------------------ footer */

type FooterColumn = { title: string; links: { label: string; href: string }[] };

function FooterEditor({ value, onSave, busy, disabled }: { value: Record<string, unknown>; onSave: (v: unknown) => void; busy: boolean; disabled: boolean }) {
  const [columns, setColumns] = useState<FooterColumn[]>(Array.isArray(value.columns) ? (value.columns as FooterColumn[]) : []);
  const [note, setNote] = useState(String(value.note || ''));
  useEffect(() => {
    setColumns(Array.isArray(value.columns) ? (value.columns as FooterColumn[]) : []);
    setNote(String(value.note || ''));
  }, [value]);

  return (
    <>
      <p className="text-xs text-charcoal-muted mb-4">Empty columns keep the built-in footer. The note replaces the small print at the bottom.</p>
      {columns.map((col, ci) => (
        <div key={ci} className="border border-taupe/30 rounded-sm p-3 mb-2">
          <Row>
            <input className={`${input} w-56`} value={col.title} disabled={disabled} placeholder="Column title" onChange={e => setColumns(columns.map((c, j) => j === ci ? { ...c, title: e.target.value } : c))} />
            <button className="p-1.5 text-charcoal-muted hover:text-red-600" disabled={disabled} aria-label="Remove column" onClick={() => setColumns(columns.filter((_, j) => j !== ci))}><Trash2 size={13} /></button>
          </Row>
          {col.links.map((l, li) => (
            <Row key={li}>
              <span className="text-[11px] text-charcoal-muted pl-4">↳</span>
              <input className={`${input} w-40`} value={l.label} disabled={disabled} onChange={e => setColumns(columns.map((c, j) => j === ci ? { ...c, links: c.links.map((x, k) => k === li ? { ...x, label: e.target.value } : x) } : c))} />
              <input className={`${input} flex-1 min-w-[150px]`} value={l.href} disabled={disabled} onChange={e => setColumns(columns.map((c, j) => j === ci ? { ...c, links: c.links.map((x, k) => k === li ? { ...x, href: e.target.value } : x) } : c))} />
              <button className="p-1.5 text-charcoal-muted hover:text-red-600" disabled={disabled} aria-label="Remove link" onClick={() => setColumns(columns.map((c, j) => j === ci ? { ...c, links: c.links.filter((_, k) => k !== li) } : c))}><Trash2 size={13} /></button>
            </Row>
          ))}
          <button className="text-[11px] text-bronze underline" disabled={disabled} onClick={() => setColumns(columns.map((c, j) => j === ci ? { ...c, links: [...c.links, { label: '', href: '' }] } : c))}>+ link</button>
        </div>
      ))}
      <Btn variant="ghost" disabled={disabled} icon={<Plus size={13} />} onClick={() => setColumns([...columns, { title: '', links: [] }])}>Add column</Btn>
      <div className="mt-4">
        <label className="text-xs text-charcoal-muted uppercase tracking-wide">Closing note
          <input className={`${input} w-full mt-1`} value={note} disabled={disabled} onChange={e => setNote(e.target.value)} />
        </label>
      </div>
      <SaveBar onSave={() => onSave({ columns, note })} busy={busy} disabled={disabled} />
    </>
  );
}

/* ------------------------------------------------------------------ theme / seo / redirects / flags */

function ThemeEditor({ value, onSave, busy, disabled }: { value: Record<string, unknown>; onSave: (v: unknown) => void; busy: boolean; disabled: boolean }) {
  const [accent, setAccent] = useState(String(value.accent || '#9C6647'));
  const [accentText, setAccentText] = useState(String(value.accent_text || '#85543A'));
  useEffect(() => { setAccent(String(value.accent || '#9C6647')); setAccentText(String(value.accent_text || '#85543A')); }, [value]);
  return (
    <>
      <p className="text-xs text-charcoal-muted mb-4">These two values are the AA-contrast pair from THEME.md. Changing them repaints links, buttons and accents site-wide.</p>
      <Row>
        <label className="text-xs text-charcoal-muted">Accent
          <input type="color" value={accent} disabled={disabled} onChange={e => setAccent(e.target.value)} className="block w-24 h-10 border border-taupe/40 rounded-sm mt-1" />
        </label>
        <label className="text-xs text-charcoal-muted ml-4">Accent (hover / text)
          <input type="color" value={accentText} disabled={disabled} onChange={e => setAccentText(e.target.value)} className="block w-24 h-10 border border-taupe/40 rounded-sm mt-1" />
        </label>
        <div className="ml-4">
          <p className="text-xs text-charcoal-muted mb-1">Presets</p>
          <div className="flex gap-1">
            {ACCENTS.map(c => <button key={c} disabled={disabled} onClick={() => { setAccent(c); setAccentText(c); }} className="w-7 h-7 rounded-sm border border-taupe/40" style={{ background: c }} aria-label={`Use ${c}`} />)}
          </div>
        </div>
      </Row>
      <div className="mt-4 p-4 border border-taupe/30 rounded-sm">
        <p className="text-xs text-charcoal-muted mb-2">Preview</p>
        <p className="font-serif text-lg" style={{ color: accentText }}>The quiet luxury of good skin</p>
        <span className="inline-block mt-2 px-3 py-1.5 text-xs text-white rounded-sm" style={{ background: accent }}>Shop the edit</span>
        <a href="#preview" onClick={e => e.preventDefault()} className="ml-3 text-xs underline" style={{ color: accentText }}>Read the guide</a>
      </div>
      <SaveBar onSave={() => onSave({ accent, accent_text: accentText })} busy={busy} disabled={disabled} />
    </>
  );
}

function SeoEditor({ value, onSave, busy, disabled }: { value: Record<string, unknown>; onSave: (v: unknown) => void; busy: boolean; disabled: boolean }) {
  const fields: [string, string][] = [['title_suffix', 'Title suffix'], ['description', 'Default description'], ['og_image', 'Default OG image URL'], ['twitter', 'Twitter/X handle'], ['robots', 'Robots']];
  const [draft, setDraft] = useState<Record<string, string>>({});
  useEffect(() => { setDraft(Object.fromEntries(fields.map(([k]) => [k, String(value[k] ?? '')]))); }, [value]);
  return (
    <>
      <p className="text-xs text-charcoal-muted mb-4">Applied when a page has no SEO data of its own.</p>
      {fields.map(([k, label]) => (
        <Row key={k}>
          <label className="text-xs text-charcoal-muted w-48">{label}</label>
          <input className={`${input} flex-1 min-w-[220px]`} value={draft[k] ?? ''} disabled={disabled} onChange={e => setDraft({ ...draft, [k]: e.target.value })} />
        </Row>
      ))}
      <SaveBar onSave={() => onSave(draft)} busy={busy} disabled={disabled} />
    </>
  );
}

function RedirectEditor({ value, onSave, busy, disabled }: { value: Record<string, unknown>; onSave: (v: unknown) => void; busy: boolean; disabled: boolean }) {
  const [rules, setRules] = useState<{ from: string; to: string; permanent?: boolean; enabled?: boolean }[]>(Array.isArray(value.rules) ? (value.rules as never) : []);
  useEffect(() => setRules(Array.isArray(value.rules) ? (value.rules as never) : []), [value]);
  return (
    <>
      <p className="text-xs text-charcoal-muted mb-4">Retired URLs. <code>from</code> must start with <code>/</code>; end it with <code>*</code> to catch a prefix.</p>
      {rules.map((r, i) => (
        <Row key={i}>
          <input className={`${input} w-56`} placeholder="/old-url" value={r.from} disabled={disabled} onChange={e => setRules(rules.map((x, j) => j === i ? { ...x, from: e.target.value } : x))} />
          <span className="text-charcoal-muted">→</span>
          <input className={`${input} flex-1 min-w-[180px]`} placeholder="/new-url" value={r.to} disabled={disabled} onChange={e => setRules(rules.map((x, j) => j === i ? { ...x, to: e.target.value } : x))} />
          <label className="text-xs text-charcoal-muted flex items-center gap-1"><input type="checkbox" checked={r.permanent !== false} disabled={disabled} onChange={e => setRules(rules.map((x, j) => j === i ? { ...x, permanent: e.target.checked } : x))} /> 301</label>
          <label className="text-xs text-charcoal-muted flex items-center gap-1"><input type="checkbox" checked={r.enabled !== false} disabled={disabled} onChange={e => setRules(rules.map((x, j) => j === i ? { ...x, enabled: e.target.checked } : x))} /> live</label>
          <button className="p-1.5 text-charcoal-muted hover:text-red-600" disabled={disabled} aria-label="Remove rule" onClick={() => setRules(rules.filter((_, j) => j !== i))}><Trash2 size={13} /></button>
        </Row>
      ))}
      <Btn variant="ghost" disabled={disabled} icon={<Plus size={13} />} onClick={() => setRules([...rules, { from: '/', to: '/', permanent: true, enabled: true }])}>Add rule</Btn>
      <SaveBar onSave={() => onSave({ rules: rules.filter(r => r.from.startsWith('/') && r.to) })} busy={busy} disabled={disabled} />
    </>
  );
}

function FlagsEditor({ value, onSave, busy, disabled }: { value: Record<string, unknown>; onSave: (v: unknown) => void; busy: boolean; disabled: boolean }) {
  const keys = Array.from(new Set([...Object.keys(FLAG_LABELS), ...Object.keys(value)]));
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  useEffect(() => { const initial: Record<string, boolean> = {}; keys.forEach(k => { initial[k] = value[k] !== false; }); setFlags(initial); }, [value]);
  return (
    <>
      <p className="text-xs text-charcoal-muted mb-4">Switches the public site reads before rendering a feature. Off means the component never loads.</p>
      {keys.map(k => (
        <Row key={k}>
          <label className="flex items-center gap-2 text-sm text-charcoal w-64">
            <input type="checkbox" checked={flags[k] !== false} disabled={disabled} onChange={e => setFlags({ ...flags, [k]: e.target.checked })} />
            {FLAG_LABELS[k] || k}
          </label>
          <span className="text-[11px] text-charcoal-muted font-mono">{k}</span>
        </Row>
      ))}
      <SaveBar onSave={() => onSave(flags)} busy={busy} disabled={disabled} />
    </>
  );
}

function SimpleForm({ fields, bools, value, onSave, busy, disabled }: {
  fields: [string, string][]; bools: [string, string][];
  value: Record<string, unknown>; onSave: (v: unknown) => void; busy: boolean; disabled: boolean;
}) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  useEffect(() => {
    setDraft(Object.fromEntries(fields.map(([k]) => [k, String(value[k] ?? '')])));
    setChecks(Object.fromEntries(bools.map(([k]) => [k, value[k] === true])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <>
      {bools.map(([k, label]) => (
        <Row key={k}><label className="flex items-center gap-2 text-sm text-charcoal"><input type="checkbox" checked={checks[k] === true} disabled={disabled} onChange={e => setChecks({ ...checks, [k]: e.target.checked })} />{label}</label></Row>
      ))}
      {fields.map(([k, label]) => (
        <div key={k} className="mt-3">
          <label className="text-xs text-charcoal-muted uppercase tracking-wide">{label}
            <textarea rows={2} className={`${input} w-full mt-1 font-mono text-xs`} value={draft[k] ?? ''} disabled={disabled} onChange={e => setDraft({ ...draft, [k]: e.target.value })} />
          </label>
        </div>
      ))}
      <SaveBar onSave={() => onSave({ ...draft, ...checks })} busy={busy} disabled={disabled} />
    </>
  );
}

function JsonEditor({ value, onSave, busy, disabled, hint }: { value: Record<string, unknown>; onSave: (v: unknown) => void; busy: boolean; disabled: boolean; hint?: string }) {
  const [text, setText] = useState(JSON.stringify(value, null, 2));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setText(JSON.stringify(value, null, 2)); setError(null); }, [value]);
  return (
    <>
      {hint && <p className="text-xs text-charcoal-muted mb-3">{hint}</p>}
      <textarea rows={10} value={text} disabled={disabled} spellCheck={false} onChange={e => setText(e.target.value)}
        className="w-full border border-taupe/40 px-3 py-2 text-xs font-mono rounded-sm focus:outline-none focus:border-bronze" />
      {error && <div className="mt-2"><Notice tone="error">{error}</Notice></div>}
      <SaveBar onSave={() => {
        try { const parsed = JSON.parse(text); setError(null); onSave(parsed); }
        catch (e) { setError(e instanceof Error ? e.message : 'Invalid JSON'); }
      }} busy={busy} disabled={disabled} />
    </>
  );
}
