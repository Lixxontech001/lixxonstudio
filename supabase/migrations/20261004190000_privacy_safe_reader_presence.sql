-- Co-reading/social proof should expose only an aggregate, never visitor fingerprints.
CREATE INDEX IF NOT EXISTS idx_active_readers_post_heartbeat
  ON public.article_active_readers (post_id, last_heartbeat);

-- Remove earlier broad policies. Keep the admin-only policy created by the security
-- hardening migration; authenticated admins may inspect the table, but readers may not.
DROP POLICY IF EXISTS anon_read_active_readers ON public.article_active_readers;
DROP POLICY IF EXISTS anon_insert_active_readers ON public.article_active_readers;
DROP POLICY IF EXISTS anon_update_active_readers ON public.article_active_readers;
DROP POLICY IF EXISTS anon_delete_active_readers ON public.article_active_readers;
DROP POLICY IF EXISTS article_active_readers_public_read ON public.article_active_readers;
DROP POLICY IF EXISTS article_active_readers_anon_insert ON public.article_active_readers;
DROP POLICY IF EXISTS aar_anon_update ON public.article_active_readers;
DROP POLICY IF EXISTS aar_anon_delete ON public.article_active_readers;

REVOKE ALL ON TABLE public.article_active_readers FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.article_active_readers TO authenticated;
GRANT ALL ON TABLE public.article_active_readers TO service_role;

CREATE OR REPLACE FUNCTION public.heartbeat_article_reader(p_post_id uuid, p_fingerprint text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  active_count integer;
BEGIN
  -- Keep the legacy client token format, but bound it before using it as a key.
  IF p_post_id IS NULL
     OR p_fingerprint IS NULL
     OR char_length(p_fingerprint) NOT BETWEEN 4 AND 128
     OR p_fingerprint !~ '^[A-Za-z0-9_-]+$' THEN
    RETURN 0;
  END IF;

  -- Never create public presence for drafts, scheduled posts or deleted content.
  IF NOT EXISTS (
    SELECT 1
    FROM public.posts
    WHERE id = p_post_id
      AND status = 'published'
      AND (published_at IS NULL OR published_at <= now())
  ) THEN
    RETURN 0;
  END IF;

  -- Prune stale rows for this post as it becomes active again.
  DELETE FROM public.article_active_readers
  WHERE post_id = p_post_id
    AND last_heartbeat < now() - interval '24 hours';

  INSERT INTO public.article_active_readers (post_id, fingerprint, last_heartbeat)
  VALUES (p_post_id, p_fingerprint, now())
  ON CONFLICT (post_id, fingerprint) DO UPDATE
    SET last_heartbeat = EXCLUDED.last_heartbeat
    WHERE article_active_readers.last_heartbeat < now() - interval '15 seconds';

  SELECT count(*)::integer
  INTO active_count
  FROM public.article_active_readers
  WHERE post_id = p_post_id
    AND last_heartbeat > now() - interval '5 minutes';

  RETURN COALESCE(active_count, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.heartbeat_article_reader(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.heartbeat_article_reader(uuid, text) TO anon, authenticated;
