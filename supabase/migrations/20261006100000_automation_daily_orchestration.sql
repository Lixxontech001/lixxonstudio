-- Phase 2.2 — daily claim, protected Actions dispatch and single-use runner proof.
-- The Supabase cron tick performs orchestration only. Article publication remains
-- owned by the existing five-minute publish_scheduled_posts() job.

-- Owner approval is captured only when an authenticated content.publish action
-- moves an intake post to scheduled. Un-scheduling revokes it; the scheduled
-- publisher preserves it as historical approval after the post is published.
CREATE OR REPLACE FUNCTION automation_revoke_scheduled_approval()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.status = 'scheduled' AND (
       OLD.title IS DISTINCT FROM NEW.title
    OR OLD.slug IS DISTINCT FROM NEW.slug
    OR OLD.content IS DISTINCT FROM NEW.content
    OR OLD.excerpt IS DISTINCT FROM NEW.excerpt
    OR OLD.category_id IS DISTINCT FROM NEW.category_id
    OR OLD.tags IS DISTINCT FROM NEW.tags
    OR OLD.cover_image IS DISTINCT FROM NEW.cover_image
    OR OLD.cover_image_alt IS DISTINCT FROM NEW.cover_image_alt
    OR OLD.seo_title IS DISTINCT FROM NEW.seo_title
    OR OLD.seo_description IS DISTINCT FROM NEW.seo_description
    OR OLD.author_id IS DISTINCT FROM NEW.author_id
  ) THEN
    -- A material edit invalidates the previous approval. Require the owner to
    -- review and schedule the updated article again before it can publish.
    NEW.status := 'draft';
    NEW.scheduled_at := NULL;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_automation_revoke_scheduled_approval ON posts;
CREATE TRIGGER trg_automation_revoke_scheduled_approval
  BEFORE UPDATE OF title, slug, content, excerpt, category_id, tags, cover_image,
    cover_image_alt, seo_title, seo_description, author_id ON posts
  FOR EACH ROW EXECUTE FUNCTION public.automation_revoke_scheduled_approval();

CREATE OR REPLACE FUNCTION automation_track_article_approval()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text := COALESCE(current_setting('request.jwt.claim.role', true), '');
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'scheduled' THEN
      IF v_role <> 'authenticated' OR NOT admin_can('content.publish') THEN
        RAISE EXCEPTION 'Scheduling requires an authenticated content.publish approval' USING ERRCODE = '42501';
      END IF;
      INSERT INTO article_pipeline_state (post_id, state, owner_approved_at, owner_approved_by)
      VALUES (NEW.id, 'approved', now(), auth.uid())
      ON CONFLICT (post_id) DO UPDATE SET
        state = 'approved', owner_approved_at = now(), owner_approved_by = auth.uid(),
        last_safe_error_code = NULL, updated_at = now();
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status = 'scheduled'
     AND (OLD.status IS DISTINCT FROM 'scheduled' OR OLD.scheduled_at IS DISTINCT FROM NEW.scheduled_at) THEN
    IF v_role <> 'authenticated' OR NOT admin_can('content.publish') THEN
      RAISE EXCEPTION 'Scheduling requires an authenticated content.publish approval' USING ERRCODE = '42501';
    END IF;
    INSERT INTO article_pipeline_state (post_id, state, owner_approved_at, owner_approved_by)
    VALUES (NEW.id, 'approved', now(), auth.uid())
    ON CONFLICT (post_id) DO UPDATE SET
      state = 'approved', owner_approved_at = now(), owner_approved_by = auth.uid(),
      last_safe_error_code = NULL, updated_at = now();
  ELSIF NEW.status = 'published' AND OLD.status = 'scheduled' THEN
    UPDATE article_pipeline_state
       SET state = 'published', last_safe_error_code = NULL, updated_at = now()
     WHERE post_id = NEW.id;
  ELSIF OLD.status = 'scheduled' AND NEW.status <> 'scheduled' THEN
    UPDATE article_pipeline_state
       SET state = 'draft', owner_approved_at = NULL, owner_approved_by = NULL,
           last_safe_error_code = NULL, updated_at = now()
     WHERE post_id = NEW.id;
    UPDATE article_run_kits k
       SET review_status = 'revoked', updated_at = now()
      FROM article_runs r
     WHERE k.run_id = r.id AND r.post_id = NEW.id
       AND k.review_status IN ('pending', 'approved');
    UPDATE article_run_steps s
       SET status = 'skipped', safe_error_code = 'APPROVAL_REVOKED', finished_at = now(), updated_at = now()
      FROM article_runs r
     WHERE s.run_id = r.id AND r.post_id = NEW.id
       AND r.status IN ('queued', 'running', 'awaiting_approval')
       AND s.status IN ('queued', 'running', 'awaiting_approval');
    UPDATE automation_run_tokens t
       SET consumed_at = COALESCE(consumed_at, now())
      FROM article_runs r
     WHERE t.run_id = r.id AND r.post_id = NEW.id
       AND r.status IN ('queued', 'running', 'awaiting_approval') AND t.consumed_at IS NULL;
    UPDATE article_runs
       SET status = 'cancelled', phase = 'cancelled', dispatch_status = 'not_required',
           dispatch_lease_until = NULL, safe_error_code = 'APPROVAL_REVOKED',
           finished_at = now(), updated_at = now()
     WHERE post_id = NEW.id AND status IN ('queued', 'running', 'awaiting_approval');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_automation_track_article_approval ON posts;
CREATE TRIGGER trg_automation_track_article_approval
  AFTER INSERT OR UPDATE ON posts
  FOR EACH ROW EXECUTE FUNCTION public.automation_track_article_approval();

ALTER TABLE article_runs
  ADD COLUMN IF NOT EXISTS dispatch_status text NOT NULL DEFAULT 'pending'
    CHECK (dispatch_status IN ('pending', 'dispatching', 'dispatched', 'failed', 'not_required')),
  ADD COLUMN IF NOT EXISTS dispatch_attempts integer NOT NULL DEFAULT 0
    CHECK (dispatch_attempts BETWEEN 0 AND 3),
  ADD COLUMN IF NOT EXISTS dispatch_lease_until timestamptz,
  ADD COLUMN IF NOT EXISTS last_dispatched_at timestamptz,
  ADD COLUMN IF NOT EXISTS github_run_id bigint CHECK (github_run_id IS NULL OR github_run_id > 0),
  ADD COLUMN IF NOT EXISTS github_run_attempt integer CHECK (github_run_attempt IS NULL OR github_run_attempt BETWEEN 1 AND 100);

CREATE INDEX IF NOT EXISTS article_runs_dispatch_queue
  ON article_runs (dispatch_status, dispatch_lease_until, created_at)
  WHERE status IN ('queued', 'running');

CREATE TABLE IF NOT EXISTS article_run_steps (
  run_id uuid NOT NULL REFERENCES article_runs(id) ON DELETE CASCADE,
  step_key text NOT NULL CHECK (step_key IN (
    'preflight', 'source_snapshot', 'metadata_links', 'channel_kit',
    'asset_render', 'owner_review', 'publish_dispatch'
  )),
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'skipped', 'awaiting_approval')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 100),
  result jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(result) = 'object' AND length(result::text) <= 1024),
  safe_error_code text CHECK (safe_error_code IS NULL OR safe_error_code ~ '^[A-Z0-9_.:-]{1,64}$'),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, step_key),
  CHECK ((result - ARRAY[
    'metadata_complete', 'image_url_https', 'canonical_path_safe', 'article_links_safe',
    'source_present', 'human_review_required', 'video_enabled', 'owner_approval_present', 'kit_ready'
  ]) = '{}'::jsonb)
);
CREATE INDEX IF NOT EXISTS article_run_steps_recent ON article_run_steps (run_id, created_at);
ALTER TABLE article_run_steps ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE article_run_steps FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE article_run_steps TO authenticated;
DROP POLICY IF EXISTS article_run_steps_owner_read ON article_run_steps;
CREATE POLICY article_run_steps_owner_read ON article_run_steps
  FOR SELECT TO authenticated USING (admin_can('automation.check'));
DROP TRIGGER IF EXISTS trg_article_run_steps_audit ON article_run_steps;
CREATE TRIGGER trg_article_run_steps_audit
  AFTER INSERT OR UPDATE OR DELETE ON article_run_steps
  FOR EACH ROW EXECUTE FUNCTION public.audit_admin_change();

-- A deterministic starter kit carries only owner-entered distribution metadata.
-- It deliberately excludes posts.content and is held for owner review.
CREATE TABLE IF NOT EXISTS article_run_kits (
  run_id uuid PRIMARY KEY REFERENCES article_runs(id) ON DELETE CASCADE,
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  canonical_path text NOT NULL CHECK (canonical_path ~ '^/blog/[A-Za-z0-9_-]+$'),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 250),
  owner_excerpt text NOT NULL CHECK (length(btrim(owner_excerpt)) BETWEEN 1 AND 10000),
  image_url text NOT NULL CHECK (image_url ~* '^https://[^[:space:]]+$'),
  image_alt text NOT NULL CHECK (length(btrim(image_alt)) BETWEEN 1 AND 500),
  source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[a-f0-9]{64}$'),
  review_status text NOT NULL DEFAULT 'pending'
    CHECK (review_status IN ('pending', 'approved', 'rejected', 'revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, post_id)
);
CREATE INDEX IF NOT EXISTS article_run_kits_post_recent ON article_run_kits (post_id, created_at DESC);
ALTER TABLE article_run_kits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE article_run_kits FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE article_run_kits TO authenticated;
DROP POLICY IF EXISTS article_run_kits_owner_read ON article_run_kits;
CREATE POLICY article_run_kits_owner_read ON article_run_kits
  FOR SELECT TO authenticated USING (admin_can('automation.check'));

-- One current runner capability per run. Only the hash is persisted; issuing a
-- later, explicitly authorized GitHub retry rotates the old value.
CREATE UNIQUE INDEX IF NOT EXISTS automation_run_tokens_one_per_run
  ON automation_run_tokens (run_id);

CREATE OR REPLACE FUNCTION automation_claim_daily_runs(p_lagos_date date DEFAULT NULL)
RETURNS TABLE(run_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_day date := COALESCE(p_lagos_date, (now() AT TIME ZONE 'Africa/Lagos')::date);
  v_day_start timestamptz;
  v_day_end timestamptz;
  v_enabled boolean := false;
  v_claimed integer := 0;
  v_run record;
  v_post record;
  v_id uuid;
  v_key text;
  v_valid boolean;
  v_http_safe boolean;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  SELECT count(*) = 2 AND bool_and(enabled)
    INTO v_enabled FROM feature_flags
   WHERE flag_key IN ('automation.enabled', 'automation.daily_pipeline');
  IF NOT COALESCE(v_enabled, false) THEN RETURN; END IF;

  v_day_start := v_day::timestamp AT TIME ZONE 'Africa/Lagos';
  v_day_end := (v_day + 1)::timestamp AT TIME ZONE 'Africa/Lagos';
  PERFORM pg_advisory_xact_lock(hashtext('lixxon.automation.daily.pipeline'));

  -- Recover only an expired/failed, still-unstarted dispatch. The lease and
  -- unique run key make duplicate cron ticks and concurrent invocations safe.
  FOR v_run IN
    SELECT r.id
      FROM article_runs r
      JOIN posts p ON p.id = r.post_id
      JOIN article_pipeline_state s ON s.post_id = p.id
     WHERE r.status = 'queued'
       AND r.dispatch_status IN ('pending', 'failed', 'dispatching')
       AND r.dispatch_attempts < 3
       AND (r.dispatch_lease_until IS NULL OR r.dispatch_lease_until <= now())
       AND (r.dispatch_status <> 'failed' OR r.last_dispatched_at IS NULL OR r.last_dispatched_at <= now() - interval '5 minutes')
       AND p.status IN ('scheduled', 'published')
       AND s.owner_approved_at IS NOT NULL
       AND s.state IN ('approved', 'published')
     ORDER BY r.created_at, r.id
     LIMIT 2
     FOR UPDATE OF r SKIP LOCKED
  LOOP
    UPDATE article_runs
       SET dispatch_status = 'dispatching', dispatch_attempts = dispatch_attempts + 1,
           dispatch_lease_until = now() + interval '10 minutes', updated_at = now()
     WHERE id = v_run.id;
    run_id := v_run.id;
    RETURN NEXT;
    v_claimed := v_claimed + 1;
  END LOOP;

  -- Claim up to two articles scheduled for this Lagos day. Incomplete or unsafe
  -- rows are recorded as failed in the database and are never sent to GitHub.
  FOR v_post IN
    SELECT p.id, p.status, p.scheduled_at, p.title, p.slug, p.excerpt, p.category_id,
           p.tags, p.cover_image, p.cover_image_alt, p.seo_title, p.seo_description,
           p.content, s.owner_approved_by, s.owner_approved_at
      FROM posts p
      JOIN article_intake_items i ON i.post_id = p.id AND i.intake_status = 'queued'
      JOIN article_pipeline_state s ON s.post_id = p.id
     WHERE p.status IN ('scheduled', 'published')
       AND p.scheduled_at >= v_day_start AND p.scheduled_at < v_day_end
       AND s.state IN ('approved', 'published') AND s.owner_approved_at IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM article_runs active_run
          WHERE active_run.post_id = p.id
            AND active_run.status IN ('queued', 'running', 'awaiting_approval', 'completed')
       )
       AND NOT EXISTS (
         SELECT 1 FROM article_runs same_run
          WHERE same_run.idempotency_key = 'daily:' || p.id::text || ':' || v_day::text || ':'
            || to_char(p.scheduled_at AT TIME ZONE 'UTC', 'YYYYMMDDHH24MI')
       )
     ORDER BY p.scheduled_at, p.id
     LIMIT GREATEST(0, 2 - v_claimed)
     FOR UPDATE OF p SKIP LOCKED
  LOOP
    v_key := 'daily:' || v_post.id::text || ':' || v_day::text || ':'
      || to_char(v_post.scheduled_at AT TIME ZONE 'UTC', 'YYYYMMDDHH24MI');
    v_http_safe := COALESCE(v_post.content, '') !~* 'http://'
      AND COALESCE(v_post.content, '') !~* '(javascript|data|file|vbscript):'
      AND COALESCE(v_post.content, '') !~* 'https?://(localhost|127(\.[0-9]{1,3}){3}|10(\.[0-9]{1,3}){3}|192\.168(\.[0-9]{1,3}){2}|172\.(1[6-9]|2[0-9]|3[01])(\.[0-9]{1,3}){2}|[^ /]+\.local)([:/]|$)';
    v_valid := v_post.status IN ('scheduled', 'published')
      AND v_post.scheduled_at IS NOT NULL
      AND NULLIF(btrim(v_post.title), '') IS NOT NULL AND length(v_post.title) <= 200
      AND v_post.slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
      AND NULLIF(btrim(v_post.excerpt), '') IS NOT NULL
      AND v_post.category_id IS NOT NULL
      AND COALESCE(cardinality(v_post.tags), 0) > 0
      AND v_post.cover_image ~ '^https://[^[:space:]]+$'
      AND NULLIF(btrim(v_post.cover_image_alt), '') IS NOT NULL
      AND NULLIF(btrim(v_post.seo_title), '') IS NOT NULL AND length(v_post.seo_title) <= 70
      AND NULLIF(btrim(v_post.seo_description), '') IS NOT NULL AND length(v_post.seo_description) <= 160
      AND NULLIF(btrim(v_post.content), '') IS NOT NULL
      AND v_http_safe
      AND NOT EXISTS (SELECT 1 FROM posts duplicate_slug WHERE duplicate_slug.slug = v_post.slug
                       AND duplicate_slug.id <> v_post.id AND duplicate_slug.status <> 'archived');

    INSERT INTO article_runs (
      post_id, idempotency_key, status, phase, created_by, safe_error_code, finished_at, dispatch_status
    ) VALUES (
      v_post.id, v_key,
      CASE WHEN v_valid THEN 'queued' ELSE 'failed' END,
      CASE WHEN v_valid THEN 'preflight' ELSE 'preflight' END,
      v_post.owner_approved_by,
      CASE WHEN v_valid THEN NULL ELSE 'PREFLIGHT_INVALID' END,
      CASE WHEN v_valid THEN NULL ELSE now() END,
      CASE WHEN v_valid THEN 'pending' ELSE 'not_required' END
    ) RETURNING id INTO v_id;

    UPDATE article_pipeline_state
       SET last_run_id = v_id,
           state = CASE WHEN v_valid THEN 'queued' ELSE 'failed' END,
           last_safe_error_code = CASE WHEN v_valid THEN NULL ELSE 'PREFLIGHT_INVALID' END,
           updated_at = now()
     WHERE post_id = v_post.id;

    INSERT INTO article_run_steps (run_id, step_key, status, attempt_count, result, safe_error_code, started_at, finished_at)
    VALUES
      (v_id, 'preflight', CASE WHEN v_valid THEN 'succeeded' ELSE 'failed' END, 1,
        jsonb_build_object('metadata_complete', v_valid, 'owner_approval_present', true, 'article_links_safe', v_http_safe),
        CASE WHEN v_valid THEN NULL ELSE 'PREFLIGHT_INVALID' END, now(), now()),
      (v_id, 'source_snapshot', CASE WHEN v_valid THEN 'queued' ELSE 'skipped' END, 0, '{}', CASE WHEN v_valid THEN NULL ELSE 'PREFLIGHT_INVALID' END, NULL, CASE WHEN v_valid THEN NULL ELSE now() END),
      (v_id, 'metadata_links', CASE WHEN v_valid THEN 'queued' ELSE 'skipped' END, 0, '{}', CASE WHEN v_valid THEN NULL ELSE 'PREFLIGHT_INVALID' END, NULL, CASE WHEN v_valid THEN NULL ELSE now() END),
      (v_id, 'channel_kit', CASE WHEN v_valid THEN 'queued' ELSE 'skipped' END, 0, '{}', CASE WHEN v_valid THEN NULL ELSE 'PREFLIGHT_INVALID' END, NULL, CASE WHEN v_valid THEN NULL ELSE now() END),
      (v_id, 'asset_render', CASE WHEN v_valid THEN 'queued' ELSE 'skipped' END, 0, '{}', CASE WHEN v_valid THEN NULL ELSE 'PREFLIGHT_INVALID' END, NULL, CASE WHEN v_valid THEN NULL ELSE now() END),
      (v_id, 'owner_review', CASE WHEN v_valid THEN 'queued' ELSE 'skipped' END, 0, '{}', CASE WHEN v_valid THEN NULL ELSE 'PREFLIGHT_INVALID' END, NULL, CASE WHEN v_valid THEN NULL ELSE now() END),
      (v_id, 'publish_dispatch', CASE WHEN v_valid THEN 'queued' ELSE 'skipped' END, 0, '{}', CASE WHEN v_valid THEN NULL ELSE 'PREFLIGHT_INVALID' END, NULL, CASE WHEN v_valid THEN NULL ELSE now() END);

    IF v_valid THEN
      UPDATE article_runs
         SET dispatch_status = 'dispatching', dispatch_attempts = 1,
             dispatch_lease_until = now() + interval '10 minutes', updated_at = now()
       WHERE id = v_id;
      run_id := v_id;
      RETURN NEXT;
      v_claimed := v_claimed + 1;
    ELSE
      INSERT INTO automation_logs (event_code, status, entity_type, entity_id, details)
      VALUES ('RUN.PREFLIGHT', 'failed', 'article_run', v_id,
        jsonb_build_object('run_id', v_id, 'step', 'preflight', 'error_code', 'PREFLIGHT_INVALID'));
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION automation_record_daily_dispatch(
  p_run_id uuid, p_result text, p_safe_error_code text DEFAULT NULL, p_http_status integer DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_attempts integer;
  v_status text;
  v_error text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF p_result IS NULL OR p_result NOT IN ('dispatched', 'failed') THEN RAISE EXCEPTION 'Invalid dispatch outcome'; END IF;
  IF p_result = 'failed' AND COALESCE(p_safe_error_code, '') NOT IN (
    'GITHUB_TOKEN_MISSING', 'GITHUB_AUTH', 'GITHUB_FORBIDDEN', 'GITHUB_RATE_LIMITED',
    'GITHUB_UNAVAILABLE', 'GITHUB_UNEXPECTED', 'GITHUB_NETWORK_ERROR'
  ) THEN RAISE EXCEPTION 'Invalid safe dispatch error'; END IF;
  IF p_http_status IS NOT NULL AND p_http_status NOT BETWEEN 100 AND 599 THEN RAISE EXCEPTION 'Invalid HTTP status'; END IF;

  SELECT dispatch_attempts, status INTO v_attempts, v_status
    FROM article_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND OR v_status NOT IN ('queued', 'running', 'awaiting_approval') THEN RETURN false; END IF;
  IF p_result = 'dispatched' THEN
    UPDATE article_runs
       SET dispatch_status = 'dispatched', dispatch_lease_until = NULL,
           last_dispatched_at = now(), safe_error_code = NULL, updated_at = now()
     WHERE id = p_run_id;
    v_error := NULL;
  ELSE
    UPDATE article_runs
       SET dispatch_status = 'failed', dispatch_lease_until = NULL,
           last_dispatched_at = now(),
           safe_error_code = CASE WHEN v_attempts >= 3 THEN p_safe_error_code ELSE NULL END,
           status = CASE WHEN v_attempts >= 3 THEN 'failed' ELSE status END,
           finished_at = CASE WHEN v_attempts >= 3 THEN now() ELSE finished_at END,
           phase = CASE WHEN v_attempts >= 3 THEN 'dispatch' ELSE phase END,
           updated_at = now()
     WHERE id = p_run_id;
    v_error := p_safe_error_code;
  END IF;
  INSERT INTO automation_logs (event_code, status, entity_type, entity_id, details)
  VALUES ('ACTIONS.DISPATCH', CASE WHEN p_result = 'dispatched' THEN 'succeeded' ELSE 'failed' END,
    'article_run', p_run_id,
    jsonb_strip_nulls(jsonb_build_object(
      'run_id', p_run_id, 'step', 'dispatch', 'http_status', p_http_status, 'error_code', v_error
    )));
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION automation_issue_run_capability(
  p_run_id uuid, p_token_hash text, p_expires_at timestamptz,
  p_github_run_id bigint, p_github_run_attempt integer
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_run article_runs%ROWTYPE;
  v_post_status text;
  v_approval_at timestamptz;
  v_pipeline_state text;
  v_flags_enabled boolean := false;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF COALESCE(p_token_hash, '') !~ '^[a-f0-9]{64}$'
     OR p_expires_at IS NULL OR p_expires_at <= now() OR p_expires_at > now() + interval '5 minutes'
     OR p_github_run_id IS NULL OR p_github_run_id <= 0
     OR p_github_run_attempt IS NULL OR p_github_run_attempt NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Invalid short-lived runner capability';
  END IF;
  SELECT count(*) = 2 AND bool_and(enabled)
    INTO v_flags_enabled FROM feature_flags
   WHERE flag_key IN ('automation.enabled', 'automation.daily_pipeline');
  IF NOT COALESCE(v_flags_enabled, false) THEN RETURN false; END IF;

  SELECT r.* INTO v_run FROM article_runs r WHERE r.id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT p.status, s.owner_approved_at, s.state
    INTO v_post_status, v_approval_at, v_pipeline_state
    FROM posts p JOIN article_pipeline_state s ON s.post_id = p.id
   WHERE p.id = v_run.post_id;
  IF NOT FOUND OR v_post_status NOT IN ('scheduled', 'published')
     OR v_approval_at IS NULL OR v_pipeline_state NOT IN ('approved', 'published', 'queued', 'preflight', 'failed') THEN
    RETURN false;
  END IF;

  IF v_run.status = 'queued' AND v_run.github_run_id IS NULL
     AND v_run.dispatch_status IN ('dispatching', 'dispatched', 'failed') THEN
    NULL;
  ELSIF v_run.status = 'failed'
     AND v_run.github_run_id = p_github_run_id
     AND p_github_run_attempt > COALESCE(v_run.github_run_attempt, 0) THEN
    UPDATE article_run_steps
       SET status = 'queued', safe_error_code = NULL, started_at = NULL, finished_at = NULL, updated_at = now()
     WHERE run_id = p_run_id AND status IN ('failed', 'running');
  ELSE
    RETURN false;
  END IF;

  UPDATE article_runs
     SET status = 'running', phase = 'preflight', started_at = COALESCE(started_at, now()),
         finished_at = NULL, safe_error_code = NULL, github_run_id = p_github_run_id,
         github_run_attempt = p_github_run_attempt, dispatch_lease_until = NULL, updated_at = now()
   WHERE id = p_run_id;
  INSERT INTO automation_run_tokens (run_id, token_hash, scopes, expires_at, consumed_at, created_at)
  VALUES (p_run_id, lower(p_token_hash), ARRAY['pipeline:execute'], p_expires_at, NULL, now())
  ON CONFLICT (run_id) DO UPDATE SET
    token_hash = EXCLUDED.token_hash, scopes = EXCLUDED.scopes,
    expires_at = EXCLUDED.expires_at, consumed_at = NULL, created_at = now();
  UPDATE article_pipeline_state
     SET last_run_id = p_run_id,
         state = CASE WHEN state = 'published' THEN state ELSE 'preflight' END,
         updated_at = now()
   WHERE post_id = v_run.post_id;
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION automation_redeem_run_capability(p_run_id uuid, p_token_hash text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_token automation_run_tokens%ROWTYPE;
  v_post_id uuid;
  v_status text;
  v_approval_at timestamptz;
  v_pipeline_state text;
  v_flags_enabled boolean := false;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF COALESCE(p_token_hash, '') !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invalid capability'; END IF;
  SELECT count(*) = 2 AND bool_and(enabled)
    INTO v_flags_enabled FROM feature_flags
   WHERE flag_key IN ('automation.enabled', 'automation.daily_pipeline');
  IF NOT COALESCE(v_flags_enabled, false) THEN RAISE EXCEPTION 'Automation is paused'; END IF;

  SELECT * INTO v_token FROM automation_run_tokens t
   WHERE t.run_id = p_run_id AND t.token_hash = lower(p_token_hash)
   FOR UPDATE;
  IF NOT FOUND OR v_token.consumed_at IS NOT NULL OR v_token.expires_at <= now()
     OR v_token.scopes IS DISTINCT FROM ARRAY['pipeline:execute']::text[] THEN
    RAISE EXCEPTION 'Capability is invalid, expired, or already used';
  END IF;
  SELECT r.post_id, p.status, s.owner_approved_at, s.state
    INTO v_post_id, v_status, v_approval_at, v_pipeline_state
    FROM article_runs r
    JOIN posts p ON p.id = r.post_id
    JOIN article_pipeline_state s ON s.post_id = p.id
   WHERE r.id = p_run_id AND r.status = 'running'
   FOR UPDATE OF r;
  IF NOT FOUND OR v_status NOT IN ('scheduled', 'published') OR v_approval_at IS NULL
     OR v_pipeline_state NOT IN ('approved', 'published', 'preflight') THEN
    RAISE EXCEPTION 'Article approval is no longer valid';
  END IF;
  UPDATE automation_run_tokens SET consumed_at = now() WHERE id = v_token.id;
  UPDATE article_run_steps
     SET status = 'running', attempt_count = attempt_count + 1,
         started_at = COALESCE(started_at, now()), finished_at = NULL, updated_at = now()
   WHERE run_id = p_run_id AND step_key = 'preflight' AND status IN ('succeeded', 'queued', 'running');
  RETURN jsonb_build_object('run_id', p_run_id, 'post_id', v_post_id);
END $$;

CREATE OR REPLACE FUNCTION automation_record_source_snapshot(
  p_run_id uuid, p_source_sha256 text, p_post_updated_at timestamptz
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_post_id uuid;
  v_status text;
  v_updated_at timestamptz;
  v_approval_at timestamptz;
  v_pipeline_state text;
  v_run_status text;
  v_previous_hash text;
  v_enabled boolean := false;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF COALESCE(p_source_sha256, '') !~ '^[a-f0-9]{64}$' OR p_post_updated_at IS NULL THEN
    RAISE EXCEPTION 'Invalid source snapshot';
  END IF;
  SELECT p.id, p.status, p.updated_at, s.owner_approved_at, s.state
    INTO v_post_id, v_status, v_updated_at, v_approval_at, v_pipeline_state
    FROM article_runs r
    JOIN posts p ON p.id = r.post_id
    JOIN article_pipeline_state s ON s.post_id = p.id
   WHERE r.id = p_run_id
   FOR UPDATE OF p, s;
  IF NOT FOUND OR v_status NOT IN ('scheduled', 'published')
     OR v_approval_at IS NULL OR v_pipeline_state NOT IN ('approved', 'published', 'preflight') THEN
    RETURN 'approval_revoked';
  END IF;
  IF v_updated_at IS DISTINCT FROM p_post_updated_at THEN RETURN 'source_changed'; END IF;
  SELECT r.status, r.source_sha256 INTO v_run_status, v_previous_hash
    FROM article_runs r WHERE r.id = p_run_id FOR UPDATE;
  IF NOT FOUND OR v_run_status <> 'running' THEN RETURN 'inactive'; END IF;
  SELECT count(*) = 2 AND bool_and(enabled)
    INTO v_enabled FROM feature_flags
   WHERE flag_key IN ('automation.enabled', 'automation.daily_pipeline');
  IF NOT COALESCE(v_enabled, false) THEN
    UPDATE article_runs SET status = 'paused', phase = 'paused', safe_error_code = 'AUTOMATION_PAUSED',
      finished_at = now(), updated_at = now() WHERE id = p_run_id;
    UPDATE article_run_steps SET status = 'skipped', safe_error_code = 'AUTOMATION_PAUSED',
      finished_at = now(), updated_at = now() WHERE run_id = p_run_id AND status IN ('queued', 'running');
    UPDATE article_pipeline_state SET state = CASE WHEN state = 'published' THEN state ELSE 'paused' END,
      last_run_id = p_run_id, last_safe_error_code = 'AUTOMATION_PAUSED', updated_at = now()
      WHERE post_id = v_post_id;
    RETURN 'paused';
  END IF;
  IF v_previous_hash IS NOT NULL AND v_previous_hash <> lower(p_source_sha256) THEN RETURN 'source_changed'; END IF;
  UPDATE article_runs SET source_sha256 = lower(p_source_sha256), updated_at = now()
   WHERE id = p_run_id;
  RETURN 'recorded';
END $$;

CREATE OR REPLACE FUNCTION automation_complete_pipeline_run(
  p_run_id uuid, p_source_sha256 text, p_post_updated_at timestamptz,
  p_metadata_complete boolean, p_image_url_https boolean,
  p_canonical_path_safe boolean, p_article_links_safe boolean,
  p_source_present boolean, p_human_review_required boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_run article_runs%ROWTYPE;
  v_post record;
  v_post_id uuid;
  v_previous_hash text;
  v_failed boolean := false;
  v_error text;
  v_result jsonb;
  v_video_enabled boolean := false;
  v_pipeline_enabled boolean := false;
  v_kit_ready boolean := false;
  v_post_found boolean := false;
  v_rows integer := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF COALESCE(p_source_sha256, '') !~ '^[a-f0-9]{64}$' OR p_post_updated_at IS NULL THEN RAISE EXCEPTION 'Invalid source checksum'; END IF;
  SELECT post_id INTO v_post_id FROM article_runs WHERE id = p_run_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pipeline run is not active'; END IF;
  SELECT p.status, p.updated_at, p.title, p.slug, p.excerpt, p.cover_image, p.cover_image_alt,
         s.owner_approved_at, s.state
    INTO v_post
    FROM posts p JOIN article_pipeline_state s ON s.post_id = p.id
   WHERE p.id = v_post_id
   FOR UPDATE OF p, s;
  v_post_found := FOUND;
  SELECT * INTO v_run FROM article_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND OR v_run.status <> 'running' THEN RAISE EXCEPTION 'Pipeline run is not active'; END IF;
  SELECT count(*) = 2 AND bool_and(enabled)
    INTO v_pipeline_enabled FROM feature_flags
   WHERE flag_key IN ('automation.enabled', 'automation.daily_pipeline');
  IF NOT COALESCE(v_pipeline_enabled, false) THEN
    UPDATE article_runs SET status = 'paused', phase = 'paused', safe_error_code = 'AUTOMATION_PAUSED',
      finished_at = now(), updated_at = now() WHERE id = p_run_id;
    UPDATE article_run_steps SET status = 'skipped', safe_error_code = 'AUTOMATION_PAUSED',
      finished_at = now(), updated_at = now() WHERE run_id = p_run_id AND status IN ('queued', 'running');
    UPDATE article_pipeline_state SET state = CASE WHEN state = 'published' THEN state ELSE 'paused' END,
      last_run_id = p_run_id, last_safe_error_code = 'AUTOMATION_PAUSED', updated_at = now()
      WHERE post_id = v_run.post_id;
    RETURN jsonb_build_object('run_id', p_run_id, 'status', 'paused', 'safe_error_code', 'AUTOMATION_PAUSED');
  END IF;
  SELECT COALESCE(enabled, false) INTO v_video_enabled FROM feature_flags WHERE flag_key = 'automation.video';
  v_previous_hash := v_run.source_sha256;

  IF NOT v_post_found OR v_post.status NOT IN ('scheduled', 'published')
     OR v_post.owner_approved_at IS NULL OR v_post.state NOT IN ('approved', 'published', 'preflight') THEN
    v_failed := true; v_error := 'APPROVAL_REVOKED';
  ELSIF v_post.updated_at IS DISTINCT FROM p_post_updated_at THEN
    v_failed := true; v_error := 'SOURCE_CHANGED';
  ELSIF v_previous_hash IS NULL THEN
    v_failed := true; v_error := 'SOURCE_HASH_FAILED';
  ELSIF v_previous_hash <> lower(p_source_sha256) THEN
    v_failed := true; v_error := 'SOURCE_CHANGED';
  ELSIF NOT COALESCE(p_source_present, false) THEN
    v_failed := true; v_error := 'SOURCE_EMPTY';
  ELSIF NOT COALESCE(p_metadata_complete, false) OR NOT COALESCE(p_image_url_https, false)
        OR NOT COALESCE(p_canonical_path_safe, false)
        OR EXISTS (SELECT 1 FROM posts duplicate_slug WHERE duplicate_slug.slug = v_post.slug
                    AND duplicate_slug.id <> v_post_id AND duplicate_slug.status <> 'archived') THEN
    v_failed := true; v_error := 'METADATA_INVALID';
  ELSIF NOT COALESCE(p_article_links_safe, false) THEN
    v_failed := true; v_error := 'UNSAFE_LINKS';
  ELSIF COALESCE(v_video_enabled, false) THEN
    v_failed := true; v_error := 'VIDEO_RENDERER_NOT_READY';
  END IF;

  IF NOT v_failed THEN
    INSERT INTO article_run_kits (
      run_id, post_id, canonical_path, title, owner_excerpt,
      image_url, image_alt, source_sha256, review_status
    ) VALUES (
      p_run_id, v_post_id, '/blog/' || v_post.slug, v_post.title, v_post.excerpt,
      v_post.cover_image, v_post.cover_image_alt, lower(p_source_sha256), 'pending'
    ) ON CONFLICT (run_id) DO NOTHING;
    SELECT EXISTS (
      SELECT 1 FROM article_run_kits
       WHERE run_id = p_run_id AND post_id = v_post_id
         AND source_sha256 = lower(p_source_sha256) AND review_status IN ('pending', 'approved')
    ) INTO v_kit_ready;
  END IF;

  UPDATE article_runs
     SET source_sha256 = COALESCE(source_sha256, lower(p_source_sha256)),
         status = CASE WHEN v_failed THEN 'failed' ELSE 'awaiting_approval' END,
         phase = CASE WHEN v_failed THEN 'failed' ELSE 'owner_review' END,
         safe_error_code = v_error,
         finished_at = now(), updated_at = now()
   WHERE id = p_run_id;

  UPDATE article_run_steps
     SET status = CASE WHEN v_failed AND v_error = 'APPROVAL_REVOKED' THEN 'failed' ELSE 'succeeded' END,
         attempt_count = GREATEST(attempt_count, 1),
         result = jsonb_build_object('metadata_complete', COALESCE(p_metadata_complete, false),
                                     'owner_approval_present', CASE WHEN v_post_found THEN v_post.owner_approved_at IS NOT NULL ELSE false END),
         safe_error_code = CASE WHEN v_error = 'APPROVAL_REVOKED' THEN v_error ELSE NULL END,
         finished_at = now(), updated_at = now()
   WHERE run_id = p_run_id AND step_key = 'preflight';
  UPDATE article_run_steps
     SET status = CASE WHEN v_failed AND v_error IN ('SOURCE_EMPTY', 'SOURCE_CHANGED', 'SOURCE_HASH_FAILED') THEN 'failed' ELSE 'succeeded' END,
         attempt_count = GREATEST(attempt_count, 1),
         result = jsonb_build_object('source_present', COALESCE(p_source_present, false)),
         safe_error_code = CASE WHEN v_failed AND v_error IN ('SOURCE_EMPTY', 'SOURCE_CHANGED', 'SOURCE_HASH_FAILED') THEN v_error ELSE NULL END,
         finished_at = now(), updated_at = now()
   WHERE run_id = p_run_id AND step_key = 'source_snapshot';
  UPDATE article_run_steps
     SET status = CASE WHEN v_failed AND v_error IN ('METADATA_INVALID', 'UNSAFE_LINKS') THEN 'failed' ELSE 'succeeded' END,
         attempt_count = GREATEST(attempt_count, 1),
         result = jsonb_build_object(
           'metadata_complete', COALESCE(p_metadata_complete, false),
           'image_url_https', COALESCE(p_image_url_https, false),
           'canonical_path_safe', COALESCE(p_canonical_path_safe, false),
           'article_links_safe', COALESCE(p_article_links_safe, false),
           'owner_approval_present', true
         ),
         safe_error_code = CASE WHEN v_failed AND v_error IN ('METADATA_INVALID', 'UNSAFE_LINKS') THEN v_error ELSE NULL END,
         finished_at = now(), updated_at = now()
   WHERE run_id = p_run_id AND step_key = 'metadata_links';
  UPDATE article_run_steps
     SET status = CASE
           WHEN v_failed THEN 'skipped'
           WHEN COALESCE(p_human_review_required, false) THEN 'awaiting_approval'
           ELSE 'succeeded'
         END,
         attempt_count = GREATEST(attempt_count, 1),
         result = jsonb_build_object('metadata_complete', COALESCE(p_metadata_complete, false),
                                     'human_review_required', COALESCE(p_human_review_required, false),
                                     'kit_ready', v_kit_ready),
         safe_error_code = CASE WHEN v_failed THEN 'PRIOR_STAGE_FAILED'
                                WHEN COALESCE(p_human_review_required, false) THEN 'CLAIMS_REVIEW_REQUIRED' ELSE NULL END,
         finished_at = now(), updated_at = now()
   WHERE run_id = p_run_id AND step_key = 'channel_kit';
  UPDATE article_run_steps
     SET status = CASE WHEN COALESCE(v_video_enabled, false) THEN 'failed' ELSE 'skipped' END,
         attempt_count = GREATEST(attempt_count, 1),
         result = jsonb_build_object('video_enabled', COALESCE(v_video_enabled, false)),
         safe_error_code = CASE WHEN COALESCE(v_video_enabled, false) THEN 'VIDEO_RENDERER_NOT_READY' ELSE 'VIDEO_DISABLED' END,
         finished_at = now(), updated_at = now()
   WHERE run_id = p_run_id AND step_key = 'asset_render';
  UPDATE article_run_steps
     SET status = CASE WHEN v_failed THEN 'skipped' ELSE 'awaiting_approval' END,
         attempt_count = GREATEST(attempt_count, 1),
         result = jsonb_build_object('human_review_required', COALESCE(p_human_review_required, false)),
         safe_error_code = CASE WHEN v_failed THEN 'PRIOR_STAGE_FAILED'
                                WHEN COALESCE(p_human_review_required, false) THEN 'CLAIMS_REVIEW_REQUIRED' ELSE NULL END,
         finished_at = now(), updated_at = now()
   WHERE run_id = p_run_id AND step_key = 'owner_review';
  UPDATE article_run_steps
     SET status = CASE WHEN v_failed THEN 'skipped' ELSE 'awaiting_approval' END,
         attempt_count = GREATEST(attempt_count, 1),
         result = jsonb_build_object('human_review_required', COALESCE(p_human_review_required, false)),
         safe_error_code = CASE WHEN v_failed THEN 'PRIOR_STAGE_FAILED' ELSE 'DISTRIBUTION_APPROVAL_REQUIRED' END,
         finished_at = now(), updated_at = now()
   WHERE run_id = p_run_id AND step_key = 'publish_dispatch';

  UPDATE article_pipeline_state
     SET last_run_id = p_run_id,
         state = CASE WHEN v_failed THEN 'failed' WHEN state = 'published' THEN 'published' ELSE 'awaiting_approval' END,
         last_safe_error_code = CASE WHEN v_failed THEN v_error
                                     WHEN COALESCE(p_human_review_required, false) THEN 'CLAIMS_REVIEW_REQUIRED' ELSE NULL END,
         updated_at = now()
   WHERE post_id = v_run.post_id;

  v_result := jsonb_build_object(
    'run_id', p_run_id,
    'status', CASE WHEN v_failed THEN 'failed' ELSE 'awaiting_approval' END,
    'source_checksum_recorded', true,
    'kit_ready', v_kit_ready,
    'human_review_required', COALESCE(p_human_review_required, false),
    'video_enabled', COALESCE(v_video_enabled, false),
    'safe_error_code', v_error
  );
  INSERT INTO automation_logs (event_code, status, entity_type, entity_id, details)
  VALUES ('RUN.PIPELINE', CASE WHEN v_failed THEN 'failed' ELSE 'succeeded' END, 'article_run', p_run_id,
    jsonb_strip_nulls(jsonb_build_object(
      'run_id', p_run_id, 'step', 'owner_review', 'error_code', v_error,
      'source_hash', lower(p_source_sha256)
    )));
  RETURN v_result;
END $$;

CREATE OR REPLACE FUNCTION automation_fail_pipeline_run(p_run_id uuid, p_safe_error_code text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_post_id uuid;
  v_phase text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF p_safe_error_code IS NULL OR p_safe_error_code NOT IN (
    'APPROVAL_REVOKED', 'POST_MISSING', 'SOURCE_HASH_FAILED', 'SOURCE_EMPTY', 'SOURCE_CHANGED',
    'METADATA_INVALID', 'UNSAFE_LINKS', 'VIDEO_RENDERER_NOT_READY', 'RUNNER_STEP_FAILED', 'RUNNER_DATABASE_UNAVAILABLE'
  ) THEN RAISE EXCEPTION 'Invalid safe pipeline error'; END IF;
  SELECT post_id, phase INTO v_post_id, v_phase FROM article_runs WHERE id = p_run_id AND status = 'running' FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE article_runs
     SET status = 'failed', phase = COALESCE(v_phase, 'failed'), safe_error_code = p_safe_error_code,
         finished_at = now(), dispatch_lease_until = NULL, updated_at = now()
   WHERE id = p_run_id;
  UPDATE article_run_steps
     SET status = CASE WHEN status IN ('queued', 'running') THEN 'failed' ELSE status END,
         safe_error_code = CASE WHEN status IN ('queued', 'running') THEN p_safe_error_code ELSE safe_error_code END,
         finished_at = CASE WHEN status IN ('queued', 'running') THEN now() ELSE finished_at END,
         updated_at = now()
   WHERE run_id = p_run_id;
  UPDATE article_pipeline_state
     SET last_run_id = p_run_id, state = CASE WHEN state = 'published' THEN state ELSE 'failed' END,
         last_safe_error_code = p_safe_error_code, updated_at = now()
   WHERE post_id = v_post_id;
  INSERT INTO automation_logs (event_code, status, entity_type, entity_id, details)
  VALUES ('RUN.FAILED', 'failed', 'article_run', p_run_id,
    jsonb_build_object('run_id', p_run_id, 'step', COALESCE(v_phase, 'pipeline'), 'error_code', p_safe_error_code));
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION automation_fail_runner(
  p_run_id uuid, p_github_run_id bigint, p_github_run_attempt integer
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_run article_runs%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_run FROM article_runs
   WHERE id = p_run_id AND status = 'running'
     AND github_run_id = p_github_run_id AND github_run_attempt = p_github_run_attempt
   FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  RETURN automation_fail_pipeline_run(p_run_id, 'RUNNER_STEP_FAILED');
END $$;

-- No new article publisher is introduced. The old five-minute job remains the
-- only function that changes an approved scheduled post to published.
REVOKE ALL ON TABLE article_run_steps FROM PUBLIC, anon, service_role;
REVOKE ALL ON TABLE article_run_kits FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION automation_revoke_scheduled_approval() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION automation_track_article_approval() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION automation_claim_daily_runs(date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION automation_record_daily_dispatch(uuid, text, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION automation_issue_run_capability(uuid, text, timestamptz, bigint, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION automation_redeem_run_capability(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION automation_record_source_snapshot(uuid, text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION automation_complete_pipeline_run(uuid, text, timestamptz, boolean, boolean, boolean, boolean, boolean, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION automation_fail_pipeline_run(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION automation_fail_runner(uuid, bigint, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION automation_claim_daily_runs(date) TO service_role;
GRANT EXECUTE ON FUNCTION automation_record_daily_dispatch(uuid, text, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION automation_issue_run_capability(uuid, text, timestamptz, bigint, integer) TO service_role;
GRANT EXECUTE ON FUNCTION automation_redeem_run_capability(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION automation_record_source_snapshot(uuid, text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION automation_complete_pipeline_run(uuid, text, timestamptz, boolean, boolean, boolean, boolean, boolean, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION automation_fail_pipeline_run(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION automation_fail_runner(uuid, bigint, integer) TO service_role;

DO $$
BEGIN
  -- Supabase's deployment workflow provisions the Functions URL and internal
  -- scheduler secret in Vault before migrations. Local/preview DBs skip safely.
  IF to_regclass('cron.job') IS NULL OR to_regclass('net.http_request_queue') IS NULL THEN
    RAISE NOTICE 'pg_cron/pg_net are unavailable; daily automation schedule was not registered';
    RETURN;
  END IF;
  IF to_regclass('vault.decrypted_secrets') IS NULL THEN
    RAISE NOTICE 'Supabase Vault is unavailable; daily automation schedule was not registered';
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'lixxon_supabase_functions_url')
     OR NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'lixxon_internal_fn_secret') THEN
    RAISE NOTICE 'Vault scheduler credentials are missing; daily automation schedule was not registered';
    RETURN;
  END IF;

  PERFORM cron.unschedule(jobid)
    FROM cron.job WHERE jobname = 'lixxon_automation_daily_pipeline';
  PERFORM cron.schedule(
    'lixxon_automation_daily_pipeline',
    '0 7 * * *',
    $job$
      SELECT net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'lixxon_supabase_functions_url') || '/automation-scheduler',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-internal-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'lixxon_internal_fn_secret')
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 10000
      );
    $job$
  );
END $$;

NOTIFY pgrst, 'reload schema';
