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

> Status: **PENDING** — filled in from the dry-run output before any write.

- Stored total: … in … object(s) across bucket(s) …
- Top 20 by size: (paste table)
- Oversized (≥1 MB): … file(s), … bytes
- Same-size duplicate suspects: … group(s); byte-verified (TASK=dedupe dry-run): …
- Reference coverage: … of … storage images referenced by exact DB path
- **Cost per page load:** home **… KB** · article **… KB** · shop **… KB**
  (method: Storage files counted whole — no srcset; Pexels covers at the w=800
  phone pick via HEAD; see script output for the per-file breakdown)
- Top requested Storage paths / user agents (last day): … (or “not visible
  from the Action token — read Supabase dashboard → Logs → Storage”)

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

Runs (times in UTC):

1. `audit` dry-run (read-only): …
2. `optimize` dry run: projected saving … (paste before/after total)
3. `optimize` LIVE: actual saving … (paste before/after total)
4. `dedupe` dry run: … spare(s) across … group(s); keeper rule …
5. `dedupe` LIVE (only if safe): deleted …

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
