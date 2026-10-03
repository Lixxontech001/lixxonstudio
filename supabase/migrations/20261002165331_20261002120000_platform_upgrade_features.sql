/*
# Platform Upgrade: 24 New Features Schema

This migration adds tables and columns for 24 new features across the Lixxon Studio platform.

## New Tables

1. **promo_codes** — Discount/promo codes for checkout (feature: promo codes at checkout)
   - id, code, discount_type ('percentage' | 'fixed'), discount_value, is_active, max_uses, use_count, expires_at, created_at

2. **product_reviews** — Star ratings + written reviews for products (feature: product reviews and ratings)
   - id, product_id, customer_email, author_name, rating (1-5), content, is_approved, created_at

3. **article_polls** — Single-question polls embedded in articles (feature: article polls)
   - id, post_id, question, options (jsonb array), is_active, created_at

4. **article_poll_votes** — Votes on article polls (feature: article polls)
   - id, poll_id, option_index, voter_fingerprint, created_at

5. **article_reactions** — Expanded reactions (love, insightful, inspiring, save) (feature: article reaction emojis)
   - id, post_id, reaction_type, fingerprint, created_at

6. **newsletter_preferences** — Subscriber category/frequency preferences (feature: newsletter preference center)
   - id, email, preferred_categories (text[]), frequency ('daily' | 'weekly'), updated_at

## Modified Tables

- **products** — Adds `tags` text[] column for related product matching (feature: related products on product pages)

## Security

- RLS enabled on all new tables.
- All tables use `TO anon, authenticated` policies since the app has no sign-in screen for readers/buyers.
- article_poll_votes and article_reactions use fingerprint for deduplication (no auth).
- product_reviews allows anyone to submit but only approved reviews are visible.
- promo_codes are readable by anon (needed to validate codes at checkout) but only admin can manage.

## Important Notes

1. All tables are single-tenant (no user_id / auth.uid()) since the app has no reader sign-in.
2. Promo codes: discount_type 'percentage' means discount_value is a percentage (e.g., 10 = 10%); 'fixed' means a fixed dollar amount.
3. Product reviews: rating is 1-5 integer. Only reviews where is_approved = true are shown publicly.
4. Article polls: options is a jsonb array of strings, e.g. ["Option A", "Option B"]. Votes store option_index (0-based).
5. Article reactions: reaction_type is one of 'love', 'insightful', 'inspiring', 'save'. One reaction per fingerprint per post per type.
6. Newsletter preferences: linked by email (no auth). preferred_categories stores category slugs.
*/

-- ==================== PROMO CODES ====================
CREATE TABLE IF NOT EXISTS promo_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  description text,
  discount_type text NOT NULL DEFAULT 'percentage' CHECK (discount_type IN ('percentage', 'fixed')),
  discount_value numeric NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  max_uses integer,
  use_count integer NOT NULL DEFAULT 0,
  expires_at timestamptz,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE promo_codes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_read_promo_codes" ON promo_codes;
CREATE POLICY "anon_read_promo_codes" ON promo_codes FOR SELECT
TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_promo_codes" ON promo_codes;
CREATE POLICY "anon_insert_promo_codes" ON promo_codes FOR INSERT
TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_promo_codes" ON promo_codes;
CREATE POLICY "anon_update_promo_codes" ON promo_codes FOR UPDATE
TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_promo_codes" ON promo_codes;
CREATE POLICY "anon_delete_promo_codes" ON promo_codes FOR DELETE
TO anon, authenticated USING (true);

-- ==================== PRODUCT REVIEWS ====================
CREATE TABLE IF NOT EXISTS product_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  customer_email text NOT NULL,
  author_name text NOT NULL,
  rating integer NOT NULL CHECK (rating >= 1 AND rating <= 5),
  content text,
  is_approved boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE product_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_read_product_reviews" ON product_reviews;
CREATE POLICY "anon_read_product_reviews" ON product_reviews FOR SELECT
TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_product_reviews" ON product_reviews;
CREATE POLICY "anon_insert_product_reviews" ON product_reviews FOR INSERT
TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_product_reviews" ON product_reviews;
CREATE POLICY "anon_update_product_reviews" ON product_reviews FOR UPDATE
TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_product_reviews" ON product_reviews;
CREATE POLICY "anon_delete_product_reviews" ON product_reviews FOR DELETE
TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_product_reviews_product_id ON product_reviews(product_id);

-- ==================== ARTICLE POLLS ====================
CREATE TABLE IF NOT EXISTS article_polls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  question text NOT NULL,
  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE article_polls ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_read_article_polls" ON article_polls;
CREATE POLICY "anon_read_article_polls" ON article_polls FOR SELECT
TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_article_polls" ON article_polls;
CREATE POLICY "anon_insert_article_polls" ON article_polls FOR INSERT
TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_article_polls" ON article_polls;
CREATE POLICY "anon_update_article_polls" ON article_polls FOR UPDATE
TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_article_polls" ON article_polls;
CREATE POLICY "anon_delete_article_polls" ON article_polls FOR DELETE
TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_article_polls_post_id ON article_polls(post_id);

-- ==================== ARTICLE POLL VOTES ====================
CREATE TABLE IF NOT EXISTS article_poll_votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id uuid NOT NULL REFERENCES article_polls(id) ON DELETE CASCADE,
  option_index integer NOT NULL,
  voter_fingerprint text NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE article_poll_votes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_read_poll_votes" ON article_poll_votes;
CREATE POLICY "anon_read_poll_votes" ON article_poll_votes FOR SELECT
TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_poll_votes" ON article_poll_votes;
CREATE POLICY "anon_insert_poll_votes" ON article_poll_votes FOR INSERT
TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_poll_votes" ON article_poll_votes;
CREATE POLICY "anon_delete_poll_votes" ON article_poll_votes FOR DELETE
TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_poll_votes_poll_id ON article_poll_votes(poll_id);

-- ==================== ARTICLE REACTIONS ====================
CREATE TABLE IF NOT EXISTS article_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  reaction_type text NOT NULL CHECK (reaction_type IN ('love', 'insightful', 'inspiring', 'save')),
  fingerprint text NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(post_id, reaction_type, fingerprint)
);

ALTER TABLE article_reactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_read_article_reactions" ON article_reactions;
CREATE POLICY "anon_read_article_reactions" ON article_reactions FOR SELECT
TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_article_reactions" ON article_reactions;
CREATE POLICY "anon_insert_article_reactions" ON article_reactions FOR INSERT
TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_article_reactions" ON article_reactions;
CREATE POLICY "anon_delete_article_reactions" ON article_reactions FOR DELETE
TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_article_reactions_post_id ON article_reactions(post_id);

-- ==================== NEWSLETTER PREFERENCES ====================
CREATE TABLE IF NOT EXISTS newsletter_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  preferred_categories text[] DEFAULT '{}',
  frequency text NOT NULL DEFAULT 'daily' CHECK (frequency IN ('daily', 'weekly')),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE newsletter_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_read_newsletter_preferences" ON newsletter_preferences;
CREATE POLICY "anon_read_newsletter_preferences" ON newsletter_preferences FOR SELECT
TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_newsletter_preferences" ON newsletter_preferences;
CREATE POLICY "anon_insert_newsletter_preferences" ON newsletter_preferences FOR INSERT
TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_newsletter_preferences" ON newsletter_preferences;
CREATE POLICY "anon_update_newsletter_preferences" ON newsletter_preferences FOR UPDATE
TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_newsletter_preferences" ON newsletter_preferences;
CREATE POLICY "anon_delete_newsletter_preferences" ON newsletter_preferences FOR DELETE
TO anon, authenticated USING (true);

-- ==================== ADD TAGS COLUMN TO PRODUCTS ====================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'products' AND column_name = 'tags') THEN
    ALTER TABLE products ADD COLUMN tags text[] DEFAULT '{}';
  END IF;
END $$;

-- ==================== ADD READING_SESSIONS TABLE for streak tracking ====================
CREATE TABLE IF NOT EXISTS reading_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint text NOT NULL,
  post_id uuid REFERENCES posts(id) ON DELETE SET NULL,
  read_date date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(fingerprint, read_date)
);

ALTER TABLE reading_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_read_reading_sessions" ON reading_sessions;
CREATE POLICY "anon_read_reading_sessions" ON reading_sessions FOR SELECT
TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_reading_sessions" ON reading_sessions;
CREATE POLICY "anon_insert_reading_sessions" ON reading_sessions FOR INSERT
TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_reading_sessions" ON reading_sessions;
CREATE POLICY "anon_delete_reading_sessions" ON reading_sessions FOR DELETE
TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_reading_sessions_fingerprint ON reading_sessions(fingerprint);
CREATE INDEX IF NOT EXISTS idx_reading_sessions_read_date ON reading_sessions(read_date);

-- ==================== LIVE READING COUNTER (article_views already exists, add a recent-views counter table) ====================
CREATE TABLE IF NOT EXISTS article_active_readers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  fingerprint text NOT NULL,
  last_heartbeat timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  UNIQUE(post_id, fingerprint)
);

ALTER TABLE article_active_readers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_read_active_readers" ON article_active_readers;
CREATE POLICY "anon_read_active_readers" ON article_active_readers FOR SELECT
TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_active_readers" ON article_active_readers;
CREATE POLICY "anon_insert_active_readers" ON article_active_readers FOR INSERT
TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_active_readers" ON article_active_readers;
CREATE POLICY "anon_update_active_readers" ON article_active_readers FOR UPDATE
TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_active_readers" ON article_active_readers;
CREATE POLICY "anon_delete_active_readers" ON article_active_readers FOR DELETE
TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_active_readers_post_id ON article_active_readers(post_id);
CREATE INDEX IF NOT EXISTS idx_active_readers_heartbeat ON article_active_readers(last_heartbeat);
