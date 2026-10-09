-- Buddy phase 4 slice 5: "I posted this".
-- The owner marks one of his own READY packs as posted by hand. This is a manual mark only. Nothing is posted by the AI,
-- and no Meta, TikTok or Pinterest API is called. Blocked packs cannot be marked, and a marked pack is never changed again
-- by minds_save_pack (it already refuses a posted pack).
-- Takeover and Kill do not gate this mark: it is the owner's own record, not a mind's write.
-- Additive. NOT applied to production.

CREATE OR REPLACE FUNCTION public.minds_mark_pack_posted(p_pack_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  marked_id uuid;
BEGIN
  -- Only the owner (or the founder) signed in as an admin. Anyone else is refused.
  IF auth.uid() IS NULL OR NOT (public.is_admin() AND (public.is_owner() OR public.is_founder())) THEN
    RAISE EXCEPTION 'not_owner' USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE public.minds_packs
     SET status = 'posted_by_owner',
         posted_at = now(),
         updated_at = now()
   WHERE id = p_pack_id
     AND owner_id = auth.uid()
     AND status = 'ready'
  RETURNING id INTO marked_id;

  -- False when the pack is not the owner's, is blocked, or was already marked. Nothing else changes.
  RETURN marked_id IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.minds_mark_pack_posted(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.minds_mark_pack_posted(uuid) TO authenticated;
