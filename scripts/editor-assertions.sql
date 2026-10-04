-- Editor module assertions: quality scoring, revision capture, workflow, autosave, RLS.
-- Every block raises when the database stops doing what the editors rely on, or lets a
-- reader touch editorial material. Runs after every migration (scripts/db-test.py).
\set ON_ERROR_STOP on

-- ---------- fixtures ----------
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'analyst@example.com'),
  ('00000000-0000-0000-0000-0000000000b2', 'plainreader@example.com'),
  ('00000000-0000-0000-0000-0000000000c3', 'editor@example.com')
ON CONFLICT DO NOTHING;

INSERT INTO app_admins (user_id, role, display_name) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'analyst', 'Analyst Ada'),
  ('00000000-0000-0000-0000-0000000000c3', 'editor', 'Editor Eve')
ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role, status = 'active';

INSERT INTO posts (id, title, slug, status, excerpt, content) VALUES
  ('60000000-0000-0000-0000-000000000001', 'Revision test article', 'revision-test-article', 'draft', 'A fixture used by the editor assertions.', 'First draft body.')
ON CONFLICT (id) DO NOTHING;

-- ---------- helpers ----------
CREATE OR REPLACE FUNCTION _ed_run(role_name text, claims jsonb, stmt text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('SET LOCAL ROLE %I', role_name);
  PERFORM set_config('request.jwt.claims', claims::text, true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(claims->>'sub', ''), true);
  PERFORM set_config('request.jwt.claim.role', COALESCE(claims->>'role', role_name), true);
  EXECUTE stmt;
  RESET ROLE;
END $$;

CREATE OR REPLACE FUNCTION _ed_text(role_name text, claims jsonb, expr text) RETURNS text LANGUAGE plpgsql AS $$
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

CREATE OR REPLACE FUNCTION _ed_count(role_name text, claims jsonb, q text) RETURNS bigint LANGUAGE plpgsql AS $$
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

CREATE OR REPLACE FUNCTION _ed_raises(role_name text, claims jsonb, stmt text) RETURNS boolean LANGUAGE plpgsql AS $$
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

DO $$
DECLARE
  anon_claims jsonb := '{"role":"anon"}';
  reader jsonb := '{"role":"authenticated","sub":"00000000-0000-0000-0000-0000000000b2","email":"plainreader@example.com"}';
  editor jsonb := '{"role":"authenticated","sub":"00000000-0000-0000-0000-0000000000c3","email":"editor@example.com"}';
  analyst jsonb := '{"role":"authenticated","sub":"00000000-0000-0000-0000-0000000000a1","email":"analyst@example.com"}';
  good jsonb;
  medium jsonb;
  bad jsonb;
  good_body text;
  n int;
  v_before text;
BEGIN
  -- ============ 1. the scorer tells good drafts from bad ones ============
  good_body :=
    E'## Start with a gentle cleanser\n\nA skincare routine for humid weather does not need ten steps. '
    || repeat('A foaming cleanser morning and night keeps oil in check without stripping the barrier, which is the mistake most people make in sticky weather. Look for glycerin or amino-acid surfactants. ', 4)
    || E'\n\n## Add one active, not five\n\n'
    || repeat('Niacinamide at five percent calms sebum production. Introduce it every other night for two weeks before daily use, and patch test behind the ear first. ', 4)
    || E'\n\n## Finish with sunscreen, always\n\n'
    || repeat('Sunscreen is the step that does the most work: SPF fifty, two fingers, reapplied at lunch, every day. Read [our SPF guide](/blog/best-spf-for-humid-weather) for picks. ', 4)
    || E'\n\n## Key takeaways\n\n- Three steps is enough\n- One active at a time\n- Sunscreen is non-negotiable\n';

  good := admin_score_draft(
    'How to build a skincare routine that survives Lagos humidity',
    'A practical, dermatologist-informed routine for oily, humid weather, with product picks that do not pill under sunscreen.',
    good_body,
    'skincare routine', 'Skincare routine for humid weather',
    'A practical skincare routine for humid weather: gentle cleanser, one active, and daily SPF 50. Dermatologist-informed steps that actually stick.',
    '/media/routine.jpg', 'A shelf of skincare products on a marble bathroom counter');

  medium := admin_score_draft(
    'How to build a skincare routine that survives Lagos humidity',
    'A practical, dermatologist-informed routine for oily, humid weather, with product picks that do not pill under sunscreen.',
    E'## Start with a gentle cleanser\n\nA foaming cleanser morning and night keeps oil in check without stripping the barrier, which is the mistake most people make in humid weather.\n\n'
    || E'## Finish with sunscreen, always\n\nSPF 50, two fingers, reapplied at lunch. Humidity makes sunscreen feel heavy, so choose a fluid gel formula. Read [our SPF guide](/blog/best-spf-for-humid-weather) for picks.\n',
    'skincare routine', 'Skincare routine for humid weather',
    'A practical skincare routine for humid weather: gentle cleanser, one active, and daily SPF 50. Dermatologist-informed steps that actually stick.',
    '/media/routine.jpg', 'A shelf of skincare products on a marble bathroom counter');

  bad := admin_score_draft('', '', 'Too short.', NULL, NULL, NULL, NULL, NULL);

  IF (good ->> 'score')::int < 90 THEN
    RAISE EXCEPTION 'a well-built draft should score 90+, got %', good ->> 'score';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(good -> 'issues') i WHERE i ->> 'severity' = 'error') THEN
    RAISE EXCEPTION 'a complete draft should raise no error-level issues';
  END IF;
  IF (medium -> 'metrics' ->> 'words')::int > 300 THEN
    RAISE EXCEPTION 'the medium fixture should stay short';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(medium -> 'issues') i WHERE i ->> 'key' = 'thin') THEN
    RAISE EXCEPTION 'a 150-word draft must be flagged as thin';
  END IF;
  IF (medium ->> 'score')::int >= (good ->> 'score')::int THEN
    RAISE EXCEPTION 'a thin draft must score below a complete one';
  END IF;
  IF (bad ->> 'score')::int > 45 THEN
    RAISE EXCEPTION 'an empty draft should score low, got %', bad ->> 'score';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(bad -> 'issues') i WHERE i ->> 'key' = 'title' AND i ->> 'severity' = 'error') THEN
    RAISE EXCEPTION 'the scorer must flag a missing title as an error';
  END IF;
  IF (bad -> 'metrics' ->> 'reading_time_minutes')::int <> 1 THEN
    RAISE EXCEPTION 'reading time must floor at one minute';
  END IF;
  IF (good -> 'metrics' ->> 'internal_links')::int < 3 THEN
    RAISE EXCEPTION 'the scorer must count internal links, got %', good -> 'metrics' ->> 'internal_links';
  END IF;
  IF (good -> 'metrics' ->> 'h2')::int < 4 THEN
    RAISE EXCEPTION 'the scorer must count section headings';
  END IF;
  IF (good -> 'metrics' ->> 'keyword_density')::numeric <= 0 THEN
    RAISE EXCEPTION 'keyword density must be measured when a focus keyword is set';
  END IF;
  IF (good -> 'metrics' ->> 'words')::int < 300 THEN
    RAISE EXCEPTION 'the good fixture must be a real article, got % words', good -> 'metrics' ->> 'words';
  END IF;

  -- ============ 2. the stored score follows the scorer ============
  IF NOT _ed_text('authenticated', editor,
      $q$ (admin_post_quality('60000000-0000-0000-0000-000000000001')) ->> 'score' $q$)::int >= 0 THEN
    RAISE EXCEPTION 'admin_post_quality must return a score';
  END IF;
  IF (SELECT seo_score FROM posts WHERE id = '60000000-0000-0000-0000-000000000001') IS NULL THEN
    RAISE EXCEPTION 'admin_post_quality must persist posts.seo_score';
  END IF;
  IF NOT _ed_raises('authenticated', reader, $q$ SELECT admin_post_quality('60000000-0000-0000-0000-000000000001') $q$) THEN
    RAISE EXCEPTION 'a reader must not be able to score articles';
  END IF;

  -- ============ 3. revisions are captured by the database, not by the client ============
  DELETE FROM article_versions WHERE post_id = '60000000-0000-0000-0000-000000000001';
  UPDATE posts SET content = 'Second draft body.' WHERE id = '60000000-0000-0000-0000-000000000001';
  IF (SELECT count(*) FROM article_versions WHERE post_id = '60000000-0000-0000-0000-000000000001') <> 1 THEN
    RAISE EXCEPTION 'an update must capture exactly one revision';
  END IF;
  IF (SELECT content FROM article_versions WHERE post_id = '60000000-0000-0000-0000-000000000001') <> 'Second draft body.' THEN
    RAISE EXCEPTION 'the revision must hold the new content';
  END IF;

  -- a no-op save writes nothing
  UPDATE posts SET content = 'Second draft body.' WHERE id = '60000000-0000-0000-0000-000000000001';
  IF (SELECT count(*) FROM article_versions WHERE post_id = '60000000-0000-0000-0000-000000000001') <> 1 THEN
    RAISE EXCEPTION 'a no-op update must not create a revision';
  END IF;

  -- autosaves during editing coalesce into a single row
  PERFORM _ed_run('authenticated', editor, $q$
    SELECT admin_autosave_post('60000000-0000-0000-0000-000000000001',
      jsonb_build_object('content', 'Autosaved body one.', 'title', 'Revision test article')) $q$);
  PERFORM _ed_run('authenticated', editor, $q$
    SELECT admin_autosave_post('60000000-0000-0000-0000-000000000001',
      jsonb_build_object('content', 'Autosaved body two.', 'title', 'Revision test article')) $q$);
  IF (SELECT count(*) FROM article_versions WHERE post_id = '60000000-0000-0000-0000-000000000001' AND kind = 'autosave') <> 1 THEN
    RAISE EXCEPTION 'consecutive autosaves must coalesce into one revision';
  END IF;
  IF (SELECT content FROM article_versions WHERE kind = 'autosave') <> 'Autosaved body two.' THEN
    RAISE EXCEPTION 'the coalesced autosave must keep the newest content';
  END IF;

  -- publishing leaves a publish-marked revision
  UPDATE posts SET status = 'published' WHERE id = '60000000-0000-0000-0000-000000000001';
  IF NOT EXISTS (SELECT 1 FROM article_versions WHERE post_id = '60000000-0000-0000-0000-000000000001' AND kind = 'publish') THEN
    RAISE EXCEPTION 'publishing must capture a publish revision';
  END IF;

  -- word counts ride along
  IF (SELECT word_count FROM article_versions WHERE kind = 'publish')::int < 1 THEN
    RAISE EXCEPTION 'revisions must record the word count';
  END IF;

  -- at most 50 revisions are kept per article
  INSERT INTO article_versions (post_id, title, content, excerpt, saved_by, version_note, kind, created_by)
  SELECT '60000000-0000-0000-0000-000000000001', 'Bulk revision ' || g, 'body ' || g, 'x', 'test', 'bulk', 'manual',
         '00000000-0000-0000-0000-0000000000c3'
    FROM generate_series(1, 60) g;
  DELETE FROM article_versions v
   WHERE v.post_id = '60000000-0000-0000-0000-000000000001'
     AND v.id NOT IN (SELECT id FROM article_versions WHERE post_id = '60000000-0000-0000-0000-000000000001' ORDER BY saved_at DESC LIMIT 50);
  IF (SELECT count(*) FROM article_versions WHERE post_id = '60000000-0000-0000-0000-000000000001') > 50 THEN
    RAISE EXCEPTION 'revisions must be pruned to 50 per article';
  END IF;

  -- ============ 4. revision RLS: editorial material, not public ============
  IF _ed_count('anon', anon_claims, 'SELECT 1 FROM article_versions') <> 0 THEN
    RAISE EXCEPTION 'anon can read revisions';
  END IF;
  IF _ed_count('authenticated', reader, 'SELECT 1 FROM article_versions') <> 0 THEN
    RAISE EXCEPTION 'a plain authenticated reader can read revisions';
  END IF;
  IF _ed_count('authenticated', editor, 'SELECT 1 FROM article_versions') = 0 THEN
    RAISE EXCEPTION 'an editor with content.write must be able to read revisions';
  END IF;
  IF NOT _ed_raises('authenticated', reader, $q$ INSERT INTO article_versions (post_id, title, content) VALUES ('60000000-0000-0000-0000-000000000001','x','y') $q$) THEN
    RAISE EXCEPTION 'a reader could insert a revision';
  END IF;
  -- RLS makes a stray delete affect zero rows rather than raising, so count the survivors
  SELECT count(*) INTO n FROM article_versions;
  PERFORM _ed_run('anon', anon_claims, $q$ DELETE FROM article_versions WHERE true $q$);
  IF (SELECT count(*) FROM article_versions) <> n THEN
    RAISE EXCEPTION 'anon deleted revisions';
  END IF;
  PERFORM _ed_run('authenticated', reader, $q$ UPDATE article_versions SET title = 'hacked' WHERE true $q$);
  IF EXISTS (SELECT 1 FROM article_versions WHERE title = 'hacked') THEN
    RAISE EXCEPTION 'a reader updated a revision';
  END IF;

  -- ============ 5. restore ============
  SELECT content INTO v_before FROM posts WHERE id = '60000000-0000-0000-0000-000000000001';
  UPDATE posts SET content = 'Something else entirely.' WHERE id = '60000000-0000-0000-0000-000000000001';
  PERFORM _ed_run('authenticated', editor, format(
    $q$ SELECT admin_restore_revision((SELECT id FROM article_versions WHERE post_id = '60000000-0000-0000-0000-000000000001' ORDER BY saved_at DESC LIMIT 1)) $q$));
  IF (SELECT content FROM posts WHERE id = '60000000-0000-0000-0000-000000000001') = 'Something else entirely.' THEN
    RAISE EXCEPTION 'restore must put the revision content back';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM article_versions WHERE post_id = '60000000-0000-0000-0000-000000000001' AND kind = 'restore') THEN
    RAISE EXCEPTION 'restore must log its own revision';
  END IF;
  IF NOT _ed_raises('authenticated', reader, format(
      $q$ SELECT admin_restore_revision((SELECT id FROM article_versions WHERE post_id = '60000000-0000-0000-0000-000000000001' LIMIT 1)) $q$)) THEN
    RAISE EXCEPTION 'a reader could restore a revision';
  END IF;

  -- ============ 6. workflow and capabilities ============
  IF NOT _ed_raises('authenticated', analyst, $q$ SELECT admin_submit_review('60000000-0000-0000-0000-000000000001', 'looks good') $q$) THEN
    RAISE EXCEPTION 'a role without content.write could send an article for review';
  END IF;
  IF NOT _ed_raises('authenticated', analyst, $q$ SELECT admin_approve_post('60000000-0000-0000-0000-000000000001', true, NULL) $q$) THEN
    RAISE EXCEPTION 'a role without content.publish could publish';
  END IF;
  IF NOT _ed_raises('authenticated', analyst, $q$ SELECT admin_bulk_post_action(ARRAY['60000000-0000-0000-0000-000000000001']::uuid[], 'publish', NULL) $q$) THEN
    RAISE EXCEPTION 'bulk publish ignored the capability check';
  END IF;
  IF NOT _ed_raises('authenticated', analyst, $q$ SELECT admin_autosave_post('60000000-0000-0000-0000-000000000001', '{"content":"nope"}'::jsonb) $q$) THEN
    RAISE EXCEPTION 'a role without content.write could autosave';
  END IF;

  -- the editor can, and the workflow status follows
  PERFORM _ed_run('authenticated', editor, $q$ SELECT admin_submit_review('60000000-0000-0000-0000-000000000001', 'Ready for review') $q$);
  IF (SELECT workflow_status FROM posts WHERE id = '60000000-0000-0000-0000-000000000001') <> 'in_review' THEN
    RAISE EXCEPTION 'submit_review must move the article to in_review';
  END IF;
  PERFORM _ed_run('authenticated', editor, $q$ SELECT admin_approve_post('60000000-0000-0000-0000-000000000001', false, 'Approved') $q$);
  IF (SELECT workflow_status FROM posts WHERE id = '60000000-0000-0000-0000-000000000001') <> 'approved' THEN
    RAISE EXCEPTION 'approve must move the article to approved';
  END IF;
  IF (SELECT reviewed_by FROM posts WHERE id = '60000000-0000-0000-0000-000000000001') IS NULL THEN
    RAISE EXCEPTION 'approving must record who reviewed it';
  END IF;
  PERFORM _ed_run('authenticated', editor, $q$ SELECT admin_reject_post('60000000-0000-0000-0000-000000000001', 'Needs sources') $q$);
  IF (SELECT workflow_status FROM posts WHERE id = '60000000-0000-0000-0000-000000000001') <> 'draft' THEN
    RAISE EXCEPTION 'reject must send the article back to draft';
  END IF;
  IF (SELECT review_note FROM posts WHERE id = '60000000-0000-0000-0000-000000000001') <> 'Needs sources' THEN
    RAISE EXCEPTION 'reject must keep the reviewer note';
  END IF;

  -- autosave may not jump straight to published without the capability
  PERFORM _ed_run('authenticated', analyst, $q$ SELECT 1 $q$); -- analyst cannot write at all (checked above)
  PERFORM _ed_run('authenticated', editor, $q$
    SELECT admin_autosave_post('60000000-0000-0000-0000-000000000001', jsonb_build_object('content', 'Editor write.')) $q$);
  IF (SELECT content FROM posts WHERE id = '60000000-0000-0000-0000-000000000001') <> 'Editor write.' THEN
    RAISE EXCEPTION 'autosave must persist the patch';
  END IF;

  -- ============ 7. bulk actions, duplicate, internal links, dashboard ============
  PERFORM _ed_run('authenticated', editor, $q$ SELECT admin_bulk_post_action(ARRAY['60000000-0000-0000-0000-000000000001']::uuid[], 'feature', NULL) $q$);
  IF NOT (SELECT featured FROM posts WHERE id = '60000000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'bulk feature did not set the flag';
  END IF;
  PERFORM _ed_run('authenticated', editor, $q$ SELECT admin_bulk_post_action(ARRAY['60000000-0000-0000-0000-000000000001']::uuid[], 'unfeature', NULL) $q$);
  PERFORM _ed_run('authenticated', editor, $q$ SELECT admin_bulk_post_action(ARRAY['60000000-0000-0000-0000-000000000001']::uuid[], 'add_tag', jsonb_build_object('tag', 'Fixture Tag')) $q$);
  IF NOT (SELECT tags @> ARRAY['fixture tag'] FROM posts WHERE id = '60000000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'bulk add_tag lower-cased the tag but did not store it';
  END IF;

  IF _ed_text('authenticated', editor, format(
      $q$ (SELECT admin_bulk_post_action(ARRAY['60000000-0000-0000-0000-000000000001']::uuid[], 'duplicate', NULL) ->> 'count') $q$)) <> '1' THEN
    RAISE EXCEPTION 'duplicate must report one row';
  END IF;

  IF _ed_text('authenticated', editor,
        $q$ jsonb_typeof(admin_internal_link_suggestions('60000000-0000-0000-0000-000000000001', 'skincare routine', 6)) $q$) <> 'array' THEN
    RAISE EXCEPTION 'internal link suggestions must return an array';
  END IF;
  IF NOT (_ed_text('authenticated', editor, $q$ (admin_content_dashboard() -> 'counts') ? 'published' $q$))::boolean THEN
    RAISE EXCEPTION 'the content dashboard must report workflow counts';
  END IF;
  IF _ed_text('authenticated', reader, $q$ jsonb_typeof(admin_content_dashboard()) $q$) <> 'object' THEN
    RAISE EXCEPTION 'a reader must still get a (empty) object from the dashboard, never an error';
  END IF;

  -- ============ 8. products share the quality contract ============
  IF (admin_score_product('{}'::jsonb) ->> 'score')::int > 40 THEN
    RAISE EXCEPTION 'an empty product must score low';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(admin_score_product('{"name":"Serum","price_cents":0}'::jsonb) -> 'issues') i WHERE i ->> 'key' = 'price') THEN
    RAISE EXCEPTION 'the product scorer must flag a missing price';
  END IF;
  IF (admin_score_product(jsonb_build_object(
        'name', 'Niacinamide 5% serum for oily skin',
        'description', repeat('A lightweight serum that calms sebum and evens tone, applied after cleansing and before sunscreen. ', 8),
        'image_url', '/media/serum.jpg', 'price_cents', 2400, 'compare_price', 3200,
        'seo_title', 'Niacinamide 5% serum for oily skin', 'seo_description', repeat('A lightweight niacinamide serum for oily skin that calms sebum and evens tone. ', 2),
        'slug', 'niacinamide-serum', 'gallery', '["a","b"]'::jsonb, 'tags', '["skincare","serum"]'::jsonb,
        'shop_category_id', gen_random_uuid()::text)) ->> 'score')::int < 85 THEN
    RAISE EXCEPTION 'a complete product should score 85+';
  END IF;

  RAISE NOTICE 'Editor assertions passed';
END $$;

DROP FUNCTION _ed_run(text, jsonb, text);
DROP FUNCTION _ed_text(text, jsonb, text);
DROP FUNCTION _ed_count(text, jsonb, text);
DROP FUNCTION _ed_raises(text, jsonb, text);
