-- Community/social-proof assertions: active readers see only a count, never fingerprints.
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION _community_count(role_name text, claims jsonb, q text)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  EXECUTE format('SET LOCAL ROLE %I', role_name);
  PERFORM set_config('request.jwt.claims', claims::text, true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(claims->>'sub', ''), true);
  PERFORM set_config('request.jwt.claim.role', COALESCE(claims->>'role', role_name), true);
  EXECUTE 'SELECT count(*) FROM (' || q || ') s' INTO n;
  RESET ROLE;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION _community_blocked(role_name text, claims jsonb, stmt text)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
  EXECUTE format('SET LOCAL ROLE %I', role_name);
  PERFORM set_config('request.jwt.claims', claims::text, true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(claims->>'sub', ''), true);
  PERFORM set_config('request.jwt.claim.role', COALESCE(claims->>'role', role_name), true);
  BEGIN
    EXECUTE stmt;
    GET DIAGNOSTICS n = ROW_COUNT;
    RESET ROLE;
    RETURN n = 0;
  EXCEPTION WHEN insufficient_privilege OR check_violation OR others THEN
    RESET ROLE;
    RETURN true;
  END;
END $$;

DO $$
DECLARE
  v_post_id uuid;
  anon_claims jsonb := '{"role":"anon"}';
  reader_claims jsonb := '{"role":"authenticated","sub":"00000000-0000-0000-0000-0000000000b2","email":"bob@example.com"}';
  owner_claims jsonb := '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000001","email":"owner@lixxonstudio.com"}';
  n bigint;
  active_count integer;
  query_text text;
BEGIN
  SELECT id INTO v_post_id
  FROM posts
  WHERE status = 'published'
    AND (published_at IS NULL OR published_at <= now())
  ORDER BY id
  LIMIT 1;
  IF v_post_id IS NULL THEN
    RAISE EXCEPTION 'community fixture requires a published post';
  END IF;

  IF has_table_privilege('anon', 'public.article_active_readers', 'SELECT') THEN
    RAISE EXCEPTION 'anon has direct SELECT privilege on reader fingerprints';
  END IF;
  IF NOT has_function_privilege('anon', 'public.heartbeat_article_reader(uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon cannot call the aggregate heartbeat RPC';
  END IF;
  IF NOT _community_blocked('anon', anon_claims, 'SELECT fingerprint FROM public.article_active_readers') THEN
    RAISE EXCEPTION 'anon can read active-reader fingerprints';
  END IF;
  IF NOT _community_blocked('authenticated', reader_claims, 'SELECT fingerprint FROM public.article_active_readers') THEN
    RAISE EXCEPTION 'non-admin reader can read active-reader fingerprints';
  END IF;

  query_text := format(
    'SELECT public.heartbeat_article_reader(%L::uuid, %L::text) AS readers WHERE public.heartbeat_article_reader(%L::uuid, %L::text) = 1',
    v_post_id, 'fp_community_test_01', v_post_id, 'fp_community_test_01'
  );
  n := _community_count('anon', anon_claims, query_text);
  IF n <> 1 THEN RAISE EXCEPTION 'first public heartbeat should return one active reader'; END IF;

  query_text := format(
    'SELECT public.heartbeat_article_reader(%L::uuid, %L::text) AS readers WHERE public.heartbeat_article_reader(%L::uuid, %L::text) = 2',
    v_post_id, 'fp_community_test_02', v_post_id, 'fp_community_test_02'
  );
  n := _community_count('anon', anon_claims, query_text);
  IF n <> 1 THEN RAISE EXCEPTION 'second fingerprint should raise the aggregate count to two'; END IF;

  query_text := format(
    'SELECT public.heartbeat_article_reader(%L::uuid, %L::text) AS readers WHERE public.heartbeat_article_reader(%L::uuid, %L::text) = 2',
    v_post_id, 'fp_community_test_01', v_post_id, 'fp_community_test_01'
  );
  n := _community_count('anon', anon_claims, query_text);
  IF n <> 1 THEN RAISE EXCEPTION 'repeat heartbeat should not double-count one reader'; END IF;

  IF _community_count('authenticated', owner_claims,
    format('SELECT 1 FROM public.article_active_readers WHERE post_id = %L::uuid', v_post_id)) <> 2 THEN
    RAISE EXCEPTION 'admin-only reader inspection policy stopped working';
  END IF;

  INSERT INTO public.article_active_readers (post_id, fingerprint, last_heartbeat)
  VALUES (v_post_id, 'fp_community_stale_01', now() - interval '2 days');
  active_count := public.heartbeat_article_reader(v_post_id, 'fp_community_test_03');
  IF active_count <> 3 THEN RAISE EXCEPTION 'heartbeat did not prune stale presence rows'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.article_active_readers AS active
    WHERE active.post_id = v_post_id AND active.fingerprint = 'fp_community_stale_01'
  ) THEN
    RAISE EXCEPTION 'stale reader row was not deleted';
  END IF;

  IF public.heartbeat_article_reader(v_post_id, 'bad token') <> 0 THEN
    RAISE EXCEPTION 'malformed fingerprint should not create presence';
  END IF;
END $$;

DROP FUNCTION _community_count(text, jsonb, text);
DROP FUNCTION _community_blocked(text, jsonb, text);
