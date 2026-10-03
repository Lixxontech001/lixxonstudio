/*
# Create editorial blog schema for Lixxon Studio

## Overview
Creates a complete luxury digital magazine backend: categories, authors, posts, and recommended products.
All tables are public-readable (no auth) so the anon-key frontend can fetch content freely.

## New Tables

### categories
- id (uuid, PK)
- name (text, unique, not null), e.g. "Skincare", "Style", "Wellness"
- slug (text, unique, not null), URL-safe identifier
- description (text), optional category tagline
- sort_order (int, default 0), display ordering
- created_at (timestamptz)

### authors
- id (uuid, PK)
- name (text, not null)
- slug (text, unique, not null)
- bio (text)
- avatar_url (text)
- role (text), e.g. "Beauty Editor", "Wellness Director"
- created_at (timestamptz)

### posts
- id (uuid, PK)
- title (text, not null)
- slug (text, unique, not null)
- excerpt (text), 1-2 line preview
- content (text), full article body (HTML or markdown-style text)
- cover_image (text), URL to cover photo
- category_id (uuid, FK to categories)
- author_id (uuid, FK to authors)
- published_at (timestamptz), publication date
- reading_time_minutes (int, default 5)
- featured (boolean, default false), show in hero
- editors_pick (boolean, default false), show in Editor's Picks
- tags (text[]), optional tag list
- created_at (timestamptz)

### products
- id (uuid, PK)
- name (text, not null)
- brand (text)
- description (text)
- image_url (text)
- price (text), display string e.g. "$48"
- affiliate_url (text), link to purchase
- category (text), "skincare", "wellness", etc.
- created_at (timestamptz)

## Security
- RLS enabled on all tables.
- All tables are public-readable (TO anon, authenticated) since this is a no-auth editorial blog.
- No write policies needed from the frontend (content is managed via Supabase dashboard).
*/

CREATE TABLE IF NOT EXISTS categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  slug text UNIQUE NOT NULL,
  description text,
  sort_order int DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS authors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  bio text,
  avatar_url text,
  role text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  slug text UNIQUE NOT NULL,
  excerpt text,
  content text,
  cover_image text,
  category_id uuid REFERENCES categories(id) ON DELETE SET NULL,
  author_id uuid REFERENCES authors(id) ON DELETE SET NULL,
  published_at timestamptz DEFAULT now(),
  reading_time_minutes int DEFAULT 5,
  featured boolean DEFAULT false,
  editors_pick boolean DEFAULT false,
  tags text[] DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  brand text,
  description text,
  image_url text,
  price text,
  affiliate_url text,
  category text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE authors ENABLE ROW LEVEL SECURITY;
ALTER TABLE posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public_read_categories" ON categories;
CREATE POLICY "public_read_categories" ON categories FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "public_read_authors" ON authors;
CREATE POLICY "public_read_authors" ON authors FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "public_read_posts" ON posts;
CREATE POLICY "public_read_posts" ON posts FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "public_read_products" ON products;
CREATE POLICY "public_read_products" ON products FOR SELECT
  TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_posts_category_id ON posts(category_id);
CREATE INDEX IF NOT EXISTS idx_posts_published_at ON posts(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_featured ON posts(featured) WHERE featured = true;
CREATE INDEX IF NOT EXISTS idx_posts_editors_pick ON posts(editors_pick) WHERE editors_pick = true;
CREATE INDEX IF NOT EXISTS idx_posts_slug ON posts(slug);
CREATE INDEX IF NOT EXISTS idx_categories_sort_order ON categories(sort_order);
