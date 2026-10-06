-- =============================================================================
-- Phase 5 (Slice 2) — Web Push delivery support.
--
-- Adds the two server-side pieces the owner-authenticated push endpoint needs:
--   1. an explicit, owner-scoped query for an owner-initiated test notification,
--   2. an audit recorder for the outcome of that test.
--
-- The kill switch keeps its meaning: `push_delivery_targets()` (automated
-- delivery to all confirmed owner devices) still returns nothing while the
-- default-off `automation.push` flag is off. The test query below deliberately
-- ignores the flag because the test is a single, owner-initiated, explicitly
-- confirmed action — it never runs on a schedule and sends exactly one fixed
-- payload to that owner's own confirmed devices. Nothing here revokes a device
-- except through the existing `push_record_delivery()` expiry path.
--
-- The health snapshot is replaced so its push row reports a *real* logged test
-- delivery instead of a hard-coded false.
-- =============================================================================

-- Owner check for the Edge handler: unchanged semantics, owner-only, no data.
CREATE OR REPLACE FUNCTION public.push_owner_check()
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.automation_owner_authorized() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN true;
END $$;

-- Confirmed devices of ONE owner, for an owner-initiated test only.
CREATE OR REPLACE FUNCTION public.push_test_targets(p_owner_user_id uuid, p_limit integer DEFAULT 5)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 5), 1), 10);
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_owner_user_id IS NULL THEN RAISE EXCEPTION 'Owner is required'; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', d.id,
      'device_id', d.device_id,
      'label', d.label,
      'endpoint', d.endpoint,
      'p256dh', d.p256dh,
      'auth_key', d.auth_key
    ) ORDER BY d.last_seen_at DESC)
    FROM (
      SELECT s.* FROM public.push_device_subscriptions s
       WHERE s.owner_user_id = p_owner_user_id
         AND s.enabled AND s.revoked_at IS NULL
         AND s.endpoint IS NOT NULL AND s.p256dh IS NOT NULL AND s.auth_key IS NOT NULL
       ORDER BY s.last_seen_at DESC
       LIMIT v_limit
    ) d
  ), '[]'::jsonb);
END $$;

-- Audit the outcome of the explicit test. Fixed code, empty details, no counts
-- that could carry device data.
CREATE OR REPLACE FUNCTION public.push_record_test_delivery(p_owner_user_id uuid, p_status text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_code text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_owner_user_id IS NULL THEN RAISE EXCEPTION 'Owner is required'; END IF;
  IF p_status NOT IN ('sent', 'failed') THEN RAISE EXCEPTION 'Invalid test delivery status'; END IF;

  v_code := CASE WHEN p_status = 'sent' THEN 'PUSH_TEST_DELIVERY_SENT' ELSE 'PUSH_TEST_DELIVERY_FAILED' END;
  PERFORM public.push_audit_event(v_code, 'push_owner', p_owner_user_id, NULL);
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION public.push_owner_check() FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.push_test_targets(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.push_record_test_delivery(uuid, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.push_owner_check() TO authenticated;
GRANT EXECUTE ON FUNCTION public.push_test_targets(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.push_record_test_delivery(uuid, text) TO service_role;

-- -----------------------------------------------------------------------------
-- Health snapshot: replace the function so the push row reports a real, logged
-- test delivery (explicit owner test) instead of a hard-coded false. Only the
-- push evidence block and two local variables differ from the Phase 1.3 body.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.automation_health_snapshot()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_checked_at timestamptz := now();
  v_migration_version text;
  v_schema_ready boolean;
  v_vault_ready boolean;
  v_master_enabled boolean := false;
  v_daily_enabled boolean := false;
  v_distribution_enabled boolean := false;
  v_video_enabled boolean := false;
  v_push_enabled boolean := false;
  v_actions_configured boolean := false;
  v_actions_status text := 'not_tested';
  v_actions_tested_at timestamptz;
  v_actions_last_job_at timestamptz;
  v_daily_job_id bigint;
  v_daily_job_count integer := 0;
  v_daily_job_active boolean;
  v_daily_run_status text;
  v_daily_run_at timestamptz;
  v_daily_run_fresh boolean := false;
  v_ai_configured integer := 0;
  v_ai_recent_ok integer := 0;
  v_ai_invalid integer := 0;
  v_ai_quota_samples integer := 0;
  v_ai_quota_all_positive boolean := false;
  v_distribution_configured integer := 0;
  v_video_configured boolean := false;
  v_video_last_run_status text;
  v_video_last_run_at timestamptz;
  v_push_configured integer := 0;
  v_push_test_event text;
  v_push_test_at timestamptz;
  v_commerce_configured integer := 0;
  v_flutterwave_configured boolean := false;
  v_flutterwave_status text := 'not_tested';
  v_flutterwave_tested_at timestamptz;
  v_webhook_configured boolean := false;
  v_webhook_status text := 'not_tested';
  v_incident_count integer := 0;
  v_last_incident_at timestamptz;
  v_last_telemetry_at timestamptz;
BEGIN
  IF NOT public.admin_can('automation.check') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_schema_ready := to_regclass('public.automation_secret_catalog') IS NOT NULL
    AND to_regclass('public.automation_secrets') IS NOT NULL
    AND to_regclass('public.feature_flags') IS NOT NULL
    AND to_regclass('public.article_runs') IS NOT NULL
    AND to_regclass('public.article_pipeline_state') IS NOT NULL
    AND to_regclass('public.automation_logs') IS NOT NULL
    AND to_regclass('public.automation_run_tokens') IS NOT NULL;
  v_vault_ready := to_regclass('vault.secrets') IS NOT NULL
    AND to_regclass('vault.decrypted_secrets') IS NOT NULL;

  -- Migration tracking is optional in embedded tests and some hosted Supabase
  -- layouts. If available, return only the numeric version, never statements.
  BEGIN
    IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
      EXECUTE 'SELECT max(version)::text FROM supabase_migrations.schema_migrations'
        INTO v_migration_version;
      IF v_migration_version !~ '^[0-9]{14}$' THEN v_migration_version := NULL; END IF;
    END IF;
  EXCEPTION WHEN others THEN
    v_migration_version := NULL;
  END;

  SELECT
    COALESCE(bool_or(flag_key = 'automation.enabled' AND enabled), false),
    COALESCE(bool_or(flag_key = 'automation.daily_pipeline' AND enabled), false),
    COALESCE(bool_or(flag_key = 'automation.distribution' AND enabled), false),
    COALESCE(bool_or(flag_key = 'automation.video' AND enabled), false),
    COALESCE(bool_or(flag_key = 'automation.push' AND enabled), false)
  INTO v_master_enabled, v_daily_enabled, v_distribution_enabled, v_video_enabled, v_push_enabled
  FROM public.feature_flags;

  SELECT s.vault_secret_id IS NOT NULL, COALESCE(s.last_test_status, 'not_tested'), s.last_tested_at
    INTO v_actions_configured, v_actions_status, v_actions_tested_at
    FROM public.automation_secret_catalog c
    LEFT JOIN public.automation_secrets s USING (secret_name)
   WHERE c.secret_name = 'github_dispatch_token' AND c.enabled;
  SELECT max(created_at) INTO v_actions_last_job_at
    FROM public.automation_logs
   WHERE event_code LIKE 'ACTIONS.%' OR event_code LIKE 'GITHUB.%';

  -- Query pg_cron dynamically so the snapshot remains usable where the extension
  -- is unavailable. Only job presence, enabled state and last-run outcome escape.
  IF to_regclass('cron.job') IS NOT NULL THEN
    BEGIN
      EXECUTE 'SELECT count(*)::integer, bool_or(active) FROM cron.job WHERE jobname = $1'
        INTO v_daily_job_count, v_daily_job_active
        USING 'lixxon_automation_daily_pipeline';
      -- Duplicate job names are a blocked state; never bless just the first row.
      IF v_daily_job_count = 1 THEN
        EXECUTE 'SELECT jobid FROM cron.job WHERE jobname = $1 ORDER BY jobid LIMIT 1'
          INTO v_daily_job_id USING 'lixxon_automation_daily_pipeline';
        IF to_regclass('cron.job_run_details') IS NOT NULL THEN
          EXECUTE 'SELECT status, start_time FROM cron.job_run_details WHERE jobid = $1 ORDER BY start_time DESC LIMIT 1'
            INTO v_daily_run_status, v_daily_run_at USING v_daily_job_id;
        END IF;
      END IF;
    EXCEPTION WHEN others THEN
      v_daily_job_id := NULL;
      v_daily_job_count := 0;
      v_daily_job_active := NULL;
      v_daily_run_status := NULL;
      v_daily_run_at := NULL;
    END;
  END IF;
  v_daily_run_fresh := COALESCE(v_daily_run_at >= v_checked_at - interval '26 hours', false);

  SELECT
    count(*) FILTER (WHERE s.vault_secret_id IS NOT NULL),
    count(*) FILTER (
      WHERE s.last_test_status = 'ok'
        AND s.last_tested_at >= v_checked_at - interval '24 hours'
        AND s.last_tested_at <= v_checked_at + interval '5 minutes'
    ),
    count(*) FILTER (WHERE s.last_test_status = 'invalid')
  INTO v_ai_configured, v_ai_recent_ok, v_ai_invalid
  FROM public.automation_secret_catalog c
  LEFT JOIN public.automation_secrets s USING (secret_name)
  WHERE c.secret_name IN ('openai_api_key', 'gemini_api_key', 'anthropic_api_key')
    AND c.enabled;

  -- A measurement counts only when its redacted scalar is numeric and bounded.
  -- Any zero result is treated conservatively as exhausted; raw values never leave SQL.
  SELECT
    count(*) FILTER (WHERE details->>'quota_remaining' ~ '^[0-9]{1,12}([.][0-9]{1,6})?$'),
    COALESCE(bool_and(CASE
      WHEN details->>'quota_remaining' ~ '^[0-9]{1,12}([.][0-9]{1,6})?$'
        THEN (details->>'quota_remaining')::numeric > 0
      ELSE NULL
    END), false)
  INTO v_ai_quota_samples, v_ai_quota_all_positive
  FROM public.automation_logs
  WHERE event_code LIKE 'AI.%'
    AND created_at >= v_checked_at - interval '24 hours';

  SELECT count(*) FILTER (WHERE s.vault_secret_id IS NOT NULL)
    INTO v_distribution_configured
    FROM public.automation_secret_catalog c
    LEFT JOIN public.automation_secrets s USING (secret_name)
   WHERE c.secret_name IN (
     'meta_access_token', 'threads_access_token', 'tiktok_access_token',
     'pinterest_access_token', 'linkedin_access_token', 'telegram_bot_token',
     'whatsapp_access_token', 'youtube_refresh_token', 'x_access_token', 'tumblr_access_token'
   ) AND c.enabled;

  SELECT s.vault_secret_id IS NOT NULL INTO v_video_configured
    FROM public.automation_secret_catalog c
    LEFT JOIN public.automation_secrets s USING (secret_name)
   WHERE c.secret_name = 'coverr_api_key' AND c.enabled;
  SELECT status, created_at INTO v_video_last_run_status, v_video_last_run_at
    FROM public.automation_logs
   WHERE event_code LIKE 'VIDEO.%'
   ORDER BY created_at DESC LIMIT 1;

  SELECT count(*) FILTER (WHERE s.vault_secret_id IS NOT NULL)
    INTO v_push_configured
    FROM public.automation_secret_catalog c
    LEFT JOIN public.automation_secrets s USING (secret_name)
   WHERE c.secret_name IN ('vapid_public_key', 'vapid_private_key', 'vapid_subject')
     AND c.enabled;

  SELECT l.event_code, l.created_at INTO v_push_test_event, v_push_test_at
    FROM public.automation_logs l
   WHERE l.event_code IN ('PUSH_TEST_DELIVERY_SENT', 'PUSH_TEST_DELIVERY_FAILED')
   ORDER BY l.created_at DESC LIMIT 1;

  SELECT count(*) FILTER (WHERE s.vault_secret_id IS NOT NULL)
    INTO v_commerce_configured
    FROM public.automation_secret_catalog c
    LEFT JOIN public.automation_secrets s USING (secret_name)
   WHERE c.secret_name IN ('flutterwave_secret_key', 'flutterwave_webhook_hash')
     AND c.enabled;
  SELECT s.vault_secret_id IS NOT NULL, COALESCE(s.last_test_status, 'not_tested'), s.last_tested_at
    INTO v_flutterwave_configured, v_flutterwave_status, v_flutterwave_tested_at
    FROM public.automation_secret_catalog c
    LEFT JOIN public.automation_secrets s USING (secret_name)
   WHERE c.secret_name = 'flutterwave_secret_key' AND c.enabled;
  SELECT s.vault_secret_id IS NOT NULL, COALESCE(s.last_test_status, 'not_tested')
    INTO v_webhook_configured, v_webhook_status
    FROM public.automation_secret_catalog c
    LEFT JOIN public.automation_secrets s USING (secret_name)
   WHERE c.secret_name = 'flutterwave_webhook_hash' AND c.enabled;

  SELECT count(*) FILTER (
           WHERE created_at >= v_checked_at - interval '24 hours'
             AND status IN ('failed', 'blocked')
         ),
         max(created_at) FILTER (
           WHERE created_at >= v_checked_at - interval '24 hours'
             AND status IN ('failed', 'blocked')
         ),
         max(created_at)
    INTO v_incident_count, v_last_incident_at, v_last_telemetry_at
    FROM public.automation_logs;

  RETURN jsonb_build_object(
    'checked_at', v_checked_at,
    'checks', jsonb_build_array(
      jsonb_build_object(
        'key', 'database',
        'status', CASE WHEN v_schema_ready THEN 'healthy' ELSE 'blocked' END,
        'evidence', jsonb_build_object(
          'automation_schema_present', v_schema_ready,
          'latest_migration_version', v_migration_version
        ),
        'observed_at', v_checked_at
      ),
      jsonb_build_object(
        'key', 'vault',
        'status', CASE WHEN v_vault_ready THEN 'healthy' ELSE 'blocked' END,
        'evidence', jsonb_build_object(
          'vault_available', v_vault_ready,
          'configured_credentials', (SELECT count(*) FROM public.automation_secrets)
        ),
        'observed_at', v_checked_at
      ),
      jsonb_build_object(
        'key', 'github_actions',
        'status', CASE
          WHEN NOT v_actions_configured THEN 'not_configured'
          WHEN v_actions_status = 'invalid' THEN 'blocked'
          ELSE 'warning'
        END,
        'evidence', jsonb_build_object(
          'credential_configured', v_actions_configured,
          'credential_test_status', v_actions_status,
          'credential_tested_at', v_actions_tested_at,
          'last_job_at', v_actions_last_job_at,
          'dispatch_permission_verified', false
        ),
        'observed_at', v_checked_at
      ),
      jsonb_build_object(
        'key', 'daily_schedule',
        'status', CASE
          WHEN NOT v_daily_enabled THEN 'not_configured'
          WHEN v_daily_job_count = 0 THEN 'blocked'
          WHEN v_daily_job_count <> 1 OR v_daily_job_active IS NOT TRUE THEN 'blocked'
          WHEN v_daily_run_status IS DISTINCT FROM 'succeeded' THEN 'warning'
          WHEN NOT v_daily_run_fresh THEN 'warning'
          ELSE 'healthy'
        END,
        'evidence', jsonb_build_object(
          'feature_enabled', v_daily_enabled,
          'job_registered', v_daily_job_count > 0,
          'registered_job_count', v_daily_job_count,
          'job_active', v_daily_job_active,
          'last_run_status', CASE WHEN v_daily_run_status IN ('succeeded', 'failed', 'running') THEN v_daily_run_status ELSE NULL END,
          'last_run_at', v_daily_run_at,
          'last_run_fresh', v_daily_run_fresh,
          'freshness_window_hours', 26
        ),
        'observed_at', v_checked_at
      ),
      jsonb_build_object(
        'key', 'ai_providers',
        'status', CASE
          WHEN v_ai_configured = 0 THEN 'not_configured'
          WHEN v_ai_invalid = v_ai_configured THEN 'blocked'
          WHEN v_ai_recent_ok <> v_ai_configured THEN 'warning'
          WHEN v_ai_quota_samples = 0 THEN 'warning'
          WHEN NOT v_ai_quota_all_positive THEN 'blocked'
          ELSE 'healthy'
        END,
        'evidence', jsonb_build_object(
          'configured_providers', v_ai_configured,
          'recent_successful_tests', v_ai_recent_ok,
          'invalid_tests', v_ai_invalid,
          'freshness_window_hours', 24
        ),
        'observed_at', v_checked_at
      ),
      jsonb_build_object(
        'key', 'ai_quota',
        'status', CASE
          WHEN v_ai_configured = 0 THEN 'not_configured'
          WHEN v_ai_quota_samples = 0 THEN 'warning'
          WHEN NOT v_ai_quota_all_positive THEN 'blocked'
          ELSE 'healthy'
        END,
        'evidence', jsonb_build_object(
          'quota_samples_last_24h', v_ai_quota_samples,
          'quota_measured', v_ai_quota_samples > 0,
          'all_recent_samples_positive', v_ai_quota_all_positive,
          'measurement_window_hours', 24
        ),
        'observed_at', v_checked_at
      ),
      jsonb_build_object(
        'key', 'distribution',
        'status', CASE WHEN NOT v_distribution_enabled THEN 'not_configured' ELSE 'blocked' END,
        'evidence', jsonb_build_object(
          'feature_enabled', v_distribution_enabled,
          'configured_provider_tokens', v_distribution_configured,
          'provider_readback_verified', false
        ),
        'observed_at', v_checked_at
      ),
      jsonb_build_object(
        'key', 'video',
        'status', CASE
          WHEN NOT v_video_enabled THEN 'not_configured'
          WHEN v_video_last_run_status = 'succeeded' THEN 'warning'
          ELSE 'blocked'
        END,
        'evidence', jsonb_build_object(
          'feature_enabled', v_video_enabled,
          'stock_api_key_configured', v_video_configured,
          'last_render_status', CASE WHEN v_video_last_run_status IN ('succeeded', 'failed', 'running') THEN v_video_last_run_status ELSE NULL END,
          'last_render_at', v_video_last_run_at,
          'toolchain_verified', false
        ),
        'observed_at', v_checked_at
      ),
      jsonb_build_object(
        'key', 'push',
        'status', CASE
          WHEN NOT v_push_enabled THEN 'not_configured'
          WHEN v_push_configured < 3 THEN 'blocked'
          ELSE 'warning'
        END,
        'evidence', jsonb_build_object(
          'feature_enabled', v_push_enabled,
          'vapid_values_configured', v_push_configured,
          'delivery_verified', v_push_test_event = 'PUSH_TEST_DELIVERY_SENT',
          'last_test_status', CASE
            WHEN v_push_test_event IS NULL THEN NULL
            WHEN v_push_test_event = 'PUSH_TEST_DELIVERY_SENT' THEN 'sent'
            ELSE 'failed'
          END,
          'last_test_at', v_push_test_at
        ),
        'observed_at', v_checked_at
      ),
      jsonb_build_object(
        'key', 'commerce',
        'status', CASE
          WHEN v_commerce_configured = 0 THEN 'not_configured'
          WHEN v_flutterwave_status = 'invalid' THEN 'blocked'
          ELSE 'warning'
        END,
        'evidence', jsonb_build_object(
          'vault_credentials_configured', v_commerce_configured,
          'flutterwave_secret_configured', v_flutterwave_configured,
          'flutterwave_test_status', v_flutterwave_status,
          'flutterwave_tested_at', v_flutterwave_tested_at,
          'webhook_hash_configured', v_webhook_configured,
          'webhook_test_status', v_webhook_status,
          'webhook_signature_verified', false,
          'legacy_checkout_infrastructure_verified', false
        ),
        'observed_at', v_checked_at
      ),
      jsonb_build_object(
        'key', 'incidents',
        'status', CASE
          WHEN v_incident_count > 0 THEN 'warning'
          WHEN COALESCE(v_last_telemetry_at >= v_checked_at - interval '24 hours', false) THEN 'healthy'
          ELSE 'not_configured'
        END,
        'evidence', jsonb_build_object(
          'failed_or_blocked_last_24h', v_incident_count,
          'last_incident_at', v_last_incident_at,
          'telemetry_seen', COALESCE(v_last_telemetry_at >= v_checked_at - interval '24 hours', false),
          'last_telemetry_at', v_last_telemetry_at
        ),
        'observed_at', v_checked_at
      ),
      jsonb_build_object(
        'key', 'automation_safety',
        'status', CASE WHEN v_master_enabled THEN 'warning' ELSE 'healthy' END,
        'evidence', jsonb_build_object(
          'master_enabled', v_master_enabled,
          'daily_pipeline_enabled', v_daily_enabled,
          'distribution_enabled', v_distribution_enabled,
          'video_enabled', v_video_enabled,
          'push_enabled', v_push_enabled
        ),
        'observed_at', v_checked_at
      )
    )
  );
END;
$$;
