-- =====================================================================
-- Phase 2 · Batch 2 — Search & discovery
--
-- Adds the server side of instant, typo-tolerant search:
--   * trigram ranking machinery (pg_trgm in production, an equivalent
--     pure-SQL fallback where the extension is unavailable so CI can
--     exercise the very same ranking logic),
--   * search_synonyms — beauty terms the owner edits from the admin,
--   * saved_searches — account-scoped saved searches (local ones live in
--     the browser),
--   * search_everything() — one ranked query over published articles and
--     active products with filters, sorting and paging,
--   * trending_searches(), recent_searches(), people_also_searched(),
--     related_posts() — the discovery rails,
--   * search_history.result_count so zero-result searches become a
--     content-gap signal instead of a dead end.
--
-- Privacy note: search_history rows are stored against a client-generated
-- fingerprint and never contain an IP. Aggregate reads go through functions so
-- the raw history table no longer needs to be world-readable.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Trigram machinery
-- ---------------------------------------------------------------------
DO $$
BEGIN
  -- Supabase ships pg_trgm; the embedded test Postgres may not.
  CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE '[lixxon] pg_trgm unavailable — installing the pure-SQL trigram fallback';
END $$;

-- Pure-SQL trigram sets (same shape as pg_trgm's: each word padded with two
-- leading spaces and one trailing space, lower-cased, non-alphanumerics split).
CREATE OR REPLACE FUNCTION public.lx_trigrams(t text)
RETURNS text[]
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $fn$
  WITH words AS (
    SELECT w
    FROM unnest(regexp_split_to_array(lower(coalesce(t, '')), '[^a-z0-9]+')) AS w
    WHERE w <> ''
  ), grams AS (
    SELECT DISTINCT substr('  ' || w || ' ', g, 3) AS tg
    FROM words
    CROSS JOIN LATERAL generate_series(1, length(w) + 1) AS g
  )
  SELECT COALESCE(array_agg(tg ORDER BY tg), ARRAY[]::text[]) FROM grams
$fn$;

CREATE OR REPLACE FUNCTION public.lx_similarity_fallback(a text, b text)
RETURNS real
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $fn$
  WITH ga AS (SELECT public.lx_trigrams(a) AS g),
       gb AS (SELECT public.lx_trigrams(b) AS g),
       inter AS (
         SELECT count(*)::real AS n
         FROM (SELECT unnest((SELECT g FROM ga)) INTERSECT SELECT unnest((SELECT g FROM gb))) i
       )
  SELECT CASE
    WHEN cardinality((SELECT g FROM ga)) = 0 OR cardinality((SELECT g FROM gb)) = 0 THEN 0::real
    ELSE (SELECT n FROM inter) /
         (cardinality((SELECT g FROM ga)) + cardinality((SELECT g FROM gb)) - (SELECT n FROM inter))
  END
$fn$;

CREATE OR REPLACE FUNCTION public.lx_word_similarity_fallback(a text, b text)
RETURNS real
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $fn$
  SELECT COALESCE(max(public.lx_similarity_fallback(a, w)), 0::real)
  FROM unnest(regexp_split_to_array(lower(coalesce(b, '')), '[^a-z0-9]+')) AS w
  WHERE w <> ''
$fn$;

-- The public entry points: pg_trgm when present, otherwise the fallback above.
-- Both are IMMUTABLE so expression/functional indexes stay usable.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    EXECUTE $f$
      CREATE OR REPLACE FUNCTION public.lx_similarity(a text, b text)
      RETURNS real LANGUAGE sql IMMUTABLE PARALLEL SAFE
      AS 'SELECT extensions.similarity(a, b)';
    $f$;
    EXECUTE $f$
      CREATE OR REPLACE FUNCTION public.lx_word_similarity(a text, b text)
      RETURNS real LANGUAGE sql IMMUTABLE PARALLEL SAFE
      AS 'SELECT extensions.word_similarity(a, b)';
    $f$;
  ELSE
    EXECUTE $f$
      CREATE OR REPLACE FUNCTION public.lx_similarity(a text, b text)
      RETURNS real LANGUAGE sql IMMUTABLE PARALLEL SAFE
      AS 'SELECT public.lx_similarity_fallback(a, b)';
    $f$;
    EXECUTE $f$
      CREATE OR REPLACE FUNCTION public.lx_word_similarity(a text, b text)
      RETURNS real LANGUAGE sql IMMUTABLE PARALLEL SAFE
      AS 'SELECT public.lx_word_similarity_fallback(a, b)';
    $f$;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 2. Search synonyms (owner-editable)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS search_synonyms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  term text NOT NULL,
  synonyms text[] NOT NULL DEFAULT '{}',
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS search_synonyms_term_key ON search_synonyms (lower(term));

ALTER TABLE search_synonyms ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS search_synonyms_public_read ON search_synonyms;
CREATE POLICY search_synonyms_public_read ON search_synonyms
  FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS search_synonyms_admin_write ON search_synonyms;
CREATE POLICY search_synonyms_admin_write ON search_synonyms
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
GRANT SELECT ON search_synonyms TO anon, authenticated;

-- Beauty-specific equivalences. The reader types either side and gets both.
INSERT INTO search_synonyms (term, synonyms, note) VALUES
  ('niacinamide', ARRAY['nicotinamide', 'vitamin b3', 'b3', 'nicotinic acid'], 'the same molecule'),
  ('retinol', ARRAY['retinal', 'retinaldehyde', 'tretinoin', 'retinoid', 'vitamin a', 'adapalene'], 'vitamin A family'),
  ('vitamin c', ARRAY['ascorbic acid', 'l-ascorbic acid', 'ascorbyl glucoside', 'thd ascorbate', 'l ascorbic'], 'forms of vitamin C'),
  ('hyaluronic acid', ARRAY['ha', 'sodium hyaluronate', 'hyaluronan'], 'humectants'),
  ('sunscreen', ARRAY['spf', 'sun cream', 'sunblock', 'uv protection', 'sun protection'], 'daily SPF'),
  ('exfoliant', ARRAY['aha', 'bha', 'pha', 'glycolic acid', 'lactic acid', 'salicylic acid', 'mandelic acid'], 'acid exfoliants'),
  ('moisturiser', ARRAY['moisturizer', 'cream', 'emollient', 'moisturising'], 'British/American spelling'),
  ('hyperpigmentation', ARRAY['dark spots', 'melasma', 'pigmentation', 'post acne marks', 'pih'], 'tone concerns'),
  ('barrier repair', ARRAY['skin barrier', 'moisture barrier', 'compromised barrier', 'tewl'], 'skin barrier'),
  ('ceramide', ARRAY['ceramides', 'lipid barrier'], 'barrier lipids'),
  ('acne', ARRAY['breakouts', 'blemish', 'pimples', 'congestion', 'spots'], 'breakout language'),
  ('hydration', ARRAY['moisture', 'dehydration', 'dryness', 'hydrating'], 'water vs oil'),
  ('anti-ageing', ARRAY['anti-aging', 'fine lines', 'wrinkles', 'firming', 'collagen'], 'ageing concerns'),
  ('double cleanse', ARRAY['double cleansing', 'oil cleanser', 'cleansing balm'], 'cleansing method'),
  ('skin cycling', ARRAY['retinoid cycling', 'cycling routine'], 'routine method'),
  ('slugging', ARRAY['occlusive', 'petrolatum', 'vaseline'], 'night-time method'),
  ('scalp care', ARRAY['scalp health', 'flaky scalp', 'dandruff'], 'hair and scalp'),
  ('capsule wardrobe', ARRAY['capsule closet', 'minimal wardrobe', 'wardrobe essentials'], 'style staples'),
  ('clean girl', ARRAY['clean girl aesthetic', 'minimal makeup', 'no makeup makeup'], 'beauty aesthetic'),
  ('silk press', ARRAY['silk press hair', 'heat protectant'], 'hair styling')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------
-- 3. Saved searches (account scope; local ones stay in the browser)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS saved_searches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 80),
  query text NOT NULL DEFAULT '' CHECK (char_length(query) <= 200),
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  notify boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_saved_searches_user ON saved_searches (user_id, created_at DESC);

ALTER TABLE saved_searches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS saved_searches_owner_select ON saved_searches;
CREATE POLICY saved_searches_owner_select ON saved_searches
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS saved_searches_owner_insert ON saved_searches;
CREATE POLICY saved_searches_owner_insert ON saved_searches
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS saved_searches_owner_update ON saved_searches;
CREATE POLICY saved_searches_owner_update ON saved_searches
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS saved_searches_owner_delete ON saved_searches;
CREATE POLICY saved_searches_owner_delete ON saved_searches
  FOR DELETE TO authenticated USING (user_id = auth.uid());
GRANT SELECT, INSERT, UPDATE, DELETE ON saved_searches TO authenticated;

-- ---------------------------------------------------------------------
-- 4. Search history: quality signal, no longer a public table
-- ---------------------------------------------------------------------
ALTER TABLE search_history ADD COLUMN IF NOT EXISTS result_count integer;
ALTER TABLE search_history ADD COLUMN IF NOT EXISTS terms text[] DEFAULT '{}';
CREATE INDEX IF NOT EXISTS idx_sh_query ON search_history (lower(query));
CREATE INDEX IF NOT EXISTS idx_sh_created ON search_history (created_at DESC);

-- The old policy let anyone dump every row of everyone's history. Reads now go
-- through capability functions (fingerprint) or aggregates (trending).
DROP POLICY IF EXISTS rl_sh_select ON search_history;
DROP POLICY IF EXISTS search_history_public_read ON search_history;
DROP POLICY IF EXISTS search_history_admin_read ON search_history;
CREATE POLICY search_history_admin_read ON search_history
  FOR SELECT TO authenticated USING (is_admin());
-- Inserts stay open: the fingerprint is generated in the browser and carries no PII.
DROP POLICY IF EXISTS rl_sh_insert ON search_history;
CREATE POLICY search_history_insert ON search_history
  FOR INSERT TO anon, authenticated WITH CHECK (
    char_length(query) BETWEEN 1 AND 200 AND fingerprint IS NOT NULL
  );
-- Readers can remove their own history through the capability function only.
DROP POLICY IF EXISTS rl_sh_delete ON search_history;
CREATE POLICY search_history_admin_delete ON search_history
  FOR DELETE TO authenticated USING (is_admin());

-- ---------------------------------------------------------------------
-- 5. Search indexes
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    CREATE INDEX IF NOT EXISTS idx_posts_title_trgm
      ON posts USING gin (title extensions.gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS idx_posts_excerpt_trgm
      ON posts USING gin (excerpt extensions.gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS idx_products_name_trgm
      ON products USING gin (name extensions.gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS idx_glossary_term_trgm
      ON glossary_terms USING gin (term extensions.gin_trgm_ops);
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE '[lixxon] trigram indexes skipped: %', SQLERRM;
END $$;

CREATE INDEX IF NOT EXISTS idx_posts_tags ON posts USING gin (tags);
CREATE INDEX IF NOT EXISTS idx_products_tags ON products USING gin (tags);
CREATE INDEX IF NOT EXISTS idx_posts_body_fts
  ON posts USING gin (to_tsvector('english', coalesce(title, '') || ' ' || coalesce(content, ''))); 

-- ---------------------------------------------------------------------
-- 6. search_everything() — one ranked query over articles and products
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.search_everything(
  p_query text DEFAULT '',
  p_terms text[] DEFAULT '{}',
  p_kind text DEFAULT 'all',          -- all | article | product
  p_category text DEFAULT NULL,       -- category slug
  p_author text DEFAULT NULL,         -- author slug
  p_tag text DEFAULT NULL,            -- tag (articles) / tag (products)
  p_min_minutes integer DEFAULT NULL,
  p_max_minutes integer DEFAULT NULL,
  p_date_from date DEFAULT NULL,
  p_date_to date DEFAULT NULL,
  p_sort text DEFAULT 'relevance',    -- relevance | newest | most_read
  p_limit integer DEFAULT 12,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  result_kind text,
  id uuid,
  slug text,
  title text,
  excerpt text,
  image_url text,
  category_name text,
  category_slug text,
  author_name text,
  author_slug text,
  published_at timestamptz,
  reading_time_minutes integer,
  price_label text,
  currency text,
  tags text[],
  score real,
  total_count bigint
)
LANGUAGE plpgsql STABLE
SET search_path = public, extensions, pg_temp
AS $fn$
DECLARE
  v_q text := btrim(lower(coalesce(p_query, '')));
  v_terms text[];
  v_has_query boolean;
  v_limit integer := greatest(1, least(coalesce(p_limit, 12), 48));
  v_offset integer := greatest(0, coalesce(p_offset, 0));
  v_sort text := CASE WHEN lower(coalesce(p_sort, 'relevance')) IN ('newest', 'most_read', 'relevance')
                      THEN lower(p_sort) ELSE 'relevance' END;
BEGIN
  -- Every word of the query plus every synonym the client sent.
  SELECT COALESCE(array_agg(DISTINCT t), ARRAY[]::text[]) INTO v_terms
  FROM (
    SELECT btrim(lower(x)) AS t
    FROM unnest(coalesce(p_terms, ARRAY[]::text[]) || string_to_array(v_q, ' ')) AS x
  ) s
  WHERE length(btrim(t)) >= 2;

  v_has_query := cardinality(v_terms) > 0;

  RETURN QUERY
  WITH matches AS (
    -- ---------------------------------------------------------------- articles
    SELECT
      'article'::text AS result_kind,
      p.id, p.slug, p.title,
      COALESCE(p.excerpt, '')::text AS excerpt,
      p.cover_image AS image_url,
      c.name AS category_name, c.slug AS category_slug,
      a.name AS author_name, a.slug AS author_slug,
      p.published_at,
      COALESCE(p.reading_time_minutes, 5) AS reading_time_minutes,
      NULL::text AS price_label, NULL::text AS currency,
      COALESCE(p.tags, ARRAY[]::text[]) AS tags,
      (CASE WHEN NOT v_has_query THEN 0::real ELSE (
        (CASE WHEN lower(p.title) = v_q THEN 6.0 ELSE 0 END)
        + (CASE WHEN v_q <> '' AND lower(p.title) LIKE v_q || '%' THEN 2.0 ELSE 0 END)
        + (CASE WHEN v_q <> '' AND lower(COALESCE(p.slug, '')) = v_q THEN 2.0 ELSE 0 END)
        + 3.0 * COALESCE((SELECT max(public.lx_similarity(p.title, t)) FROM unnest(v_terms) t), 0)
        + 2.5 * COALESCE((SELECT max(public.lx_word_similarity(t, p.title)) FROM unnest(v_terms) t), 0)
        + 1.2 * COALESCE((SELECT max(public.lx_word_similarity(t, COALESCE(p.excerpt, ''))) FROM unnest(v_terms) t), 0)
        + 1.2 * COALESCE((
            SELECT max(public.lx_similarity(COALESCE(tag, ''), t))
            FROM unnest(COALESCE(p.tags, ARRAY[]::text[])) AS tag, unnest(v_terms) t
          ), 0)
        + (CASE WHEN EXISTS (
            SELECT 1 FROM unnest(COALESCE(p.tags, ARRAY[]::text[])) AS tag, unnest(v_terms) t
            WHERE lower(tag) = t
          ) THEN 2.0 ELSE 0 END)
        + (CASE WHEN EXISTS (
            SELECT 1 FROM unnest(v_terms) t
            WHERE to_tsvector('english', t) <> ''::tsvector
              AND to_tsvector('english', COALESCE(p.title, '') || ' ' || COALESCE(p.content, '')) @@ plainto_tsquery('english', t)
          ) THEN 1.0 ELSE 0 END)
      ) END)::real AS score,
      COALESCE((SELECT count(*)::integer FROM article_views av WHERE av.post_id = p.id), 0) AS view_count
    FROM posts p
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN authors a ON a.id = p.author_id
    WHERE p.status = 'published'
      AND (p.published_at IS NULL OR p.published_at <= now())
      AND (p_category IS NULL OR c.slug = p_category)
      AND (p_author IS NULL OR a.slug = p_author)
      AND (p_tag IS NULL OR p_tag = ANY (COALESCE(p.tags, ARRAY[]::text[])))
      AND (p_min_minutes IS NULL OR COALESCE(p.reading_time_minutes, 5) >= p_min_minutes)
      AND (p_max_minutes IS NULL OR COALESCE(p.reading_time_minutes, 5) <= p_max_minutes)
      AND (p_date_from IS NULL OR p.published_at >= p_date_from::timestamptz)
      AND (p_date_to IS NULL OR p.published_at < (p_date_to::timestamptz + interval '1 day'))

    UNION ALL

    -- ---------------------------------------------------------------- products
    SELECT
      'product'::text AS result_kind,
      pr.id, pr.slug, pr.name AS title,
      COALESCE(NULLIF(pr.description, ''), NULLIF(pr.what_it_is, ''), '')::text AS excerpt,
      pr.image_url,
      NULL::text AS category_name, NULL::text AS category_slug,
      NULL::text AS author_name, NULL::text AS author_slug,
      pr.updated_at AS published_at,
      NULL::integer AS reading_time_minutes,
      COALESCE(pr.price, CASE WHEN pr.price_cents IS NOT NULL THEN (pr.price_cents / 100.0)::text END) AS price_label,
      pr.currency,
      COALESCE(pr.tags, ARRAY[]::text[]) AS tags,
      (CASE WHEN NOT v_has_query THEN 0::real ELSE (
        (CASE WHEN lower(pr.name) = v_q THEN 6.0 ELSE 0 END)
        + (CASE WHEN v_q <> '' AND lower(pr.name) LIKE v_q || '%' THEN 2.0 ELSE 0 END)
        + 3.0 * COALESCE((SELECT max(public.lx_similarity(pr.name, t)) FROM unnest(v_terms) t), 0)
        + 2.5 * COALESCE((SELECT max(public.lx_word_similarity(t, pr.name)) FROM unnest(v_terms) t), 0)
        + 1.2 * COALESCE((SELECT max(public.lx_word_similarity(t, COALESCE(pr.description, ''))) FROM unnest(v_terms) t), 0)
        + 1.2 * COALESCE((
            SELECT max(public.lx_similarity(COALESCE(tag, ''), t))
            FROM unnest(COALESCE(pr.tags, ARRAY[]::text[])) AS tag, unnest(v_terms) t
          ), 0)
        + 1.0 * COALESCE((SELECT max(public.lx_word_similarity(t, COALESCE(pr.key_ingredients, ''))) FROM unnest(v_terms) t), 0)
      ) END)::real AS score,
      0 AS view_count
    FROM products pr
    WHERE pr.is_active IS NOT FALSE
      AND (p_kind IS NULL OR lower(p_kind) IN ('all', 'product', 'products'))
      AND (p_tag IS NULL OR p_tag = ANY (COALESCE(pr.tags, ARRAY[]::text[])))
      AND p_category IS NULL AND p_author IS NULL
      AND p_min_minutes IS NULL AND p_max_minutes IS NULL
      AND p_date_from IS NULL AND p_date_to IS NULL
  ), filtered AS (
    SELECT m.* FROM matches m
    WHERE (p_kind IS NULL OR lower(p_kind) = 'all'
           OR (lower(p_kind) IN ('article', 'articles', 'guide', 'guides') AND m.result_kind = 'article')
           OR (lower(p_kind) IN ('product', 'products') AND m.result_kind = 'product'))
      AND (NOT v_has_query OR m.score > 0.32)
  )
  SELECT f.result_kind, f.id, f.slug, f.title, f.excerpt, f.image_url,
         f.category_name, f.category_slug, f.author_name, f.author_slug,
         f.published_at, f.reading_time_minutes, f.price_label, f.currency, f.tags,
         f.score,
         count(*) OVER () AS total_count
  FROM filtered f
  ORDER BY
    CASE WHEN v_sort = 'relevance' AND v_has_query THEN f.score END DESC NULLS LAST,
    CASE WHEN v_sort = 'most_read' THEN f.view_count END DESC NULLS LAST,
    f.published_at DESC NULLS LAST,
    f.title ASC
  LIMIT v_limit OFFSET v_offset;
END $fn$;

GRANT EXECUTE ON FUNCTION public.search_everything(text, text[], text, text, text, text, integer, integer, date, date, text, integer, integer)
  TO anon, authenticated;

-- ---------------------------------------------------------------------
-- 7. Discovery rails
-- ---------------------------------------------------------------------

-- Trending searches: what people searched most in the last two weeks.
CREATE OR REPLACE FUNCTION public.trending_searches(p_limit integer DEFAULT 8)
RETURNS TABLE (query text, searches bigint)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT btrim(lower(sh.query)) AS query, count(*) AS searches
  FROM search_history sh
  WHERE sh.created_at > now() - interval '14 days'
    AND char_length(btrim(sh.query)) BETWEEN 3 AND 60
  GROUP BY 1
  HAVING count(*) >= 2
  ORDER BY searches DESC, 1 ASC
  LIMIT greatest(1, least(coalesce(p_limit, 8), 20))
$fn$;
GRANT EXECUTE ON FUNCTION public.trending_searches(integer) TO anon, authenticated;

-- A reader's own recent searches. The fingerprint is generated in the browser
-- and acts as a capability: no fingerprint, no history.
CREATE OR REPLACE FUNCTION public.recent_searches(p_fingerprint text, p_limit integer DEFAULT 8)
RETURNS TABLE (query text, searched_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT btrim(sh.query), max(sh.created_at) AS searched_at
  FROM search_history sh
  WHERE sh.fingerprint = p_fingerprint
    AND coalesce(p_fingerprint, '') <> ''
  GROUP BY btrim(sh.query)
  ORDER BY searched_at DESC
  LIMIT greatest(1, least(coalesce(p_limit, 8), 20))
$fn$;
GRANT EXECUTE ON FUNCTION public.recent_searches(text, integer) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.forget_searches(p_fingerprint text)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  deleted integer;
BEGIN
  IF coalesce(p_fingerprint, '') = '' THEN
    RETURN 0;
  END IF;
  DELETE FROM search_history WHERE fingerprint = p_fingerprint;
  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN deleted;
END $fn$;
GRANT EXECUTE ON FUNCTION public.forget_searches(text) TO anon, authenticated;

-- People also searched: queries that the same fingerprints ran alongside this one.
CREATE OR REPLACE FUNCTION public.people_also_searched(p_query text, p_limit integer DEFAULT 6)
RETURNS TABLE (query text, shared_readers bigint)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  WITH mine AS (
    SELECT DISTINCT sh.fingerprint
    FROM search_history sh
    WHERE lower(btrim(sh.query)) = lower(btrim(coalesce(p_query, '')))
      AND btrim(coalesce(p_query, '')) <> ''
  ), others AS (
    SELECT btrim(lower(sh.query)) AS q, sh.fingerprint
    FROM search_history sh
    JOIN mine m ON m.fingerprint = sh.fingerprint
    WHERE lower(btrim(sh.query)) <> lower(btrim(coalesce(p_query, '')))
  )
  SELECT q AS query, count(DISTINCT fingerprint) AS shared_readers
  FROM others
  GROUP BY q
  ORDER BY shared_readers DESC, q ASC
  LIMIT greatest(1, least(coalesce(p_limit, 6), 20))
$fn$;
GRANT EXECUTE ON FUNCTION public.people_also_searched(text, integer) TO anon, authenticated;

-- Related articles: shared tags, same category, and people who read both.
-- SECURITY DEFINER so the co-read signal (derived from anonymous view rows) is
-- available to signed-out readers without exposing fingerprints or drafts.
CREATE OR REPLACE FUNCTION public.related_posts(p_post_id uuid, p_limit integer DEFAULT 4)
RETURNS TABLE (
  id uuid, slug text, title text, excerpt text, cover_image text,
  category_name text, category_slug text, reading_time_minutes integer,
  published_at timestamptz, score real, reason text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  WITH source AS (
    SELECT p.id, p.category_id, COALESCE(p.tags, ARRAY[]::text[]) AS tags
    FROM posts p
    WHERE p.id = p_post_id AND p.status = 'published'
  ), co_readers AS (
    SELECT av.post_id, count(DISTINCT av.fingerprint) AS readers
    FROM article_views av
    WHERE av.fingerprint IS NOT NULL
      AND av.post_id <> p_post_id
      AND av.fingerprint IN (
        SELECT fingerprint FROM article_views
        WHERE post_id = p_post_id AND fingerprint IS NOT NULL
      )
    GROUP BY av.post_id
  ), scored AS (
    SELECT
      c.id, c.slug, c.title, COALESCE(c.excerpt, '') AS excerpt, c.cover_image,
      cat.name AS category_name, cat.slug AS category_slug,
      COALESCE(c.reading_time_minutes, 5) AS reading_time_minutes,
      c.published_at,
      (
        (SELECT count(*) FROM unnest(COALESCE(c.tags, ARRAY[]::text[])) t WHERE t = ANY (s.tags)) * 5.0
        + CASE WHEN c.category_id = s.category_id THEN 3.0 ELSE 0 END
        + LEAST(COALESCE(cr.readers, 0), 40) * 0.5
        + CASE WHEN c.featured THEN 0.5 ELSE 0 END
        + CASE WHEN c.editors_pick THEN 0.5 ELSE 0 END
      )::real AS score,
      CASE
        WHEN COALESCE(cr.readers, 0) >= 3 AND NOT (COALESCE(c.tags, ARRAY[]::text[]) && s.tags) THEN 'co-read'
        WHEN COALESCE(c.tags, ARRAY[]::text[]) && s.tags THEN 'tags'
        ELSE 'category'
      END AS reason
    FROM posts c
    CROSS JOIN source s
    LEFT JOIN co_readers cr ON cr.post_id = c.id
    LEFT JOIN categories cat ON cat.id = c.category_id
    WHERE c.status = 'published'
      AND c.id <> s.id
      AND (c.published_at IS NULL OR c.published_at <= now())
  )
  SELECT sc.id, sc.slug, sc.title, sc.excerpt, sc.cover_image,
         sc.category_name, sc.category_slug, sc.reading_time_minutes, sc.published_at,
         sc.score, sc.reason
  FROM scored sc
  WHERE sc.score > 0
  ORDER BY sc.score DESC, sc.published_at DESC NULLS LAST
  LIMIT greatest(1, least(coalesce(p_limit, 4), 12))
$fn$;
GRANT EXECUTE ON FUNCTION public.related_posts(uuid, integer) TO anon, authenticated;

-- ---------------------------------------------------------------------
-- 8. Admin signal: where search fails (content gaps)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.search_gaps(p_limit integer DEFAULT 20)
RETURNS TABLE (query text, searches bigint, zero_result_searches bigint, last_seen timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT btrim(lower(sh.query)) AS query,
         count(*) AS searches,
         count(*) FILTER (WHERE sh.result_count = 0) AS zero_result_searches,
         max(sh.created_at) AS last_seen
  FROM search_history sh
  WHERE sh.created_at > now() - interval '90 days'
    AND btrim(sh.query) <> ''
    AND is_admin()
  GROUP BY 1
  ORDER BY zero_result_searches DESC, searches DESC
  LIMIT greatest(1, least(coalesce(p_limit, 20), 100))
$fn$;
REVOKE ALL ON FUNCTION public.search_gaps(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_gaps(integer) TO authenticated;
