/** Pure, shared validation: never let URL parsing normalize traversal first. */
export function publicMediaPath(path: string): string | null {
  try {
    const decoded = decodeURIComponent(path);
    // Reject nested encoding, separators, control characters and dot segments.
    if (/[\\%?#]/.test(decoded) || Array.from(decoded).some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) return null;
    const parts = decoded.split('/');
    if (parts.length < 2 || parts.some(p => !p || p === '.' || p === '..')) return null;
    return parts.map(encodeURIComponent).join('/');
  } catch { return null; }
}

export function publicMediaOrigin(base: string | undefined): string | null {
  if (!base) return null;
  try {
    const trimmed = base.trim();
    const u = new URL(trimmed);
    return (u.protocol === 'https:' || u.protocol === 'http:') &&
      !u.username && !u.password &&
      (u.pathname === '/' || u.pathname === '') &&
      !u.search && !u.hash
      ? u.origin
      : null;
  } catch { return null; }
}

/**
 * Only this project's public objects qualify. Everything else is unchanged.
 * External CDN images (e.g., images.pexels.com, unsplash.com) and non-Supabase domains are never proxied.
 */
export function rewritePublicMediaUrl(url: string, projectUrl: string | undefined): string {
  if (!url || typeof url !== 'string') return url;

  // External CDN images must NEVER be proxied
  if (/images\.pexels\.com|pexels\.com|unsplash\.com/i.test(url)) {
    return url;
  }

  // ONLY rewrite URLs if they genuinely contain Supabase public storage paths
  if (!url.includes('.supabase.co/storage/v1/object/public/') && !url.includes('.supabase.co/storage/v1/render/image/public/')) {
    return url;
  }

  // Non-Supabase external domains return raw URL directly
  try {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      const parsed = new URL(url);
      if (!parsed.hostname.endsWith('.supabase.co')) {
        return url;
      }
    }
  } catch {
    return url;
  }

  const origin = publicMediaOrigin(projectUrl);
  if (!origin) return url;

  const match = /^(https:\/\/[^/]+\.supabase\.co)\/storage\/v1\/(?:object\/public|render\/image\/public)\/([^?#]+)(?:\?([^#]*))?(?:#.*)?$/.exec(url);
  if (!match || match[1] !== origin) return url;

  // Signed/authenticated requests must never become publicly cached requests.
  if (Array.from(new URLSearchParams(match[3]).keys()).some(k => /token|signature|authorization/i.test(k))) return url;

  const path = publicMediaPath(match[2]);
  return path ? `/media/public/${path}` : url;
}
