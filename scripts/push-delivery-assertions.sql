-- Phase 5 (Slice 2) assertions: Web Push delivery support.
-- Proves the owner-only test path, service-role-only delivery queries, that the
-- kill switch still gates automated delivery, that the explicit test does not
-- require that switch, owner scoping, safe audit codes and the health snapshot
-- reporting a real logged test delivery instead of a hard-coded value.
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION _push_del_text(role_name text, claims jsonb, expr text)
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

CREATE OR REPLACE FUNCTION _push_del_raises(role_name text, claims jsonb, statement text)
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

DO $$
DECLARE
  v_owner jsonb := '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000001","email":"owner@lixxonstudio.com"}'::jsonb;
  v_reader jsonb := '{"role":"authenticated","sub":"00000000-0000-0000-0000-0000000000d4"}'::jsonb;
  v_service jsonb := '{"role":"service_role"}'::jsonb;
  v_anon jsonb := '{"role":"anon"}'::jsonb;
  v_device text := 'push-delivery-device-a';
  v_other_owner uuid := '00000000-0000-0000-0000-0000000000ff'::uuid;
  v_endpoint text := 'https://push.example.test/v1/send/delivery-assert-device';
  v_p256dh text := repeat('A', 44);
  v_auth text := repeat('B', 22);
  v_id uuid;
  v_targets jsonb;
  v_health jsonb;
  v_push_row jsonb;
  v_fn record;
  v_names text[];
BEGIN
  -- ------------------------------------------------------------- 1. surface
  SELECT array_agg(p.proname::text ORDER BY p.proname::text) INTO v_names
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname IN ('push_owner_check', 'push_test_targets', 'push_record_test_delivery');
  IF v_names <> ARRAY['push_owner_check', 'push_record_test_delivery', 'push_test_targets'] THEN
    RAISE EXCEPTION 'Push delivery functions are missing: %', v_names;
  END IF;

  FOR v_fn IN
    SELECT p.proname, p.prosecdef, p.proconfig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname::text IN ('push_owner_check', 'push_test_targets', 'push_record_test_delivery')
  LOOP
    IF v_fn.prosecdef IS NOT TRUE
       OR position('search_path=public, pg_temp' IN COALESCE(array_to_string(v_fn.proconfig, ','), '')) = 0 THEN
      RAISE EXCEPTION '% must be SECURITY DEFINER with a pinned search_path', v_fn.proname;
    END IF;
  END LOOP;

  IF NOT has_function_privilege('authenticated', 'public.push_owner_check()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.push_owner_check()', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.push_owner_check()', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.push_test_targets(uuid,integer)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.push_record_test_delivery(uuid,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.push_test_targets(uuid,integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.push_record_test_delivery(uuid,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.push_test_targets(uuid,integer)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.push_record_test_delivery(uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Push delivery function grants are not least-privilege';
  END IF;

  -- Owner exclusivity of the caller check.
  IF _push_del_text('authenticated', v_owner, 'push_owner_check()') <> 'true'
     OR NOT _push_del_raises('authenticated', v_reader, 'push_owner_check()')
     OR NOT _push_del_raises('anon', v_anon, 'push_owner_check()')
     OR NOT _push_del_raises('service_role', v_service, 'push_owner_check()') THEN
    RAISE EXCEPTION 'The push owner check is not owner-exclusive';
  END IF;

  -- Nothing is claimed while the kill switch is off.
  PERFORM _push_del_text('authenticated', v_owner, 'automation_set_feature_flag(''automation.push'', false)');
  IF _push_del_text('service_role', v_service, 'push_delivery_targets(20)') <> '[]' THEN
    RAISE EXCEPTION 'Automated delivery ran with the kill switch off';
  END IF;
  IF _push_del_text('service_role', v_service, format('push_test_targets(%L::uuid, 5)', v_owner->>'sub')) <> '[]' THEN
    RAISE EXCEPTION 'The test target query returned devices before any was confirmed';
  END IF;

  -- -------------------------------------------------- 2. confirm one device
  PERFORM _push_del_text('authenticated', v_owner, format(
    'push_device_upsert(%L, ''Owner phone'', %L, %L, %L, true)', v_device, v_endpoint, v_p256dh, v_auth));
  SELECT id INTO v_id FROM public.push_device_subscriptions
   WHERE owner_user_id = (v_owner->>'sub')::uuid AND device_id = v_device;
  IF v_id IS NULL THEN RAISE EXCEPTION 'Could not confirm a test device'; END IF;

  -- The explicit owner test works while the kill switch is off: it is a single
  -- owner-initiated action, not automation.
  v_targets := _push_del_text('service_role', v_service, format('push_test_targets(%L::uuid, 5)', v_owner->>'sub'))::jsonb;
  IF jsonb_array_length(v_targets) <> 1
     OR (v_targets->0->>'endpoint') <> v_endpoint
     OR (v_targets->0->>'p256dh') <> v_p256dh
     OR (v_targets->0->>'auth_key') <> v_auth
     OR (v_targets->0->>'device_id') <> v_device THEN
    RAISE EXCEPTION 'The owner test target query did not return the confirmed device: %', v_targets;
  END IF;
  IF jsonb_array_length(_push_del_text('service_role', v_service, 'push_delivery_targets(20)')::jsonb) <> 0 THEN
    RAISE EXCEPTION 'Automated delivery ignored the kill switch';
  END IF;
  -- Owner scoping: another owner never sees this device.
  IF _push_del_text('service_role', v_service, format('push_test_targets(%L::uuid, 5)', v_other_owner)) <> '[]' THEN
    RAISE EXCEPTION 'The test target query crossed an owner boundary';
  END IF;
  -- Browser roles can never read endpoints or keys through this path.
  IF NOT _push_del_raises('authenticated', v_owner, format('push_test_targets(%L::uuid, 5)', v_owner->>'sub'))
     OR NOT _push_del_raises('anon', v_anon, format('push_test_targets(%L::uuid, 5)', v_owner->>'sub')) THEN
    RAISE EXCEPTION 'A browser role could read push delivery targets';
  END IF;

  -- Revoked devices are never test targets, and revocation keeps scrubbing.
  PERFORM _push_del_text('authenticated', v_owner, format('push_device_revoke(%L)', v_device));
  IF _push_del_text('service_role', v_service, format('push_test_targets(%L::uuid, 5)', v_owner->>'sub')) <> '[]' THEN
    RAISE EXCEPTION 'A revoked device is still a test target';
  END IF;

  -- ------------------------------------------- 3. audit + health evidence
  IF EXISTS (
    SELECT 1 FROM automation_logs
     WHERE event_code IN ('PUSH_TEST_DELIVERY_SENT', 'PUSH_TEST_DELIVERY_FAILED')
       AND entity_type = 'push_owner'
  ) THEN
    RAISE EXCEPTION 'Push test audit rows already exist before this suite ran';
  END IF;

  v_health := _push_del_text('authenticated', v_owner, 'automation_health_snapshot()')::jsonb;
  SELECT row_value INTO v_push_row FROM jsonb_array_elements(v_health->'checks') row_value
   WHERE row_value->>'key' = 'push';
  IF v_push_row IS NULL THEN RAISE EXCEPTION 'The health snapshot has no push row'; END IF;
  IF (v_push_row->'evidence'->>'delivery_verified') <> 'false'
     OR (v_push_row->'evidence'->'last_test_status') <> 'null'::jsonb
     OR (v_push_row->'evidence'->'last_test_at') <> 'null'::jsonb THEN
    RAISE EXCEPTION 'Push health evidence claims a delivery before any test: %', v_push_row->'evidence';
  END IF;
  IF (v_push_row->'evidence'->>'vapid_values_configured') IS NULL THEN
    RAISE EXCEPTION 'The push health row lost its VAPID count';
  END IF;

  -- Failure is recorded honestly and never claims verification.
  IF NOT _push_del_text('service_role', v_service, format(
       'push_record_test_delivery(%L::uuid, ''failed'')', v_owner->>'sub'))::boolean THEN
    RAISE EXCEPTION 'A failed test delivery was not recorded';
  END IF;
  IF NOT _push_del_raises('service_role', v_service, format(
       'push_record_test_delivery(%L::uuid, ''delivered'')', v_owner->>'sub')) THEN
    RAISE EXCEPTION 'An unknown test delivery status was accepted';
  END IF;
  IF NOT _push_del_raises('authenticated', v_owner, format(
       'push_record_test_delivery(%L::uuid, ''sent'')', v_owner->>'sub')) THEN
    RAISE EXCEPTION 'A browser role could write test delivery audit rows';
  END IF;

  v_health := _push_del_text('authenticated', v_owner, 'automation_health_snapshot()')::jsonb;
  SELECT row_value INTO v_push_row FROM jsonb_array_elements(v_health->'checks') row_value
   WHERE row_value->>'key' = 'push';
  IF (v_push_row->'evidence'->>'delivery_verified') <> 'false'
     OR (v_push_row->'evidence'->>'last_test_status') <> 'failed'
     OR (v_push_row->'evidence'->'last_test_at') = 'null'::jsonb THEN
    RAISE EXCEPTION 'Push health evidence did not report the failed test: %', v_push_row->'evidence';
  END IF;

  -- A later successful test flips the evidence to verified.
  IF NOT _push_del_text('service_role', v_service, format(
       'push_record_test_delivery(%L::uuid, ''sent'')', v_owner->>'sub'))::boolean THEN
    RAISE EXCEPTION 'A successful test delivery was not recorded';
  END IF;
  v_health := _push_del_text('authenticated', v_owner, 'automation_health_snapshot()')::jsonb;
  SELECT row_value INTO v_push_row FROM jsonb_array_elements(v_health->'checks') row_value
   WHERE row_value->>'key' = 'push';
  IF (v_push_row->'evidence'->>'delivery_verified') <> 'true'
     OR (v_push_row->'evidence'->>'last_test_status') <> 'sent'
     OR (v_push_row->'evidence'->'last_test_at') = 'null'::jsonb THEN
    RAISE EXCEPTION 'Push health evidence did not report the successful test: %', v_push_row->'evidence';
  END IF;
  -- With the feature deliberately off, the row must say so even after a successful test.
  IF (v_push_row->>'status') <> 'not_configured' THEN
    RAISE EXCEPTION 'Push health status ignored the disabled feature: %', v_push_row->>'status';
  END IF;

  -- Audit hygiene: fixed codes, empty details, no subscription material.
  IF EXISTS (
    SELECT 1 FROM automation_logs
     WHERE event_code IN ('PUSH_TEST_DELIVERY_SENT', 'PUSH_TEST_DELIVERY_FAILED')
       AND (details <> '{}'::jsonb
            OR entity_type <> 'push_owner'
            OR entity_id <> (v_owner->>'sub')::uuid
            OR status <> 'succeeded')
  ) THEN
    RAISE EXCEPTION 'Push test audit rows carry unsupported codes, statuses or details';
  END IF;
  IF (SELECT count(*) FROM automation_logs
       WHERE event_code = 'PUSH_TEST_DELIVERY_SENT' AND entity_id = (v_owner->>'sub')::uuid) <> 1
     OR (SELECT count(*) FROM automation_logs
          WHERE event_code = 'PUSH_TEST_DELIVERY_FAILED' AND entity_id = (v_owner->>'sub')::uuid) <> 1 THEN
    RAISE EXCEPTION 'Push test audit rows are not exactly-once';
  END IF;
  IF EXISTS (
    SELECT 1 FROM automation_logs
     WHERE event_code LIKE 'PUSH%'
       AND details::text ~* '(https?://|p256dh|auth_key|endpoint|token|secret)'
  ) THEN
    RAISE EXCEPTION 'Push audit rows leaked subscription material';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'push_device_subscriptions'
       AND column_name ~* '(article|customer|email|prose)'
  ) THEN
    RAISE EXCEPTION 'Push device schema carries unrelated personal data columns';
  END IF;

  -- -------------------------------- 4. automated delivery still gated on flag
  PERFORM _push_del_text('authenticated', v_owner, 'automation_set_feature_flag(''automation.push'', true)');
  PERFORM _push_del_text('authenticated', v_owner, format(
    'push_device_upsert(%L, ''Owner phone'', %L, %L, %L, true)', v_device, v_endpoint, v_p256dh, v_auth));
  IF jsonb_array_length(_push_del_text('service_role', v_service, 'push_delivery_targets(20)')::jsonb) <> 1 THEN
    RAISE EXCEPTION 'Automated delivery did not resume when the owner enabled push';
  END IF;
  -- Enabled + a verified test still stays a warning: one test is not day-to-day proof.
  v_health := _push_del_text('authenticated', v_owner, 'automation_health_snapshot()')::jsonb;
  SELECT row_value INTO v_push_row FROM jsonb_array_elements(v_health->'checks') row_value
   WHERE row_value->>'key' = 'push';
  IF (v_push_row->'evidence'->>'delivery_verified') <> 'true' THEN
    RAISE EXCEPTION 'Push health lost the verified test evidence: %', v_push_row;
  END IF;
  -- Precedence must stay truthful: no stored VAPID values means 'blocked';
  -- with keys present a verified test is still only a 'warning'.
  IF (v_push_row->'evidence'->>'vapid_values_configured')::int < 3 THEN
    IF (v_push_row->>'status') <> 'blocked' THEN
      RAISE EXCEPTION 'Push health hid the missing VAPID keys: %', v_push_row->>'status';
    END IF;
  ELSIF (v_push_row->>'status') <> 'warning' THEN
    RAISE EXCEPTION 'Push health overstated a verified test delivery: %', v_push_row->>'status';
  END IF;
  PERFORM _push_del_text('authenticated', v_owner, 'automation_set_feature_flag(''automation.push'', false)');
  IF _push_del_text('service_role', v_service, 'push_delivery_targets(20)') <> '[]' THEN
    RAISE EXCEPTION 'Automated delivery survived the kill switch being turned off';
  END IF;

  -- ------------------------------------------- 5. leave the owner clean
  PERFORM _push_del_text('authenticated', v_owner, 'push_device_revoke_all()');
  IF EXISTS (SELECT 1 FROM push_device_subscriptions
              WHERE owner_user_id = (v_owner->>'sub')::uuid
                AND (enabled OR revoked_at IS NULL OR endpoint IS NOT NULL OR p256dh IS NOT NULL OR auth_key IS NOT NULL)) THEN
    RAISE EXCEPTION 'The delivery suite left an active device behind';
  END IF;
  IF (SELECT enabled FROM feature_flags WHERE flag_key = 'automation.push') IS NOT FALSE THEN
    RAISE EXCEPTION 'The push kill switch was not restored to off';
  END IF;
END $$;
