# Cached-egress fix — Supabase project `jaatgiqigsmjodqgaocl`

> Bandwidth problem, not a storage problem. Nothing gets deleted except
> byte-identical duplicate spares (Phase 1, verified referenced keeper only).

- **Quota (cycle 26 Sep – 26 Oct):** Cached egress **5.23 GB of 5 GB (105%)**,
  ~19 days still to run. Uncached 0.51 GB · DB 41 MB · Storage ~45 MB · 4 users.
- **Translation:** ~45 MB of files served ~5.2 GB — the library handed out
  ~100× over, mostly crawlers/preview bots loading heavy full-size images.
- **Standing rules:** $0 · no frontend changes in Phase 1 · no AI-written prose
  · mobile-first · light theme default · never paste secrets into chat.

## Diagnosis (§2)

### Static findings (from reading the code — no Supabase access needed)

**Image pipeline.** Covers and product images live in the public Storage bucket
`media` (admin uploads via `AdminArticleEditor` / `AdminMedia` /
`AdminProductEditor`, already downscaled to ≤1600px WebP in-browser for *new*
uploads by `src/lib/imageUpload.ts`). Older objects predate that guard and are
the prime suspects. `src/lib/images.ts` normalises Pexels URLs and builds
`srcset` **only for `images.pexels.com`** — every Supabase-hosted image is
downloaded at full file size, on every viewport:

| Page | Images requested | Responsive? |
|---|---|---|
| Home | 1 hero cover (eager, 100vw) + 9 feed covers (`PAGE_SIZE`, lazy) + up to 9 shop teasers (3 digital + 6 affiliate) + avatars | Pexels covers: yes (`w=` srcset, phone ≈ 800w). **Supabase covers: no — full file** |
| Article | 1 cover (eager) + 4 related covers (lazy) + N inline markdown images + author avatars (plain `<img>`, full file) | Same split; **inline markdown images (`renderMarkdown`) and avatars never have `srcset`** |
| Shop | Product grid images, plain `<img>`, no `loading="lazy"` on the detail view | **No `srcset` anywhere in shop components** |

**Crawler multiplier.** `vercel.json` rewrites *all* bot user-agents on
`/blog/:slug` to the prerender function, whose HTML carries
`<meta property="og:image" content="<full cover URL>">`; RSS items carry
`<enclosure url="<full cover>">`. Every preview bot (link unfurlers, AI
scrapers, SEO crawlers) then downloads the **full-size** cover from Supabase —
and `public/robots.txt` currently allows every crawler except a few paths.
That is the 100× mechanism, consistent with tiny uncached egress (API JSON)
and huge cached egress (CDN-served files).

**Loop check — clean.** The service worker (`public/sw.js`, tested by
`serviceWorker.test.ts`) caches only same-origin `/assets/*` and never touches
Supabase. No image prefetching (only `preconnect`/`dns-prefetch` in
`index.html`). Polling is tiny JSON, not images: reader heartbeat every 30 s
(`heartbeat_article_reader` RPC), resume-position saves to localStorage every
4 s. The OG endpoint (`api/og.tsx`) runs on Vercel Edge with
`Cache-Control: public, max-age=86400, s-maxage=604800, …` and pulls only a
small PostgREST JSON row — zero Supabase image bytes.

### Action audit results (from `optimize-media.yml`, TASK=audit)

> Status: **AUDIT COMPLETE 2026-10-07** (run 37628617538, `audit`,
> `bucket=media`, main@051a481). Numbers below are from the job summary;
> the per-file tables live in the run logs — paste them here before any
> LIVE write.

- Stored total: **44.56 MB in 20 object(s)** across bucket(s) media
- Top 20 by size: (pending — paste the `-- top 20 by size --` table from run
  37628617538's “Run media task” log; the bucket holds exactly 20 objects,
  so this table IS the full inventory)
- Oversized (≥1 MB): **12 file(s)** (60% of all objects)
- Same-size duplicate suspects: **0 group(s)**; byte-verified
  (TASK=dedupe dry-run): still to run — expected to confirm zero
- Reference coverage: (pending — paste the `-- reference coverage --` lines
  from the run log)
- **Cost per page load:** home **26390 KB (~25.8 MB)** · article **19636 KB
  (~19.2 MB)** · shop **919 KB (~0.9 MB)**
  (method: Storage files counted whole — no srcset; Pexels covers at the w=800
  phone pick via HEAD; see script output for the per-file breakdown)
- Interpretation: 5.23 GB served ÷ ~26 MB per home-load ≈ **~200 page loads
  explain the entire cycle's cached egress**. A handful of crawlers walking
  the site + unfurling og:images accounts for the 105% quota. The library is
  served ~120× over (5.23 GB ÷ 44.56 MB).
- Top requested Storage paths / user agents (last day): (pending — paste the
  `-- storage request logs --` lines from the run log, or read Supabase
  dashboard → Logs → Storage)

## Phase 1 — optimise the media in place (this session, no frontend changes)

Manual workflow `.github/workflows/optimize-media.yml` (`scripts/optimize-media.mjs`):

- `workflow_dispatch` only · `dry_run` defaults **true** · `max_width` 1600 ·
  `quality` 82 · `task` = optimize | audit | dedupe.
- Resize-down-only, same format + extension, JPEG/WebP at quality, PNG lossless
  first with a 256-colour quantise fallback for files ≥400 KB, ≥15% saving
  required or the file is skipped, upsert to the same path with the original
  content type and `cache-control: public, max-age=31536000, immutable`
  (verified per file with a HEAD read after upload).
- GIF/SVG/AVIF/TIFF and non-images are never touched. Dedupe deletes only when
  a run is live **and** `confirm=DELETE` **and** a referenced keeper exists.

How to run (GitHub → Actions → “Optimize Storage media in place” → Run workflow,
branch `arena/f8271914-lixxonstudio`; no new secrets needed — it reuses
`SUPABASE_SECRET_KEY`, plus `SUPABASE_ACCESS_TOKEN`/`SUPABASE_PROJECT_REF` for
the optional logs peek):

0. `task=selftest`, `dry_run=true` — proves the encoder on generated images
   (no credentials needed). Sandbox result 2026-10-07: PASSED on ImageMagick
   6.9.11 (JPEG 5.69 MB→205 KB, PNG lossless 19.3→8.4 MB, quantize fallback
   10.1→3.4 MB verified separately, 400px file never upscaled).
   Runner note: the first `main` run (37561308404) failed in 19 s at the tools
   check — `ubuntu-latest` (24.04) no longer ships ImageMagick. Fixed by
   PR #38 (per-run `apt-get install imagemagick` + convert/identify version
   assertion). Re-run `selftest` on `main` to confirm green before the audit.
1. `task=audit`, `dry_run=true` (read-only): DONE 2026-10-07 (run 37628617538 —
   results in §Action audit results above; per-file tables to paste from logs).
2. `task=optimize`, `dry_run=true`: projected saving … (paste before/after total)
3. `task=optimize`, `dry_run=false` (LIVE upsert): actual saving … (paste total)
4. `task=dedupe`, `dry_run=true`: … spare(s) across … group(s); keeper rule …
5. `task=dedupe`, `dry_run=false` + `confirm=DELETE` (only if every group has a
   referenced keeper): deleted …

Run history (UTC):
- 2026-10-07 13:03, run 37625488292 (`optimize`, `dry_run=true`, main@cf32c0f):
  FAILED in <1 s at startup validation — `SUPABASE_SECRET_KEY` repository
  secret not configured. Script behaved as designed (clean error, nothing
  written). Cause confirmed by owner answers (task=optimize, secret unsure).
- 2026-10-07 13:12, run 37626646553 (`audit`, `dry_run=true`, main@cf32c0f):
  FAILED in <1 s: `Node.js detected but native WebSocket not found` — the
  workflow pinned Node 20 while supabase-js 2.117+ requires Node 22+, so
  `createClient` crashed (the secret was fine all along). Fixed by PR #39
  (`node-version: 22`), merged 13:24 UTC as 051a481. Lesson: the sandbox
  runs Node 22, the workflow ran Node 20 — engine drift hides crashes.
- 2026-10-07 ~13:30, run 37628617538 (`audit`, `dry_run=true`, main@051a481):
  SUCCESS. 44.56 MB / 20 objects, 12 oversized, 0 duplicate suspects;
  page cost home 26390 KB / article 19636 KB / shop 919 KB. Per-file tables
  still to paste from the run log.

Expect up to ~1 h of stale CDN copies after the live run; browsers refresh
on their own. **Re-check the Supabase usage page in 48 hours** and compare
daily cached egress before/after.

## Phase 2 — prevent a recurrence (planned, NOT built — frontend touches wait until after the automation build is merged)

1. **Serve evergreen images from Vercel, not Supabase.** Move stable images to
   `/public/images/` (≈100 GB/month transfer on Hobby vs Supabase's 5 GB), or
   add a mapping helper in `src/lib/images.ts` rewriting Storage URLs to local
   paths so the database doesn't change.
2. **`srcset` + `sizes` + `loading="lazy"` + explicit width/height** on every
   image (shop grid, avatars, markdown content), so a phone never downloads a
   desktop-sized file. Covers already use `SmartImage`; extend the pattern.
3. **Compress new uploads at upload time** — already done in
   `optimizeAdminImage` (≤1600px WebP in-browser); keep it and add a size
   ceiling + a warning for GIF/SVG uploads.
4. **`robots.txt`:** disallow AI/SEO scrapers (GPTBot, CCBot, Bytespider,
   PetalBot, AhrefsBot, SemrushBot, MJ12bot, …) while **keeping Googlebot**
   allowed.
5. **Egress watch on the health page:** cached/uncached usage + cycle projection
   (Supabase Management API, server-side) so a spike is visible before
   Supabase warns.

## The one thing NOT to do

Do not enable automation channels or buy anything while cached egress is near
or over quota — distribution multiplies bandwidth, so the media path must be
fixed first.
