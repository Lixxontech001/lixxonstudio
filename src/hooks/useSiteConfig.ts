import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

/**
 * The storefront's copy of the public `site_settings` rows.
 *
 * One `site_config()` round trip per page load (module-cached), so header, footer, homepage
 * order, theme, SEO defaults, redirects and the custom <head> block all come from the
 * database — an owner edits them in Admin → Front end and the site changes without a deploy.
 *
 * `site_config()` needs migration 20261004203000; if it is not deployed yet we fall back to
 * the old `site_settings` select so nothing breaks.
 */
export interface SiteConfig {
  nav_menu?: { items?: { label: string; href: string; children?: { label: string; href: string }[] }[] };
  footer?: { columns?: { title: string; links: { label: string; href: string }[] }[]; note?: string };
  homepage?: { sections?: { id: string; enabled: boolean }[] };
  theme?: { accent?: string; accent_text?: string };
  seo_defaults?: { title_suffix?: string; description?: string; og_image?: string; robots?: string; twitter?: string };
  redirects?: { rules?: { from: string; to: string; permanent?: boolean; enabled?: boolean }[] };
  custom_head?: { html?: string };
  flags?: Record<string, boolean>;
  announcement?: { enabled?: boolean; text?: string; link?: string; link_label?: string };
  maintenance?: { enabled?: boolean; message?: string };
  [key: string]: unknown;
}

let cache: SiteConfig | null = null;
let inflight: Promise<SiteConfig> | null = null;

export function loadSiteConfig(force = false): Promise<SiteConfig> {
  if (cache && !force) return Promise.resolve(cache);
  if (inflight) return inflight;
  inflight = (async () => {
    const { data, error } = await supabase.rpc('site_config');
    if (!error && data && typeof data === 'object') {
      cache = data as SiteConfig;
      return cache;
    }
    const { data: fallback } = await supabase.from('site_settings').select('key, value').eq('is_public', true);
    const map: SiteConfig = {};
    (fallback || []).forEach((r: { key: string; value: unknown }) => { (map as Record<string, unknown>)[r.key] = r.value; });
    cache = map;
    return map;
  })().finally(() => { inflight = null; });
  return inflight;
}

/** Clear the module cache (used by the admin editor after a save). */
export function invalidateSiteConfig() { cache = null; }

export function useSiteConfig(): { config: SiteConfig; loading: boolean; reload: () => void } {
  const [config, setConfig] = useState<SiteConfig>(cache || {});
  const [loading, setLoading] = useState(!cache);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let on = true;
    setLoading(true);
    loadSiteConfig(nonce > 0).then(c => { if (on) { setConfig(c); setLoading(false); } });
    return () => { on = false; };
  }, [nonce]);

  return { config, loading, reload: () => { invalidateSiteConfig(); setNonce(n => n + 1); } };
}

/** Which homepage sections to render, in the order the database says. */
export function enabledSections(config: SiteConfig): string[] {
  const sections = config.homepage?.sections;
  if (!Array.isArray(sections) || sections.length === 0) {
    return ['hero', 'trending', 'editors_picks', 'for_you', 'latest', 'shop', 'newsletter'];
  }
  return sections.filter(s => s.enabled !== false).map(s => s.id);
}

/** Simple `:param`-free redirect match: exact path, or a prefix when the rule ends with `*`. */
export function matchRedirect(config: SiteConfig, path: string): { to: string; permanent: boolean } | null {
  const rules = config.redirects?.rules;
  if (!Array.isArray(rules)) return null;
  for (const rule of rules) {
    if (!rule || rule.enabled === false) continue;
    const from = String(rule.from || '');
    if (!from) continue;
    if (from.endsWith('*') && path.startsWith(from.slice(0, -1))) {
      const rest = path.slice(from.length - 1);
      return { to: `${String(rule.to).replace(/\/$/, '')}/${rest.replace(/^\//, '')}`, permanent: Boolean(rule.permanent) };
    }
    if (from === path) return { to: rule.to, permanent: Boolean(rule.permanent) };
  }
  return null;
}

/**
 * Minimal sanitiser for the custom <head> block. It is written by an owner (or someone with
 * `settings.frontend`) and is inserted with `dangerouslySetInnerHTML`, so strip the obvious
 * script/event-handler/`javascript:` vectors as defence in depth. The database column itself
 * is only writable through `admin_set_setting()`, which requires that capability.
 */
export function sanitizeHeadHtml(html: string): string {
  if (!html) return '';
  let out = html;
  out = out.replace(/<\s*(script|iframe|object|embed|link|meta\s+http-equiv)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '');
  out = out.replace(/<\s*(script|iframe|object|embed)[^>]*\/?>/gi, '');
  out = out.replace(/<link\b[^>]*>/gi, '');
  out = out.replace(/<meta\b(?![^>]*charset)[^>]*>/gi, '');
  out = out.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  out = out.replace(/(href|src)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '$1=$2#$2');
  return out;
}
