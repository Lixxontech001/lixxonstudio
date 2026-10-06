-- Phase 5 (Slice 4) assertions: automation log retention.
-- Proves the prune function is owner/service-only, clamps to a safe floor,
-- deletes only old automation_logs rows, and leaves recent evidence and every
-- other table (articles, orders, admin audit) untouched.
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION _ret_text(role_name text, claims jsonb, expr text)
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

CREATE OR REPLACE FUNCTION _ret_raises(role_name text, claims jsonb, statement text)
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
  v_anon jsonb := '{"role":"anon"}'::jsonb;
  v_service jsonb := '{"role":"service_role"}'::jsonb;
  v_fn record;
  v_old_id bigint;
  v_fresh_id bigint;
  v_removed integer;
  v_hash_before text;
  v_hash_after text;
  v_orders_before bigint;
  v_orders_after bigint;
  v_audit_before bigint;
  v_audit_after bigint;
BEGIN
  -- ------------------------------------------------------------- 1. contract
  SELECT p.prosecdef, p.proconfig INTO v_fn
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'automation_prune_logs';
  IF NOT FOUND OR v_fn.prosecdef IS NOT TRUE
     OR position('search_path=public, pg_temp' IN COALESCE(array_to_string(v_fn.proconfig, ','), '')) = 0 THEN
    RAISE EXCEPTION 'automation_prune_logs must be SECURITY DEFINER with a pinned search_path';
  END IF;

  IF NOT has_function_privilege('service_role', 'public.automation_prune_logs(integer)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.automation_prune_logs(integer)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.automation_prune_logs(integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'automation_prune_logs grants are not least-privilege';
  END IF;

  -- A non-owner browser caller can never prune, even with a valid JWT.
  IF NOT _ret_raises('authenticated', v_reader, 'automation_prune_logs(180)')
     OR NOT _ret_raises('anon', v_anon, 'automation_prune_logs(180)') THEN
    RAISE EXCEPTION 'A non-owner caller pruned automation logs';
  END IF;

  -- ------------------------------------------------- 2. fixtures for the test
  INSERT INTO public.automation_logs (event_code, status, entity_type, details, created_at)
  VALUES ('RETENTION_TEST_OLD', 'succeeded', 'push_device', '{}'::jsonb, now() - interval '200 days')
  RETURNING id INTO v_old_id;
  INSERT INTO public.automation_logs (event_code, status, entity_type, details, created_at)
  VALUES ('RETENTION_TEST_FRESH', 'succeeded', 'push_device', '{}'::jsonb, now())
  RETURNING id INTO v_fresh_id;

  SELECT md5(string_agg(id::text || ':' || COALESCE(content, ''), '|' ORDER BY id)) INTO v_hash_before FROM posts;
  SELECT count(*) INTO v_orders_before FROM orders;
  SELECT count(*) INTO v_audit_before FROM admin_activity_log;

  -- --------------------------------------------- 3. the floor protects data
  -- A 1-day request must be clamped to 90 days. The 30-day-old row and the fresh
  -- row must therefore survive; the 200-day-old row is legitimately outside the
  -- floor window and is removed by this same call.
  INSERT INTO public.automation_logs (event_code, status, entity_type, details, created_at)
  VALUES ('RETENTION_TEST_30D', 'succeeded', 'push_device', '{}'::jsonb, now() - interval '30 days');
  v_removed := _ret_text('authenticated', v_owner, 'automation_prune_logs(1)')::integer;
  IF EXISTS (SELECT 1 FROM automation_logs WHERE event_code = 'RETENTION_TEST_30D') IS NOT TRUE THEN
    RAISE EXCEPTION 'The retention floor was ignored: a 30-day-old row was pruned';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM automation_logs WHERE id = v_fresh_id) THEN
    RAISE EXCEPTION 'The retention floor deleted fresh evidence';
  END IF;
  IF EXISTS (SELECT 1 FROM automation_logs WHERE id = v_old_id) IS NOT FALSE THEN
    RAISE EXCEPTION 'A row outside the retention window survived the prune';
  END IF;
  IF v_removed < 1 THEN
    RAISE EXCEPTION 'Pruning reported no removals despite an out-of-window row';
  END IF;

  -- ------------------------------------------------- 4. real pruning works
  -- A second out-of-window row, pruned with the operational default.
  INSERT INTO public.automation_logs (event_code, status, entity_type, details, created_at)
  VALUES ('RETENTION_TEST_OLD', 'succeeded', 'push_device', '{}'::jsonb, now() - interval '200 days')
  RETURNING id INTO v_old_id;
  v_removed := _ret_text('service_role', v_service, 'automation_prune_logs(180)')::integer;
  IF v_removed < 1 OR EXISTS (SELECT 1 FROM automation_logs WHERE id = v_old_id) THEN
    RAISE EXCEPTION 'A 200-day-old automation log row was not pruned';
  END IF;
  -- Recent evidence must always survive, including push delivery/verification rows.
  IF NOT EXISTS (SELECT 1 FROM automation_logs WHERE id = v_fresh_id)
     OR NOT EXISTS (SELECT 1 FROM automation_logs WHERE event_code = 'RETENTION_TEST_30D') THEN
    RAISE EXCEPTION 'Pruning removed evidence inside the retention window';
  END IF;

  -- --------------------------------- 5. nothing else was touched
  SELECT md5(string_agg(id::text || ':' || COALESCE(content, ''), '|' ORDER BY id)) INTO v_hash_after FROM posts;
  SELECT count(*) INTO v_orders_after FROM orders;
  SELECT count(*) INTO v_audit_after FROM admin_activity_log;
  IF v_hash_after IS DISTINCT FROM v_hash_before THEN
    RAISE EXCEPTION 'Log retention changed article content';
  END IF;
  IF v_orders_after <> v_orders_before THEN
    RAISE EXCEPTION 'Log retention deleted order rows';
  END IF;
  IF v_audit_after <> v_audit_before THEN
    RAISE EXCEPTION 'Log retention deleted admin audit rows';
  END IF;

  -- The append-only log keeps its RLS/no-browser-write invariants.
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.automation_logs'::regclass) THEN
    RAISE EXCEPTION 'automation_logs lost RLS';
  END IF;
  IF has_table_privilege('authenticated', 'public.automation_logs', 'INSERT')
     OR has_table_privilege('authenticated', 'public.automation_logs', 'DELETE')
     OR has_table_privilege('anon', 'public.automation_logs', 'SELECT') THEN
    RAISE EXCEPTION 'automation_logs lost its least-privilege grants';
  END IF;

  DELETE FROM public.automation_logs WHERE event_code LIKE 'RETENTION_TEST_%';
END $$;
