-- Phase 7 slice 2: the pack's picture and video are saved to storage, and their paths are kept on the pack row.
-- A still is a copy of the article's own cover image. A video is a real MP4 made from that picture.
-- Only a storage path is ever stored, never a public address. Service role only writes them.
-- Additive. NOT applied to production.

ALTER TABLE public.minds_packs
  ADD COLUMN IF NOT EXISTS still_path text CHECK (still_path IS NULL OR char_length(still_path) BETWEEN 1 AND 300);

-- A private bucket for the saved stills. pack-videos was created by the podcast migration, and is created here too if it is missing.
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    INSERT INTO storage.buckets (id, name, public)
    VALUES ('pack-stills', 'pack-stills', false)
    ON CONFLICT (id) DO NOTHING;
    INSERT INTO storage.buckets (id, name, public)
    VALUES ('pack-videos', 'pack-videos', false)
    ON CONFLICT (id) DO NOTHING;
  END IF;
END $$;

-- Attaches a saved still and/or video to the packs of one owner, one day and one article.
-- Paths must sit in that owner's folder. A video that was missing turns the pack ready (only when the Auditor allowed it).
-- A pack the owner marked posted is never changed. Returns how many rows changed.
CREATE OR REPLACE FUNCTION public.minds_attach_pack_media(
  p_owner_id uuid,
  p_local_day date,
  p_post_id uuid,
  p_still_path text,
  p_video_path text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  changed integer;
  prefix text := p_owner_id::text || '/';
BEGIN
  IF p_still_path IS NULL AND p_video_path IS NULL THEN
    RAISE EXCEPTION 'nothing_to_attach' USING ERRCODE = 'check_violation';
  END IF;
  IF p_still_path IS NOT NULL AND (left(p_still_path, char_length(prefix)) <> prefix OR p_still_path !~ '\.(jpg|png|webp)$' OR p_still_path LIKE '%..%') THEN
    RAISE EXCEPTION 'bad_still_path' USING ERRCODE = 'check_violation';
  END IF;
  IF p_video_path IS NOT NULL AND (left(p_video_path, char_length(prefix)) <> prefix OR p_video_path !~ '\.mp4$' OR p_video_path LIKE '%..%') THEN
    RAISE EXCEPTION 'bad_video_path' USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.minds_packs
     SET still_path = COALESCE(p_still_path, still_path),
         video_path = COALESCE(p_video_path, video_path),
         status = CASE WHEN p_video_path IS NOT NULL AND status = 'blocked' AND blocked_reason = 'video not made yet' AND auditor_verdict = 'allow'
                       THEN 'ready' ELSE status END,
         blocked_reason = CASE WHEN p_video_path IS NOT NULL AND status = 'blocked' AND blocked_reason = 'video not made yet' AND auditor_verdict = 'allow'
                       THEN NULL ELSE blocked_reason END,
         updated_at = now()
   WHERE owner_id = p_owner_id
     AND local_day = p_local_day
     AND post_id = p_post_id
     AND status <> 'posted_by_owner';
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed;
END;
$$;

REVOKE ALL ON FUNCTION public.minds_attach_pack_media(uuid, date, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.minds_attach_pack_media(uuid, date, uuid, text, text) TO service_role;
