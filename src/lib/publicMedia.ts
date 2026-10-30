/** Pure, shared validation: never let URL parsing normalize traversal first. */
export function publicMediaPath(path: string): string | null {
  try {
    const decoded = decodeURIComponent(path);
    // Reject nested encoding, separators, control characters and dot segments.
    if (/[\\%?#]/.test(decoded) || Array.from(decoded).some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) return null;
    const parts = decoded.split('/');
    // At least 1 non-empty segment; no dot-traversal allowed.
    if (parts.length < 1 || parts.some(p => !p || p === '.' || p === '..')) return null;
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

  // Use env-derived origin when available; otherwise accept any Supabase project.
  const configuredOrigin = publicMediaOrigin(projectUrl);

  const match = /^(https:\/\/[^/]+\.supabase\.co)\/storage\/v1\/(?:object\/public|render\/image\/public)\/([^?#]+)(?:\?([^#]*))?(?:#.*)?$/.exec(url);
  if (!match) return url;

  // When we know the configured origin, only rewrite URLs from that project.
  // When the env var is missing, accept any *.supabase.co storage URL so images
  // still get proxied instead of being requested directly (which can fail due to
  // Supabase Storage CORS or hotlink restrictions).
  if (configuredOrigin && match[1] !== configuredOrigin) return url;

  // Signed/authenticated requests must never become publicly cached requests.
  if (Array.from(new URLSearchParams(match[3] ?? '').keys()).some(k => /token|signature|authorization/i.test(k))) return url;

  const path = publicMediaPath(match[2]);
  // Fallback: if path validation fails, serve directly rather than silently breaking.
  return path ? `/media/public/${path}` : url;
}
