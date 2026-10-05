-- Phase 1.1 assertions: Vault metadata, owner-only access, RLS, redaction and
-- immutable owner-authored article bodies. Registered in scripts/db-test.py.
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION _automation_raises(role_name text, claims jsonb, stmt text)
RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('SET LOCAL ROLE %I', role_name);
  PERFORM set_config('request.jwt.claims', claims::text, true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(claims->>'sub', ''), true);
  PERFORM set_config('request.jwt.claim.role', COALESCE(claims->>'role', role_name), true);
  BEGIN
    EXECUTE stmt;
    RESET ROLE;
    RETURN false;
  EXCEPTION WHEN others THEN
    RESET ROLE;
    RETURN true;
  END;
END $$;

CREATE OR REPLACE FUNCTION _automation_text(role_name text, claims jsonb, expr text)
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

INSERT INTO posts (id, title, slug, status, content, excerpt)
VALUES ('41000000-0000-0000-0000-000000000001', 'Automation immutability fixture', 'automation-immutability-fixture', 'draft', 'Owner-authored test prose.', 'Fixture excerpt.')
ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, slug = EXCLUDED.slug, status = EXCLUDED.status, content = EXCLUDED.content;

DO $$
DECLARE
  owner_claims jsonb := '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000001","email":"owner@lixxonstudio.com"}'::jsonb;
  editor_claims jsonb := '{"role":"authenticated","sub":"00000000-0000-0000-0000-0000000000c3","email":"editor@example.com"}'::jsonb;
  anon_claims jsonb := '{"role":"anon"}'::jsonb;
  service_claims jsonb := '{"role":"service_role"}'::jsonb;
  fake_secret text := 'AUTOMATION-FAKE-SECRET-never-persist-in-app-table-314159';
  result jsonb;
  secret_list text;
  audit_rows text;
  internal_value text;
  log_id bigint;
  flag_updated boolean;
  current_flags jsonb;
  rel record;
  fn record;
  v_source text;
  was_blocked boolean;
BEGIN
  -- All automation tables have RLS, and browser/service roles have no direct table grants.
  FOR rel IN
    SELECT c.relname, c.relrowsecurity
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname IN (
       'automation_secret_catalog', 'automation_secrets', 'feature_flags', 'article_runs',
       'article_pipeline_state', 'automation_logs', 'automation_run_tokens'
     )
  LOOP
    IF rel.relrowsecurity IS NOT TRUE THEN RAISE EXCEPTION 'RLS is disabled on %', rel.relname; END IF;
    IF has_table_privilege('anon', 'public.' || rel.relname, 'SELECT')
       OR has_table_privilege('authenticated', 'public.' || rel.relname, 'SELECT')
       OR has_table_privilege('service_role', 'public.' || rel.relname, 'SELECT') THEN
      RAISE EXCEPTION 'Direct SELECT is granted on %', rel.relname;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'automation_secrets'
       AND column_name IN ('secret', 'secret_value', 'decrypted_secret', 'plaintext')
  ) THEN RAISE EXCEPTION 'Automation secret metadata table contains a plaintext-value column'; END IF;
  IF has_table_privilege('authenticated', 'vault.secrets', 'SELECT')
     OR has_table_privilege('authenticated', 'vault.decrypted_secrets', 'SELECT')
     OR has_table_privilege('anon', 'vault.decrypted_secrets', 'SELECT') THEN
    RAISE EXCEPTION 'A browser role can directly read Supabase Vault';
  END IF;

  IF has_table_privilege('service_role', 'public.posts', 'INSERT')
     OR has_table_privilege('service_role', 'public.posts', 'UPDATE')
     OR has_table_privilege('service_role', 'public.posts', 'DELETE') THEN
    RAISE EXCEPTION 'Backend/automation service role retains direct posts write privileges';
  END IF;

  -- Every new app callable function (including the content guard) is definer-only
  -- with a pinned safe search path. Internal secret/log operations are service-role-only.
  FOR fn IN
    SELECT p.proname, oidvectortypes(p.proargtypes) AS args, p.prosecdef, p.proconfig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname IN (
       'automation_list_secrets', 'automation_secret_save', 'automation_secret_delete',
       'automation_secret_get_internal', 'test_automation_secret', 'automation_feature_flags',
       'automation_set_feature_flag', 'automation_write_log', 'automation_guard_post_content'
     )
  LOOP
    IF fn.prosecdef IS NOT TRUE THEN RAISE EXCEPTION '% is not SECURITY DEFINER', fn.proname; END IF;
    IF position('search_path=public, pg_temp' IN COALESCE(array_to_string(fn.proconfig, ','), '')) = 0 THEN
      RAISE EXCEPTION '% does not pin search_path to public, pg_temp', fn.proname;
    END IF;
  END LOOP;
  IF has_function_privilege('anon', 'public.automation_list_secrets()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.automation_secret_get_internal(text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.test_automation_secret(text,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.automation_write_log(text,text,text,uuid,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Anonymous/client role can call an internal automation function';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.automation_secret_get_internal(text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.test_automation_secret(text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Trusted Edge service role cannot call required internal secret RPCs';
  END IF;

  -- New automation/legacy worker definitions contain no UPDATE/INSERT path to article prose.
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND (p.proname LIKE 'automation\_%' ESCAPE '\' OR p.proname IN ('admin_ai_run_agent', 'admin_ai_execute_action'))
       AND p.prosrc ~* 'update[[:space:]]+posts[[:space:]]+set[^;]*content[[:space:]]*='
  ) THEN RAISE EXCEPTION 'An automation/agent function has an article-body UPDATE path'; END IF;

  -- Owner can use the masked-list and Vault write path. The fake value may not escape
  -- into the RPC response, metadata, audit diff, or structured log.
  PERFORM set_config('request.jwt.claims', owner_claims::text, true);
  PERFORM set_config('request.jwt.claim.sub', owner_claims->>'sub', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SELECT automation_secret_save('openai_api_key', fake_secret) INTO result;
  IF result::text LIKE '%' || fake_secret || '%' OR result ? 'secret' OR result ? 'secret_value' THEN
    RAISE EXCEPTION 'Secret save response disclosed its value';
  END IF;
  SELECT automation_list_secrets()::text INTO secret_list;
  IF secret_list LIKE '%' || fake_secret || '%'
     OR secret_list LIKE '%vault_secret_id%'
     OR secret_list LIKE '%decrypted_secret%'
     OR secret_list LIKE '%secret_value%' THEN
    RAISE EXCEPTION 'Secret list response disclosed a value or Vault identifier';
  END IF;
  IF (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'lixxon_automation_openai_api_key') IS DISTINCT FROM fake_secret THEN
    RAISE EXCEPTION 'Secret was not stored in the Vault boundary';
  END IF;

  IF NOT _automation_raises('anon', anon_claims, 'SELECT automation_list_secrets()') THEN
    RAISE EXCEPTION 'Anonymous caller listed automation secrets';
  END IF;
  IF NOT _automation_raises('authenticated', editor_claims, 'SELECT automation_list_secrets()') THEN
    RAISE EXCEPTION 'Non-owner editor listed automation secrets';
  END IF;
  IF NOT _automation_raises('authenticated', editor_claims, 'SELECT automation_secret_save(''openai_api_key'', ''not-authorized'')') THEN
    RAISE EXCEPTION 'Non-owner editor saved an automation secret';
  END IF;
  IF NOT _automation_raises('authenticated', owner_claims, 'SELECT * FROM automation_secrets') THEN
    RAISE EXCEPTION 'Owner bypassed the masked secret-list API via direct table read';
  END IF;
  IF NOT _automation_raises('authenticated', owner_claims, 'SELECT automation_secret_get_internal(''openai_api_key'')') THEN
    RAISE EXCEPTION 'Authenticated browser role retrieved a plaintext secret';
  END IF;

  -- Only a service-role Edge caller may retrieve the value, and only into its
  -- server-side process. A test result is a fixed safe code, not provider output.
  internal_value := _automation_text('service_role', service_claims, 'automation_secret_get_internal(''openai_api_key'')');
  IF internal_value IS DISTINCT FROM fake_secret THEN RAISE EXCEPTION 'Service role could not retrieve its Vault secret'; END IF;
  SELECT _automation_text('service_role', service_claims, 'test_automation_secret(''openai_api_key'', ''ok'')')::jsonb INTO result;
  IF result->>'status' <> 'ok' OR result::text LIKE '%' || fake_secret || '%' THEN
    RAISE EXCEPTION 'Internal key test result is missing or leaked the secret';
  END IF;
  PERFORM set_config('request.jwt.claims', owner_claims::text, true);
  PERFORM set_config('request.jwt.claim.sub', owner_claims->>'sub', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SELECT automation_list_secrets()::text INTO secret_list;
  IF secret_list NOT LIKE '%Provider connection verified.%' THEN RAISE EXCEPTION 'Safe provider-test metadata was not recorded'; END IF;

  -- Owner-only feature policy starts fail-closed, is auditable, and can be restored.
  IF (automation_feature_flags()->>'automation.enabled')::boolean IS DISTINCT FROM false
     OR (automation_feature_flags()->>'automation.daily_pipeline')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Automation feature flags are not default-off';
  END IF;
  flag_updated := automation_set_feature_flag('automation.daily_pipeline', true);
  current_flags := automation_feature_flags();
  IF flag_updated IS DISTINCT FROM true
     OR (current_flags->>'automation.daily_pipeline')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Owner feature flag RPC did not enable the flag (updated=%, flags=%)', flag_updated, current_flags;
  END IF;
  flag_updated := automation_set_feature_flag('automation.daily_pipeline', false);
  IF flag_updated IS DISTINCT FROM true THEN RAISE EXCEPTION 'Owner could not restore the daily pipeline flag'; END IF;
  IF NOT _automation_raises('authenticated', editor_claims, 'SELECT automation_set_feature_flag(''automation.enabled'', true)') THEN
    RAISE EXCEPTION 'Non-owner editor changed an automation feature flag';
  END IF;
  IF NOT _automation_raises('authenticated', owner_claims, 'SELECT automation_set_feature_flag(''unreviewed.feature'', true)') THEN
    RAISE EXCEPTION 'Owner enabled an undefined feature flag';
  END IF;

  -- The service-role log endpoint is structured and rejects arbitrary/secret fields.
  SELECT _automation_text('service_role', service_claims,
    'automation_write_log(''AUTOMATION.TEST'', ''succeeded'', ''system'', NULL, ''{"step":"health","elapsed_ms":10}''::jsonb)')::bigint
    INTO log_id;
  IF NOT EXISTS (SELECT 1 FROM automation_logs WHERE id = log_id AND details->>'step' = 'health') THEN
    RAISE EXCEPTION 'Safe structured automation log was not recorded';
  END IF;
  IF NOT _automation_raises('authenticated', owner_claims,
    'SELECT automation_write_log(''AUTOMATION.TEST'', ''succeeded'', ''system'', NULL, ''{}''::jsonb)') THEN
    RAISE EXCEPTION 'Authenticated browser wrote a system automation log';
  END IF;
  IF NOT _automation_raises('service_role', service_claims,
    'SELECT automation_write_log(''AUTOMATION.TEST'', ''failed'', ''system'', NULL, ''{"secret":"do-not-store"}''::jsonb)') THEN
    RAISE EXCEPTION 'Structured automation log accepted a secret field';
  END IF;

  -- A service-role identity cannot write an article body; the trigger also blocks
  -- an automation-context body mutation even if a future function gains table access.
  IF NOT _automation_raises('service_role', service_claims,
    'UPDATE posts SET content = ''agent rewrite'' WHERE id = ''41000000-0000-0000-0000-000000000001''') THEN
    RAISE EXCEPTION 'Service role changed owner-authored article text';
  END IF;

  PERFORM set_config('request.jwt.claims', owner_claims::text, true);
  PERFORM set_config('request.jwt.claim.sub', owner_claims->>'sub', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;
  PERFORM set_config('lixxon.automation_agent', 'on', true);
  was_blocked := false;
  BEGIN
    UPDATE posts SET content = 'agent rewrite' WHERE id = '41000000-0000-0000-0000-000000000001';
  EXCEPTION WHEN insufficient_privilege THEN
    was_blocked := true;
  END;
  RESET ROLE;
  PERFORM set_config('lixxon.automation_agent', 'off', true);
  IF NOT was_blocked THEN RAISE EXCEPTION 'Automation actor changed posts.content through authenticated context'; END IF;

  -- Existing owner/editor authoring remains intact when no automation actor is set.
  PERFORM set_config('request.jwt.claims', owner_claims::text, true);
  PERFORM set_config('request.jwt.claim.sub', owner_claims->>'sub', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;
  PERFORM set_config('lixxon.automation_agent', 'off', true);
  UPDATE posts SET content = 'Owner-authored replacement fixture.' WHERE id = '41000000-0000-0000-0000-000000000001';
  RESET ROLE;
  IF (SELECT content FROM posts WHERE id = '41000000-0000-0000-0000-000000000001') IS DISTINCT FROM 'Owner-authored replacement fixture.' THEN
    RAISE EXCEPTION 'Human owner article editing was broken by the automation guard';
  END IF;

  SELECT COALESCE(string_agg(to_jsonb(l)::text, E'\n'), '') INTO audit_rows FROM admin_activity_log l;
  IF audit_rows LIKE '%' || fake_secret || '%' THEN RAISE EXCEPTION 'Audit log contains a raw Vault secret'; END IF;

  IF NOT automation_secret_delete('openai_api_key') THEN RAISE EXCEPTION 'Owner could not delete a Vault secret'; END IF;
  IF EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'lixxon_automation_openai_api_key')
     OR EXISTS (SELECT 1 FROM automation_secrets WHERE secret_name = 'openai_api_key') THEN
    RAISE EXCEPTION 'Secret deletion left the Vault value or metadata behind';
  END IF;
END $$;

DROP FUNCTION _automation_raises(text, jsonb, text);
DROP FUNCTION _automation_text(text, jsonb, text);

SELECT 'automation foundation: RLS, Vault redaction, safe logging and article immutability passed' AS assertion_result;
