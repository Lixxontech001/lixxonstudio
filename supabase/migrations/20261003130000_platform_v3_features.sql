/*
# Platform v3 — schema for the feature upgrade

Adds (all with RLS, following the hardened matrix):
- article_questions          Reader Q&A ("Ask the editor")
- article_series             Multi-part series with ordering
- glossary_terms             Hover-definitions inside articles
- user_profiles              Public reader profiles (signed-in users)
- user_bookmarks             Account-synced bookmarks
- user_badges                Reading challenges / achievements
- product_notifications      "Notify me" for restock / series
- headline_variants          A/B headline testing (impressions & clicks)
- currency_rates             Cached FX rates for multi-currency display
- email_queue                Outbound mail (digest, abandoned-cart, notify) processed by `send-emails` fn
- report_comment()           Community reporting with auto-hide
- posts: takeaways[], series_id, series_order, alt_title, faq jsonb
- products: pay_what_you_want, min_price_cents, compare_attributes jsonb, stock_status
- pg_cron jobs (only if the extension is available): scheduled publishing, keep-alive,
  abandoned-cart reminders, weekly digest enqueue, backup snapshot
*/

-- =====================================================================
-- POSTS / PRODUCTS COLUMNS
-- =====================================================================
ALTER TABLE posts ADD COLUMN IF NOT EXISTS takeaways text[] DEFAULT '{}';
ALTER TABLE posts ADD COLUMN IF NOT EXISTS alt_title text;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS faq jsonb DEFAULT '[]'::jsonb;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS series_id uuid;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS series_order integer;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS allow_comments boolean NOT NULL DEFAULT true;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS view_count integer NOT NULL DEFAULT 0;

ALTER TABLE products ADD COLUMN IF NOT EXISTS pay_what_you_want boolean NOT NULL DEFAULT false;
ALTER TABLE products ADD COLUMN IF NOT EXISTS min_price_cents integer;
ALTER TABLE products ADD COLUMN IF NOT EXISTS compare_attributes jsonb DEFAULT '{}'::jsonb;
ALTER TABLE products ADD COLUMN IF NOT EXISTS stock_status text NOT NULL DEFAULT 'in_stock' CHECK (stock_status IN ('in_stock','low','out_of_stock','coming_soon'));
ALTER TABLE products ADD COLUMN IF NOT EXISTS gallery text[] DEFAULT '{}';

-- =====================================================================
-- ARTICLE SERIES
-- =====================================================================
CREATE TABLE IF NOT EXISTS article_series (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  slug text UNIQUE NOT NULL,
  description text,
  cover_image text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE article_series ENABLE ROW LEVEL SECURITY;
CREATE POLICY article_series_public_read ON article_series FOR SELECT TO anon, authenticated USING (is_active = true);
CREATE POLICY article_series_admin_all ON article_series FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
DO $$ BEGIN
  ALTER TABLE posts ADD CONSTRAINT posts_series_fk FOREIGN KEY (series_id) REFERENCES article_series(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS posts_series_idx ON posts (series_id, series_order);

-- =====================================================================
-- GLOSSARY
-- =====================================================================
CREATE TABLE IF NOT EXISTS glossary_terms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  term text NOT NULL,
  slug text UNIQUE NOT NULL,
  definition text NOT NULL CHECK (char_length(definition) <= 600),
  category text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE glossary_terms ENABLE ROW LEVEL SECURITY;
CREATE POLICY glossary_public_read ON glossary_terms FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY glossary_admin_all ON glossary_terms FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
INSERT INTO glossary_terms (term, slug, definition, category) VALUES
  ('Ceramides', 'ceramides', 'Lipid molecules that make up about half of the skin barrier. They hold skin cells together and lock in moisture; depleted ceramides lead to dryness and sensitivity.', 'skincare'),
  ('Niacinamide', 'niacinamide', 'A form of vitamin B3 that supports the skin barrier, evens tone, regulates oil and calms redness. Well tolerated at 2–5%.', 'skincare'),
  ('TEWL', 'tewl', 'Trans-epidermal water loss: the evaporation of water through the skin. A compromised barrier raises TEWL, leaving skin tight and dull.', 'skincare'),
  ('Retinoid', 'retinoid', 'An umbrella term for vitamin A derivatives (retinol, retinal, tretinoin) that speed cell turnover and boost collagen. Introduce slowly and always pair with SPF.', 'skincare'),
  ('Capsule wardrobe', 'capsule-wardrobe', 'A deliberately small collection of versatile, high-quality garments that mix and match, reducing decision fatigue and over-consumption.', 'style'),
  ('Hyaluronic acid', 'hyaluronic-acid', 'A humectant that binds up to 1,000× its weight in water. Apply to damp skin and seal with a moisturiser to prevent it pulling water out of the skin.', 'skincare')
ON CONFLICT (slug) DO NOTHING;

-- =====================================================================
-- READER Q&A
-- =====================================================================
CREATE TABLE IF NOT EXISTS article_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  author_name text NOT NULL,
  author_email text NOT NULL,
  question text NOT NULL CHECK (char_length(question) BETWEEN 5 AND 1500),
  answer text,
  answered_by text,
  answered_at timestamptz,
  is_public boolean NOT NULL DEFAULT false,
  upvotes integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE article_questions ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS article_questions_post_idx ON article_questions (post_id, is_public);
-- public sees only published Q&As, and never the asker's email (use the view below)
CREATE POLICY aq_admin_all ON article_questions FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE OR REPLACE VIEW public_article_questions AS
  SELECT id, post_id, author_name, question, answer, answered_by, answered_at, upvotes, created_at
  FROM article_questions WHERE is_public = true AND answer IS NOT NULL;
GRANT SELECT ON public_article_questions TO anon, authenticated;

-- =====================================================================
-- USER ACCOUNTS (magic-link customers / readers)
-- =====================================================================
CREATE TABLE IF NOT EXISTS user_profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text CHECK (char_length(display_name) <= 60),
  handle text UNIQUE CHECK (handle ~ '^[a-z0-9_]{3,30}$'),
  bio text CHECK (char_length(bio) <= 280),
  is_public boolean NOT NULL DEFAULT false,
  preferred_categories text[] DEFAULT '{}',
  font_size text DEFAULT 'base',
  theme text DEFAULT 'system',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY profiles_public_read ON user_profiles FOR SELECT TO anon, authenticated USING (is_public = true OR user_id = auth.uid() OR is_admin());
CREATE POLICY profiles_self_insert ON user_profiles FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY profiles_self_update ON user_profiles FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY profiles_admin_all ON user_profiles FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

CREATE TABLE IF NOT EXISTS user_bookmarks (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, post_id)
);
ALTER TABLE user_bookmarks ENABLE ROW LEVEL SECURITY;
CREATE POLICY bookmarks_self ON user_bookmarks FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY bookmarks_public_profile ON user_bookmarks FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM user_profiles p WHERE p.user_id = user_bookmarks.user_id AND p.is_public));

CREATE TABLE IF NOT EXISTS user_badges (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  badge text NOT NULL,
  earned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, badge)
);
ALTER TABLE user_badges ENABLE ROW LEVEL SECURITY;
CREATE POLICY badges_self_read ON user_badges FOR SELECT TO authenticated USING (user_id = auth.uid() OR is_admin());
CREATE POLICY badges_public_profile ON user_badges FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM user_profiles p WHERE p.user_id = user_badges.user_id AND p.is_public));
-- badges are awarded by a SECURITY DEFINER function, not by the client
CREATE OR REPLACE FUNCTION award_badges()
RETURNS text[] LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); got text[] := '{}'; n integer; streak integer;
BEGIN
  IF uid IS NULL THEN RETURN got; END IF;
  SELECT count(DISTINCT post_id) INTO n FROM reading_sessions WHERE user_id = uid;
  IF n >= 1  THEN INSERT INTO user_badges VALUES (uid, 'first_read') ON CONFLICT DO NOTHING; END IF;
  IF n >= 10 THEN INSERT INTO user_badges VALUES (uid, 'ten_articles') ON CONFLICT DO NOTHING; END IF;
  IF n >= 50 THEN INSERT INTO user_badges VALUES (uid, 'fifty_articles') ON CONFLICT DO NOTHING; END IF;
  -- consecutive-day streak
  WITH d AS (SELECT DISTINCT read_date FROM reading_sessions WHERE user_id = uid),
       g AS (SELECT read_date, read_date - (row_number() OVER (ORDER BY read_date))::int AS grp FROM d)
  SELECT max(c) INTO streak FROM (SELECT count(*) c FROM g GROUP BY grp) s;
  IF COALESCE(streak,0) >= 7  THEN INSERT INTO user_badges VALUES (uid, 'streak_7')  ON CONFLICT DO NOTHING; END IF;
  IF COALESCE(streak,0) >= 30 THEN INSERT INTO user_badges VALUES (uid, 'streak_30') ON CONFLICT DO NOTHING; END IF;
  IF (SELECT count(*) FROM user_bookmarks WHERE user_id = uid) >= 5 THEN INSERT INTO user_badges VALUES (uid, 'curator') ON CONFLICT DO NOTHING; END IF;
  IF (SELECT count(*) FROM orders WHERE user_id = uid AND payment_status = 'paid') >= 1 THEN INSERT INTO user_badges VALUES (uid, 'patron') ON CONFLICT DO NOTHING; END IF;
  SELECT array_agg(badge) INTO got FROM user_badges WHERE user_id = uid;
  RETURN COALESCE(got, '{}');
END $$;
GRANT EXECUTE ON FUNCTION award_badges() TO authenticated;

-- signed-in readers may record their own sessions with user_id
DROP POLICY IF EXISTS reading_sessions_anon_insert ON reading_sessions;
CREATE POLICY reading_sessions_anon_insert ON reading_sessions FOR INSERT TO anon, authenticated WITH CHECK (user_id IS NULL OR user_id = auth.uid());

-- =====================================================================
-- NOTIFY ME
-- =====================================================================
CREATE TABLE IF NOT EXISTS product_notifications (
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  email text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  notified_at timestamptz,
  PRIMARY KEY (product_id, email)
);
ALTER TABLE product_notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY pn_admin_all ON product_notifications FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- =====================================================================
-- COMMENT REPORTING
-- =====================================================================
CREATE TABLE IF NOT EXISTS comment_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id uuid NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE comment_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY cr_admin_all ON comment_reports FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE OR REPLACE FUNCTION report_comment(p_comment_id uuid, p_reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO comment_reports (comment_id, reason) VALUES (p_comment_id, p_reason);
  UPDATE comments SET report_count = report_count + 1,
         is_visible = CASE WHEN report_count + 1 >= 5 THEN false ELSE is_visible END
   WHERE id = p_comment_id;
END $$;
REVOKE ALL ON FUNCTION report_comment(uuid, text) FROM public, anon, authenticated;

-- =====================================================================
-- A/B HEADLINES
-- =====================================================================
CREATE TABLE IF NOT EXISTS headline_variants (
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  variant text NOT NULL CHECK (variant IN ('a','b')),
  impressions integer NOT NULL DEFAULT 0,
  clicks integer NOT NULL DEFAULT 0,
  PRIMARY KEY (post_id, variant)
);
ALTER TABLE headline_variants ENABLE ROW LEVEL SECURITY;
CREATE POLICY hv_admin_all ON headline_variants FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE OR REPLACE FUNCTION track_headline(p_post_id uuid, p_variant text, p_event text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_variant NOT IN ('a','b') OR p_event NOT IN ('impression','click') THEN RETURN; END IF;
  INSERT INTO headline_variants (post_id, variant, impressions, clicks)
  VALUES (p_post_id, p_variant, (p_event='impression')::int, (p_event='click')::int)
  ON CONFLICT (post_id, variant) DO UPDATE
    SET impressions = headline_variants.impressions + (p_event='impression')::int,
        clicks = headline_variants.clicks + (p_event='click')::int;
END $$;
GRANT EXECUTE ON FUNCTION track_headline(uuid, text, text) TO anon, authenticated;

-- =====================================================================
-- CURRENCY RATES (refreshed by edge fn `refresh-rates` from a free public API)
-- =====================================================================
CREATE TABLE IF NOT EXISTS currency_rates (
  code text PRIMARY KEY,
  rate numeric(18,6) NOT NULL,      -- 1 USD = rate × code
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE currency_rates ENABLE ROW LEVEL SECURITY;
CREATE POLICY rates_public_read ON currency_rates FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY rates_admin_all ON currency_rates FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
INSERT INTO currency_rates (code, rate) VALUES ('USD', 1), ('NGN', 1550), ('GBP', 0.78), ('EUR', 0.92)
ON CONFLICT (code) DO NOTHING;

-- =====================================================================
-- EMAIL QUEUE (processed in batches by `send-emails` so we respect Resend's 100/day free limit)
-- =====================================================================
CREATE TABLE IF NOT EXISTS email_queue (
  id bigserial PRIMARY KEY,
  to_email text NOT NULL,
  subject text NOT NULL,
  html text NOT NULL,
  kind text NOT NULL,
  dedupe_key text UNIQUE,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed','skipped')),
  attempts integer NOT NULL DEFAULT 0,
  scheduled_for timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_queue_pending ON email_queue (status, scheduled_for);
ALTER TABLE email_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY eq_admin_read ON email_queue FOR SELECT TO authenticated USING (is_admin());

-- abandoned-cart reminders: enqueue once per cart, 24h after last update, only if email known
CREATE OR REPLACE FUNCTION enqueue_abandoned_cart_emails()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer := 0; r record; site text;
BEGIN
  SELECT COALESCE((value->>'url'), 'https://lixxonstudio.com') INTO site FROM site_settings WHERE key = 'site_url';
  site := COALESCE(site, 'https://lixxonstudio.com');
  FOR r IN
    SELECT id, email, cart_data FROM abandoned_carts
     WHERE recovered = false AND email IS NOT NULL
       AND updated_at BETWEEN now() - interval '3 days' AND now() - interval '24 hours'
       AND NOT EXISTS (SELECT 1 FROM email_queue q WHERE q.dedupe_key = 'cart:' || abandoned_carts.id)
  LOOP
    INSERT INTO email_queue (to_email, subject, html, kind, dedupe_key)
    VALUES (r.email, 'You left something behind',
      '<p>Your Lixxon Studio cart is still waiting. <a href="' || site || '/shop/cart?recover=' || r.id || '">Pick up where you left off →</a></p>',
      'abandoned_cart', 'cart:' || r.id);
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;

-- weekly digest: top 5 posts of the week → every active subscriber (one row per subscriber, deduped per ISO week)
CREATE OR REPLACE FUNCTION enqueue_weekly_digest()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer := 0; body text; wk text := to_char(now(), 'IYYY-IW'); r record; site text;
BEGIN
  SELECT COALESCE((value->>'url'), 'https://lixxonstudio.com') INTO site FROM site_settings WHERE key = 'site_url';
  site := COALESCE(site, 'https://lixxonstudio.com');
  SELECT string_agg(
    '<p style="margin:0 0 18px;"><a href="' || site || '/blog/' || p.slug || '" style="color:#1A1A1A;font-size:17px;text-decoration:none;font-weight:600;">' || p.title || '</a><br><span style="color:#5A5A5A;font-size:14px;">' || COALESCE(p.excerpt,'') || '</span></p>', '' ORDER BY v.c DESC)
  INTO body
  FROM posts p
  JOIN LATERAL (SELECT count(*) c FROM article_views av WHERE av.post_id = p.id AND av.created_at > now() - interval '7 days') v ON true
  WHERE p.status = 'published' AND p.published_at > now() - interval '30 days'
  LIMIT 5;
  IF body IS NULL THEN RETURN 0; END IF;
  FOR r IN SELECT email, unsubscribe_token FROM newsletter_subscribers WHERE status = 'active' LOOP
    INSERT INTO email_queue (to_email, subject, html, kind, dedupe_key)
    VALUES (r.email, 'This week at Lixxon Studio',
      body || '<p style="font-size:12px;color:#999;margin-top:32px;"><a href="' || site || '/newsletter/unsubscribe?token=' || r.unsubscribe_token || '" style="color:#999;">Unsubscribe</a></p>',
      'weekly_digest', 'digest:' || wk || ':' || r.email)
    ON CONFLICT (dedupe_key) DO NOTHING;
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;

-- scheduled publishing
CREATE OR REPLACE FUNCTION publish_scheduled_posts()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  UPDATE posts SET status = 'published', published_at = COALESCE(published_at, scheduled_at, now())
   WHERE status = 'scheduled' AND scheduled_at IS NOT NULL AND scheduled_at <= now();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- denormalised view counter (cheap "most read")
CREATE OR REPLACE FUNCTION bump_post_view()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE posts SET view_count = view_count + 1 WHERE id = NEW.post_id;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_bump_post_view ON article_views;
CREATE TRIGGER trg_bump_post_view AFTER INSERT ON article_views FOR EACH ROW EXECUTE FUNCTION bump_post_view();

-- lightweight daily backup snapshot (row counts + full JSON of small critical tables) into Storage-less table
CREATE TABLE IF NOT EXISTS backup_snapshots (
  id bigserial PRIMARY KEY,
  taken_at timestamptz NOT NULL DEFAULT now(),
  summary jsonb NOT NULL
);
ALTER TABLE backup_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY bs_admin_read ON backup_snapshots FOR SELECT TO authenticated USING (is_admin());
CREATE OR REPLACE FUNCTION take_backup_snapshot()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO backup_snapshots (summary) VALUES (jsonb_build_object(
    'posts', (SELECT count(*) FROM posts), 'orders', (SELECT count(*) FROM orders),
    'customers', (SELECT count(*) FROM customers), 'subscribers', (SELECT count(*) FROM newsletter_subscribers),
    'settings', (SELECT jsonb_agg(to_jsonb(s)) FROM site_settings s),
    'promo_codes', (SELECT jsonb_agg(to_jsonb(p)) FROM promo_codes p),
    'admins', (SELECT jsonb_agg(to_jsonb(a)) FROM app_admins a)
  ));
  DELETE FROM backup_snapshots WHERE taken_at < now() - interval '30 days';
END $$;

-- =====================================================================
-- pg_cron (free on Supabase). Skipped gracefully where unavailable (local tests).
-- =====================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
    PERFORM cron.unschedule(jobname) FROM cron.job WHERE jobname IN ('publish_scheduled','abandoned_carts','weekly_digest','backup_snapshot','keep_alive');
    PERFORM cron.schedule('publish_scheduled', '*/5 * * * *', $c$SELECT publish_scheduled_posts()$c$);
    PERFORM cron.schedule('abandoned_carts', '0 * * * *', $c$SELECT enqueue_abandoned_cart_emails()$c$);
    PERFORM cron.schedule('weekly_digest', '0 8 * * 1', $c$SELECT enqueue_weekly_digest()$c$);
    PERFORM cron.schedule('backup_snapshot', '0 3 * * *', $c$SELECT take_backup_snapshot()$c$);
    -- keeps the free project from pausing for inactivity
    PERFORM cron.schedule('keep_alive', '0 */6 * * *', $c$SELECT count(*) FROM site_settings$c$);
  ELSE
    RAISE NOTICE 'pg_cron not available — schedules skipped';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron setup skipped: %', SQLERRM;
END $$;

INSERT INTO site_settings (key, value, is_public) VALUES ('site_url', '{"url": "https://lixxonstudio.com"}', true) ON CONFLICT (key) DO NOTHING;

-- order metadata (gift-card purchases, pay-what-you-want amounts, etc.)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS meta jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE order_items ALTER COLUMN product_id DROP NOT NULL;
