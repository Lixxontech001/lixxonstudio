-- M7 assertions: Admin AI is approval-gated and anonymous engagement mutations are
-- fingerprint-scoped RPCs rather than world-writable PostgREST policies.
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION _security_ai_raises(role_name text, claims jsonb, stmt text)
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

INSERT INTO comments (id, post_id, author_name, author_email, content, is_approved, is_visible)
VALUES ('70000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', 'Reader', 'reader@example.com', 'This was helpful, thank you.', false, true)
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
  anon jsonb := '{"role":"anon"}';
  editor jsonb := '{"role":"authenticated","sub":"00000000-0000-0000-0000-0000000000c3","email":"editor@example.com"}';
  owner jsonb := '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000001","email":"owner@lixxonstudio.com"}';
  before_count bigint;
  after_count bigint;
  run jsonb;
  suggestion uuid;
BEGIN
  -- The named legacy mutation policies must stay gone.
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE policyname IN (
       'abandoned_carts_anon_update', 'article_likes_anon_delete', 'article_reactions_anon_delete',
       'comment_likes_anon_delete', 'rli_anon_delete', 'article_ratings_anon_update',
       'review_helpfulness_anon_update', 'reading_lists_delete', 'reading_lists_write',
       'rl_reading_lists_delete', 'rl_reading_lists_update'
     ) AND cmd IN ('UPDATE', 'DELETE')
  ) THEN RAISE EXCEPTION 'legacy anonymous mutation policy survived'; END IF;

  -- Direct anonymous DELETE does not remove an arbitrary engagement row.
  INSERT INTO article_likes (post_id, fingerprint)
    VALUES ('60000000-0000-0000-0000-000000000001', 'fp_security_12345') ON CONFLICT DO NOTHING;
  SELECT count(*) INTO before_count FROM article_likes WHERE fingerprint = 'fp_security_12345';
  PERFORM set_config('request.jwt.claims', anon::text, true);
  SET LOCAL ROLE anon;
  DELETE FROM article_likes WHERE fingerprint = 'fp_security_12345';
  RESET ROLE;
  SELECT count(*) INTO after_count FROM article_likes WHERE fingerprint = 'fp_security_12345';
  IF after_count <> before_count THEN RAISE EXCEPTION 'anon direct engagement delete still worked'; END IF;

  -- The supported RPC can remove the caller's fingerprint row and can add it again.
  PERFORM set_config('request.jwt.claims', anon::text, true);
  SET LOCAL ROLE anon;
  PERFORM toggle_article_like('60000000-0000-0000-0000-000000000001', 'fp_security_12345', false);
  PERFORM toggle_article_like('60000000-0000-0000-0000-000000000001', 'fp_security_12345', true);
  RESET ROLE;
  IF NOT EXISTS (SELECT 1 FROM article_likes WHERE fingerprint = 'fp_security_12345') THEN RAISE EXCEPTION 'engagement RPC did not restore the row'; END IF;

  -- AI scan is not an anonymous or editor privilege.
  IF NOT _security_ai_raises('anon', anon, 'SELECT admin_ai_scan()') THEN RAISE EXCEPTION 'anon could scan Admin AI'; END IF;
  IF NOT _security_ai_raises('authenticated', editor, 'SELECT admin_ai_scan()') THEN RAISE EXCEPTION 'editor could scan Admin AI'; END IF;

  PERFORM set_config('request.jwt.claims', owner::text, true);
  PERFORM set_config('request.jwt.claim.sub', owner->>'sub', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  -- Database-controlled head HTML is sanitized before it can reach the storefront.
  PERFORM admin_set_setting('custom_head', jsonb_build_object('html', '<script>alert(1)</script><iframe src="x"></iframe><meta onerror="alert(2)" href="javascript:bad">'), true);
  IF EXISTS (SELECT 1 FROM site_settings WHERE key = 'custom_head' AND value ->> 'html' ~* '<(script|iframe)|on[a-z]+[[:space:]]*=|javascript:')
    THEN RAISE EXCEPTION 'custom head sanitizer left an executable surface'; END IF;
  PERFORM admin_reset_setting('custom_head');

  SELECT admin_ai_scan() INTO run;
  IF run ->> 'run_id' IS NULL THEN RAISE EXCEPTION 'owner scan did not return a run'; END IF;
  SELECT admin_ai_queue_workflow('60000000-0000-0000-0000-000000000001', 'approve', 'AI review') INTO suggestion;
  IF suggestion IS NULL THEN RAISE EXCEPTION 'workflow proposal was not queued'; END IF;
  IF NOT admin_ai_dismiss(suggestion) THEN RAISE EXCEPTION 'owner could not dismiss a proposal'; END IF;
END $$;

DROP FUNCTION _security_ai_raises(text, jsonb, text);
