import { useEffect } from 'react';
import { useNavigation } from '../context/NavigationContext';
import { useSiteConfig, matchRedirect, sanitizeHeadHtml, type SiteConfig } from '../hooks/useSiteConfig';

const HEAD_ELEMENT_ID = 'lixxon-custom-head';

/** #RRGGBB → r,g,b (null when the value is not a hex colour). */
function parseHex(hex: string | undefined): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const hex = (rgb: [number, number, number]) => `#${rgb.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
/** Relative luminance (WCAG) — used to pick an on-brand accent that still reads on charcoal. */
function luminance(rgb: [number, number, number]) {
  const [r, g, b] = rgb.map(v => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function lighten(rgb: [number, number, number], amount: number): [number, number, number] {
  return rgb.map(v => v + (255 - v) * amount) as [number, number, number];
}

/**
 * Applies the database-driven front-end configuration to the live document:
 * theme accent (CSS variables), custom <head> markup, redirect rules and the
 * document language/title suffix defaults.
 *
 * Everything degrades to the shipped behaviour when the settings row is missing,
 * so the site renders exactly as before on a fresh install.
 */
export default function SiteConfigEffects() {
  const { config } = useSiteConfig();
  const { route } = useNavigation();

  useAccent(config);
  useCustomHead(config);
  useRedirects(config, route);

  return null;
}

function useAccent(config: SiteConfig) {
  const accent = config.theme?.accent;
  const accentText = config.theme?.accent_text;
  useEffect(() => {
    const root = document.documentElement;
    const base = parseHex(accent);
    const ink = parseHex(accentText);
    if (!base) { root.style.removeProperty('--accent-cta'); root.style.removeProperty('--accent-cta-hover'); }
    else {
      root.style.setProperty('--accent-cta', hex(base));
      root.style.setProperty('--accent-cta-hover', hex(ink || base));
    }
    if (!ink) { root.style.removeProperty('--accent-ink'); root.style.removeProperty('--accent-ink-dark'); }
    else {
      root.style.setProperty('--accent-ink', hex(ink));
      // On charcoal surfaces the accent text must stay light enough to read.
      const onDark = luminance(ink) < 0.18 ? lighten(ink, 0.55) : ink;
      root.style.setProperty('--accent-ink-dark', hex(onDark));
    }
  }, [accent, accentText]);
}

function useCustomHead(config: SiteConfig) {
  const html = config.custom_head?.html;
  useEffect(() => {
    const clean = sanitizeHeadHtml(String(html || '')).trim();
    let holder = document.getElementById(HEAD_ELEMENT_ID);
    if (!clean) { holder?.remove(); return; }
    if (!holder) {
      holder = document.createElement('div');
      holder.id = HEAD_ELEMENT_ID;
      holder.hidden = true;
      holder.setAttribute('data-source', 'site_settings.custom_head');
      document.head.appendChild(holder);
    }
    // Rendered inside a detached node: the browser strips <script> from innerHTML,
    // on* handlers and javascript: URLs are removed by the sanitiser above.
    holder.innerHTML = clean;
    return () => { document.getElementById(HEAD_ELEMENT_ID)?.remove(); };
  }, [html]);
}

function useRedirects(config: SiteConfig, route: { name: string }) {
  const rules = JSON.stringify(config.redirects?.rules || []);
  useEffect(() => {
    const path = `${window.location.pathname}${window.location.search}`;
    if (window.location.pathname.startsWith('/admin')) return;  // never redirect the panel
    const hit = matchRedirect(config, window.location.pathname);
    if (!hit || hit.to === path) return;
    window.location.replace(hit.to);                            // retired URL → canonical one
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rules, route.name]);
}
