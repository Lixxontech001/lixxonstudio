-- Phase 7 slice 1: a queued door post remembers what happened, so a later run the same day can save its record.
-- A post that went out is never sent again. The later run only saves the record that was missed.
-- Additive. NOT applied to production. Service role only writes the new column.

ALTER TABLE public.minds_door_posts
  ADD COLUMN IF NOT EXISTS pending_status text CHECK (pending_status IS NULL OR pending_status IN ('posted', 'failed'));

-- Keeps the state of a queued row when its record could not be saved. Only queued rows change. Never sends anything.
CREATE OR REPLACE FUNCTION public.minds_mark_door_post_pending(
  p_id uuid,
  p_status text,
  p_external_ref text,
  p_error_note text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_status NOT IN ('posted', 'failed') THEN
    RAISE EXCEPTION 'bad_status' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE public.minds_door_posts
     SET pending_status = p_status,
         external_ref = left(p_external_ref, 120),
         error_note = left(p_error_note, 300)
   WHERE id = p_id AND status = 'queued';
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.minds_mark_door_post_pending(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.minds_mark_door_post_pending(uuid, text, text, text) TO service_role;
