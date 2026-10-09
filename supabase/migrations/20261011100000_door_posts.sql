-- Phase 5 slice 3: one row per article per free door, written by the day run only.
-- The owner can read his own rows. Nothing else writes them, except the two functions below (service role).
-- A post is reserved first (a queued row), then sent, then finished. A repeat run cannot send the same article twice.
-- Only the open doors are accepted (Telegram and Discord in this slice). Later slices open more in minds_reserve_door_post.
-- Takeover off or Kill on: the reservation is refused, so nothing is sent. Additive. NOT applied to production.

CREATE TABLE IF NOT EXISTS public.minds_door_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  door text NOT NULL CHECK (door IN ('telegram', 'bluesky', 'mastodon', 'tumblr', 'discord', 'blogger')),
  post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  local_day date NOT NULL,
  article_url text NOT NULL CHECK (char_length(article_url) BETWEEN 1 AND 500),
  status text NOT NULL CHECK (status IN ('queued', 'posted', 'failed')),
  external_ref text CHECK (external_ref IS NULL OR char_length(external_ref) <= 120),
  error_note text CHECK (error_note IS NULL OR char_length(error_note) <= 300),
  posted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, door, post_id),
  CHECK (status <> 'posted' OR posted_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS minds_door_posts_owner_day ON public.minds_door_posts (owner_id, door, local_day);

ALTER TABLE public.minds_door_posts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.minds_door_posts FROM PUBLIC, anon;
GRANT SELECT ON public.minds_door_posts TO authenticated;

DROP POLICY IF EXISTS minds_door_posts_owner_select ON public.minds_door_posts;
CREATE POLICY minds_door_posts_owner_select ON public.minds_door_posts
  FOR SELECT TO authenticated
  USING (owner_id = auth.uid() AND public.is_admin() AND (public.is_owner() OR public.is_founder()));

-- No insert, update or delete policy for signed-in users.

-- Reserve one post. Refused when Takeover is off or Kill stops the minds (minds_assert_can_act).
-- At most one post per owner, per door, per local day. Each article goes to a door once, in any status.
CREATE OR REPLACE FUNCTION public.minds_reserve_door_post(
  p_owner_id uuid,
  p_door text,
  p_post_id uuid,
  p_local_day date,
  p_article_url text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  PERFORM public.minds_assert_can_act();
  IF p_door NOT IN ('telegram', 'discord') THEN
    RAISE EXCEPTION 'door_not_open' USING ERRCODE = 'check_violation';
  END IF;
  IF p_owner_id IS NULL OR p_post_id IS NULL OR p_local_day IS NULL OR p_article_url IS NULL THEN
    RAISE EXCEPTION 'door_post_missing_value' USING ERRCODE = 'check_violation';
  END IF;

  -- One reservation at a time per owner and door, so two runs cannot both pass the day cap.
  PERFORM pg_advisory_xact_lock(hashtext(p_owner_id::text || ':' || p_door));

  IF EXISTS (
    SELECT 1 FROM public.minds_door_posts
    WHERE owner_id = p_owner_id AND door = p_door AND post_id = p_post_id
  ) THEN
    RAISE EXCEPTION 'already_posted' USING ERRCODE = 'unique_violation';
  END IF;

  IF (
    SELECT count(*) FROM public.minds_door_posts
    WHERE owner_id = p_owner_id AND door = p_door AND local_day = p_local_day AND status IN ('queued', 'posted')
  ) >= 1 THEN
    RAISE EXCEPTION 'door_day_cap' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.minds_door_posts (owner_id, door, post_id, local_day, article_url, status)
  VALUES (p_owner_id, p_door, p_post_id, p_local_day, p_article_url, 'queued')
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- Finish a reserved post: posted or failed. Only a queued row can be finished.
CREATE OR REPLACE FUNCTION public.minds_finish_door_post(
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
     SET status = p_status,
         external_ref = left(p_external_ref, 120),
         error_note = left(p_error_note, 300),
         posted_at = CASE WHEN p_status = 'posted' THEN now() ELSE NULL END
   WHERE id = p_id AND status = 'queued';
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.minds_reserve_door_post(uuid, text, uuid, date, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.minds_finish_door_post(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.minds_reserve_door_post(uuid, text, uuid, date, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.minds_finish_door_post(uuid, text, text, text) TO service_role;
