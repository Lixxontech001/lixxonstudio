import { rewritePublicMediaUrl } from './publicMedia';

/**
 * Image URL helpers.
 *
 * Editors sometimes paste a Pexels *photo-page* URL (an HTML page like
 * `https://www.pexels.com/photo/woman-applying-cream-1234567/`) instead of the CDN file URL.
 * Such a URL renders as a broken image (or an HTML blob) in an `<img>`; the browser never
 * receives a picture. `normalizeImageUrl` rewrites those page URLs to the real
 * `images.pexels.com` file, and passes every other URL through untouched.
 */

/** https://www.pexels.com/photo/<optional-slug-><numeric-id>/ (with or without query) */
const PEXELS_PHOTO_PAGE =
  /^https?:\/\/(?:www\.)?pexels\.com\/photo\/(?:[^/?#]*-)?(\d+)\/?(?:[?#].*)?$/i;

/** https://images.pexels.com/photos/<id>/… — an id-only folder, no file name yet */
const PEXELS_PHOTOS_FOLDER = /^https?:\/\/images\.pexels\.com\/photos\/(\d+)\/?(?:[?#].*)?$/i;

/** Canonical CDN file for a Pexels photo id. */
export function pexelsCdnUrl(id: string, width = 1600): string {
  return `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&w=${width}`;
}

/**
 * Normalise an image URL that may have been pasted from a browser address bar.
 * Returns `null` for empty/missing input, otherwise a renderable URL.
 */
export function normalizeImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  const page = PEXELS_PHOTO_PAGE.exec(trimmed);
  if (page) return pexelsCdnUrl(page[1]);

  const folder = PEXELS_PHOTOS_FOLDER.exec(trimmed);
  if (folder) return pexelsCdnUrl(folder[1]);

  return trimmed;
}

/** Responsive widths Pexels' CDN serves well (AVIF/WebP via auto=compress). */
export const RESPONSIVE_WIDTHS = [400, 800, 1200, 1600] as const;

const PEXELS_CDN = /^https?:\/\/images\.pexels\.com\//i;

/**
 * A `srcset` for Pexels CDN URLs using Pexels' own `w=` parameter. Returns
 * `undefined` for other hosts (we never guess parameters for third parties).
 */
export function buildSrcSet(
  url: string | null | undefined,
  widths: readonly number[] = RESPONSIVE_WIDTHS
): string | undefined {
  const u = url?.trim();
  if (!u || !PEXELS_CDN.test(u)) return undefined;
  return widths
    .map((w) => `${withWidth(u, w)} ${w}w`)
    .join(', ');
}

/** Swap (or add) the `w=` query parameter on a Pexels CDN URL. */
function withWidth(url: string, width: number): string {
  const hashSplit = url.split('#');
  const querySplit = hashSplit[0].split('?');
  const params = new URLSearchParams(querySplit[1] ?? '');
  params.set('w', String(width));
  if (!params.has('auto')) params.set('auto', 'compress');
  if (!params.has('cs')) params.set('cs', 'tinysrgb');
  return `${querySplit[0]}?${params.toString()}${hashSplit[1] ? `#${hashSplit[1]}` : ''}`;
}

/** Branded placeholder (same-origin, CSP-safe) shown when an image fails to load. */
export const IMAGE_FALLBACK_SRC = '/image-placeholder.svg';

/**
 * Swap a failed <img> to the branded placeholder exactly once and report the
 * failing URL as a Sentry breadcrumb. Returns true if the fallback was applied.
 */
export function applyImageFallback(img: HTMLImageElement): boolean {
  if (img.dataset.fallbackApplied === '1') return false;
  img.dataset.fallbackApplied = '1';
  void import('./monitoring').then((m) => m.addBreadcrumb('image', 'Image failed to load', { url: img.currentSrc || img.src }));
  img.removeAttribute('srcset');
  img.src = IMAGE_FALLBACK_SRC;
  return true;
}

/**
 * Capture-phase listener: image errors do not bubble, so this catches every
 * failed <img> in the app (including markdown-rendered content) without any
 * inline handlers (which CSP would block anyway).
 */
export function installImageFallback(): void {
  window.addEventListener(
    'error',
    (e) => {
      const t = e.target;
      if (t instanceof HTMLImageElement) applyImageFallback(t);
    },
    true
  );
}

/** Display only: do not use this to persist upload URLs or CMS values. */
export function displayImageUrl(url: string | null | undefined): string | undefined {
  const normalized = normalizeImageUrl(url);
  if (!normalized) return undefined;
  return rewritePublicMediaUrl(normalized,
    import.meta.env.VITE_SUPABASE_URL || import.meta.env.VITE_PUBLIC_SUPABASE_URL ||
    import.meta.env.VITE_SUPABASE_PROJECT_URL || import.meta.env.VITE_SUPABASE_PUBLIC_URL ||
    import.meta.env.VITE_SUPABASE_PROJECT_REF_URL);
}
