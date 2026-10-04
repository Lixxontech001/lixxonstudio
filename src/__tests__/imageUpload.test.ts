// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { optimizeAdminImage } from '../lib/imageUpload';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('admin image upload optimisation', () => {
  it('encodes raster images as WebP at a maximum 1600-pixel edge and quality 0.78', async () => {
    const close = vi.fn();
    const drawImage = vi.fn();
    const bitmap = { width: 4000, height: 2000, close } as unknown as ImageBitmap;
    const encoded = new Blob([new Uint8Array(5000)], { type: 'image/webp' });
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
    const toBlob = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(encoded));

    const source = new File([new Uint8Array(100_000)], 'cover.png', { type: 'image/png' });
    const result = await optimizeAdminImage(source);

    expect(result.blob).toBe(encoded);
    expect(result).toMatchObject({ width: 1600, height: 800, contentType: 'image/webp', extension: 'webp' });
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/webp', 0.78);
    expect(drawImage).toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });

  it('preserves animated and vector formats rather than flattening them', async () => {
    const gif = new File(['gif'], 'animation.gif', { type: 'image/gif' });
    const svg = new File(['<svg/>'], 'mark.svg', { type: 'image/svg+xml' });
    await expect(optimizeAdminImage(gif)).resolves.toMatchObject({ blob: gif, contentType: 'image/gif', extension: 'gif' });
    await expect(optimizeAdminImage(svg)).resolves.toMatchObject({ blob: svg, contentType: 'image/svg+xml', extension: 'svg' });
  });

  it('keeps a small original when re-encoding would make it larger', async () => {
    const close = vi.fn();
    const bitmap = { width: 100, height: 80, close } as unknown as ImageBitmap;
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(new Blob([new Uint8Array(5000)], { type: 'image/webp' })));
    const source = new File(['small'], 'small.jpg', { type: 'image/jpeg' });

    const result = await optimizeAdminImage(source);
    expect(result.blob).toBe(source);
    expect(result).toMatchObject({ width: 100, height: 80, contentType: 'image/jpeg', extension: 'jpg' });
  });
});
