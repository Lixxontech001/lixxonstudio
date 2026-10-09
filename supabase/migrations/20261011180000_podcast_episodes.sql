-- Phase 6 slice 4: the podcast episode table, and the two storage buckets for the podcast and the pack videos.
-- Additive. NOT applied to production.
-- Episodes are written only by the Executioner's send step (service role). Anyone can read them, because the
-- public feed at /podcast.xml lists them. No one else can write, change, or delete a row.

CREATE TABLE IF NOT EXISTS public.podcast_episodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  post_id uuid NOT NULL,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 4000),
  article_url text NOT NULL CHECK (article_url ~ '^https://[^[:space:]]+$' AND char_length(article_url) <= 2048),
  audio_path text NOT NULL CHECK (audio_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.mp3$'),
  audio_bytes bigint NOT NULL CHECK (audio_bytes > 0),
  audio_type text NOT NULL CHECK (audio_type = 'audio/mpeg'),
  published_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT podcast_episodes_one_per_article UNIQUE (owner_id, post_id)
);

ALTER TABLE public.podcast_episodes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS podcast_episodes_public_read ON public.podcast_episodes;
CREATE POLICY podcast_episodes_public_read ON public.podcast_episodes
  FOR SELECT TO anon, authenticated
  USING (true);

REVOKE ALL ON public.podcast_episodes FROM anon, authenticated;
GRANT SELECT ON public.podcast_episodes TO anon, authenticated;

-- Storage buckets. Guarded: they exist only where Supabase storage is present.
-- podcast-audio is public, so the audio has a plain link for the feed. pack-videos is private: only the server reads it.
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    INSERT INTO storage.buckets (id, name, public)
    VALUES ('podcast-audio', 'podcast-audio', true)
    ON CONFLICT (id) DO NOTHING;
    INSERT INTO storage.buckets (id, name, public)
    VALUES ('pack-videos', 'pack-videos', false)
    ON CONFLICT (id) DO NOTHING;
  END IF;
END $$;
