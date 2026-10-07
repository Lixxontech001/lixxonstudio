-- Phase 3.1 assertions: safe owner-only channel drafts, provider evidence,
-- checksum approvals, idempotent Telegram receipts, caps, and prose isolation.
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION _distribution_text(role_name text, claims jsonb, expr text)
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

CREATE OR REPLACE FUNCTION _distribution_action(role_name text, claims jsonb, statement text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('SET LOCAL ROLE %I', role_name);
  PERFORM set_config('request.jwt.claims', claims::text, true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(claims->>'sub', ''), true);
  PERFORM set_config('request.jwt.claim.role', COALESCE(claims->>'role', role_name), true);
  EXECUTE statement;
  RESET ROLE;
END $$;

CREATE OR REPLACE FUNCTION _distribution_raises(role_name text, claims jsonb, statement text)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE raised boolean := false;
BEGIN
  EXECUTE format('SET LOCAL ROLE %I', role_name);
  PERFORM set_config('request.jwt.claims', claims::text, true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(claims->>'sub', ''), true);
  PERFORM set_config('request.jwt.claim.role', COALESCE(claims->>'role', role_name), true);
  BEGIN
    EXECUTE statement;
  EXCEPTION WHEN others THEN
    raised := true;
  END;
  RESET ROLE;
  RETURN raised;
END $$;

CREATE OR REPLACE FUNCTION _distribution_count(role_name text, claims jsonb, statement text)
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
  v_editor jsonb := '{"role":"authenticated","sub":"00000000-0000-0000-0000-0000000000e5","email":"support@example.com"}'::jsonb;
  v_reader jsonb := '{"role":"authenticated","sub":"00000000-0000-0000-0000-0000000000d4"}'::jsonb;
  v_service jsonb := '{"role":"service_role"}'::jsonb;
  v_anon jsonb := '{"role":"anon"}'::jsonb;
  v_post uuid := '85000000-0000-0000-0000-000000000001';
  v_post_two uuid := '85000000-0000-0000-0000-000000000002';
  v_when timestamptz := (((now() AT TIME ZONE 'Africa/Lagos')::date + 30 + time '09:00') AT TIME ZONE 'Africa/Lagos');
  v_when_two timestamptz := (((now() AT TIME ZONE 'Africa/Lagos')::date + 30 + time '11:00') AT TIME ZONE 'Africa/Lagos');
  v_sentinel text := 'OWNER_ARTICLE_PROSE_NEVER_DISTRIBUTE_85000000';
  v_snapshot jsonb;
  v_articles jsonb;
  v_draft_id uuid;
  v_hash text;
  v_payload jsonb;
  v_result jsonb;
  v_claim jsonb;
  v_replay jsonb;
  v_email_claim jsonb;
  v_newsletter_id uuid;
  v_newsletter_hash text;
  v_variant jsonb;
  fn record;
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['automation_distribution_channels', 'automation_distribution_drafts', 'distribution_log', 'ab_test_variants', 'distribution_test_log'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = format('public.%I', tbl)::regclass AND relrowsecurity) THEN
      RAISE EXCEPTION '% does not have RLS enabled', tbl;
    END IF;
    IF has_table_privilege('anon', format('public.%I', tbl), 'SELECT')
       OR has_table_privilege('authenticated', format('public.%I', tbl), 'INSERT')
       OR has_table_privilege('authenticated', format('public.%I', tbl), 'UPDATE')
       OR has_table_privilege('authenticated', format('public.%I', tbl), 'DELETE')
       OR has_table_privilege('service_role', format('public.%I', tbl), 'SELECT') THEN
      RAISE EXCEPTION '% has an unintended direct table grant', tbl;
    END IF;
    IF NOT has_table_privilege('authenticated', format('public.%I', tbl), 'SELECT') THEN
      RAISE EXCEPTION 'Authenticated admin readers cannot inspect safe % metadata', tbl;
    END IF;
  END LOOP;

  FOR fn IN
    SELECT p.proname, p.prosecdef, p.proconfig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname IN (
       'automation_distribution_articles', 'automation_distribution_snapshot',
       'automation_prepare_daily_kit', 'automation_save_distribution_draft',
       'automation_approve_distribution_draft', 'automation_reject_distribution_draft',
       'automation_set_distribution_pause', 'automation_distribution_owner_check',
       'automation_record_channel_readback', 'automation_create_ab_variant',
       'automation_claim_distribution_delivery', 'automation_complete_distribution_delivery',
       'automation_claim_newsletter_test', 'automation_complete_newsletter_test'
     )
  LOOP
    IF fn.prosecdef IS NOT TRUE THEN RAISE EXCEPTION '% is not SECURITY DEFINER', fn.proname; END IF;
    IF position('search_path=public, pg_temp' IN COALESCE(array_to_string(fn.proconfig, ','), '')) = 0 THEN
      RAISE EXCEPTION '% does not pin the required safe search_path', fn.proname;
    END IF;
  END LOOP;

  IF NOT has_function_privilege('authenticated', 'public.automation_distribution_articles()', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.automation_distribution_snapshot(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.automation_prepare_daily_kit(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.automation_record_channel_readback(text,text,text,integer)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.automation_claim_distribution_delivery(uuid,uuid,text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.automation_complete_distribution_delivery(bigint,text,text,text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.automation_claim_newsletter_test(uuid,uuid,text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.automation_complete_newsletter_test(bigint,text,text,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.automation_distribution_articles()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.automation_distribution_snapshot(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.automation_prepare_daily_kit(uuid)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.automation_prepare_daily_kit(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.automation_record_channel_readback(text,text,text,integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.automation_claim_distribution_delivery(uuid,uuid,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.automation_complete_distribution_delivery(bigint,text,text,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.automation_claim_newsletter_test(uuid,uuid,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.automation_complete_newsletter_test(bigint,text,text,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.automation_claim_newsletter_test(uuid,uuid,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.automation_complete_newsletter_test(bigint,text,text,text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.automation_claim_newsletter_test(uuid,uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Distribution RPC grants are too broad or unavailable';
  END IF;

  IF (SELECT count(*) FROM automation_distribution_channels) <> 13
     OR (SELECT count(*) FROM automation_distribution_channels WHERE approval_required AND NOT auto_publish_enabled AND state = 'manual_kit') <> 13
     OR (SELECT count(*) FROM automation_distribution_channels WHERE is_paused) <> 0
     OR (SELECT count(*) FROM feature_flags WHERE flag_key IN ('automation.enabled', 'automation.distribution')) <> 2
     OR (SELECT bool_or(enabled) FROM feature_flags WHERE flag_key IN ('automation.enabled', 'automation.distribution')) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Distribution targets or default-off safeguards are incorrect';
  END IF;
  IF position('p.content' IN pg_get_functiondef('public.automation_prepare_daily_kit(uuid)'::regprocedure)) > 0
     OR position('posts.content' IN pg_get_functiondef('public.automation_prepare_daily_kit(uuid)'::regprocedure)) > 0 THEN
    RAISE EXCEPTION 'Daily Kit SQL selects article prose';
  END IF;

  -- A support account with broad UI permission overrides still cannot create,
  -- approve, pause, or switch owner-only automation/distribution actions.
  INSERT INTO admin_permission_overrides (user_id, permission, effect, note, created_by) VALUES
    ('00000000-0000-0000-0000-0000000000e5', 'automation.check', 'grant', 'distribution permission boundary test', '00000000-0000-0000-0000-000000000001'),
    ('00000000-0000-0000-0000-0000000000e5', 'automation.manage', 'grant', 'distribution permission boundary test', '00000000-0000-0000-0000-000000000001')
  ON CONFLICT (user_id, permission) DO UPDATE SET effect = 'grant', note = EXCLUDED.note;

  IF NOT _distribution_raises('anon', v_anon, 'SELECT automation_distribution_articles()')
     OR NOT _distribution_raises('authenticated', v_reader, 'SELECT automation_distribution_owner_check()')
     OR NOT _distribution_raises('authenticated', v_editor, 'SELECT automation_distribution_owner_check()')
     OR NOT _distribution_raises('authenticated', v_editor, 'SELECT automation_set_feature_flag(''automation.distribution'', true)')
     OR NOT _distribution_raises('authenticated', v_editor, 'SELECT automation_set_distribution_pause(''telegram'', true)')
     OR NOT _distribution_raises('authenticated', v_editor,
       'SELECT automation_record_channel_readback(''telegram'', ''connected'', ''PROVIDER_READBACK_OK'', NULL)') THEN
    RAISE EXCEPTION 'A non-owner or anonymous user crossed the owner/service-only boundary';
  END IF;
  IF _distribution_count('authenticated', v_reader, 'SELECT channel_key FROM automation_distribution_channels') <> 0
     OR _distribution_count('authenticated', v_reader, 'SELECT id FROM automation_distribution_drafts') <> 0
     OR _distribution_count('authenticated', v_reader, 'SELECT id FROM distribution_log') <> 0
     OR _distribution_count('authenticated', v_reader, 'SELECT id FROM ab_test_variants') <> 0
     OR _distribution_count('authenticated', v_reader, 'SELECT id FROM distribution_test_log') <> 0 THEN
    RAISE EXCEPTION 'RLS allowed cross-user access to distribution metadata';
  END IF;

  PERFORM set_config('request.jwt.claims', v_owner::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_owner->>'sub', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('lixxon.automation_agent', 'off', true);
  INSERT INTO posts (
    id, title, slug, status, content, excerpt, category_id, tags, cover_image,
    cover_image_alt, scheduled_at, published_at
  ) VALUES
    (v_post, 'Distribution owner-authored title', 'distribution-owner-title', 'scheduled', v_sentinel,
     'An excerpt deliberately separate from the immutable owner-authored article prose.',
     '59d3acce-f83a-46db-84a3-c65f97d68a47', ARRAY['distribution', 'owner-reviewed'],
     'https://lixxonstudio.com/images/distribution-cover.jpg', 'A selected article cover', v_when, v_when),
    (v_post_two, 'Second distribution safety article', 'distribution-safety-second', 'scheduled', 'Second owner-written body stays private.',
     'A second approved excerpt for quota assertions.', '59d3acce-f83a-46db-84a3-c65f97d68a47', ARRAY['safety'],
     'https://lixxonstudio.com/images/distribution-second.jpg', 'Second selected cover', v_when_two, v_when_two)
  ON CONFLICT (id) DO NOTHING;

  v_articles := _distribution_text('authenticated', v_owner, 'automation_distribution_articles()')::jsonb;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_articles->'articles') a WHERE a->>'id' = v_post::text)
     OR v_articles::text LIKE '%' || v_sentinel || '%' THEN
    RAISE EXCEPTION 'Article selector omitted eligible owner metadata or exposed article prose';
  END IF;

  v_snapshot := _distribution_text('authenticated', v_owner,
    format('automation_prepare_daily_kit(%L::uuid)', v_post))::jsonb;
  IF jsonb_array_length(v_snapshot->'channels') <> 13
     OR (v_snapshot->>'post_id')::uuid <> v_post
     OR (v_snapshot->'flags'->>'automation.enabled')::boolean IS DISTINCT FROM false
     OR (v_snapshot->'flags'->>'automation.distribution')::boolean IS DISTINCT FROM false
     OR v_snapshot::text LIKE '%' || v_sentinel || '%'
     OR v_snapshot::text LIKE '%Second owner-written body%'
     OR (SELECT count(*) FROM jsonb_array_elements(v_snapshot->'channels') c
          WHERE (c->>'approval_required')::boolean AND NOT (c->>'auto_publish_enabled')::boolean
            AND c->>'state' = 'manual_kit' AND c->'draft'->>'review_status' = 'pending') <> 13 THEN
    RAISE EXCEPTION 'Daily Kit did not produce exactly 13 safe, approval-first drafts';
  END IF;
  IF (SELECT content FROM posts WHERE id = v_post) IS DISTINCT FROM v_sentinel THEN
    RAISE EXCEPTION 'Preparing a distribution kit changed posts.content';
  END IF;
  IF _distribution_count('authenticated', v_reader,
       format('SELECT id FROM automation_distribution_drafts WHERE post_id = %L::uuid', v_post)) <> 0
     OR NOT _distribution_raises('authenticated', v_reader,
       format('SELECT automation_distribution_snapshot(%L::uuid)', v_post)) THEN
    RAISE EXCEPTION 'An unauthorized account read an owner article distribution kit';
  END IF;
  IF NOT _distribution_raises('authenticated', v_editor,
       format('SELECT automation_prepare_daily_kit(%L::uuid)', v_post)) THEN
    RAISE EXCEPTION 'A permission-overridden non-owner prepared distribution drafts';
  END IF;

  SELECT id, payload_sha256, payload INTO v_draft_id, v_hash, v_payload
    FROM automation_distribution_drafts WHERE post_id = v_post AND channel_key = 'telegram';
  IF v_draft_id IS NULL OR v_payload->>'link' <> 'https://lixxonstudio.com/blog/distribution-owner-title?utm_source=telegram&utm_medium=organic_social&utm_campaign=distribution-owner-title'
     OR v_payload->>'caption' NOT LIKE '%An excerpt deliberately separate%'
     OR v_payload::text LIKE '%' || v_sentinel || '%' THEN
    RAISE EXCEPTION 'Channel payload/link was not derived solely from the approved excerpt and safe metadata';
  END IF;
  v_result := _distribution_text('authenticated', v_owner,
    format('automation_approve_distribution_draft(%L::uuid, %L)', v_draft_id, v_hash))::jsonb;
  IF v_result->>'review_status' <> 'approved' OR v_result->>'side_effects' <> '0' THEN
    RAISE EXCEPTION 'The experiment baseline was not explicitly owner-approved';
  END IF;
  IF NOT _distribution_raises('authenticated', v_owner, format(
       'SELECT automation_save_distribution_draft(%L::uuid, %L::jsonb)',
       v_draft_id, (v_payload || jsonb_build_object('posts.content', v_sentinel))::text))
     OR NOT _distribution_raises('authenticated', v_owner,
       format('SELECT automation_approve_distribution_draft(%L::uuid, %L)', v_draft_id, repeat('f', 64)))
     OR NOT _distribution_raises('authenticated', v_owner,
       format('SELECT automation_create_ab_variant(%L::uuid, ''telegram'', ''B'', ''Compare a question-led excerpt with the current owner-approved copy.'', ''unsupported_metric'', ''negative_feedback_rate'', %L::jsonb)',
         v_post, v_payload::text)) THEN
    RAISE EXCEPTION 'Unsafe body input, stale checksum, or invalid A/B metric was accepted';
  END IF;

  v_variant := _distribution_text('authenticated', v_owner, format(
    'automation_create_ab_variant(%L::uuid, ''telegram'', ''B'', ''Compare a question-led excerpt with the current owner-approved copy.'', ''click_through_rate'', ''negative_feedback_rate'', %L::jsonb)',
    v_post, v_payload::text))::jsonb;
  IF v_variant->>'status' <> 'approved'
     OR (SELECT count(*) FROM ab_test_variants WHERE post_id = v_post AND status = 'approved'
          AND approved_by = (v_owner->>'sub')::uuid AND approved_at IS NOT NULL
          AND hypothesis IS NOT NULL AND primary_metric IS NOT NULL AND guardrail_metric IS NOT NULL) <> 1 THEN
    RAISE EXCEPTION 'A/B variants were stored without explicit owner approval and stated metrics';
  END IF;
  IF NOT _distribution_raises('authenticated', v_editor, format(
       'SELECT automation_create_ab_variant(%L::uuid, ''telegram'', ''C'', ''A non-owner cannot create a distribution experiment.'', ''click_through_rate'', ''negative_feedback_rate'', %L::jsonb)',
       v_post, v_payload::text)) THEN
    RAISE EXCEPTION 'A non-owner created an A/B variant';
  END IF;
  v_result := _distribution_text('authenticated', v_owner,
    format('automation_approve_distribution_draft(%L::uuid, %L)', v_draft_id, v_hash))::jsonb;
  IF v_result->>'review_status' <> 'approved' OR v_result->>'side_effects' <> '0' THEN
    RAISE EXCEPTION 'Approval did not bind the exact checksum without external effects';
  END IF;

  IF _distribution_text('authenticated', v_owner, 'automation_distribution_owner_check()') <> 'true' THEN
    RAISE EXCEPTION 'The active owner could not verify owner scope';
  END IF;
  IF _distribution_text('service_role', v_service,
       'automation_record_channel_readback(''telegram'', ''connected'', ''PROVIDER_READBACK_OK'', NULL)') <> 'true'
     OR NOT _distribution_raises('service_role', v_service,
       'SELECT automation_record_channel_readback(''telegram'', ''invented_status'', ''PROVIDER_READBACK_OK'', NULL)') THEN
    RAISE EXCEPTION 'The service readback RPC did not validate and record safe evidence';
  END IF;
  IF (SELECT state FROM automation_distribution_channels WHERE channel_key = 'telegram') <> 'approval_required'
     OR (SELECT last_readback_status FROM automation_distribution_channels WHERE channel_key = 'telegram') <> 'connected' THEN
    RAISE EXCEPTION 'Verified readback did not enable approval-required status';
  END IF;

  -- Newsletter test sends are explicit, approved, owner-address-only,
  -- idempotent, rate-limited and never record recipient PII.
  SELECT id, payload_sha256 INTO v_newsletter_id, v_newsletter_hash
    FROM automation_distribution_drafts WHERE post_id = v_post AND channel_key = 'newsletter';
  PERFORM _distribution_text('authenticated', v_owner,
    format('automation_approve_distribution_draft(%L::uuid, %L)', v_newsletter_id, v_newsletter_hash));
  IF _distribution_text('service_role', v_service,
       'automation_record_channel_readback(''newsletter'', ''connected'', ''PROVIDER_READBACK_OK'', NULL)') <> 'true' THEN
    RAISE EXCEPTION 'Verified Resend readback was not recorded';
  END IF;
  v_email_claim := _distribution_text('service_role', v_service, format(
    'automation_claim_newsletter_test(%L::uuid, %L::uuid, %L)', v_owner->>'sub', v_newsletter_id, v_newsletter_hash))::jsonb;
  IF v_email_claim->>'ok' <> 'true' OR v_email_claim->>'already_sent' <> 'false'
     OR v_email_claim->'payload'->>'link' NOT LIKE '%utm_source=newsletter%'
     OR v_email_claim::text LIKE '%' || v_sentinel || '%' THEN
    RAISE EXCEPTION 'Newsletter test claim was not exact or included article prose';
  END IF;
  IF _distribution_text('service_role', v_service, format(
       'automation_complete_newsletter_test(%s, ''sent'', ''mock-resend-email-42'', NULL)', (v_email_claim->>'test_id')::bigint)) <> 'true' THEN
    RAISE EXCEPTION 'Safe Resend test receipt was not recorded';
  END IF;
  v_replay := _distribution_text('service_role', v_service, format(
    'automation_claim_newsletter_test(%L::uuid, %L::uuid, %L)', v_owner->>'sub', v_newsletter_id, v_newsletter_hash))::jsonb;
  IF v_replay->>'already_sent' <> 'true' OR v_replay->>'remote_email_id' <> 'mock-resend-email-42'
     OR (SELECT count(*) FROM distribution_test_log WHERE draft_id = v_newsletter_id) <> 1
     OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                 AND table_name = 'distribution_test_log' AND column_name IN ('email', 'recipient', 'recipient_email'))
     OR EXISTS (SELECT 1 FROM automation_logs WHERE event_code = 'DISTRIBUTION.EMAIL_TEST'
                 AND details::text LIKE '%owner@example.com%') THEN
    RAISE EXCEPTION 'Newsletter test replay was not safe or stored recipient PII';
  END IF;
  -- Count attempts rather than only accepted emails; an ambiguous provider timeout
  -- cannot be replayed into duplicate mail. Three is the daily Lagos owner-test cap.
  INSERT INTO distribution_test_log (draft_id, payload_sha256, actor_id, status)
  VALUES (v_newsletter_id, repeat('b', 64), (v_owner->>'sub')::uuid, 'dispatching'),
         (v_newsletter_id, repeat('c', 64), (v_owner->>'sub')::uuid, 'dispatching');
  -- Mirror the two ambiguous attempts in the atomic daily counter used by the cap.
  INSERT INTO automation_channel_usage_daily (channel_key, usage_day, owner_test_email_attempts)
  VALUES ('newsletter', (now() AT TIME ZONE 'Africa/Lagos')::date, 2)
  ON CONFLICT (channel_key, usage_day) DO UPDATE SET
    owner_test_email_attempts = automation_channel_usage_daily.owner_test_email_attempts + 2,
    updated_at = now();
  IF (SELECT owner_test_email_attempts FROM automation_channel_usage_daily
       WHERE channel_key = 'newsletter' AND usage_day = (now() AT TIME ZONE 'Africa/Lagos')::date) <> 3 THEN
    RAISE EXCEPTION 'Newsletter daily counter did not match the simulated attempts';
  END IF;
  PERFORM _distribution_text('authenticated', v_owner,
    format('automation_prepare_daily_kit(%L::uuid)', v_post_two));
  SELECT id, payload_sha256 INTO v_newsletter_id, v_newsletter_hash
    FROM automation_distribution_drafts WHERE post_id = v_post_two AND channel_key = 'newsletter';
  PERFORM _distribution_text('authenticated', v_owner,
    format('automation_approve_distribution_draft(%L::uuid, %L)', v_newsletter_id, v_newsletter_hash));
  v_email_claim := _distribution_text('service_role', v_service, format(
    'automation_claim_newsletter_test(%L::uuid, %L::uuid, %L)', v_owner->>'sub', v_newsletter_id, v_newsletter_hash))::jsonb;
  IF v_email_claim->>'ok' <> 'false' OR v_email_claim->>'safe_error_code' <> 'PROVIDER_QUOTA' THEN
    RAISE EXCEPTION 'Newsletter test emails exceeded the owner-only daily safety cap';
  END IF;

  -- Pause/resume is owner-only, reversible, and never removes approval or freshness.
  PERFORM _distribution_text('authenticated', v_owner, 'automation_set_distribution_pause(''telegram'', true)');
  IF (SELECT state FROM automation_distribution_channels WHERE channel_key = 'telegram') <> 'paused'
     OR NOT _distribution_raises('service_role', v_service, format(
       'SELECT automation_claim_distribution_delivery(%L::uuid, %L::uuid, %L)', v_owner->>'sub', v_draft_id, v_hash)) THEN
    RAISE EXCEPTION 'A paused channel could be claimed for delivery';
  END IF;
  PERFORM _distribution_text('authenticated', v_owner, 'automation_set_distribution_pause(''telegram'', false)');
  IF (SELECT state FROM automation_distribution_channels WHERE channel_key = 'telegram') <> 'approval_required' THEN
    RAISE EXCEPTION 'Resuming a recently verified channel did not retain the approval-required state';
  END IF;

  -- An approved checksum cannot dispatch until both global switches are on.
  IF NOT _distribution_raises('service_role', v_service, format(
       'SELECT automation_claim_distribution_delivery(%L::uuid, %L::uuid, %L)', v_owner->>'sub', v_draft_id, v_hash)) THEN
    RAISE EXCEPTION 'Telegram dispatch bypassed the default-off master/distribution switches';
  END IF;
  PERFORM _distribution_text('authenticated', v_owner, 'automation_set_feature_flag(''automation.enabled'', true)');
  PERFORM _distribution_text('authenticated', v_owner, 'automation_set_feature_flag(''automation.distribution'', true)');

  v_claim := _distribution_text('service_role', v_service, format(
    'automation_claim_distribution_delivery(%L::uuid, %L::uuid, %L)', v_owner->>'sub', v_draft_id, v_hash))::jsonb;
  IF v_claim->>'ok' <> 'true' OR v_claim->>'channel_key' <> 'telegram'
     OR v_claim->>'payload_sha256' <> v_hash OR v_claim->'payload'->>'link' <> v_payload->>'link'
     OR v_claim::text LIKE '%' || v_sentinel || '%' THEN
    RAISE EXCEPTION 'A checksum-approved dispatch claim was not safe or exact';
  END IF;
  IF _distribution_text('service_role', v_service, format(
       'automation_complete_distribution_delivery(%s, ''sent'', ''mock-telegram-message-42'', NULL)', (v_claim->>'log_id')::bigint)) <> 'true' THEN
    RAISE EXCEPTION 'A safe provider receipt was not recorded';
  END IF;
  IF (SELECT review_status FROM automation_distribution_drafts WHERE id = v_draft_id) <> 'sent'
     OR (SELECT status FROM distribution_log WHERE post_id = v_post AND channel_key = 'telegram') <> 'sent'
     OR (SELECT remote_post_id FROM distribution_log WHERE post_id = v_post AND channel_key = 'telegram') <> 'mock-telegram-message-42'
     OR (SELECT safe_error_code FROM distribution_log WHERE post_id = v_post AND channel_key = 'telegram') IS NOT NULL THEN
    RAISE EXCEPTION 'The provider receipt did not complete the approved item';
  END IF;
  v_replay := _distribution_text('service_role', v_service, format(
    'automation_claim_distribution_delivery(%L::uuid, %L::uuid, %L)', v_owner->>'sub', v_draft_id, v_hash))::jsonb;
  IF v_replay->>'already_sent' <> 'true' OR v_replay->>'remote_post_id' <> 'mock-telegram-message-42'
     OR (SELECT count(*) FROM distribution_log WHERE post_id = v_post AND channel_key = 'telegram' AND status = 'sent') <> 1 THEN
    RAISE EXCEPTION 'A replay was not idempotently answered with the existing receipt';
  END IF;

  -- A completed delivery counts against the current Lagos day even when the
  -- original approval/creation happened earlier; a repeat cannot exceed the cap.
  UPDATE distribution_log SET created_at = now() - interval '2 days'
   WHERE post_id = v_post AND channel_key = 'telegram' AND status = 'sent';
  UPDATE automation_distribution_channels SET daily_free_quota = 1, quota_remaining = 1
   WHERE channel_key = 'telegram';
  v_snapshot := _distribution_text('authenticated', v_owner,
    format('automation_distribution_snapshot(%L::uuid)', v_post))::jsonb;
  IF (SELECT (c->>'quota_remaining')::integer FROM jsonb_array_elements(v_snapshot->'channels') c
       WHERE c->>'channel_key' = 'telegram') <> 0 THEN
    RAISE EXCEPTION 'The displayed Telegram safety cap did not use completed_at in Lagos time';
  END IF;

  SELECT automation_prepare_daily_kit(v_post_two) INTO v_snapshot;
  SELECT id, payload_sha256 INTO v_draft_id, v_hash FROM automation_distribution_drafts
   WHERE post_id = v_post_two AND channel_key = 'telegram';
  PERFORM _distribution_text('authenticated', v_owner,
    format('automation_approve_distribution_draft(%L::uuid, %L)', v_draft_id, v_hash));
  v_claim := _distribution_text('service_role', v_service, format(
    'automation_claim_distribution_delivery(%L::uuid, %L::uuid, %L)', v_owner->>'sub', v_draft_id, v_hash))::jsonb;
  IF v_claim->>'ok' <> 'false' OR v_claim->>'safe_error_code' <> 'PROVIDER_QUOTA'
     OR (SELECT state FROM automation_distribution_channels WHERE channel_key = 'telegram') <> 'quota_exhausted'
     OR (SELECT quota_remaining FROM automation_distribution_channels WHERE channel_key = 'telegram') <> 0
     OR (SELECT status FROM distribution_log WHERE post_id = v_post_two AND channel_key = 'telegram') <> 'approved'
     OR NOT EXISTS (SELECT 1 FROM automation_logs WHERE event_code = 'DISTRIBUTION.CIRCUIT'
       AND entity_type = 'distribution_draft' AND entity_id = v_draft_id AND details->>'channel' = 'telegram') THEN
    RAISE EXCEPTION 'The daily safety cap did not stop additional Telegram delivery safely';
  END IF;

  PERFORM _distribution_text('authenticated', v_owner, 'automation_set_feature_flag(''automation.distribution'', false)');
  PERFORM _distribution_text('authenticated', v_owner, 'automation_set_feature_flag(''automation.enabled'', false)');
  IF (SELECT bool_or(enabled) FROM feature_flags WHERE flag_key IN ('automation.enabled', 'automation.distribution')) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'The distribution test did not restore feature switches to off';
  END IF;
  IF (SELECT content FROM posts WHERE id = v_post) IS DISTINCT FROM v_sentinel
     OR (SELECT content FROM posts WHERE id = v_post_two) IS DISTINCT FROM 'Second owner-written body stays private.'
     OR EXISTS (SELECT 1 FROM distribution_log WHERE post_id IN (v_post, v_post_two)
                 AND (approved_payload_sha256 IS NULL OR approved_payload_sha256 !~ '^[a-f0-9]{64}$'))
     OR EXISTS (SELECT 1 FROM automation_logs WHERE event_code = 'DISTRIBUTION.DELIVERY'
                 AND details::text LIKE '%' || v_sentinel || '%') THEN
    RAISE EXCEPTION 'Article prose, payload checksum or safe delivery logging invariant failed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM admin_activity_log WHERE entity_type IN (
       'automation_distribution_channels', 'automation_distribution_drafts', 'ab_test_variants', 'distribution_test_log'
     ) AND action IN ('insert', 'update')) THEN
    RAISE EXCEPTION 'Owner distribution/variant mutations were not audit-logged';
  END IF;
END $$;

DROP FUNCTION IF EXISTS _distribution_text(text, jsonb, text);
DROP FUNCTION IF EXISTS _distribution_action(text, jsonb, text);
DROP FUNCTION IF EXISTS _distribution_raises(text, jsonb, text);
DROP FUNCTION IF EXISTS _distribution_count(text, jsonb, text);
