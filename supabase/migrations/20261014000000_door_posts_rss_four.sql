-- Buddy phase 8 slice 4: four RSS doors join the open list: Flipboard, Google News, Microsoft Start and SmartNews.
-- They read the site's RSS feed and ping a free hub. Nothing is posted to them, and no secret is needed.
-- Only the door check and the list of open doors change. The rules stay the same: Takeover off or Kill on is refused,
-- one door send per door per local day, and each article goes to a door once (failed rows count too).
-- Replaces minds_reserve_door_post (last set in 20261011170000_door_posts_all_twelve_open.sql). Additive. NOT applied to production.
-- The four gated channels (Instagram, TikTok, Facebook, Pinterest) are not in this list, and never will be.

ALTER TABLE public.minds_door_posts DROP CONSTRAINT IF EXISTS minds_door_posts_door_check;

ALTER TABLE public.minds_door_posts ADD CONSTRAINT minds_door_posts_door_check CHECK (door IN (
  'telegram', 'bluesky', 'mastodon', 'tumblr', 'discord', 'blogger',
  'medium', 'youtube', 'pixelfed', 'wordpress_com', 'podcast', 'vimeo',
  'flipboard', 'google_news', 'microsoft_start', 'smartnews'
));

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
  IF p_door NOT IN ('telegram', 'discord', 'bluesky', 'mastodon', 'tumblr', 'blogger', 'medium', 'pixelfed', 'wordpress_com', 'youtube', 'vimeo', 'podcast', 'flipboard', 'google_news', 'microsoft_start', 'smartnews') THEN
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

REVOKE ALL ON FUNCTION public.minds_reserve_door_post(uuid, text, uuid, date, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.minds_reserve_door_post(uuid, text, uuid, date, text) TO service_role;
