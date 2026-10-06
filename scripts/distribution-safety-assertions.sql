-- Phase 3.2 assertions: per-channel caps, bounded transient backoff/circuits,
-- explicit A/B approval, owner alerts, aggregate-only metrics and RLS.
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION _dist_safety_text(role_name text, claims jsonb, expr text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE result text;
BEGIN
  EXECUTE format('SET LOCAL ROLE %I', role_name);
  PERFORM set_config('request.jwt.claims', claims::text, true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(claims->>'sub', ''), true);
  PERFORM set_config('request.jwt.claim.role', COALESCE(claims->>'role', role_name), true);
  EXECUTE 'SELECT (' || expr || ')::text' INTO result;
  RESET ROLE;
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION _dist_safety_raises(role_name text, claims jsonb, statement text)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE raised boolean := false;
BEGIN
  EXECUTE format('SET LOCAL ROLE %I', role_name);
  PERFORM set_config('request.jwt.claims', claims::text, true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(claims->>'sub', ''), true);
  PERFORM set_config('request.jwt.claim.role', COALESCE(claims->>'role', role_name), true);
  BEGIN EXECUTE statement; EXCEPTION WHEN others THEN raised := true; END;
  RESET ROLE;
  RETURN raised;
END $$;

CREATE OR REPLACE FUNCTION _dist_safety_count(role_name text, claims jsonb, statement text)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE result bigint;
BEGIN
  EXECUTE format('SET LOCAL ROLE %I', role_name);
  PERFORM set_config('request.jwt.claims', claims::text, true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(claims->>'sub', ''), true);
  PERFORM set_config('request.jwt.claim.role', COALESCE(claims->>'role', role_name), true);
  EXECUTE 'SELECT count(*) FROM (' || statement || ') q' INTO result;
  RESET ROLE;
  RETURN result;
END $$;

DO $$
DECLARE
  v_owner jsonb := '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000001","email":"owner@lixxonstudio.com"}'::jsonb;
  v_reader jsonb := '{"role":"authenticated","sub":"00000000-0000-0000-0000-0000000000d4"}'::jsonb;
  v_editor jsonb := '{"role":"authenticated","sub":"00000000-0000-0000-0000-0000000000e5"}'::jsonb;
  v_service jsonb := '{"role":"service_role"}'::jsonb;
  v_post uuid := '86000000-0000-0000-0000-000000000001';
  -- Keep this fixture off the +30 Lagos day reserved by distribution-assertions.sql.
  v_when timestamptz := (((now() AT TIME ZONE 'Africa/Lagos')::date + 31 + time '09:00') AT TIME ZONE 'Africa/Lagos');
  v_today date := (now() AT TIME ZONE 'UTC')::date;
  v_draft_id uuid;
  v_variant_id uuid;
  v_hash text;
  v_payload jsonb;
  v_result jsonb;
  v_claim jsonb;
  v_snapshot jsonb;
  v_variant jsonb;
  v_alerts jsonb;
  v_alert_id bigint;
  v_retry timestamptz;
  v_sentinel text := 'PHASE32_ARTICLE_BODY_IMMUTABILITY_SENTINEL_86000000';
  v_table text;
  v_fn record;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'automation_channel_usage_daily', 'distribution_metric_samples',
    'automation_distribution_failure_alerts'
  ] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = format('public.%I', v_table)::regclass AND relrowsecurity) THEN
      RAISE EXCEPTION '% is missing RLS', v_table;
    END IF;
    IF has_table_privilege('anon', format('public.%I', v_table), 'SELECT')
       OR has_table_privilege('authenticated', format('public.%I', v_table), 'INSERT')
       OR has_table_privilege('authenticated', format('public.%I', v_table), 'UPDATE')
       OR has_table_privilege('authenticated', format('public.%I', v_table), 'DELETE')
       OR has_table_privilege('service_role', format('public.%I', v_table), 'SELECT') THEN
      RAISE EXCEPTION '% has an unintended direct table grant', v_table;
    END IF;
    IF NOT has_table_privilege('authenticated', format('public.%I', v_table), 'SELECT') THEN
      RAISE EXCEPTION 'Owners cannot read safe % metadata', v_table;
    END IF;
    IF _dist_safety_count('authenticated', v_reader,
      format('SELECT * FROM public.%I', v_table)) <> 0 THEN
      RAISE EXCEPTION 'RLS allowed cross-user reads from %', v_table;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'distribution_metric_samples'
       AND column_name ~* '(email|customer|user|ip|device|address|cookie|session)'
  ) THEN RAISE EXCEPTION 'Aggregate metrics schema contains a customer-identifying column'; END IF;

  FOR v_fn IN
    SELECT p.oid::regprocedure AS signature, p.proname, p.prosecdef, p.proconfig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname IN (
       'automation_record_channel_readback', 'automation_set_distribution_pause',
       'automation_claim_distribution_delivery', 'automation_complete_distribution_delivery',
       'automation_claim_newsletter_test', 'automation_complete_newsletter_test',
       'automation_create_ab_variant', 'automation_record_distribution_metric',
       'automation_claim_distribution_failure_alerts', 'automation_complete_distribution_failure_alert',
       'automation_distribution_snapshot'
     )
  LOOP
    IF v_fn.prosecdef IS NOT TRUE
       OR position('search_path=public, pg_temp' IN COALESCE(array_to_string(v_fn.proconfig, ','), '')) = 0 THEN
      RAISE EXCEPTION '% must be SECURITY DEFINER with a pinned search_path', v_fn.proname;
    END IF;
  END LOOP;

  IF NOT has_function_privilege('service_role', 'public.automation_record_distribution_metric(uuid,text,date,date,text,numeric,text,boolean,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.automation_claim_distribution_failure_alerts(integer)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.automation_complete_distribution_failure_alert(bigint,text,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.automation_record_distribution_metric(uuid,text,date,date,text,numeric,text,boolean,uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.automation_claim_distribution_failure_alerts(integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.automation_claim_distribution_failure_alerts(integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Distribution safety RPC grants are too broad or unavailable';
  END IF;

  IF NOT _dist_safety_raises('authenticated', v_editor,
       'SELECT automation_create_ab_variant(''86000000-0000-0000-0000-000000000001''::uuid, ''telegram'', ''Z'', ''An editor cannot approve an experiment.'', ''click_through_rate'', ''negative_feedback_rate'', ''{}''::jsonb)')
     OR NOT _dist_safety_raises('authenticated', v_reader,
       'SELECT automation_record_distribution_metric(''86000000-0000-0000-0000-000000000001''::uuid, ''telegram'', current_date, current_date, ''clicks'', 1, ''provider_aggregate'', false, NULL)') THEN
    RAISE EXCEPTION 'A non-owner/service caller crossed an experiment or measurement boundary';
  END IF;

  -- Use isolated owner-written content and reset only seeded test state.
  UPDATE automation_distribution_channels SET
    state = 'manual_kit', state_reason = 'No verified provider readback is recorded; the manual kit is available.',
    is_paused = false, daily_free_quota = 10, quota_remaining = 10,
    last_readback_status = 'not_tested', last_readback_at = NULL,
    circuit_state = 'closed', failure_streak = 0, last_failure_class = NULL,
    retry_after = NULL, circuit_probe_claimed_at = NULL
   WHERE channel_key = 'telegram';
  DELETE FROM automation_channel_usage_daily WHERE channel_key = 'telegram' AND usage_day = (now() AT TIME ZONE 'Africa/Lagos')::date;
  -- The preceding legacy distribution assertion exhausts its newsletter test cap.
  -- Retire that test-only pending alert so this suite claims only its Telegram fixture.
  UPDATE automation_distribution_failure_alerts SET status = 'blocked', delivery_channel = 'none',
    retry_after = NULL, updated_at = now()
   WHERE channel_key = 'newsletter' AND usage_day = (now() AT TIME ZONE 'Africa/Lagos')::date
     AND status = 'pending';
  DELETE FROM automation_distribution_failure_alerts WHERE channel_key = 'telegram' AND usage_day = (now() AT TIME ZONE 'Africa/Lagos')::date;
  UPDATE feature_flags SET enabled = false WHERE flag_key IN ('automation.enabled', 'automation.distribution');

  PERFORM set_config('request.jwt.claims', v_owner::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_owner->>'sub', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  INSERT INTO posts (
    id, title, slug, status, content, excerpt, category_id, tags, cover_image,
    cover_image_alt, scheduled_at, published_at
  ) VALUES (
    v_post, 'Phase 3.2 safety article', 'phase-32-safety-article', 'scheduled', v_sentinel,
    'A separate owner-authored excerpt used for privacy and distribution safety tests.',
    '59d3acce-f83a-46db-84a3-c65f97d68a47', ARRAY['safety', 'measurement'],
    'https://lixxonstudio.com/images/safety-cover.jpg', 'Owner-selected safety cover', v_when, v_when
  ) ON CONFLICT (id) DO NOTHING;

  IF _dist_safety_raises('authenticated', v_owner,
       format('SELECT automation_prepare_daily_kit(%L::uuid)', v_post)) THEN
    RAISE EXCEPTION 'The owner Daily Kit fixture could not be prepared';
  END IF;
  SELECT id, payload_sha256, payload INTO v_draft_id, v_hash, v_payload
    FROM automation_distribution_drafts WHERE post_id = v_post AND channel_key = 'telegram';
  IF v_draft_id IS NULL OR v_payload::text LIKE '%' || v_sentinel || '%' THEN
    RAISE EXCEPTION 'The Phase 3.2 kit read or copied article prose';
  END IF;
  PERFORM _dist_safety_text('authenticated', v_owner,
    format('automation_approve_distribution_draft(%L::uuid, %L)', v_draft_id, v_hash));
  PERFORM _dist_safety_text('authenticated', v_owner, 'automation_set_feature_flag(''automation.enabled'', true)');
  PERFORM _dist_safety_text('authenticated', v_owner, 'automation_set_feature_flag(''automation.distribution'', true)');
  UPDATE automation_distribution_channels SET state = 'approval_required',
    last_readback_status = 'connected', last_readback_at = now(), updated_at = now()
   WHERE channel_key = 'telegram';

  v_claim := _dist_safety_text('service_role', v_service, format(
    'automation_claim_distribution_delivery(%L::uuid, %L::uuid, %L)', v_owner->>'sub', v_draft_id, v_hash))::jsonb;
  IF v_claim->>'ok' <> 'true' OR v_claim->>'already_sent' <> 'false'
     OR (SELECT delivery_attempts FROM automation_channel_usage_daily
          WHERE channel_key = 'telegram' AND usage_day = (now() AT TIME ZONE 'Africa/Lagos')::date) <> 1 THEN
    RAISE EXCEPTION 'The first approved delivery did not consume exactly one channel-cap unit';
  END IF;
  IF _dist_safety_text('service_role', v_service, format(
       'automation_complete_distribution_delivery(%s, ''failed'', NULL, ''PROVIDER_UNAVAILABLE'')', (v_claim->>'log_id')::bigint)) <> 'true' THEN
    RAISE EXCEPTION 'The transient provider failure was not safely recorded';
  END IF;
  SELECT retry_after INTO v_retry FROM automation_distribution_channels WHERE channel_key = 'telegram';
  IF v_retry IS NULL OR v_retry < now() + interval '20 seconds' OR v_retry > now() + interval '40 seconds'
     OR (SELECT circuit_state FROM automation_distribution_channels WHERE channel_key = 'telegram') <> 'closed'
     OR (SELECT last_failure_class FROM automation_distribution_channels WHERE channel_key = 'telegram') <> 'transient'
     OR (SELECT delivery_failures FROM automation_channel_usage_daily
          WHERE channel_key = 'telegram' AND usage_day = (now() AT TIME ZONE 'Africa/Lagos')::date) <> 1 THEN
    RAISE EXCEPTION 'Transient exponential backoff/jitter or usage counters are outside the safe first-attempt window';
  END IF;
  v_claim := _dist_safety_text('service_role', v_service, format(
    'automation_claim_distribution_delivery(%L::uuid, %L::uuid, %L)', v_owner->>'sub', v_draft_id, v_hash))::jsonb;
  IF v_claim->>'ok' <> 'false' OR v_claim->>'safe_error_code' <> 'CHANNEL_BACKOFF' THEN
    RAISE EXCEPTION 'A channel dispatch bypassed its active transient backoff';
  END IF;

  -- Force the local owner-set cap to its boundary; a rejected attempt cannot send.
  UPDATE automation_channel_usage_daily SET delivery_attempts = 10
   WHERE channel_key = 'telegram' AND usage_day = (now() AT TIME ZONE 'Africa/Lagos')::date;
  UPDATE automation_distribution_channels SET circuit_state = 'closed', failure_streak = 0,
    retry_after = NULL, daily_free_quota = 10, state = 'approval_required'
   WHERE channel_key = 'telegram';
  v_claim := _dist_safety_text('service_role', v_service, format(
    'automation_claim_distribution_delivery(%L::uuid, %L::uuid, %L)', v_owner->>'sub', v_draft_id, v_hash))::jsonb;
  IF v_claim->>'ok' <> 'false' OR v_claim->>'safe_error_code' <> 'PROVIDER_QUOTA'
     OR (SELECT circuit_state FROM automation_distribution_channels WHERE channel_key = 'telegram') <> 'open'
     OR (SELECT state FROM automation_distribution_channels WHERE channel_key = 'telegram') <> 'quota_exhausted' THEN
    RAISE EXCEPTION 'The per-channel usage cap did not open the circuit and block safely';
  END IF;

  v_alerts := _dist_safety_text('service_role', v_service,
    '(SELECT COALESCE(jsonb_agg(jsonb_build_object(''alert_id'', alert_id, ''channel_key'', channel_key, ''failure_class'', failure_class)), ''[]''::jsonb) FROM automation_claim_distribution_failure_alerts(5))')::jsonb;
  IF jsonb_array_length(v_alerts) <> 1 OR v_alerts->0->>'failure_class' <> 'quota'
     OR v_alerts->0->>'channel_key' <> 'telegram' THEN
    RAISE EXCEPTION 'A quota block did not enqueue one safe owner alert';
  END IF;
  v_alert_id := (v_alerts->0->>'alert_id')::bigint;
  v_result := jsonb_build_object(
    'completion_returned', _dist_safety_text('service_role', v_service,
      format('automation_complete_distribution_failure_alert(%s, ''blocked'', ''none'')', v_alert_id)) = 'true'
  );
  v_result := v_result || jsonb_build_object(
    'status', (SELECT status FROM automation_distribution_failure_alerts WHERE id = v_alert_id),
    'audit_trace_count', (SELECT count(*) FROM automation_logs WHERE event_code = 'DISTRIBUTION.ALERT'
      AND details->>'alert_id' = v_alert_id::text AND details->>'channel' = 'telegram')
  );
  IF v_result->>'completion_returned' <> 'true' OR v_result->>'status' <> 'blocked'
     OR (v_result->>'audit_trace_count')::integer <> 1 THEN
    RAISE EXCEPTION 'An unavailable alert path was not honestly recorded as blocked: %', v_result;
  END IF;

  IF _dist_safety_text('service_role', v_service, format(
       'automation_record_distribution_metric(%L::uuid, ''telegram'', %L::date, %L::date, ''clicks'', 17, ''provider_aggregate'', false, NULL)',
       v_post, v_today - 1, v_today - 1)) <> 'true'
     OR _dist_safety_text('service_role', v_service, format(
       'automation_record_distribution_metric(%L::uuid, ''telegram'', %L::date, %L::date, ''reach'', 100, ''estimate'', false, NULL)',
       v_post, v_today - 1, v_today - 1)) <> 'true' THEN
    RAISE EXCEPTION 'Safe aggregate measured/estimated metrics were rejected';
  END IF;
  IF NOT _dist_safety_raises('service_role', v_service, format(
       'SELECT automation_record_distribution_metric(%L::uuid, ''telegram'', %L::date, %L::date, ''clicks'', 1, ''consented_site_aggregate'', false, NULL)',
       v_post, v_today - 1, v_today - 1)) THEN
    RAISE EXCEPTION 'A first-party site aggregate was accepted without verified consent';
  END IF;

  -- A/B variants are created only as approved rows, with a hypothesis and two metrics.
  v_variant := _dist_safety_text('authenticated', v_owner, format(
    'automation_create_ab_variant(%L::uuid, ''telegram'', ''B'', ''Compare a question-led excerpt against the current owner-approved caption.'', ''click_through_rate'', ''negative_feedback_rate'', %L::jsonb)',
    v_post, v_payload::text))::jsonb;
  v_variant_id := (v_variant->>'id')::uuid;
  IF v_variant->>'status' <> 'approved' OR v_variant_id IS NULL
     OR (SELECT status FROM ab_test_variants WHERE id = v_variant_id) <> 'approved'
     OR (SELECT approved_by FROM ab_test_variants WHERE id = v_variant_id) <> (v_owner->>'sub')::uuid
     OR (SELECT approved_at FROM ab_test_variants WHERE id = v_variant_id) IS NULL THEN
    RAISE EXCEPTION 'An A/B variant exists without explicit owner approval';
  END IF;
  IF _dist_safety_raises('service_role', v_service, format(
       'SELECT automation_record_distribution_metric(%L::uuid, ''telegram'', %L::date, %L::date, ''click_through_rate'', 0.12, ''provider_aggregate'', false, %L::uuid)',
       v_post, v_today - 1, v_today - 1, v_variant_id)) THEN
    RAISE EXCEPTION 'A measured primary A/B metric was rejected';
  END IF;

  v_snapshot := _dist_safety_text('authenticated', v_owner,
    format('automation_distribution_snapshot(%L::uuid)', v_post))::jsonb;
  IF jsonb_array_length(v_snapshot->'metrics') <> 3
     OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_snapshot->'metrics') m WHERE m->>'measurement_kind' = 'measured' AND m->>'metric_key' = 'clicks')
     OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_snapshot->'metrics') m WHERE m->>'measurement_kind' = 'estimated' AND m->>'metric_key' = 'reach')
     OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_snapshot->'metrics') m WHERE m->>'variant_id' = v_variant_id::text AND m->>'metric_key' = 'click_through_rate')
     OR v_snapshot::text LIKE '%' || v_sentinel || '%' THEN
    RAISE EXCEPTION 'Metrics were not labeled/aggregated safely or the article body leaked into the snapshot';
  END IF;
  IF _dist_safety_count('authenticated', v_reader,
       format('SELECT id FROM distribution_metric_samples WHERE post_id = %L::uuid', v_post)) <> 0 THEN
    RAISE EXCEPTION 'A non-owner read private distribution measurements';
  END IF;

  IF (SELECT content FROM posts WHERE id = v_post) IS DISTINCT FROM v_sentinel
     OR (SELECT review_status FROM automation_distribution_drafts WHERE id = v_draft_id) <> 'approved'
     OR (SELECT count(*) FROM distribution_log WHERE post_id = v_post AND channel_key = 'telegram') <> 1
     OR EXISTS (SELECT 1 FROM automation_logs WHERE event_code LIKE 'DISTRIBUTION.%' AND details::text LIKE '%' || v_sentinel || '%') THEN
    RAISE EXCEPTION 'Article prose, kit approval or single-attempt delivery invariant failed';
  END IF;

  -- Auth failures immediately open an independent circuit and create a plain safe alert.
  v_result := jsonb_build_object('readback_returned', _dist_safety_text('service_role', v_service,
    'automation_record_channel_readback(''telegram'', ''blocked_by_provider_review'', ''PROVIDER_AUTH'', NULL)') = 'true');
  v_result := v_result || jsonb_build_object(
    'circuit_state', (SELECT circuit_state FROM automation_distribution_channels WHERE channel_key = 'telegram'),
    'failure_class', (SELECT last_failure_class FROM automation_distribution_channels WHERE channel_key = 'telegram'),
    'channel_state', (SELECT state FROM automation_distribution_channels WHERE channel_key = 'telegram'),
    'alert_count', (SELECT count(*) FROM automation_distribution_failure_alerts
      WHERE channel_key = 'telegram' AND failure_class = 'authentication'
        AND usage_day = (now() AT TIME ZONE 'Africa/Lagos')::date)
  );
  IF v_result->>'readback_returned' <> 'true' OR v_result->>'circuit_state' <> 'open'
     OR v_result->>'failure_class' <> 'authentication' OR v_result->>'channel_state' <> 'blocked_by_provider_review'
     OR (v_result->>'alert_count')::integer <> 1 THEN
    RAISE EXCEPTION 'An authentication failure did not stop the channel or enqueue one owner alert: %', v_result;
  END IF;

  PERFORM _dist_safety_text('authenticated', v_owner, 'automation_set_feature_flag(''automation.distribution'', false)');
  PERFORM _dist_safety_text('authenticated', v_owner, 'automation_set_feature_flag(''automation.enabled'', false)');
  IF (SELECT content FROM posts WHERE id = v_post) IS DISTINCT FROM v_sentinel
     OR (SELECT bool_or(enabled) FROM feature_flags WHERE flag_key IN ('automation.enabled', 'automation.distribution')) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Phase 3.2 test changed owner article prose or failed to restore switches';
  END IF;
END $$;

DROP FUNCTION IF EXISTS _dist_safety_text(text, jsonb, text);
DROP FUNCTION IF EXISTS _dist_safety_raises(text, jsonb, text);
DROP FUNCTION IF EXISTS _dist_safety_count(text, jsonb, text);
