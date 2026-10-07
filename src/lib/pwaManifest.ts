export type PwaSurface = 'reader' | 'owner' | 'buddy';

export const PWA_MANIFEST_HREF: Record<PwaSurface, string> = {
  reader: '/manifest.webmanifest',
  owner: '/manifest-owner.webmanifest',
  buddy: '/manifest-buddy.webmanifest',
};

/** Resolve a separate install identity without changing the reader manifest. */
export function pwaSurfaceForPath(pathname: string): PwaSurface {
  const cleanPath = (pathname.split(/[?#]/, 1)[0] || '/').replace(/\/+$/, '') || '/';
  if (cleanPath === '/buddy' || cleanPath.startsWith('/buddy/')) return 'buddy';
  if (cleanPath === '/admin' || cleanPath.startsWith('/admin/')) return 'owner';
  return 'reader';
}

export function pwaManifestHrefForPath(pathname: string): string {
  return PWA_MANIFEST_HREF[pwaSurfaceForPath(pathname)];
}

/** Update only the manifest link; no route/auth/service-worker state is changed. */
export function applyPwaManifestForPath(
  pathname: string,
  documentRef: Pick<Document, 'querySelector'> | undefined = typeof document === 'undefined' ? undefined : document,
): string {
  const href = pwaManifestHrefForPath(pathname);
  const link = documentRef?.querySelector('link[rel="manifest"]');
  link?.setAttribute('href', href);
  return href;
}

export function isBuddyPwaPath(pathname: string): boolean {
  return pwaSurfaceForPath(pathname) === 'buddy';
}
