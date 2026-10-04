export interface OptimizedAdminImage {
  blob: Blob;
  width: number;
  height: number;
  contentType: string;
  extension: string;
}

function originalExtension(file: File): string {
  return file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'img';
}

function extensionForType(type: string, fallback: string): string {
  if (type === 'image/webp') return 'webp';
  if (type === 'image/png') return 'png';
  if (type === 'image/jpeg') return 'jpg';
  if (type === 'image/gif') return 'gif';
  if (type === 'image/avif') return 'avif';
  return fallback;
}

/** Resize and encode admin raster uploads in-browser, before they reach Storage. */
export async function optimizeAdminImage(
  file: File,
  maxDimension = 1600,
  quality = 0.78,
): Promise<OptimizedAdminImage> {
  const fallbackExtension = originalExtension(file);
  const untouched = (width = 0, height = 0): OptimizedAdminImage => ({
    blob: file,
    width,
    height,
    contentType: file.type || 'application/octet-stream',
    extension: extensionForType(file.type, fallbackExtension),
  });

  // Keep animated/vector formats intact; rasterising them would remove animation or
  // vector sharpness. All ordinary raster covers/products/media use the WebP path.
  if (!file.type.startsWith('image/') || file.type === 'image/gif' || file.type === 'image/svg+xml') return untouched();

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return untouched();
  }

  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    const originalWidth = bitmap.width;
    const originalHeight = bitmap.height;
    bitmap.close();
    return untouched(originalWidth, originalHeight);
  }
  context.drawImage(bitmap, 0, 0, width, height);

  const encoded = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', quality));
  const originalWidth = bitmap.width;
  const originalHeight = bitmap.height;
  bitmap.close();
  if (!encoded) return untouched(originalWidth, originalHeight);

  const resized = width < originalWidth || height < originalHeight;
  if (!resized && encoded.size >= file.size) {
    return untouched(originalWidth, originalHeight);
  }

  return {
    blob: encoded,
    width,
    height,
    contentType: encoded.type || file.type,
    extension: extensionForType(encoded.type || file.type, fallbackExtension),
  };
}
