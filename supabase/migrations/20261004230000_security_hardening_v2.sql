/*
# M7 · Security hardening pass 2

Anonymous engagement rows remain insertable, but an anonymous caller can no longer
update or delete an arbitrary row through PostgREST. Fingerprint-scoped mutations go
through small SECURITY DEFINER RPCs with strict input checks; admin policies remain the
only direct write path for staff. This closes the legacy `USING (true)` write holes
without removing likes, ratings, reading lists or cart recovery from the reader UI.
*/

-- =====================================================================
-- 1. Remove world-writable mutation policies (including duplicate legacy names)
-- =====================================================================
DROP POLICY IF EXISTS abandoned_carts_anon_update ON abandoned_carts;
DROP POLICY IF EXISTS "rl_ac_update" ON abandoned_carts;
DROP POLICY IF EXISTS article_likes_anon_delete ON article_likes;
DROP POLICY IF EXISTS "public_delete_own_likes" ON article_likes;
DROP POLICY IF EXISTS article_reactions_anon_delete ON article_reactions;
DROP POLICY IF EXISTS "anon_delete_article_reactions" ON article_reactions;
DROP POLICY IF EXISTS comment_likes_anon_delete ON comment_likes;
DROP POLICY IF EXISTS "rl_cl_delete" ON comment_likes;
DROP POLICY IF EXISTS article_ratings_anon_update ON article_ratings;
DROP POLICY IF EXISTS "rl_ar_update" ON article_ratings;
DROP POLICY IF EXISTS review_helpfulness_anon_update ON review_helpfulness;
DROP POLICY IF EXISTS "rl_rh_update" ON review_helpfulness;
DROP POLICY IF EXISTS "rl_rh_delete" ON review_helpfulness;
DROP POLICY IF EXISTS rli_anon_delete ON reading_list_items;
DROP POLICY IF EXISTS "rl_rli_delete" ON reading_list_items;
DROP POLICY IF EXISTS reading_lists_delete ON reading_lists;
DROP POLICY IF EXISTS reading_lists_write ON reading_lists;
DROP POLICY IF EXISTS "rl_reading_lists_delete" ON reading_lists;
DROP POLICY IF EXISTS "rl_reading_lists_update" ON reading_lists;
DROP POLICY IF EXISTS "rl_reading_lists_write" ON reading_lists;
DROP POLICY IF EXISTS rl_reading_lists_update ON reading_lists;
DROP POLICY IF EXISTS rl_reading_lists_delete ON reading_lists;

-- =====================================================================
-- 2. Fingerprint-scoped mutation RPCs
-- =====================================================================
-- The original cart table did not declare the conflict target used by the client.
-- Keep the newest row for each device before adding the invariant.
DELETE FROM abandoned_carts a USING abandoned_carts b
 WHERE a.fingerprint = b.fingerprint AND a.id < b.id;
CREATE UNIQUE INDEX IF NOT EXISTS abandoned_carts_fingerprint_key ON abandoned_carts (fingerprint);

CREATE OR REPLACE FUNCTION public.toggle_article_like(p_post_id uuid, p_fingerprint text, p_active boolean)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  IF p_post_id IS NULL OR p_fingerprint IS NULL OR length(p_fingerprint) NOT BETWEEN 10 AND 64 THEN RAISE EXCEPTION 'invalid engagement token'; END IF;
  IF NOT EXISTS (SELECT 1 FROM posts WHERE id = p_post_id AND status = 'published') THEN RAISE EXCEPTION 'article unavailable'; END IF;
  IF p_active THEN
    INSERT INTO article_likes (post_id, fingerprint) VALUES (p_post_id, p_fingerprint) ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM article_likes WHERE post_id = p_post_id AND fingerprint = p_fingerprint;
  END IF;
  SELECT count(*) INTO n FROM article_likes WHERE post_id = p_post_id;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION public.toggle_article_reaction(p_post_id uuid, p_reaction_type text, p_fingerprint text, p_active boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_post_id IS NULL OR p_reaction_type NOT IN ('love', 'insightful', 'inspiring', 'save') OR p_fingerprint IS NULL OR length(p_fingerprint) NOT BETWEEN 10 AND 64 THEN RAISE EXCEPTION 'invalid reaction'; END IF;
  IF NOT EXISTS (SELECT 1 FROM posts WHERE id = p_post_id AND status = 'published') THEN RAISE EXCEPTION 'article unavailable'; END IF;
  IF p_active THEN
    INSERT INTO article_reactions (post_id, reaction_type, fingerprint) VALUES (p_post_id, p_reaction_type, p_fingerprint) ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM article_reactions WHERE post_id = p_post_id AND reaction_type = p_reaction_type AND fingerprint = p_fingerprint;
  END IF;
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.toggle_comment_like(p_comment_id uuid, p_fingerprint text, p_active boolean)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  IF p_comment_id IS NULL OR p_fingerprint IS NULL OR length(p_fingerprint) NOT BETWEEN 10 AND 64 THEN RAISE EXCEPTION 'invalid comment like'; END IF;
  IF NOT EXISTS (SELECT 1 FROM comments WHERE id = p_comment_id AND is_approved AND is_visible) THEN RAISE EXCEPTION 'comment unavailable'; END IF;
  IF p_active THEN
    INSERT INTO comment_likes (comment_id, fingerprint) VALUES (p_comment_id, p_fingerprint) ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM comment_likes WHERE comment_id = p_comment_id AND fingerprint = p_fingerprint;
  END IF;
  SELECT count(*) INTO n FROM comment_likes WHERE comment_id = p_comment_id;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION public.rate_article(p_post_id uuid, p_fingerprint text, p_rating integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_post_id IS NULL OR p_fingerprint IS NULL OR length(p_fingerprint) NOT BETWEEN 10 AND 64 OR p_rating NOT BETWEEN 1 AND 5 THEN RAISE EXCEPTION 'invalid rating'; END IF;
  IF NOT EXISTS (SELECT 1 FROM posts WHERE id = p_post_id AND status = 'published') THEN RAISE EXCEPTION 'article unavailable'; END IF;
  INSERT INTO article_ratings (post_id, fingerprint, rating) VALUES (p_post_id, p_fingerprint, p_rating)
  ON CONFLICT (post_id, fingerprint) DO UPDATE SET rating = EXCLUDED.rating;
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.vote_review_helpfulness(p_review_id uuid, p_fingerprint text, p_is_helpful boolean, p_active boolean DEFAULT true)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_review_id IS NULL OR p_fingerprint IS NULL OR length(p_fingerprint) NOT BETWEEN 10 AND 64 THEN RAISE EXCEPTION 'invalid helpfulness vote'; END IF;
  IF NOT EXISTS (SELECT 1 FROM product_reviews WHERE id = p_review_id AND is_approved) THEN RAISE EXCEPTION 'review unavailable'; END IF;
  IF NOT p_active THEN
    DELETE FROM review_helpfulness WHERE review_id = p_review_id AND fingerprint = p_fingerprint;
  ELSE
    INSERT INTO review_helpfulness (review_id, fingerprint, is_helpful) VALUES (p_review_id, p_fingerprint, p_is_helpful)
    ON CONFLICT (review_id, fingerprint) DO UPDATE SET is_helpful = EXCLUDED.is_helpful;
  END IF;
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.upsert_abandoned_cart(p_fingerprint text, p_cart_data jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_fingerprint IS NULL OR length(p_fingerprint) NOT BETWEEN 10 AND 64 OR jsonb_typeof(COALESCE(p_cart_data, '[]'::jsonb)) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'invalid cart'; END IF;
  IF jsonb_array_length(COALESCE(p_cart_data, '[]'::jsonb)) > 50 THEN RAISE EXCEPTION 'cart is too large'; END IF;
  INSERT INTO abandoned_carts (fingerprint, cart_data, updated_at) VALUES (p_fingerprint, p_cart_data, now())
  ON CONFLICT (fingerprint) DO UPDATE SET cart_data = EXCLUDED.cart_data, updated_at = now(), recovered = false;
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.clear_abandoned_cart(p_fingerprint text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_fingerprint IS NULL OR length(p_fingerprint) NOT BETWEEN 10 AND 64 THEN RAISE EXCEPTION 'invalid cart token'; END IF;
  DELETE FROM abandoned_carts WHERE fingerprint = p_fingerprint;
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.delete_reading_list(p_list_id uuid, p_fingerprint text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_list_id IS NULL OR p_fingerprint IS NULL OR length(p_fingerprint) NOT BETWEEN 10 AND 64 THEN RAISE EXCEPTION 'invalid reading list'; END IF;
  DELETE FROM reading_lists WHERE id = p_list_id AND fingerprint = p_fingerprint AND (user_id IS NULL OR user_id = auth.uid());
  RETURN FOUND;
END $$;

CREATE OR REPLACE FUNCTION public.set_reading_list_visibility(p_list_id uuid, p_fingerprint text, p_is_public boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_list_id IS NULL OR p_fingerprint IS NULL OR length(p_fingerprint) NOT BETWEEN 10 AND 64 THEN RAISE EXCEPTION 'invalid reading list'; END IF;
  UPDATE reading_lists SET is_public = COALESCE(p_is_public, false), updated_at = now()
   WHERE id = p_list_id AND fingerprint = p_fingerprint AND (user_id IS NULL OR user_id = auth.uid());
  RETURN FOUND;
END $$;

CREATE OR REPLACE FUNCTION public.delete_reading_list_item(p_item_id uuid, p_fingerprint text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_item_id IS NULL OR p_fingerprint IS NULL OR length(p_fingerprint) NOT BETWEEN 10 AND 64 THEN RAISE EXCEPTION 'invalid reading list item'; END IF;
  DELETE FROM reading_list_items i USING reading_lists l
   WHERE i.id = p_item_id AND l.id = i.list_id AND l.fingerprint = p_fingerprint AND (l.user_id IS NULL OR l.user_id = auth.uid());
  RETURN FOUND;
END $$;

REVOKE ALL ON FUNCTION public.toggle_article_like(uuid, text, boolean) FROM public;
REVOKE ALL ON FUNCTION public.toggle_article_reaction(uuid, text, text, boolean) FROM public;
REVOKE ALL ON FUNCTION public.toggle_comment_like(uuid, text, boolean) FROM public;
REVOKE ALL ON FUNCTION public.rate_article(uuid, text, integer) FROM public;
REVOKE ALL ON FUNCTION public.vote_review_helpfulness(uuid, text, boolean, boolean) FROM public;
REVOKE ALL ON FUNCTION public.upsert_abandoned_cart(text, jsonb) FROM public;
REVOKE ALL ON FUNCTION public.clear_abandoned_cart(text) FROM public;
REVOKE ALL ON FUNCTION public.delete_reading_list(uuid, text) FROM public;
REVOKE ALL ON FUNCTION public.set_reading_list_visibility(uuid, text, boolean) FROM public;
REVOKE ALL ON FUNCTION public.delete_reading_list_item(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.toggle_article_like(uuid, text, boolean) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.toggle_article_reaction(uuid, text, text, boolean) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.toggle_comment_like(uuid, text, boolean) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rate_article(uuid, text, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vote_review_helpfulness(uuid, text, boolean, boolean) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_abandoned_cart(text, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clear_abandoned_cart(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_reading_list(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_reading_list_visibility(uuid, text, boolean) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_reading_list_item(uuid, text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- 3. Capability-gate storage and sanitize the autonomous front-end surface
-- =====================================================================
DROP POLICY IF EXISTS admin_write_media_bucket ON storage.objects;
DROP POLICY IF EXISTS admin_update_media_bucket ON storage.objects;
DROP POLICY IF EXISTS admin_delete_media_bucket ON storage.objects;
DROP POLICY IF EXISTS admin_all_digital_products ON storage.objects;
CREATE POLICY admin_write_media_bucket ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'media' AND admin_can('media.write'));
CREATE POLICY admin_update_media_bucket ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'media' AND admin_can('media.write'))
  WITH CHECK (bucket_id = 'media' AND admin_can('media.write'));
CREATE POLICY admin_delete_media_bucket ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'media' AND admin_can('media.delete'));
CREATE POLICY admin_all_digital_products ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'digital-products' AND admin_can('commerce.pricing'))
  WITH CHECK (bucket_id = 'digital-products' AND admin_can('commerce.pricing'));

CREATE OR REPLACE FUNCTION sanitize_public_head_setting()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE html text;
BEGIN
  IF NEW.key = 'custom_head' THEN
    html := left(COALESCE(NEW.value ->> 'html', ''), 20000);
    -- The front-end setting is for verification meta tags and safe links. Never let
    -- an admin setting become a script/iframe/event-handler injection surface.
    html := regexp_replace(html, '(?is)</?(script|iframe|object|embed|form|style)[^>]*>', '', 'g');
    html := regexp_replace(html, '(?i)[[:space:]]+on[a-z]+[[:space:]]*=[[:space:]]*''[^'']*''', '', 'g');
    html := regexp_replace(html, '(?i)[[:space:]]+on[a-z]+[[:space:]]*=[[:space:]]*"[^"]*"', '', 'g');
    html := regexp_replace(html, '(?i)[[:space:]]+on[a-z]+[[:space:]]*=[[:space:]]*[^[:space:]>]+', '', 'g');
    html := regexp_replace(html, '(?i)[[:space:]]+(href|src)[[:space:]]*=[[:space:]]*''[[:space:]]*javascript:[^'']*''', '', 'g');
    html := regexp_replace(html, '(?i)[[:space:]]+(href|src)[[:space:]]*=[[:space:]]*"[[:space:]]*javascript:[^"]*"', '', 'g');
    html := regexp_replace(html, '(?i)[[:space:]]+(href|src)[[:space:]]*=[[:space:]]*javascript:[^[:space:]>]+', '', 'g');
    NEW.value := jsonb_build_object('html', html);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_sanitize_public_head_setting ON site_settings;
CREATE TRIGGER trg_sanitize_public_head_setting
  BEFORE INSERT OR UPDATE OF key, value ON site_settings
  FOR EACH ROW EXECUTE FUNCTION sanitize_public_head_setting();

REVOKE ALL ON FUNCTION sanitize_public_head_setting() FROM public;
NOTIFY pgrst, 'reload schema';
