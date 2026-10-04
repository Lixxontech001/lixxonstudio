#!/usr/bin/env node
/**
 * WCAG AA contrast audit for the Lixxon Studio themes (THEME.md).
 *
 * Every pair below is a real text/background combination the UI renders.
 * Run: node scripts/contrast-audit.mjs   (exit 1 = a pair fails AA 4.5:1)
 *
 * Note: disabled controls are EXEMPT from WCAG 1.4.3, so `disabled:opacity-*`
 * states are intentionally not listed. Decorative rules/dividers (1px lines,
 * star outlines) are graphics and held to 3:1 where they carry information.
 */

/** sRGB relative luminance (WCAG 2.1). */
function luminance(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`bad hex: ${hex}`);
  const n = parseInt(m[1], 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

export function contrast(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

// --- palette (mirrors tailwind.config.js + the AA/dark layers in src/index.css)
const P = {
  porcelain: '#FDFBF7',
  white: '#FFFFFF',
  charcoal: '#1A1A1A',
  charcoalLight: '#2D2D2D',
  charcoalMuted: '#5A5A5A',
  taupe: '#E8DFD8',
  taupeLight: '#F2EDE7',
  bronzeInk: '#85543A', // .text-bronze on light surfaces (index.css)
  bronzeCta: '#9C6647', // .bg-bronze (index.css)
  bronzeCtaHover: '#8A5A3E', // .bg-bronze-dark
  bronzeLight: '#D9A88E', // text-bronze-light / dark-mode accents
  mutedClamped: '#6B6560', // text-charcoal-muted/30-50 clamp (index.css)
  heroScrim: '#3C3C3C', // white photo under from-charcoal/85 overlay (worst case)
  // dark theme (index.css .dark)
  dPage: '#14110E',
  dCard: '#1D1915',
  dMuted: '#26211B',
  dInk: '#F2EDE7',
  dInkSoft: '#D8CFC2',
  dInkMuted: '#B4A99A',
};

const pairs = [
  // ---- light theme ----
  ['light', 'body ink on porcelain', P.charcoal, P.porcelain],
  ['light', 'body ink on white', P.charcoal, P.white],
  ['light', 'charcoal-light on porcelain', P.charcoalLight, P.porcelain],
  ['light', 'charcoal-muted on porcelain', P.charcoalMuted, P.porcelain],
  ['light', 'charcoal-muted on white', P.charcoalMuted, P.white],
  ['light', 'charcoal-muted on taupe-light', P.charcoalMuted, P.taupeLight],
  ['light', 'charcoal-muted on taupe', P.charcoalMuted, P.taupe],
  ['light', 'clamped muted (/30-/50) on porcelain', P.mutedClamped, P.porcelain],
  ['light', 'clamped muted (/30-/50) on white', P.mutedClamped, P.white],
  ['light', 'clamped muted (/30-/50) on taupe-light', P.mutedClamped, P.taupeLight],
  ['light', 'bronze-ink text on porcelain', P.bronzeInk, P.porcelain],
  ['light', 'bronze-ink text on white', P.bronzeInk, P.white],
  ['light', 'bronze-ink text on taupe-light', P.bronzeInk, P.taupeLight],
  ['light', 'bronze-ink text on taupe', P.bronzeInk, P.taupe],
  ['light', 'white on bronze CTA', P.white, P.bronzeCta],
  ['light', 'white on bronze CTA hover', P.white, P.bronzeCtaHover],
  ['light', 'bronze-light on charcoal (toast/hero)', P.bronzeLight, P.charcoal],
  ['light', 'white on charcoal (toast/footer)', P.white, P.charcoal],
  ['light', 'white/80 on hero scrim (worst-case bright photo)', '#D6D6D6', P.heroScrim],
  // ---- dark theme ----
  ['dark', 'ink on page', P.dInk, P.dPage],
  ['dark', 'ink on card', P.dInk, P.dCard],
  ['dark', 'ink on muted surface', P.dInk, P.dMuted],
  ['dark', 'ink-soft on page', P.dInkSoft, P.dPage],
  ['dark', 'ink-soft on card', P.dInkSoft, P.dCard],
  ['dark', 'ink-muted on page', P.dInkMuted, P.dPage],
  ['dark', 'ink-muted on card', P.dInkMuted, P.dCard],
  ['dark', 'ink-muted on muted surface', P.dInkMuted, P.dMuted],
  ['dark', 'bronze-light accent on page', P.bronzeLight, P.dPage],
  ['dark', 'bronze-light accent on card', P.bronzeLight, P.dCard],
  ['dark', 'white on bronze CTA', P.white, P.bronzeCta],
  ['dark', 'ink on charcoal (toast)', P.dInk, P.charcoal],
];

const MIN = 4.5;
let failed = 0;
const rows = pairs.map(([theme, name, fg, bg]) => {
  const ratio = contrast(fg, bg);
  const pass = ratio >= MIN;
  if (!pass) failed++;
  return `${pass ? 'PASS' : 'FAIL'}  ${ratio.toFixed(2)}:1  [${theme}] ${name}  (${fg} on ${bg})`;
});

console.log(`WCAG AA contrast audit — minimum ${MIN}:1 for text\n`);
console.log(rows.join('\n'));
console.log(`\n${pairs.length - failed}/${pairs.length} pairs pass.`);
if (failed > 0) {
  console.error(`${failed} pair(s) below ${MIN}:1 — fix src/index.css / THEME.md before shipping.`);
  process.exit(1);
}
