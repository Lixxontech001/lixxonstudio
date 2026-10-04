-- =============================================================================
-- Idempotent image-URL repair (safe to run repeatedly)
--
-- Editors sometimes paste a Pexels *photo-page* URL (an HTML page like
-- https://www.pexels.com/photo/woman-applying-cream-3373736/) instead of the CDN
-- file URL, or paste http:// links. Those render as broken images. This migration
-- rewrites them to real CDN files / https — the same rules as
-- src/lib/images.ts normalizeImageUrl and scripts/image-audit.mjs.
-- Run scripts/image-audit.mjs afterwards to verify.
-- =============================================================================

-- 1) Pexels photo-page URLs → canonical CDN file (posts.cover_image)
UPDATE posts
SET cover_image = 'https://images.pexels.com/photos/' || m.pid || '/pexels-photo-' || m.pid
                   || '.jpeg?auto=compress&cs=tinysrgb&w=1600'
FROM (
  SELECT id, substring(cover_image FROM 'pexels\.com/photo/(?:[^/]*-)?([0-9]+)') AS pid
  FROM posts
  WHERE cover_image ~* 'pexels\.com/photo/(?:[^/]*-)?[0-9]+'
) m
WHERE posts.id = m.id AND m.pid IS NOT NULL;

-- 2) Pexels id-only folder URLs → canonical CDN file (posts.cover_image)
UPDATE posts
SET cover_image = 'https://images.pexels.com/photos/' || m.pid || '/pexels-photo-' || m.pid
                   || '.jpeg?auto=compress&cs=tinysrgb&w=1600'
FROM (
  SELECT id, substring(cover_image FROM 'images\.pexels\.com/photos/([0-9]+)/?$') AS pid
  FROM posts
  WHERE cover_image ~* '^https?://images\.pexels\.com/photos/[0-9]+/?$'
) m
WHERE posts.id = m.id AND m.pid IS NOT NULL;

-- 3) Same two rules for products.image_url
UPDATE products
SET image_url = 'https://images.pexels.com/photos/' || m.pid || '/pexels-photo-' || m.pid
                 || '.jpeg?auto=compress&cs=tinysrgb&w=1600'
FROM (
  SELECT id,
         coalesce(
           substring(image_url FROM 'pexels\.com/photo/(?:[^/]*-)?([0-9]+)'),
           substring(image_url FROM 'images\.pexels\.com/photos/([0-9]+)/?$')
         ) AS pid
  FROM products
  WHERE image_url ~* 'pexels\.com/photo/(?:[^/]*-)?[0-9]+'
     OR image_url ~* '^https?://images\.pexels\.com/photos/[0-9]+/?$'
) m
WHERE products.id = m.id AND m.pid IS NOT NULL;

-- 4) products.gallery[] entries
UPDATE products p
SET gallery = (
  SELECT array_agg(
    CASE
      WHEN g ~* 'pexels\.com/photo/(?:[^/]*-)?[0-9]+'
        THEN 'https://images.pexels.com/photos/' || substring(g FROM 'pexels\.com/photo/(?:[^/]*-)?([0-9]+)')
             || '/pexels-photo-' || substring(g FROM 'pexels\.com/photo/(?:[^/]*-)?([0-9]+)')
             || '.jpeg?auto=compress&cs=tinysrgb&w=1600'
      WHEN g ~* '^https?://images\.pexels\.com/photos/[0-9]+/?$'
        THEN 'https://images.pexels.com/photos/' || substring(g FROM 'images\.pexels\.com/photos/([0-9]+)/?$')
             || '/pexels-photo-' || substring(g FROM 'images\.pexels\.com/photos/([0-9]+)/?$')
             || '.jpeg?auto=compress&cs=tinysrgb&w=1600'
      WHEN g ~* '^http://' THEN 'https://' || substring(g FROM '^http://(.+)$')
      ELSE g
    END ORDER BY ordinality
  )
  FROM unnest(p.gallery) WITH ORDINALITY AS t(g, ordinality)
)
WHERE EXISTS (
  SELECT 1 FROM unnest(p.gallery) g
  WHERE g ~* 'pexels\.com/photo/' OR g ~* '^https?://images\.pexels\.com/photos/[0-9]+/?$' OR g ~* '^http://'
);

-- 5) http:// → https:// on remaining single-image columns
UPDATE posts SET cover_image = 'https://' || substring(cover_image FROM '^http://(.+)$')
WHERE cover_image ~* '^http://';
UPDATE products SET image_url = 'https://' || substring(image_url FROM '^http://(.+)$')
WHERE image_url ~* '^http://';
