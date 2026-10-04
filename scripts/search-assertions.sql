-- =====================================================================
-- Batch 2 search & discovery — behavioural assertions.
-- Run by scripts/db-test.py after the migrations (and after db-assertions.sql).
--
-- These are not happy-path smoke tests: typo tolerance, synonym expansion,
-- every filter/sort combination, and the RLS boundaries of the new tables are
-- asserted so a regression fails CI rather than production.
-- =====================================================================
\set ON_ERROR_STOP on

-- ---------------------------------------------------------------- helpers
CREATE OR REPLACE FUNCTION _t_assert(label text, cond boolean) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF cond IS NOT TRUE THEN
    RAISE EXCEPTION 'ASSERTION FAILED: %', label;
  END IF;
  RAISE NOTICE '  ✓ %', label;
END $$;

-- Run a scalar query as another role (returns 'ERROR:<sqlstate>' if it raises).
CREATE OR REPLACE FUNCTION _t_as(role_name text, claims jsonb, q text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  EXECUTE format('SET LOCAL ROLE %I', role_name);
  PERFORM set_config('request.jwt.claims', COALESCE(claims, '{}'::jsonb)::text, true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(claims->>'sub', ''), true);
  PERFORM set_config('request.jwt.claim.role', COALESCE(claims->>'role', role_name), true);
  BEGIN
    EXECUTE 'SELECT (' || q || ')::text' INTO v;
  EXCEPTION WHEN OTHERS THEN
    v := 'ERROR:' || SQLSTATE;
  END;
  RESET ROLE;
  RETURN v;
END $$;

-- ---------------------------------------------------------------- fixtures
INSERT INTO posts (id, title, slug, excerpt, content, status, category_id, author_id, published_at, reading_time_minutes, tags)
VALUES
  ('30000000-0000-0000-0000-000000000001', 'Niacinamide: the barrier workhorse', 'niacinamide-barrier',
   'How nicotinamide calms redness and rebuilds the skin barrier at 2-5%.',
   'Niacinamide (nicotinamide) is vitamin B3. It supports the barrier and evens tone.',
   'published', '59d3acce-f83a-46db-84a3-c65f97d68a47', 'b0ab531e-88b4-4a31-8558-b68d657ef9f2',
   now() - interval '3 days', 6, ARRAY['skincare', 'barrier', 'ingredients']),
  ('30000000-0000-0000-0000-000000000002', 'Retinol without the irritation', 'retinol-basics',
   'A slow, sandwich-method start to vitamin A.',
   'Retinol and retinal are vitamin A derivatives. Start twice a week and always use SPF.',
   'published', '59d3acce-f83a-46db-84a3-c65f97d68a47', 'c0197c7a-386c-461b-9fed-5932b3b14f41',
   now() - interval '10 days', 9, ARRAY['skincare', 'retinoids', 'ingredients']),
  ('30000000-0000-0000-0000-000000000003', 'A capsule wardrobe for spring', 'capsule-wardrobe',
   'Twelve pieces, endless outfits.',
   'A capsule wardrobe reduces decision fatigue. Start with the pieces you actually wear.',
   'published', '02110177-5210-4af8-8599-4759c930f3c4', 'b0ab531e-88b4-4a31-8558-b68d657ef9f2',
   now() - interval '400 days', 4, ARRAY['style', 'capsule']),
  ('30000000-0000-0000-0000-000000000004', 'Vitamin C serums that do not sting', 'vitamin-c-serums',
   'Ascorbic acid, or a gentler derivative?',
   'L-ascorbic acid is the gold standard; ascorbyl glucoside is gentler on sensitive skin.',
   'published', '59d3acce-f83a-46db-84a3-c65f97d68a47', 'b0ab531e-88b4-4a31-8558-b68d657ef9f2',
   now() - interval '20 days', 7, ARRAY['skincare', 'ingredients']),
  ('30000000-0000-0000-0000-000000000005', 'Draft: unpublished niacinamide notes', 'draft-niacinamide',
   'Not live yet.', 'niacinamide niacinamide', 'draft',
   '59d3acce-f83a-46db-84a3-c65f97d68a47', 'b0ab531e-88b4-4a31-8558-b68d657ef9f2',
   now() - interval '1 day', 5, ARRAY['skincare'])
ON CONFLICT (id) DO NOTHING;

INSERT INTO products (id, name, slug, price, price_cents, currency, product_type, is_active, tags, description)
VALUES
  ('40000000-0000-0000-0000-000000000001', 'Niacinamide 5% Barrier Serum', 'niacinamide-barrier-serum',
   '18.00', 1800, 'USD', 'physical', true, ARRAY['skincare', 'barrier'],
   'A lightweight nicotinamide serum for barrier support.'),
  ('40000000-0000-0000-0000-000000000002', 'Retinol 0.3% Night Cream', 'retinol-night-cream',
   '26.00', 2600, 'USD', 'physical', true, ARRAY['skincare', 'retinoids'],
   'A gentle retinol cream with ceramides.')
ON CONFLICT (id) DO NOTHING;

INSERT INTO article_views (post_id, fingerprint) VALUES
  ('30000000-0000-0000-0000-000000000003', 'fp-viewer-1'),
  ('30000000-0000-0000-0000-000000000003', 'fp-viewer-2'),
  ('30000000-0000-0000-0000-000000000003', 'fp-viewer-3'),
  ('30000000-0000-0000-0000-000000000003', 'fp-viewer-4'),
  ('30000000-0000-0000-0000-000000000001', 'fp-viewer-1'),
  ('30000000-0000-0000-0000-000000000002', 'fp-viewer-1'),
  ('30000000-0000-0000-0000-000000000002', 'fp-viewer-4'),
  -- three readers who opened both the niacinamide article and the capsule piece
  -- (nothing else connects those two, so only the co-read signal can rank it)
  ('30000000-0000-0000-0000-000000000001', 'fp-viewer-2'),
  ('30000000-0000-0000-0000-000000000001', 'fp-viewer-3');

INSERT INTO search_history (fingerprint, query, result_count, created_at) VALUES
  ('fp-a', 'niacinamide', 3, now() - interval '3 hours'),
  ('fp-a', 'retinol', 2, now() - interval '1 hour'),
  ('fp-b', 'niacinamide', 3, now() - interval '2 hours'),
  ('fp-b', 'retinol', 2, now() - interval '1 hour'),
  ('fp-c', 'slugging', 0, now() - interval '30 minutes');

-- ================================================================ behaviour
DO $$
DECLARE
  n integer;
  first_slug text;
  kinds text[];
BEGIN
  -- exact + typo tolerance -------------------------------------------------
  SELECT count(*) INTO n FROM search_everything('niacinamide');
  PERFORM _t_assert('exact query finds the article and the matching product', n >= 2);

  SELECT count(*) INTO n FROM search_everything('niacinamid');
  PERFORM _t_assert('one-character typo still finds results', n >= 1);

  SELECT count(*) INTO n FROM search_everything('retionl');
  PERFORM _t_assert('transposed letters still find results', n >= 1);

  SELECT count(*) INTO n FROM search_everything('barrier serum');
  PERFORM _t_assert('two-word query matches across title and tags', n >= 2);

  -- synonym expansion (terms come from search_synonyms via the client) ----
  SELECT count(*) INTO n FROM search_everything('ascorbic acid', ARRAY['vitamin c', 'ascorbic acid', 'l-ascorbic acid']);
  PERFORM _t_assert('synonym terms find the vitamin C article', n >= 1);

  SELECT count(*) INTO n FROM search_everything('nicotinamide', ARRAY['niacinamide', 'nicotinamide', 'vitamin b3']);
  PERFORM _t_assert('synonym expansion reaches the niacinamide article', n >= 1);

END $$;

DO $$
DECLARE n integer; first_slug text; kinds text[];
BEGIN
  -- drafts must never surface ---------------------------------------------
  -- "unpublished" appears only in the draft's title
  SELECT count(*) INTO n FROM search_everything('unpublished');
  PERFORM _t_assert('draft-only wording returns nothing to a public query', n = 0);

  -- kind filter ------------------------------------------------------------
  SELECT array_agg(DISTINCT result_kind) INTO kinds FROM search_everything('niacinamide', '{}', 'product');
  PERFORM _t_assert('kind=product returns only products', kinds = ARRAY['product']);

  SELECT array_agg(DISTINCT result_kind) INTO kinds FROM search_everything('niacinamide', '{}', 'article');
  PERFORM _t_assert('kind=article returns only articles', kinds = ARRAY['article']);

  -- relevance ordering -----------------------------------------------------
  SELECT slug INTO first_slug FROM search_everything('retinol') LIMIT 1;
  PERFORM _t_assert('best title match ranks first', first_slug LIKE 'retinol%');

  -- every non-title match must rank below the weakest title match
  SELECT count(*) INTO n
  FROM search_everything('retinol') r
  WHERE r.title NOT ILIKE '%retinol%'
    AND r.score > (SELECT max(score) FROM search_everything('retinol') WHERE title ILIKE '%retinol%');
  PERFORM _t_assert('body-only mentions rank below title matches', n = 0);

  -- filters: every returned row must satisfy the filter ----------------------
  SELECT count(*) INTO n FROM search_everything('', '{}', 'article', 'style') WHERE category_slug <> 'style';
  PERFORM _t_assert('category filter returns only that category', n = 0);
  SELECT count(*) INTO n FROM search_everything('', '{}', 'article', 'style');
  PERFORM _t_assert('category filter returns the style article', n >= 1);

  SELECT count(*) INTO n FROM search_everything('', '{}', 'article', NULL, 'sophie') WHERE author_slug <> 'sophie';
  PERFORM _t_assert('author filter returns only that author', n = 0);

  SELECT count(*) INTO n FROM search_everything('', '{}', 'article', NULL, NULL, 'retinoids') WHERE NOT ('retinoids' = ANY (tags));
  PERFORM _t_assert('tag filter returns only tagged articles', n = 0);
  SELECT count(*) INTO n FROM search_everything('', '{}', 'article', NULL, NULL, 'retinoids');
  PERFORM _t_assert('tag filter matches the retinol article', n >= 1);

  SELECT count(*) INTO n FROM search_everything('', '{}', 'article', NULL, NULL, NULL, 8) WHERE reading_time_minutes < 8;
  PERFORM _t_assert('minimum reading time filter holds', n = 0);

  SELECT count(*) INTO n FROM search_everything('', '{}', 'article', NULL, NULL, NULL, NULL, 5) WHERE reading_time_minutes > 5;
  PERFORM _t_assert('maximum reading time filter holds', n = 0);

  SELECT count(*) INTO n FROM search_everything('', '{}', 'article', NULL, NULL, NULL, NULL, NULL, CURRENT_DATE - 30)
    WHERE published_at < CURRENT_DATE - 30;
  PERFORM _t_assert('date-from filter holds', n = 0);

  SELECT count(*) INTO n FROM search_everything('', '{}', 'article', NULL, NULL, NULL, NULL, NULL, NULL, CURRENT_DATE - 30)
    WHERE published_at >= CURRENT_DATE - 30;
  PERFORM _t_assert('date-to filter holds', n = 0);

  -- filter-only browsing (no query text) ----------------------------------
  SELECT count(*) INTO n FROM search_everything('', '{}', 'all', NULL, NULL, 'skincare');
  PERFORM _t_assert('filters alone act as browse', n >= 4);

  -- sorting ----------------------------------------------------------------
  SELECT slug INTO first_slug FROM search_everything('', '{}', 'article', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'newest') LIMIT 1;
  PERFORM _t_assert('sort=newest leads with the newest article', first_slug = 'niacinamide-barrier');

  SELECT slug INTO first_slug FROM search_everything('', '{}', 'article', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'most_read') LIMIT 1;
  PERFORM _t_assert('sort=most_read leads with the most viewed article', first_slug = 'capsule-wardrobe');

  -- paging / totals --------------------------------------------------------
  SELECT max(total_count) INTO n FROM search_everything('', '{}', 'all', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'newest', 2, 0);
  PERFORM _t_assert('total_count reports the full result count, not the page', n >= 6);

  SELECT count(*) INTO n FROM search_everything('', '{}', 'all', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'newest', 2, 2);
  PERFORM _t_assert('offset pages the result set', n = 2);

  -- abusive input ----------------------------------------------------------
  -- reaching this line at all proves the input never became syntax
  SELECT count(*) INTO n FROM search_everything(''' ; DROP TABLE posts; --');
  PERFORM _t_assert('SQL-ish input is treated as text, not syntax', to_regclass('public.posts') IS NOT NULL);
  SELECT count(*) INTO n FROM search_everything(''' ; DROP TABLE posts; --') WHERE result_kind IS NULL;
  PERFORM _t_assert('SQL-ish input still returns well-formed rows', n = 0);

  SELECT count(*) INTO n FROM search_everything(repeat('a', 500));
  PERFORM _t_assert('absurdly long input does not error', n >= 0);
END $$;

DO $$
DECLARE n integer; r text; first_slug text; q text;
BEGIN
  -- related posts ----------------------------------------------------------
  SELECT count(*) INTO n FROM related_posts('30000000-0000-0000-0000-000000000001', 4);
  PERFORM _t_assert('related posts returns neighbours', n >= 2);

  SELECT count(*) INTO n FROM related_posts('30000000-0000-0000-0000-000000000001', 4) WHERE reason = 'tags';
  PERFORM _t_assert('related posts explains the tag reason', n >= 1);

  SELECT count(*) INTO n FROM related_posts('30000000-0000-0000-0000-000000000001', 12)
    WHERE reason = 'co-read' AND slug = 'capsule-wardrobe';
  PERFORM _t_assert('co-read signal surfaces articles the same readers opened', n = 1);

  SELECT count(*) INTO n FROM related_posts('30000000-0000-0000-0000-000000000001', 4)
    WHERE id = '30000000-0000-0000-0000-000000000005';
  PERFORM _t_assert('related posts never suggests drafts', n = 0);

  -- search rails -----------------------------------------------------------
  SELECT count(*) INTO n FROM trending_searches(8);
  PERFORM _t_assert('trending searches aggregates repeated queries', n >= 2);

  SELECT count(*) INTO n FROM recent_searches('fp-a', 8);
  PERFORM _t_assert('recent searches returns that fingerprint only', n = 2);

  SELECT count(*) INTO n FROM recent_searches('', 8);
  PERFORM _t_assert('recent searches refuses an empty fingerprint', n = 0);

  SELECT query INTO q FROM recent_searches('fp-a', 8) LIMIT 1;
  PERFORM _t_assert('recent searches is newest-first', q = 'retinol');

  SELECT query INTO q FROM people_also_searched('niacinamide', 4) LIMIT 1;
  PERFORM _t_assert('people also searched finds the co-searched term', q = 'retinol');

  -- search_gaps is admin-only, so test it as an admin rather than a superuser
  INSERT INTO app_admins (user_id, role) VALUES ('00000000-0000-0000-0000-0000000000a1', 'owner')
    ON CONFLICT (user_id) DO NOTHING;
  SELECT count(*) INTO n FROM search_gaps(20);  -- superuser: not an admin, sees nothing
  PERFORM _t_assert('search gaps is empty for non-admin callers', n = 0);

  PERFORM _t_assert('search gaps lists zero-result searches for an admin',
    _t_as('authenticated', '{"role":"authenticated","sub":"00000000-0000-0000-0000-0000000000a1"}',
          'SELECT count(*) FROM search_gaps(20)')::integer >= 1);

  -- capability delete ------------------------------------------------------
  SELECT forget_searches('fp-c') INTO n;
  PERFORM _t_assert('forget_searches deletes only that fingerprint', n = 1);
  SELECT count(*) INTO n FROM search_history WHERE fingerprint = 'fp-c';
  PERFORM _t_assert('forgotten history is gone', n = 0);
END $$;

-- ================================================================== RLS
DO $$
DECLARE v text; n integer;
BEGIN
  -- search_history is no longer world-readable ----------------------------
  v := _t_as('anon', '{"role":"anon"}', 'SELECT count(*) FROM search_history');
  PERFORM _t_assert('anon cannot read the raw search history table', v = '0');

  v := _t_as('anon', '{"role":"anon"}',
    $q$SELECT count(*) FROM search_history WHERE fingerprint = 'fp-a'$q$);
  PERFORM _t_assert('anon cannot read another fingerprint''s history directly', v = '0');

  v := _t_as('anon', '{"role":"anon"}', 'SELECT count(*) FROM recent_searches(''fp-a'', 8)');
  PERFORM _t_assert('anon can read history through the capability function', v = '2');

  v := _t_as('anon', '{"role":"anon"}', 'SELECT count(*) FROM search_gaps(20)');
  PERFORM _t_assert('search gaps is refused to anon', v LIKE 'ERROR:%');

  -- synonyms are public to read, admin-only to write -----------------------
  v := _t_as('anon', '{"role":"anon"}', 'SELECT count(*) FROM search_synonyms');
  PERFORM _t_assert('anon can read the synonym list', (v::integer) > 10);

  v := _t_as('anon', '{"role":"anon"}',
    $q$INSERT INTO search_synonyms (term, synonyms) VALUES ('hack', ARRAY['x']) RETURNING id$q$);
  PERFORM _t_assert('anon cannot edit synonyms', v LIKE 'ERROR:%');

  -- saved searches are per-user -------------------------------------------
  INSERT INTO saved_searches (user_id, label, query) VALUES
    ('00000000-0000-0000-0000-0000000000a1', 'Alice niacinamide', 'niacinamide'),
    ('00000000-0000-0000-0000-0000000000b2', 'Bob retinol', 'retinol')
  ON CONFLICT DO NOTHING;

  v := _t_as('authenticated', '{"role":"authenticated","sub":"00000000-0000-0000-0000-0000000000a1"}',
    'SELECT count(*) FROM saved_searches');
  PERFORM _t_assert('a reader sees only their own saved searches', v = '1');

  v := _t_as('authenticated', '{"role":"authenticated","sub":"00000000-0000-0000-0000-0000000000a1"}',
    'SELECT count(*) FROM saved_searches WHERE user_id = ''00000000-0000-0000-0000-0000000000b2''');
  PERFORM _t_assert('a reader cannot read another reader''s saved searches', v = '0');

  v := _t_as('anon', '{"role":"anon"}', 'SELECT count(*) FROM saved_searches');
  PERFORM _t_assert('anon sees no saved searches', v = '0');

  -- published content is still public --------------------------------------
  v := _t_as('anon', '{"role":"anon"}', 'SELECT count(*) FROM search_everything(''niacinamide'')');
  PERFORM _t_assert('anon can search published content', (v::integer) >= 2);

  v := _t_as('anon', '{"role":"anon"}', 'SELECT count(*) FROM related_posts(''30000000-0000-0000-0000-000000000001'', 4)');
  PERFORM _t_assert('anon can read related posts', (v::integer) >= 2);

  v := _t_as('anon', '{"role":"anon"}', 'SELECT count(*) FROM search_everything(''unpublished'')');
  PERFORM _t_assert('anon cannot find drafts through search', v = '0');
END $$;
