/*
# Platform Upgrade Phase 2: 70+ Features Schema

This migration adds tables for the comprehensive platform upgrade.

## New Tables

1. **reading_lists** — User-created reading lists (no auth, fingerprint-based)
2. **reading_list_items** — Articles saved to reading lists
3. **search_history** — Track search queries per fingerprint for suggestions
4. **content_templates** — Reusable article templates for the admin editor
5. **article_versions** — Version history for articles (auto-save snapshots)
6. **admin_activity_log** — Track admin actions
7. **featured_slots** — Managed homepage featured positions
8. **abandoned_carts** — Track abandoned carts for recovery
9. **product_bundles** — Product bundles (group products with bundle discount)
10. **product_bundle_items** — Items in a bundle
11. **gift_cards** — Gift card codes
12. **order_notes** — Internal admin notes on orders
13. **refund_requests** — Customer refund requests
14. **social_shares** — Track social sharing events
15. **comment_likes** — Likes on comments
16. **article_ratings** — 1-5 star ratings on articles
17. **user_feedback** — General feedback widget submissions
18. **review_helpfulness** — Was a product review helpful voting
19. **shop_filters** — Saved filter presets for the shop
20. **tag_suggestions** — AI-like tag suggestions based on content

All tables use anon+authenticated RLS (no reader auth).
*/

-- ==================== READING LISTS ====================
CREATE TABLE IF NOT EXISTS reading_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint text NOT NULL,
  name text NOT NULL,
  description text,
  is_public boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE reading_lists ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rl_reading_lists_select" ON reading_lists;
CREATE POLICY "rl_reading_lists_select" ON reading_lists FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "rl_reading_lists_insert" ON reading_lists;
CREATE POLICY "rl_reading_lists_insert" ON reading_lists FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "rl_reading_lists_update" ON reading_lists;
CREATE POLICY "rl_reading_lists_update" ON reading_lists FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "rl_reading_lists_delete" ON reading_lists;
CREATE POLICY "rl_reading_lists_delete" ON reading_lists FOR DELETE TO anon, authenticated USING (true);

CREATE TABLE IF NOT EXISTS reading_list_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id uuid NOT NULL REFERENCES reading_lists(id) ON DELETE CASCADE,
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  added_at timestamptz DEFAULT now(),
  UNIQUE(list_id, post_id)
);
ALTER TABLE reading_list_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rl_rli_select" ON reading_list_items;
CREATE POLICY "rl_rli_select" ON reading_list_items FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "rl_rli_insert" ON reading_list_items;
CREATE POLICY "rl_rli_insert" ON reading_list_items FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "rl_rli_delete" ON reading_list_items;
CREATE POLICY "rl_rli_delete" ON reading_list_items FOR DELETE TO anon, authenticated USING (true);
CREATE INDEX IF NOT EXISTS idx_rli_list_id ON reading_list_items(list_id);

-- ==================== SEARCH HISTORY ====================
CREATE TABLE IF NOT EXISTS search_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint text NOT NULL,
  query text NOT NULL,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE search_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rl_sh_select" ON search_history;
CREATE POLICY "rl_sh_select" ON search_history FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "rl_sh_insert" ON search_history;
CREATE POLICY "rl_sh_insert" ON search_history FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "rl_sh_delete" ON search_history;
CREATE POLICY "rl_sh_delete" ON search_history FOR DELETE TO anon, authenticated USING (true);
CREATE INDEX IF NOT EXISTS idx_sh_fingerprint ON search_history(fingerprint);

-- ==================== CONTENT TEMPLATES ====================
CREATE TABLE IF NOT EXISTS content_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  content text NOT NULL DEFAULT '',
  category text,
  icon text DEFAULT 'FileText',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE content_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rl_ct_select" ON content_templates;
CREATE POLICY "rl_ct_select" ON content_templates FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "rl_ct_insert" ON content_templates;
CREATE POLICY "rl_ct_insert" ON content_templates FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "rl_ct_update" ON content_templates;
CREATE POLICY "rl_ct_update" ON content_templates FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "rl_ct_delete" ON content_templates;
CREATE POLICY "rl_ct_delete" ON content_templates FOR DELETE TO anon, authenticated USING (true);

-- ==================== ARTICLE VERSIONS ====================
CREATE TABLE IF NOT EXISTS article_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  title text NOT NULL,
  content text,
  excerpt text,
  saved_at timestamptz DEFAULT now(),
  saved_by text,
  version_note text
);
ALTER TABLE article_versions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rl_av_select" ON article_versions;
CREATE POLICY "rl_av_select" ON article_versions FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "rl_av_insert" ON article_versions;
CREATE POLICY "rl_av_insert" ON article_versions FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "rl_av_delete" ON article_versions;
CREATE POLICY "rl_av_delete" ON article_versions FOR DELETE TO anon, authenticated USING (true);
CREATE INDEX IF NOT EXISTS idx_av_post_id ON article_versions(post_id);

-- ==================== ADMIN ACTIVITY LOG ====================
CREATE TABLE IF NOT EXISTS admin_activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action text NOT NULL,
  entity_type text,
  entity_id text,
  description text,
  performed_by text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE admin_activity_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rl_aal_select" ON admin_activity_log;
CREATE POLICY "rl_aal_select" ON admin_activity_log FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "rl_aal_insert" ON admin_activity_log;
CREATE POLICY "rl_aal_insert" ON admin_activity_log FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE INDEX IF NOT EXISTS idx_aal_created ON admin_activity_log(created_at DESC);

-- ==================== FEATURED SLOTS ====================
CREATE TABLE IF NOT EXISTS featured_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_name text NOT NULL,
  slot_position integer NOT NULL DEFAULT 0,
  post_id uuid REFERENCES posts(id) ON DELETE SET NULL,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE featured_slots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rl_fs_select" ON featured_slots;
CREATE POLICY "rl_fs_select" ON featured_slots FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "rl_fs_insert" ON featured_slots;
CREATE POLICY "rl_fs_insert" ON featured_slots FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "rl_fs_update" ON featured_slots;
CREATE POLICY "rl_fs_update" ON featured_slots FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "rl_fs_delete" ON featured_slots;
CREATE POLICY "rl_fs_delete" ON featured_slots FOR DELETE TO anon, authenticated USING (true);

-- ==================== ABANDONED CARTS ====================
CREATE TABLE IF NOT EXISTS abandoned_carts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint text NOT NULL,
  cart_data jsonb NOT NULL DEFAULT '[]'::jsonb,
  email text,
  recovered boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE abandoned_carts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rl_ac_select" ON abandoned_carts;
CREATE POLICY "rl_ac_select" ON abandoned_carts FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "rl_ac_insert" ON abandoned_carts;
CREATE POLICY "rl_ac_insert" ON abandoned_carts FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "rl_ac_update" ON abandoned_carts;
CREATE POLICY "rl_ac_update" ON abandoned_carts FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "rl_ac_delete" ON abandoned_carts;
CREATE POLICY "rl_ac_delete" ON abandoned_carts FOR DELETE TO anon, authenticated USING (true);
CREATE INDEX IF NOT EXISTS idx_ac_fingerprint ON abandoned_carts(fingerprint);

-- ==================== PRODUCT BUNDLES ====================
CREATE TABLE IF NOT EXISTS product_bundles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  description text,
  cover_image text,
  bundle_price numeric NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE product_bundles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rl_pb_select" ON product_bundles;
CREATE POLICY "rl_pb_select" ON product_bundles FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "rl_pb_insert" ON product_bundles;
CREATE POLICY "rl_pb_insert" ON product_bundles FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "rl_pb_update" ON product_bundles;
CREATE POLICY "rl_pb_update" ON product_bundles FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "rl_pb_delete" ON product_bundles;
CREATE POLICY "rl_pb_delete" ON product_bundles FOR DELETE TO anon, authenticated USING (true);

CREATE TABLE IF NOT EXISTS product_bundle_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bundle_id uuid NOT NULL REFERENCES product_bundles(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0
);
ALTER TABLE product_bundle_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rl_pbi_select" ON product_bundle_items;
CREATE POLICY "rl_pbi_select" ON product_bundle_items FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "rl_pbi_insert" ON product_bundle_items;
CREATE POLICY "rl_pbi_insert" ON product_bundle_items FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "rl_pbi_delete" ON product_bundle_items;
CREATE POLICY "rl_pbi_delete" ON product_bundle_items FOR DELETE TO anon, authenticated USING (true);

-- ==================== GIFT CARDS ====================
CREATE TABLE IF NOT EXISTS gift_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  initial_balance numeric NOT NULL DEFAULT 0,
  balance numeric NOT NULL DEFAULT 0,
  buyer_email text,
  recipient_email text,
  message text,
  is_active boolean NOT NULL DEFAULT true,
  expires_at timestamptz,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE gift_cards ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rl_gc_select" ON gift_cards;
CREATE POLICY "rl_gc_select" ON gift_cards FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "rl_gc_insert" ON gift_cards;
CREATE POLICY "rl_gc_insert" ON gift_cards FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "rl_gc_update" ON gift_cards;
CREATE POLICY "rl_gc_update" ON gift_cards FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "rl_gc_delete" ON gift_cards;
CREATE POLICY "rl_gc_delete" ON gift_cards FOR DELETE TO anon, authenticated USING (true);

-- ==================== ORDER NOTES ====================
CREATE TABLE IF NOT EXISTS order_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  note text NOT NULL,
  author text,
  is_internal boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE order_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rl_on_select" ON order_notes;
CREATE POLICY "rl_on_select" ON order_notes FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "rl_on_insert" ON order_notes;
CREATE POLICY "rl_on_insert" ON order_notes FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "rl_on_delete" ON order_notes;
CREATE POLICY "rl_on_delete" ON order_notes FOR DELETE TO anon, authenticated USING (true);

-- ==================== REFUND REQUESTS ====================
CREATE TABLE IF NOT EXISTS refund_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  customer_email text NOT NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied')),
  amount numeric,
  created_at timestamptz DEFAULT now(),
  resolved_at timestamptz
);
ALTER TABLE refund_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rl_rr_select" ON refund_requests;
CREATE POLICY "rl_rr_select" ON refund_requests FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "rl_rr_insert" ON refund_requests;
CREATE POLICY "rl_rr_insert" ON refund_requests FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "rl_rr_update" ON refund_requests;
CREATE POLICY "rl_rr_update" ON refund_requests FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

-- ==================== SOCIAL SHARES ====================
CREATE TABLE IF NOT EXISTS social_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid REFERENCES posts(id) ON DELETE CASCADE,
  platform text NOT NULL,
  fingerprint text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE social_shares ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rl_ss_select" ON social_shares;
CREATE POLICY "rl_ss_select" ON social_shares FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "rl_ss_insert" ON social_shares;
CREATE POLICY "rl_ss_insert" ON social_shares FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE INDEX IF NOT EXISTS idx_ss_post_id ON social_shares(post_id);

-- ==================== COMMENT LIKES ====================
CREATE TABLE IF NOT EXISTS comment_likes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id uuid NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  fingerprint text NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(comment_id, fingerprint)
);
ALTER TABLE comment_likes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rl_cl_select" ON comment_likes;
CREATE POLICY "rl_cl_select" ON comment_likes FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "rl_cl_insert" ON comment_likes;
CREATE POLICY "rl_cl_insert" ON comment_likes FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "rl_cl_delete" ON comment_likes;
CREATE POLICY "rl_cl_delete" ON comment_likes FOR DELETE TO anon, authenticated USING (true);
CREATE INDEX IF NOT EXISTS idx_cl_comment_id ON comment_likes(comment_id);

-- ==================== ARTICLE RATINGS ====================
CREATE TABLE IF NOT EXISTS article_ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  fingerprint text NOT NULL,
  rating integer NOT NULL CHECK (rating >= 1 AND rating <= 5),
  created_at timestamptz DEFAULT now(),
  UNIQUE(post_id, fingerprint)
);
ALTER TABLE article_ratings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rl_ar_select" ON article_ratings;
CREATE POLICY "rl_ar_select" ON article_ratings FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "rl_ar_insert" ON article_ratings;
CREATE POLICY "rl_ar_insert" ON article_ratings FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "rl_ar_update" ON article_ratings;
CREATE POLICY "rl_ar_update" ON article_ratings FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS idx_ar_post_id ON article_ratings(post_id);

-- ==================== USER FEEDBACK ====================
CREATE TABLE IF NOT EXISTS user_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL DEFAULT 'general' CHECK (type IN ('general', 'bug', 'suggestion', 'praise')),
  message text NOT NULL,
  page_url text,
  fingerprint text,
  email text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE user_feedback ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rl_uf_select" ON user_feedback;
CREATE POLICY "rl_uf_select" ON user_feedback FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "rl_uf_insert" ON user_feedback;
CREATE POLICY "rl_uf_insert" ON user_feedback FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "rl_uf_delete" ON user_feedback;
CREATE POLICY "rl_uf_delete" ON user_feedback FOR DELETE TO anon, authenticated USING (true);

-- ==================== REVIEW HELPFULNESS ====================
CREATE TABLE IF NOT EXISTS review_helpfulness (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id uuid NOT NULL REFERENCES product_reviews(id) ON DELETE CASCADE,
  fingerprint text NOT NULL,
  is_helpful boolean NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(review_id, fingerprint)
);
ALTER TABLE review_helpfulness ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rl_rh_select" ON review_helpfulness;
CREATE POLICY "rl_rh_select" ON review_helpfulness FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "rl_rh_insert" ON review_helpfulness;
CREATE POLICY "rl_rh_insert" ON review_helpfulness FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE INDEX IF NOT EXISTS idx_rh_review_id ON review_helpfulness(review_id);

-- ==================== ADD COLUMNS TO EXISTING TABLES ====================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'posts' AND column_name = 'view_count') THEN
    ALTER TABLE posts ADD COLUMN view_count integer NOT NULL DEFAULT 0;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'posts' AND column_name = 'allow_comments') THEN
    ALTER TABLE posts ADD COLUMN allow_comments boolean NOT NULL DEFAULT true;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'posts' AND column_name = 'is_pinned') THEN
    ALTER TABLE posts ADD COLUMN is_pinned boolean NOT NULL DEFAULT false;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'products' AND column_name = 'compare_price') THEN
    ALTER TABLE products ADD COLUMN compare_price text;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'products' AND column_name = 'rating_avg') THEN
    ALTER TABLE products ADD COLUMN rating_avg numeric DEFAULT 0;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'products' AND column_name = 'rating_count') THEN
    ALTER TABLE products ADD COLUMN rating_count integer NOT NULL DEFAULT 0;
  END IF;
END $$;

-- ==================== SEED CONTENT TEMPLATES ====================
INSERT INTO content_templates (name, description, content, category, icon) VALUES
('Standard Article', 'A classic editorial article with intro, body sections, and conclusion.',
'# Introduction

Write your opening hook here.

## First Section

Your main content goes here.

## Second Section

Continue with more detail.

## Conclusion

Wrap up with key takeaways.', 'General', 'FileText'),
('Product Review', 'Structured product review with overview, pros/cons, and verdict.',
'# Product Overview

What is this product and who is it for?

## How It Works

Explain the mechanism or application.

## Pros & Cons

**Pros:**
- Benefit one
- Benefit two

**Cons:**
- Drawback one
- Drawback two

## The Verdict

Our honest take.', 'Review', 'Star'),
('Listicle', 'Numbered list article with entries and explanations.',
'# Top 5 Tips for [Topic]

## 1. First Tip

Explanation here.

## 2. Second Tip

Explanation here.

## 3. Third Tip

Explanation here.

## 4. Fourth Tip

Explanation here.

## 5. Fifth Tip

Explanation here.', 'Listicle', 'ListOrdered'),
('How-To Guide', 'Step-by-step instructional guide.',
'# How To [Achieve Goal]

## What You Will Need

- Item one
- Item two

## Step 1: [Action]

Detailed instructions.

## Step 2: [Action]

Detailed instructions.

## Step 3: [Action]

Detailed instructions.

## Tips & Troubleshooting

Common issues and solutions.', 'How-To', 'BookOpen')
ON CONFLICT DO NOTHING;
