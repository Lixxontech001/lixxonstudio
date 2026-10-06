-- Phase 5 (Slice 1) assertions: Web Push device subscription data layer.
-- Proves owner-bound rows, least-privilege column grants, default-off opt-in,
-- idempotent registration, scrubbing revocation, kill-switch-gated delivery
-- targets, safe audit codes, cross-user isolation and untouched article prose.
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION _push_text(role_name text, claims jsonb, expr text)
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

CREATE OR REPLACE FUNCTION _push_raises(role_name text, claims jsonb, statement text)
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

CREATE OR REPLACE FUNCTION _push_count(role_name text, claims jsonb, statement text)
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
  v_anon jsonb := '{"role":"anon"}'::jsonb;
  v_device_a text := 'push-assert-device-a';
  v_device_b text := 'push-assert-device-b';
  v_device_c text := 'push-assert-device-c';
  v_device_d text := 'push-assert-device-d';
  v_endpoint text := 'https://push.example.test/v1/send/assert-device-token';
  v_endpoint2 text := 'https://push.example.test/v1/send/assert-device-token-2';
  v_p256dh text := repeat('A', 44);
  v_auth text := repeat('B', 22);
  v_codes text[] := ARRAY[
    'PUSH_DEVICE_REGISTERED', 'PUSH_DEVICE_ENABLED', 'PUSH_DEVICE_UPDATED',
    'PUSH_DEVICE_REVOKED', 'PUSH_ALL_DEVICES_REVOKED',
    'PUSH_DELIVERY_SENT', 'PUSH_DELIVERY_FAILED', 'PUSH_SUBSCRIPTION_EXPIRED'
  ];
  v_result jsonb;
  v_targets jsonb;
  v_id uuid;
  v_id_b uuid;
  v_first timestamptz;
  v_created timestamptz;
  v_count integer;
  v_hash_before text;
  v_hash_after text;
  v_fn record;
BEGIN
  -- ---------------------------------------------------------------- 1. surface
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.push_device_subscriptions'::regclass) THEN
    RAISE EXCEPTION 'push_device_subscriptions is missing RLS';
  END IF;
  IF has_table_privilege('anon', 'public.push_device_subscriptions', 'SELECT')
     OR has_table_privilege('authenticated', 'public.push_device_subscriptions', 'INSERT')
     OR has_table_privilege('authenticated', 'public.push_device_subscriptions', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.push_device_subscriptions', 'DELETE')
     OR has_table_privilege('service_role', 'public.push_device_subscriptions', 'SELECT') THEN
    RAISE EXCEPTION 'push_device_subscriptions has an unintended direct table grant';
  END IF;
  IF NOT has_any_column_privilege('authenticated', 'public.push_device_subscriptions', 'SELECT') THEN
    RAISE EXCEPTION 'The owner cannot read safe push device metadata';
  END IF;
  IF has_column_privilege('authenticated', 'public.push_device_subscriptions', 'endpoint', 'SELECT')
     OR has_column_privilege('authenticated', 'public.push_device_subscriptions', 'p256dh', 'SELECT')
     OR has_column_privilege('authenticated', 'public.push_device_subscriptions', 'auth_key', 'SELECT') THEN
    RAISE EXCEPTION 'A browser role can read push key material';
  END IF;
  IF COALESCE((SELECT column_default FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'push_device_subscriptions'
                  AND column_name = 'enabled'), '') NOT LIKE '%false%' THEN
    RAISE EXCEPTION 'Push opt-in does not default to off';
  END IF;

  IF NOT has_function_privilege('authenticated', 'public.push_device_upsert(text,text,text,text,text,boolean)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.push_device_revoke(text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.push_device_revoke_all()', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.push_delivery_targets(integer)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.push_record_delivery(uuid,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.push_device_upsert(text,text,text,text,text,boolean)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.push_delivery_targets(integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.push_delivery_targets(integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.push_record_delivery(uuid,text)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.push_device_upsert(text,text,text,text,text,boolean)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.push_audit_event(text,text,uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Push function grants are not least-privilege';
  END IF;

  FOR v_fn IN
    SELECT p.oid::regprocedure::text AS signature, p.proname, p.prosecdef, p.proconfig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN (
         'push_audit_event', 'push_device_upsert', 'push_device_revoke',
         'push_device_revoke_all', 'push_delivery_targets', 'push_record_delivery'
       )
  LOOP
    IF v_fn.prosecdef IS NOT TRUE
       OR position('search_path=public, pg_temp' IN COALESCE(array_to_string(v_fn.proconfig, ','), '')) = 0 THEN
      RAISE EXCEPTION '% must be SECURITY DEFINER with a pinned search_path', v_fn.proname;
    END IF;
  END LOOP;
  IF (SELECT array_agg(p.proname::text ORDER BY p.proname::text) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname LIKE 'push\_%')
     <> ARRAY['push_audit_event', 'push_delivery_targets', 'push_device_revoke', 'push_device_revoke_all',
              'push_device_upsert', 'push_owner_check', 'push_record_delivery', 'push_record_test_delivery',
              'push_test_targets'] THEN
    RAISE EXCEPTION 'Unexpected push function surface';
  END IF;

  SELECT md5(string_agg(id::text || ':' || COALESCE(content, ''), '|' ORDER BY id)) INTO v_hash_before FROM posts;

  -- ------------------------------------------------- 2. kill switch starts off
  PERFORM _push_text('authenticated', v_owner, 'automation_set_feature_flag(''automation.push'', false)');
  IF (SELECT enabled FROM feature_flags WHERE flag_key = 'automation.push') IS NOT FALSE THEN
    RAISE EXCEPTION 'The automation.push kill switch is not off';
  END IF;

  -- ------------------------------------- 3. registration is idempotent and off
  v_result := _push_text('authenticated', v_owner, format(
    'push_device_upsert(%L, ''Test phone'', NULL, NULL, NULL, NULL)', v_device_a))::jsonb;
  IF (v_result->>'enabled') <> 'false' OR (v_result->>'revoked') <> 'false'
     OR v_result ? 'endpoint' OR v_result ? 'p256dh' OR v_result ? 'auth_key' THEN
    RAISE EXCEPTION 'Registration did not return a safe, disabled device: %', v_result;
  END IF;
  IF position('push.example.test' IN v_result::text) > 0 THEN
    RAISE EXCEPTION 'Registration leaked endpoint material';
  END IF;
  SELECT id, created_at, last_seen_at INTO v_id, v_created, v_first
    FROM push_device_subscriptions WHERE owner_user_id = (v_owner->>'sub')::uuid AND device_id = v_device_a;
  IF v_id IS NULL OR EXISTS (SELECT 1 FROM push_device_subscriptions
       WHERE id = v_id AND (endpoint IS NOT NULL OR p256dh IS NOT NULL OR auth_key IS NOT NULL)) THEN
    RAISE EXCEPTION 'A registered device started with key material or is missing';
  END IF;

  v_result := _push_text('authenticated', v_owner, format(
    'push_device_upsert(%L, ''Pixel 9'', NULL, NULL, NULL, NULL)', v_device_a))::jsonb;
  IF (v_result->>'id')::uuid <> v_id THEN
    RAISE EXCEPTION 'Re-registering a device created a second row';
  END IF;
  IF (SELECT count(*) FROM push_device_subscriptions WHERE owner_user_id = (v_owner->>'sub')::uuid) <> 1 THEN
    RAISE EXCEPTION 'Device registration is not idempotent';
  END IF;
  IF (SELECT label FROM push_device_subscriptions WHERE id = v_id) <> 'Pixel 9'
     OR (SELECT created_at FROM push_device_subscriptions WHERE id = v_id) <> v_created
     OR (SELECT last_seen_at FROM push_device_subscriptions WHERE id = v_id) < v_first THEN
    RAISE EXCEPTION 'Re-registration did not refresh metadata in place';
  END IF;
  IF (SELECT count(*) FROM automation_logs WHERE event_code = 'PUSH_DEVICE_REGISTERED' AND entity_id = v_id) <> 1 THEN
    RAISE EXCEPTION 'Registration audit rows are duplicated';
  END IF;

  -- --------------------------------- 4. enabling without keys is blocked
  IF NOT _push_raises('authenticated', v_owner, format(
       'push_device_upsert(%L, ''Pixel 9'', NULL, NULL, NULL, true)', v_device_a)) THEN
    RAISE EXCEPTION 'A device could be enabled without complete key material';
  END IF;
  IF (SELECT enabled OR revoked_at IS NOT NULL FROM push_device_subscriptions WHERE id = v_id) THEN
    RAISE EXCEPTION 'A blocked enable attempt changed device state';
  END IF;
  -- The refusal is atomic: no partial enable and no misleading success audit row.
  IF EXISTS (SELECT 1 FROM automation_logs WHERE event_code = 'PUSH_DEVICE_ENABLED' AND entity_id = v_id) THEN
    RAISE EXCEPTION 'A refused enable attempt left an audit row claiming success';
  END IF;

  -- --------------------------------------------- 5. explicit opt-in with keys
  v_result := _push_text('authenticated', v_owner, format(
    'push_device_upsert(%L, ''Pixel 9'', %L, %L, %L, true)', v_device_a, v_endpoint, v_p256dh, v_auth))::jsonb;
  IF (v_result->>'enabled') <> 'true'
     OR v_result ? 'endpoint' OR v_result ? 'p256dh' OR v_result ? 'auth_key' THEN
    RAISE EXCEPTION 'Enabling a device returned unsafe or incorrect data: %', v_result;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM push_device_subscriptions
                  WHERE id = v_id AND enabled AND endpoint = v_endpoint
                    AND p256dh = v_p256dh AND auth_key = v_auth AND revoked_at IS NULL) THEN
    RAISE EXCEPTION 'Confirmed device did not store its subscription';
  END IF;
  IF (SELECT count(*) FROM automation_logs WHERE event_code = 'PUSH_DEVICE_ENABLED' AND entity_id = v_id) <> 1 THEN
    RAISE EXCEPTION 'Opt-in was not audited exactly once';
  END IF;

  PERFORM _push_text('authenticated', v_owner, format(
    'push_device_upsert(%L, ''Pixel 9'', %L, %L, %L, true)', v_device_a, v_endpoint2, v_p256dh, v_auth));
  IF (SELECT endpoint FROM push_device_subscriptions WHERE id = v_id) <> v_endpoint2 THEN
    RAISE EXCEPTION 'Re-subscribing a device did not refresh its endpoint';
  END IF;
  IF (SELECT count(*) FROM automation_logs WHERE event_code = 'PUSH_DEVICE_ENABLED' AND entity_id = v_id) <> 1
     OR (SELECT count(*) FROM automation_logs WHERE event_code = 'PUSH_DEVICE_UPDATED' AND entity_id = v_id) < 1 THEN
    RAISE EXCEPTION 'Re-subscribing produced the wrong audit trail';
  END IF;
  v_endpoint := v_endpoint2;

  -- ------------------------------------------------------- 6. read boundaries
  IF _push_count('authenticated', v_owner,
      'SELECT id, device_id, label, enabled FROM public.push_device_subscriptions') <> 1 THEN
    RAISE EXCEPTION 'The owner cannot read their own device metadata';
  END IF;
  IF NOT _push_raises('authenticated', v_owner,
      'SELECT endpoint FROM public.push_device_subscriptions') THEN
    RAISE EXCEPTION 'A browser role could read a push endpoint';
  END IF;
  IF _push_count('authenticated', v_reader,
      'SELECT id, device_id, enabled FROM public.push_device_subscriptions') <> 0 THEN
    RAISE EXCEPTION 'RLS allowed a cross-user read of push devices';
  END IF;
  IF NOT _push_raises('authenticated', v_reader,
      'SELECT endpoint FROM public.push_device_subscriptions') THEN
    RAISE EXCEPTION 'A non-owner browser role could read a push endpoint';
  END IF;
  IF NOT _push_raises('authenticated', v_reader,
      format('push_device_upsert(%L, ''Not mine'', NULL, NULL, NULL, NULL)', v_device_b))
     OR NOT _push_raises('authenticated', v_reader, format('push_device_revoke(%L)', v_device_a))
     OR NOT _push_raises('authenticated', v_reader, 'push_device_revoke_all()')
     OR NOT _push_raises('anon', v_anon, 'push_device_revoke_all()') THEN
    RAISE EXCEPTION 'A non-owner caller crossed the push subscription boundary';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM push_device_subscriptions WHERE id = v_id AND enabled AND revoked_at IS NULL) THEN
    RAISE EXCEPTION 'A rejected caller changed the owner subscription';
  END IF;

  -- ------------------------------- 7. kill switch gates delivery targets
  IF _push_text('service_role', '{"role":"service_role"}'::jsonb, 'push_delivery_targets(20)') <> '[]' THEN
    RAISE EXCEPTION 'Push delivery targets were returned with the kill switch off';
  END IF;
  PERFORM _push_text('authenticated', v_owner, 'automation_set_feature_flag(''automation.push'', true)');
  v_targets := _push_text('service_role', '{"role":"service_role"}'::jsonb, 'push_delivery_targets(20)')::jsonb;
  IF jsonb_array_length(v_targets) <> 1
     OR (v_targets->0->>'endpoint') <> v_endpoint
     OR (v_targets->0->>'p256dh') <> v_p256dh
     OR (v_targets->0->>'auth_key') <> v_auth
     OR (v_targets->0->>'owner_user_id') <> (v_owner->>'sub') THEN
    RAISE EXCEPTION 'The service role did not receive the confirmed owner target: %', v_targets;
  END IF;
  IF NOT _push_raises('authenticated', v_owner, 'push_delivery_targets(20)')
     OR NOT _push_raises('anon', v_anon, 'push_delivery_targets(20)') THEN
    RAISE EXCEPTION 'A browser role could read push delivery targets';
  END IF;

  -- ---------------------------------------- 8. delivery outcome bookkeeping
  IF NOT _push_text('service_role', '{"role":"service_role"}'::jsonb,
       format('push_record_delivery(%L::uuid, ''sent'')', v_id))::boolean THEN
    RAISE EXCEPTION 'A sent delivery was not recorded';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM push_device_subscriptions
                  WHERE id = v_id AND last_delivery_status = 'sent' AND failure_count = 0) THEN
    RAISE EXCEPTION 'A sent delivery did not clear failures';
  END IF;
  PERFORM _push_text('service_role', '{"role":"service_role"}'::jsonb,
    format('push_record_delivery(%L::uuid, ''failed'')', v_id));
  IF NOT EXISTS (SELECT 1 FROM push_device_subscriptions
                  WHERE id = v_id AND last_delivery_status = 'failed' AND failure_count = 1) THEN
    RAISE EXCEPTION 'A failed delivery was not counted';
  END IF;
  IF NOT _push_raises('service_role', '{"role":"service_role"}'::jsonb,
       format('push_record_delivery(%L::uuid, ''delivered'')', v_id)) THEN
    RAISE EXCEPTION 'An unknown delivery status was accepted';
  END IF;
  IF NOT _push_text('service_role', '{"role":"service_role"}'::jsonb,
       format('push_record_delivery(%L::uuid, ''expired'')', v_id))::boolean THEN
    RAISE EXCEPTION 'An expired subscription was not recorded';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM push_device_subscriptions
                  WHERE id = v_id AND NOT enabled AND revoked_at IS NOT NULL
                    AND endpoint IS NULL AND p256dh IS NULL AND auth_key IS NULL) THEN
    RAISE EXCEPTION 'An expired subscription was not revoked and scrubbed';
  END IF;
  IF (SELECT count(*) FROM automation_logs WHERE event_code IN ('PUSH_DELIVERY_SENT', 'PUSH_DELIVERY_FAILED')) <> 2
     OR (SELECT count(*) FROM automation_logs WHERE event_code = 'PUSH_SUBSCRIPTION_EXPIRED' AND entity_id = v_id) <> 1 THEN
    RAISE EXCEPTION 'Delivery outcomes were not audited once each';
  END IF;
  IF _push_text('service_role', '{"role":"service_role"}'::jsonb, 'push_delivery_targets(20)') <> '[]' THEN
    RAISE EXCEPTION 'A revoked device is still a delivery target';
  END IF;
  IF _push_text('service_role', '{"role":"service_role"}'::jsonb,
       format('push_record_delivery(%L::uuid, ''sent'')', v_id))::boolean THEN
    RAISE EXCEPTION 'A revoked device still accepted delivery outcomes';
  END IF;

  -- ---------------------------------------------- 9. owner revocation scrubs
  PERFORM _push_text('authenticated', v_owner, format(
    'push_device_upsert(%L, ''Tablet'', %L, %L, %L, true)', v_device_b, v_endpoint, v_p256dh, v_auth));
  SELECT id INTO v_id_b FROM push_device_subscriptions WHERE device_id = v_device_b;
  IF NOT _push_text('authenticated', v_owner, format('push_device_revoke(%L)', v_device_b))::boolean THEN
    RAISE EXCEPTION 'Owner revocation did not report success';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM push_device_subscriptions
                  WHERE id = v_id_b AND NOT enabled AND revoked_at IS NOT NULL
                    AND endpoint IS NULL AND p256dh IS NULL AND auth_key IS NULL) THEN
    RAISE EXCEPTION 'Revocation did not scrub endpoint and key material';
  END IF;
  IF _push_text('authenticated', v_owner, format('push_device_revoke(%L)', v_device_b))::boolean THEN
    RAISE EXCEPTION 'Revocation is not idempotent';
  END IF;
  IF (SELECT count(*) FROM automation_logs WHERE event_code = 'PUSH_DEVICE_REVOKED' AND entity_id = v_id_b) <> 1 THEN
    RAISE EXCEPTION 'Revocation audit rows are duplicated';
  END IF;

  PERFORM _push_text('authenticated', v_owner, format(
    'push_device_upsert(%L, ''Phone two'', %L, %L, %L, true)', v_device_c, v_endpoint, v_p256dh, v_auth));
  PERFORM _push_text('authenticated', v_owner, format(
    'push_device_upsert(%L, ''Phone three'', %L, %L, %L, true)', v_device_d, v_endpoint, v_p256dh, v_auth));
  IF (_push_text('authenticated', v_owner, 'push_device_revoke_all()'))::integer <> 2 THEN
    RAISE EXCEPTION 'Revoke-all did not report every live device';
  END IF;
  IF EXISTS (SELECT 1 FROM push_device_subscriptions
              WHERE owner_user_id = (v_owner->>'sub')::uuid
                AND (enabled OR revoked_at IS NULL OR endpoint IS NOT NULL OR p256dh IS NOT NULL OR auth_key IS NOT NULL)) THEN
    RAISE EXCEPTION 'Revoke-all left a device live or unscrubbed';
  END IF;
  IF (SELECT count(*) FROM automation_logs WHERE event_code = 'PUSH_ALL_DEVICES_REVOKED'
        AND entity_id = (v_owner->>'sub')::uuid) <> 1 THEN
    RAISE EXCEPTION 'Revoke-all was not audited exactly once';
  END IF;
  IF (_push_text('authenticated', v_owner, 'push_device_revoke_all()'))::integer <> 0
     OR (SELECT count(*) FROM automation_logs WHERE event_code = 'PUSH_ALL_DEVICES_REVOKED') <> 1 THEN
    RAISE EXCEPTION 'Revoke-all is not idempotent';
  END IF;

  -- ------------------------------------------------------ 10. audit hygiene
  IF EXISTS (
    SELECT 1 FROM automation_logs
     WHERE event_code LIKE 'PUSH%'
       AND (details <> '{}'::jsonb
            OR status <> 'succeeded'
            OR entity_type NOT IN ('push_device', 'push_owner')
            OR NOT (event_code = ANY (v_codes)))
  ) THEN
    RAISE EXCEPTION 'Push audit rows carry unsupported codes, statuses or details';
  END IF;
  IF EXISTS (
    SELECT 1 FROM automation_logs
     WHERE details::text ~* '(https?://|p256dh|auth_key|endpoint|token|secret)'
        OR details::text LIKE '%push.example.test%'
        OR (entity_type = 'push_device' AND details::text LIKE '%' || v_p256dh || '%')
  ) THEN
    RAISE EXCEPTION 'Push audit rows leaked push subscription material';
  END IF;
  IF (SELECT count(*) FROM automation_logs WHERE event_code LIKE 'PUSH%') < 8 THEN
    RAISE EXCEPTION 'Push audit trail is incomplete';
  END IF;

  -- ------------------------------------------ 11. switches and prose restored
  PERFORM _push_text('authenticated', v_owner, 'automation_set_feature_flag(''automation.push'', false)');
  IF (SELECT enabled FROM feature_flags WHERE flag_key = 'automation.push') IS NOT FALSE THEN
    RAISE EXCEPTION 'The push kill switch was not restored to off';
  END IF;
  SELECT md5(string_agg(id::text || ':' || COALESCE(content, ''), '|' ORDER BY id)) INTO v_hash_after FROM posts;
  IF v_hash_after IS DISTINCT FROM v_hash_before THEN
    RAISE EXCEPTION 'The push data layer changed owner article prose';
  END IF;
END $$;
