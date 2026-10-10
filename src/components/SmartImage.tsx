import type { CSSProperties } from 'react';
import { applyImageFallback, buildSrcSet, displayImageUrl } from '../lib/images';

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
  /** Hero-only: eager loading + fetchpriority="high". Everything else is lazy. */
  priority?: boolean;
  style?: CSSProperties;
}

/**
 * Responsive <img> with:
 * - Pexels URL normalisation + srcset/sizes via Pexels' own `w=` parameter
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
  style,
}: SmartImageProps) {
  const normalized = displayImageUrl(src);
  if (!normalized) return null;

  const srcSet = buildSrcSet(normalized);
  return (
    <img
      src={normalized}
      srcSet={srcSet}
      sizes={srcSet ? sizes : undefined}
      alt={alt}
      className={className}
      width={width}
      height={height}
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
      // React 18 wants the DOM attribute spelled lowercase; browsers accept fetchpriority.
      {...(priority ? ({ fetchpriority: 'high' } as Record<string, string>) : {})}
      style={aspectRatio ? { aspectRatio, ...style } : style}
      onError={(e) => applyImageFallback(e.currentTarget)}
    />
  );
}
