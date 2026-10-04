# Lixxon Studio — Theme & Color System

**Rule zero: light is the default for everyone.** Dark mode is never inferred from the OS
(`prefers-color-scheme` is deliberately ignored). A reader gets the dark theme only by
explicitly choosing it (header / mobile menu / admin toggle), and the choice is remembered.

## Single source of truth

| Layer | Role |
|---|---|
| `index.html` pre-paint script | Reads `localStorage.lixxon_theme` and sets the `.dark` class on `<html>` **before first paint** (no flash). Storage blocked → light. |
| `src/context/ThemeContext.tsx` | Owns the `theme` state, toggles the same `.dark` class, persists to `localStorage.lixxon_theme`. |
| `tailwind.config.js` | `darkMode: 'class'` — every Tailwind `dark:` utility now follows the **class**, not the OS. |
| `src/index.css` (bottom section) | The dark palette layer + the AA fixes. `.dark` on `<html>` is the only switch. |
| `scripts/contrast-audit.mjs` | Machine-checks every documented text/background pair (31 pairs, min **4.5:1**). Run: `node scripts/contrast-audit.mjs`. |

`<meta name="color-scheme" content="light dark">` is set in `index.html`, and the CSS
declares `color-scheme: light` / `.dark { color-scheme: dark }` so form controls,
scrollbars and UA widgets follow the active theme.

## Light palette (default)

| Token | Hex | Use |
|---|---|---|
| `porcelain` | `#FDFBF7` | page background |
| `ivory` / `white` | `#FFFFFF` | cards, inputs, sticky header |
| `charcoal` | `#1A1A1A` | body ink **and** fixed dark surfaces (footer, toast, scrims) |
| `charcoal-light` | `#2D2D2D` | headings-adjacent ink |
| `charcoal-muted` | `#5A5A5A` | secondary text |
| `taupe / taupe-light / taupe-dark` | `#E8DFD8 / #F2EDE7 / #D4C7BC` | sections, borders, dividers |
| `bronze` (decorative) | `#C48B71` | tints (`bg-bronze/10`), borders, rules, star fills |
| `bronze-ink` (text) | `#85543A` | `.text-bronze` on light surfaces (AA-safe) |
| `bronze-cta` (surface) | `#9C6647` | `.bg-bronze` buttons/badges with white text (AA-safe) |
| `bronze-cta-hover` | `#8A5A3E` | `.bg-bronze-dark` hover |
| `bronze-light` | `#D9A88E` | accents **on dark surfaces** (hero, toast, footer) |
| muted clamp | `#6B6560` | `.text-charcoal-muted/30-50` opacity classes are clamped to this |

## Dark palette (deliberate, fully styled)

| Token | Hex | Use |
|---|---|---|
| page | `#14110E` | body background, porcelain/ivory flip |
| card | `#1D1915` | `bg-white` surfaces flip to this |
| muted surface | `#26211B` | `bg-taupe*` surfaces flip |
| line | `#3A322A` | `border-taupe*` flip |
| ink | `#F2EDE7` | `text-charcoal` flip |
| ink-soft | `#D8CFC2` | `text-charcoal-light` flip |
| ink-muted | `#B4A99A` | `text-charcoal-muted` (+ `/opacity`) flip |
| accent | `#D9A88E` | `.text-bronze` in dark mode |
| CTA | `#9C6647` + white text | unchanged (already AA) |

The dark layer covers body, inks, surfaces, borders, shadows, skeletons, scrollbars,
article prose, forms (their `bg-white border-taupe` inputs flip with the tokens),
buttons (`.btn-outline-luxury` inverted), admin tables/cards (they use the same utilities),
and email/OG surfaces (authored light-on-dark-safe: `from-charcoal/85` scrims work over
images in both themes).

## Contrast (WCAG AA, ≥ 4.5:1 for text)

All 31 documented pairs pass `scripts/contrast-audit.mjs` (min 4.5:1), including:

- muted/bronze-on-charcoal (toast, hero, footer): **8.2:1** / **8.2:1**
- hero `text-white/80` over `from-charcoal/85` on a worst-case bright photo: **7.6:1**
- every dark-theme ink on page/card/muted surface: **6.9:1 – 16:1**
- white on CTA bronze: **4.8:1** (hover **5.8:1**)

Exempts (per WCAG 1.4.3 / 1.4.11): disabled controls (`disabled:opacity-*`), purely
decorative dividers/rules, and star-fill rating graphics (held to 3:1 as UI components).

## Where the toggle lives

- Header (desktop + mobile action bar) — Moon/Sun icon
- Mobile menu panel
- Admin sidebar ("Theme") — applies to the public-site palette behind the admin shell

State is shared everywhere via `localStorage.lixxon_theme`, so the choice follows the
reader across pages, reloads and the admin panel.

## Runtime accent (database-driven)

The accent pair is stored in `site_settings.theme` (`{ "accent": "#9C6647", "accent_text": "#85543A" }`)
and applied at runtime to the CSS variables `--accent-cta`, `--accent-cta-hover`,
`--accent-ink` and `--accent-ink-dark` (`src/index.css`, applied by
`src/components/SiteConfigEffects.tsx`). Admin → Front end → Theme edits it; the shipped
values above remain the defaults, and the on-charcoal accent is auto-lightened when a darker
accent is chosen so text stays readable.

## Maintenance rules

1. Never add `prefers-color-scheme` behavior — dark stays an explicit choice.
2. New colors must be added to `scripts/contrast-audit.mjs` **with their real pairings**.
3. Prefer the existing utility tokens; if you need a new pairing, extend the audit first.
4. The pre-paint script in `index.html` must stay tiny, synchronous and inline (it is on
   the CSP hash roadmap in `SECURITY.md`).
