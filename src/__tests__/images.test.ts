/**
 * normalizeImageUrl — pasted Pexels photo-page URLs (HTML pages) must become real
 * CDN image files, or the <img> renders nothing.
 */
import { describe, it, expect } from 'vitest';
import { normalizeImageUrl, pexelsCdnUrl, buildSrcSet, applyImageFallback } from '../lib/images';

describe('normalizeImageUrl', () => {
  it('rewrites Pexels photo-page URLs to the CDN file (any host form)', () => {
    expect(normalizeImageUrl('https://www.pexels.com/photo/1234567/')).toBe(pexelsCdnUrl('1234567'));
    expect(normalizeImageUrl('https://pexels.com/photo/1234567')).toBe(pexelsCdnUrl('1234567'));
    expect(normalizeImageUrl('http://www.pexels.com/photo/1234567/?utm_source=x')).toBe(pexelsCdnUrl('1234567'));
    expect(normalizeImageUrl('https://www.pexels.com/photo/1234567')).toContain(
      'https://images.pexels.com/photos/1234567/pexels-photo-1234567.jpeg'
    );
  });

  it('rewrites slug-style photo-page URLs using the trailing id', () => {
    expect(normalizeImageUrl('https://www.pexels.com/photo/woman-applying-cream-3373736/')).toBe(
      pexelsCdnUrl('3373736')
    );
  });

  it('rewrites id-only pexels.com image folders to a concrete file', () => {
    expect(normalizeImageUrl('https://images.pexels.com/photos/3373736/')).toBe(pexelsCdnUrl('3373736'));
  });

  it('passes real CDN URLs and other hosts through untouched', () => {
    const cdn = 'https://images.pexels.com/photos/3373736/pexels-photo-3373736.jpeg?auto=compress&cs=tinysrgb&w=800';
    expect(normalizeImageUrl(cdn)).toBe(cdn);
    const other = 'https://cdn.example.com/pic.jpg';
    expect(normalizeImageUrl(other)).toBe(other);
  });

  it('returns null for empty input', () => {
    expect(normalizeImageUrl(null)).toBeNull();
    expect(normalizeImageUrl(undefined)).toBeNull();
    expect(normalizeImageUrl('   ')).toBeNull();
  });
});

describe('buildSrcSet', () => {
  it('builds Pexels srcset with w= at each responsive width', () => {
    const set = buildSrcSet('https://images.pexels.com/photos/3373736/pexels-photo-3373736.jpeg?auto=compress&cs=tinysrgb&w=1600');
    expect(set).toContain('w=400 400w');
    expect(set).toContain('w=800 800w');
    expect(set).toContain('w=1200 1200w');
    expect(set).toContain('w=1600 1600w');
  });

  it('never guesses parameters for third-party hosts', () => {
    expect(buildSrcSet('https://cdn.example.com/pic.jpg')).toBeUndefined();
    expect(buildSrcSet(null)).toBeUndefined();
  });

  it('preserves existing Pexels params when swapping w=', () => {
    const set = buildSrcSet('https://images.pexels.com/photos/1/pexels-photo-1.jpeg?h=900&w=100')!;
    expect(set).toContain('h=900');
    expect(set).toContain('w=400');
    expect(set).not.toContain('w=100 ');
  });
});

describe('applyImageFallback', () => {
  it('swaps a failed image to the branded placeholder exactly once', () => {
    const img = document.createElement('img');
    img.src = 'https://images.pexels.com/photos/1/pexels-photo-1.jpeg';
    img.setAttribute('srcset', 'a 400w');
    expect(applyImageFallback(img)).toBe(true);
    expect(img.src).toContain('/image-placeholder.svg');
    expect(img.hasAttribute('srcset')).toBe(false);
    expect(img.dataset.fallbackApplied).toBe('1');
    // second failure must not loop
    expect(applyImageFallback(img)).toBe(false);
  });
});
