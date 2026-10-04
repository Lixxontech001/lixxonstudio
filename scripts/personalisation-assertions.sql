-- Batch 3 security and behaviour assertions. Test fixtures are deliberately isolated
-- by UUID/fingerprint; assertions use existence/property checks, not production seed counts.
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION _p_assert(ok boolean, message text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'personalisation assertion failed: %', message; END IF;
END $$;

CREATE OR REPLACE FUNCTION _p_count(role_name text, claims jsonb, q text)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  EXECUTE format('SET LOCAL ROLE %I', role_name);
  PERFORM set_config('request.jwt.claims', claims::text, true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(claims->>'sub',''), true);
  PERFORM set_config('request.jwt.claim.role', COALESCE(claims->>'role', role_name), true);
  EXECUTE 'SELECT count(*) FROM (' || q || ') s' INTO n;
  RESET ROLE;
  RETURN n;
EXCEPTION WHEN insufficient_privilege THEN
  RESET ROLE;
  RETURN -1;
END $$;

CREATE OR REPLACE FUNCTION _p_blocked(role_name text, claims jsonb, stmt text)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
  EXECUTE format('SET LOCAL ROLE %I', role_name);
  PERFORM set_config('request.jwt.claims', claims::text, true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(claims->>'sub',''), true);
  PERFORM set_config('request.jwt.claim.role', COALESCE(claims->>'role', role_name), true);
  BEGIN
    EXECUTE stmt;
    GET DIAGNOSTICS n = ROW_COUNT;
    RESET ROLE;
    RETURN n = 0;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    RETURN true;
  END;
END $$;

INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-0000000000c3', 'batch3-reader@example.com')
ON CONFLICT DO NOTHING;
INSERT INTO categories (id, name, slug) VALUES
  ('30000000-0000-0000-0000-000000000001', 'Batch Three Skincare', 'batch-three-skincare'),
  ('30000000-0000-0000-0000-000000000002', 'Batch Three Style', 'batch-three-style')
ON CONFLICT (id) DO NOTHING;
INSERT INTO posts
  (id, title, slug, excerpt, cover_image, category_id, author_id, published_at,
   reading_time_minutes, featured, editors_pick, tags, status)
VALUES
  ('30000000-0000-0000-0000-000000001001', 'Batch 3 Signal Article', 'batch-3-signal-article', 'Signal excerpt', NULL,
   '30000000-0000-0000-0000-000000000001', NULL, now() - interval '4 days', 5, false, false, ARRAY['skincare','routine'], 'published'),
  ('30000000-0000-0000-0000-000000001002', 'Batch 3 Tag Match', 'batch-3-tag-match', 'Tag match excerpt', NULL,
   '30000000-0000-0000-0000-000000000001', NULL, now() - interval '2 days', 8, false, false, ARRAY['skincare','guide'], 'published'),
  ('30000000-0000-0000-0000-000000001003', 'Batch 3 Category Match', 'batch-3-category-match', 'Category excerpt', NULL,
   '30000000-0000-0000-0000-000000000001', NULL, now() - interval '1 day', 3, false, false, ARRAY['editorial'], 'published'),
  ('30000000-0000-0000-0000-000000001004', 'Batch 3 Draft', 'batch-3-draft', 'Draft excerpt', NULL,
   '30000000-0000-0000-0000-000000000001', NULL, now() - interval '1 day', 2, false, false, ARRAY['skincare'], 'draft'),
  ('30000000-0000-0000-0000-000000001005', 'Batch 3 Future', 'batch-3-future', 'Future excerpt', NULL,
   '30000000-0000-0000-0000-000000000001', NULL, now() + interval '2 days', 2, false, false, ARRAY['skincare'], 'published'),
  ('30000000-0000-0000-0000-000000001006', 'Batch 3 Completed', 'batch-3-completed', 'Finished excerpt', NULL,
   '30000000-0000-0000-0000-000000000002', NULL, now() - interval '8 days', 6, false, false, ARRAY['finished'], 'published'),
  ('30000000-0000-0000-0000-000000001007', 'Batch 3 Trending', 'batch-3-trending', 'Trending excerpt', NULL,
   '30000000-0000-0000-0000-000000000002', NULL, now() - interval '3 days', 4, true, false, ARRAY['popular'], 'published')
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
  owner_claims jsonb := '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000001","email":"owner@lixxonstudio.com"}';
  reader_claims jsonb := '{"role":"authenticated","sub":"00000000-0000-0000-0000-0000000000c3","email":"batch3-reader@example.com"}';
  bob_claims jsonb := '{"role":"authenticated","sub":"00000000-0000-0000-0000-0000000000b2","email":"bob@example.com"}';
  anon_claims jsonb := '{"role":"anon"}';
  v jsonb;
  n integer;
  result record;
  utc_today date := timezone('UTC', now())::date;
  fp text := 'batch3_continue_reader_0001';
BEGIN
  -- Function contracts, bounds, trimming, and least-privilege table setup.
  PERFORM _p_assert(public.lx_valid_fingerprint(' 1234567890 ') = '1234567890', 'fingerprints are trimmed');
  PERFORM _p_assert(char_length(public.lx_valid_fingerprint('1234567890')) = 10, '10-character fingerprint accepted');
  PERFORM _p_assert(char_length(public.lx_valid_fingerprint(repeat('x', 64))) = 64, '64-character fingerprint accepted');
  BEGIN PERFORM public.lx_valid_fingerprint('short'); PERFORM _p_assert(false, 'short fingerprint rejected');
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN PERFORM public.lx_valid_fingerprint(repeat('x', 65)); PERFORM _p_assert(false, 'long fingerprint rejected');
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  PERFORM _p_assert(has_function_privilege('anon', 'public.lx_valid_fingerprint(text)', 'EXECUTE'), 'anon can validate fingerprints');
  PERFORM _p_assert(has_function_privilege('authenticated', 'public.for_you_feed(text,integer)', 'EXECUTE'), 'authenticated can call feed');
  PERFORM _p_assert((SELECT count(*) = 1 FROM pg_policies WHERE schemaname='public' AND tablename='reading_progress'), 'reading_progress has exactly one policy');
  PERFORM _p_assert((SELECT count(*) = 1 FROM pg_policies WHERE schemaname='public' AND tablename='reading_sessions'), 'reading_sessions has exactly one policy');
  PERFORM _p_assert(_p_count('anon', anon_claims, 'SELECT id FROM public.reading_progress') <= 0, 'anon cannot page through progress');
  PERFORM _p_assert(_p_count('authenticated', bob_claims, 'SELECT id FROM public.reading_progress') <= 0, 'non-admin cannot page through progress');
  PERFORM _p_assert(_p_count('anon', anon_claims, 'SELECT id FROM public.reading_sessions') <= 0, 'anon cannot read sessions');
  PERFORM _p_assert(_p_count('authenticated', bob_claims, 'SELECT id FROM public.reading_sessions') <= 0, 'non-admin cannot read sessions');
  PERFORM _p_assert(_p_count('authenticated', owner_claims, 'SELECT id FROM public.reading_progress') >= 0, 'admin can query progress');
  PERFORM _p_assert(has_table_privilege('authenticated', 'public.reading_progress', 'SELECT'), 'authenticated role has only the select grant needed for its admin policy');
  PERFORM _p_assert(NOT has_table_privilege('anon', 'public.reading_progress', 'SELECT'), 'anon role has no direct progress table grant');

  -- Validation, clamping, monotonicity, post status, and user association.
  PERFORM set_config('request.jwt.claims', reader_claims::text, true);
  PERFORM set_config('request.jwt.claim.sub', reader_claims->>'sub', true);
  SELECT * INTO result FROM public.record_reading_progress('batch3_record_reader_0001', '30000000-0000-0000-0000-000000001001', -9);
  PERFORM _p_assert(result.saved AND result.progress_percent = 0 AND result.post_slug = 'batch-3-signal-article', 'negative progress clamps to zero and returns post slug');
  SELECT * INTO result FROM public.record_reading_progress('batch3_record_reader_0001', '30000000-0000-0000-0000-000000001001', 42);
  PERFORM _p_assert(result.progress_percent = 42, 'progress advances to requested percent');
  SELECT * INTO result FROM public.record_reading_progress('batch3_record_reader_0001', '30000000-0000-0000-0000-000000001001', 17);
  PERFORM _p_assert(result.progress_percent = 42, 'progress is monotonic');
  SELECT * INTO result FROM public.record_reading_progress('batch3_record_reader_0001', '30000000-0000-0000-0000-000000001001', 150);
  PERFORM _p_assert(result.progress_percent = 100, 'progress clamps to 100');
  PERFORM _p_assert((SELECT user_id = '00000000-0000-0000-0000-0000000000c3'::uuid FROM public.reading_progress WHERE fingerprint='batch3_record_reader_0001'), 'recording associates the signed-in reader');
  BEGIN PERFORM public.record_reading_progress('batch3_record_reader_0001', '30000000-0000-0000-0000-000000001004', 20); PERFORM _p_assert(false, 'draft is rejected');
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN PERFORM public.record_reading_progress('batch3_record_reader_0001', '30000000-0000-0000-0000-000000001005', 20); PERFORM _p_assert(false, 'future post is rejected');
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  PERFORM _p_assert(_p_blocked('anon', anon_claims, $q$INSERT INTO public.reading_progress (fingerprint, post_id) VALUES ('batch3_direct_write_0001','30000000-0000-0000-0000-000000001001')$q$), 'anon cannot insert progress directly');
  PERFORM _p_assert(_p_blocked('authenticated', bob_claims, $q$DELETE FROM public.reading_progress$q$), 'non-admin cannot delete progress');
  PERFORM _p_assert(_p_count('authenticated', owner_claims, 'SELECT id FROM public.reading_progress') > 0, 'admin reads progress rows');

  -- Continue reading prioritises saved progress; finished/draft/future rows never reappear.
  INSERT INTO public.reading_progress (fingerprint, post_id, progress_percent, updated_at)
  VALUES (fp, '30000000-0000-0000-0000-000000001002', 42, now() - interval '1 day'),
         (fp, '30000000-0000-0000-0000-000000001006', 97, now())
  ON CONFLICT (fingerprint, post_id) DO UPDATE SET progress_percent=EXCLUDED.progress_percent, updated_at=EXCLUDED.updated_at;
  INSERT INTO public.article_views (post_id, fingerprint, created_at) VALUES
    ('30000000-0000-0000-0000-000000001002', fp, now()),
    ('30000000-0000-0000-0000-000000001003', fp, now()),
    ('30000000-0000-0000-0000-000000001004', fp, now()),
    ('30000000-0000-0000-0000-000000001005', fp, now()),
    ('30000000-0000-0000-0000-000000001006', fp, now());
  SELECT * INTO result FROM public.continue_reading(fp, 10) LIMIT 1;
  PERFORM _p_assert(result.post_id='30000000-0000-0000-0000-000000001002'::uuid AND result.source='progress', 'unfinished progress sorts ahead of recent views');
  PERFORM _p_assert(result.progress_percent=42, 'continue rail preserves saved percent');
  PERFORM _p_assert((SELECT bool_or(source='recent' AND post_id='30000000-0000-0000-0000-000000001003'::uuid) FROM public.continue_reading(fp, 10)), 'article views fill the recent arm');
  PERFORM _p_assert(NOT EXISTS (SELECT 1 FROM public.continue_reading(fp, 10) WHERE post_id='30000000-0000-0000-0000-000000001006'::uuid), 'finished article cannot leak back through recent arm');
  PERFORM _p_assert(NOT EXISTS (SELECT 1 FROM public.continue_reading(fp, 10) WHERE post_id IN ('30000000-0000-0000-0000-000000001004'::uuid,'30000000-0000-0000-0000-000000001005'::uuid)), 'draft and future articles are omitted');
  PERFORM _p_assert((SELECT count(*) <= 1 FROM public.continue_reading(fp, 0)), 'continue limit clamps to one');
  PERFORM _p_assert((SELECT count(*) <= 10 FROM public.continue_reading(fp, 500)), 'continue limit caps at ten');

  -- Reading-day upsert is UTC, idempotent, preserves a prior post, and computes gaps-and-islands.
  PERFORM set_config('request.jwt.claim.sub', reader_claims->>'sub', true);
  SELECT * INTO result FROM public.save_reading_day('batch3_streak_reader_0001', '30000000-0000-0000-0000-000000001001');
  SELECT * INTO result FROM public.save_reading_day('batch3_streak_reader_0001', NULL);
  PERFORM _p_assert(result.read_day=utc_today, 'reading day is UTC today');
  PERFORM _p_assert((SELECT count(*)=1 FROM public.reading_sessions WHERE fingerprint='batch3_streak_reader_0001' AND read_date=utc_today), 'same-day save is idempotent');
  PERFORM _p_assert((SELECT post_id='30000000-0000-0000-0000-000000001001'::uuid FROM public.reading_sessions WHERE fingerprint='batch3_streak_reader_0001' AND read_date=utc_today), 'null same-day post preserves existing post');
  INSERT INTO public.reading_sessions (fingerprint, read_date, post_id) VALUES
    ('batch3_streak_reader_0001', utc_today - 2, '30000000-0000-0000-0000-000000001002'),
    ('batch3_streak_reader_0001', utc_today - 3, '30000000-0000-0000-0000-000000001003');
  INSERT INTO public.article_views (post_id, fingerprint, created_at) VALUES
    ('30000000-0000-0000-0000-000000001001', 'batch3_streak_reader_0001', now()),
    ('30000000-0000-0000-0000-000000001004', 'batch3_streak_reader_0001', now()),
    ('30000000-0000-0000-0000-000000001005', 'batch3_streak_reader_0001', now());
  INSERT INTO public.reading_progress (fingerprint, post_id, progress_percent, updated_at) VALUES
    ('batch3_streak_reader_0001', '30000000-0000-0000-0000-000000001002', 50, now()),
    ('batch3_streak_reader_0001', '30000000-0000-0000-0000-000000001003', 15, now());
  SELECT * INTO result FROM public.save_reading_day('batch3_streak_reader_0001', NULL);
  PERFORM _p_assert(result.current_streak=1, 'gap resets current streak to one');
  PERFORM _p_assert(result.days_active=3, 'reading day count is distinct and idempotent');
  SELECT * INTO result FROM public.reader_insights('batch3_streak_reader_0001', 400);
  PERFORM _p_assert(result.current_streak=1 AND result.longest_streak=2, 'insights calculate current and best streak across a gap');
  PERFORM _p_assert(result.days_active=3, 'insights return active days in the window');
  PERFORM _p_assert(result.articles_read=3, 'insights count distinct published, non-future viewed/progressed posts');
  PERFORM _p_assert(result.minutes_read=16, 'insights sum reading time once per post');
  PERFORM _p_assert(jsonb_typeof(result.top_categories)='array' AND jsonb_array_length(result.top_categories) <= 3, 'top categories is a bounded JSON array');
  PERFORM _p_assert(result.first_read_day=utc_today-3 AND result.last_read_day=utc_today, 'insights expose first and last active day');
  SELECT * INTO result FROM public.reader_insights('batch3_new_reader_0001', 90);
  PERFORM _p_assert(result.articles_read=0 AND result.days_active=0 AND result.current_streak=0 AND result.longest_streak=0 AND result.minutes_read=0, 'new-reader insight counters are zero');
  PERFORM _p_assert(result.top_categories='[]'::jsonb AND result.first_read_day IS NOT NULL AND result.last_read_day IS NOT NULL, 'new-reader insights use an empty array and non-null day values');

  -- Feed uses category/tag affinities, excludes every read/progressed post, and cold-starts on 14-day popularity.
  INSERT INTO public.article_views (post_id, fingerprint, created_at) VALUES
    ('30000000-0000-0000-0000-000000001001', 'batch3_feed_tag_reader_0001', now()),
    ('30000000-0000-0000-0000-000000001001', 'batch3_feed_category_reader_01', now()),
    ('30000000-0000-0000-0000-000000001007', 'batch3_other_reader_00001', now() - interval '1 day'),
    ('30000000-0000-0000-0000-000000001007', 'batch3_other_reader_00002', now() - interval '2 days');
  PERFORM _p_assert((SELECT bool_or(reason='More on skincare') FROM public.for_you_feed('batch3_feed_tag_reader_0001', 24)), 'tag matches have a More on reason');
  PERFORM _p_assert((SELECT bool_or(reason LIKE 'Because you read %') FROM public.for_you_feed('batch3_feed_category_reader_01', 24)), 'category matches have a category reason');
  PERFORM _p_assert(NOT EXISTS (SELECT 1 FROM public.for_you_feed('batch3_feed_tag_reader_0001', 24) WHERE post_id='30000000-0000-0000-0000-000000001001'::uuid), 'feed excludes already viewed articles');
  PERFORM _p_assert(NOT EXISTS (SELECT 1 FROM public.for_you_feed('batch3_feed_tag_reader_0001', 24) WHERE post_id='30000000-0000-0000-0000-000000001004'::uuid), 'feed excludes drafts');
  PERFORM _p_assert((SELECT bool_or(reason='Popular with readers this week') FROM public.for_you_feed('batch3_cold_start_reader_001', 24)), 'cold start uses the specified trending reason');
  PERFORM _p_assert((SELECT count(*) <= 1 FROM public.for_you_feed('batch3_cold_start_reader_001', 0)), 'feed limit clamps to one');
  PERFORM _p_assert((SELECT count(*) <= 24 FROM public.for_you_feed('batch3_cold_start_reader_001', 999)), 'feed limit caps at 24');

  RAISE NOTICE 'Batch 3 personalisation assertions passed';
END $$;
