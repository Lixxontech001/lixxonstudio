# Public image egress reduction

Date: 2026-10-10

## Baseline and scope

Work is based on current `origin/main`, `bce574ca113db9a7ea942f0d6134fde00afc7982`, which already includes Buddy PR #43. Arena requires the session branch `arena/31fbd2ca-lixxonstudio`; it was not a stale baseline. No Buddy, doors, minds, Takeover, WhatsApp, upload, database, or Storage policy changes. No media library copied into Git and no paid image CDN added.

## Implementation

- `src/lib/publicMedia.ts`: pure, explicitly project-scoped URL rewrite and shared path validation. Only the exact configured HTTPS origin's public object/render-image URLs qualify. Other hosts, signed/authenticated URLs, traversal (including encoded/nested encoding), empty segments, backslashes and malformed encoding are not proxied. Ineligible URLs remain unchanged.
- `displayImageUrl` layers the rewrite over existing Pexels normalization; `normalizeImageUrl` itself remains unchanged for CMS persistence and external metadata/sharing.
- SmartImage, markdown and dynamic reader/shop image sources now use the display helper: magazine covers, generated article illustrations served from public Storage, avatars, rails, lists, collections, product pages, carts, checkout, wishlists and download-page thumbnails. Existing database URLs are read as-is and rewritten only for display. Markdown attributes remain escaped.
- `api/media.ts`: Vercel Edge GET/HEAD handler fetching only the validated public Storage object. No keys, cookies or caller headers are used upstream. Redirects are refused; no upstream cookies are returned. Successful responses stream with `Cache-Control: public, s-maxage=31536000, stale-while-revalidate=86400`. Missing objects return 404/no-store; upstream failures return 502/no-store; other methods return 405/no-store. Active uploaded documents are sandboxed with response CSP and nosniff.
- `/media/public/:path*` rewrite precedes the SPA fallback in `vercel.json`.
- Vite dev proxy uses the same public Storage path and validator, strips cookies/authorization, and accepts preview hosts. Local development is a proxy, not a Vercel cache emulator.
- Video/audio, signed downloads, admin media previews, social metadata and upload destinations remain on their existing paths. Public render-image URLs resolve to the original object, without paid transformations or transformation query parameters.
- Logo already uses a ~2.7 KB WebP; no multi-MB logo remains to compress.

## Configuration and cache lifecycle

Configure `SUPABASE_URL` or `VITE_PUBLIC_SUPABASE_URL` for the Edge runtime. Existing VITE Supabase URL aliases are supported as fallbacks. The browser needs its existing VITE project URL; all configured aliases must refer to the same project. This feature needs **no API key or service-role credential**. Never put service-role secrets in VITE variables.

A cold cache request fetches from Supabase; cache-eligible repeat requests can be served by Vercel. Cache eviction, different regions, redeployments and revalidation can cause further upstream requests. No measured savings or live HIT is claimed yet. Vercel transfer/function usage still applies.

Use a new object key when replacing an image. Same-key replacements/deletions may remain visible for the one-year cache lifetime (plus stale revalidation window); query-only versioning on the source URL is intentionally removed. For urgent removal, purge Vercel's cache as well as removing the original. Only publish objects that are safe to cache publicly.

## Validation (no live Storage calls)

- Full suite: 173 files passed; 2,373 tests passed, 7 skipped.
- After final escaping/type/lint fixes: focused media, images and markdown/lib suites passed (54 tests).
- App, API and Vite/node TypeScript checks passed.
- Final production build passed. It warns that Supabase environment credentials are absent in this sandbox; deployment still needs existing environment configuration.
- ESLint: zero errors, 30 existing warnings.
- `git diff --check` passed.
- New tests use fake URLs and mocked fetch exclusively: allowed/evil/signed URLs, traversal, render paths, markdown, Pexels, GET/HEAD, no cookie forwarding/return, response cache headers, method rejection and uncached failures.

## Deployment acceptance checks

Not executed against production in this task:

1. Deploy the PR with matching frontend/runtime project URL settings.
2. Open a known public image at `/media/public/<bucket>/<key>` twice using GET. Inspect `x-vercel-cache` for MISS then HIT (allow regional caching effects). Vercel may consume shared-cache directives rather than exposing the original header verbatim to the browser.
3. Verify HEAD has no body; a missing key is 404 with no-store; POST is 405; malformed/traversal paths do not fetch Storage.
4. Visit a magazine/article with inline images, shop/product, cart and checkout. Confirm eligible image requests use `/media/public/`, while Pexels and signed downloads retain their existing behavior.
5. Compare Supabase Storage egress and Vercel usage over equivalent traffic windows. No fixed percentage reduction is promised.

Rollback: revert this PR; stored URLs and originals require no migration or restoration.
