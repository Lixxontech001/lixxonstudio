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
| Storage originals + CI size guard | `.github/workflows/recompress-storage.yml`, `scripts/recompress-storage-images.mjs`, `scripts/public-size-budget.mjs`, `.github/workflows/ci.yml` | Manual action targets the four largest oversized Storage images and replaces them at the same object paths; the public-tree guard rejects files above 250,000 bytes. Production reports merged image build `edb4176`; an interim 3-run LCP median is recorded in `PERFORMANCE.md` (37,683 ms, while score fell to 61). Storage recompression and the final post-storage measure remain pending because Actions dispatch returns HTTP 403; `SUPABASE_SECRET_KEY` presence is unconfirmed. |
| Upload helper regression tests | `src/__tests__/imageUpload.test.ts` | Verifies max-edge resizing, q78 WebP output, safe handling of animated/vector formats, and retaining a small original when re-encoding would increase weight. |

## Phase 2 — P0: Scheduled job reliability (shipped in PR #26)

| Feature | Where | Notes |
|---|---|---|
| Supabase-native email and FX schedules | `supabase/migrations/20261004183000_pg_net_cron_jobs.sql`, `.github/workflows/deploy-supabase.yml` | Email queue runs every 20 minutes and FX refresh daily through pg_cron + pg_net. The internal URL and authorization are stored in Supabase Vault via parameterized Management API calls, never in `VITE_` variables. |
| Existing keep-alive + manual recovery | `20261003130000_platform_v3_features.sql`, `.github/workflows/cron.yml` | The existing six-hour `keep_alive` schedule was retained, not duplicated. GitHub scheduled/push triggers were removed; the workflow is manual-only. Main deploy run `37225767566` passed Vault setup, one-time email drain, two-job/one-keep-alive verification, and the `cron.job_run_details` query. |

## Phase 2 — Batch 4: Community & social proof (shipped in PR #28)

| Feature | Where | Notes |
|---|---|---|
| Privacy-safe co-reading count | `heartbeat_article_reader()`, `LiveReaderCount.tsx`, `useLiveReaderCount()` | Public clients can heartbeat only for published posts and receive an aggregate count. Raw fingerprints are no longer directly readable/writable by anon; stale rows are pruned per active post. The UI only shows counts of two or more and uses an accessible status announcement. Covered by `community-assertions.sql` and `liveReaderCount.test.tsx`; main deploy run `37226971258` passed and production build `e975cdf` is healthy. |
| Deferred community proof | `FEATURES.md` backlog | Reader-of-the-week and consent-based testimonials remain queued; no reader identity or testimonial is surfaced without an explicit consent/moderation path. |

## Phase 2 — Batch 5: Commerce & loyalty (implementation; deployment pending)

| Feature | Where | Notes |
|---|---|---|
| One-time back-in-stock email alert | `StockNotice`, `restock_notify`, `enqueue_product_restock_emails()`, `send-emails` | Adds explicit opt-in and server-side availability validation; a stock transition queues one private email, delivered by the existing scheduled worker and daily cap. Stale/unconsented alerts are skipped; failed email rows can be retried on a later restock. Covered by `stockNotice.test.tsx` and `commerce-assertions.sql`. |
| Deferred loyalty/commercial rules | `FEATURES.md` backlog | Points/redemption value, subscriptions, and referral incentives remain deferred until the owner sets clear value, billing, and fraud rules. Existing product bundles remain shipped. |

## Phase 1 — Trust & speed basics (shipped in PR #19)

## Existing features (prior sessions — inventory)

Present in the codebase and routed today; depth vs the brief's acceptance criteria
to be re-audited next session (M4 checklist below):

- **Discovery/personalisation**: reading streaks + badges (`ReadingStreakBadge`), personalised recommendations, time-of-day homepage modules, "Because you read X"-style rails, bookmarks, reading history, reading lists (public share links via `SharedListPage`), resume-where-you-left-off data, reader profile + taste graph (`ReaderProfilePage`).
- **Content/trust**: glossary with hover-cards (`GlossaryPage`, `useGlossary`), series with continue-where-you-left-off (`SeriesPage`, `SeriesNav`), article FAQ blocks + "Ask the editor" (`ArticleFaq`, `AskEditor`), key takeaways, product comparison, related articles, SEO (JSON-LD, OG images `/api/og`, sitemap/RSS `/api/feeds`, prerender for bots), reading time, rich reactions + ratings, polls with visualisation, comments with replies/likes/report.
- **Commerce**: shop, product detail + reviews + "shop this article", product bundles, collections, cart drawer, checkout (Flutterwave), promo codes, gift cards, wishlists, orders/downloads/refunds/account pages, abandoned-cart tooling (admin + cron), PWYW hooks, one-time back-in-stock email alerts, recently viewed.
- **Community**: reviews + helpfulness, comments/threads, questions, polls, privacy-safe aggregate live reader count, feedback widget, newsletter (double opt-in, preferences page, weekly digest page).
- **Platform**: PWA manifest + offline page, keyboard shortcuts + help overlay, font-size control, cookie consent (GA consent-gated), currency selector, 404 page, health endpoint, feeds.
- **Admin (`/admin`, MFA-gated)**: dashboard, articles editor, categories, authors, comments/messages/moderation, media library, featured slots, series, glossary, content templates, polls, reviews, questions, customers, orders, refunds, gift cards, promo codes, abandoned carts, newsletter, feedback, analytics, activity log, backups, security page, site settings — see `src/admin/pages/*`.

## M7 — Editors, autonomous settings, Admin AI and security

| Area | Where | Delivery |
|---|---|---|
| Shared editorial kit | `src/admin/components/AdminEditorKit.tsx` | Markdown toolbar, slash commands, preview, find/replace, character counts, quality score ring and reusable long-form fields now power the article, product, collection, template, glossary, category, series and author editors. Product and collection copy renders through the sanitised Markdown renderer without changing the existing field/section semantics. |
| Product quality workflow | `20261004210000_editor_workflow.sql`, `AdminProductEditor.tsx` | Product scoring, compare-at pricing, SEO/social fields, robots/schema controls, cover media picker, database-persisted quality score and the same quality panel used by articles. |
| Autonomous front end | `AdminFrontend.tsx`, `20261004203000_admin_frontend_settings.sql` | Homepage ordering, navigation, footer, theme, SEO defaults, redirects, custom head, flags, announcements and maintenance are validated database settings, audited and live without a deploy. |
| Admin AI control room | `20261004220000_admin_ai.sql`, `AdminAI.tsx` | Live health/growth scan, durable suggestions, safe low-risk automation, workflow proposals for approve/publish/reject/edit, reply drafts, approval/dismissal queue and separate AI capabilities. High-impact actions remain human-approved. |
| Security hardening v2 | `20261004230000_security_hardening_v2.sql` | Removes anonymous update/delete holes, replaces fingerprint mutations with validated RPCs, adds abandoned-cart uniqueness, capability-gates storage writes and sanitises custom head settings. |

## M8 — Admin AI Autopilot OS

| Area | Where | Delivery |
|---|---|---|
| Agent fleet | `20261004240000_admin_ai_autopilot.sql`, `AdminAI.tsx` | Growth, SEO, content, commerce, community, reliability and security agents with independent cadence, action caps, autonomy levels and live run controls. |
| Autonomous policy | same | Global enable switch, provider mode, daily budget, default autonomy and emergency kill switch. Rules engine works on free tiers; model-backed generation remains edge-function-only and proposal-only. |
| Missions and workflows | same | Owner-defined growth objectives, metrics, priorities, deadlines, agent teams, workflow steps, manual runs, durable jobs and idempotency. |
| Action queue | same | Risk-labelled proposals with required capability, diffs, approval/reject/pause/apply decisions, safe auto-apply allow-list and failure tracking. |
| Memory and learning loop | same | Durable brand/editorial/SEO/commerce/community memory, experiments with variants and conversion events, AI metrics, cost ledger and notifications. |
| Incident safety | same | Security/reliability incidents, acknowledgement/resolution, pause semantics and full audit coverage across AI objects. |

## M5 — Admin super panel (shipped in this PR)

RBAC-first, with the database as the single source of truth (`docs/ADMIN.md`).

| Feature | Where | Notes |
|---|---|---|
| Capability model (34 permissions, roles as rows, per-admin grants/denies) | `supabase/migrations/20261004200000_admin_rbac.sql` | `admin_can()` is the one authority: every RLS policy, RPC and screen goes through it. Seeded roles owner / editor / moderator / analyst / support, plus custom roles created from the panel. |
| **Ultra-super-admin** | same | The original owner account (`is_founder`) holds everything, cannot be suspended, demoted or deleted, and only it can transfer the flag (`admin_transfer_founder`). Triggers keep at least one active owner (`trg_admin_guard_last_owner`) and protect the founder (`trg_admin_protect_founder`). |
| Team & access screen | `src/admin/pages/AdminAccess.tsx` | Add/update admins by email, change roles, suspend/restore, remove, force a re-login, edit the role→permission matrix, create roles, and set per-admin grant/deny overrides. |
| Audit trail v2 | migration `20261004201000`, `src/admin/pages/AdminActivityLog.tsx` | Field-level before/after diffs with actor, role, IP, user-agent, severity and source; 43 tables trigger-audited; searchable (free text + entity/action/severity/actor/date); one-click revert for 19 tables (refuses when the row moved on); 180-day retention job. |
| Data explorer | migration `20261004202000`, `src/admin/pages/AdminDataExplorer.tsx` | Browse/insert/update/delete any explorable table through PostgREST **as the signed-in admin** (RLS does the enforcement), column-aware editors, CSV export, PII/money badges, read-only for money and team rows. |
| Read-only SQL console | `admin_run_sql()` | `data.sql` permission; single `SELECT`/`WITH`, keyword + function denylist, 5 s timeout, read-only transaction, 200-row cap, runs under the caller's RLS. |
| Health & issues, self-healing | `admin_run_checks()`, `admin_fix_issue()`, `src/admin/pages/AdminHealth.tsx` | ~28 checks (database, security, queue, commerce, content, moderation, search, backups, cron) with severity, suggestion and snapshot trend; safe one-click repairs (`requeue_email`, `repair_images`, `backfill_seo`, `backfill_entitlements`, `take_backup`, `prune_audit`, `analyze`). |
| Advisor | `admin_suggestions()`, `src/admin/pages/AdminAdvisor.tsx` | Scored, permission-aware suggestions computed from live rows (impact, effort, route, optional fix). |
| Growth & SEO suite | `admin_growth_report()`, `src/admin/pages/AdminGrowth.tsx` | Traffic with previous-period deltas, content pipeline + SEO gaps, search demand and zero-result briefs, audience and commerce — all in one 7/30/90/180/365-day report. |
| Scaling view | `admin_system_metrics()` | Database size vs free-tier limit, cache hit ratio, connections, largest tables, dead tuples, never-used indexes. |
| Front end edited from the database | migration `20261004203000`, `src/admin/pages/AdminFrontend.tsx`, `src/hooks/useSiteConfig.ts` | `site_settings` drives nav menu, footer columns + note, homepage section order/visibility, theme accent pair, SEO defaults, redirects, custom `<head>` (sanitised), feature flags, announcement and maintenance. Writes go through `admin_set_setting()` (validated, permission-checked, audited); the storefront reads it all in one `site_config()` call. |
| UI mirrors the database | `src/admin/permissions.ts`, `AuthContext.tsx` | `admin_me()` returns the effective permission list; nav and routes are gated by `can(permission)`, and a role with no `commerce.read` never even issues the orders query. |

## Next (queued)

1. **M4 audit pass**: walk the 70-feature checklist against the inventory above; close genuine gaps (mood picker, skin journal, streak milestones copy, digest *email* content, save-for-later reminders, "Explain simply"/"Go deeper" variants, synonym search, seasonal hubs, ingredient cards, patch-test warnings, subscribe-and-save/loyalty points, referrals UX, tip button, A/B copy tests, reader-of-the-week, consent testimonials, sustainability badges, accessibility statement, privacy centre (DSAR), content notes, reading comfort modes, offline reading list UX, install prompt, background sync, native share sheet, web push, multi-currency deep work, command palette, reading insights, prefetch and status page (skeleton-first route loading and offline banner/retry are covered in Phase 2 Batch 1)…). Each gap lands with tests + a FEATURES.md line.
2. ~~**M5 admin audit**~~ — shipped (see the section above); follow-ups: alert emails for critical checks and monthly owner digests (M9).
3. **M6 editor audit**: block editor depth vs brief (slash commands, drag-drop, revisions diff, scheduled publishing UX…).
4. **M7 performance**: see `PERFORMANCE.md`.
5. **M8 mobile audit**: viewport matrix + Playwright.
6. **M9 security**: see `SECURITY.md`.
7. **M10 polish**: DNS/domain decision, Sentry auth token, robots/sitemap verification, email templates, monthly owner report.
