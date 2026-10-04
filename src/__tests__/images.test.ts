/**
 * normalizeImageUrl — pasted Pexels photo-page URLs (HTML pages) must become real
 * CDN image files, or the <img> renders nothing.
 */
import { describe, it, expect } from 'vitest';
import { normalizeImageUrl, pexelsCdnUrl } from '../lib/images';

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
