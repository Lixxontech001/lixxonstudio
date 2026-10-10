-- Buddy phase 4 slice 2: the daily content packs for the four gated channels.
-- One row per channel, per local day, per article. Instagram, TikTok, Facebook (Page) and Pinterest only.
-- Nothing here posts anything. The AI never presses Post. "posted_by_owner" is a manual mark by the owner (a later slice).
-- Writes go only through public.minds_save_pack (service role). The owner can read his own packs and nothing else.
-- Products on a pack: at most 3, and each must be a live product slot on that article.
-- A pack the owner has marked posted is never overwritten by a new save.
-- Additive. NOT applied to production.

-- Copy rule, shared by the copy columns: no em or en dash, no Nigeria/Lagos/Naira/Abuja/WAT, US dollars only.
-- Characters are built with chr() so this file stays plain ASCII.
CREATE OR REPLACE FUNCTION public.minds_copy_is_clean(p_text text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_text IS NULL OR (
    p_text !~* '(nigeria|nigerian|lagos|abuja|naira)'
    AND p_text !~ '\mWAT\M'
    AND p_text !~ '\m(NGN|GBP|EUR)\M'
    AND p_text !~ ('[' || chr(8212) || chr(8211) || chr(163) || chr(8364) || chr(8358) || ']')
  )
$$;

CREATE TABLE IF NOT EXISTS public.minds_packs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('instagram', 'tiktok', 'facebook', 'pinterest')),
  local_day date NOT NULL,
  post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  -- Suggested time: stored in UTC, with a plain label such as "Morning, US Eastern". Never the owner's clock.
  suggested_at_utc timestamptz,
  suggested_label text CHECK (suggested_label IS NULL OR (char_length(suggested_label) BETWEEN 1 AND 80 AND public.minds_copy_is_clean(suggested_label))),
  -- Instagram, TikTok and Facebook use caption. Pinterest uses pin_title and pin_description.
  caption text CHECK (caption IS NULL OR (char_length(caption) BETWEEN 1 AND 2200 AND public.minds_copy_is_clean(caption))),
  pin_title text CHECK (pin_title IS NULL OR (char_length(pin_title) BETWEEN 1 AND 100 AND public.minds_copy_is_clean(pin_title))),
  pin_description text CHECK (pin_description IS NULL OR (char_length(pin_description) BETWEEN 1 AND 500 AND public.minds_copy_is_clean(pin_description))),
  article_url text NOT NULL CHECK (char_length(article_url) BETWEEN 1 AND 500),
  image_path text CHECK (image_path IS NULL OR char_length(image_path) BETWEEN 1 AND 300),
  video_path text CHECK (video_path IS NULL OR char_length(video_path) BETWEEN 1 AND 300),
  product_ids uuid[] NOT NULL DEFAULT '{}' CHECK (cardinality(product_ids) <= 3),
  status text NOT NULL CHECK (status IN ('ready', 'blocked', 'posted_by_owner')),
  blocked_reason text CHECK (blocked_reason IS NULL OR char_length(blocked_reason) BETWEEN 1 AND 300),
  auditor_verdict text NOT NULL CHECK (auditor_verdict IN ('allow', 'block')),
  auditor_note text CHECK (auditor_note IS NULL OR char_length(auditor_note) BETWEEN 1 AND 300),
  posted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- One pack per channel, day and article. A second save replaces it (unless the owner marked it posted).
  CONSTRAINT minds_packs_one_per_day UNIQUE (owner_id, channel, local_day, post_id),
  -- A blocked pack must say why. An Auditor block means blocked, never ready.
  CONSTRAINT minds_packs_blocked_reason_rule CHECK (status <> 'blocked' OR blocked_reason IS NOT NULL),
  CONSTRAINT minds_packs_auditor_rule CHECK (auditor_verdict <> 'block' OR status = 'blocked'),
  -- A ready pack needs an Auditor allow, a suggested time, and copy for its channel.
  CONSTRAINT minds_packs_ready_rule CHECK (
    status <> 'ready'
    OR (
      auditor_verdict = 'allow'
      AND suggested_at_utc IS NOT NULL
      AND (
        (channel = 'pinterest' AND pin_title IS NOT NULL AND pin_description IS NOT NULL)
        OR (channel <> 'pinterest' AND caption IS NOT NULL)
      )
    )
  ),
  -- Posted is a manual mark, with a time. Only that status carries a posted time.
  CONSTRAINT minds_packs_posted_rule CHECK ((status = 'posted_by_owner') = (posted_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS minds_packs_owner_day ON public.minds_packs (owner_id, local_day);
CREATE INDEX IF NOT EXISTS minds_packs_post ON public.minds_packs (post_id);

ALTER TABLE public.minds_packs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.minds_packs FROM PUBLIC, anon;
GRANT SELECT ON public.minds_packs TO authenticated;

DROP POLICY IF EXISTS minds_packs_owner_select ON public.minds_packs;
CREATE POLICY minds_packs_owner_select ON public.minds_packs
  FOR SELECT TO authenticated
  USING (owner_id = auth.uid() AND public.is_admin() AND (public.is_owner() OR public.is_founder()));

-- No insert, update or delete policy for signed-in users. Only minds_save_pack writes, with the service role.

-- The one door that writes a pack. Refused when Takeover is off or the Kill rule stops the minds (minds_assert_can_act).
CREATE OR REPLACE FUNCTION public.minds_save_pack(
  p_owner_id uuid,
  p_channel text,
  p_local_day date,
  p_post_id uuid,
  p_suggested_at_utc timestamptz,
  p_suggested_label text,
  p_caption text,
  p_pin_title text,
  p_pin_description text,
  p_article_url text,
  p_image_path text,
  p_video_path text,
  p_product_ids uuid[],
  p_status text,
  p_blocked_reason text,
  p_auditor_verdict text,
  p_auditor_note text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  saved_id uuid;
BEGIN
  PERFORM public.minds_assert_can_act();

  IF NOT EXISTS (SELECT 1 FROM public.app_admins WHERE user_id = p_owner_id AND role = 'owner') THEN
    RAISE EXCEPTION 'not_owner' USING ERRCODE = 'check_violation';
  END IF;
  IF p_channel IS NULL OR p_channel NOT IN ('instagram', 'tiktok', 'facebook', 'pinterest') THEN
    RAISE EXCEPTION 'channel_not_allowed' USING ERRCODE = 'check_violation';
  END IF;
  IF p_local_day IS NULL OR p_post_id IS NULL OR p_article_url IS NULL THEN
    RAISE EXCEPTION 'pack_missing_fields' USING ERRCODE = 'check_violation';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('ready', 'blocked') THEN
    RAISE EXCEPTION 'status_not_allowed' USING ERRCODE = 'check_violation';
  END IF;
  IF p_auditor_verdict IS NULL OR p_auditor_verdict NOT IN ('allow', 'block') THEN
    RAISE EXCEPTION 'verdict_not_allowed' USING ERRCODE = 'check_violation';
  END IF;

  -- Products: at most 3, no repeats, and each one a live product slot on this article for this owner.
  IF COALESCE(cardinality(p_product_ids), 0) > 3 THEN
    RAISE EXCEPTION 'at most 3 products on a pack' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(COALESCE(p_product_ids, '{}')) AS u GROUP BY u HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'repeated_product' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (
    SELECT u FROM unnest(COALESCE(p_product_ids, '{}')) AS u
    EXCEPT
    SELECT s.product_id FROM public.post_product_slots s
     WHERE s.post_id = p_post_id AND s.owner_id = p_owner_id AND s.removed_at IS NULL
  ) THEN
    RAISE EXCEPTION 'slot_missing' USING ERRCODE = 'check_violation';
  END IF;

  PERFORM 1 FROM public.posts WHERE id = p_post_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'article_missing' USING ERRCODE = 'no_data_found';
  END IF;

  -- Copy: no dash, no non-USD money, no country names. Checked on every text field that is set.
  IF NOT (public.minds_copy_is_clean(p_caption) AND public.minds_copy_is_clean(p_pin_title)
          AND public.minds_copy_is_clean(p_pin_description) AND public.minds_copy_is_clean(p_suggested_label)) THEN
    RAISE EXCEPTION 'copy_not_clean' USING ERRCODE = 'check_violation';
  END IF;

  IF p_status = 'ready' THEN
    IF p_auditor_verdict <> 'allow' THEN
      RAISE EXCEPTION 'auditor_blocked' USING ERRCODE = 'check_violation';
    END IF;
    IF p_suggested_at_utc IS NULL THEN
      RAISE EXCEPTION 'time_missing' USING ERRCODE = 'check_violation';
    END IF;
    IF p_channel = 'pinterest' AND (p_pin_title IS NULL OR p_pin_description IS NULL) THEN
      RAISE EXCEPTION 'copy_missing' USING ERRCODE = 'check_violation';
    END IF;
    IF p_channel <> 'pinterest' AND p_caption IS NULL THEN
      RAISE EXCEPTION 'copy_missing' USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    IF p_blocked_reason IS NULL OR btrim(p_blocked_reason) = '' THEN
      RAISE EXCEPTION 'reason_missing' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- One row per channel, day and article. A pack the owner marked posted is never replaced.
  INSERT INTO public.minds_packs (
    owner_id, channel, local_day, post_id, suggested_at_utc, suggested_label, caption, pin_title, pin_description,
    article_url, image_path, video_path, product_ids, status, blocked_reason, auditor_verdict, auditor_note, updated_at
  ) VALUES (
    p_owner_id, p_channel, p_local_day, p_post_id, p_suggested_at_utc, p_suggested_label, p_caption, p_pin_title, p_pin_description,
    p_article_url, p_image_path, p_video_path, COALESCE(p_product_ids, '{}'), p_status,
    CASE WHEN p_status = 'blocked' THEN p_blocked_reason ELSE NULL END, p_auditor_verdict, p_auditor_note, now()
  )
  ON CONFLICT (owner_id, channel, local_day, post_id) DO UPDATE SET
    suggested_at_utc = EXCLUDED.suggested_at_utc,
    suggested_label = EXCLUDED.suggested_label,
    caption = EXCLUDED.caption,
    pin_title = EXCLUDED.pin_title,
    pin_description = EXCLUDED.pin_description,
    article_url = EXCLUDED.article_url,
    image_path = EXCLUDED.image_path,
    video_path = EXCLUDED.video_path,
    product_ids = EXCLUDED.product_ids,
    status = EXCLUDED.status,
    blocked_reason = EXCLUDED.blocked_reason,
    auditor_verdict = EXCLUDED.auditor_verdict,
    auditor_note = EXCLUDED.auditor_note,
    updated_at = now()
  WHERE public.minds_packs.status <> 'posted_by_owner'
  RETURNING id INTO saved_id;

  IF saved_id IS NULL THEN
    RAISE EXCEPTION 'already_posted' USING ERRCODE = 'check_violation';
  END IF;
  RETURN saved_id;
END;
$$;

REVOKE ALL ON FUNCTION public.minds_save_pack(uuid, text, date, uuid, timestamptz, text, text, text, text, text, text, text, uuid[], text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.minds_save_pack(uuid, text, date, uuid, timestamptz, text, text, text, text, text, text, text, uuid[], text, text, text, text) TO service_role;
