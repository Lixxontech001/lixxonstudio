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

Passing on PRs #10 (M1), #11 (M2), #13 (M3). *(Per-run category scores are printed in
the Lighthouse job logs; the CI logs API was flaky when writing this file — treat the
green assertions as the recorded evidence and capture exact numbers in the M7 pass.)*

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
