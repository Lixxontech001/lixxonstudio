/*
# CMS Schema Upgrade — Phase 2

## Purpose
Upgrades the editorial schema to support a full CMS: article statuses (draft/scheduled/published/archived),
SEO metadata, media library, related articles, author enhancements, and admin-only RLS policies.

## Changes

### 1. posts table — new columns
- status (text, default 'published'): 'draft' | 'scheduled' | 'published' | 'archived'
- scheduled_at (timestamptz, nullable): future publication time for scheduled posts
- seo_title (text, nullable): override for SEO title
- seo_description (text, nullable): override for SEO meta description
- canonical_url (text, nullable): canonical URL override
- cover_image_alt (text, nullable): alt text for cover image
- updated_at (timestamptz, default now()): last modification timestamp

### 2. authors table — new columns
- social_links (jsonb, nullable): { twitter, instagram, linkedin, website }
- is_active (boolean, default true): soft-deactivate authors without deleting
- updated_at (timestamptz, default now())

### 3. categories table — new columns
- banner_image (text, nullable): URL for category banner image
- seo_title (text, nullable)
- seo_description (text, nullable)
- is_active (boolean, default true)

### 4. New table: media
- id (uuid PK)
- url (text): public URL of the image
- alt_text (text, nullable)
- title (text, nullable)
- caption (text, nullable)
- file_name (text, nullable)
- file_size (integer, nullable)
- mime_type (text, nullable)
- width (integer, nullable)
- height (integer, nullable)
- created_at (timestamptz, default now())
- RLS: public read, authenticated CRUD

### 5. New table: related_articles
- id (uuid PK)
- post_id (uuid, FK to posts)
- related_post_id (uuid, FK to posts)
- sort_order (integer, default 0)
- created_at (timestamptz, default now())
- UNIQUE(post_id, related_post_id)
- RLS: public read, authenticated CRUD

### 6. comments table — add is_approved column
- is_approved (boolean, default true): admin moderation flag (renamed from is_visible conceptually; is_visible stays for backward compat)
- admin_reply (boolean, default false): marks replies from admin

### 7. RLS Policy Updates
- posts SELECT: public can only see status='published' AND (published_at IS NULL OR published_at <= now())
  - authenticated (admin) can see all posts
- posts INSERT/UPDATE/DELETE: authenticated only
- categories, authors: public read stays; write becomes authenticated only
- comments: public read only is_approved=true; authenticated can read all and moderate
- media: public read; authenticated CRUD
- related_articles: public read; authenticated CRUD

### 8. Indexes
- posts(status, published_at) — for public listing queries
- posts(scheduled_at) — for scheduled publishing checks
- related_articles(post_id) — for fetching related articles
- media(created_at DESC) — for media library browsing

## Important Notes
1. All existing 55 posts get status='published' so they remain visible.
2. Existing public SELECT policies are replaced with status-aware versions.
3. No data is lost — only additive changes.
4. The anon role loses direct write access to posts/categories/authors. Admin operations
   require authentication. Public read still works for published content.
*/

-- 1. Add status and SEO columns to posts
ALTER TABLE posts ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'published';
ALTER TABLE posts ADD COLUMN IF NOT EXISTS scheduled_at timestamptz;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS seo_title text;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS seo_description text;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS canonical_url text;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS cover_image_alt text;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Set all existing posts to published
UPDATE posts SET status = 'published' WHERE status IS NULL OR status = '';

-- 2. Add author enhancement columns
ALTER TABLE authors ADD COLUMN IF NOT EXISTS social_links jsonb;
ALTER TABLE authors ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
ALTER TABLE authors ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- 3. Add category enhancement columns
ALTER TABLE categories ADD COLUMN IF NOT EXISTS banner_image text;
ALTER TABLE categories ADD COLUMN IF NOT EXISTS seo_title text;
ALTER TABLE categories ADD COLUMN IF NOT EXISTS seo_description text;
ALTER TABLE categories ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

-- 4. Create media table
CREATE TABLE IF NOT EXISTS media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  url text NOT NULL,
  alt_text text,
  title text,
  caption text,
  file_name text,
  file_size integer,
  mime_type text,
  width integer,
  height integer,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE media ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public_read_media" ON media;
CREATE POLICY "public_read_media" ON media FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "auth_insert_media" ON media;
CREATE POLICY "auth_insert_media" ON media FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "auth_update_media" ON media;
CREATE POLICY "auth_update_media" ON media FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "auth_delete_media" ON media;
CREATE POLICY "auth_delete_media" ON media FOR DELETE
  TO authenticated USING (true);

-- 5. Create related_articles table
CREATE TABLE IF NOT EXISTS related_articles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  related_post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  UNIQUE(post_id, related_post_id)
);

ALTER TABLE related_articles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public_read_related" ON related_articles;
CREATE POLICY "public_read_related" ON related_articles FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "auth_insert_related" ON related_articles;
CREATE POLICY "auth_insert_related" ON related_articles FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "auth_update_related" ON related_articles;
CREATE POLICY "auth_update_related" ON related_articles FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "auth_delete_related" ON related_articles;
CREATE POLICY "auth_delete_related" ON related_articles FOR DELETE
  TO authenticated USING (true);

-- 6. Add comment moderation columns
ALTER TABLE comments ADD COLUMN IF NOT EXISTS is_approved boolean NOT NULL DEFAULT true;
ALTER TABLE comments ADD COLUMN IF NOT EXISTS admin_reply boolean NOT NULL DEFAULT false;

-- 7. Update RLS policies for posts (public reads only published)
DROP POLICY IF EXISTS "public_read_posts" ON posts;
DROP POLICY IF EXISTS "auth_read_posts" ON posts;
DROP POLICY IF EXISTS "auth_insert_posts" ON posts;
DROP POLICY IF EXISTS "auth_update_posts" ON posts;
DROP POLICY IF EXISTS "auth_delete_posts" ON posts;

-- Public can only see published posts that are not scheduled in the future
CREATE POLICY "public_read_published_posts" ON posts FOR SELECT
  TO anon, authenticated
  USING (status = 'published' AND (scheduled_at IS NULL OR scheduled_at <= now()));

-- Authenticated (admin) can see all posts
CREATE POLICY "auth_read_all_posts" ON posts FOR SELECT
  TO authenticated USING (true);

-- Only authenticated users can write to posts
CREATE POLICY "auth_insert_posts" ON posts FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY "auth_update_posts" ON posts FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "auth_delete_posts" ON posts FOR DELETE
  TO authenticated USING (true);

-- 8. Update RLS for categories (public read, auth write)
DROP POLICY IF EXISTS "public_read_categories" ON categories;
DROP POLICY IF EXISTS "auth_insert_categories" ON categories;
DROP POLICY IF EXISTS "auth_update_categories" ON categories;
DROP POLICY IF EXISTS "auth_delete_categories" ON categories;

CREATE POLICY "public_read_categories" ON categories FOR SELECT
  TO anon, authenticated USING (true);

CREATE POLICY "auth_insert_categories" ON categories FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY "auth_update_categories" ON categories FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "auth_delete_categories" ON categories FOR DELETE
  TO authenticated USING (true);

-- 9. Update RLS for authors (public read active only, auth read all, auth write)
DROP POLICY IF EXISTS "public_read_authors" ON authors;
DROP POLICY IF EXISTS "auth_read_authors" ON authors;
DROP POLICY IF EXISTS "auth_insert_authors" ON authors;
DROP POLICY IF EXISTS "auth_update_authors" ON authors;
DROP POLICY IF EXISTS "auth_delete_authors" ON authors;

CREATE POLICY "public_read_active_authors" ON authors FOR SELECT
  TO anon, authenticated USING (is_active = true);

CREATE POLICY "auth_read_all_authors" ON authors FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "auth_insert_authors" ON authors FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY "auth_update_authors" ON authors FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "auth_delete_authors" ON authors FOR DELETE
  TO authenticated USING (true);

-- 10. Update RLS for comments (public reads approved only, auth reads all, auth moderates)
DROP POLICY IF EXISTS "public_read_comments" ON comments;
DROP POLICY IF EXISTS "public_insert_comments" ON comments;
DROP POLICY IF EXISTS "auth_read_all_comments" ON comments;
DROP POLICY IF EXISTS "auth_update_comments" ON comments;
DROP POLICY IF EXISTS "auth_delete_comments" ON comments;

-- Public can read approved comments
CREATE POLICY "public_read_approved_comments" ON comments FOR SELECT
  TO anon, authenticated USING (is_approved = true AND is_visible = true);

-- Authenticated can read all comments
CREATE POLICY "auth_read_all_comments" ON comments FOR SELECT
  TO authenticated USING (true);

-- Public can insert comments (with validation)
CREATE POLICY "public_insert_comments" ON comments FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    is_visible = true AND
    is_approved = true AND
    admin_reply = false AND
    length(TRIM(BOTH FROM author_name)) >= 2 AND
    length(TRIM(BOTH FROM author_name)) <= 50 AND
    POSITION('@' IN author_email) > 1 AND
    length(TRIM(BOTH FROM author_email)) >= 5 AND
    length(TRIM(BOTH FROM content)) >= 3 AND
    length(TRIM(BOTH FROM content)) <= 1000
  );

-- Authenticated can moderate (update is_approved, is_visible)
CREATE POLICY "auth_update_comments" ON comments FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

-- Authenticated can delete comments
CREATE POLICY "auth_delete_comments" ON comments FOR DELETE
  TO authenticated USING (true);

-- 11. Indexes for performance
CREATE INDEX IF NOT EXISTS idx_posts_status_published ON posts(status, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_scheduled ON posts(scheduled_at) WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS idx_related_articles_post_id ON related_articles(post_id);
CREATE INDEX IF NOT EXISTS idx_media_created_at ON media(created_at DESC);

-- 12. Add updated_at trigger for posts
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS posts_updated_at ON posts;
CREATE TRIGGER posts_updated_at BEFORE UPDATE ON posts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS authors_updated_at ON authors;
CREATE TRIGGER authors_updated_at BEFORE UPDATE ON authors
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
