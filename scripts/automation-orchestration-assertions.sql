-- Phase 2.2 assertions: Lagos schedule, owner approval, idempotent claims,
-- GitHub dispatch leasing, OIDC capability boundary, safe stages and immutability.
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION _automation_orchestration_text(role_name text, claims jsonb, expr text)
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

CREATE OR REPLACE FUNCTION _automation_orchestration_action(role_name text, claims jsonb, stmt text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('SET LOCAL ROLE %I', role_name);
  PERFORM set_config('request.jwt.claims', claims::text, true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(claims->>'sub', ''), true);
  PERFORM set_config('request.jwt.claim.role', COALESCE(claims->>'role', role_name), true);
  EXECUTE stmt;
  RESET ROLE;
END $$;

CREATE OR REPLACE FUNCTION _automation_orchestration_count(role_name text, claims jsonb, query text)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  EXECUTE format('SET LOCAL ROLE %I', role_name);
  PERFORM set_config('request.jwt.claims', claims::text, true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(claims->>'sub', ''), true);
  PERFORM set_config('request.jwt.claim.role', COALESCE(claims->>'role', role_name), true);
  EXECUTE 'SELECT count(*) FROM (' || query || ') q' INTO n;
  RESET ROLE;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION _automation_orchestration_raises(role_name text, claims jsonb, stmt text)
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
  v_reader jsonb := '{"role":"authenticated","sub":"00000000-0000-0000-0000-0000000000ab","email":"reader@example.com"}'::jsonb;
  v_anon jsonb := '{"role":"anon"}'::jsonb;
  v_service jsonb := '{"role":"service_role"}'::jsonb;
  v_day date := (now() AT TIME ZONE 'Africa/Lagos')::date + 7;
  v_publish_day date := (now() AT TIME ZONE 'Africa/Lagos')::date + 8;
  v_when timestamptz;
  v_publish_when timestamptz;
  v_valid_post uuid := '82000000-0000-0000-0000-000000000001';
  v_invalid_post uuid := '82000000-0000-0000-0000-000000000002';
  v_draft_post uuid := '82000000-0000-0000-0000-000000000003';
  v_publish_post uuid := '82000000-0000-0000-0000-000000000004';
  v_valid_run uuid;
  v_invalid_run uuid;
  v_run_text text;
  v_result jsonb;
  v_source text;
  v_post_updated_at timestamptz;
  v_snapshot_result text;
  v_content_hash text := repeat('e',64);
  v_token_hash_a text := repeat('f',64);
  v_token_hash_b text := repeat('9',64);
  v_token_hash_c text := repeat('8',64);
  v_first_published_at timestamptz;
  v_was_published boolean;
  v_count integer;
  fn record;
  table_name text;
  role_name text;
BEGIN
  -- Every new table is isolated. Even the service role must use the narrow RPCs.
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public.article_run_steps'::regclass AND relrowsecurity)
     OR NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public.article_run_kits'::regclass AND relrowsecurity) THEN
    RAISE EXCEPTION 'New automation tables do not have RLS enabled';
  END IF;
  FOREACH table_name IN ARRAY ARRAY['article_runs', 'article_pipeline_state', 'automation_run_tokens', 'article_run_steps', 'article_run_kits'] LOOP
    IF has_table_privilege('anon', 'public.' || table_name, 'SELECT')
       OR has_table_privilege('authenticated', 'public.' || table_name, 'SELECT')
       OR has_table_privilege('service_role', 'public.' || table_name, 'SELECT') THEN
      IF table_name NOT IN ('article_run_steps', 'article_run_kits')
         OR has_table_privilege('anon', 'public.' || table_name, 'SELECT')
         OR has_table_privilege('service_role', 'public.' || table_name, 'SELECT') THEN
        RAISE EXCEPTION 'Unexpected direct SELECT grant on %', table_name;
      END IF;
    END IF;
  END LOOP;
  IF NOT has_table_privilege('authenticated', 'public.article_run_steps', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.article_run_kits', 'SELECT') THEN
    RAISE EXCEPTION 'Owner run monitor cannot read safe stage metadata or the owner-authored kit';
  END IF;
  IF has_table_privilege('service_role', 'public.posts', 'INSERT')
     OR has_table_privilege('service_role', 'public.posts', 'UPDATE')
     OR has_table_privilege('service_role', 'public.posts', 'DELETE') THEN
    RAISE EXCEPTION 'Runner regained a posts write path';
  END IF;

  FOR fn IN
    SELECT p.proname, p.prosecdef, p.proconfig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname IN (
       'automation_revoke_scheduled_approval', 'automation_track_article_approval', 'automation_claim_daily_runs',
       'automation_record_daily_dispatch', 'automation_issue_run_capability',
       'automation_redeem_run_capability', 'automation_record_source_snapshot', 'automation_complete_pipeline_run',
       'automation_fail_pipeline_run', 'automation_fail_runner'
     )
  LOOP
    IF fn.prosecdef IS NOT TRUE THEN RAISE EXCEPTION '% is not SECURITY DEFINER', fn.proname; END IF;
    IF position('search_path=public, pg_temp' IN COALESCE(array_to_string(fn.proconfig, ','), '')) = 0 THEN
      RAISE EXCEPTION '% does not pin the required safe search_path', fn.proname;
    END IF;
  END LOOP;
  IF has_function_privilege('anon', 'public.automation_claim_daily_runs(date)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.automation_claim_daily_runs(date)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.automation_issue_run_capability(uuid,text,timestamptz,bigint,integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.automation_redeem_run_capability(uuid,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.automation_record_source_snapshot(uuid,text,timestamptz)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.automation_complete_pipeline_run(uuid,text,timestamptz,boolean,boolean,boolean,boolean,boolean,boolean)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.automation_claim_daily_runs(date)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.automation_issue_run_capability(uuid,text,timestamptz,bigint,integer)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.automation_record_source_snapshot(uuid,text,timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Runner RPC grants are too broad or unavailable to the server';
  END IF;
  IF NOT _automation_orchestration_raises('authenticated', v_owner, 'SELECT automation_claim_daily_runs(current_date)')
     OR NOT _automation_orchestration_raises('authenticated', v_owner, 'SELECT automation_record_source_snapshot(gen_random_uuid(), repeat(''a'',64), now())')
     OR NOT _automation_orchestration_raises('anon', v_anon, 'SELECT automation_redeem_run_capability(gen_random_uuid(), repeat(''a'',64))') THEN
    RAISE EXCEPTION 'A browser role could call an internal orchestration RPC';
  END IF;

  -- The daily pipeline is fail-closed when both master and daily switches are off.
  v_result := _automation_orchestration_text('authenticated', v_owner, 'automation_feature_flags()')::jsonb;
  IF (v_result->>'automation.enabled')::boolean IS DISTINCT FROM false
     OR (v_result->>'automation.daily_pipeline')::boolean IS DISTINCT FROM false
     OR _automation_orchestration_count('service_role', v_service,
       format('SELECT run_id FROM automation_claim_daily_runs(%L::date)', v_day)) <> 0 THEN
    RAISE EXCEPTION 'An off-by-default pipeline created or claimed a run';
  END IF;

  PERFORM set_config('request.jwt.claims', '{}', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  PERFORM set_config('lixxon.automation_agent', 'off', true);
  INSERT INTO posts (
    id, title, slug, status, content, excerpt, category_id, tags,
    cover_image, cover_image_alt, seo_title, seo_description
  ) VALUES
    (v_valid_post, 'Owner prose fixture', 'owner-prose-orchestration-valid', 'draft', 'one two three',
      'Owner-written excerpt.', '59d3acce-f83a-46db-84a3-c65f97d68a47', ARRAY['fixture'],
      'https://images.example.com/valid.jpg', 'Owner-written alt text', 'Valid SEO title', 'Valid owner-written SEO description.'),
    (v_invalid_post, 'Invalid metadata fixture', 'owner-prose-orchestration-invalid', 'draft', 'four five six',
      'Owner-written excerpt.', '59d3acce-f83a-46db-84a3-c65f97d68a47', ARRAY['fixture'],
      'https://images.example.com/invalid.jpg', 'Owner-written alt text', 'Valid SEO title', 'Valid owner-written SEO description.'),
    (v_draft_post, 'Unapproved draft fixture', 'owner-prose-orchestration-draft', 'draft', 'seven eight nine',
      'Owner-written excerpt.', '59d3acce-f83a-46db-84a3-c65f97d68a47', ARRAY['fixture'],
      'https://images.example.com/draft.jpg', 'Owner-written alt text', 'Valid SEO title', 'Valid owner-written SEO description.'),
    (v_publish_post, 'Existing publisher fixture', 'owner-prose-existing-publisher', 'draft', 'ten eleven twelve',
      'Owner-written excerpt.', '59d3acce-f83a-46db-84a3-c65f97d68a47', ARRAY['fixture'],
      'https://images.example.com/publish.jpg', 'Owner-written alt text', 'Valid SEO title', 'Valid owner-written SEO description.')
  ON CONFLICT (id) DO NOTHING;

  v_when := ((v_day + time '09:00') AT TIME ZONE 'Africa/Lagos');
  v_publish_when := ((v_publish_day + time '09:00') AT TIME ZONE 'Africa/Lagos');
  v_source := (SELECT content FROM posts WHERE id = v_valid_post);

  -- Intake metadata is saved by an existing editor capability; the later schedule
  -- action is a distinct authenticated content.publish approval.
  PERFORM _automation_orchestration_text('authenticated', v_editor,
    format('article_intake_save(%L::uuid,%L,%L,3,%L::timestamptz)', v_valid_post, 'valid.docx', repeat('a',64), v_when::text));
  PERFORM _automation_orchestration_text('authenticated', v_editor,
    format('article_intake_save(%L::uuid,%L,%L,3,%L::timestamptz)', v_invalid_post, 'invalid.docx', repeat('b',64), v_when::text));
  PERFORM _automation_orchestration_action('authenticated', v_owner,
    format('UPDATE posts SET cover_image = ''https:// '' WHERE id = %L::uuid', v_invalid_post));

  PERFORM _automation_orchestration_action('authenticated', v_owner,
    format('UPDATE posts SET status = ''scheduled'', scheduled_at = %L::timestamptz WHERE id = %L::uuid', v_when::text, v_valid_post));
  PERFORM _automation_orchestration_action('authenticated', v_owner,
    format('UPDATE posts SET status = ''scheduled'', scheduled_at = %L::timestamptz WHERE id = %L::uuid', v_when::text, v_invalid_post));
  -- The invalid metadata fixture remains owner-approved but must fail preflight
  -- before dispatch; it is never auto-repaired or published.
  IF NOT EXISTS (SELECT 1 FROM article_pipeline_state WHERE post_id = v_valid_post
      AND state = 'approved' AND owner_approved_at IS NOT NULL AND owner_approved_by = '00000000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'Scheduling did not record authenticated owner approval';
  END IF;
  IF EXISTS (SELECT 1 FROM article_pipeline_state WHERE post_id = v_draft_post AND owner_approved_at IS NOT NULL) THEN
    RAISE EXCEPTION 'An unpublished draft received owner approval without a schedule action';
  END IF;

  PERFORM _automation_orchestration_text('authenticated', v_owner,
    'automation_set_feature_flag(''automation.enabled'', true)')::boolean;
  PERFORM _automation_orchestration_text('authenticated', v_owner,
    'automation_set_feature_flag(''automation.daily_pipeline'', true)')::boolean;

  v_run_text := _automation_orchestration_text('service_role', v_service,
    format('(SELECT COALESCE(jsonb_agg(run_id), ''[]''::jsonb) FROM automation_claim_daily_runs(%L::date))', v_day::text));
  v_result := v_run_text::jsonb;
  IF jsonb_typeof(v_result) <> 'array' OR jsonb_array_length(v_result) <> 1 THEN
    RAISE EXCEPTION 'Only the approved valid row should have been dispatched; result=%', v_result;
  END IF;
  v_valid_run := (v_result->>0)::uuid;
  IF NOT EXISTS (SELECT 1 FROM article_runs WHERE id = v_valid_run AND post_id = v_valid_post
      AND status = 'queued' AND dispatch_status = 'dispatching' AND dispatch_attempts = 1) THEN
    RAISE EXCEPTION 'Valid owner-approved article was not idempotently claimed for dispatch';
  END IF;
  SELECT id INTO v_invalid_run FROM article_runs WHERE post_id = v_invalid_post ORDER BY created_at DESC LIMIT 1;
  IF v_invalid_run IS NULL OR NOT EXISTS (
    SELECT 1 FROM article_runs WHERE id = v_invalid_run AND status = 'failed'
      AND dispatch_status = 'not_required' AND dispatch_attempts = 0 AND safe_error_code = 'PREFLIGHT_INVALID'
  ) THEN
    RAISE EXCEPTION 'Invalid metadata fixture was not blocked before GitHub dispatch';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM article_run_steps WHERE run_id = v_invalid_run AND step_key = 'preflight' AND status = 'failed')
     OR NOT EXISTS (SELECT 1 FROM automation_logs WHERE entity_id = v_invalid_run AND event_code = 'RUN.PREFLIGHT' AND status = 'failed') THEN
    RAISE EXCEPTION 'Failed preflight was not individually logged';
  END IF;
  IF EXISTS (SELECT 1 FROM article_runs WHERE post_id = v_draft_post) THEN
    RAISE EXCEPTION 'An unapproved draft was claimed by the daily scheduler';
  END IF;
  IF _automation_orchestration_count('service_role', v_service,
       format('SELECT run_id FROM automation_claim_daily_runs(%L::date)', v_day)) <> 0 THEN
    RAISE EXCEPTION 'A duplicate daily tick dispatched the same run twice';
  END IF;

  -- Cross-user reads stay closed; the owner receives only safe stage metadata.
  IF _automation_orchestration_count('authenticated', v_editor,
       format('SELECT step_key FROM article_run_steps WHERE run_id = %L::uuid', v_valid_run)) <> 0
     OR _automation_orchestration_count('authenticated', v_reader,
       format('SELECT step_key FROM article_run_steps WHERE run_id = %L::uuid', v_valid_run)) <> 0
     OR _automation_orchestration_count('authenticated', v_owner,
       format('SELECT step_key FROM article_run_steps WHERE run_id = %L::uuid', v_valid_run)) <> 7 THEN
    RAISE EXCEPTION 'Run-step RLS exposed another user''s data or hid owner diagnostics';
  END IF;
  IF NOT _automation_orchestration_raises('authenticated', v_owner, 'SELECT * FROM automation_run_tokens')
     OR NOT _automation_orchestration_raises('service_role', v_service, 'SELECT * FROM automation_run_tokens') THEN
    RAISE EXCEPTION 'A client or Actions service role directly selected capability hashes';
  END IF;

  -- Capabilities are random 256-bit bearer values at the edge, represented only
  -- by a hash in Postgres, bound to the checked GitHub run, scoped, short-lived,
  -- single-use, retry-attempt-bound and unusable by browser roles.
  IF NOT _automation_orchestration_raises('authenticated', v_owner,
      format('SELECT automation_issue_run_capability(%L::uuid,%L,%L::timestamptz,1234567890,1)', v_valid_run, repeat('a',64), (now()+interval '4 minutes')::text)) THEN
    RAISE EXCEPTION 'Authenticated owner could mint a runner capability';
  END IF;
  IF NOT _automation_orchestration_raises('service_role', v_service,
      format('SELECT automation_issue_run_capability(%L::uuid,%L,%L::timestamptz,1234567890,1)', v_valid_run, repeat('a',64), (now()+interval '6 minutes')::text)) THEN
    RAISE EXCEPTION 'Capability lifetime exceeded the five-minute policy';
  END IF;
  IF _automation_orchestration_text('service_role', v_service,
      format('automation_issue_run_capability(%L::uuid,%L,%L::timestamptz,1234567890,1)', v_valid_run, v_token_hash_a, (now()+interval '4 minutes')::text))::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Trusted OIDC runner could not issue one short-lived capability';
  END IF;
  IF _automation_orchestration_text('service_role', v_service,
      format('automation_issue_run_capability(%L::uuid,%L,%L::timestamptz,1234567890,1)', v_valid_run, repeat('d',64), (now()+interval '4 minutes')::text))::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'A duplicate OIDC attempt rotated a live capability';
  END IF;
  IF EXISTS (SELECT 1 FROM automation_run_tokens WHERE run_id = v_valid_run AND token_hash = v_token_hash_a) IS NOT TRUE THEN
    RAISE EXCEPTION 'Only the capability hash was not stored';
  END IF;
  v_result := _automation_orchestration_text('service_role', v_service,
    format('automation_redeem_run_capability(%L::uuid,%L)', v_valid_run, v_token_hash_a))::jsonb;
  IF v_result->>'run_id' IS DISTINCT FROM v_valid_run::text
     OR v_result->>'post_id' IS DISTINCT FROM v_valid_post::text
     OR v_result ? 'token_hash' OR v_result ? 'capability' OR v_result ? 'content' THEN
    RAISE EXCEPTION 'Capability redemption returned an unsafe or incomplete work package';
  END IF;
  IF NOT _automation_orchestration_raises('service_role', v_service,
      format('SELECT automation_redeem_run_capability(%L::uuid,%L)', v_valid_run, v_token_hash_a)) THEN
    RAISE EXCEPTION 'A redeemed capability could be reused';
  END IF;
  SELECT updated_at INTO v_post_updated_at FROM posts WHERE id = v_valid_post;
  v_snapshot_result := _automation_orchestration_text('service_role', v_service,
    format('automation_record_source_snapshot(%L::uuid,%L,%L::timestamptz)',
      v_valid_run, v_content_hash, v_post_updated_at::text));
  IF v_snapshot_result <> 'recorded' THEN
    RAISE EXCEPTION 'Trusted runner could not anchor its source snapshot';
  END IF;
  IF _automation_orchestration_text('service_role', v_service,
      format('automation_record_source_snapshot(%L::uuid,%L,%L::timestamptz)',
        v_valid_run, repeat('7',64), (v_post_updated_at - interval '1 hour')::text)) <> 'source_changed' THEN
    RAISE EXCEPTION 'A stale article snapshot was not rejected';
  END IF;

  -- A failed attempt can be explicitly re-run by the same GitHub workflow run
  -- only at a higher run_attempt. An expired replacement remains unusable.
  IF _automation_orchestration_text('service_role', v_service,
      format('automation_fail_runner(%L::uuid,1234567890,1)', v_valid_run))::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'A verified runner failure was not recorded';
  END IF;
  IF _automation_orchestration_text('service_role', v_service,
      format('automation_issue_run_capability(%L::uuid,%L,%L::timestamptz,1234567890,2)', v_valid_run, v_token_hash_b, (now()+interval '4 minutes')::text))::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'A higher GitHub rerun attempt could not resume the run';
  END IF;
  UPDATE automation_run_tokens SET expires_at = now() - interval '1 second' WHERE run_id = v_valid_run;
  IF NOT _automation_orchestration_raises('service_role', v_service,
      format('SELECT automation_redeem_run_capability(%L::uuid,%L)', v_valid_run, v_token_hash_b)) THEN
    RAISE EXCEPTION 'An expired single-use capability was accepted';
  END IF;
  PERFORM _automation_orchestration_text('service_role', v_service,
    format('automation_fail_runner(%L::uuid,1234567890,2)', v_valid_run))::boolean;
  IF _automation_orchestration_text('service_role', v_service,
      format('automation_issue_run_capability(%L::uuid,%L,%L::timestamptz,1234567890,3)', v_valid_run, v_token_hash_c, (now()+interval '4 minutes')::text))::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'A new workflow attempt could not resume after an expired capability';
  END IF;
  PERFORM _automation_orchestration_text('service_role', v_service,
    format('automation_redeem_run_capability(%L::uuid,%L)', v_valid_run, v_token_hash_c))::jsonb;
  v_snapshot_result := _automation_orchestration_text('service_role', v_service,
    format('automation_record_source_snapshot(%L::uuid,%L,%L::timestamptz)',
      v_valid_run, v_content_hash, v_post_updated_at::text));
  IF v_snapshot_result <> 'recorded' THEN
    RAISE EXCEPTION 'Retry did not preserve the original article snapshot';
  END IF;

  -- Source hashing and safe metadata checks never write to the owner-authored
  -- article. Risky claims are held for human review; no provider is contacted.
  v_result := _automation_orchestration_text('service_role', v_service,
    format('automation_complete_pipeline_run(%L::uuid,%L,%L::timestamptz,true,true,true,true,true,true)',
      v_valid_run, v_content_hash, v_post_updated_at::text))::jsonb;
  IF v_result->>'status' IS DISTINCT FROM 'awaiting_approval'
     OR v_result->>'human_review_required' IS DISTINCT FROM 'true'
     OR v_result->>'source_checksum_recorded' IS DISTINCT FROM 'true'
     OR v_result->>'kit_ready' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'Safe source snapshot did not produce an owner kit: %', v_result;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM article_runs WHERE id = v_valid_run AND status = 'awaiting_approval'
      AND source_sha256 = v_content_hash AND phase = 'owner_review')
     OR NOT EXISTS (SELECT 1 FROM article_run_steps WHERE run_id = v_valid_run AND step_key = 'source_snapshot' AND status = 'succeeded')
     OR NOT EXISTS (SELECT 1 FROM article_run_steps WHERE run_id = v_valid_run AND step_key = 'channel_kit' AND status = 'awaiting_approval')
     OR NOT EXISTS (SELECT 1 FROM article_run_steps WHERE run_id = v_valid_run AND step_key = 'asset_render' AND status = 'skipped' AND safe_error_code = 'VIDEO_DISABLED')
     OR NOT EXISTS (SELECT 1 FROM article_run_steps WHERE run_id = v_valid_run AND step_key = 'publish_dispatch' AND status = 'awaiting_approval') THEN
    RAISE EXCEPTION 'Resumable stages, human-review hold or disabled-video reason were not recorded';
  END IF;
  IF _automation_orchestration_count('authenticated', v_editor,
       format('SELECT run_id FROM article_run_kits WHERE run_id = %L::uuid', v_valid_run)) <> 0
     OR _automation_orchestration_count('authenticated', v_reader,
       format('SELECT run_id FROM article_run_kits WHERE run_id = %L::uuid', v_valid_run)) <> 0
     OR _automation_orchestration_count('authenticated', v_owner,
       format('SELECT run_id FROM article_run_kits WHERE run_id = %L::uuid', v_valid_run)) <> 1 THEN
    RAISE EXCEPTION 'Daily-kit RLS exposed another user''s article metadata';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM article_run_kits WHERE run_id = v_valid_run AND post_id = v_valid_post
      AND canonical_path = '/blog/owner-prose-orchestration-valid'
      AND title = 'Owner prose fixture' AND owner_excerpt = 'Owner-written excerpt.'
      AND source_sha256 = v_content_hash AND review_status = 'pending')
     OR EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema = 'public'
       AND c.table_name = 'article_run_kits' AND c.column_name = 'content') THEN
    RAISE EXCEPTION 'Daily kit did not contain only validated owner-authored distribution metadata';
  END IF;
  IF (SELECT content FROM posts WHERE id = v_valid_post) IS DISTINCT FROM v_source THEN
    RAISE EXCEPTION 'The orchestration runner changed owner-authored posts.content';
  END IF;
  IF EXISTS (SELECT 1 FROM automation_logs WHERE entity_id = v_valid_run AND details::text LIKE '%' || v_source || '%')
     OR EXISTS (SELECT 1 FROM admin_activity_log WHERE to_jsonb(admin_activity_log)::text LIKE '%' || v_token_hash_a || '%') THEN
    RAISE EXCEPTION 'Article prose or a capability hash escaped into an audit/log record';
  END IF;

  -- Editing approved metadata automatically revokes the stale schedule, kit,
  -- run and capability; the owner must explicitly schedule the revised version.
  PERFORM _automation_orchestration_action('authenticated', v_owner,
    format('UPDATE posts SET seo_title = seo_title || '' reviewed edit'' WHERE id = %L::uuid', v_valid_post));
  IF NOT EXISTS (SELECT 1 FROM posts WHERE id = v_valid_post AND status = 'draft' AND scheduled_at IS NULL)
     OR NOT EXISTS (SELECT 1 FROM article_pipeline_state WHERE post_id = v_valid_post
      AND state = 'draft' AND owner_approved_at IS NULL)
     OR NOT EXISTS (SELECT 1 FROM article_runs WHERE id = v_valid_run AND status = 'cancelled'
      AND dispatch_status = 'not_required' AND safe_error_code = 'APPROVAL_REVOKED')
     OR NOT EXISTS (SELECT 1 FROM article_run_kits WHERE run_id = v_valid_run AND review_status = 'revoked') THEN
    RAISE EXCEPTION 'Editing an approved article did not revoke pending distribution work';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM automation_run_tokens WHERE run_id = v_valid_run AND consumed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Schedule revocation did not invalidate the runner capability';
  END IF;

  -- Exercise the existing five-minute publisher without adding a second one.
  PERFORM _automation_orchestration_action('authenticated', v_owner,
    format('UPDATE posts SET status = ''scheduled'', scheduled_at = %L::timestamptz WHERE id = %L::uuid', v_publish_when::text, v_publish_post));
  ALTER TABLE posts DISABLE TRIGGER trg_article_daily_schedule_capacity;
  PERFORM _automation_orchestration_action('authenticated', v_owner,
    format('UPDATE posts SET scheduled_at = now() - interval ''1 minute'' WHERE id = %L::uuid', v_publish_post));
  ALTER TABLE posts ENABLE TRIGGER trg_article_daily_schedule_capacity;
  PERFORM publish_scheduled_posts();
  SELECT published_at, status = 'published' INTO v_first_published_at, v_was_published FROM posts WHERE id = v_publish_post;
  IF v_was_published IS NOT TRUE OR v_first_published_at IS NULL THEN
    RAISE EXCEPTION 'The existing publisher did not publish the due approved fixture';
  END IF;
  PERFORM publish_scheduled_posts();
  IF (SELECT status FROM posts WHERE id = v_publish_post) <> 'published'
     OR (SELECT published_at FROM posts WHERE id = v_publish_post) IS DISTINCT FROM v_first_published_at THEN
    RAISE EXCEPTION 'A repeated scheduled tick published the same article twice';
  END IF;
  IF (SELECT content FROM posts WHERE id = v_publish_post) <> 'ten eleven twelve' THEN
    RAISE EXCEPTION 'The existing publisher changed article prose';
  END IF;

  PERFORM _automation_orchestration_text('authenticated', v_owner,
    'automation_set_feature_flag(''automation.daily_pipeline'', false)')::boolean;
  PERFORM _automation_orchestration_text('authenticated', v_owner,
    'automation_set_feature_flag(''automation.enabled'', false)')::boolean;
  IF EXISTS (SELECT 1 FROM feature_flags WHERE flag_key IN ('automation.enabled', 'automation.daily_pipeline') AND enabled) THEN
    RAISE EXCEPTION 'Orchestration assertion left a global feature flag enabled';
  END IF;
END $$;

DROP FUNCTION _automation_orchestration_text(text, jsonb, text);
DROP FUNCTION _automation_orchestration_action(text, jsonb, text);
DROP FUNCTION _automation_orchestration_count(text, jsonb, text);
DROP FUNCTION _automation_orchestration_raises(text, jsonb, text);

SELECT 'automation orchestration: owner approval, idempotency, OIDC capability boundaries, safe stages and existing publisher passed' AS assertion_result;
