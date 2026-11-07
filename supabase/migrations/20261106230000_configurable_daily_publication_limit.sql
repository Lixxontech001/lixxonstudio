-- Migration: 20261106230000_configurable_daily_publication_limit.sql
-- Enables configurable daily article publication capacity in site_settings (default: 20 articles/day).
-- Removes hardcoded limit of 2 so editors and the admin dashboard can publish freely.

-- 1. Ensure site_settings has the publishing capacity configuration
INSERT INTO site_settings (key, value, is_public)
VALUES (
  'publishing',
  jsonb_build_object(
    'daily_article_limit', 20,
    'min_word_count', 800,
    'allow_same_day_publishing', true,
    'auto_unpin_expired', true,
    'default_status', 'draft'
  ),
  true
)
ON CONFLICT (key) DO UPDATE
SET value = jsonb_build_object(
  'daily_article_limit', COALESCE((site_settings.value->>'daily_article_limit')::integer, 20),
  'min_word_count', COALESCE((site_settings.value->>'min_word_count')::integer, 800),
  'allow_same_day_publishing', COALESCE((site_settings.value->>'allow_same_day_publishing')::boolean, true),
  'auto_unpin_expired', COALESCE((site_settings.value->>'auto_unpin_expired')::boolean, true),
  'default_status', COALESCE(site_settings.value->>'default_status', 'draft')
);

-- 2. Helper function to read the current daily publication limit from site_settings
CREATE OR REPLACE FUNCTION article_intake_daily_limit()
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    NULLIF((
      SELECT (value->>'daily_article_limit')::integer
        FROM site_settings
       WHERE key = 'publishing'
    ), 0),
    20
  );
$$;

REVOKE ALL ON FUNCTION article_intake_daily_limit() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION article_intake_daily_limit() TO authenticated, service_role;

-- 3. Replace article_guard_daily_schedule_capacity() trigger function
CREATE OR REPLACE FUNCTION article_guard_daily_schedule_capacity()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_when timestamptz;
  v_day date;
  v_used integer;
  v_limit integer;
  v_new_reservation boolean := false;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_new_reservation := NEW.status IN ('scheduled', 'published');
  ELSIF NEW.status = 'scheduled' THEN
    v_new_reservation := OLD.status IS DISTINCT FROM 'scheduled'
      OR NEW.scheduled_at IS DISTINCT FROM OLD.scheduled_at;
  ELSIF NEW.status = 'published' THEN
    v_new_reservation := OLD.status IS DISTINCT FROM 'published'
      AND OLD.status IS DISTINCT FROM 'scheduled';
  END IF;
  IF NOT v_new_reservation THEN RETURN NEW; END IF;

  IF current_setting('request.jwt.claim.role', true) = 'authenticated'
     AND NOT admin_can('content.publish') THEN
    RAISE EXCEPTION 'Publishing or scheduling requires the content.publish capability';
  END IF;

  IF NEW.status IN ('scheduled', 'published') AND EXISTS (
    SELECT 1 FROM article_intake_items i WHERE i.post_id = NEW.id
  ) AND (
    EXISTS (SELECT 1 FROM article_intake_items i WHERE i.post_id = NEW.id AND i.intake_status = 'rejected')
    OR NULLIF(btrim(NEW.title), '') IS NULL
    OR NULLIF(btrim(NEW.slug), '') IS NULL
    OR NULLIF(btrim(NEW.excerpt), '') IS NULL
    OR NEW.category_id IS NULL
    OR COALESCE(cardinality(NEW.tags), 0) = 0
    OR NEW.cover_image IS NULL OR NEW.cover_image NOT LIKE 'https://%'
    OR NULLIF(btrim(NEW.cover_image_alt), '') IS NULL
    OR NULLIF(btrim(NEW.seo_title), '') IS NULL OR length(NEW.seo_title) > 70
    OR NULLIF(btrim(NEW.seo_description), '') IS NULL OR length(NEW.seo_description) > 160
  ) THEN
    RAISE EXCEPTION 'Complete required article metadata in the editor and reopen any rejected intake item before scheduling';
  END IF;

  IF NEW.status = 'scheduled' THEN
    v_when := NEW.scheduled_at;
    IF v_when IS NULL OR v_when <= now() THEN RAISE EXCEPTION 'Choose a future schedule time'; END IF;
  ELSE
    v_when := COALESCE(NEW.published_at, now());
  END IF;

  v_day := (v_when AT TIME ZONE 'Africa/Lagos')::date;
  PERFORM pg_advisory_xact_lock(hashtext('lixxon_article_daily_capacity'), (v_day - DATE '2000-01-01')::integer);
  v_used := article_intake_lagos_slot_usage(v_day, NEW.id);
  v_limit := article_intake_daily_limit();

  IF v_used >= v_limit THEN
    RAISE EXCEPTION 'The %-article daily limit is already reached for %', v_limit, v_day;
  END IF;
  RETURN NEW;
END $$;

-- 4. Replace article_intake_slot_check()
CREATE OR REPLACE FUNCTION article_intake_slot_check(p_proposed_publish_at timestamptz, p_post_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_day date;
  v_used integer;
  v_limit integer;
BEGIN
  IF NOT admin_can('content.read') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_proposed_publish_at IS NULL THEN RAISE EXCEPTION 'A proposed publication time is required'; END IF;
  v_day := (p_proposed_publish_at AT TIME ZONE 'Africa/Lagos')::date;
  v_used := article_intake_lagos_slot_usage(v_day, p_post_id);
  v_limit := article_intake_daily_limit();
  RETURN jsonb_build_object(
    'lagos_date', v_day,
    'timezone', 'Africa/Lagos',
    'used', v_used,
    'limit', v_limit,
    'remaining', GREATEST(0, v_limit - v_used),
    'allowed', p_proposed_publish_at > now() AND v_used < v_limit
  );
END $$;

-- 5. Replace article_intake_save()
CREATE OR REPLACE FUNCTION article_intake_save(
  p_post_id uuid,
  p_source_filename text,
  p_source_sha256 text,
  p_word_count integer,
  p_proposed_publish_at timestamptz
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_post posts%ROWTYPE;
  v_name text;
  v_day date;
  v_used integer;
  v_limit integer;
  v_actual_words integer;
  v_recorded_words integer;
  v_previous_sha text;
BEGIN
  IF NOT admin_can('content.write') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_post_id IS NULL THEN RAISE EXCEPTION 'Post ID is required'; END IF;
  IF p_proposed_publish_at IS NULL OR p_proposed_publish_at <= now() THEN
    RAISE EXCEPTION 'A future publication time is required';
  END IF;
  v_name := NULLIF(btrim(COALESCE(p_source_filename, '')), '');
  IF v_name IS NULL OR length(v_name) > 255 THEN RAISE EXCEPTION 'A source DOCX filename is required'; END IF;
  IF p_source_sha256 IS NULL OR length(p_source_sha256) <> 64 OR p_source_sha256 !~ '^[0-9a-fA-F]{64}$' THEN
    RAISE EXCEPTION 'A valid 64-character SHA-256 hash is required';
  END IF;
  IF p_word_count IS NULL OR p_word_count <= 0 THEN RAISE EXCEPTION 'A positive word count is required'; END IF;

  SELECT * INTO v_post FROM posts WHERE id = p_post_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Article draft not found'; END IF;
  IF v_post.status <> 'draft' THEN RAISE EXCEPTION 'Only an unpublished draft can be placed in the intake queue'; END IF;
  IF COALESCE(v_post.content, '') = '' THEN RAISE EXCEPTION 'Import the owner-authored DOCX text before saving the queue item'; END IF;
  v_actual_words := regexp_count(COALESCE(v_post.content, ''), $word$[[:alnum:]]+([’'][[:alnum:]]+)*$word$);
  SELECT source_sha256 INTO v_previous_sha FROM article_intake_items WHERE post_id = p_post_id FOR UPDATE;
  IF v_previous_sha IS NULL OR v_previous_sha <> lower(p_source_sha256) THEN
    IF v_actual_words <> p_word_count THEN RAISE EXCEPTION 'The imported word count does not match the saved draft'; END IF;
  END IF;
  v_recorded_words := v_actual_words;

  v_day := (p_proposed_publish_at AT TIME ZONE 'Africa/Lagos')::date;
  PERFORM pg_advisory_xact_lock(hashtext('lixxon_article_daily_capacity'), (v_day - DATE '2000-01-01')::integer);
  v_used := article_intake_lagos_slot_usage(v_day, p_post_id);
  v_limit := article_intake_daily_limit();
  IF v_used >= v_limit THEN
    RAISE EXCEPTION 'The %-article daily limit is already reached for %', v_limit, v_day;
  END IF;

  INSERT INTO article_intake_items (
    post_id, intake_status, source_filename, source_sha256, word_count,
    proposed_publish_at, rejected_at, rejected_by, created_by, updated_by
  ) VALUES (
    p_post_id, 'queued', v_name, lower(p_source_sha256), v_recorded_words,
    p_proposed_publish_at, NULL, NULL, auth.uid(), auth.uid()
  )
  ON CONFLICT (post_id) DO UPDATE SET
    intake_status = 'queued',
    source_filename = EXCLUDED.source_filename,
    source_sha256 = EXCLUDED.source_sha256,
    word_count = EXCLUDED.word_count,
    proposed_publish_at = EXCLUDED.proposed_publish_at,
    rejected_at = NULL,
    rejected_by = NULL,
    updated_by = auth.uid(),
    updated_at = now();

  RETURN jsonb_build_object(
    'ok', true,
    'post_id', p_post_id,
    'intake_status', 'queued',
    'word_count', v_recorded_words,
    'proposed_publish_at', p_proposed_publish_at,
    'lagos_date', v_day
  );
END $$;

-- 6. Replace article_intake_reopen()
CREATE OR REPLACE FUNCTION article_intake_reopen(p_post_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_day date;
  v_proposed timestamptz;
  v_used integer;
  v_limit integer;
BEGIN
  IF NOT admin_can('content.write') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF NOT EXISTS (SELECT 1 FROM posts WHERE id = p_post_id AND status = 'draft') THEN
    RAISE EXCEPTION 'Only an unpublished draft can be restored to the intake queue';
  END IF;
  SELECT proposed_publish_at INTO v_proposed
    FROM article_intake_items WHERE post_id = p_post_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Article intake item not found'; END IF;
  IF v_proposed <= now() THEN RAISE EXCEPTION 'Choose a future proposed publication time before reopening this item'; END IF;
  v_day := (v_proposed AT TIME ZONE 'Africa/Lagos')::date;
  PERFORM pg_advisory_xact_lock(hashtext('lixxon_article_daily_capacity'), (v_day - DATE '2000-01-01')::integer);
  v_used := article_intake_lagos_slot_usage(v_day, p_post_id);
  v_limit := article_intake_daily_limit();
  IF v_used >= v_limit THEN
    RAISE EXCEPTION 'The %-article daily limit is already reached for %', v_limit, v_day;
  END IF;
  UPDATE article_intake_items
     SET intake_status = 'queued', rejected_at = NULL, rejected_by = NULL,
         updated_by = auth.uid(), updated_at = now()
   WHERE post_id = p_post_id;
  RETURN true;
END $$;

