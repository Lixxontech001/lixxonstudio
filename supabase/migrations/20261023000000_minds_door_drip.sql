-- Phase I slice 5: the drip for the free doors.
-- An article older than the seven-day window may go to a free door when nothing new was published. The day's cap is
-- the table's own rule (post_drip_days_cap: at most three different articles a day), shared with the placement step,
-- so the old archive is never stamped in one hour. A statement that cannot act is refused before anything is inserted.
-- Written by the server only. The owner reads his own rows with the table's existing policy. Additive. NOT applied to production.

CREATE OR REPLACE FUNCTION public.minds_record_drip(
  p_owner_id uuid,
  p_local_day date,
  p_post_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Takeover must be on and no Kill may stop the minds. Same rule as every other live change.
  PERFORM public.minds_assert_can_act();

  IF p_owner_id IS NULL OR p_local_day IS NULL OR p_post_id IS NULL THEN
    RAISE EXCEPTION 'drip_missing_value' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.app_admins WHERE user_id = p_owner_id AND role = 'owner') THEN
    RAISE EXCEPTION 'not_owner' USING ERRCODE = 'check_violation';
  END IF;
  -- Only a published article of the owner's site can be dripped to a door.
  IF NOT EXISTS (SELECT 1 FROM public.posts WHERE id = p_post_id AND status = 'published') THEN
    RAISE EXCEPTION 'drip_not_published' USING ERRCODE = 'check_violation';
  END IF;

  -- The same article twice in one day is already counted, so this is a no-op, never a second stamp.
  IF EXISTS (
    SELECT 1 FROM public.post_drip_days
     WHERE owner_id = p_owner_id AND local_day = p_local_day AND post_id = p_post_id
  ) THEN
    RETURN true;
  END IF;

  -- The table's trigger serialises per owner and day and refuses a fourth different article.
  INSERT INTO public.post_drip_days (owner_id, local_day, post_id)
  VALUES (p_owner_id, p_local_day, p_post_id);

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.minds_record_drip(uuid, date, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.minds_record_drip(uuid, date, uuid) TO service_role;
