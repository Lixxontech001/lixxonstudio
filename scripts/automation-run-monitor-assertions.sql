-- Phase 2.3 assertions: owner-only schedule/run controls, a safe run-monitor DTO,
-- no-content preview, exactly-once failure claims, and private alert recipients.
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION _automation_monitor_text(role_name text, claims jsonb, expr text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  EXECUTE format('SET LOCAL ROLE %I', role_name);
  PERFORM set_config('request.jwt.claims', claims::text, true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(claims->>'sub', ''), true);
  PERFORM set_config('request.jwt.claim.role', COALESCE(claims->>'role', role_name), true);
  EXECUTE 'SELECT (' || expr || ')::text' INTO v;
  RESET ROLE;
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION _automation_monitor_action(role_name text, claims jsonb, stmt text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('SET LOCAL ROLE %I', role_name);
  PERFORM set_config('request.jwt.claims', claims::text, true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(claims->>'sub', ''), true);
  PERFORM set_config('request.jwt.claim.role', COALESCE(claims->>'role', role_name), true);
  EXECUTE stmt;
  RESET ROLE;
END $$;

CREATE OR REPLACE FUNCTION _automation_monitor_raises(role_name text, claims jsonb, stmt text)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE raised boolean := false;
BEGIN
  EXECUTE format('SET LOCAL ROLE %I', role_name);
  PERFORM set_config('request.jwt.claims', claims::text, true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(claims->>'sub', ''), true);
  PERFORM set_config('request.jwt.claim.role', COALESCE(claims->>'role', role_name), true);
  BEGIN
    EXECUTE stmt;
  EXCEPTION WHEN others THEN
    raised := true;
  END;
  RESET ROLE;
  RETURN raised;
END $$;

DO $$
DECLARE
  v_owner jsonb := '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000001","email":"owner@lixxonstudio.com"}'::jsonb;
  v_editor jsonb := '{"role":"authenticated","sub":"00000000-0000-0000-0000-0000000000e5","email":"intake-writer@example.com"}'::jsonb;
  v_anon jsonb := '{"role":"anon"}'::jsonb;
  v_service jsonb := '{"role":"service_role"}'::jsonb;
  v_post uuid := '83000000-0000-0000-0000-000000000001';
  v_pause_run uuid := '83000000-0000-0000-0000-000000000011';
  v_retry_run uuid := '83000000-0000-0000-0000-000000000012';
  v_preflight_run uuid := '83000000-0000-0000-0000-000000000013';
  v_when timestamptz := (((now() AT TIME ZONE 'Africa/Lagos')::date + 8 + time '09:00') AT TIME ZONE 'Africa/Lagos');
  v_monitor jsonb;
  v_preview jsonb;
  v_control jsonb;
  v_alerts jsonb;
  v_recipients jsonb;
  v_content_sentinel text := 'PROSESECRET';
  fn record;
BEGIN
  IF NOT has_function_privilege('authenticated', 'public.automation_run_monitor(integer)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.automation_preview_article(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.automation_control_run(uuid,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.automation_run_monitor(integer)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.automation_preview_article(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.automation_control_run(uuid,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.automation_claim_failure_alerts(integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.automation_alert_recipients()', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.automation_claim_failure_alerts(integer)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.automation_alert_recipients()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.automation_run_monitor_row(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Run-monitor or failure-alert RPC grants are too broad or unavailable';
  END IF;

  FOR fn IN
    SELECT p.proname, p.prosecdef, p.proconfig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname IN (
       'automation_run_monitor_row', 'automation_run_monitor', 'automation_preview_article',
       'automation_control_run', 'automation_set_feature_flag',
       'automation_claim_failure_alerts', 'automation_alert_recipients'
     )
  LOOP
    IF fn.prosecdef IS NOT TRUE THEN RAISE EXCEPTION '% is not SECURITY DEFINER', fn.proname; END IF;
    IF position('search_path=public, pg_temp' IN COALESCE(array_to_string(fn.proconfig, ','), '')) = 0 THEN
      RAISE EXCEPTION '% does not pin the required safe search_path', fn.proname;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM automation_secret_catalog
     WHERE secret_name = 'telegram_chat_id' AND credential_type = 'identifier' AND enabled
  ) THEN RAISE EXCEPTION 'Telegram alert destination is not registered as a private identifier'; END IF;

  -- Grant a non-owner both the client permission and a direct override. Database
  -- owner checks must still refuse global switches and run controls.
  INSERT INTO admin_permission_overrides (user_id, permission, effect, note, created_by)
  VALUES ('00000000-0000-0000-0000-0000000000e5', 'automation.manage', 'grant', 'monitor authorization test', '00000000-0000-0000-0000-000000000001')
  ON CONFLICT (user_id, permission) DO UPDATE SET effect = 'grant', note = EXCLUDED.note;

  PERFORM set_config('request.jwt.claims', '{}', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  PERFORM set_config('lixxon.automation_agent', 'off', true);
  INSERT INTO posts (
    id, title, slug, status, content, excerpt, category_id, tags,
    cover_image, cover_image_alt, seo_title, seo_description
  ) VALUES (
    v_post, 'Automation monitor owner title', 'automation-monitor-owner-title', 'draft', v_content_sentinel,
    'Owner-authored excerpt only.', '59d3acce-f83a-46db-84a3-c65f97d68a47', ARRAY['monitor-fixture'],
    'https://lixxonstudio.com/images/monitor.jpg', 'Owner-authored cover alt',
    'Automation monitor title', 'Owner-authored search description.'
  ) ON CONFLICT (id) DO NOTHING;
  PERFORM _automation_monitor_text('authenticated', v_editor,
    format('article_intake_save(%L::uuid,%L,%L,1,%L::timestamptz)', v_post, 'monitor-owner.docx', repeat('c',64), v_when::text));
  PERFORM _automation_monitor_action('authenticated', v_owner,
    format('UPDATE posts SET status = ''scheduled'', scheduled_at = %L::timestamptz WHERE id = %L::uuid', v_when::text, v_post));

  INSERT INTO article_runs (id, post_id, idempotency_key, status, phase, created_by, dispatch_status, dispatch_attempts)
  VALUES
    (v_pause_run, v_post, 'monitor-pause-' || v_pause_run::text, 'queued', 'preflight', '00000000-0000-0000-0000-000000000001', 'pending', 0),
    (v_retry_run, v_post, 'monitor-retry-' || v_retry_run::text, 'failed', 'failed', '00000000-0000-0000-0000-000000000001', 'dispatched', 1),
    (v_preflight_run, v_post, 'monitor-preflight-' || v_preflight_run::text, 'failed', 'preflight', '00000000-0000-0000-0000-000000000001', 'not_required', 0)
  ON CONFLICT (id) DO NOTHING;
  UPDATE article_runs SET safe_error_code = 'RUNNER_STEP_FAILED', finished_at = now() - interval '2 minutes'
   WHERE id = v_retry_run;
  UPDATE article_runs SET safe_error_code = 'PREFLIGHT_INVALID', finished_at = now() - interval '1 minute'
   WHERE id = v_preflight_run;
  INSERT INTO article_run_steps (run_id, step_key, status, attempt_count, result, safe_error_code)
  SELECT v_pause_run, step_key, 'queued', 0, '{}'::jsonb, NULL
    FROM unnest(ARRAY['preflight', 'source_snapshot', 'metadata_links', 'channel_kit', 'asset_render', 'owner_review', 'publish_dispatch']) step_key
  ON CONFLICT (run_id, step_key) DO NOTHING;
  INSERT INTO article_run_steps (run_id, step_key, status, attempt_count, result, safe_error_code, finished_at)
  VALUES (v_retry_run, 'preflight', 'failed', 1, '{"metadata_complete":true}'::jsonb, 'RUNNER_STEP_FAILED', now() - interval '2 minutes'),
         (v_preflight_run, 'preflight', 'failed', 0, '{}'::jsonb, 'PREFLIGHT_INVALID', now() - interval '1 minute')
  ON CONFLICT (run_id, step_key) DO NOTHING;

  -- Owner sees safe run metadata and source-free preview only.
  v_monitor := _automation_monitor_text('authenticated', v_owner, 'automation_run_monitor(50)')::jsonb;
  IF jsonb_typeof(v_monitor->'runs') <> 'array'
     OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_monitor->'runs') r WHERE r->>'id' = v_pause_run::text)
     OR NOT (v_monitor->'flags' ? 'automation.enabled')
     OR v_monitor::text LIKE '%' || v_content_sentinel || '%'
     OR v_monitor::text LIKE '%secret_value%'
     OR v_monitor::text LIKE '%vault_secret_id%' THEN
    RAISE EXCEPTION 'Run monitor returned an incomplete or unsafe payload';
  END IF;
  v_preview := _automation_monitor_text('authenticated', v_owner,
    format('automation_preview_article(%L::uuid)', v_post))::jsonb;
  IF v_preview->>'preview_only' IS DISTINCT FROM 'true'
     OR v_preview->>'title' IS DISTINCT FROM 'Automation monitor owner title'
     OR v_preview::text LIKE '%' || v_content_sentinel || '%'
     OR v_preview->'side_effects' <> '{"provider_calls":0,"emails":0,"payments":0,"publishes":0,"writes":0}'::jsonb THEN
    RAISE EXCEPTION 'Article preview leaked prose or was not side-effect free';
  END IF;
  IF NOT _automation_monitor_raises('authenticated', v_editor, 'SELECT automation_run_monitor(50)')
     OR NOT _automation_monitor_raises('authenticated', v_editor,
       format('SELECT automation_preview_article(%L::uuid)', v_post)) THEN
    RAISE EXCEPTION 'A non-authorized user read another owner''s run or preview';
  END IF;

  -- Owner-only schedule/kill switch and run controls survive direct permission overrides.
  IF NOT _automation_monitor_raises('authenticated', v_editor,
       format('SELECT automation_control_run(%L::uuid, ''pause'')', v_pause_run))
     OR NOT _automation_monitor_raises('authenticated', v_editor,
       'SELECT automation_set_feature_flag(''automation.enabled'', true)') THEN
    RAISE EXCEPTION 'A non-owner permission override gained owner automation controls';
  END IF;

  v_control := _automation_monitor_text('authenticated', v_owner,
    format('automation_control_run(%L::uuid, ''pause'')', v_pause_run))::jsonb;
  IF v_control->>'status' <> 'paused'
     OR NOT EXISTS (SELECT 1 FROM article_runs WHERE id = v_pause_run AND status = 'paused' AND safe_error_code = 'AUTOMATION_PAUSED')
     OR NOT EXISTS (SELECT 1 FROM article_pipeline_state WHERE post_id = v_post AND state = 'paused')
     OR EXISTS (SELECT 1 FROM article_run_steps WHERE run_id = v_pause_run AND status IN ('queued', 'running')) THEN
    RAISE EXCEPTION 'Owner pause did not stop the run and preserve pipeline state';
  END IF;
  IF _automation_monitor_text('service_role', v_service,
       format('automation_record_source_snapshot(%L::uuid,%L::text,(SELECT updated_at FROM posts WHERE id = %L::uuid))', v_pause_run, repeat('d',64), v_post)) <> 'paused' THEN
    RAISE EXCEPTION 'An in-flight Actions runner treated an owner pause as a failure';
  END IF;
  v_control := _automation_monitor_text('authenticated', v_owner,
    format('automation_control_run(%L::uuid, ''resume'')', v_pause_run))::jsonb;
  IF v_control->>'status' <> 'queued' OR v_control->>'dispatch_after' <> 'next_daily_tick'
     OR NOT EXISTS (SELECT 1 FROM article_runs WHERE id = v_pause_run AND status = 'queued' AND dispatch_status = 'pending' AND dispatch_attempts = 0)
     OR NOT EXISTS (SELECT 1 FROM article_pipeline_state WHERE post_id = v_post AND state = 'queued') THEN
    RAISE EXCEPTION 'Owner resume did not queue safely for the next daily tick';
  END IF;
  v_control := _automation_monitor_text('authenticated', v_owner,
    format('automation_control_run(%L::uuid, ''cancel'')', v_pause_run))::jsonb;
  IF v_control->>'status' <> 'cancelled'
     OR NOT EXISTS (SELECT 1 FROM article_runs WHERE id = v_pause_run AND status = 'cancelled' AND safe_error_code = 'OWNER_CANCELLED')
     OR NOT EXISTS (SELECT 1 FROM automation_logs WHERE entity_id = v_pause_run AND event_code = 'RUN.CANCELLED' AND status = 'cancelled') THEN
    RAISE EXCEPTION 'Owner cancellation was not terminal and audit-logged';
  END IF;

  v_control := _automation_monitor_text('authenticated', v_owner,
    format('automation_control_run(%L::uuid, ''retry'')', v_retry_run))::jsonb;
  IF v_control->>'status' <> 'queued'
     OR NOT EXISTS (SELECT 1 FROM article_runs WHERE id = v_retry_run AND status = 'queued' AND safe_error_code IS NULL AND dispatch_attempts = 0)
     OR NOT EXISTS (SELECT 1 FROM article_run_steps WHERE run_id = v_retry_run AND step_key = 'preflight' AND status = 'queued' AND safe_error_code IS NULL) THEN
    RAISE EXCEPTION 'An allow-listed safe failure did not retry as a clean next-tick run';
  END IF;
  IF NOT _automation_monitor_raises('authenticated', v_owner,
       format('SELECT automation_control_run(%L::uuid, ''retry'')', v_preflight_run)) THEN
    RAISE EXCEPTION 'A content/preflight failure was incorrectly eligible for a blind retry';
  END IF;

  -- Feature-flag changes remain fully audited and reversible by the owner.
  PERFORM _automation_monitor_text('authenticated', v_owner,
    'automation_set_feature_flag(''automation.enabled'', true)')::boolean;
  PERFORM _automation_monitor_text('authenticated', v_owner,
    'automation_set_feature_flag(''automation.enabled'', false)')::boolean;
  IF NOT EXISTS (
    SELECT 1 FROM admin_activity_log
     WHERE entity_type = 'feature_flags' AND actor_id = '00000000-0000-0000-0000-000000000001'
       AND changes ? 'enabled'
  ) THEN RAISE EXCEPTION 'Feature-switch updates did not write the existing audit trail'; END IF;

  -- A terminal failure is claimed only once for email-first/Telegram fallback;
  -- recipients and chat identifiers never have a browser execution path.
  v_alerts := _automation_monitor_text('service_role', v_service,
    '(SELECT COALESCE(jsonb_agg(jsonb_build_object(''run_id'', run_id, ''safe_error_code'', safe_error_code, ''event'', event)), ''[]''::jsonb) FROM automation_claim_failure_alerts(25))')::jsonb;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_alerts) a WHERE a->>'run_id' = v_preflight_run::text AND a->>'safe_error_code' = 'PREFLIGHT_INVALID')
     OR EXISTS (SELECT 1 FROM automation_logs WHERE entity_id = v_preflight_run AND event_code = 'ALERT.CLAIM' AND length(COALESCE(details->>'alert_scope','')) = 0) THEN
    RAISE EXCEPTION 'Terminal failure was not claimed once with a bounded safe alert scope';
  END IF;
  v_alerts := _automation_monitor_text('service_role', v_service,
    '(SELECT COALESCE(jsonb_agg(run_id), ''[]''::jsonb) FROM automation_claim_failure_alerts(25))')::jsonb;
  IF v_alerts @> jsonb_build_array(v_preflight_run) THEN RAISE EXCEPTION 'Failure alert was claimed more than once'; END IF;
  v_recipients := _automation_monitor_text('service_role', v_service, 'automation_alert_recipients()')::jsonb;
  IF jsonb_typeof(v_recipients) <> 'array'
     OR NOT (v_recipients @> '[{"email":"owner@lixxonstudio.com"}]'::jsonb)
     OR v_recipients::text LIKE '%vault_secret_id%' THEN
    RAISE EXCEPTION 'Service alert recipient lookup was not safe or did not include the active owner';
  END IF;
  IF NOT _automation_monitor_raises('authenticated', v_owner, 'SELECT automation_claim_failure_alerts(10)')
     OR NOT _automation_monitor_raises('authenticated', v_owner, 'SELECT automation_alert_recipients()') THEN
    RAISE EXCEPTION 'A browser could claim failures or enumerate private alert recipients';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM automation_logs WHERE entity_id = v_pause_run AND event_code = 'RUN.PAUSED' AND status = 'paused')
     OR NOT EXISTS (SELECT 1 FROM automation_logs WHERE entity_id = v_pause_run AND event_code = 'RUN.RESUMED' AND status = 'retried')
     OR NOT EXISTS (SELECT 1 FROM automation_logs WHERE entity_id = v_retry_run AND event_code = 'RUN.RETRIED' AND status = 'retried') THEN
    RAISE EXCEPTION 'Pause, resume and retry operations were not fully event-logged';
  END IF;

  DELETE FROM admin_permission_overrides
   WHERE user_id = '00000000-0000-0000-0000-0000000000e5' AND permission = 'automation.manage';
  PERFORM _automation_monitor_text('authenticated', v_owner,
    'automation_set_feature_flag(''automation.daily_pipeline'', false)')::boolean;
  PERFORM _automation_monitor_text('authenticated', v_owner,
    'automation_set_feature_flag(''automation.enabled'', false)')::boolean;
END $$;

DROP FUNCTION _automation_monitor_text(text, jsonb, text);
DROP FUNCTION _automation_monitor_action(text, jsonb, text);
DROP FUNCTION _automation_monitor_raises(text, jsonb, text);

SELECT 'Phase 2.3 run monitor and controls assertions passed.' AS result;
