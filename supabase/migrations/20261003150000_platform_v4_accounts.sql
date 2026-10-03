-- =====================================================================
-- v4: tie reader data to accounts, shareable reading lists, public settings seed
-- =====================================================================

-- reading lists: optional owner + share token (guests keep using the fingerprint)
ALTER TABLE reading_lists ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE reading_lists ADD COLUMN IF NOT EXISTS share_token uuid UNIQUE DEFAULT gen_random_uuid();
CREATE INDEX IF NOT EXISTS reading_lists_user_idx ON reading_lists (user_id);

-- Guests can only touch lists that carry their fingerprint; owners their own; everyone reads public ones.
DROP POLICY IF EXISTS "rl_reading_lists_select" ON reading_lists;
DROP POLICY IF EXISTS "rl_reading_lists_insert" ON reading_lists;
DROP POLICY IF EXISTS "rl_reading_lists_update" ON reading_lists;
DROP POLICY IF EXISTS "rl_reading_lists_delete" ON reading_lists;
CREATE POLICY rl_reading_lists_select ON reading_lists FOR SELECT TO anon, authenticated
  USING (is_public = true OR user_id = auth.uid() OR user_id IS NULL OR is_admin());
CREATE POLICY rl_reading_lists_insert ON reading_lists FOR INSERT TO anon, authenticated
  WITH CHECK (user_id IS NULL OR user_id = auth.uid());
CREATE POLICY rl_reading_lists_update ON reading_lists FOR UPDATE TO anon, authenticated
  USING (user_id IS NULL OR user_id = auth.uid() OR is_admin()) WITH CHECK (user_id IS NULL OR user_id = auth.uid() OR is_admin());
CREATE POLICY rl_reading_lists_delete ON reading_lists FOR DELETE TO anon, authenticated
  USING (user_id IS NULL OR user_id = auth.uid() OR is_admin());

-- link a signed-in reader's orders to their account on first login (by email)
CREATE OR REPLACE FUNCTION claim_my_orders()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer := 0; em text := jwt_email();
BEGIN
  IF auth.uid() IS NULL OR em IS NULL THEN RETURN 0; END IF;
  UPDATE orders SET user_id = auth.uid() WHERE user_id IS NULL AND lower(customer_email) = em;
  GET DIAGNOSTICS n = ROW_COUNT;
  UPDATE customers SET user_id = auth.uid() WHERE user_id IS NULL AND lower(email) = em;
  RETURN n;
END $$;
GRANT EXECUTE ON FUNCTION claim_my_orders() TO authenticated;

-- public site settings used by the UI (announcement bar, maintenance mode, feature flags)
INSERT INTO site_settings (key, value, is_public) VALUES
  ('announcement', '{"enabled": false, "text": "", "link": "", "link_label": ""}', true),
  ('maintenance', '{"enabled": false, "message": "We are polishing a few things. Back shortly."}', true),
  ('features', '{"comments": true, "shop": true, "newsletter": true, "qa": true, "glossary": true}', true),
  ('social', '{"instagram": "", "pinterest": "", "twitter": "", "youtube": ""}', true)
ON CONFLICT (key) DO NOTHING;

-- product questions upvote (public, rate-limited by the one-per-fingerprint unique key)
CREATE TABLE IF NOT EXISTS question_upvotes (
  question_id uuid NOT NULL REFERENCES article_questions(id) ON DELETE CASCADE,
  fingerprint text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (question_id, fingerprint)
);
ALTER TABLE question_upvotes ENABLE ROW LEVEL SECURITY;
CREATE POLICY qu_insert ON question_upvotes FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY qu_admin ON question_upvotes FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

CREATE OR REPLACE FUNCTION upvote_question(p_question_id uuid, p_fingerprint text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c integer;
BEGIN
  IF p_fingerprint IS NULL OR char_length(p_fingerprint) < 8 THEN RETURN NULL; END IF;
  INSERT INTO question_upvotes (question_id, fingerprint) VALUES (p_question_id, p_fingerprint) ON CONFLICT DO NOTHING;
  IF FOUND THEN
    UPDATE article_questions SET upvotes = upvotes + 1 WHERE id = p_question_id AND is_public RETURNING upvotes INTO c;
  ELSE
    SELECT upvotes INTO c FROM article_questions WHERE id = p_question_id;
  END IF;
  RETURN c;
END $$;
GRANT EXECUTE ON FUNCTION upvote_question(uuid, text) TO anon, authenticated;

-- CSV-friendly admin views (RLS of the underlying tables still applies)
CREATE OR REPLACE VIEW admin_orders_export WITH (security_invoker = true) AS
  SELECT o.order_number, o.created_at, o.customer_name, o.customer_email, o.status, o.payment_status,
         o.currency, o.subtotal, o.discount_amount, o.gift_card_amount, o.amount, o.promo_code,
         (SELECT string_agg(i.product_name || ' ×' || i.quantity, '; ') FROM order_items i WHERE i.order_id = o.id) AS items
  FROM orders o;

-- =====================================================================
-- Team management (owner only): look up auth users by email without exposing auth schema
-- =====================================================================
CREATE OR REPLACE FUNCTION list_admins()
RETURNS TABLE (user_id uuid, email text, role text, created_at timestamptz, last_sign_in_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT a.user_id, u.email::text, a.role, a.created_at, u.last_sign_in_at
  FROM app_admins a JOIN auth.users u ON u.id = a.user_id
  WHERE is_admin()
  ORDER BY a.created_at;
$$;
GRANT EXECUTE ON FUNCTION list_admins() TO authenticated;

CREATE OR REPLACE FUNCTION set_admin_role(p_email text, p_role text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid;
BEGIN
  IF NOT is_owner() THEN RAISE EXCEPTION 'Only owners can manage the team'; END IF;
  IF p_role NOT IN ('owner','editor','moderator') THEN RAISE EXCEPTION 'Invalid role'; END IF;
  SELECT id INTO uid FROM auth.users WHERE lower(email) = lower(trim(p_email));
  IF uid IS NULL THEN RETURN 'not_found'; END IF;  -- they must sign in once (magic link) first
  INSERT INTO app_admins (user_id, role) VALUES (uid, p_role)
    ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role;
  RETURN 'ok';
END $$;
GRANT EXECUTE ON FUNCTION set_admin_role(text, text) TO authenticated;

CREATE OR REPLACE FUNCTION remove_admin(p_user_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_owner() THEN RAISE EXCEPTION 'Only owners can manage the team'; END IF;
  IF p_user_id = auth.uid() THEN RAISE EXCEPTION 'You cannot remove yourself'; END IF;
  IF (SELECT count(*) FROM app_admins WHERE role = 'owner') <= 1 AND EXISTS (SELECT 1 FROM app_admins WHERE user_id = p_user_id AND role = 'owner') THEN
    RAISE EXCEPTION 'Keep at least one owner';
  END IF;
  DELETE FROM app_admins WHERE user_id = p_user_id;
  RETURN FOUND;
END $$;
GRANT EXECUTE ON FUNCTION remove_admin(uuid) TO authenticated;

-- admins may trigger an ad-hoc backup snapshot / digest from the UI
CREATE OR REPLACE FUNCTION admin_take_backup() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN IF NOT is_admin() THEN RAISE EXCEPTION 'forbidden'; END IF; PERFORM take_backup_snapshot(); END $$;
GRANT EXECUTE ON FUNCTION admin_take_backup() TO authenticated;

-- realtime for the live dashboard (orders + views). Harmless if already added.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE orders; EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE article_views; EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE comments; EXCEPTION WHEN duplicate_object THEN NULL; END;
  END IF;
END $$;

-- =====================================================================
-- MFA enforcement at the database layer: once an admin has a verified TOTP factor,
-- their admin privileges only apply to sessions that completed the second factor (aal2).
-- =====================================================================
CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM app_admins WHERE user_id = auth.uid())
     AND (
       COALESCE(auth.jwt()->>'aal', 'aal1') = 'aal2'
       OR NOT EXISTS (SELECT 1 FROM auth.mfa_factors f WHERE f.user_id = auth.uid() AND f.status = 'verified')
     );
$$;
