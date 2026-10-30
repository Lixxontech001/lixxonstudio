import type { CSSProperties } from 'react';
import { applyImageFallback, buildSrcSet, displayImageUrl, extractDirectStorageUrl } from '../lib/images';

interface SmartImageProps {
  /** Raw URL from the CMS — Pexels photo-page URLs are normalised automatically. */
  src: string | null | undefined;
  alt: string;
  className?: string;
  /** Responsive hint for the browser, e.g. '(max-width: 768px) 100vw, 50vw'. */
  sizes?: string;
  /** CSS aspect-ratio (e.g. '4/5') so layout never shifts while loading (CLS). */
  aspectRatio?: string;
  /** Intrinsic size hint — pair with aspectRatio or a fixed-size className. */
  width?: number;
  height?: number;
  /** Hero or above-the-fold: eager loading + fetchpriority="high". */
  priority?: boolean;
  /** Optional loading strategy ('lazy' | 'eager'). Defaults to eager when priority=true, else lazy. */
  loading?: 'lazy' | 'eager';
  style?: CSSProperties;
}

/**
  * Responsive <img> with:
  * - Pexels URL normalisation + srcset/sizes via Pexels' own `w=` parameter
  * - Direct CDN loading for Supabase & Pexels to avoid proxy latency
  * - loading="lazy" + decoding="async" below the fold (priority → eager + fetchpriority)
  * - an explicit aspect-ratio/width/height so images never cause layout shift
  * - a branded onError fallback (plus the global error listener for markdown images)
  */
export default function SmartImage({
  src,
  alt,
  className,
  sizes,
  aspectRatio,
  width,
  height,
  priority = false,
  loading,
  style,
}: SmartImageProps) {
  const normalized = displayImageUrl(src);
  if (!normalized) return null;

  // Use direct CDN URL to bypass proxy roundtrips
  const directUrl = extractDirectStorageUrl(normalized) || normalized;
  const srcSet = buildSrcSet(directUrl);
  const effectiveLoading = priority ? 'eager' : (loading || 'lazy');
  return (
    <img
      src={directUrl}
      data-original-src={src || undefined}
      srcSet={srcSet}
      sizes={srcSet ? sizes : undefined}
      alt={alt}
      className={className}
      width={width}
      height={height}
      loading={effectiveLoading}
      decoding="async"
      // React 18 wants the DOM attribute spelled lowercase; browsers accept fetchpriority.
      {...(priority ? ({ fetchpriority: 'high' } as Record<string, string>) : {})}
      style={aspectRatio ? { aspectRatio, ...style } : style}
      onError={(e) => {
        const target = e.currentTarget;
        // If a proxied image fails and an unproxied raw HTTP(S) src exists, try original once before placeholder
        if (
          (target.src.includes('/media/public/') || target.src.includes('/api/media')) &&
          src &&
          (src.startsWith('http://') || src.startsWith('https://')) &&
          target.src !== src &&
          !target.dataset.triedOriginal
        ) {
          target.dataset.triedOriginal = '1';
          target.src = src;
          return;
        }
        applyImageFallback(target);
      }}
    />
  );
}
