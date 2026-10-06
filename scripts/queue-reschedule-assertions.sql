-- V8 assertions: the CEO proposes re-dating the owner's Lagos queue within stated
-- limits, the owner alone applies it, and nothing ever edits prose, changes an
-- article's status or touches a published article.
--
-- The fixture builds two bunched days (two articles each) and picks the earliest
-- empty days in the plan window as targets, so the assertions hold whatever else
-- earlier suites left in the queue. A precondition check fails loudly if some
-- earlier suite ever leaves a bunched day before the fixture days, because that
-- would change which empty day the plan reaches first.
\set ON_ERROR_STOP on
DO $$
DECLARE
  owner jsonb := '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000001","email":"owner@lixxonstudio.com"}';
  p1 uuid := '7a000000-0000-0000-0000-000000000001';  -- scheduled, 5 measured views
  p2 uuid := '7a000000-0000-0000-0000-000000000002';  -- scheduled, 1 view  -> expected mover
  p3 uuid := '7a000000-0000-0000-0000-000000000003';  -- scheduled, 3 views
  d4 uuid := '7a000000-0000-0000-0000-000000000004';  -- draft + queued intake, 0 views -> expected mover
  p5 uuid := '7a000000-0000-0000-0000-000000000005';  -- published, must never move
  at_a1 timestamptz; at_a2 timestamptz; at_b1 timestamptz; at_b2 timestamptz;
  at_p5 timestamptz;
  day_a date; day_b date; day_c date; day_d date;
  v_day date;
  i integer;
  v_plan jsonb; v_run jsonb; v_action uuid; v_result jsonb;
  v_move_a jsonb; v_move_b jsonb;
  v_hash_before text; v_hash_after text;
  v_experiments jsonb;
  v_kill boolean;
  v_block_action uuid; v_audit jsonb; v_raised boolean := false;
  v_stale_action uuid; v_kill_action uuid;
  v_parked_posts jsonb := '[]'::jsonb;
  v_parked_intake jsonb := '[]'::jsonb;
  v_item jsonb;
  v_today date;
  v_park_day date;
BEGIN
  PERFORM set_config('request.jwt.claims', owner::text, true);
  PERFORM set_config('request.jwt.claim.sub', owner->>'sub', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  -- The predictive-security suite auto-engages the kill switch; save the real value,
  -- force it off for the normal scenarios, and restore it at the end.
  SELECT kill_switch INTO v_kill FROM admin_ai_autopilot_settings WHERE id;
  UPDATE admin_ai_autopilot_settings SET kill_switch = false WHERE id;

  -- Earlier suites leave their own scheduled articles and queued intake items in the
  -- queue. To make the choice logic below deterministic they are parked outside the
  -- window first and restored, value for value, at the end of this block.
  v_today := (now() AT TIME ZONE 'Africa/Lagos')::date;
  v_park_day := v_today + 20;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', p.id, 'scheduled_at', p.scheduled_at, 'published_at', p.published_at)), '[]'::jsonb)
    INTO v_parked_posts
    FROM posts p
   WHERE p.status = 'scheduled' AND p.scheduled_at > now()
     AND (p.scheduled_at AT TIME ZONE 'Africa/Lagos')::date BETWEEN v_today + 1 AND v_today + 13;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('post_id', i.post_id, 'proposed_publish_at', i.proposed_publish_at)), '[]'::jsonb)
    INTO v_parked_intake
    FROM article_intake_items i
   WHERE i.intake_status = 'queued'
     AND (i.proposed_publish_at AT TIME ZONE 'Africa/Lagos')::date BETWEEN v_today + 1 AND v_today + 13;
  IF jsonb_array_length(v_parked_posts) > 0 THEN
    UPDATE posts SET status = 'draft', scheduled_at = NULL, published_at = NULL
     WHERE id IN (SELECT (x ->> 'id')::uuid FROM jsonb_array_elements(v_parked_posts) x);
  END IF;
  IF jsonb_array_length(v_parked_intake) > 0 THEN
    UPDATE article_intake_items SET proposed_publish_at = (v_park_day + time '08:00') AT TIME ZONE 'Africa/Lagos'
     WHERE post_id IN (SELECT (x ->> 'post_id')::uuid FROM jsonb_array_elements(v_parked_intake) x);
  END IF;

  -- ---------------------------------------------------------------- fixture days
  FOR i IN 1..13 LOOP
    v_day := v_today + i;
    IF article_intake_lagos_slot_usage(v_day) >= 2 THEN
      RAISE EXCEPTION 'Queue precondition changed: Lagos day % already holds two articles', v_day;
    END IF;
    IF article_intake_lagos_slot_usage(v_day) = 0 THEN
      IF day_a IS NULL THEN day_a := v_day;
      ELSIF day_b IS NULL THEN day_b := v_day;
      ELSIF day_c IS NULL THEN day_c := v_day;
      ELSIF day_d IS NULL THEN day_d := v_day;
      END IF;
    END IF;
  END LOOP;
  IF day_d IS NULL THEN RAISE EXCEPTION 'Not enough empty Lagos days to test re-dating'; END IF;

  at_a1 := (day_a + time '08:00') AT TIME ZONE 'Africa/Lagos';
  at_a2 := (day_a + time '09:00') AT TIME ZONE 'Africa/Lagos';
  at_b1 := (day_b + time '08:00') AT TIME ZONE 'Africa/Lagos';
  at_b2 := (day_b + time '09:00') AT TIME ZONE 'Africa/Lagos';
  at_p5 := now() - interval '5 days';

  INSERT INTO posts (id, title, slug, status, content, scheduled_at, published_at)
  VALUES
    (p1, 'Re-dating fixture one', 're-dating-fixture-one', 'scheduled', 'Prose one stays private.', at_a1, at_a1),
    (p2, 'Re-dating fixture two', 're-dating-fixture-two', 'scheduled', 'Prose two stays private.', at_a2, at_a2),
    (p3, 'Re-dating fixture three', 're-dating-fixture-three', 'scheduled', 'Prose three stays private.', at_b1, at_b1),
    (d4, 'Re-dating fixture draft', 're-dating-fixture-draft', 'draft', 'Draft prose stays private.', NULL, NULL),
    (p5, 'Re-dating fixture published', 're-dating-fixture-published', 'published', 'Published prose stays untouched.', at_p5, at_p5);

  INSERT INTO article_intake_items (post_id, intake_status, source_filename, source_sha256, word_count, proposed_publish_at, created_by)
  VALUES (d4, 'queued', 're-dating-fixture.docx', repeat('d', 64), 4, at_b2, auth.uid());

  INSERT INTO article_views (post_id, created_at)
  SELECT p1, now() - (g || ' days')::interval FROM generate_series(0, 4) g;
  INSERT INTO article_views (post_id, created_at) VALUES (p2, now() - interval '1 day');
  INSERT INTO article_views (post_id, created_at)
  SELECT p3, now() - (g || ' days')::interval FROM generate_series(0, 2) g;

  IF article_intake_lagos_slot_usage(day_a) <> 2 OR article_intake_lagos_slot_usage(day_b) <> 2 THEN
    RAISE EXCEPTION 'the fixture did not create two bunched Lagos days';
  END IF;

  -- ---------------------------------------------------------------- the plan
  SELECT admin_ai_queue_reschedule_plan(14, 3) INTO v_plan;
  IF jsonb_array_length(v_plan -> 'moves') <> 2 THEN
    RAISE EXCEPTION 'expected exactly two moves for the two bunched fixture days, got %', v_plan -> 'moves';
  END IF;
  IF v_plan -> 'limits' ->> 'capacity_per_day' <> '2'
     OR v_plan -> 'limits' ->> 'owner_apply_only' <> 'true'
     OR v_plan -> 'limits' ->> 'published_untouched' <> 'true'
     OR v_plan -> 'limits' ->> 'content_untouched' <> 'true' THEN
    RAISE EXCEPTION 'the plan did not state its limits: %', v_plan -> 'limits';
  END IF;
  IF jsonb_array_length(v_plan -> 'measured_views') = 0 OR NOT (v_plan -> 'metric_keys' ? 'article_views.total') THEN
    RAISE EXCEPTION 'the plan did not cite measured views although views exist';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_plan -> 'moves') m WHERE m ->> 'id' = p5::text) THEN
    RAISE EXCEPTION 'the plan targeted a published article';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_plan -> 'moves') m
              WHERE NULLIF(btrim(COALESCE(m ->> 'reason', '')), '') IS NULL) THEN
    RAISE EXCEPTION 'a move carried no reason';
  END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(v_plan -> 'moves') m)
     <> (SELECT count(DISTINCT m ->> 'to_day') FROM jsonb_array_elements(v_plan -> 'moves') m) THEN
    RAISE EXCEPTION 'two moves shared a target day';
  END IF;

  SELECT m INTO v_move_a FROM jsonb_array_elements(v_plan -> 'moves') m WHERE (m ->> 'from_day')::date = day_a;
  SELECT m INTO v_move_b FROM jsonb_array_elements(v_plan -> 'moves') m WHERE (m ->> 'from_day')::date = day_b;
  IF v_move_a IS NULL OR v_move_b IS NULL THEN RAISE EXCEPTION 'the plan skipped a bunched fixture day'; END IF;
  IF (v_move_a ->> 'id')::uuid <> p2 OR v_move_a ->> 'kind' <> 'post' THEN
    RAISE EXCEPTION 'the plan moved a more-visited article instead of the least-visited one: %', v_move_a;
  END IF;
  IF (v_move_a ->> 'to_day')::date <> day_c THEN
    RAISE EXCEPTION 'the least-visited item did not go to the earliest empty day';
  END IF;
  IF (v_move_a ->> 'to_at')::timestamptz <> ((day_c + time '09:00') AT TIME ZONE 'Africa/Lagos') THEN
    RAISE EXCEPTION 'the move did not keep the item''s own Lagos clock time';
  END IF;
  IF (v_move_b ->> 'id')::uuid <> d4 OR v_move_b ->> 'kind' <> 'intake' THEN
    RAISE EXCEPTION 'the plan did not choose the queued intake item on the second bunched day: %', v_move_b;
  END IF;
  IF (v_move_b ->> 'to_day')::date <> day_d THEN
    RAISE EXCEPTION 'the second move did not go to the next empty day';
  END IF;

  -- ---------------------------------------------------------------- the CEO run
  SELECT COALESCE(jsonb_agg(id), '[]'::jsonb) INTO v_experiments FROM admin_ai_experiments WHERE status = 'draft';
  UPDATE admin_ai_experiments SET status = 'paused' WHERE status = 'draft';
  PERFORM admin_ai_set_agent('ceo', true, 'suggest', 1440, 10, '{}'::jsonb);
  DELETE FROM admin_ai_jobs WHERE agent_key = 'ceo'
    AND idempotency_key = 'agent:ceo:' || to_char(now(), 'YYYY-MM-DD-HH24-MI');
  SELECT admin_ai_run_agent('ceo') INTO v_run;
  IF (v_run ->> 'queued')::integer <> 1 THEN
    RAISE EXCEPTION 'the CEO did not queue exactly one action: %', v_run;
  END IF;
  SELECT id INTO v_action FROM admin_ai_action_queue
   WHERE agent_key = 'ceo' AND action_type = 'queue_reschedule' ORDER BY created_at DESC LIMIT 1;
  IF v_action IS NULL THEN RAISE EXCEPTION 'the CEO did not propose re-dating its bunched queue'; END IF;
  IF (SELECT jsonb_array_length(proposed -> 'moves') FROM admin_ai_action_queue WHERE id = v_action) <> 2 THEN
    RAISE EXCEPTION 'the CEO proposal did not carry the plan''s two moves';
  END IF;
  UPDATE admin_ai_experiments SET status = 'draft'
   WHERE id IN (SELECT (jsonb_array_elements_text(v_experiments))::uuid);

  -- ------------------------------------------- the generic executor cannot move
  SELECT md5(content) INTO v_hash_before FROM posts WHERE id = p2;
  BEGIN PERFORM admin_ai_execute_action(v_action, true); EXCEPTION WHEN others THEN NULL; END;
  IF (SELECT scheduled_at FROM posts WHERE id = p2) <> at_a2 THEN
    RAISE EXCEPTION 'the generic executor moved a scheduled article';
  END IF;
  IF (SELECT status FROM admin_ai_action_queue WHERE id = v_action) = 'applied' THEN
    RAISE EXCEPTION 'the generic executor applied a queue re-dating';
  END IF;
  UPDATE admin_ai_action_queue SET status = 'queued' WHERE id = v_action;

  -- ---------------------------------------------------------------- the apply
  SELECT admin_ai_apply_reschedule(v_action) INTO v_result;
  IF COALESCE((v_result ->> 'ok')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'the owner apply did not report success: %', v_result;
  END IF;
  IF (SELECT scheduled_at FROM posts WHERE id = p2) <> ((day_c + time '09:00') AT TIME ZONE 'Africa/Lagos') THEN
    RAISE EXCEPTION 'the scheduled article was not moved to the proposed day';
  END IF;
  IF (SELECT published_at FROM posts WHERE id = p2) <> (SELECT scheduled_at FROM posts WHERE id = p2) THEN
    RAISE EXCEPTION 'scheduled_at and published_at drifted apart on the moved article';
  END IF;
  IF (SELECT status FROM posts WHERE id = p2) <> 'scheduled' THEN
    RAISE EXCEPTION 'the move changed the article status';
  END IF;
  SELECT md5(content) INTO v_hash_after FROM posts WHERE id = p2;
  IF v_hash_after IS DISTINCT FROM v_hash_before THEN
    RAISE EXCEPTION 'the move edited article prose';
  END IF;
  IF (SELECT proposed_publish_at FROM article_intake_items WHERE post_id = d4)
     <> ((day_d + time '09:00') AT TIME ZONE 'Africa/Lagos') THEN
    RAISE EXCEPTION 'the queued intake item was not moved';
  END IF;
  IF (SELECT status FROM posts WHERE id = d4) <> 'draft' THEN
    RAISE EXCEPTION 'the intake move changed the draft status';
  END IF;
  IF (SELECT scheduled_at FROM posts WHERE id = p5) IS DISTINCT FROM at_p5
     OR (SELECT status FROM posts WHERE id = p5) <> 'published' THEN
    RAISE EXCEPTION 'the published article was touched';
  END IF;
  IF (SELECT status FROM admin_ai_action_queue WHERE id = v_action) <> 'applied' THEN
    RAISE EXCEPTION 'the applied proposal was not marked applied';
  END IF;
  IF jsonb_array_length((SELECT after_state FROM admin_ai_action_queue WHERE id = v_action)) <> 2
     OR jsonb_array_length((SELECT before_state FROM admin_ai_action_queue WHERE id = v_action)) <> 2 THEN
    RAISE EXCEPTION 'the applied proposal did not record what actually moved';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM admin_ai_metrics WHERE metric_key = 'ai_queue_reschedules') THEN
    RAISE EXCEPTION 'the apply was not measured';
  END IF;
  IF article_intake_lagos_slot_usage(day_a) <> 1 OR article_intake_lagos_slot_usage(day_c) <> 1 THEN
    RAISE EXCEPTION 'the applied move did not spread the queue';
  END IF;

  -- ------------------------------------------- a stale proposal is refused
  INSERT INTO admin_ai_action_queue (fingerprint, agent_key, action_type, title, detail, risk, autonomy_level,
                                     required_permission, target_type, proposed, status, created_by)
  VALUES (md5('qr-stale-fixture'), 'ceo', 'queue_reschedule', 'Re-dating stale fixture', 'Fixture', 'low', 'suggest',
          'admin.ai.reports', 'queue',
          jsonb_build_object('moves', jsonb_build_array(jsonb_build_object(
            'kind', 'post', 'id', p3, 'title', 'Re-dating fixture three',
            'from_at', (day_b + time '10:00') AT TIME ZONE 'Africa/Lagos',
            'to_at', (day_d + time '08:00') AT TIME ZONE 'Africa/Lagos', 'reason', 'Fixture move.')),
            'limits', jsonb_build_object('max_moves', 3, 'capacity_per_day', 2)),
          'queued', auth.uid())
  RETURNING id INTO v_stale_action;
  v_raised := false;
  BEGIN PERFORM admin_ai_apply_reschedule(v_stale_action); EXCEPTION WHEN others THEN v_raised := true; END;
  IF NOT v_raised THEN RAISE EXCEPTION 'a stale re-dating proposal was applied'; END IF;
  IF (SELECT scheduled_at FROM posts WHERE id = p3) <> at_b1 THEN
    RAISE EXCEPTION 'the refused stale proposal still moved the article';
  END IF;

  -- ---------------------------------------------------------------- kill switch
  UPDATE admin_ai_autopilot_settings SET kill_switch = true WHERE id;
  INSERT INTO admin_ai_action_queue (fingerprint, agent_key, action_type, title, detail, risk, autonomy_level,
                                     required_permission, target_type, proposed, status, created_by)
  VALUES (md5('qr-kill-fixture'), 'ceo', 'queue_reschedule', 'Re-dating kill-switch fixture', 'Fixture', 'low', 'suggest',
          'admin.ai.reports', 'queue',
          jsonb_build_object('moves', jsonb_build_array(jsonb_build_object(
            'kind', 'post', 'id', p3, 'title', 'Re-dating fixture three',
            'from_at', at_b1, 'to_at', (day_d + time '08:00') AT TIME ZONE 'Africa/Lagos', 'reason', 'Fixture move.')),
            'limits', jsonb_build_object('max_moves', 3, 'capacity_per_day', 2)),
          'queued', auth.uid())
  RETURNING id INTO v_kill_action;
  v_raised := false;
  BEGIN PERFORM admin_ai_apply_reschedule(v_kill_action); EXCEPTION WHEN others THEN v_raised := true; END;
  IF NOT v_raised THEN RAISE EXCEPTION 'the kill switch did not stop a queue re-dating'; END IF;
  UPDATE admin_ai_autopilot_settings SET kill_switch = false WHERE id;

  -- ---------------------------------------------------------------- the Auditor
  -- 1. A move that targets the published article is a hard, un-overridable block.
  INSERT INTO admin_ai_action_queue (fingerprint, agent_key, action_type, title, detail, risk, autonomy_level,
                                     required_permission, target_type, proposed, status, created_by)
  VALUES (md5('qr-block-published'), 'ceo', 'queue_reschedule', 'Re-dating block fixture one', 'Fixture', 'low', 'suggest',
          'admin.ai.reports', 'queue',
          jsonb_build_object('moves', jsonb_build_array(jsonb_build_object(
            'kind', 'post', 'id', p5, 'title', 'Re-dating fixture published',
            'from_at', at_p5, 'to_at', (day_d + time '10:00') AT TIME ZONE 'Africa/Lagos', 'reason', 'Fixture move.')),
            'limits', jsonb_build_object('max_moves', 3, 'capacity_per_day', 2)),
          'queued', auth.uid())
  RETURNING id INTO v_block_action;
  SELECT admin_ai_audit_action(v_block_action) INTO v_audit;
  IF v_audit ->> 'verdict' <> 'blocked' THEN RAISE EXCEPTION 'a move against a published article was not blocked'; END IF;
  IF jsonb_array_length(v_audit -> 'hard_blockers') = 0 THEN
    RAISE EXCEPTION 'the published-article block was not a hard block';
  END IF;
  v_raised := false;
  BEGIN PERFORM admin_ai_override_block(v_block_action, 'I want to move it anyway.'); EXCEPTION WHEN others THEN v_raised := true; END;
  IF NOT v_raised THEN RAISE EXCEPTION 'a hard re-dating block was overridable'; END IF;
  v_raised := false;
  BEGIN PERFORM admin_ai_apply_reschedule(v_block_action); EXCEPTION WHEN others THEN v_raised := true; END;
  IF NOT v_raised THEN RAISE EXCEPTION 'a blocked re-dating proposal was applied'; END IF;
  IF (SELECT scheduled_at FROM posts WHERE id = p5) IS DISTINCT FROM at_p5 THEN
    RAISE EXCEPTION 'a blocked proposal still moved the published article';
  END IF;

  -- 2. A move carrying fields outside the contract is a hard block too.
  INSERT INTO admin_ai_action_queue (fingerprint, agent_key, action_type, title, detail, risk, autonomy_level,
                                     required_permission, target_type, proposed, status, created_by)
  VALUES (md5('qr-block-fields'), 'ceo', 'queue_reschedule', 'Re-dating block fixture two', 'Fixture', 'low', 'suggest',
          'admin.ai.reports', 'queue',
          jsonb_build_object('moves', jsonb_build_array(jsonb_build_object(
            'kind', 'post', 'id', p3, 'title', 'Re-dating fixture three',
            'from_at', at_b1, 'to_at', (day_d + time '11:00') AT TIME ZONE 'Africa/Lagos',
            'content', 'The AI must never smuggle prose into a re-dating move.', 'reason', 'Fixture move.')),
            'limits', jsonb_build_object('max_moves', 3, 'capacity_per_day', 2)),
          'queued', auth.uid())
  RETURNING id INTO v_block_action;
  SELECT admin_ai_audit_action(v_block_action) INTO v_audit;
  IF v_audit ->> 'verdict' <> 'blocked' OR jsonb_array_length(v_audit -> 'hard_blockers') = 0 THEN
    RAISE EXCEPTION 'a re-dating move carrying extra fields was not hard-blocked';
  END IF;

  -- 3. A move landing today is a soft block: it can be overridden with a reason, and
  --    the apply function refuses it anyway, so a written override cannot move it.
  INSERT INTO admin_ai_action_queue (fingerprint, agent_key, action_type, title, detail, risk, autonomy_level,
                                     required_permission, target_type, proposed, status, created_by)
  VALUES (md5('qr-block-today'), 'ceo', 'queue_reschedule', 'Re-dating block fixture three', 'Fixture', 'low', 'suggest',
          'admin.ai.reports', 'queue',
          jsonb_build_object('moves', jsonb_build_array(jsonb_build_object(
            'kind', 'post', 'id', p3, 'title', 'Re-dating fixture three',
            'from_at', at_b1, 'to_at', ((now() AT TIME ZONE 'Africa/Lagos')::date + time '08:00') AT TIME ZONE 'Africa/Lagos',
            'reason', 'Fixture move.')),
            'limits', jsonb_build_object('max_moves', 3, 'capacity_per_day', 2)),
          'queued', auth.uid())
  RETURNING id INTO v_block_action;
  SELECT admin_ai_audit_action(v_block_action) INTO v_audit;
  IF v_audit ->> 'verdict' <> 'blocked' THEN RAISE EXCEPTION 'a move landing today was not blocked'; END IF;
  IF jsonb_array_length(v_audit -> 'hard_blockers') > 0 THEN
    RAISE EXCEPTION 'a move landing today should be a soft, overridable block';
  END IF;
  PERFORM admin_ai_override_block(v_block_action, 'I accept moving this article today.');
  v_raised := false;
  BEGIN PERFORM admin_ai_apply_reschedule(v_block_action); EXCEPTION WHEN others THEN v_raised := true; END;
  IF NOT v_raised THEN RAISE EXCEPTION 'an overridden block still moved an article to today'; END IF;
  IF (SELECT scheduled_at FROM posts WHERE id = p3) <> at_b1 THEN
    RAISE EXCEPTION 'the refused today-move still changed the queue';
  END IF;

  -- ---------------------------------------------------------------- cleanup
  DELETE FROM admin_ai_action_audits WHERE action_id IN (v_action, v_stale_action, v_kill_action)
     OR action_id IN (SELECT id FROM admin_ai_action_queue
                       WHERE fingerprint IN (md5('qr-block-published'), md5('qr-block-fields'), md5('qr-block-today')));
  DELETE FROM admin_ai_action_queue
   WHERE id IN (v_action, v_stale_action, v_kill_action)
      OR fingerprint IN (md5('qr-block-published'), md5('qr-block-fields'), md5('qr-block-today'));
  DELETE FROM posts WHERE id IN (p1, p2, p3, d4, p5);

  -- Restore the earlier suites' queue fixtures exactly as they were. Restoring one
  -- article per day at a time stays inside the two-a-day limit because the counter
  -- excludes the row being written.
  IF jsonb_array_length(v_parked_posts) > 0 THEN
    FOR i IN 0..jsonb_array_length(v_parked_posts) - 1 LOOP
      v_item := v_parked_posts -> i;
      UPDATE posts SET status = 'scheduled',
                       scheduled_at = (v_item ->> 'scheduled_at')::timestamptz,
                       published_at = (v_item ->> 'published_at')::timestamptz
       WHERE id = (v_item ->> 'id')::uuid;
    END LOOP;
  END IF;
  UPDATE admin_ai_autopilot_settings SET kill_switch = COALESCE(v_kill, false) WHERE id;

  IF jsonb_array_length(v_parked_intake) > 0 THEN
    FOR i IN 0..jsonb_array_length(v_parked_intake) - 1 LOOP
      v_item := v_parked_intake -> i;
      UPDATE article_intake_items SET proposed_publish_at = (v_item ->> 'proposed_publish_at')::timestamptz
       WHERE post_id = (v_item ->> 'post_id')::uuid;
    END LOOP;
  END IF;
END $$;
