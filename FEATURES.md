# Lixxon Studio — Features

Living inventory. Every reader-facing feature gets a line here (Milestone 4 DoD).
Statuses: **shipped** (verified this session) · **existing** (implemented in prior
sessions — depth to be re-audited against the full brief) · **documented** (spec +
setup written, not deployed) · **next** (queued for a following session).

---

## Shipped this session (Milestones 1–3)

| Feature | Where | Notes |
|---|---|---|
| Service worker v2 (offline shell + cached reads) | `public/sw.js` | Intercepts only navigations / same-origin `/assets/` / Supabase REST reads; never cross-origin; every path resolves to a real `Response`; `?reset-sw=1` escape hatch; "New version available — reload" toast; stale-chunk auto-recovery. Tests: `src/__tests__/serviceWorker.test.ts`. |
| Responsive images | `src/components/SmartImage.tsx` | `srcset`/`sizes` via Pexels `w=`, aspect-ratio (no CLS), lazy+decoding below fold, hero `fetchpriority`, branded onError placeholder + Sentry breadcrumb (`src/lib/images.ts`). |
| Image URL repair + audit | `src/lib/images.ts`, `scripts/image-audit.mjs`, migration `20261004090000_fix_image_urls.sql` | `npm run audit:images` flags Pexels page-URLs / `http://` / non-https in posts + product images (`--check` dead links, `--sql` repair). |
| Theme: light default, dark deliberate | `THEME.md`, `tailwind.config.js` (`darkMode: 'class'`), pre-paint script in `index.html` | Toggle in header, mobile menu and admin; remembered; OS preference ignored; 31/31 WCAG-AA pairs (`npm run audit:contrast`). |
| Touch-safe UI | `src/index.css` (`.hover-reveal`) | No hover-only content; hover only enhances on real pointers; keyboard `:focus-within` equivalents. Tests: `src/__tests__/touchVisibility.test.tsx`. |
| **Listen to articles (TTS)** | `src/components/TextToSpeech.tsx`, `src/hooks/useTts.ts`, `src/lib/tts.ts`, `src/lib/ttsDom.ts` | Full player: every device voice (grouped by language, name + lang + gender only when the device labels it), persisted voice/rate 0.5–2.0/pitch/volume + per-language memory (localStorage guests, `reader_tts_preferences` account sync), sentence-level highlighting with auto-scroll, click-a-paragraph-to-start, play/pause/resume/stop, prev/next sentence, skip headings, read-intro-only, sleep timer (5/15/30 min or end of article), Media Session lock-screen controls, keyboard shortcuts, ARIA live announcements, graceful degradation when no voices exist. Tests: `src/__tests__/tts.test.ts`, `src/__tests__/ttsDom.test.ts`. |

### Premium voice path (documented — needs owner decision before deployment)

The free Web-Speech path is the default and always available. A premium, consistent
voice is possible behind the `tts_premium` feature flag
(`localStorage.lixxon_feature_flags = {"tts_premium": true}`) once the owner picks a
hosted TTS provider (paid — deliberately not added):

1. **Edge function** `supabase/functions/tts-proxy` (to be created when a vendor is chosen): verifies the caller's JWT, recomputes entitlement (signed-in readers or unlock tier), proxies a *server-held* provider key (`TTS_PROVIDER_URL` / `TTS_PROVIDER_KEY` — **server-only, never `VITE_`**), enforces a timeout + response size cap, and never accepts a user-controlled voice URL (SSRF-safe).
2. **Cache**: synthesised MP3s land in the private `tts-cache` storage bucket keyed by `(article_id, voice, rate)` hash; downloads go through the existing `download-file`-style signed-URL pattern. **Paid audio is never cached by the service worker** (it is cross-origin/private and the SW rule-set explicitly ignores it).
3. **Fallback**: if the function errors, the quota is spent, or the flag is off, the player transparently uses the device Web-Speech voices — no dead ends.

---

## Phase 1 — Trust & speed basics (shipped in PR #19)

| Feature | Where | Notes |
|---|---|---|
| Offline, request-retry and route-error recovery | `src/components/NetworkStatusBanner.tsx`, `src/components/RouteErrorBoundary.tsx`, `src/lib/requestStatus.ts`, `src/App.tsx` | Global offline and exhausted-request feedback; route-scoped error recovery; skeleton-first lazy routes; article/category/search/author/tag query errors expose Retry. Tests: `src/__tests__/networkRecovery.test.tsx`, `src/__tests__/searchRecovery.test.tsx`. |

## Phase 2 — Batch 2: Search & discovery (implementation in this PR)

| Feature | Where | Notes |
|---|---|---|
| Typo-tolerant instant search | `supabase/migrations/20261004160000_search_discovery.sql` (`search_everything`), `src/hooks/useSearch.ts`, `src/components/SearchPage.tsx` | Trigram ranking (`pg_trgm`, GIN-indexed; a pure-SQL trigram fallback keeps CI honest where the extension is absent) + English FTS over title/body + tag matches. Debounced 220 ms in the hook, 350 ms instant-commit in the page, stale responses discarded, previous results kept while refreshing. Typo-proof: "niacinamid" and "retionl" both land. |
| Synonym expansion | `search_synonyms` table + `src/lib/searchQuery.ts` (`expandTerms`) | Admin-editable, seeded with 20 beauty equivalences (niacinamide≈nicotinamide≈vitamin B3, retinol≈retinal≈tretinoin, vitamin C≈ascorbic acid, SPF≈sunscreen…). Expansion runs both directions and matches multi-word phrases ("minimal wardrobe" → capsule wardrobe). The results header shows what else was searched. |
| Filters + sort + paging | `src/components/search/SearchFilters.tsx` | Type (article/product), category, author, tag, reading-time range, date range, plus relevance/newest/most-read sorting and 12-per-page paging. Desktop sticky rail, mobile bottom sheet, active-filter chips with one-tap removal; every control ≥44 px with radio/pressed semantics. |
| URL-synced search state | `src/lib/searchQuery.ts` (`parseSearchParams` / `buildSearchQuery`), `SearchPage` | `?q=&type=&cat=&author=&tag=&min=&max=&from=&to=&sort=&page=` — validated and clamped (never trusted), inverted ranges repaired, and the address bar always describes what is on screen, so searches are shareable and reload-safe. |
| Recent, saved, trending searches | `recent_searches` / `forget_searches` / `trending_searches` / `people_also_searched` RPCs, `SearchRails.tsx`, `useSavedSearches` | Recent searches come back through a fingerprint capability function (the raw history table is no longer world-readable); saved searches live locally and sync to the account when signed in; trending is a 14-day aggregate with a ≥2-search floor. |
| Knowledge cards | `matchGlossaryTerm` + `KnowledgeCard.tsx` | Searching an ingredient (including by synonym — "nicotinamide") shows the glossary definition above the results, with routes into the glossary and everything written about it. |
| Related articles in SQL | `related_posts()` + `ArticleReader.tsx` | Shared tags ×5, same category +3, **co-visit similarity** (readers who opened both, ×0.5/reader) and a small featured/editors-pick nudge; the rail labels the co-read reason ("readers of this also read it") and falls back to the in-memory scorer if the RPC is unavailable. |
| Zero-result recovery | `NoResults` in `SearchRails.tsx`, `search_history.result_count` | No dead ends: trending terms, a plain-English explanation, and every search records whether it found anything so `search_gaps()` can turn misses into a content plan (admin-only). |
| Health probe for search | `api/health.ts` | `/api/health` now also runs the typo+RPC probe and reports `search.ok`, `results`, `topHit` — the deployed search function is verifiable from any browser. |
| Tests | `src/__tests__/searchQuery.test.ts` (36), `src/__tests__/searchRecovery.test.tsx` (4), `scripts/search-assertions.sql` (54 SQL assertions, run by `scripts/db-test.py`) | Query builder, synonym expansion both directions, phrase keys, caps, URL round-trips, hostile input, filter chips; page-level loading/error/retry/empty; SQL behaviour + RLS boundaries (drafts invisible, history not world-readable, admin-only gaps, per-user saved searches). |

## Phase 2 — Batch 3: Personalisation & retention (implementation)

| Feature | Where | Notes |
|---|---|---|
| Private reading progress | `reading_progress`, `record_reading_progress()` | Fingerprint-scoped, monotonic milestones, server-clamped progress, draft/future-post rejection; only admins can read the backing table directly. |
| Continue reading + reader insights | `continue_reading()`, `reader_insights()`, `save_reading_day()` | One RPC per rail/card; unfinished-first ordering, recent-view fallback that cannot resurrect finished items, UTC daily activity, streaks, minutes and top categories. Raw reading sessions are no longer public. |
| Personalised + trending feed | `for_you_feed()` | Category/tag affinity, recency and editorial boosts; excludes already-read posts and falls back to 14-day popularity on cold start. |
| Responsive reader modules | `src/components/personal/*`, `src/hooks/usePersonalisation.ts` | Lazy homepage rails, accessible progress bars, loading/empty/error/retry states, private insights and best-effort throttled milestone sync. |
| Health + regression coverage | `api/health.ts`, `src/__tests__/personalisation.test.tsx`, `scripts/personalisation-assertions.sql` | Warning-only RPC health probe; 18 client tests; SQL assertions exercise validation, RLS, streak arithmetic, finished-post exclusion, feed reasons and limits via `scripts/db-test.py` (24 migrations). |

## Phase 2 — P0: Image weight & LCP remediation (implementation)

| Feature | Where | Notes |
|---|---|---|
| Optimised brand assets | `public/assets/images/lixxon-studio-logo.webp`, `public/icon-512.png`, `Logo.tsx`, `CheckoutPage.tsx` | 2.16 MB logo + byte-identical duplicate replaced by a 2.7 KB 2× WebP; the PWA icon remains at the same path and is under the new public-file limit. Service-worker cache version bumped for automatic asset refresh. |
| Smaller admin uploads | `src/lib/imageUpload.ts`, Admin Article Editor, Admin Media, Admin Product Editor | Raster images are downscaled to a 1600 px maximum edge and encoded as WebP quality 0.78 before Storage upload; vector and animated formats remain intact. |
| Storage originals + CI size guard | `.github/workflows/recompress-storage.yml`, `scripts/recompress-storage-images.mjs`, `scripts/public-size-budget.mjs`, `.github/workflows/ci.yml` | Manual action targets the four largest oversized Storage images and replaces them at the same object paths; the public-tree guard rejects files above 250,000 bytes. The Storage action and post-deploy Lighthouse run remain pending. |
| Upload helper regression tests | `src/__tests__/imageUpload.test.ts` | Verifies max-edge resizing, q78 WebP output, safe handling of animated/vector formats, and retaining a small original when re-encoding would increase weight. |

## Phase 1 — Trust & speed basics (shipped in PR #19)

## Existing features (prior sessions — inventory)

Present in the codebase and routed today; depth vs the brief's acceptance criteria
to be re-audited next session (M4 checklist below):

- **Discovery/personalisation**: reading streaks + badges (`ReadingStreakBadge`), personalised recommendations, time-of-day homepage modules, "Because you read X"-style rails, bookmarks, reading history, reading lists (public share links via `SharedListPage`), resume-where-you-left-off data, reader profile + taste graph (`ReaderProfilePage`).
- **Content/trust**: glossary with hover-cards (`GlossaryPage`, `useGlossary`), series with continue-where-you-left-off (`SeriesPage`, `SeriesNav`), article FAQ blocks + "Ask the editor" (`ArticleFaq`, `AskEditor`), key takeaways, product comparison, related articles, SEO (JSON-LD, OG images `/api/og`, sitemap/RSS `/api/feeds`, prerender for bots), reading time, rich reactions + ratings, polls with visualisation, comments with replies/likes/report.
- **Commerce**: shop, product detail + reviews + "shop this article", collections, cart drawer, checkout (Flutterwave), promo codes, gift cards, wishlists, orders/downloads/refunds/account pages, abandoned-cart tooling (admin + cron), PWYW hooks, recently viewed.
- **Community**: reviews + helpfulness, comments/threads, questions, polls, live reader count, feedback widget, newsletter (double opt-in, preferences page, weekly digest page).
- **Platform**: PWA manifest + offline page, keyboard shortcuts + help overlay, font-size control, cookie consent (GA consent-gated), currency selector, 404 page, health endpoint, feeds.
- **Admin (`/admin`, MFA-gated)**: dashboard, articles editor, categories, authors, comments/messages/moderation, media library, featured slots, series, glossary, content templates, polls, reviews, questions, customers, orders, refunds, gift cards, promo codes, abandoned carts, newsletter, feedback, analytics, activity log, backups, security page, site settings — see `src/admin/pages/*`.

## Next (queued)

1. **M4 audit pass**: walk the 70-feature checklist against the inventory above; close genuine gaps (mood picker, skin journal, streak milestones copy, digest *email* content, save-for-later reminders, "Explain simply"/"Go deeper" variants, synonym search, seasonal hubs, ingredient cards, patch-test warnings, bundles/subscribe-and-save/loyalty points, referrals UX, back-in-stock alerts, tip button, A/B copy tests, reader-of-the-week, co-reading state, consent testimonials, sustainability badges, accessibility statement, privacy centre (DSAR), content notes, reading comfort modes, offline reading list UX, install prompt, background sync, native share sheet, web push, multi-currency deep work, command palette, reading insights, prefetch and status page (skeleton-first route loading and offline banner/retry are covered in Phase 2 Batch 1)…). Each gap lands with tests + a FEATURES.md line.
2. **M5 admin audit**: RBAC/roles tables vs brief, audit-log depth, data explorer, SEO/growth suites, self-healing panels, intelligence digests.
3. **M6 editor audit**: block editor depth vs brief (slash commands, drag-drop, revisions diff, scheduled publishing UX…).
4. **M7 performance**: see `PERFORMANCE.md`.
5. **M8 mobile audit**: viewport matrix + Playwright.
6. **M9 security**: see `SECURITY.md`.
7. **M10 polish**: DNS/domain decision, Sentry auth token, robots/sitemap verification, email templates, monthly owner report.
