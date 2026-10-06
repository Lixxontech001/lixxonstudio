-- Phase 2.1 assertions: owner-authored intake metadata, least privilege,
-- byte-for-byte prose preservation, Lagos day caps, and reversible rejection.
\set ON_ERROR_STOP on

INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-0000000000d4', 'intake-reader@example.com'),
  ('00000000-0000-0000-0000-0000000000e5', 'intake-writer@example.com')
ON CONFLICT DO NOTHING;
INSERT INTO app_admins (user_id, role, display_name) VALUES
  ('00000000-0000-0000-0000-0000000000d4', 'analyst', 'Intake read-only analyst'),
  ('00000000-0000-0000-0000-0000000000e5', 'editor', 'Intake writer')
ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role, status = 'active';

INSERT INTO posts (id, title, slug, status, content, published_at) VALUES
  ('71000000-0000-0000-0000-000000000001', 'Intake first', 'intake-first-fixture', 'draft', 'One two three.', now()),
  ('71000000-0000-0000-0000-000000000002', 'Intake second', 'intake-second-fixture', 'draft', 'Four five six.', now()),
  ('71000000-0000-0000-0000-000000000003', 'Intake third', 'intake-third-fixture', 'draft', 'Seven eight nine.', now()),
  ('71000000-0000-0000-0000-000000000004', 'Scheduled first', 'intake-scheduled-first', 'draft', 'Ten eleven twelve.', now()),
  ('71000000-0000-0000-0000-000000000005', 'Scheduled second', 'intake-scheduled-second', 'draft', 'Thirteen fourteen fifteen.', now()),
  ('71000000-0000-0000-0000-000000000006', 'Scheduled third', 'intake-scheduled-third', 'draft', 'Sixteen seventeen eighteen.', now())
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION _article_intake_raises(role_name text, claims jsonb, stmt text)
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

CREATE OR REPLACE FUNCTION _article_intake_count(role_name text, claims jsonb, statement text)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  EXECUTE format('SET LOCAL ROLE %I', role_name);
  PERFORM set_config('request.jwt.claims', claims::text, true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(claims->>'sub', ''), true);
  PERFORM set_config('request.jwt.claim.role', COALESCE(claims->>'role', role_name), true);
  EXECUTE 'SELECT count(*) FROM (' || statement || ') q' INTO n;
  RESET ROLE;
  RETURN n;
END $$;

DO $$
DECLARE
  v_editor jsonb := jsonb_build_object('sub', '00000000-0000-0000-0000-0000000000e5', 'role', 'authenticated');
  v_analyst jsonb := jsonb_build_object('sub', '00000000-0000-0000-0000-0000000000d4', 'role', 'authenticated');
  v_reader jsonb := jsonb_build_object('sub', '00000000-0000-0000-0000-0000000000b2', 'role', 'authenticated');
  v_anon jsonb := jsonb_build_object('role', 'anon');
  v_day date := ((now() AT TIME ZONE 'Africa/Lagos')::date + 3);
  v_other_day date := ((now() AT TIME ZONE 'Africa/Lagos')::date + 4);
  v_when timestamptz;
  v_other_when timestamptz;
  v_result jsonb;
  v_source_sha text := repeat('a', 64);
  v_used integer;
  v_before_content text;
  fn record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public.article_intake_items'::regclass AND relrowsecurity) THEN
    RAISE EXCEPTION 'article_intake_items does not have RLS enabled';
  END IF;
  IF has_table_privilege('anon', 'public.article_intake_items', 'SELECT')
     OR has_table_privilege('authenticated', 'public.article_intake_items', 'INSERT')
     OR has_table_privilege('authenticated', 'public.article_intake_items', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.article_intake_items', 'DELETE')
     OR has_table_privilege('service_role', 'public.article_intake_items', 'SELECT') THEN
    RAISE EXCEPTION 'Article intake metadata has an unintended direct table grant';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.article_intake_items', 'SELECT') THEN
    RAISE EXCEPTION 'Authenticated editorial readers cannot view intake metadata';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'article_intake_items'
       AND column_name IN ('content', 'article_text', 'body', 'excerpt', 'prose')
  ) THEN RAISE EXCEPTION 'Article intake metadata duplicated owner-authored prose'; END IF;

  FOR fn IN
    SELECT p.proname, p.prosecdef, p.proconfig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname IN (
       'article_intake_lagos_slot_usage', 'article_intake_slot_check', 'article_intake_save',
       'article_intake_reject', 'article_intake_reopen', 'article_guard_daily_schedule_capacity'
     )
  LOOP
    IF fn.prosecdef IS NOT TRUE THEN RAISE EXCEPTION '% is not SECURITY DEFINER', fn.proname; END IF;
    IF position('search_path=public, pg_temp' IN COALESCE(array_to_string(fn.proconfig, ','), '')) = 0 THEN
      RAISE EXCEPTION '% does not pin search_path to public, pg_temp', fn.proname;
    END IF;
  END LOOP;
  IF has_function_privilege('anon', 'public.article_intake_slot_check(timestamptz,uuid)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.article_intake_save(uuid,text,text,integer,timestamptz)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.article_intake_reject(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.article_intake_save(uuid,text,text,integer,timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Article intake RPC grants are too broad or unavailable to authenticated editors';
  END IF;
  IF NOT _article_intake_raises('authenticated', v_analyst, $q$SELECT article_intake_save('71000000-0000-0000-0000-000000000001', 'a.docx', repeat('a',64), 3, now()+interval '3 days')$q$)
     OR NOT _article_intake_raises('anon', v_anon, $q$SELECT article_intake_slot_check(now()+interval '3 days', NULL)$q$) THEN
    RAISE EXCEPTION 'A non-writer or anonymous caller could access a protected article intake RPC';
  END IF;
  IF _article_intake_count('authenticated', v_anon, $q$SELECT post_id FROM article_intake_items$q$) <> 0
     OR _article_intake_count('authenticated', v_analyst, $q$SELECT post_id FROM article_intake_items$q$) <> 0 THEN
    RAISE EXCEPTION 'A cross-user/non-authorized caller read private intake metadata';
  END IF;

  v_when := ((v_day + time '09:00') AT TIME ZONE 'Africa/Lagos');
  v_other_when := ((v_other_day + time '09:00') AT TIME ZONE 'Africa/Lagos');
  v_before_content := (SELECT content FROM posts WHERE id = '71000000-0000-0000-0000-000000000001');
  PERFORM set_config('request.jwt.claims', v_editor::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_editor->>'sub', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  SELECT article_intake_save('71000000-0000-0000-0000-000000000001', 'first.docx', v_source_sha, 3, v_when) INTO v_result;
  IF v_result->>'intake_status' <> 'queued' OR v_result->>'word_count' <> '3' THEN
    RAISE EXCEPTION 'Owner/editor could not save article intake metadata';
  END IF;
  IF _article_intake_count('authenticated', v_reader, $q$SELECT post_id FROM article_intake_items$q$) <> 0
     OR _article_intake_count('authenticated', v_editor, $q$SELECT post_id FROM article_intake_items$q$) <> 1 THEN
    RAISE EXCEPTION 'RLS did not isolate intake metadata from a non-admin reader';
  END IF;
  IF (SELECT content FROM posts WHERE id = '71000000-0000-0000-0000-000000000001') IS DISTINCT FROM v_before_content THEN
    RAISE EXCEPTION 'Intake registration changed posts.content';
  END IF;
  IF NOT _article_intake_raises('authenticated', v_editor,
       $q$UPDATE posts SET status='scheduled', scheduled_at=now()+interval '10 days', published_at=now()+interval '10 days' WHERE id='71000000-0000-0000-0000-000000000001'$q$) THEN
    RAISE EXCEPTION 'The scheduler allowed an intake article to bypass required owner metadata';
  END IF;
  UPDATE posts SET content = 'One two three four.' WHERE id = '71000000-0000-0000-0000-000000000001';
  PERFORM article_intake_save('71000000-0000-0000-0000-000000000001', 'first.docx', v_source_sha, 3, v_when);
  IF (SELECT word_count FROM article_intake_items WHERE post_id = '71000000-0000-0000-0000-000000000001') <> 4 THEN
    RAISE EXCEPTION 'An owner-edited article did not refresh its server-measured word count';
  END IF;
  IF NOT _article_intake_raises('authenticated', v_editor,
       $q$SELECT article_intake_save('71000000-0000-0000-0000-000000000001', 'first-replacement.docx', repeat('d',64), 3, now()+interval '3 days')$q$) THEN
    RAISE EXCEPTION 'A new DOCX source was registered with a mismatched word count';
  END IF;
  SELECT article_intake_save('71000000-0000-0000-0000-000000000002', 'second.docx', repeat('b',64), 3, v_when) INTO v_result;
  IF (article_intake_slot_check(v_when, NULL)->>'used')::integer <> 2
     OR (article_intake_slot_check(v_when, NULL)->>'remaining')::integer <> 0 THEN
    RAISE EXCEPTION 'Two active Lagos-day queue items were not counted';
  END IF;
  IF NOT _article_intake_raises('authenticated', v_editor,
       $q$SELECT article_intake_save('71000000-0000-0000-0000-000000000003', 'third.docx', repeat('c',64), 3, now()+interval '3 days')$q$) THEN
    RAISE EXCEPTION 'The two-per-day intake cap allowed a third article';
  END IF;
  IF EXISTS (SELECT 1 FROM article_intake_items WHERE post_id = '71000000-0000-0000-0000-000000000003') THEN
    RAISE EXCEPTION 'A rejected capacity reservation partially wrote intake metadata';
  END IF;

  PERFORM article_intake_reject('71000000-0000-0000-0000-000000000002');
  IF (article_intake_slot_check(v_when, NULL)->>'used')::integer <> 1 THEN
    RAISE EXCEPTION 'Rejecting a queued item did not release its proposed day';
  END IF;
  PERFORM article_intake_save('71000000-0000-0000-0000-000000000003', 'third.docx', repeat('c',64), 3, v_when);
  PERFORM article_intake_reject('71000000-0000-0000-0000-000000000003');
  PERFORM article_intake_reopen('71000000-0000-0000-0000-000000000002');
  IF NOT _article_intake_raises('authenticated', v_editor,
       $q$SELECT article_intake_reopen('71000000-0000-0000-0000-000000000003')$q$) THEN
    RAISE EXCEPTION 'Reopening a rejected item bypassed the two-per-day limit';
  END IF;

  -- The live scheduler/editor path enforces the same two-per-day limit, not just
  -- the UI's proposal validation. All post text remains unchanged.
  UPDATE posts SET status = 'scheduled', scheduled_at = v_other_when, published_at = v_other_when
   WHERE id = '71000000-0000-0000-0000-000000000004';
  UPDATE posts SET status = 'scheduled', scheduled_at = v_other_when + interval '2 hours', published_at = v_other_when + interval '2 hours'
   WHERE id = '71000000-0000-0000-0000-000000000005';
  IF NOT _article_intake_raises('authenticated', v_editor,
       $q$UPDATE posts SET status='scheduled', scheduled_at=now()+interval '4 days', published_at=now()+interval '4 days' WHERE id='71000000-0000-0000-0000-000000000006'$q$) THEN
    RAISE EXCEPTION 'The post scheduling trigger allowed a third article on the same Lagos day';
  END IF;
  IF _article_intake_count('authenticated', v_editor, $q$SELECT id FROM posts WHERE id IN ('71000000-0000-0000-0000-000000000004','71000000-0000-0000-0000-000000000005') AND status='scheduled'$q$) <> 2 THEN
    RAISE EXCEPTION 'Allowed scheduled articles were not persisted';
  END IF;
  IF (SELECT content FROM posts WHERE id = '71000000-0000-0000-0000-000000000004') <> 'Ten eleven twelve.' THEN
    RAISE EXCEPTION 'Scheduling changed posts.content';
  END IF;

  UPDATE posts SET status = 'draft', scheduled_at = NULL WHERE id IN (
    '71000000-0000-0000-0000-000000000004', '71000000-0000-0000-0000-000000000005'
  );
  IF (SELECT count(*) FROM admin_activity_log WHERE entity_type = 'article_intake_items'
        AND action IN ('insert', 'update')) = 0 THEN
    RAISE EXCEPTION 'Article intake metadata changes were not included in the admin audit trail';
  END IF;
END $$;

DROP FUNCTION IF EXISTS _article_intake_raises(text, jsonb, text);
DROP FUNCTION IF EXISTS _article_intake_count(text, jsonb, text);
