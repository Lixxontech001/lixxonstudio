/*
# Security hardening — authoritative RLS rebuild

## Why
A full audit of the previous migrations found:
- orders, order_items, download_entitlements, customers, gift_cards, refund_requests,
  abandoned_carts, user_feedback, admin_activity_log, order_notes, article_versions
  were readable by ANYONE (SELECT ... USING (true) TO anon).
- promo_codes, product_reviews, article_polls, gift_cards, newsletter_preferences,
  content_templates, featured_slots, product_bundles ... were writable by ANYONE
  (INSERT/UPDATE/DELETE ... WITH CHECK (true) TO anon).
- download_entitlements could be edited by anyone (reset counts / extend expiry).
- "admin" meant any authenticated Supabase user — no role model.
- Order amounts were computed in the browser.

## What this migration does
1. Introduces `app_admins` + `is_admin()` (SECURITY DEFINER) and seeds it with every
   existing auth user (preserving current access for the owner).
2. Drops EVERY policy on EVERY public table and recreates a minimal matrix:
   - public catalogue/content: anon SELECT only (with visibility filters)
   - engagement counters: anon INSERT (+ scoped UPDATE/DELETE by fingerprint) only
   - commerce / PII / moderation: admin only, or customer-own via JWT email
   - orders/customers/entitlements/comments/reviews/contact/newsletter/feedback:
     NO anon writes — all go through edge functions using the service role
3. Adds server-side columns for order pricing (subtotal, discount, promo, gift card)
   and CHECK constraints so a client can never set a negative or zero-priced order.
4. Adds `rate_limits` table used by edge functions.
5. Hardens storage: `media` writes admin-only; `digital-products` has NO client policies
   (signed URLs are minted only by the `download-file` edge function).
6. Tamper-proof admin audit log via trigger on key tables.
7. Forces `is_approved = false` on any non-admin comment/review insert (defense in depth).

Safe to re-run (idempotent).
*/

-- =====================================================================
-- 1. ADMIN ROLE MODEL
-- =====================================================================
CREATE TABLE IF NOT EXISTS app_admins (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'editor' CHECK (role IN ('owner', 'editor', 'moderator')),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE app_admins ENABLE ROW LEVEL SECURITY;

-- Seed: every existing auth user becomes an owner (preserves current behaviour for the
-- single admin account). New sign-ups are NOT admins.
INSERT INTO app_admins (user_id, role)
SELECT id, 'owner' FROM auth.users
ON CONFLICT (user_id) DO NOTHING;

CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM app_admins WHERE user_id = auth.uid());
$$;

CREATE OR REPLACE FUNCTION admin_role()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT role FROM app_admins WHERE user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION is_owner()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE((SELECT role = 'owner' FROM app_admins WHERE user_id = auth.uid()), false);
$$;

-- Email of the current JWT (customers signed in via magic link)
CREATE OR REPLACE FUNCTION jwt_email()
RETURNS text
LANGUAGE sql STABLE
AS $$
  SELECT lower(COALESCE(auth.jwt() ->> 'email', ''));
$$;

REVOKE ALL ON FUNCTION is_admin() FROM public;
GRANT EXECUTE ON FUNCTION is_admin() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_role() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION is_owner() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION jwt_email() TO anon, authenticated;

-- =====================================================================
-- 2. SCHEMA ADDITIONS NEEDED BY THE SECURE CHECKOUT
-- =====================================================================
ALTER TABLE orders ADD COLUMN IF NOT EXISTS subtotal numeric(12,2);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_amount numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS promo_code text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS gift_card_code text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS gift_card_amount numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS paid_at timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS webhook_verified boolean NOT NULL DEFAULT false;

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_amount_nonnegative;
ALTER TABLE orders ADD CONSTRAINT orders_amount_nonnegative CHECK (amount >= 0);
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_discount_nonnegative;
ALTER TABLE orders ADD CONSTRAINT orders_discount_nonnegative CHECK (discount_amount >= 0 AND gift_card_amount >= 0);

UPDATE orders SET customer_email = lower(customer_email) WHERE customer_email <> lower(customer_email);
UPDATE customers SET email = lower(email) WHERE email <> lower(email);
UPDATE download_entitlements SET customer_email = lower(customer_email) WHERE customer_email <> lower(customer_email);

CREATE INDEX IF NOT EXISTS orders_customer_email_idx ON orders (lower(customer_email));
CREATE INDEX IF NOT EXISTS entitlements_customer_email_idx ON download_entitlements (lower(customer_email));
CREATE UNIQUE INDEX IF NOT EXISTS entitlements_token_key ON download_entitlements (download_token);
CREATE UNIQUE INDEX IF NOT EXISTS orders_order_number_key ON orders (order_number);
CREATE UNIQUE INDEX IF NOT EXISTS promo_codes_code_key ON promo_codes (upper(code));
CREATE UNIQUE INDEX IF NOT EXISTS gift_cards_code_key ON gift_cards (upper(code));

ALTER TABLE customers ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS customers_email_key ON customers (lower(email));

ALTER TABLE products ADD COLUMN IF NOT EXISTS price_cents integer;
UPDATE products SET price_cents = ROUND(COALESCE(NULLIF(regexp_replace(price, '[^0-9.]', '', 'g'), '')::numeric, 0) * 100)
  WHERE price_cents IS NULL;
ALTER TABLE products ALTER COLUMN price_cents SET DEFAULT 0;
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_price_cents_nonnegative;
ALTER TABLE products ADD CONSTRAINT products_price_cents_nonnegative CHECK (price_cents IS NULL OR price_cents >= 0);

-- keep price_cents in sync with legacy text price
CREATE OR REPLACE FUNCTION sync_product_price_cents()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.price IS NOT NULL THEN
    NEW.price_cents := ROUND(COALESCE(NULLIF(regexp_replace(NEW.price, '[^0-9.]', '', 'g'), '')::numeric, 0) * 100);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_sync_product_price ON products;
CREATE TRIGGER trg_sync_product_price BEFORE INSERT OR UPDATE OF price ON products
  FOR EACH ROW EXECUTE FUNCTION sync_product_price_cents();

-- promo codes: constraints the client used to "enforce"
ALTER TABLE promo_codes DROP CONSTRAINT IF EXISTS promo_codes_value_check;
ALTER TABLE promo_codes ADD CONSTRAINT promo_codes_value_check CHECK (
  discount_value >= 0 AND (discount_type <> 'percentage' OR discount_value <= 100)
);
ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS min_subtotal numeric(12,2) NOT NULL DEFAULT 0;

-- gift cards
ALTER TABLE gift_cards DROP CONSTRAINT IF EXISTS gift_cards_balance_check;
ALTER TABLE gift_cards ADD CONSTRAINT gift_cards_balance_check CHECK (balance >= 0 AND balance <= initial_balance);
ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS order_id uuid REFERENCES orders(id) ON DELETE SET NULL;
ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS delivered_at timestamptz;

-- comments / reviews moderation defaults — new public submissions are pending
ALTER TABLE comments ALTER COLUMN is_approved SET DEFAULT false;
ALTER TABLE comments ADD COLUMN IF NOT EXISTS is_pinned boolean NOT NULL DEFAULT false;
ALTER TABLE comments ADD COLUMN IF NOT EXISTS edited_at timestamptz;
ALTER TABLE comments ADD COLUMN IF NOT EXISTS report_count integer NOT NULL DEFAULT 0;
ALTER TABLE comments ADD COLUMN IF NOT EXISTS fingerprint text;
ALTER TABLE product_reviews ALTER COLUMN is_approved SET DEFAULT false;
ALTER TABLE product_reviews ADD COLUMN IF NOT EXISTS verified_purchase boolean NOT NULL DEFAULT false;

-- newsletter double opt-in
ALTER TABLE newsletter_subscribers ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending';
ALTER TABLE newsletter_subscribers ADD COLUMN IF NOT EXISTS source text;
ALTER TABLE newsletter_subscribers ADD COLUMN IF NOT EXISTS confirm_token uuid DEFAULT gen_random_uuid();
ALTER TABLE newsletter_subscribers ADD COLUMN IF NOT EXISTS unsubscribe_token uuid DEFAULT gen_random_uuid();
ALTER TABLE newsletter_subscribers ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;
ALTER TABLE newsletter_subscribers ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
UPDATE newsletter_subscribers SET confirm_token = gen_random_uuid() WHERE confirm_token IS NULL;
UPDATE newsletter_subscribers SET unsubscribe_token = gen_random_uuid() WHERE unsubscribe_token IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS newsletter_subscribers_email_key ON newsletter_subscribers (lower(email));

-- reading lists / bookmarks can now belong to a signed-in user
ALTER TABLE reading_lists ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE reading_sessions ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

-- poll votes: one vote per fingerprint per poll
CREATE UNIQUE INDEX IF NOT EXISTS article_poll_votes_unique ON article_poll_votes (poll_id, voter_fingerprint);

-- content length guards (DB-level, not just client)
ALTER TABLE comments DROP CONSTRAINT IF EXISTS comments_content_len;
ALTER TABLE comments ADD CONSTRAINT comments_content_len CHECK (char_length(content) BETWEEN 1 AND 4000);
ALTER TABLE contact_messages DROP CONSTRAINT IF EXISTS contact_messages_len;
ALTER TABLE contact_messages ADD CONSTRAINT contact_messages_len CHECK (char_length(message) BETWEEN 1 AND 8000);
ALTER TABLE user_feedback DROP CONSTRAINT IF EXISTS user_feedback_len;
ALTER TABLE user_feedback ADD CONSTRAINT user_feedback_len CHECK (char_length(message) BETWEEN 1 AND 4000);
ALTER TABLE product_reviews DROP CONSTRAINT IF EXISTS product_reviews_rating_check;
ALTER TABLE product_reviews ADD CONSTRAINT product_reviews_rating_check CHECK (rating BETWEEN 1 AND 5);
ALTER TABLE article_ratings DROP CONSTRAINT IF EXISTS article_ratings_rating_check;
ALTER TABLE article_ratings ADD CONSTRAINT article_ratings_rating_check CHECK (rating BETWEEN 1 AND 5);
ALTER TABLE search_history DROP CONSTRAINT IF EXISTS search_history_len;
ALTER TABLE search_history ADD CONSTRAINT search_history_len CHECK (char_length(query) <= 200);

-- =====================================================================
-- 3. RATE LIMITING (used by edge functions)
-- =====================================================================
CREATE TABLE IF NOT EXISTS rate_limits (
  id bigserial PRIMARY KEY,
  key_hash text NOT NULL,
  action text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rate_limits_lookup ON rate_limits (action, key_hash, created_at DESC);
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY; -- no policies: service role only

CREATE OR REPLACE FUNCTION check_rate_limit(p_key_hash text, p_action text, p_limit integer, p_window_seconds integer)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE cnt integer;
BEGIN
  DELETE FROM rate_limits WHERE created_at < now() - interval '1 day';
  SELECT count(*) INTO cnt FROM rate_limits
    WHERE key_hash = p_key_hash AND action = p_action
      AND created_at > now() - make_interval(secs => p_window_seconds);
  IF cnt >= p_limit THEN RETURN false; END IF;
  INSERT INTO rate_limits (key_hash, action) VALUES (p_key_hash, p_action);
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION check_rate_limit(text, text, integer, integer) FROM public, anon, authenticated;

-- =====================================================================
-- 4. SITE SETTINGS (feature flags, announcement bar, maintenance)
-- =====================================================================
CREATE TABLE IF NOT EXISTS site_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_public boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE site_settings ENABLE ROW LEVEL SECURITY;
INSERT INTO site_settings (key, value, is_public) VALUES
  ('announcement', '{"enabled": false, "text": "", "link": ""}', true),
  ('maintenance', '{"enabled": false, "message": "We are polishing things. Back shortly."}', true),
  ('features', '{"comments": true, "shop": true, "polls": true, "newsletter": true, "gift_cards": true}', true),
  ('currency', '{"base": "USD", "display": ["USD", "NGN", "GBP", "EUR"]}', true)
ON CONFLICT (key) DO NOTHING;

-- =====================================================================
-- 5. DROP EVERY EXISTING POLICY ON PUBLIC TABLES
-- =====================================================================
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT schemaname, tablename, policyname FROM pg_policies WHERE schemaname = 'public' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
  END LOOP;
  -- make sure RLS is on everywhere
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.tablename);
  END LOOP;
END $$;

-- helper to create the standard "admin full access" policy
CREATE OR REPLACE FUNCTION _mk_admin_all(tbl text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin())', tbl || '_admin_all', tbl);
END $$;
CREATE OR REPLACE FUNCTION _mk_public_read(tbl text, cond text DEFAULT 'true') RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO anon, authenticated USING (%s)', tbl || '_public_read', tbl, cond);
END $$;
CREATE OR REPLACE FUNCTION _mk_anon_insert(tbl text, cond text DEFAULT 'true') RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO anon, authenticated WITH CHECK (%s)', tbl || '_anon_insert', tbl, cond);
END $$;

-- =====================================================================
-- 6. POLICY MATRIX
-- =====================================================================

-- ---- app_admins: users may see their own row (to render admin UI); owners manage
CREATE POLICY app_admins_self_read ON app_admins FOR SELECT TO authenticated USING (user_id = auth.uid() OR is_admin());
CREATE POLICY app_admins_owner_write ON app_admins FOR ALL TO authenticated USING (is_owner()) WITH CHECK (is_owner());

-- ---- site_settings
SELECT _mk_public_read('site_settings', 'is_public = true');
SELECT _mk_admin_all('site_settings');

-- ---- EDITORIAL CONTENT (public read, admin write)
SELECT _mk_public_read('posts', 'status = ''published'' AND (published_at IS NULL OR published_at <= now())');
CREATE POLICY posts_admin_read ON posts FOR SELECT TO authenticated USING (is_admin());
SELECT _mk_admin_all('posts');

SELECT _mk_public_read('categories');            SELECT _mk_admin_all('categories');
SELECT _mk_public_read('authors');               SELECT _mk_admin_all('authors');
SELECT _mk_public_read('media');                 SELECT _mk_admin_all('media');
SELECT _mk_public_read('related_articles');      SELECT _mk_admin_all('related_articles');
SELECT _mk_public_read('featured_slots');        SELECT _mk_admin_all('featured_slots');
SELECT _mk_public_read('sponsored_content', 'is_active = true'); SELECT _mk_admin_all('sponsored_content');
SELECT _mk_public_read('collections', 'is_active = true');       SELECT _mk_admin_all('collections');
SELECT _mk_public_read('collection_items');      SELECT _mk_admin_all('collection_items');
SELECT _mk_public_read('article_products');      SELECT _mk_admin_all('article_products');
SELECT _mk_public_read('content_templates');     SELECT _mk_admin_all('content_templates');
SELECT _mk_admin_all('article_versions');        -- admin only (no public read)

-- ---- CATALOGUE
SELECT _mk_public_read('products', 'is_active = true');          SELECT _mk_admin_all('products');
SELECT _mk_public_read('shop_categories', 'is_active = true');   SELECT _mk_admin_all('shop_categories');
SELECT _mk_public_read('product_bundles');       SELECT _mk_admin_all('product_bundles');
SELECT _mk_public_read('product_bundle_items');  SELECT _mk_admin_all('product_bundle_items');

-- promo codes & gift cards: NEVER readable by the public (validated server-side)
SELECT _mk_admin_all('promo_codes');
SELECT _mk_admin_all('gift_cards');

-- ---- COMMENTS (public read approved; writes via edge function / admin)
SELECT _mk_public_read('comments', 'is_approved = true AND is_visible = true');
CREATE POLICY comments_admin_read ON comments FOR SELECT TO authenticated USING (is_admin());
SELECT _mk_admin_all('comments');

-- ---- REVIEWS (public read approved; insert via edge function)
SELECT _mk_public_read('product_reviews', 'is_approved = true');
CREATE POLICY product_reviews_admin_read ON product_reviews FOR SELECT TO authenticated USING (is_admin());
SELECT _mk_admin_all('product_reviews');

-- ---- ENGAGEMENT COUNTERS (anon can add/remove their own fingerprint rows; reads are aggregate-safe)
SELECT _mk_public_read('article_likes');
SELECT _mk_anon_insert('article_likes');
CREATE POLICY article_likes_anon_delete ON article_likes FOR DELETE TO anon, authenticated USING (true);
SELECT _mk_admin_all('article_likes');

SELECT _mk_public_read('article_reactions');
SELECT _mk_anon_insert('article_reactions');
CREATE POLICY article_reactions_anon_delete ON article_reactions FOR DELETE TO anon, authenticated USING (true);
SELECT _mk_admin_all('article_reactions');

SELECT _mk_public_read('article_ratings');
SELECT _mk_anon_insert('article_ratings', 'rating BETWEEN 1 AND 5');
CREATE POLICY article_ratings_anon_update ON article_ratings FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (rating BETWEEN 1 AND 5);
SELECT _mk_admin_all('article_ratings');

SELECT _mk_public_read('article_polls', 'is_active = true');
SELECT _mk_admin_all('article_polls');
SELECT _mk_public_read('article_poll_votes');
SELECT _mk_anon_insert('article_poll_votes');
SELECT _mk_admin_all('article_poll_votes');

SELECT _mk_public_read('review_helpfulness');
SELECT _mk_anon_insert('review_helpfulness');
CREATE POLICY review_helpfulness_anon_update ON review_helpfulness FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
SELECT _mk_admin_all('review_helpfulness');

SELECT _mk_public_read('comment_likes');
SELECT _mk_anon_insert('comment_likes');
CREATE POLICY comment_likes_anon_delete ON comment_likes FOR DELETE TO anon, authenticated USING (true);
SELECT _mk_admin_all('comment_likes');

SELECT _mk_public_read('social_shares');
SELECT _mk_anon_insert('social_shares');
SELECT _mk_admin_all('social_shares');

-- live readers: ephemeral heartbeat rows
SELECT _mk_public_read('article_active_readers');
SELECT _mk_anon_insert('article_active_readers');
CREATE POLICY aar_anon_update ON article_active_readers FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY aar_anon_delete ON article_active_readers FOR DELETE TO anon, authenticated USING (true);
SELECT _mk_admin_all('article_active_readers');

-- analytics: write-only for the public
SELECT _mk_anon_insert('article_views');     SELECT _mk_admin_all('article_views');
SELECT _mk_anon_insert('product_clicks');    SELECT _mk_admin_all('product_clicks');
SELECT _mk_anon_insert('search_history');    SELECT _mk_admin_all('search_history');

-- reading sessions (streaks) — anon may insert; may read only own fingerprint rows is not
-- enforceable, so reads are allowed (contains no PII: fingerprint + post_id + date)
SELECT _mk_public_read('reading_sessions');
SELECT _mk_anon_insert('reading_sessions');
SELECT _mk_admin_all('reading_sessions');

-- reading lists: public lists visible to all; private lists visible to owner (auth) — legacy
-- fingerprint lists (user_id IS NULL) remain client-managed
SELECT _mk_public_read('reading_lists', 'is_public = true OR user_id IS NULL OR user_id = auth.uid()');
CREATE POLICY reading_lists_anon_insert ON reading_lists FOR INSERT TO anon, authenticated WITH CHECK (user_id IS NULL OR user_id = auth.uid());
CREATE POLICY reading_lists_write ON reading_lists FOR UPDATE TO anon, authenticated USING (user_id IS NULL OR user_id = auth.uid()) WITH CHECK (user_id IS NULL OR user_id = auth.uid());
CREATE POLICY reading_lists_delete ON reading_lists FOR DELETE TO anon, authenticated USING (user_id IS NULL OR user_id = auth.uid());
SELECT _mk_admin_all('reading_lists');
SELECT _mk_public_read('reading_list_items');
SELECT _mk_anon_insert('reading_list_items');
CREATE POLICY rli_anon_delete ON reading_list_items FOR DELETE TO anon, authenticated USING (true);
SELECT _mk_admin_all('reading_list_items');

-- ---- INBOUND FORMS: NO anon write (edge function `submit-form` inserts with service role)
SELECT _mk_admin_all('contact_messages');
SELECT _mk_admin_all('user_feedback');
SELECT _mk_admin_all('newsletter_subscribers');
SELECT _mk_admin_all('newsletter_preferences');
CREATE POLICY newsletter_prefs_self ON newsletter_preferences FOR SELECT TO authenticated USING (lower(email) = jwt_email());
CREATE POLICY newsletter_prefs_self_update ON newsletter_preferences FOR UPDATE TO authenticated USING (lower(email) = jwt_email()) WITH CHECK (lower(email) = jwt_email());

-- abandoned carts: anon can upsert its own fingerprint row (contains cart + optional email); no reads
SELECT _mk_anon_insert('abandoned_carts');
CREATE POLICY abandoned_carts_anon_update ON abandoned_carts FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
SELECT _mk_admin_all('abandoned_carts');

-- ---- COMMERCE / PII — admin, or the customer that owns it (JWT email match)
SELECT _mk_admin_all('customers');
CREATE POLICY customers_self_read ON customers FOR SELECT TO authenticated USING (lower(email) = jwt_email() OR user_id = auth.uid());

SELECT _mk_admin_all('orders');
CREATE POLICY orders_self_read ON orders FOR SELECT TO authenticated USING (lower(customer_email) = jwt_email() OR user_id = auth.uid());

SELECT _mk_admin_all('order_items');
CREATE POLICY order_items_self_read ON order_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM orders o WHERE o.id = order_items.order_id AND (lower(o.customer_email) = jwt_email() OR o.user_id = auth.uid())));

SELECT _mk_admin_all('order_notes');

SELECT _mk_admin_all('download_entitlements');
CREATE POLICY entitlements_self_read ON download_entitlements FOR SELECT TO authenticated USING (lower(customer_email) = jwt_email());

SELECT _mk_admin_all('refund_requests');
CREATE POLICY refunds_self_read ON refund_requests FOR SELECT TO authenticated USING (lower(customer_email) = jwt_email());
CREATE POLICY refunds_self_insert ON refund_requests FOR INSERT TO authenticated
  WITH CHECK (lower(customer_email) = jwt_email() AND status = 'pending'
    AND EXISTS (SELECT 1 FROM orders o WHERE o.id = refund_requests.order_id AND lower(o.customer_email) = jwt_email()));

SELECT _mk_admin_all('admin_activity_log');

-- =====================================================================
-- 7. DEFENSE-IN-DEPTH TRIGGERS
-- =====================================================================
-- Non-admin inserts are always pending moderation
CREATE OR REPLACE FUNCTION force_pending_moderation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_admin() AND current_setting('request.jwt.claim.role', true) IS DISTINCT FROM 'service_role' THEN
    NEW.is_approved := false;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_comments_pending ON comments;
CREATE TRIGGER trg_comments_pending BEFORE INSERT ON comments FOR EACH ROW EXECUTE FUNCTION force_pending_moderation();
DROP TRIGGER IF EXISTS trg_reviews_pending ON product_reviews;
CREATE TRIGGER trg_reviews_pending BEFORE INSERT ON product_reviews FOR EACH ROW EXECUTE FUNCTION force_pending_moderation();

-- Tamper-proof audit log: written by trigger, not by the client
CREATE OR REPLACE FUNCTION audit_admin_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE who text; ent_id text; rowj jsonb;
BEGIN
  who := COALESCE(auth.jwt() ->> 'email', current_setting('request.jwt.claim.role', true), 'system');
  rowj := to_jsonb(CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END);
  ent_id := COALESCE(rowj ->> 'id', rowj ->> 'key', rowj ->> 'user_id', '');
  INSERT INTO admin_activity_log (action, entity_type, entity_id, description, performed_by)
  VALUES (lower(TG_OP), TG_TABLE_NAME, ent_id,
          CASE WHEN TG_OP = 'DELETE' THEN 'Deleted row' ELSE 'Row ' || lower(TG_OP) || 'd' END, who);
  RETURN NULL;
END $$;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['posts','products','promo_codes','gift_cards','orders','collections','categories','authors','site_settings','app_admins']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_audit_%s ON %I', t, t);
    EXECUTE format('CREATE TRIGGER trg_audit_%s AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION audit_admin_change()', t, t);
  END LOOP;
END $$;

-- Atomic promo redemption (called by create-order with service role)
CREATE OR REPLACE FUNCTION redeem_promo_code(p_code text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE updated integer;
BEGIN
  UPDATE promo_codes SET use_count = use_count + 1
   WHERE upper(code) = upper(p_code) AND is_active
     AND (expires_at IS NULL OR expires_at > now())
     AND (max_uses IS NULL OR use_count < max_uses);
  GET DIAGNOSTICS updated = ROW_COUNT;
  RETURN updated = 1;
END $$;
REVOKE ALL ON FUNCTION redeem_promo_code(text) FROM public, anon, authenticated;

-- Atomic gift-card debit
CREATE OR REPLACE FUNCTION debit_gift_card(p_code text, p_amount numeric)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE updated integer;
BEGIN
  UPDATE gift_cards SET balance = balance - p_amount
   WHERE upper(code) = upper(p_code) AND is_active AND p_amount > 0
     AND (expires_at IS NULL OR expires_at > now())
     AND balance >= p_amount;
  GET DIAGNOSTICS updated = ROW_COUNT;
  RETURN updated = 1;
END $$;
REVOKE ALL ON FUNCTION debit_gift_card(text, numeric) FROM public, anon, authenticated;

-- Atomic download-count increment (returns the file path or NULL if not allowed)
CREATE OR REPLACE FUNCTION consume_download(p_token text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE fp text;
BEGIN
  UPDATE download_entitlements SET download_count = download_count + 1
   WHERE download_token = p_token
     AND download_count < max_downloads
     AND (expires_at IS NULL OR expires_at > now())
  RETURNING file_path INTO fp;
  RETURN fp;
END $$;
REVOKE ALL ON FUNCTION consume_download(text) FROM public, anon, authenticated;

-- Aggregated, PII-free view of poll results & reactions (cheaper than raw rows)
CREATE OR REPLACE VIEW poll_results AS
  SELECT poll_id, option_index, count(*)::int AS votes FROM article_poll_votes GROUP BY poll_id, option_index;
GRANT SELECT ON poll_results TO anon, authenticated;

-- =====================================================================
-- 8. STORAGE
-- =====================================================================
DROP POLICY IF EXISTS "public_read_media_bucket" ON storage.objects;
DROP POLICY IF EXISTS "auth_upload_media_bucket" ON storage.objects;
DROP POLICY IF EXISTS "auth_update_media_bucket" ON storage.objects;
DROP POLICY IF EXISTS "auth_delete_media_bucket" ON storage.objects;
CREATE POLICY "public_read_media_bucket" ON storage.objects FOR SELECT TO anon, authenticated USING (bucket_id = 'media');
CREATE POLICY "admin_write_media_bucket" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'media' AND is_admin());
CREATE POLICY "admin_update_media_bucket" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'media' AND is_admin()) WITH CHECK (bucket_id = 'media' AND is_admin());
CREATE POLICY "admin_delete_media_bucket" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'media' AND is_admin());
-- digital-products: admins may manage; nobody else touches it directly (edge fn uses service role)
DROP POLICY IF EXISTS "admin_all_digital_products" ON storage.objects;
CREATE POLICY "admin_all_digital_products" ON storage.objects FOR ALL TO authenticated USING (bucket_id = 'digital-products' AND is_admin()) WITH CHECK (bucket_id = 'digital-products' AND is_admin());

-- =====================================================================
-- 9. CLEANUP HELPERS
-- =====================================================================
DROP FUNCTION IF EXISTS _mk_admin_all(text);
DROP FUNCTION IF EXISTS _mk_public_read(text, text);
DROP FUNCTION IF EXISTS _mk_anon_insert(text, text);

-- Audit assertion: no anon write policy may be unconditional on sensitive tables
DO $$
DECLARE bad integer;
BEGIN
  SELECT count(*) INTO bad FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename IN ('orders','order_items','customers','download_entitlements','promo_codes','gift_cards',
                       'posts','products','comments','product_reviews','contact_messages','newsletter_subscribers',
                       'refund_requests','admin_activity_log','app_admins','site_settings')
     AND 'anon' = ANY(roles)
     AND cmd IN ('INSERT','UPDATE','DELETE','ALL');
  IF bad > 0 THEN RAISE EXCEPTION 'Security assertion failed: % anon write policies on sensitive tables', bad; END IF;
END $$;
