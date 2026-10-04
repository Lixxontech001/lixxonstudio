-- Batch 3: private reading signals and server-side personalisation.
-- Readers never receive direct SELECT/INSERT/UPDATE access to their fingerprint rows;
-- narrowly-scoped SECURITY DEFINER RPCs are the only public access path.

CREATE TABLE IF NOT EXISTS public.reading_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint text NOT NULL CHECK (char_length(fingerprint) BETWEEN 10 AND 64),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  progress_percent smallint NOT NULL DEFAULT 0 CHECK (progress_percent BETWEEN 0 AND 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (fingerprint, post_id)
);
ALTER TABLE public.reading_progress ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE policy_row record;
BEGIN
  FOR policy_row IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'reading_progress'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.reading_progress', policy_row.policyname);
  END LOOP;
END $$;
CREATE POLICY reading_progress_admin_read ON public.reading_progress
  FOR SELECT TO authenticated USING (public.is_admin());
CREATE INDEX IF NOT EXISTS reading_progress_fingerprint_updated_idx
  ON public.reading_progress (fingerprint, updated_at DESC);
CREATE INDEX IF NOT EXISTS reading_progress_post_id_idx
  ON public.reading_progress (post_id);
CREATE INDEX IF NOT EXISTS reading_progress_user_id_idx
  ON public.reading_progress (user_id) WHERE user_id IS NOT NULL;
REVOKE ALL ON public.reading_progress FROM anon, authenticated;
GRANT SELECT ON public.reading_progress TO authenticated;

-- Remove all legacy public read/write policies from reading_sessions (including the
-- v3 re-created anon insert and the original public read/delete policies).
DO $$
DECLARE policy_row record;
BEGIN
  FOR policy_row IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'reading_sessions'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.reading_sessions', policy_row.policyname);
  END LOOP;
END $$;
ALTER TABLE public.reading_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY reading_sessions_admin_read ON public.reading_sessions
  FOR SELECT TO authenticated USING (public.is_admin());
REVOKE ALL ON public.reading_sessions FROM anon, authenticated;
GRANT SELECT ON public.reading_sessions TO authenticated;
CREATE INDEX IF NOT EXISTS reading_sessions_fingerprint_read_date_idx
  ON public.reading_sessions (fingerprint, read_date DESC);

CREATE OR REPLACE FUNCTION public.lx_valid_fingerprint(p text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE
SET search_path = public, pg_temp
AS $fn$
DECLARE v text := btrim(COALESCE(p, ''));
BEGIN
  IF char_length(v) < 10 OR char_length(v) > 64 THEN
    RAISE EXCEPTION 'fingerprint must be 10 to 64 characters' USING ERRCODE = '22023';
  END IF;
  RETURN v;
END
$fn$;

CREATE OR REPLACE FUNCTION public.record_reading_progress(
  p_fingerprint text,
  p_post_id uuid,
  p_progress int
)
RETURNS TABLE (saved boolean, progress_percent smallint, post_slug text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_fingerprint text := public.lx_valid_fingerprint(p_fingerprint);
  v_slug text;
  v_percent smallint;
BEGIN
  SELECT p.slug INTO v_slug
  FROM public.posts p
  WHERE p.id = p_post_id
    AND p.status = 'published'
    AND (p.published_at IS NULL OR p.published_at <= now());
  IF NOT FOUND THEN
    RAISE EXCEPTION 'post is not published' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.reading_progress AS current_row
    (fingerprint, user_id, post_id, progress_percent, created_at, updated_at)
  VALUES
    (v_fingerprint, auth.uid(), p_post_id,
     greatest(0, least(COALESCE(p_progress, 0), 100))::smallint, now(), now())
  ON CONFLICT (fingerprint, post_id) DO UPDATE SET
    progress_percent = greatest(current_row.progress_percent, EXCLUDED.progress_percent),
    user_id = COALESCE(current_row.user_id, EXCLUDED.user_id),
    updated_at = now()
  RETURNING current_row.progress_percent INTO v_percent;

  saved := true;
  progress_percent := v_percent;
  post_slug := v_slug;
  RETURN NEXT;
END
$fn$;

CREATE OR REPLACE FUNCTION public.continue_reading(
  p_fingerprint text,
  p_limit int DEFAULT 3
)
RETURNS TABLE (
  post_id uuid,
  slug text,
  title text,
  cover_image text,
  category_name text,
  reading_time_minutes int,
  progress_percent smallint,
  updated_at timestamptz,
  source text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  WITH args AS (
    SELECT public.lx_valid_fingerprint(p_fingerprint) AS fingerprint
  ), progress_rows AS (
    SELECT rp.post_id AS post_id, p.slug, p.title, p.cover_image,
           c.name AS category_name, COALESCE(p.reading_time_minutes, 5)::int AS reading_time_minutes,
           rp.progress_percent, rp.updated_at, 'progress'::text AS source, 0 AS priority
    FROM public.reading_progress rp
    CROSS JOIN args a
    JOIN public.posts p ON p.id = rp.post_id
    LEFT JOIN public.categories c ON c.id = p.category_id
    WHERE rp.fingerprint = a.fingerprint
      AND rp.progress_percent < 95
      AND p.status = 'published'
      AND (p.published_at IS NULL OR p.published_at <= now())
  ), recent_rows AS (
    SELECT av.post_id AS post_id, p.slug, p.title, p.cover_image,
           c.name AS category_name, COALESCE(p.reading_time_minutes, 5)::int AS reading_time_minutes,
           0::smallint AS progress_percent, max(av.created_at) AS updated_at,
           'recent'::text AS source, 1 AS priority
    FROM public.article_views av
    CROSS JOIN args a
    JOIN public.posts p ON p.id = av.post_id
    LEFT JOIN public.categories c ON c.id = p.category_id
    WHERE av.fingerprint = a.fingerprint
      AND p.status = 'published'
      AND (p.published_at IS NULL OR p.published_at <= now())
      -- A completed progress row must not fall back into the recent arm.
      AND NOT EXISTS (
        SELECT 1 FROM public.reading_progress rp
        WHERE rp.fingerprint = a.fingerprint AND rp.post_id = av.post_id
      )
    GROUP BY av.post_id, p.slug, p.title, p.cover_image, c.name, p.reading_time_minutes
  ), combined AS (
    SELECT * FROM progress_rows
    UNION ALL
    SELECT * FROM recent_rows
  ), deduplicated AS (
    SELECT DISTINCT ON (r.post_id)
      r.post_id AS post_id, r.slug, r.title, r.cover_image, r.category_name,
      r.reading_time_minutes, r.progress_percent, r.updated_at, r.source, r.priority
    FROM combined r
    ORDER BY r.post_id, r.priority, r.updated_at DESC
  )
  SELECT d.post_id, d.slug, d.title, d.cover_image, d.category_name,
         d.reading_time_minutes, d.progress_percent, d.updated_at, d.source
  FROM deduplicated d
  ORDER BY d.priority, d.updated_at DESC
  LIMIT greatest(1, least(COALESCE(p_limit, 3), 10))
$fn$;

CREATE OR REPLACE FUNCTION public.reader_insights(
  p_fingerprint text,
  p_days int DEFAULT 90
)
RETURNS TABLE (
  articles_read int,
  days_active int,
  current_streak int,
  longest_streak int,
  minutes_read int,
  top_categories jsonb,
  first_read_day date,
  last_read_day date
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  WITH args AS (
    SELECT public.lx_valid_fingerprint(p_fingerprint) AS fingerprint,
           greatest(1, least(COALESCE(p_days, 90), 400)) AS days,
           timezone('UTC', now())::date AS today
  ), read_days AS (
    SELECT DISTINCT rs.read_date AS read_date
    FROM public.reading_sessions rs CROSS JOIN args a
    WHERE rs.fingerprint = a.fingerprint
      AND rs.read_date BETWEEN a.today - (a.days - 1) AND a.today
  ), islands AS (
    SELECT d.read_date AS read_date,
           d.read_date - row_number() OVER (ORDER BY d.read_date)::int AS island
    FROM read_days d
  ), streak_groups AS (
    SELECT i.island, min(i.read_date) AS first_day, max(i.read_date) AS last_day,
           count(*)::int AS run_length
    FROM islands i GROUP BY i.island
  ), read_posts AS (
    SELECT p.id AS post_id, p.category_id, COALESCE(p.reading_time_minutes, 5)::int AS minutes
    FROM public.posts p CROSS JOIN args a
    WHERE p.status = 'published'
      AND (p.published_at IS NULL OR p.published_at <= now())
      AND (
        EXISTS (
          SELECT 1 FROM public.article_views av
          WHERE av.post_id = p.id AND av.fingerprint = a.fingerprint
            AND av.created_at >= now() - make_interval(days => a.days)
        )
        OR EXISTS (
          SELECT 1 FROM public.reading_progress rp
          WHERE rp.post_id = p.id AND rp.fingerprint = a.fingerprint
            AND rp.updated_at >= now() - make_interval(days => a.days)
        )
      )
  ), category_counts AS (
    SELECT c.name, c.slug, count(*)::int AS article_count
    FROM read_posts rp JOIN public.categories c ON c.id = rp.category_id
    GROUP BY c.id, c.name, c.slug
    ORDER BY article_count DESC, c.name ASC
    LIMIT 3
  ), totals AS (
    SELECT count(*)::int AS articles_read, COALESCE(sum(rp.minutes), 0)::int AS minutes_read
    FROM read_posts rp
  ), day_totals AS (
    SELECT count(*)::int AS days_active, min(read_date) AS first_day, max(read_date) AS last_day
    FROM read_days
  ), streak_totals AS (
    SELECT COALESCE(max(run_length), 0)::int AS longest_streak,
           COALESCE(max(run_length) FILTER (WHERE last_day >= (SELECT today FROM args) - 1), 0)::int AS current_streak
    FROM streak_groups
  )
  SELECT t.articles_read,
         d.days_active,
         s.current_streak,
         s.longest_streak,
         t.minutes_read,
         COALESCE((
           SELECT jsonb_agg(jsonb_build_object('name', cc.name, 'slug', cc.slug, 'count', cc.article_count)
                            ORDER BY cc.article_count DESC, cc.name ASC)
           FROM category_counts cc
         ), '[]'::jsonb) AS top_categories,
         COALESCE(d.first_day, (SELECT today FROM args)) AS first_read_day,
         COALESCE(d.last_day, (SELECT today FROM args)) AS last_read_day
  FROM totals t CROSS JOIN day_totals d CROSS JOIN streak_totals s
$fn$;

CREATE OR REPLACE FUNCTION public.save_reading_day(
  p_fingerprint text,
  p_post_id uuid DEFAULT NULL
)
RETURNS TABLE (read_day date, current_streak int, days_active int)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_fingerprint text := public.lx_valid_fingerprint(p_fingerprint);
  v_today date := timezone('UTC', now())::date;
BEGIN
  INSERT INTO public.reading_sessions AS current_row
    (fingerprint, read_date, post_id, user_id, created_at)
  VALUES (v_fingerprint, v_today, p_post_id, auth.uid(), now())
  ON CONFLICT (fingerprint, read_date) DO UPDATE SET
    post_id = COALESCE(EXCLUDED.post_id, current_row.post_id),
    user_id = COALESCE(current_row.user_id, EXCLUDED.user_id);

  RETURN QUERY
  WITH days AS (
    SELECT DISTINCT rs.read_date AS read_date
    FROM public.reading_sessions rs
    WHERE rs.fingerprint = v_fingerprint AND rs.read_date <= v_today
  ), islands AS (
    SELECT d.read_date AS read_date,
           d.read_date - row_number() OVER (ORDER BY d.read_date)::int AS island
    FROM days d
  ), runs AS (
    SELECT max(i.read_date) AS last_day, count(*)::int AS run_length
    FROM islands i GROUP BY i.island
  )
  SELECT v_today,
         COALESCE(max(r.run_length) FILTER (WHERE r.last_day >= v_today - 1), 0)::int,
         (SELECT count(*)::int FROM days)
  FROM runs r;
END
$fn$;

CREATE OR REPLACE FUNCTION public.for_you_feed(
  p_fingerprint text,
  p_limit int DEFAULT 6
)
RETURNS TABLE (
  post_id uuid,
  slug text,
  title text,
  excerpt text,
  cover_image text,
  category_name text,
  category_slug text,
  author_name text,
  published_at timestamptz,
  reading_time_minutes int,
  reason text,
  score real
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  WITH args AS (
    SELECT public.lx_valid_fingerprint(p_fingerprint) AS fingerprint
  ), read_posts AS (
    SELECT av.post_id AS post_id
    FROM public.article_views av CROSS JOIN args a
    WHERE av.fingerprint = a.fingerprint AND av.post_id IS NOT NULL
    UNION
    SELECT rp.post_id AS post_id
    FROM public.reading_progress rp CROSS JOIN args a
    WHERE rp.fingerprint = a.fingerprint
  ), signals AS (
    SELECT DISTINCT p.id AS post_id, p.category_id, COALESCE(p.tags, ARRAY[]::text[]) AS tags
    FROM public.posts p CROSS JOIN args a
    WHERE p.status = 'published'
      AND (p.published_at IS NULL OR p.published_at <= now())
      AND (
        EXISTS (
          SELECT 1 FROM public.article_views av
          WHERE av.post_id = p.id AND av.fingerprint = a.fingerprint
            AND av.created_at >= now() - interval '120 days'
        )
        OR EXISTS (
          SELECT 1 FROM public.reading_progress rp
          WHERE rp.post_id = p.id AND rp.fingerprint = a.fingerprint
        )
      )
  ), category_affinity AS (
    SELECT s.category_id, count(*)::int AS weight
    FROM signals s WHERE s.category_id IS NOT NULL
    GROUP BY s.category_id
  ), tag_affinity AS (
    SELECT lower(btrim(t.tag)) AS tag, count(DISTINCT s.post_id)::int AS weight
    FROM signals s CROSS JOIN LATERAL unnest(s.tags) AS t(tag)
    WHERE btrim(t.tag) <> ''
    GROUP BY lower(btrim(t.tag))
  ), candidates AS (
    SELECT p.id AS post_id, p.slug, p.title, COALESCE(p.excerpt, '') AS excerpt,
           p.cover_image, c.name AS category_name, c.slug AS category_slug,
           a.name AS author_name, p.published_at,
           COALESCE(p.reading_time_minutes, 5)::int AS reading_time_minutes,
           ca.weight AS category_weight,
           best_tag.tag AS best_tag,
           best_tag.weight AS best_tag_weight,
           (
             least(COALESCE(ca.weight, 0), 6)
             + least(COALESCE(best_tag.weight, 0), 3) * 1.5
             + CASE WHEN p.featured THEN 0.5 ELSE 0 END
             + CASE WHEN p.editors_pick THEN 0.5 ELSE 0 END
             + (greatest(0, 30 - greatest(0, floor(extract(epoch FROM (now() - COALESCE(p.published_at, now()))) / 86400)::int)) / 30.0) * 1.5
           )::real AS score
    FROM public.posts p
    LEFT JOIN public.categories c ON c.id = p.category_id
    LEFT JOIN public.authors a ON a.id = p.author_id
    LEFT JOIN category_affinity ca ON ca.category_id = p.category_id
    LEFT JOIN LATERAL (
      SELECT ta.tag, ta.weight
      FROM tag_affinity ta
      WHERE lower(btrim(ta.tag)) = ANY (
        SELECT lower(btrim(t)) FROM unnest(COALESCE(p.tags, ARRAY[]::text[])) AS tag_row(t)
      )
      ORDER BY ta.weight DESC, ta.tag ASC
      LIMIT 1
    ) best_tag ON true
    WHERE p.status = 'published'
      AND (p.published_at IS NULL OR p.published_at <= now())
      AND NOT EXISTS (SELECT 1 FROM read_posts r WHERE r.post_id = p.id)
  ), personalized AS (
    SELECT c.post_id AS post_id, c.slug, c.title, c.excerpt, c.cover_image,
           c.category_name, c.category_slug, c.author_name, c.published_at,
           c.reading_time_minutes,
           CASE
             WHEN c.best_tag IS NOT NULL THEN 'More on ' || c.best_tag
             WHEN c.category_weight IS NOT NULL THEN 'Because you read ' || COALESCE(c.category_name, 'this topic')
             ELSE 'Fresh this week'
           END AS reason,
           c.score, 0 AS priority
    FROM candidates c
    WHERE EXISTS (SELECT 1 FROM signals)
      AND c.score > 0
  ), trending AS (
    SELECT c.post_id AS post_id, c.slug, c.title, c.excerpt, c.cover_image,
           c.category_name, c.category_slug, c.author_name, c.published_at,
           c.reading_time_minutes, 'Popular with readers this week'::text AS reason,
           count(av.id)::real AS score, 1 AS priority
    FROM candidates c
    JOIN public.article_views av ON av.post_id = c.post_id
      AND av.created_at >= now() - interval '14 days'
    GROUP BY c.post_id, c.slug, c.title, c.excerpt, c.cover_image, c.category_name,
             c.category_slug, c.author_name, c.published_at, c.reading_time_minutes
    HAVING NOT EXISTS (SELECT 1 FROM personalized pr WHERE pr.post_id = c.post_id)
  ), combined AS (
    SELECT * FROM personalized
    UNION ALL
    SELECT * FROM trending
  )
  SELECT c.post_id, c.slug, c.title, c.excerpt, c.cover_image,
         c.category_name, c.category_slug, c.author_name, c.published_at,
         c.reading_time_minutes, c.reason, c.score
  FROM combined c
  ORDER BY c.priority, c.score DESC, c.published_at DESC NULLS LAST
  LIMIT greatest(1, least(COALESCE(p_limit, 6), 24))
$fn$;

REVOKE ALL ON FUNCTION public.lx_valid_fingerprint(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_reading_progress(text, uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.continue_reading(text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reader_insights(text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_reading_day(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.for_you_feed(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lx_valid_fingerprint(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_reading_progress(text, uuid, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.continue_reading(text, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reader_insights(text, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_reading_day(text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.for_you_feed(text, integer) TO anon, authenticated;
