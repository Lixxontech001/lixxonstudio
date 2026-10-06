-- V16 assertions: the Daily Kit's video attachment and the owner's hand-posted record.
--
-- The kit's copy generation, checksum approval, quotas and prose isolation are already
-- asserted by distribution-assertions.sql and distribution-safety-assertions.sql.
-- This suite proves the three additions: an attachable video URL, an owner-only
-- idempotent mark per Lagos day and slot, and the read-back that drives the UI.
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION _kit_text(role_name text, claims jsonb, expr text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE result text;
BEGIN
  EXECUTE format('SET LOCAL ROLE %I', role_name);
  PERFORM set_config('request.jwt.claims', claims::text, true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(claims->>'sub', ''), true);
  PERFORM set_config('request.jwt.claim.role', COALESCE(claims->>'role', role_name), true);
  EXECUTE 'SELECT (' || expr || ')::text' INTO result;
  RESET ROLE;
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION _kit_raises(role_name text, claims jsonb, statement text)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE raised boolean := false;
BEGIN
  EXECUTE format('SET LOCAL ROLE %I', role_name);
  PERFORM set_config('request.jwt.claims', claims::text, true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(claims->>'sub', ''), true);
  PERFORM set_config('request.jwt.claim.role', COALESCE(claims->>'role', role_name), true);
  BEGIN
    EXECUTE statement;
  EXCEPTION WHEN others THEN
    raised := true;
  END;
  RESET ROLE;
  RETURN raised;
END $$;

CREATE OR REPLACE FUNCTION _kit_action(role_name text, claims jsonb, statement text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('SET LOCAL ROLE %I', role_name);
  PERFORM set_config('request.jwt.claims', claims::text, true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(claims->>'sub', ''), true);
  PERFORM set_config('request.jwt.claim.role', COALESCE(claims->>'role', role_name), true);
  EXECUTE statement;
  RESET ROLE;
END $$;

DO $$
DECLARE
  v_owner jsonb := '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000001","email":"owner@lixxonstudio.com"}';
  v_editor jsonb := '{"role":"authenticated","sub":"00000000-0000-0000-0000-0000000000e5"}';
  v_reader jsonb := '{"role":"authenticated","sub":"00000000-0000-0000-0000-0000000000d4"}';
  v_anon jsonb := '{"role":"anon"}';
  v_post uuid := '8b000000-0000-0000-0000-000000000001';
  v_draft_post uuid := '8b000000-0000-0000-0000-000000000002';
  v_sentinel text := 'OWNER_ARTICLE_PROSE_NEVER_KIT_8b000000';
  v_today date := (now() AT TIME ZONE 'Africa/Lagos')::date;
  v_when timestamptz := (((now() AT TIME ZONE 'Africa/Lagos')::date + 2 + time '09:00') AT TIME ZONE 'Africa/Lagos');
  v_hash_before text;
  v_hash_after text;
  v_state jsonb;
  v_mark jsonb;
  v_again jsonb;
  v_tomorrow_mark jsonb;
  v_draft_id uuid;
  v_channels integer;
BEGIN
  -- ---------------------------------------------------------------- fixtures
  -- The scheduling trigger reads the session's JWT claims, so the owner identity is
  -- established before any post is written.
  PERFORM set_config('request.jwt.claims', v_owner::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_owner->>'sub', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  INSERT INTO app_admins (user_id, role, is_founder, status)
  VALUES ('00000000-0000-0000-0000-000000000001', 'owner', true, 'active')
  ON CONFLICT (user_id) DO UPDATE SET role = 'owner', is_founder = true, status = 'active';

  INSERT INTO posts (id, title, slug, status, content, excerpt, category_id, tags, cover_image,
                     cover_image_alt, scheduled_at, published_at, seo_title, seo_description)
  VALUES (v_post, 'Kit completeness owner title', 'kit-completeness-owner-title', 'scheduled', v_sentinel,
          'An owner-written excerpt used for the daily kit.', '59d3acce-f83a-46db-84a3-c65f97d68a47',
          ARRAY['kit', 'owner'], 'https://lixxonstudio.com/images/kit-cover.jpg', 'Kit cover alt',
          v_when, v_when, 'Kit completeness owner title', 'An owner-written search description.'),
         (v_draft_post, 'Kit completeness draft title', 'kit-completeness-draft-title', 'draft', 'Draft prose.',
          'Draft excerpt.', '59d3acce-f83a-46db-84a3-c65f97d68a47', ARRAY['kit'],
          'https://lixxonstudio.com/images/kit-draft.jpg', 'Draft cover alt',
          NULL, NULL, 'Kit completeness draft title', 'A draft search description.')
  ON CONFLICT (id) DO NOTHING;

  SELECT md5(content) INTO v_hash_before FROM posts WHERE id = v_post;

  -- ------------------------------------------------- the video attachment rules
  IF NOT _kit_raises('authenticated', v_owner,
       format('SELECT automation_attach_article_video(%L::uuid, %L)', v_post, 'http://example.com/clip.mp4')) THEN
    RAISE EXCEPTION 'a non-https video URL was accepted';
  END IF;
  IF NOT _kit_raises('authenticated', v_owner,
       format('SELECT automation_attach_article_video(%L::uuid, %L)', v_post, 'https://user:secret@example.com/clip.mp4')) THEN
    RAISE EXCEPTION 'a video URL carrying credentials was accepted';
  END IF;
  IF NOT _kit_raises('authenticated', v_owner, format('SELECT automation_attach_article_video(%L::uuid, %L)', v_draft_post, 'https://cdn.lixxonstudio.com/clip.mp4')) THEN
    RAISE EXCEPTION 'a video was attached to an unpublished draft';
  END IF;
  IF NOT _kit_raises('authenticated', v_editor, format('SELECT automation_attach_article_video(%L::uuid, %L)', v_post, 'https://cdn.lixxonstudio.com/clip.mp4')) THEN
    RAISE EXCEPTION 'a non-owner attached a video';
  END IF;
  IF NOT _kit_raises('anon', v_anon, format('SELECT automation_attach_article_video(%L::uuid, %L)', v_post, 'https://cdn.lixxonstudio.com/clip.mp4')) THEN
    RAISE EXCEPTION 'an anonymous caller attached a video';
  END IF;

  PERFORM _kit_action('authenticated', v_owner,
    format('SELECT automation_attach_article_video(%L::uuid, %L)', v_post, 'https://cdn.lixxonstudio.com/kit/clip-vertical.mp4'));
  IF (SELECT video_url FROM posts WHERE id = v_post) <> 'https://cdn.lixxonstudio.com/kit/clip-vertical.mp4' THEN
    RAISE EXCEPTION 'the owner-attached video URL was not stored';
  END IF;
  SELECT md5(content) INTO v_hash_after FROM posts WHERE id = v_post;
  IF v_hash_after IS DISTINCT FROM v_hash_before THEN
    RAISE EXCEPTION 'attaching a video changed article prose';
  END IF;

  -- ---------------------------------------------------------------- kit state
  -- Reading the kit state is a read capability (`automation.check`), exactly like the
  -- distribution snapshot: an admin holding it can look, and every write below is still
  -- owner-only. The reader fixture holds no admin role at all and must be refused.
  IF NOT _kit_raises('authenticated', v_reader,
       format('SELECT automation_daily_kit_state(%L::uuid, %L::date)', v_post, v_today)) THEN
    RAISE EXCEPTION 'a non-admin read the kit state';
  END IF;
  IF NOT _kit_raises('anon', v_anon,
       format('SELECT automation_daily_kit_state(%L::uuid, %L::date)', v_post, v_today)) THEN
    RAISE EXCEPTION 'an anonymous caller read the kit state';
  END IF;
  IF NOT _kit_raises('authenticated', v_owner,
       format('SELECT automation_daily_kit_state(%L::uuid, %L::date)', v_post, v_today - 1)) THEN
    RAISE EXCEPTION 'the kit state was returned for a past day';
  END IF;
  IF NOT _kit_raises('authenticated', v_owner,
       format('SELECT automation_daily_kit_state(%L::uuid, %L::date)', v_post, v_today + 2)) THEN
    RAISE EXCEPTION 'the kit state was returned beyond tomorrow';
  END IF;

  v_state := _kit_text('authenticated', v_owner,
    format('SELECT automation_daily_kit_state(%L::uuid, %L::date)', v_post, v_today))::jsonb;
  IF v_state ->> 'video_url' <> 'https://cdn.lixxonstudio.com/kit/clip-vertical.mp4' THEN
    RAISE EXCEPTION 'the kit state omitted the attached video';
  END IF;
  IF (v_state ->> 'is_today')::boolean IS NOT TRUE OR jsonb_array_length(v_state -> 'marks') <> 0 THEN
    RAISE EXCEPTION 'the fresh kit state was not today with no marks: %', v_state;
  END IF;

  -- ---------------------------------------------------------------- the copy
  PERFORM _kit_action('authenticated', v_owner, format('SELECT automation_prepare_daily_kit(%L::uuid)', v_post));
  SELECT count(*) INTO v_channels FROM automation_distribution_drafts WHERE post_id = v_post;
  IF v_channels <> 13 THEN RAISE EXCEPTION 'the kit did not prepare all 13 channels (got %)', v_channels; END IF;
  SELECT id INTO v_draft_id FROM automation_distribution_drafts WHERE post_id = v_post AND channel_key = 'instagram';

  -- A mark requires the exact owner-approved copy.
  IF NOT _kit_raises('authenticated', v_owner,
       format('SELECT automation_mark_channel_posted(%L::uuid, %L, %L::date)', v_draft_id, 'evening', v_today)) THEN
    RAISE EXCEPTION 'an unapproved copy was marked as posted';
  END IF;
  IF NOT _kit_raises('authenticated', v_owner,
       format('SELECT automation_mark_channel_posted(%L::uuid, %L, %L::date)', v_draft_id, 'midnight', v_today)) THEN
    RAISE EXCEPTION 'an unknown posting slot was accepted';
  END IF;
  IF NOT _kit_raises('authenticated', v_owner,
       format('SELECT automation_mark_channel_posted(%L::uuid, %L, %L::date)', v_draft_id, 'evening', v_today - 1)) THEN
    RAISE EXCEPTION 'a mark was recorded for a past Lagos day';
  END IF;
  IF NOT _kit_raises('authenticated', v_editor,
       format('SELECT automation_mark_channel_posted(%L::uuid, %L, %L::date)', v_draft_id, 'evening', v_today)) THEN
    RAISE EXCEPTION 'a non-owner marked a channel as posted';
  END IF;

  PERFORM _kit_action('authenticated', v_owner,
    format('SELECT automation_approve_distribution_draft(%L::uuid, %L)', v_draft_id,
           (SELECT payload_sha256 FROM automation_distribution_drafts WHERE id = v_draft_id)));
  v_mark := _kit_text('authenticated', v_owner,
    format('SELECT automation_mark_channel_posted(%L::uuid, %L, %L::date, %L)', v_draft_id, 'evening', v_today,
           'Posted by hand from the phone app.'))::jsonb;
  IF COALESCE((v_mark ->> 'ok')::boolean, false) IS NOT TRUE OR (v_mark ->> 'duplicate')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'the first mark was not recorded: %', v_mark;
  END IF;
  IF v_mark ->> 'channel_key' <> 'instagram' OR v_mark ->> 'slot' <> 'evening' THEN
    RAISE EXCEPTION 'the mark recorded the wrong channel or slot: %', v_mark;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM distribution_log l
     WHERE l.post_id = v_post AND l.channel_key = 'instagram' AND l.status = 'sent'
       AND l.manual_slot = 'evening' AND l.marked_at IS NOT NULL
       AND l.marked_by = '00000000-0000-0000-0000-000000000001'::uuid
       AND l.manual_note = 'Posted by hand from the phone app.'
       AND l.manual_lagos_day = v_today
       AND l.remote_post_id IS NULL AND l.remote_url IS NULL
  ) THEN
    RAISE EXCEPTION 'the manual mark was not recorded as a slot-tagged manual receipt';
  END IF;

  -- Idempotent per day and slot, but a second slot is a separate record.
  v_again := _kit_text('authenticated', v_owner,
    format('SELECT automation_mark_channel_posted(%L::uuid, %L, %L::date)', v_draft_id, 'evening', v_today))::jsonb;
  IF (v_again ->> 'duplicate')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 're-marking the same day and slot was not idempotent: %', v_again;
  END IF;
  IF (SELECT count(*) FROM distribution_log WHERE post_id = v_post AND manual_slot = 'evening') <> 1 THEN
    RAISE EXCEPTION 're-marking the same day and slot created a second record';
  END IF;
  PERFORM _kit_action('authenticated', v_owner,
    format('SELECT automation_mark_channel_posted(%L::uuid, %L, %L::date)', v_draft_id, 'morning', v_today));
  IF (SELECT count(*) FROM distribution_log WHERE post_id = v_post AND manual_slot IS NOT NULL) <> 2 THEN
    RAISE EXCEPTION 'a second slot was not recorded separately';
  END IF;

  -- Tomorrow's mark keeps the today view clean.
  v_tomorrow_mark := _kit_text('authenticated', v_owner,
    format('SELECT automation_mark_channel_posted(%L::uuid, %L, %L::date)', v_draft_id, 'midday', v_today + 1))::jsonb;
  IF (v_tomorrow_mark ->> 'lagos_day')::date <> v_today + 1
     OR NOT EXISTS (SELECT 1 FROM distribution_log WHERE post_id = v_post AND manual_slot = 'midday' AND manual_lagos_day = v_today + 1) THEN
    RAISE EXCEPTION 'tomorrow''s mark recorded the wrong Lagos day: %', v_tomorrow_mark;
  END IF;

  v_state := _kit_text('authenticated', v_owner,
    format('SELECT automation_daily_kit_state(%L::uuid, %L::date)', v_post, v_today))::jsonb;
  IF jsonb_array_length(v_state -> 'marks') <> 2 THEN
    RAISE EXCEPTION 'today''s kit state did not list exactly today''s two marks: %', v_state -> 'marks';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_state -> 'marks') m WHERE m ->> 'slot' = 'midday') THEN
    RAISE EXCEPTION 'tomorrow''s mark leaked into today''s kit state';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_state -> 'marks') m
                  WHERE m ->> 'slot' = 'evening' AND m ->> 'note' = 'Posted by hand from the phone app.') THEN
    RAISE EXCEPTION 'the kit state lost the posting note';
  END IF;

  v_state := _kit_text('authenticated', v_owner,
    format('SELECT automation_daily_kit_state(%L::uuid, %L::date)', v_post, v_today + 1))::jsonb;
  IF jsonb_array_length(v_state -> 'marks') <> 1 OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_state -> 'marks') m WHERE m ->> 'slot' <> 'midday') THEN
    RAISE EXCEPTION 'tomorrow''s kit state did not show only tomorrow''s mark: %', v_state -> 'marks';
  END IF;

  -- The kit is still not a publisher, and the prose never moved.
  IF EXISTS (SELECT 1 FROM distribution_log WHERE post_id = v_post AND (remote_post_id IS NOT NULL OR remote_url IS NOT NULL)) THEN
    RAISE EXCEPTION 'a manual mark recorded a provider receipt';
  END IF;
  SELECT md5(content) INTO v_hash_after FROM posts WHERE id = v_post;
  IF v_hash_after IS DISTINCT FROM v_hash_before THEN
    RAISE EXCEPTION 'the kit process changed article prose';
  END IF;

  -- ---------------------------------------------------------------- cleanup
  DELETE FROM distribution_log WHERE post_id = v_post;
  DELETE FROM posts WHERE id = v_post;
  UPDATE posts SET video_url = NULL WHERE id = v_draft_post;
  DELETE FROM posts WHERE id = v_draft_post;
END $$;
