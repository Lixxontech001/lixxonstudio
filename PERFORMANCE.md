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
| `.github/workflows/perf.yml` | Real **mobile Lighthouse against production** (previews are behind Vercel Authentication), median of 3 runs, posted to the PR as a comment (updated in place, never duplicated) plus the job summary; weekly schedule for a trend line; `workflow_dispatch` for ad-hoc runs. | new workflow |
| `scripts/lhci-summary.mjs` | Turns raw LHCI JSON into the median scorecard / metrics table **plus the "what is costing points" diagnosis** (LCP element, opportunities, failing audits, heaviest resources) used in that comment. | used by `perf.yml` |

Exact Lighthouse category scores could not be captured from the coding sandbox (no
Chrome; `dl.google.com`, `storage.googleapis.com` and `cdn.playwright.dev` are blocked),
so `perf.yml` runs them on GitHub runners and publishes the numbers.

### First production Lighthouse measurement (mobile, median of 3)

Measured 2026-10-04 by `perf.yml` against `https://lixxonstudio.vercel.app/`
(run `37217733143`, artifact `lighthouse-reports`). Median of two measurements taken an
hour apart (perf 63 and 66) — run-to-run variance on a shared CDN is a few points, the
shape of the result is stable. This is the reference point for Batch 9's before/after table.

| Category | Score | Target |
|---|---|---|
| performance | **63–66** | ≥ 95 |
| accessibility | **89** | ≥ 95 |
| best-practices | **79** | ≥ 95 |
| SEO | **92** | ≥ 95 |

| Metric | Value | Target |
|---|---|---|
| FCP | 2 628–3 508 ms | — |
| **LCP** | **48 249–49 727 ms** | < 1 500 ms |
| TBT | 55–101 ms | — |
| CLS | 0.002 | < 0.05 ✅ |
| SI | 5 753–6 023 ms | — |
| TTFB | 20 ms | < 400 ms ✅ |

**Diagnosis (from the workflow's "What is costing points" block):** TTFB is 20 ms and CLS
is 0.002, so this is not an infrastructure or layout problem, and TBT under 101 ms rules
out main-thread cost. It is **image payload on the critical path**:

| Audit | Verdict |
|---|---|
| Properly size images | save **28.0 s** |
| Serve images in next-gen formats | save **10.8 s** |
| Reduce unused JavaScript | save 0.9 s |
| Minify JavaScript | save 0.15 s |

Heaviest resources transferred on the homepage — ~9 MB of pictures:

| Size | Resource |
|---|---|
| 3 370 kB | `…supabase.co/storage/v1/object/public/media/media/17…` |
| 2 213 kB | `/assets/images/Lixxon_Studio..png` — **the site logo**, served to every page from the header (`Logo.tsx`); a stray byte-identical copy `Lixxon_Studio. copy.png` sits beside it in `public/` |
| 1 743 kB | `…supabase.co/storage/v1/object/public/media/media/17…` |
| 883 kB | `…supabase.co/storage/v1/object/public/media/media/17…` |
| 841 kB | `…supabase.co/storage/v1/object/public/media/media/17…` |

Other failing audits to fold into Batch 6 (a11y/PWA) and Batch 9:

- accessibility: `aria-hidden="true"` elements contain focusable descendants; insufficient
  colour contrast; headings not sequentially descending; skip links not focusable
- best-practices: 2 third-party cookies; issues logged in the Chrome DevTools Issues panel
- SEO: one link without descriptive text

**Batch 9's first jobs, in order** (all free-tier): stop serving multi-megabyte originals —
downscale media on upload in the admin editor (canvas/`createImageBitmap`, no paid Supabase
image transforms), add a size ceiling + WebP/AVIF conversion for uploaded files, compress
or replace the logo (2.2 MB PNG → a few-kB WebP/SVG; it renders at header size, so this is
the cheapest large win on the site) and make sure the hero requests a responsive Pexels
`w=` variant; then convert the remaining audit savings (unused JS 0.9 s)
and close the four a11y findings.

`scripts/lhci-summary.mjs` prints this whole diagnosis automatically — LCP element (including
Lighthouse 12's `-insight` audits), biggest opportunities, failing audits per category and
heaviest resources — so every future scorecard arrives with its own explanation.

## Batch 2 bundle delta (search & discovery) — 2026-10-04

| Chunk | Before Batch 2 | After | Δ |
|---|---|---|---|
| `entry` (critical path) | 42.53 kB | 42.56 kB | **+0.03 kB** |
| `total-js` (all 45 chunks) | 271.23 kB | 281.21 kB | +9.98 kB (+3.7 %) |
| `admin-bundle` (lazy) | 43.39 kB | 44.48 kB | +1.09 kB (synonym editor) |
| `article-reader` (lazy) | 19.98 kB | 20.12 kB | +0.14 kB (related-posts RPC) |
| `css` | 11.44 kB | 11.67 kB | +0.23 kB |

New lazy chunks carry the feature: `SearchPage-*.js` (26.8 kB raw / ~7 kB gzip) and a
shared `useSearch-*.js` (9.6 kB raw) that only loads when the search page or an article
opens. **The critical path grew by 30 bytes**, which is the number that matters here;
the frozen budget in `scripts/size-budget.json` was refreshed to the post-Batch-2
figures so Batch 9 (LCP < 1.5 s, ≥95 everywhere) starts from a documented state and has
to win the reduction back from the total.

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
| 2026-10-04 | Batch 2 search & discovery | 42.6 kB (entry, gzip) | 130 tests; +9.98 kB total-js in lazy search chunks; critical path +30 bytes; budget refreshed |
| 2026-10-04 | First production Lighthouse baseline recorded | 42.6 kB (entry, gzip) | perf 63–66 / a11y 89 / BP 79 / SEO 92; LCP ~49 s from ~9 MB of images; TTFB 20 ms, CLS 0.002; Batch 9 fix list written |
| 2026-10-04 | Batch 3 personalisation & retention | 42.23 kB (entry, gzip) | 148 tests; 24 migrations + SQL assertions pass; entry is 0.33 kB below the 42.56 kB Phase 2 baseline; total JS gzip 285.90 kB remains within the configured +5% gate. No Lighthouse run in this local environment. |

## P0 image-weight remediation (2026-10-04)

| Asset / signal | Before | After / status |
|---|---:|---:|
| Header logo (`Lixxon_Studio..png`) | 2,264,839 bytes | Replaced by `lixxon-studio-logo.webp`, 2,716 bytes (300 × 164; WebP q78) |
| Duplicate logo | 2,264,839 bytes | Deleted; identical bytes are no longer shipped twice |
| PWA `icon-512.png` | 285,896 bytes | 114,569 bytes (palette-optimised PNG; same path and dimensions) |
| Four Supabase Storage originals (owner-provided) | 3,370 / 1,743 / 883 / 841 kB | Manual `Recompress Storage images` workflow added; execution pending its `SUPABASE_SECRET_KEY` repo secret and workflow dispatch |
| Admin raster uploads | Article editor 1600 px / q82; Media 1800 px / q82; product cover uncompressed | Shared browser downscale: max edge 1600 px, WebP quality 0.78, applied to article/media/product image uploads |
| CI public-file guard | No per-file size assertion | Every file under `public/` is now limited to 250,000 bytes |

Production Lighthouse baseline supplied for this work: performance 63–66, LCP 48–50 s,
TTFB 20 ms, CLS 0.002. The production after-run is pending the Storage workflow and
Vercel deployment; run `.github/workflows/perf.yml` against production before publishing
a new Lighthouse number. The local source assets above save 4,698,289 bytes combined;
that byte reduction is not a substitute for the production Lighthouse measurement.
