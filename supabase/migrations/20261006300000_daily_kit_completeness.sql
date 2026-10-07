-- =============================================================================
-- V16 — Daily Kit completeness: today and tomorrow, per channel and slot, with an
-- attachable video asset, and a way for the owner to record that he posted by hand.
--
-- The kit itself stays exactly as it was: platform-specific copy built from the
-- owner-entered title, excerpt, tags and selected image, one owner approval per
-- channel, `posts.content` never read or written, no AI/provider call, no external
-- publishing. This migration adds only the three things a manual kit was missing:
--
--   1. An attachable per-article video URL (owner-only, https, no credentials) so the
--      video channels can offer a one-tap download and a numbered step list.
--   2. `automation_mark_channel_posted` — the owner's own record that he posted a
--      specific approved copy by hand, per Lagos day and posting slot. It writes to
--      the existing `distribution_log` (status `sent`, no remote id, slot recorded),
--      and it is idempotent per day and slot.
--   3. `automation_daily_kit_state` — a read-only view of today's or tomorrow's marks
--      plus the article's video URL, so the kit can show what is already posted.
--
-- Nothing here can publish, send or edit article prose. A mark is the owner's own
-- statement about an external platform, and the UI says so.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. The attachable video asset.
-- ---------------------------------------------------------------------------
ALTER TABLE posts ADD COLUMN IF NOT EXISTS video_url text
  CHECK (video_url IS NULL OR (video_url ~ '^https://[^[:space:]]+$'
    AND length(video_url) <= 2048
    AND video_url !~* '^https://[^/@]+:[^/@]*@'));

ALTER TABLE distribution_log ADD COLUMN IF NOT EXISTS manual_slot text
  CHECK (manual_slot IS NULL OR manual_slot IN ('morning', 'midday', 'evening'));
ALTER TABLE distribution_log ADD COLUMN IF NOT EXISTS manual_note text
  CHECK (manual_note IS NULL OR length(manual_note) <= 400);
-- The Lagos day a mark is FOR, which is not necessarily the day it was written: the
-- owner may prepare and record tomorrow's kit. Grouping by the write time would move a
-- pre-recorded mark into the wrong day.
ALTER TABLE distribution_log ADD COLUMN IF NOT EXISTS manual_lagos_day date;
ALTER TABLE distribution_log ADD COLUMN IF NOT EXISTS marked_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE distribution_log ADD COLUMN IF NOT EXISTS marked_at timestamptz;
ALTER TABLE distribution_log ADD CONSTRAINT distribution_log_manual_mark_complete
  CHECK (manual_slot IS NULL OR (marked_at IS NOT NULL AND manual_lagos_day IS NOT NULL)) NOT VALID;

-- ---------------------------------------------------------------------------
-- 2. Attach or clear the video for a scheduled/published article.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION automation_attach_article_video(p_post_id uuid, p_video_url text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_url text := NULLIF(btrim(COALESCE(p_video_url, '')), '');
  v_post record;
BEGIN
  IF NOT automation_owner_authorized() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF v_url IS NOT NULL AND (v_url !~ '^https://[^[:space:]]+$' OR length(v_url) > 2048 OR v_url ~* '^https://[^/@]+:[^/@]*@') THEN
    RAISE EXCEPTION 'A public https video URL is required';
  END IF;
  SELECT p.id, p.title INTO v_post FROM posts p
   WHERE p.id = p_post_id AND p.status IN ('scheduled', 'published');
  IF NOT FOUND THEN RAISE EXCEPTION 'A scheduled or published article is required'; END IF;
  UPDATE posts SET video_url = v_url, updated_at = now(), last_edited_by = auth.uid() WHERE id = p_post_id;
  RETURN jsonb_build_object('post_id', p_post_id, 'video_url', v_url, 'attached', v_url IS NOT NULL);
END $$;

-- ---------------------------------------------------------------------------
-- 3. Mark an approved copy as posted by hand, per Lagos day and slot.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION automation_mark_channel_posted(
  p_draft_id uuid, p_slot text, p_lagos_day date DEFAULT NULL, p_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_draft automation_distribution_drafts%ROWTYPE;
  v_day date;
  v_clean_day date := (now() AT TIME ZONE 'Africa/Lagos')::date;
  v_key text;
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_existing distribution_log%ROWTYPE;
  v_row distribution_log%ROWTYPE;
BEGIN
  IF NOT automation_owner_authorized() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF p_slot NOT IN ('morning', 'midday', 'evening') THEN RAISE EXCEPTION 'Unknown posting slot'; END IF;
  IF v_note IS NOT NULL AND length(v_note) > 400 THEN RAISE EXCEPTION 'A posting note is limited to 400 characters'; END IF;

  v_day := COALESCE(p_lagos_day, v_clean_day);
  IF v_day NOT IN (v_clean_day, v_clean_day + 1) THEN
    RAISE EXCEPTION 'Only today or tomorrow in Lagos can be marked';
  END IF;

  SELECT * INTO v_draft FROM automation_distribution_drafts WHERE id = p_draft_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Distribution draft not found'; END IF;
  -- A hand-posted record must always point at the exact owner-approved copy, and the
  -- approved checksum must still be the saved one.
  IF v_draft.review_status NOT IN ('approved', 'sent') OR v_draft.approved_payload_sha256 IS NULL THEN
    RAISE EXCEPTION 'Approve this exact copy before marking it as posted';
  END IF;
  IF v_draft.approved_payload_sha256 IS DISTINCT FROM v_draft.payload_sha256 THEN
    RAISE EXCEPTION 'The copy changed after approval; approve the new version first';
  END IF;

  -- Idempotent per draft, Lagos day and slot: the key keeps the existing format.
  v_key := v_draft.id::text || ':' || encode(extensions.digest(convert_to(
    v_draft.approved_payload_sha256 || ':' || v_day::text || ':' || p_slot, 'UTF8'), 'sha256'), 'hex');

  SELECT * INTO v_existing FROM distribution_log WHERE idempotency_key = v_key;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true, 'mark_id', v_existing.id,
                              'channel_key', v_existing.channel_key, 'slot', v_existing.manual_slot,
                              'lagos_day', v_day, 'marked_at', v_existing.marked_at);
  END IF;

  INSERT INTO distribution_log (
    post_id, channel_key, idempotency_key, approved_payload_sha256, status,
    created_by, completed_at, manual_slot, manual_note, marked_by, marked_at, manual_lagos_day
  ) VALUES (
    v_draft.post_id, v_draft.channel_key, v_key, v_draft.approved_payload_sha256, 'sent',
    auth.uid(), now(), p_slot, v_note, auth.uid(), now(), v_day
  ) RETURNING * INTO v_row;

  RETURN jsonb_build_object('ok', true, 'duplicate', false, 'mark_id', v_row.id,
                            'channel_key', v_row.channel_key, 'slot', v_row.manual_slot,
                            'lagos_day', v_day, 'marked_at', v_row.marked_at);
END $$;

-- ---------------------------------------------------------------------------
-- 4. Today's or tomorrow's kit state: the video URL and the marks already recorded.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION automation_daily_kit_state(p_post_id uuid, p_lagos_day date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public, pg_temp
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Africa/Lagos')::date;
  v_day date := COALESCE(p_lagos_day, (now() AT TIME ZONE 'Africa/Lagos')::date);
BEGIN
  IF NOT admin_can('automation.check') THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF v_day NOT IN (v_today, v_today + 1) THEN
    RAISE EXCEPTION 'Only today or tomorrow in Lagos can be shown';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM posts p WHERE p.id = p_post_id AND p.status IN ('scheduled', 'published')) THEN
    RAISE EXCEPTION 'A scheduled or published article is required';
  END IF;
  RETURN jsonb_build_object(
    'post_id', p_post_id,
    'lagos_day', v_day,
    'is_today', v_day = v_today,
    'video_url', (SELECT p.video_url FROM posts p WHERE p.id = p_post_id),
    'marks', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'channel_key', l.channel_key, 'slot', l.manual_slot, 'note', l.manual_note,
               'marked_at', l.marked_at, 'lagos_day', l.manual_lagos_day, 'kind', 'manual'
             ) ORDER BY l.channel_key, l.manual_slot)
        FROM distribution_log l
       WHERE l.post_id = p_post_id
         AND l.manual_slot IS NOT NULL
         AND l.manual_lagos_day = v_day
    ), '[]'::jsonb)
  );
END $$;

REVOKE ALL ON FUNCTION automation_attach_article_video(uuid, text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION automation_mark_channel_posted(uuid, text, date, text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION automation_daily_kit_state(uuid, date) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION automation_attach_article_video(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION automation_mark_channel_posted(uuid, text, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION automation_daily_kit_state(uuid, date) TO authenticated;

NOTIFY pgrst, 'reload schema';
