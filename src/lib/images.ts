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
