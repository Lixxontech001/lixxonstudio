-- Phase 2.1 — owner-authored article intake and Lagos-aware calendar metadata.
-- The queue stores provenance and workflow metadata only. Article prose is still
-- kept exclusively in posts.content and is inserted only by the authenticated
-- owner/editor upload action; no automation function receives or writes prose.

CREATE TABLE IF NOT EXISTS article_intake_items (
  post_id uuid PRIMARY KEY REFERENCES posts(id) ON DELETE CASCADE,
  intake_status text NOT NULL DEFAULT 'queued'
    CHECK (intake_status IN ('queued', 'rejected')),
  source_filename text NOT NULL CHECK (length(source_filename) BETWEEN 1 AND 255),
  source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[a-f0-9]{64}$'),
  word_count integer NOT NULL CHECK (word_count >= 0 AND word_count <= 100000),
  proposed_publish_at timestamptz NOT NULL,
  rejected_at timestamptz,
  rejected_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((intake_status = 'rejected') = (rejected_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS article_intake_status_date
  ON article_intake_items (intake_status, proposed_publish_at);

ALTER TABLE article_intake_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE article_intake_items FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE article_intake_items TO authenticated;
DROP POLICY IF EXISTS article_intake_content_read ON article_intake_items;
CREATE POLICY article_intake_content_read ON article_intake_items
  FOR SELECT TO authenticated USING (admin_can('content.read'));
-- There are intentionally no browser INSERT/UPDATE/DELETE policies. Mutations
-- go through narrowly scoped, audited RPCs below.

DROP TRIGGER IF EXISTS trg_article_intake_items_audit ON article_intake_items;
CREATE TRIGGER trg_article_intake_items_audit
  AFTER INSERT OR UPDATE OR DELETE ON article_intake_items
  FOR EACH ROW EXECUTE FUNCTION public.audit_admin_change();

-- One article may occupy a Lagos publication date once, whether it is already
-- published, scheduled, or still an active imported draft with a proposed date.
-- UNION (rather than addition) prevents counting a scheduled intake item twice.
CREATE OR REPLACE FUNCTION article_intake_lagos_slot_usage(p_lagos_date date, p_exclude_post_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT count(*)::integer
    FROM (
      SELECT p.id
        FROM posts p
       WHERE p.id IS DISTINCT FROM p_exclude_post_id
         AND (
           (p.status = 'scheduled' AND p.scheduled_at IS NOT NULL
             AND (p.scheduled_at AT TIME ZONE 'Africa/Lagos')::date = p_lagos_date)
           OR
           (p.status = 'published' AND p.published_at IS NOT NULL
             AND (p.published_at AT TIME ZONE 'Africa/Lagos')::date = p_lagos_date)
         )
      UNION
      SELECT p.id
        FROM article_intake_items i
        JOIN posts p ON p.id = i.post_id
       WHERE p.id IS DISTINCT FROM p_exclude_post_id
         AND p.status = 'draft'
         AND i.intake_status = 'queued'
         AND (i.proposed_publish_at AT TIME ZONE 'Africa/Lagos')::date = p_lagos_date
    ) daily_items
$$;

CREATE OR REPLACE FUNCTION article_intake_slot_check(p_proposed_publish_at timestamptz, p_post_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_day date;
  v_used integer;
BEGIN
  IF NOT admin_can('content.read') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_proposed_publish_at IS NULL THEN RAISE EXCEPTION 'A proposed publication time is required'; END IF;
  v_day := (p_proposed_publish_at AT TIME ZONE 'Africa/Lagos')::date;
  v_used := article_intake_lagos_slot_usage(v_day, p_post_id);
  RETURN jsonb_build_object(
    'lagos_date', v_day,
    'timezone', 'Africa/Lagos',
    'used', v_used,
    'remaining', GREATEST(0, 2 - v_used),
    'allowed', p_proposed_publish_at > now() AND v_used < 2
  );
END $$;

-- Register/refresh source metadata after the owner has imported the DOCX into a
-- posts draft. This function never updates posts or receives article prose.
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
  v_actual_words integer;
  v_recorded_words integer;
  v_previous_sha text;
BEGIN
  IF NOT admin_can('content.write') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_post_id IS NULL OR p_proposed_publish_at IS NULL OR p_proposed_publish_at <= now() THEN
    RAISE EXCEPTION 'A future proposed publication time is required';
  END IF;
  v_name := regexp_replace(btrim(COALESCE(p_source_filename, '')), '[[:cntrl:]]', '', 'g');
  IF length(v_name) < 1 OR length(v_name) > 255 THEN RAISE EXCEPTION 'Invalid DOCX filename'; END IF;
  IF lower(COALESCE(p_source_sha256, '')) !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invalid DOCX checksum'; END IF;
  IF p_word_count IS NULL OR p_word_count < 0 OR p_word_count > 100000 THEN RAISE EXCEPTION 'Invalid article word count'; END IF;

  SELECT * INTO v_post FROM posts WHERE id = p_post_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Article draft not found'; END IF;
  IF v_post.status <> 'draft' THEN RAISE EXCEPTION 'Only an unpublished draft can be placed in the intake queue'; END IF;
  IF COALESCE(v_post.content, '') = '' THEN RAISE EXCEPTION 'Import the owner-authored DOCX text before saving the queue item'; END IF;
  v_actual_words := regexp_count(COALESCE(v_post.content, ''), $word$[[:alnum:]]+([’'][[:alnum:]]+)*$word$);
  SELECT source_sha256 INTO v_previous_sha FROM article_intake_items WHERE post_id = p_post_id FOR UPDATE;
  IF v_previous_sha IS NULL OR v_previous_sha <> lower(p_source_sha256) THEN
    IF v_actual_words <> p_word_count THEN RAISE EXCEPTION 'The imported word count does not match the saved draft'; END IF;
  END IF;
  -- Recount from the current owner-edited draft without returning its prose. A
  -- later editor correction must not be blocked by a stale import-time count.
  v_recorded_words := v_actual_words;

  v_day := (p_proposed_publish_at AT TIME ZONE 'Africa/Lagos')::date;
  PERFORM pg_advisory_xact_lock(hashtext('lixxon_article_daily_capacity'), (v_day - DATE '2000-01-01')::integer);
  v_used := article_intake_lagos_slot_usage(v_day, p_post_id);
  IF v_used >= 2 THEN RAISE EXCEPTION 'The two-article Lagos daily limit is already reached for %', v_day; END IF;

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

CREATE OR REPLACE FUNCTION article_intake_reject(p_post_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT admin_can('content.write') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF NOT EXISTS (SELECT 1 FROM posts WHERE id = p_post_id AND status = 'draft') THEN
    RAISE EXCEPTION 'Only an unpublished intake draft can be rejected';
  END IF;
  UPDATE article_intake_items
     SET intake_status = 'rejected', rejected_at = now(), rejected_by = auth.uid(),
         updated_by = auth.uid(), updated_at = now()
   WHERE post_id = p_post_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Article intake item not found'; END IF;
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION article_intake_reopen(p_post_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_day date;
  v_proposed timestamptz;
  v_used integer;
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
  IF v_used >= 2 THEN RAISE EXCEPTION 'The two-article Lagos daily limit is already reached for %', v_day; END IF;
  UPDATE article_intake_items
     SET intake_status = 'queued', rejected_at = NULL, rejected_by = NULL,
         updated_by = auth.uid(), updated_at = now()
   WHERE post_id = p_post_id;
  RETURN true;
END $$;

-- Enforce the same daily limit when an editor or the existing calendar schedules
-- a post. Scheduled publication itself is not a second reservation: it was counted
-- and authorized when the owner/editor moved the draft into scheduled state.
CREATE OR REPLACE FUNCTION article_guard_daily_schedule_capacity()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_when timestamptz;
  v_day date;
  v_used integer;
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
  IF v_used >= 2 THEN RAISE EXCEPTION 'The two-article Lagos daily limit is already reached for %', v_day; END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_article_daily_schedule_capacity ON posts;
CREATE TRIGGER trg_article_daily_schedule_capacity
  BEFORE INSERT OR UPDATE OF status, scheduled_at, published_at ON posts
  FOR EACH ROW EXECUTE FUNCTION public.article_guard_daily_schedule_capacity();

-- All application RPCs are definer-only with database-side permission checks;
-- direct browser writes to the metadata table and execution by service_role are denied.
REVOKE ALL ON FUNCTION article_intake_lagos_slot_usage(date, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION article_intake_slot_check(timestamptz, uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION article_intake_save(uuid, text, text, integer, timestamptz) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION article_intake_reject(uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION article_intake_reopen(uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION article_guard_daily_schedule_capacity() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION article_intake_slot_check(timestamptz, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION article_intake_save(uuid, text, text, integer, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION article_intake_reject(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION article_intake_reopen(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
