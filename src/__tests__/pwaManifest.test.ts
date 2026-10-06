import { beforeEach, describe, expect, it } from 'vitest';
import { applyPwaManifestForPath, isBuddyPwaPath, pwaManifestHrefForPath, pwaSurfaceForPath } from '../lib/pwaManifest';

describe('separate PWA manifest identity selection', () => {
  beforeEach(() => {
    document.head.innerHTML = '<link rel="manifest" href="/manifest.webmanifest">';
  });

  it('keeps public reader routes on the existing reader manifest', () => {
    expect(pwaSurfaceForPath('/')).toBe('reader');
    expect(pwaManifestHrefForPath('/blog/a-tested-routine')).toBe('/manifest.webmanifest');
    expect(pwaManifestHrefForPath('/administrator')).toBe('/manifest.webmanifest');
  });

  it('selects the Owner/Admin manifest only inside the admin route boundary', () => {
    expect(pwaManifestHrefForPath('/admin')).toBe('/manifest-owner.webmanifest');
    expect(pwaManifestHrefForPath('/admin/automation/distribution')).toBe('/manifest-owner.webmanifest');
    expect(pwaManifestHrefForPath('/administer')).toBe('/manifest.webmanifest');
  });

  it('selects the Buddy manifest for its exact route and nested paths', () => {
    expect(isBuddyPwaPath('/buddy')).toBe(true);
    expect(pwaManifestHrefForPath('/buddy/')).toBe('/manifest-buddy.webmanifest');
    expect(pwaManifestHrefForPath('/buddy/help')).toBe('/manifest-buddy.webmanifest');
    expect(isBuddyPwaPath('/buddyish')).toBe(false);
  });

  it('updates the existing manifest link without replacing the reader default', () => {
    const link = document.querySelector('link[rel="manifest"]')!;
    expect(applyPwaManifestForPath('/admin/settings', document)).toBe('/manifest-owner.webmanifest');
    expect(link.getAttribute('href')).toBe('/manifest-owner.webmanifest');
    expect(applyPwaManifestForPath('/search', document)).toBe('/manifest.webmanifest');
    expect(link.getAttribute('href')).toBe('/manifest.webmanifest');
  });
});
