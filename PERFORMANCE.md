# Performance — Lixxon Studio

Targets (mobile 4G): **LCP < 1.5 s · INP < 150 ms · CLS < 0.05 · TTFB < 400 ms · Lighthouse ≥ 95 (all categories)**.
Method: measure → fix → record. Budgets fail CI on regressions.

## CI budgets (enforced)

`lhci autorun` on every PR (`.github/workflows/ci.yml`, static `dist/` run):

| Assertion | Threshold | Mode |
|---|---|---|
| performance | ≥ 0.85 | warn |
| accessibility | ≥ 0.90 | error |
| best-practices | ≥ 0.90 | warn |
| seo | ≥ 0.90 | error |

Passing on PRs #10 (M1), #11 (M2), #13 (M3) and #19 (Batch 1). Exact per-run category
scores are now published by `.github/workflows/perf.yml` as a PR comment instead of
living only in job logs.

Plus, from the Batch 2 baseline onwards:

| Assertion | Threshold | Mode |
|---|---|---|
| bundle size, per chunk + totals (`node scripts/size-budget.mjs`) | baseline + 5 % | error |

## Baseline — Phase 2, before Batch 2 (2026-10-04, `main` = `02f0ef16`)

Recorded before any Phase 2 feature work so every later batch is measured against a
real number, not a memory.

**Production health** (`/api/health`, anon key, via the deployment):

| Field | Value |
|---|---|
| `ok` | `true` |
| `resolved.urlFrom` / `urlHost` | `VITE_PUBLIC_SUPABASE_URL` → `jaatgiqigsmjodqgaocl.supabase.co` |
| `resolved.keyFrom` / `keyKind` | `VITE_PUBLIC_SUPABASE_ANON_KEY` → anon (legacy JWT, `role=anon`) |
| `rest.status` / `rest.contentRange` | `206` / `0-0/71` |
| `homepageQuery.publishedCount` | `71` |
| server-only names present | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY` |
| sentry names present | `SENTRY_DSN`, `SENTRY_AUTH_TOKEN` |

`/version.json` → `{ "buildId": "02f0ef165f6f0039fd95e13952b7bffaf7ec4897" }` = `main` HEAD ✅

**Tests / gates:** `npm test` → **93 passed (14 files)** · `npm run typecheck` · `npm run lint` · `npx vite build` all green. CI Lighthouse assertions on PR #19: perf ≥ 0.85 (warn), a11y ≥ 0.90 (error), best-practices ≥ 0.90 (warn), SEO ≥ 0.90 (error) — all passed.

**Bundle sizes (gzip, production build, recorded as the frozen budget in `scripts/size-budget.json`):**

| Chunk | Gzip |
|---|---|
| `total-js` | 271.2 kB |
| `react-vendor` | 44.3 kB |
| `admin-bundle` (lazy, not in entry) | 43.4 kB |
| `entry` | 42.5 kB |
| `supabase` | 33.2 kB |
| `article-reader` (lazy) | 20.0 kB |
| `css` | 11.4 kB |
| `icons` | 9.6 kB |
| `sanitize` | 8.9 kB |
| `helmet` | 6.0 kB |
| `vercel-analytics` | 1.2 kB |
| `markdown` | 1.2 kB |

Raw totals: 984.3 kB JS / 61.6 kB CSS across 43 chunks (every route is split; the entry
never contains admin or reader code).

### Measurement tooling added with this baseline

| Tool | What it does | Where |
|---|---|---|
| `scripts/size-budget.mjs` | Gzip budget per chunk; **fails CI** when any chunk grows past baseline + 5 %. `--update` rewrites the baseline (owner-approved only). | `ci.yml` → `build` job, after `npm run build` |
| `.github/workflows/perf.yml` | Real **mobile Lighthouse against production** (previews are behind Vercel Authentication), median of 3 runs, posted to the PR as a comment plus the job summary; weekly schedule for a trend line; `workflow_dispatch` for ad-hoc runs. | new workflow |
| `scripts/lhci-summary.mjs` | Turns raw LHCI JSON into the median scorecard / metrics table used in that comment. | used by `perf.yml` |

Exact Lighthouse category scores could not be captured from the coding sandbox (no
Chrome; `dl.google.com`, `storage.googleapis.com` and `cdn.playwright.dev` are blocked),
so `perf.yml` runs them on GitHub runners and publishes the numbers. The first
production measurement is attached to the Batch 2 PR and is the reference point for
Batch 9's before/after table.

## Bundle sizes — before/after this session (production build, vite 5)

| Chunk | Start of session (post-M1) | End of session (post-M3) | Δ |
|---|---|---|---|
| entry `index-*.js` | 159.2 kB (39.1 kB gz) | 161.1 kB (39.9 kB gz) | +1.9 kB (chunkRecovery, images helpers, theme script) |
| `react-vendor` | 141.5 kB (45.5 kB gz) | unchanged | — |
| `supabase` | 124.1 kB (34.1 kB gz) | unchanged | — |
| `AdminApp` (lazy, not in entry) | 222.5 kB (44.6 kB gz) | 222.9 kB (44.7 kB gz) | +0.4 kB |
| `ArticleReader` (lazy) | 60.6 kB (15.7 kB gz) | 60.5 kB (15.7 kB gz) | − (TTS engine lives in shared `tts`/`ttsDom` chunks) |

Admin code is already **excluded from the public entry chunk** (lazy `/admin` route).

## Already in place (verified this session)

- **Images**: `SmartImage` renders `srcset`/`sizes` (Pexels `w=400/800/1200/1600`),
  explicit `aspect-ratio` (no CLS from images), `loading=lazy` + `decoding=async`
  below the fold, `fetchpriority=high` on the hero only, `preconnect` +
  `dns-prefetch` for Pexels and the Supabase host.
- **Service worker**: cache-first immutable `/assets/*`, network-first with cache
  fallback for Supabase reads + navigations; `no-store`/206 never cached; cross-origin
  never touched (no SW interference with third-party images).
- **Analytics off the critical path**: GA is consent-gated (not downloaded until
  accept); Sentry SDK is a dynamic import, only fetched when a DSN exists.
- **Stale-chunk resilience**: `lazyWithRetry` self-heals deploy skew with one
  loop-guarded reload (no white screens after deploys).
- **Chrome**: no render-blocking third parties except Google Fonts (see below);
  `lazy()` route splitting throughout; skeleton-first fallbacks for lazy routes.

## Owed in the Milestone 7 pass (next session)

1. **Measure properly**: LHCI mobile emulation/4G throttling runs + Web Vitals
   (LCP/INP/CLS) wired to Sentry (`tracesSampleRate` kept low for the free tier);
   record per-route numbers in this file.
2. **Fonts**: self-host Playfair Display + Inter (or `font-display: swap` + preload
   the two used weights) and drop the Google Fonts round-trip; inline critical CSS.
3. **Sentry init after first paint** (move `initMonitoring()` behind
   `requestIdleCallback`/load), keep GA consent-gated as-is.
4. **HTTP**: `s-maxage` + `stale-while-revalidate` on `/api/*` (with a service-worker
   CACHE bump + test update to intercept `/api/*` GETs — Appendix C change note),
   verify Brotli + HTTP/2 on Vercel, immutable caching already set for `/assets/*`.
5. **DB**: indexes `posts(status, published_at desc)`, `comments(post_id, created_at)`,
   `products(slug)`, `product_clicks`, `article_views`; replace remaining
   `select('*')` on hot paths with explicit columns; `head: true` counts; cache
   aggregates in materialised views refreshed by `pg_cron`.
6. **Budgets in CI**: fail the build if the entry chunk or total JS grows past the
   documented thresholds above (add `size-limit` or a bytes check script).
7. **Route prefetch** on hover/viewport + verify every remote image has dimensions.

## Change log

| Date | Change | Entry gz | Notes |
|---|---|---|---|
| 2026-10-04 | Session start (M1 SW/images/health) | 39.1 kB | baseline above |
| 2026-10-04 | M2 theme/hover/SmartImage | 40.0 kB | SmartImage + theme CSS layer |
| 2026-10-04 | M3 TTS player | 39.9 kB | engine split into lazy article chunk |
| 2026-10-04 | Batch 1 merged (#19) — **Phase 2 baseline recorded** | 42.5 kB (entry, gzip) | 93 tests; size budget + production Lighthouse workflow added; budget JSON frozen |
