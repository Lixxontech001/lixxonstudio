-- Phase 2.3 — owner run monitor, reversible controls and safe failure alerts.

-- The old feature-flag RPC relied only on a general permission check. Keep its
-- contract, but make the kill switch and daily schedule explicitly owner-only.
CREATE OR REPLACE FUNCTION automation_set_feature_flag(p_flag_key text, p_enabled boolean)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT automation_owner_authorized() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF p_flag_key NOT IN (
    'automation.enabled', 'automation.daily_pipeline', 'automation.distribution',
    'automation.video', 'automation.agents', 'automation.push'
  ) THEN RAISE EXCEPTION 'Unknown automation feature flag'; END IF;
  UPDATE feature_flags SET enabled = COALESCE(p_enabled, false), updated_by = auth.uid(), updated_at = now()
   WHERE flag_key = p_flag_key;
  RETURN FOUND;
END $$;

-- Report an owner-requested pause as a normal safe stop to a still-running
-- Actions process rather than incorrectly turning it into an approval failure.
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
  IF NOT FOUND THEN RETURN 'approval_revoked'; END IF;
  SELECT r.status, r.source_sha256 INTO v_run_status, v_previous_hash
    FROM article_runs r WHERE r.id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'inactive'; END IF;
  IF v_status NOT IN ('scheduled', 'published') OR v_approval_at IS NULL THEN
    RETURN 'approval_revoked';
  END IF;
  IF v_run_status = 'paused' THEN RETURN 'paused'; END IF;
  IF v_run_status <> 'running' THEN RETURN 'inactive'; END IF;
  IF v_pipeline_state NOT IN ('approved', 'published', 'preflight') THEN RETURN 'approval_revoked'; END IF;
  IF v_updated_at IS DISTINCT FROM p_post_updated_at THEN RETURN 'source_changed'; END IF;

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

-- Telegram chat IDs-- Telegram chat IDs are private owner configuration and are entered only through
-- the existing Vault-backed Keys page. A bot token alone has no delivery target.
INSERT INTO automation_secret_catalog
  (secret_name, label, category, credential_type, purpose, required, sort_order, enabled)
VALUES
  ('telegram_chat_id', 'Telegram owner alert chat ID', 'social', 'identifier',
   'Destination for private automation failure alerts when email delivery is unavailable.', false, 81, true)
ON CONFLICT (secret_name) DO UPDATE SET
  label = EXCLUDED.label,
  category = EXCLUDED.category,
  credential_type = EXCLUDED.credential_type,
  purpose = EXCLUDED.purpose,
  required = EXCLUDED.required,
  sort_order = EXCLUDED.sort_order,
  enabled = true;

CREATE OR REPLACE FUNCTION automation_run_monitor_row(p_run_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'id', r.id,
    'post_id', p.id,
    'title', left(COALESCE(p.title, 'Untitled article'), 250),
    'slug', CASE WHEN p.slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' THEN p.slug ELSE NULL END,
    'post_status', p.status,
    'status', r.status,
    'phase', r.phase,
    'dispatch_status', r.dispatch_status,
    'dispatch_retries', GREATEST(r.dispatch_attempts - 1, 0),
    'workflow_attempt', r.github_run_attempt,
    'safe_error_code', r.safe_error_code,
    'created_at', r.created_at,
    'scheduled_at_utc', p.scheduled_at,
    'started_at', r.started_at,
    'finished_at', r.finished_at,
    'duration_ms', CASE WHEN r.started_at IS NULL THEN NULL
      ELSE GREATEST(0, floor(extract(epoch FROM (COALESCE(r.finished_at, now()) - r.started_at)) * 1000))::bigint END,
    'workflow_url', CASE WHEN r.github_run_id IS NOT NULL
      THEN 'https://github.com/Lixxontech001/lixxonstudio/actions/runs/' || r.github_run_id::text ELSE NULL END,
    'final_urls', CASE WHEN p.status = 'published' AND p.slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
      THEN jsonb_build_array('https://lixxonstudio.com/blog/' || p.slug) ELSE '[]'::jsonb END,
    'steps', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'key', s.step_key,
        'status', s.status,
        'attempt_count', s.attempt_count,
        'safe_error_code', s.safe_error_code,
        'started_at', s.started_at,
        'finished_at', s.finished_at,
        'duration_ms', CASE WHEN s.started_at IS NULL THEN NULL
          ELSE GREATEST(0, floor(extract(epoch FROM (COALESCE(s.finished_at, now()) - s.started_at)) * 1000))::bigint END,
        'result', s.result
      ) ORDER BY array_position(ARRAY[
        'preflight', 'source_snapshot', 'metadata_links', 'channel_kit',
        'asset_render', 'owner_review', 'publish_dispatch'
      ]::text[], s.step_key))
      FROM article_run_steps s WHERE s.run_id = r.id
    ), '[]'::jsonb),
    'kit', (
      SELECT jsonb_build_object(
        'ready', true,
        'review_status', k.review_status,
        'canonical_path', k.canonical_path,
        'title', k.title,
        'owner_excerpt', k.owner_excerpt,
        'image_alt', k.image_alt
      )
      FROM article_run_kits k WHERE k.run_id = r.id
    ),
    'logs', COALESCE((
      SELECT jsonb_agg(log_item ORDER BY created_at DESC)
      FROM (
        SELECT l.created_at,
          jsonb_strip_nulls(jsonb_build_object(
            'id', l.id,
            'event_code', l.event_code,
            'status', l.status,
            'created_at', l.created_at,
            'step', CASE WHEN l.details->>'step' ~ '^[a-z][a-z0-9_-]{0,31}$' THEN l.details->>'step' END,
            'error_code', CASE WHEN l.details->>'error_code' ~ '^[A-Z0-9_.:-]{1,64}$' THEN l.details->>'error_code' END,
            'http_status', CASE WHEN l.details->>'http_status' ~ '^[1-5][0-9]{2}$' THEN (l.details->>'http_status')::integer END,
            'retry', CASE WHEN l.details->>'retry' IN ('true', 'false') THEN (l.details->>'retry')::boolean END,
            'elapsed_ms', CASE WHEN l.details->>'elapsed_ms' ~ '^[0-9]{1,10}$' THEN (l.details->>'elapsed_ms')::integer END,
            'channel', CASE WHEN l.details->>'channel' ~ '^[a-z0-9_-]{1,32}$' THEN l.details->>'channel' END
          )) AS log_item
        FROM automation_logs l
        WHERE l.entity_type = 'article_run' AND l.entity_id = r.id
        ORDER BY l.created_at DESC
        LIMIT 20
      ) safe_logs
    ), '[]'::jsonb)
  ) INTO v_result
  FROM article_runs r
  JOIN posts p ON p.id = r.post_id
  WHERE r.id = p_run_id;
  RETURN v_result;
END $$;

CREATE OR REPLACE FUNCTION automation_run_monitor(p_limit integer DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_flags jsonb;
  v_notifications jsonb;
  v_runs jsonb;
BEGIN
  IF NOT admin_can('automation.check') THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Run limit must be between 1 and 100'; END IF;

  SELECT COALESCE(jsonb_object_agg(flag_key, enabled ORDER BY flag_key), '{}'::jsonb)
    INTO v_flags FROM feature_flags
   WHERE flag_key IN ('automation.enabled', 'automation.daily_pipeline');

  SELECT jsonb_build_object(
    'email_configured', EXISTS (
      SELECT 1 FROM automation_secrets WHERE secret_name = 'resend_api_key' AND vault_secret_id IS NOT NULL
    ),
    'telegram_configured',
      EXISTS (SELECT 1 FROM automation_secrets WHERE secret_name = 'telegram_bot_token' AND vault_secret_id IS NOT NULL)
      AND EXISTS (SELECT 1 FROM automation_secrets WHERE secret_name = 'telegram_chat_id' AND vault_secret_id IS NOT NULL)
  ) INTO v_notifications;

  SELECT COALESCE(jsonb_agg(automation_run_monitor_row(q.id) ORDER BY q.created_at DESC, q.id), '[]'::jsonb)
    INTO v_runs
    FROM (
      SELECT r.id, r.created_at
      FROM article_runs r
      ORDER BY r.created_at DESC, r.id DESC
      LIMIT p_limit
    ) q;

  RETURN jsonb_build_object(
    'runs', v_runs,
    'flags', v_flags,
    'notifications', v_notifications,
    'usage', jsonb_build_object(
      'provider_calls', 0,
      'paid_calls', 0,
      'quota_remaining', NULL,
      'quota_status', 'not_applicable',
      'note', 'This preflight runner makes no AI, video, or external publishing calls.'
    )
  );
END $$;

CREATE OR REPLACE FUNCTION automation_preview_article(p_post_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_post record;
  v_host text;
  v_metadata_complete boolean := false;
  v_image_https boolean := false;
  v_image_attribution_review boolean := true;
  v_links_safe boolean := false;
  v_claim_review boolean := false;
  v_disclaimer_present boolean := false;
  v_source_present boolean := false;
  v_approval_present boolean := false;
BEGIN
  IF NOT admin_can('automation.check') THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  SELECT p.id, p.title, p.slug, p.status, p.scheduled_at, p.excerpt,
         p.category_id, p.tags, p.cover_image, p.cover_image_alt,
         p.seo_title, p.seo_description, p.content, s.owner_approved_at
    INTO v_post
    FROM posts p
    LEFT JOIN article_pipeline_state s ON s.post_id = p.id
   WHERE p.id = p_post_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Article not found'; END IF;

  v_host := lower(split_part(split_part(COALESCE(v_post.cover_image, ''), '://', 2), '/', 1));
  v_image_https := COALESCE(v_post.cover_image, '') ~* '^https://[^[:space:]]+$'
    AND COALESCE(v_post.cover_image, '') !~* '^https://[^/@]+:[^/@]*@'
    AND v_host !~* '^(localhost|.*\.local|127(\.[0-9]{1,3}){3}|10(\.[0-9]{1,3}){3}|192\.168(\.[0-9]{1,3}){2}|172\.(1[6-9]|2[0-9]|3[01])(\.[0-9]{1,3}){2})$';
  v_image_attribution_review := v_host NOT IN (
    'jaatgiqigsmjodqgaocl.supabase.co', 'lixxonstudio.com', 'www.lixxonstudio.com', 'lixxonstudio.vercel.app'
  ) AND v_host !~* '\.lixxonstudio\.com$';
  v_source_present := NULLIF(btrim(COALESCE(v_post.content, '')), '') IS NOT NULL;
  v_links_safe := COALESCE(v_post.content, '') !~* 'http://'
    AND COALESCE(v_post.content, '') !~* '(javascript|data|file|vbscript):'
    AND COALESCE(v_post.content, '') !~* 'https?://(localhost|127(\.[0-9]{1,3}){3}|10(\.[0-9]{1,3}){3}|192\.168(\.[0-9]{1,3}){2}|172\.(1[6-9]|2[0-9]|3[01])(\.[0-9]{1,3}){2}|[^ /]+\.local)([:/]|$)';
  v_claim_review := concat_ws(E'\n', v_post.title, v_post.excerpt, v_post.content)
    ~* '\m(guarantee(d|s)?|cure(s|d)?|eliminat(e|es|ed)|treat(s|ed|ment)|heal(s|ed|ing)?|doctor[ -]+approved|clinically[ -]+proven|lose[[:space:]]+[0-9]+[[:space:]]*(kg|kilograms?|pounds?|lbs?))\M';
  v_disclaimer_present := COALESCE(v_post.content, '')
    ~* '\m(not medical advice|not a substitute for (professional )?medical advice|consult (your )?(doctor|physician|healthcare provider)|results may vary|individual results vary)\M';
  v_metadata_complete := v_post.status IN ('scheduled', 'published')
    AND NULLIF(btrim(v_post.title), '') IS NOT NULL AND length(v_post.title) <= 200
    AND v_post.slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
    AND NULLIF(btrim(v_post.excerpt), '') IS NOT NULL
    AND v_post.category_id IS NOT NULL AND COALESCE(cardinality(v_post.tags), 0) > 0
    AND v_image_https AND NULLIF(btrim(v_post.cover_image_alt), '') IS NOT NULL
    AND NULLIF(btrim(v_post.seo_title), '') IS NOT NULL AND length(v_post.seo_title) <= 70
    AND NULLIF(btrim(v_post.seo_description), '') IS NOT NULL AND length(v_post.seo_description) <= 160
    AND v_post.scheduled_at IS NOT NULL;
  SELECT s.owner_approved_at IS NOT NULL INTO v_approval_present
    FROM article_pipeline_state s WHERE s.post_id = p_post_id;
  v_approval_present := COALESCE(v_approval_present, false);

  RETURN jsonb_build_object(
    'preview_only', true,
    'post_id', p_post_id,
    'title', left(COALESCE(v_post.title, ''), 250),
    'slug', CASE WHEN v_post.slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' THEN v_post.slug ELSE NULL END,
    'status', v_post.status,
    'scheduled_at_utc', v_post.scheduled_at,
    'owner_approval_present', v_approval_present,
    'metadata_complete', v_metadata_complete,
    'image_https', v_image_https,
    'image_attribution_review_required', v_image_attribution_review,
    'article_links_safe', v_links_safe,
    'source_present', v_source_present,
    'claim_review_required', v_claim_review,
    'disclaimer_required', v_claim_review,
    'disclaimer_present', v_disclaimer_present,
    'human_review_required', v_claim_review OR v_image_attribution_review,
    'side_effects', jsonb_build_object('provider_calls', 0, 'emails', 0, 'payments', 0, 'publishes', 0, 'writes', 0)
  );
END $$;

-- Pause/resume/retry/cancel are owner-only, serialized with post edits in the
-- same posts -> pipeline-state -> run lock order as the revocation trigger.
CREATE OR REPLACE FUNCTION automation_control_run(p_run_id uuid, p_action text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_post_id uuid;
  v_post_status text;
  v_approved_at timestamptz;
  v_run article_runs%ROWTYPE;
  v_new_status text;
  v_event text;
  v_log_status text;
BEGIN
  IF NOT automation_owner_authorized() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF p_action IS NULL OR p_action NOT IN ('pause', 'resume', 'retry', 'cancel') THEN
    RAISE EXCEPTION 'Unsupported run action';
  END IF;
  SELECT post_id INTO v_post_id FROM article_runs WHERE id = p_run_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Run not found'; END IF;
  SELECT p.status, s.owner_approved_at INTO v_post_status, v_approved_at
    FROM posts p JOIN article_pipeline_state s ON s.post_id = p.id
   WHERE p.id = v_post_id
   FOR UPDATE OF p, s;
  IF NOT FOUND THEN RAISE EXCEPTION 'Article approval state not found'; END IF;
  SELECT * INTO v_run FROM article_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Run not found'; END IF;

  IF p_action = 'pause' THEN
    IF v_run.status NOT IN ('queued', 'running', 'awaiting_approval')
       OR v_post_status NOT IN ('scheduled', 'published') OR v_approved_at IS NULL THEN
      RAISE EXCEPTION 'This run cannot be paused in its current state';
    END IF;
    UPDATE article_runs SET status = 'paused', phase = 'paused', safe_error_code = 'AUTOMATION_PAUSED',
      dispatch_lease_until = NULL, finished_at = now(), updated_at = now()
     WHERE id = p_run_id;
    UPDATE article_run_steps SET status = 'skipped', safe_error_code = 'AUTOMATION_PAUSED',
      finished_at = now(), updated_at = now()
     WHERE run_id = p_run_id AND status IN ('queued', 'running', 'awaiting_approval');
    UPDATE automation_run_tokens SET consumed_at = COALESCE(consumed_at, now())
     WHERE run_id = p_run_id AND consumed_at IS NULL;
    UPDATE article_pipeline_state SET state = CASE WHEN state = 'published' THEN state ELSE 'paused' END,
      last_run_id = p_run_id, last_safe_error_code = 'AUTOMATION_PAUSED', updated_at = now()
     WHERE post_id = v_post_id;
    v_new_status := 'paused'; v_event := 'RUN.PAUSED'; v_log_status := 'paused';
  ELSIF p_action IN ('resume', 'retry') THEN
    IF v_post_status NOT IN ('scheduled', 'published') OR v_approved_at IS NULL THEN
      RAISE EXCEPTION 'The article must remain scheduled and owner-approved before it can resume';
    END IF;
    IF p_action = 'resume' AND v_run.status <> 'paused' THEN
      RAISE EXCEPTION 'Only a paused run can resume';
    END IF;
    IF p_action = 'retry' AND (v_run.status <> 'failed' OR v_run.safe_error_code NOT IN (
      'GITHUB_TOKEN_MISSING', 'GITHUB_AUTH', 'GITHUB_FORBIDDEN', 'GITHUB_RATE_LIMITED',
      'GITHUB_UNAVAILABLE', 'GITHUB_UNEXPECTED', 'GITHUB_NETWORK_ERROR',
      'RUNNER_STEP_FAILED', 'RUNNER_DATABASE_UNAVAILABLE', 'VIDEO_RENDERER_NOT_READY'
    )) THEN
      RAISE EXCEPTION 'This failure is not safe to retry; correct and re-approve the article instead';
    END IF;
    IF EXISTS (SELECT 1 FROM article_run_steps WHERE run_id = p_run_id AND attempt_count >= 100) THEN
      RAISE EXCEPTION 'The safe retry limit for this run has been reached';
    END IF;
    UPDATE article_run_steps SET status = 'queued', result = '{}'::jsonb, safe_error_code = NULL,
      started_at = NULL, finished_at = NULL, updated_at = now()
     WHERE run_id = p_run_id;
    UPDATE automation_run_tokens SET consumed_at = COALESCE(consumed_at, now())
     WHERE run_id = p_run_id AND consumed_at IS NULL;
    UPDATE article_runs SET status = 'queued', phase = 'preflight', safe_error_code = NULL,
      started_at = NULL, finished_at = NULL, dispatch_status = 'pending', dispatch_attempts = 0,
      dispatch_lease_until = NULL, last_dispatched_at = NULL, github_run_id = NULL,
      github_run_attempt = NULL, updated_at = now()
     WHERE id = p_run_id;
    UPDATE article_pipeline_state SET last_run_id = p_run_id, state = 'queued',
      last_safe_error_code = NULL, updated_at = now()
     WHERE post_id = v_post_id;
    v_new_status := 'queued'; v_event := CASE WHEN p_action = 'retry' THEN 'RUN.RETRIED' ELSE 'RUN.RESUMED' END;
    v_log_status := 'retried';
  ELSE
    IF v_run.status IN ('completed', 'cancelled') THEN RAISE EXCEPTION 'This run is already terminal'; END IF;
    UPDATE article_runs SET status = 'cancelled', phase = 'cancelled', safe_error_code = 'OWNER_CANCELLED',
      dispatch_status = 'not_required', dispatch_lease_until = NULL,
      finished_at = now(), updated_at = now()
     WHERE id = p_run_id;
    UPDATE article_run_steps SET status = 'skipped', safe_error_code = 'OWNER_CANCELLED',
      finished_at = now(), updated_at = now()
     WHERE run_id = p_run_id AND status IN ('queued', 'running', 'awaiting_approval');
    UPDATE automation_run_tokens SET consumed_at = COALESCE(consumed_at, now())
     WHERE run_id = p_run_id AND consumed_at IS NULL;
    UPDATE article_run_kits SET review_status = 'revoked', updated_at = now()
     WHERE run_id = p_run_id AND review_status IN ('pending', 'approved');
    UPDATE article_pipeline_state
       SET last_run_id = p_run_id,
           state = CASE WHEN v_post_status = 'published' THEN 'published'
                        WHEN v_post_status = 'scheduled' AND v_approved_at IS NOT NULL THEN 'approved'
                        ELSE 'draft' END,
           last_safe_error_code = NULL, updated_at = now()
     WHERE post_id = v_post_id;
    v_new_status := 'cancelled'; v_event := 'RUN.CANCELLED'; v_log_status := 'cancelled';
  END IF;

  INSERT INTO automation_logs (event_code, status, entity_type, entity_id, details, actor_id)
  VALUES (v_event, v_log_status, 'article_run', p_run_id,
    jsonb_build_object('run_id', p_run_id, 'step', 'owner_control',
      'error_code', CASE WHEN p_action = 'cancel' THEN 'OWNER_CANCELLED'
                         WHEN p_action = 'pause' THEN 'AUTOMATION_PAUSED' ELSE NULL END), auth.uid());
  RETURN jsonb_build_object('ok', true, 'run_id', p_run_id, 'action', p_action,
    'status', v_new_status, 'dispatch_after', CASE WHEN v_new_status = 'queued' THEN 'next_daily_tick' ELSE NULL END);
END $$;

-- Claim each terminal failure exactly once per attempt. The timestamp and the
-- runner/dispatch attempt participate in the scope so a retry may alert again.
CREATE OR REPLACE FUNCTION automation_claim_failure_alerts(p_limit integer DEFAULT 10)
RETURNS TABLE(run_id uuid, safe_error_code text, event text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_run article_runs%ROWTYPE;
  v_scope text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 25 THEN RAISE EXCEPTION 'Alert batch limit must be between 1 and 25'; END IF;
  FOR v_run IN
    SELECT r.* FROM article_runs r
     WHERE r.status = 'failed' AND r.finished_at IS NOT NULL AND r.safe_error_code IN (
       'PREFLIGHT_INVALID', 'GITHUB_TOKEN_MISSING', 'GITHUB_AUTH', 'GITHUB_FORBIDDEN',
       'GITHUB_RATE_LIMITED', 'GITHUB_UNAVAILABLE', 'GITHUB_UNEXPECTED', 'GITHUB_NETWORK_ERROR',
       'APPROVAL_REVOKED', 'POST_MISSING', 'SOURCE_HASH_FAILED', 'SOURCE_EMPTY', 'SOURCE_CHANGED',
       'METADATA_INVALID', 'UNSAFE_LINKS', 'RUNNER_STEP_FAILED', 'RUNNER_DATABASE_UNAVAILABLE',
       'VIDEO_RENDERER_NOT_READY'
     )
       AND NOT EXISTS (
         SELECT 1 FROM automation_logs l
          WHERE l.entity_type = 'article_run' AND l.entity_id = r.id
            AND l.event_code = 'ALERT.CLAIM'
            AND l.details->>'alert_scope' = concat(
              to_char(r.finished_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'),
              ':d', r.dispatch_attempts, ':g', COALESCE(r.github_run_id::text, '0'),
              ':a', COALESCE(r.github_run_attempt::text, '0')
            )
       )
     ORDER BY r.finished_at, r.id
     FOR UPDATE OF r SKIP LOCKED
     LIMIT p_limit
  LOOP
    v_scope := concat(
      to_char(v_run.finished_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'),
      ':d', v_run.dispatch_attempts, ':g', COALESCE(v_run.github_run_id::text, '0'),
      ':a', COALESCE(v_run.github_run_attempt::text, '0')
    );
    INSERT INTO automation_logs (event_code, status, entity_type, entity_id, details)
    VALUES ('ALERT.CLAIM', 'started', 'article_run', v_run.id,
      jsonb_build_object('run_id', v_run.id, 'step', 'failure_alert',
        'error_code', v_run.safe_error_code, 'channel', 'gate', 'alert_scope', v_scope));
    run_id := v_run.id;
    safe_error_code := v_run.safe_error_code;
    event := CASE WHEN v_run.dispatch_status = 'failed' AND v_run.safe_error_code LIKE 'GITHUB_%'
      THEN 'dispatch_failed' ELSE 'pipeline_failed' END;
    RETURN NEXT;
  END LOOP;
END $$;

-- Alert addresses are private and visible only to the service-role Edge Functions.
CREATE OR REPLACE FUNCTION automation_alert_recipients()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object('email', lower(u.email::text)) ORDER BY lower(u.email::text))
      FROM app_admins a
      JOIN auth.users u ON u.id = a.user_id
     WHERE a.status = 'active' AND (a.is_founder OR a.role = 'owner')
       AND u.email IS NOT NULL
       AND lower(u.email::text) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$'
  ), '[]'::jsonb);
END $$;

REVOKE ALL ON FUNCTION automation_run_monitor_row(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION automation_run_monitor(integer) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION automation_preview_article(uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION automation_control_run(uuid, text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION automation_claim_failure_alerts(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION automation_alert_recipients() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION automation_run_monitor(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION automation_preview_article(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION automation_control_run(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION automation_claim_failure_alerts(integer) TO service_role;
GRANT EXECUTE ON FUNCTION automation_alert_recipients() TO service_role;

NOTIFY pgrst, 'reload schema';
