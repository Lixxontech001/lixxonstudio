-- =============================================================================
-- V8 — the CEO can propose re-dating the owner's written Lagos queue, and only
-- the owner can apply it.
--
-- The Chief Executive now measures the next two weeks of the queue against the
-- same two-a-day Lagos counter the scheduling guard uses, and when one day holds
-- two articles while another is empty it proposes moving the least-visited item
-- into the empty day at the same local clock time. The proposal carries its own
-- limits, its measured basis and a reason per move.
--
-- Boundaries, all enforced in code and proven by the registered assertions:
--   * The CEO proposes; the owner presses Apply schedule. `admin_ai_apply_reschedule`
--     requires `admin.ai.approve` and `content.publish`, honours the independent
--     Auditor's block gate and the kill switch, and refuses a stale proposal.
--   * The apply path is the owner's own calendar path: `posts.scheduled_at` and
--     `posts.published_at` move together through the existing
--     `article_guard_daily_schedule_capacity` trigger, and queued intake items move
--     through the same Lagos capacity counter.
--   * Article prose, article status and every published article are never touched:
--     the apply function re-reads the content checksum around each write and the
--     Auditor hard-blocks any move that targets a non-scheduled post or carries a
--     field outside the re-dating contract.
--   * `admin_ai_execute_action` still does not know this action type, so no generic
--     or automatic path can move a date; the assertion suite proves that too.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. The plan: deterministic, measured, bounded.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION admin_ai_queue_reschedule_plan(p_horizon_days integer DEFAULT 14, p_max_moves integer DEFAULT 3)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public, pg_temp
AS $$
DECLARE
  v_today date;
  v_horizon integer := LEAST(GREATEST(COALESCE(p_horizon_days, 14), 1), 30);
  v_max integer := LEAST(GREATEST(COALESCE(p_max_moves, 3), 1), 5);
  v_start date;
  v_end date;
  v_usage jsonb := '{}'::jsonb;
  v_moved jsonb := '[]'::jsonb;
  v_moves jsonb := '[]'::jsonb;
  v_bunched date;
  v_target date;
  v_pick record;
  v_views_total integer;
  v_measured jsonb;
  v_basis text;
  v_metric_keys jsonb;
BEGIN
  PERFORM admin_ai_require('admin.ai.reports');
  v_today := (now() AT TIME ZONE 'Africa/Lagos')::date;
  v_start := v_today + 1;
  v_end := v_today + v_horizon;

  -- Occupancy per Lagos day straight from the counter the scheduling guard uses.
  SELECT jsonb_object_agg(s.day::text, article_intake_lagos_slot_usage(s.day))
    INTO v_usage
    FROM (SELECT (v_start + g)::date AS day FROM generate_series(0, v_horizon) g) s;

  SELECT count(*) INTO v_views_total FROM article_views WHERE created_at >= now() - interval '30 days';

  FOR v_bunched IN
    SELECT (k.key)::date FROM jsonb_each_text(v_usage) k
     WHERE (k.value)::integer >= 2 ORDER BY 1
  LOOP
    EXIT WHEN jsonb_array_length(v_moves) >= v_max;
    -- Earliest empty day after the bunched one; otherwise the earliest empty day at all.
    SELECT (k.key)::date INTO v_target FROM jsonb_each_text(v_usage) k
     WHERE (k.value)::integer = 0 AND (k.key)::date > v_bunched ORDER BY 1 LIMIT 1;
    IF v_target IS NULL THEN
      SELECT (k.key)::date INTO v_target FROM jsonb_each_text(v_usage) k
       WHERE (k.value)::integer = 0 ORDER BY 1 LIMIT 1;
    END IF;
    IF v_target IS NULL THEN EXIT; END IF;  -- nowhere to spread to

    -- Least-visited movable item on that day, preferring the newest when views tie.
    SELECT * INTO v_pick FROM (
      SELECT 'post'::text AS kind, p.id AS item_id, p.title AS item_title, p.scheduled_at AS at_time,
             COALESCE((SELECT count(*) FROM article_views av WHERE av.post_id = p.id AND av.created_at >= now() - interval '30 days'), 0)::bigint AS views,
             p.created_at AS made_at
        FROM posts p
       WHERE p.status = 'scheduled' AND p.published_at IS NOT NULL AND p.scheduled_at > now()
         AND (p.scheduled_at AT TIME ZONE 'Africa/Lagos')::date = v_bunched
      UNION ALL
      SELECT 'intake', i.post_id, p.title, i.proposed_publish_at,
             COALESCE((SELECT count(*) FROM article_views av WHERE av.post_id = i.post_id AND av.created_at >= now() - interval '30 days'), 0)::bigint,
             i.created_at
        FROM article_intake_items i JOIN posts p ON p.id = i.post_id
       WHERE i.intake_status = 'queued' AND p.status = 'draft'
         AND (i.proposed_publish_at AT TIME ZONE 'Africa/Lagos')::date = v_bunched
    ) e
    WHERE NOT (v_moved ? (e.kind || ':' || e.item_id::text))
    ORDER BY e.views ASC, e.made_at DESC
    LIMIT 1;

    IF v_pick.item_id IS NULL THEN CONTINUE; END IF;  -- nothing movable on that day

    v_moves := v_moves || jsonb_build_object(
      'kind', v_pick.kind,
      'id', v_pick.item_id,
      'title', COALESCE(NULLIF(btrim(v_pick.item_title), ''), 'Untitled'),
      'from_at', v_pick.at_time,
      'to_at', ((v_target + (v_pick.at_time AT TIME ZONE 'Africa/Lagos')::time) AT TIME ZONE 'Africa/Lagos'),
      'from_day', v_bunched,
      'to_day', v_target,
      'reason', format('The %s Lagos day holds two articles while %s is empty; moving the least-visited item keeps the two-a-day limit and evens the queue.',
                       to_char(v_bunched, 'DD Mon'), to_char(v_target, 'DD Mon')));
    v_moved := v_moved || to_jsonb(v_pick.kind || ':' || v_pick.item_id::text);
    v_usage := jsonb_set(v_usage, ARRAY[v_bunched::text], to_jsonb((v_usage ->> v_bunched::text)::integer - 1));
    v_usage := jsonb_set(v_usage, ARRAY[v_target::text], to_jsonb((v_usage ->> v_target::text)::integer + 1));
  END LOOP;

  IF jsonb_array_length(v_moves) > 0 AND v_views_total > 0 THEN
    v_metric_keys := jsonb_build_array('article_views.total');
    SELECT jsonb_agg(jsonb_build_object('title', m ->> 'title', 'views',
             COALESCE((SELECT count(*) FROM article_views av WHERE av.post_id = (m ->> 'id')::uuid AND av.created_at >= now() - interval '30 days'), 0)) ORDER BY m ->> 'title')
      INTO v_measured FROM jsonb_array_elements(v_moves) m;
    v_basis := format('Measured article views over the last 30 days (total %s) plus the deterministic spread rule: move the least-visited item off a day holding two articles into the earliest empty Lagos day, keeping each item''s own clock time. The two-a-day limit is preserved; published articles, draft text and article status are never touched.', v_views_total);
  ELSIF jsonb_array_length(v_moves) > 0 THEN
    v_metric_keys := jsonb_build_array('schedule.slots');
    v_basis := 'Deterministic spread rule: move the least-visited item off a day holding two articles into the earliest empty Lagos day, keeping each item''s own clock time. No article views have been recorded yet in the last 30 days, so the basis is the schedule itself. The two-a-day limit is preserved; published articles, draft text and article status are never touched.';
  ELSE
    v_metric_keys := jsonb_build_array('schedule.slots');
    v_basis := format('No re-dating is needed in the next %s Lagos days: no day holds two articles while an empty day remains.', v_horizon);
  END IF;

  RETURN jsonb_build_object(
    'kind', 'queue_reschedule',
    'moves', v_moves,
    'measured_views', COALESCE(v_measured, '[]'::jsonb),
    'window_start', v_start,
    'window_end', v_end,
    'horizon_days', v_horizon,
    'capacity_per_day', 2,
    'limits', jsonb_build_object(
      'max_moves', v_max, 'capacity_per_day', 2, 'horizon_days', v_horizon,
      'future_only', true, 'published_untouched', true, 'content_untouched', true,
      'status_untouched', true, 'never_publishes', true, 'owner_apply_only', true),
    'basis', v_basis,
    'metric_keys', v_metric_keys);
END $$;

REVOKE ALL ON FUNCTION admin_ai_queue_reschedule_plan(integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_ai_queue_reschedule_plan(integer, integer) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. The owner's apply, on the same path as the owner's own calendar drag.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION admin_ai_apply_reschedule(p_action_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  a admin_ai_action_queue;
  settings admin_ai_autopilot_settings;
  m jsonb;
  v_kind text;
  v_id uuid;
  v_to timestamptz;
  v_day date;
  v_from timestamptz;
  v_title text;
  v_sha_before text;
  v_sha_after text;
  v_before jsonb := '[]'::jsonb;
  v_after jsonb := '[]'::jsonb;
BEGIN
  PERFORM admin_ai_require('admin.ai.approve');
  -- The owner's own publishing capability, exactly as the calendar drag requires.
  IF NOT admin_can('content.publish') THEN
    RAISE EXCEPTION 'Re-dating the queue requires the content.publish capability';
  END IF;
  SELECT * INTO settings FROM admin_ai_autopilot_settings WHERE id;
  IF COALESCE(settings.kill_switch, false) THEN RAISE EXCEPTION 'AI kill switch is active'; END IF;

  SELECT * INTO a FROM admin_ai_action_queue WHERE id = p_action_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Action not found'; END IF;
  IF a.action_type <> 'queue_reschedule' OR a.agent_key <> 'ceo' THEN
    RAISE EXCEPTION 'This is not a CEO queue re-dating proposal';
  END IF;
  IF a.status NOT IN ('queued', 'approved') THEN RAISE EXCEPTION 'Action is %', a.status; END IF;
  IF jsonb_array_length(COALESCE(a.proposed -> 'moves', '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'This proposal carries no moves';
  END IF;

  -- Same independent-Auditor gate as dispatch: the latest verdict decides until the
  -- owner records a written override.
  IF EXISTS (
    SELECT 1 FROM admin_ai_action_audits x
     WHERE x.action_id = a.id
       AND x.verdict = 'blocked'
       AND x.overridden_at IS NULL
       AND x.created_at = (SELECT max(y.created_at) FROM admin_ai_action_audits y WHERE y.action_id = a.id)
  ) THEN
    RAISE EXCEPTION 'Blocked by the independent Auditor: %',
      (SELECT x.blocked_reason FROM admin_ai_action_audits x WHERE x.action_id = a.id ORDER BY x.created_at DESC LIMIT 1);
  END IF;

  FOR m IN SELECT * FROM jsonb_array_elements(a.proposed -> 'moves') LOOP
    v_kind := m ->> 'kind';
    v_id := (m ->> 'id')::uuid;
    v_to := (m ->> 'to_at')::timestamptz;
    v_day := (v_to AT TIME ZONE 'Africa/Lagos')::date;
    IF v_to <= now() OR v_day <= (now() AT TIME ZONE 'Africa/Lagos')::date THEN
      RAISE EXCEPTION 'A proposed date is not a future Lagos day';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtext('lixxon_article_daily_capacity'), (v_day - DATE '2000-01-01')::integer);

    IF v_kind = 'post' THEN
      -- Mirrors the calendar drag: scheduled_at and published_at move together and the
      -- existing capacity/metadata/future guard runs on the way through.
      SELECT p.scheduled_at, p.title INTO v_from, v_title
        FROM posts p WHERE p.id = v_id AND p.status = 'scheduled' AND p.published_at IS NOT NULL FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'A scheduled article in this proposal is no longer scheduled'; END IF;
      IF v_from IS DISTINCT FROM (m ->> 'from_at')::timestamptz THEN
        RAISE EXCEPTION 'This proposal is stale: “%” was already re-dated. Re-run the CEO to refresh it.', v_title;
      END IF;
      SELECT md5(COALESCE(content, '')) INTO v_sha_before FROM posts WHERE id = v_id;
      UPDATE posts SET scheduled_at = v_to, published_at = v_to, updated_at = now() WHERE id = v_id AND status = 'scheduled';
      IF NOT FOUND THEN RAISE EXCEPTION 'A scheduled article in this proposal is no longer scheduled'; END IF;
      SELECT md5(COALESCE(content, '')) INTO v_sha_after FROM posts WHERE id = v_id;
      IF v_sha_after IS DISTINCT FROM v_sha_before THEN RAISE EXCEPTION 'Article text changed during the move'; END IF;
    ELSIF v_kind = 'intake' THEN
      -- Queued intake metadata only; the draft and its prose are untouched.
      SELECT i.proposed_publish_at, p.title INTO v_from, v_title
        FROM article_intake_items i JOIN posts p ON p.id = i.post_id
       WHERE i.post_id = v_id AND i.intake_status = 'queued' AND p.status = 'draft' FOR UPDATE OF i;
      IF NOT FOUND THEN RAISE EXCEPTION 'A queued intake item in this proposal is no longer queued'; END IF;
      IF v_from IS DISTINCT FROM (m ->> 'from_at')::timestamptz THEN
        RAISE EXCEPTION 'This proposal is stale: “%” was already re-dated. Re-run the CEO to refresh it.', v_title;
      END IF;
      IF article_intake_lagos_slot_usage(v_day, v_id) >= 2 THEN
        RAISE EXCEPTION 'The two-article Lagos daily limit is already reached for %', v_day;
      END IF;
      SELECT md5(COALESCE(p.content, '')) INTO v_sha_before FROM posts p WHERE p.id = v_id;
      UPDATE article_intake_items SET proposed_publish_at = v_to, updated_by = auth.uid(), updated_at = now()
       WHERE post_id = v_id AND intake_status = 'queued';
      IF NOT FOUND THEN RAISE EXCEPTION 'A queued intake item in this proposal is no longer queued'; END IF;
      SELECT md5(COALESCE(p.content, '')) INTO v_sha_after FROM posts p WHERE p.id = v_id;
      IF v_sha_after IS DISTINCT FROM v_sha_before THEN RAISE EXCEPTION 'Draft text changed during the move'; END IF;
    ELSE
      RAISE EXCEPTION 'Unknown move kind %', v_kind;
    END IF;

    v_before := v_before || jsonb_build_object('kind', v_kind, 'id', v_id, 'title', v_title, 'at', v_from);
    v_after := v_after || jsonb_build_object('kind', v_kind, 'id', v_id, 'title', v_title, 'from', v_from, 'to', v_to, 'day', v_day);
  END LOOP;

  INSERT INTO admin_ai_metrics(metric_key, value, dimensions, source)
  VALUES ('ai_queue_reschedules', 1, jsonb_build_object('moves', jsonb_array_length(v_after)), 'rule');

  UPDATE admin_ai_action_queue
     SET status = 'applied',
         approved_by = COALESCE(approved_by, auth.uid()), approved_at = COALESCE(approved_at, now()),
         applied_by = auth.uid(), applied_at = now(),
         before_state = v_before, after_state = v_after,
         decision_note = format('Applied by the owner: %s move(s) on the Lagos queue. Article text, article status and every published article were left untouched.', jsonb_array_length(v_after))
   WHERE id = a.id;

  RETURN jsonb_build_object('ok', true, 'status', 'applied', 'moves', v_after,
                            'content_unchanged', true, 'published_untouched', true);
EXCEPTION WHEN others THEN
  UPDATE admin_ai_action_queue SET status = 'failed', decision_note = SQLERRM WHERE id = p_action_id;
  RAISE;
END $$;

REVOKE ALL ON FUNCTION admin_ai_apply_reschedule(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_ai_apply_reschedule(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. The Auditor, rebuilt from the latest definition (20261006280000) with the
--    re-dating rules above. Every other rule is preserved verbatim.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION admin_ai_audit_action(p_action_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  a admin_ai_action_queue;
  blockers jsonb := '[]'::jsonb;
  hard_blockers jsonb := '[]'::jsonb;
  fixes jsonb := '[]'::jsonb;
  warnings jsonb := '[]'::jsonb;
  verdict text;
  v_reason text;
  v_fix text;
BEGIN
  PERFORM admin_ai_require('admin.ai.approve');
  SELECT * INTO a FROM admin_ai_action_queue WHERE id = p_action_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Action not found'; END IF;

  -- Independence: the Auditor cannot judge its own proposal, and both identities
  -- are recorded so the separation is provable after the fact.
  IF a.agent_key = 'auditor' THEN
    RAISE EXCEPTION 'The Auditor cannot review its own proposal';
  END IF;

  IF a.proposed IS NULL OR a.proposed = '{}'::jsonb THEN
    blockers := blockers || to_jsonb('No proposal content to review'::text);
    fixes := fixes || to_jsonb('Re-run the agent that produced this proposal so it is queued with its content, or reject it.'::text);
  END IF;
  IF lower(COALESCE(a.proposed::text, '')) ~ '(password|service.role|secret|api.key|private.key|bearer )' THEN
    hard_blockers := hard_blockers || to_jsonb('Possible secret or credential exposure'::text);
    blockers := blockers || to_jsonb('Possible secret or credential exposure'::text);
    fixes := fixes || to_jsonb('Remove the credential text from the proposal and store the value in the Keys page instead. This block cannot be overridden.'::text);
  END IF;
  IF a.action_type ~* '(publish|post_now|send|email_campaign|newsletter|approve_all)' THEN
    hard_blockers := hard_blockers || to_jsonb('External publishing or sending is not an auditable automation action'::text);
    blockers := blockers || to_jsonb('External publishing or sending is not an auditable automation action'::text);
    fixes := fixes || to_jsonb('Prepare a draft for owner approval instead of publishing or sending automatically. This block cannot be overridden.'::text);
  END IF;
  IF a.agent_key IN ('analyst','strategist','ceo','auditor','executioner','chief_of_staff')
     AND a.autonomy_level = 'auto_apply' THEN
    hard_blockers := hard_blockers || to_jsonb('Boardroom agents may not operate with auto_apply autonomy'::text);
    blockers := blockers || to_jsonb('Boardroom agents may not operate with auto_apply autonomy'::text);
    fixes := fixes || to_jsonb('Set this agent''s autonomy back to "suggest" in the Agents tab. This block cannot be overridden.'::text);
  END IF;
  IF a.action_type IN ('experiment_proposal','experiment_start','strategy_brief','analytics_brief','operations_digest','queue_reschedule') THEN
    IF NOT (a.proposed ? 'basis' OR a.proposed ? 'evidence' OR a.proposed ? 'metric_keys') THEN
      blockers := blockers || to_jsonb('No measured basis, evidence or metric keys are attached'::text);
      fixes := fixes || to_jsonb('Re-run the agent so it attaches its measured basis and metric keys, then review it again.'::text);
    ELSIF NOT (a.proposed ? 'basis') AND jsonb_array_length(COALESCE(a.proposed -> 'metric_keys', '[]'::jsonb)) = 0 THEN
      blockers := blockers || to_jsonb('The claim cites no metric keys'::text);
      fixes := fixes || to_jsonb('Attach the metric keys the claim came from (for example article_views.total) before re-review.'::text);
    END IF;
  END IF;
  -- Commerce protection (V32): no agent proposal may carry a commerce MUTATION.
  -- Reading is fine — the Analyst legitimately reports refund counts and revenue
  -- figures — so this matches mutation-shaped keys or an imperative verb applied to
  -- a commercial object, never a bare noun.
  IF lower(COALESCE(a.proposed::text, '')) ~ '(new_price|set_price|price_change|update_price|change_price|refund_amount|issue_refund|process_refund|payment_status|mark_paid|discount_percent|apply_discount|coupon_code|amount_due|new_amount|set_amount)'
     OR lower(COALESCE(a.proposed::text, '')) ~ '(set|change|update|apply|issue|process|mark|raise|lower)[^.]{0,24}(price|pricing|refund|discount|coupon|payment status|amount due)' THEN
    blockers := blockers || to_jsonb('This proposal appears to change a price, refund, discount or payment value'::text);
    fixes := fixes || to_jsonb('Prices, products, refunds and payment state are owner-only. Remove the commercial change from the proposal and edit the product or order directly in admin.'::text);
  END IF;
  -- V8 — a queue re-dating proposal is held to its stated limits, and it can never
  -- carry an edit, a deletion or a publication.
  IF a.action_type = 'queue_reschedule' THEN
    IF COALESCE(a.agent_key, '') <> 'ceo' THEN
      blockers := blockers || to_jsonb('Only the CEO may propose re-dating the owner''s queue'::text);
      fixes := fixes || to_jsonb('Queue re-dating must come from the CEO agent. Reject this proposal.'::text);
    END IF;
    IF jsonb_array_length(COALESCE(a.proposed -> 'moves', '[]'::jsonb)) = 0 THEN
      blockers := blockers || to_jsonb('The re-dating proposal carries no moves'::text);
      fixes := fixes || to_jsonb('Re-run the CEO so it attaches at least one concrete move, or reject the empty proposal.'::text);
    END IF;
    IF NOT (a.proposed ? 'limits') THEN
      blockers := blockers || to_jsonb('The re-dating proposal states no limits'::text);
      fixes := fixes || to_jsonb('Re-run the CEO: every re-dating proposal must carry its limits (two a day, the window, future-only, published untouched).'::text);
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(COALESCE(a.proposed -> 'moves', '[]'::jsonb)) m
       WHERE m ->> 'to_at' IS NULL OR (m ->> 'to_at')::timestamptz <= now()
    ) THEN
      blockers := blockers || to_jsonb('A proposed re-dating date is not in the future'::text);
      fixes := fixes || to_jsonb('Re-run the CEO to refresh the proposal against today''s Lagos calendar.'::text);
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(COALESCE(a.proposed -> 'moves', '[]'::jsonb)) m
       WHERE (m ->> 'kind') NOT IN ('post', 'intake')
          OR NULLIF(btrim(COALESCE(m ->> 'reason', '')), '') IS NULL
          OR (m ->> 'to_at') IS NULL
          OR ((m ->> 'to_at')::timestamptz AT TIME ZONE 'Africa/Lagos')::date
             <= (now() AT TIME ZONE 'Africa/Lagos')::date
    ) THEN
      blockers := blockers || to_jsonb('A move is malformed, has no reason, or would land today or earlier'::text);
      fixes := fixes || to_jsonb('Re-run the CEO so every move names a type, a target and a reason and lands on a later Lagos day.'::text);
    END IF;
    -- Hard blocks: nothing may ride along that edits prose, changes status or touches a
    -- published or draft article. This is the "never edits, deletes or publishes" line.
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(COALESCE(a.proposed -> 'moves', '[]'::jsonb)) m
       WHERE EXISTS (
         SELECT 1 FROM jsonb_object_keys(m) k
          WHERE k NOT IN ('kind', 'id', 'title', 'from_at', 'to_at', 'from_day', 'to_day', 'reason')
       )
    ) THEN
      hard_blockers := hard_blockers || to_jsonb('A re-dating move carries fields outside the re-dating contract'::text);
      blockers := blockers || to_jsonb('A re-dating move carries fields outside the re-dating contract'::text);
      fixes := fixes || to_jsonb('A re-dating move may only carry kind, id, title, from_at, to_at, from_day, to_day and a reason. Remove the extra fields and re-run the CEO. This block cannot be overridden.'::text);
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(COALESCE(a.proposed -> 'moves', '[]'::jsonb)) m
       LEFT JOIN posts p ON m ->> 'kind' = 'post' AND p.id = (m ->> 'id')::uuid
       WHERE m ->> 'kind' = 'post'
         AND (p.id IS NULL OR p.status <> 'scheduled')
    ) THEN
      hard_blockers := hard_blockers || to_jsonb('The proposal would move an article that is not an unpublished scheduled post'::text);
      blockers := blockers || to_jsonb('The proposal would move an article that is not an unpublished scheduled post'::text);
      fixes := fixes || to_jsonb('Only scheduled, unpublished posts and queued intake items may be re-dated. Published articles and drafts are never moved by the AI. This block cannot be overridden.'::text);
    END IF;
    IF (SELECT count(DISTINCT ((m ->> 'to_at')::timestamptz AT TIME ZONE 'Africa/Lagos')::date)
          FROM jsonb_array_elements(COALESCE(a.proposed -> 'moves', '[]'::jsonb)) m)
       <> jsonb_array_length(COALESCE(a.proposed -> 'moves', '[]'::jsonb)) THEN
      blockers := blockers || to_jsonb('Two moves would land on the same Lagos day'::text);
      fixes := fixes || to_jsonb('Re-run the CEO: each move must land on its own day so the two-a-day limit cannot be exceeded.'::text);
    END IF;
    IF jsonb_array_length(COALESCE(a.proposed -> 'moves', '[]'::jsonb)) >
       COALESCE((a.proposed -> 'limits' ->> 'max_moves')::integer, 3) THEN
      blockers := blockers || to_jsonb('The proposal carries more moves than its own limit allows'::text);
      fixes := fixes || to_jsonb('Re-run the CEO so it proposes at most the number of moves its limits state.'::text);
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM admin_ai_autopilot_settings WHERE id AND kill_switch)
     AND a.action_type IN ('experiment_start','analyze') THEN
    blockers := blockers || to_jsonb('The AI kill switch is active'::text);
    fixes := fixes || to_jsonb('Turn the kill switch off in the control room before this action can run.'::text);
  END IF;
  IF a.risk = 'critical' THEN
    warnings := warnings || to_jsonb('Marked critical risk'::text);
  END IF;
  IF lower(COALESCE(a.proposed::text, '')) ~ '(cure|guaranteed|treats|prevents disease)' THEN
    warnings := warnings || to_jsonb('Health claim requires a cited human review'::text);
  END IF;

  verdict := CASE WHEN jsonb_array_length(blockers) > 0 THEN 'blocked'
                  WHEN jsonb_array_length(warnings) > 0 THEN 'concern'
                  ELSE 'clear' END;
  v_reason := CASE WHEN verdict = 'blocked' THEN blockers ->> 0 ELSE NULL END;
  v_fix := CASE WHEN verdict = 'blocked' THEN fixes ->> 0 ELSE NULL END;

  INSERT INTO admin_ai_action_audits (action_id, reviewer_agent, proposer_agent, verdict, findings, blocked_reason, created_by)
  VALUES (a.id, 'auditor', a.agent_key, verdict,
          jsonb_build_object('blockers', blockers, 'hard_blockers', hard_blockers, 'fixes', fixes, 'warnings', warnings),
          v_reason, auth.uid());

  IF verdict = 'blocked' THEN
    -- The fix is shown exactly where the block is displayed, in plain English.
    UPDATE admin_ai_action_queue
       SET status = CASE WHEN status IN ('applied','rejected') THEN status ELSE 'paused' END,
           decision_note = 'Blocked by the independent Auditor: ' || COALESCE(v_reason, 'policy exception')
             || CASE WHEN v_fix IS NOT NULL THEN '. Fix: ' || v_fix ELSE '' END
     WHERE id = a.id;
  END IF;

  RETURN jsonb_build_object('action_id', a.id, 'verdict', verdict, 'proposer_agent', a.agent_key,
                            'blockers', blockers, 'hard_blockers', hard_blockers,
                            'fixes', fixes, 'warning_fixes', jsonb_build_array(),
                            'warnings', warnings);
END $$;

REVOKE ALL ON FUNCTION admin_ai_audit_action(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_ai_audit_action(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION admin_ai_run_agent(p_agent_key text, p_mission_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  a admin_ai_agents;
  job uuid;
  n integer := 0;
  row record;
  action_id uuid;
  facts jsonb;
  metrics jsonb;
  summary text;
  v_signal jsonb;
  v_experiment uuid;
  v_hypothesis text;
  v_metric_key text;
  v_label text;
  v_plan jsonb;
  v_blocked integer := 0;
  v_concern integer := 0;
  v_links jsonb := '[]'::jsonb;
  v_pending integer := 0;
  v_reviews integer := 0;
  idem text;
BEGIN
  PERFORM admin_ai_require('admin.ai.run');
  SELECT * INTO a
    FROM admin_ai_agents
   WHERE agent_key = lower(btrim(p_agent_key))
     AND enabled
     AND autonomy_level <> 'disabled';
  IF NOT FOUND THEN RAISE EXCEPTION 'Agent is disabled or unknown'; END IF;

  IF a.agent_key IN ('analyst','strategist','ceo','auditor','executioner','chief_of_staff')
     AND a.autonomy_level <> 'suggest' THEN
    RAISE EXCEPTION 'Boardroom agents are suggestion-only';
  END IF;

  idem := 'agent:' || a.agent_key || ':' || to_char(now(),'YYYY-MM-DD-HH24-MI');
  INSERT INTO admin_ai_jobs (kind, agent_key, mission_id, idempotency_key, requested_by, status, started_at)
  VALUES ('agent', a.agent_key, p_mission_id, idem, auth.uid(), 'running', now())
  ON CONFLICT (idempotency_key) DO UPDATE
    SET status = CASE WHEN admin_ai_jobs.status = 'failed' THEN 'running' ELSE admin_ai_jobs.status END
  RETURNING id INTO job;
  IF EXISTS (SELECT 1 FROM admin_ai_jobs WHERE id = job AND status = 'completed') THEN
    RETURN jsonb_build_object('job_id',job,'queued',0,'deduplicated',true);
  END IF;

  IF a.agent_key IN ('seo','content') THEN
    FOR row IN
      SELECT id, title, excerpt FROM posts
       WHERE status = 'published'
         AND (seo_title IS NULL OR btrim(seo_title) = '' OR seo_description IS NULL OR btrim(seo_description) = '')
       ORDER BY updated_at DESC NULLS LAST LIMIT a.max_actions
    LOOP
      action_id := admin_ai_queue_action(
        a.agent_key, 'seo_patch', 'Improve SEO: ' || row.title,
        'A safe metadata patch is available; content body is never changed by this agent.',
        'low', CASE WHEN a.agent_key = 'seo' THEN a.autonomy_level ELSE 'approval_required' END,
        'content.write', 'posts', row.id,
        jsonb_build_object('seo_title', left(row.title,60), 'seo_description', left(COALESCE(NULLIF(row.excerpt,''),row.title),155)),
        p_mission_id, job
      );
      n := n + 1;
    END LOOP;
  ELSIF a.agent_key = 'community' THEN
    FOR row IN
      SELECT id, content FROM comments
       WHERE is_approved AND is_visible AND (admin_reply IS NOT TRUE)
       ORDER BY created_at ASC LIMIT a.max_actions
    LOOP
      action_id := admin_ai_queue_action(
        a.agent_key, 'reply_draft', 'Reply needed for community comment',
        'A context-aware reply draft is ready for review.', 'medium', 'draft', 'content.moderate',
        'comments', row.id,
        jsonb_build_object('body', 'Thanks for joining the conversation. We appreciate you reading and will keep this in mind for a future guide.'),
        p_mission_id, job
      );
      n := n + 1;
    END LOOP;
  ELSIF a.agent_key = 'commerce' THEN
    FOR row IN
      SELECT id, name FROM products
       WHERE is_active AND (description IS NULL OR btrim(description) = '')
       ORDER BY updated_at DESC NULLS LAST LIMIT a.max_actions
    LOOP
      action_id := admin_ai_queue_action(
        a.agent_key, 'product_copy_draft', 'Improve product copy: ' || row.name,
        'The product needs a clearer description and conversion-focused structure.', 'medium', 'draft',
        'commerce.pricing', 'products', row.id,
        jsonb_build_object('brief', 'Add what it is, who it is for, benefits, proof and a clear next step.'),
        p_mission_id, job
      );
      n := n + 1;
    END LOOP;
  ELSIF a.agent_key = 'reliability' THEN
    FOR row IN
      SELECT fix_key, title, detail FROM admin_suggestions()
       WHERE fix_key IN ('requeue_email','repair_image_urls','backfill_seo','analyze')
       LIMIT a.max_actions
    LOOP
      action_id := admin_ai_queue_action(
        a.agent_key, row.fix_key, row.title, row.detail, 'low', 'auto_apply', 'ops.fix',
        'system', NULL, jsonb_build_object('fix_key',row.fix_key), p_mission_id, job
      );
      n := n + 1;
    END LOOP;
  ELSIF a.agent_key = 'security' THEN
    INSERT INTO admin_ai_incidents (severity, title, detail, source, evidence, related_job_id)
    SELECT CASE WHEN count(*) > 10 THEN 'critical' ELSE 'warning' END,
           'Review recent AI activity',
           'Security agent requests an owner review of AI actions and policy changes.',
           'security', jsonb_build_object('ai_actions_last_day', count(*)), job
      FROM admin_ai_action_queue
     WHERE created_at > now() - interval '1 day';
    n := 1;
  ELSIF a.agent_key = 'analyst' THEN
    -- Measured business data (views, search, paid orders, email queue, channel samples)
    -- plus the agents' own counters. Sections without a data source are reported as
    -- unavailable with a reason; the brief never presents an absent metric as zero.
    metrics := analyst_metrics(30);
    summary := analyst_metrics_summary(metrics);
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'metric_key', metric_key, 'samples', samples, 'value_sum', value_sum
           ) ORDER BY metric_key), '[]'::jsonb)
      INTO facts
      FROM (
        SELECT metric_key, count(*)::integer AS samples, round(sum(value)::numeric,2) AS value_sum
          FROM admin_ai_metrics
         WHERE recorded_at >= now() - interval '30 days'
         GROUP BY metric_key
         ORDER BY metric_key
         LIMIT 20
      ) AS aggregate_metrics;
    action_id := admin_ai_queue_action(
      'analyst', 'analytics_brief', 'Analyst: 30-day measured review',
      summary,
      'low', 'suggest', 'admin.ai.reports', 'analyst_metrics', NULL,
      metrics || jsonb_build_object('ai_metric_aggregates', COALESCE(facts, '[]'::jsonb)),
      p_mission_id, job
    );
    n := 1;
  ELSIF a.agent_key = 'strategist' THEN
    -- Grounded strategy: a proposal must cite measured data, or the brief says why not.
    metrics := analyst_metrics(30);
    v_signal := NULL; v_experiment := NULL;

    -- Signal 1: a repeated search term (>= 3 in the window) suggests unmet demand.
    SELECT jsonb_build_object(
             'kind', 'search_demand',
             'label', format('Dedicated article for %s', q.query),
             'basis', format('"%s" was searched %s times in the last 30 days (search_history)', q.query, q.n),
             'hypothesis', format('A dedicated article for the repeated search "%s" will earn more measured article views over the next 30 days than the site average.', q.query),
             'post_id', NULL,
             'metric_key', 'article_views',
             'search_hits', q.n
           ) INTO v_signal
      FROM (SELECT min(left(btrim(query), 60)) AS query, count(*)::bigint AS n
              FROM search_history
             WHERE created_at >= now() - interval '30 days' AND btrim(query) <> '' AND position('@' in query) = 0
             GROUP BY lower(btrim(query)) ORDER BY count(*) DESC LIMIT 1) q
     WHERE q.n >= 3;

    -- Signal 2: one article already carries >= 25% of measured views.
    IF v_signal IS NULL THEN
      SELECT jsonb_build_object(
               'kind', 'article_concentration',
               'label', format('Follow-up to %s', t.title),
               'basis', format('"%s" recorded %s of %s measured views (%s%%) in the last 30 days (article_views)', t.title, t.views, t.total, t.share),
               'hypothesis', format('A follow-up article to "%s" will hold more of the next 30 days of measured article views than publishing an unrelated topic.', t.title),
               'post_id', t.post_id,
               'metric_key', 'article_views',
               'share_percent', t.share
             ) INTO v_signal
        FROM (SELECT p.id AS post_id, p.title, count(*)::bigint AS views,
                     (SELECT count(*) FROM article_views av2 WHERE av2.created_at >= now() - interval '30 days') AS total,
                     round((count(*)::numeric * 100) / NULLIF((SELECT count(*) FROM article_views av3 WHERE av3.created_at >= now() - interval '30 days'), 0), 1) AS share
                FROM article_views av JOIN posts p ON p.id = av.post_id
               WHERE av.created_at >= now() - interval '30 days'
               GROUP BY p.id, p.title ORDER BY count(*) DESC LIMIT 1) t
       WHERE t.total > 0 AND t.share >= 25;
    END IF;

    IF v_signal IS NOT NULL THEN
      v_hypothesis := v_signal ->> 'hypothesis';
      v_metric_key := v_signal ->> 'metric_key';
      -- At most one open experiment per hypothesis: never re-propose the same study.
      SELECT e.id INTO v_experiment FROM admin_ai_experiments e
       WHERE e.hypothesis = v_hypothesis AND e.status IN ('draft','running')
       ORDER BY e.created_at DESC LIMIT 1;
      IF v_experiment IS NULL THEN
        INSERT INTO admin_ai_experiments (name, hypothesis, target_type, target_id, metric_key, guardrails, created_by, status)
        VALUES (left(v_signal ->> 'label', 140), v_hypothesis, 'posts', NULLIF(v_signal ->> 'post_id', '')::uuid, v_metric_key,
                jsonb_build_object('traffic_percent', 50, 'no_paid_spend', true, 'max_duration_days', 30,
                                   'requires_owner_start', true, 'external_publishing', false),
                auth.uid(), 'draft')
        RETURNING id INTO v_experiment;
        INSERT INTO admin_ai_experiment_variants (experiment_id, variant_key, label, payload) VALUES
          (v_experiment, 'control', 'Current approach', '{}'::jsonb),
          (v_experiment, 'variant', left(v_signal ->> 'label', 120), jsonb_build_object('proposal_only', true));
      END IF;

      IF EXISTS (SELECT 1 FROM admin_ai_experiments e WHERE e.id = v_experiment AND e.status = 'draft') THEN
        action_id := admin_ai_queue_action(
          'strategist', 'experiment_proposal', 'Strategist: grounded experiment proposal',
          format('Grounded in measured data: %s Review the hypothesis; starting it needs the CEO decision, your approval and an explicit dispatch. Nothing is published.', v_signal ->> 'basis'),
          'medium', 'suggest', 'admin.ai.experiments', 'admin_ai_experiments', v_experiment,
          jsonb_build_object('hypothesis', v_hypothesis, 'metric_key', v_metric_key, 'signal', v_signal,
                             'guardrails', jsonb_build_object('traffic_percent', 50, 'no_paid_spend', true, 'max_duration_days', 30),
                             'basis', v_signal ->> 'basis',
                             'metric_keys', jsonb_build_array('article_views.total', 'search.total')),
          p_mission_id, job);
        n := n + 1;
      END IF;
    END IF;

    SELECT jsonb_build_object(
             'pending_actions', (SELECT count(*) FROM admin_ai_action_queue WHERE status = 'queued'),
             'approved_actions', (SELECT count(*) FROM admin_ai_action_queue WHERE status = 'approved'),
             'active_missions', (SELECT count(*) FROM admin_ai_missions WHERE status = 'active'),
             'measured_metric_keys', (SELECT count(DISTINCT metric_key) FROM admin_ai_metrics WHERE recorded_at >= now() - interval '30 days'),
             'grounded_experiment', v_signal IS NOT NULL,
             'experiment_id', v_experiment,
             'measured_sections', jsonb_build_array(
               jsonb_build_object('section','article_views','available',metrics #>> '{sections,article_views,available}'),
               jsonb_build_object('section','search','available',metrics #>> '{sections,search,available}'),
               jsonb_build_object('section','orders','available',metrics #>> '{sections,orders,available}')),
             'no_experiment_reason', CASE WHEN v_signal IS NULL
               THEN 'No measured signal crossed the grounding threshold (repeated search >= 3 hits or one article >= 25% of views) in the last 30 days'
               ELSE NULL END,
             'window_days', 30
           ) INTO facts;
    action_id := admin_ai_queue_action(
      'strategist', 'strategy_brief', 'Strategist: evidence-led priority review',
      CASE WHEN v_signal IS NOT NULL
        THEN format('A grounded experiment proposal is attached: %s', v_signal ->> 'basis')
        ELSE 'No measured signal crossed the grounding threshold, so no experiment was proposed. Review current proposals and active missions before changing priorities.' END,
      'low', 'suggest', 'admin.ai.reports', 'admin_ai_missions', NULL, facts, p_mission_id, job);
    n := n + 1;
  ELSIF a.agent_key = 'ceo' THEN
    SELECT jsonb_build_object(
      'autopilot_enabled', (SELECT enabled FROM admin_ai_autopilot_settings WHERE id),
      'kill_switch_active', (SELECT kill_switch FROM admin_ai_autopilot_settings WHERE id),
      'daily_budget_cents', (SELECT daily_budget_cents FROM admin_ai_autopilot_settings WHERE id),
      'enabled_agents', (SELECT count(*) FROM admin_ai_agents WHERE enabled),
      'pending_actions', (SELECT count(*) FROM admin_ai_action_queue WHERE status = 'queued'),
      'failed_jobs_24h', (SELECT count(*) FROM admin_ai_jobs WHERE status = 'failed' AND created_at >= now() - interval '24 hours'),
      'open_incidents', (SELECT count(*) FROM admin_ai_incidents WHERE status NOT IN ('resolved','ignored','closed'))
    ) INTO facts;

    -- One owner decision at a time: start the newest grounded draft experiment.
    SELECT e.id, e.name, e.metric_key, e.hypothesis INTO v_experiment, v_label, v_metric_key, v_hypothesis
      FROM admin_ai_experiments e WHERE e.status = 'draft' ORDER BY e.created_at DESC LIMIT 1;

    -- Exactly one CEO action per run. When a grounded experiment is waiting, the action is
    -- the start decision and it still carries the whole scorecard in `proposed.scorecard`;
    -- otherwise it is the scorecard itself. Either way it stays suggestion-only.
    IF v_experiment IS NOT NULL THEN
      action_id := admin_ai_queue_action(
        'ceo', 'experiment_start', 'CEO: decision needed to start a grounded experiment',
        format('Requesting your decision on "%s" (metric: %s). Nothing starts until you approve it and explicitly dispatch it, the AI kill switch still applies, no external publishing is involved, and the operating scorecard for this run is attached.', v_label, v_metric_key),
        'medium', 'suggest', 'admin.ai.approve', 'admin_ai_experiments', v_experiment,
        facts || jsonb_build_object('scorecard', facts, 'experiment_id', v_experiment, 'name', v_label,
                                    'metric_key', v_metric_key, 'hypothesis', v_hypothesis,
                                    'basis', format('Grounded experiment awaiting an owner start decision: %s', v_label),
                                    'metric_keys', jsonb_build_array('article_views.total')),
        p_mission_id, job);
    ELSE
      -- No experiment is awaiting a decision, so check the owner's Lagos queue for a
      -- grounded re-dating opportunity before falling back to the scorecard. V8: the
      -- CEO only ever proposes; the owner applies it and the Auditor reviews it.
      SELECT admin_ai_queue_reschedule_plan() INTO v_plan;
      IF jsonb_array_length(COALESCE(v_plan -> 'moves', '[]'::jsonb)) > 0 THEN
        action_id := admin_ai_queue_action(
          'ceo', 'queue_reschedule', 'CEO: proposed re-dating for your Lagos queue',
          format('%s move(s) proposed across the next %s Lagos days so no day holds two articles while another day is empty. Nothing moves until you press Apply schedule; the two-a-day limit still holds, and published articles, draft text and article status are never touched.',
                 jsonb_array_length(v_plan -> 'moves'), v_plan ->> 'horizon_days'),
          'low', 'suggest', 'admin.ai.reports', 'queue', NULL,
          facts || v_plan || jsonb_build_object('scorecard', facts, 'experiment_awaiting_decision', false, 'awaiting_experiment_id', NULL),
          p_mission_id, job);
      ELSE
        action_id := admin_ai_queue_action(
          'ceo', 'executive_scorecard', 'CEO: aggregate operating scorecard',
          'No experiment is awaiting a start decision and no re-dating is needed. This deterministic scorecard is not a production-health certification or a publishing instruction.',
          'low', 'suggest', 'admin.ai.reports', 'admin_ai_autopilot_settings', NULL,
          facts || v_plan || jsonb_build_object('experiment_awaiting_decision', false, 'awaiting_experiment_id', NULL),
          p_mission_id, job);
      END IF;
    END IF;
    n := 1;
  ELSIF a.agent_key = 'auditor' THEN
    -- Independent review: the Auditor judges other agents' proposals against fixed criteria.
    -- It needs admin.ai.approve because a block pauses the proposal; without that capability it
    -- reports that it could not review rather than silently skipping the check.
    IF admin_can('admin.ai.approve') THEN
      FOR row IN
        SELECT q.id FROM admin_ai_action_queue q
         WHERE q.agent_key IN ('analyst','strategist','ceo','executioner','chief_of_staff')
           AND q.status IN ('queued','approved')
           AND NOT EXISTS (SELECT 1 FROM admin_ai_action_audits x WHERE x.action_id = q.id)
         ORDER BY q.created_at DESC
         LIMIT a.max_actions
      LOOP
        PERFORM admin_ai_audit_action(row.id);
        v_reviews := v_reviews + 1;
      END LOOP;
    END IF;

    SELECT count(*) FILTER (WHERE au.verdict = 'blocked'), count(*) FILTER (WHERE au.verdict = 'concern')
      INTO v_blocked, v_concern
      FROM admin_ai_action_audits au WHERE au.created_at >= now() - interval '30 days';

    SELECT jsonb_build_object(
      'approved_without_note', (SELECT count(*) FROM admin_ai_action_queue WHERE status = 'approved' AND NULLIF(btrim(decision_note),'') IS NULL),
      'enabled_auto_apply_agents', (SELECT count(*) FROM admin_ai_agents WHERE enabled AND autonomy_level = 'auto_apply'),
      'failed_jobs_30d', (SELECT count(*) FROM admin_ai_jobs WHERE status = 'failed' AND created_at >= now() - interval '30 days'),
      'open_critical_incidents', (SELECT count(*) FROM admin_ai_incidents WHERE severity = 'critical' AND status NOT IN ('resolved','ignored','closed')),
      'reviewed_this_run', v_reviews,
      'blocked_30d', v_blocked,
      'concern_30d', v_concern,
      'review_capability', admin_can('admin.ai.approve'),
      'window_days', 30
    ) INTO facts;
    action_id := admin_ai_queue_action(
      'auditor', 'governance_brief', 'Auditor: independent proposal review',
      format('Independently reviewed %s proposal(s) this run; %s blocked and %s flagged in the last 30 days. A block holds until the owner records a written override reason, and this review never changes business records itself.', v_reviews, v_blocked, v_concern),
      'low', 'suggest', 'admin.ai.reports', 'admin_ai_action_queue', NULL, facts, p_mission_id, job);
    n := 1;
  ELSIF a.agent_key = 'executioner' THEN
    PERFORM admin_ai_require('admin.ai.approve');
    IF EXISTS (SELECT 1 FROM admin_ai_autopilot_settings WHERE id AND kill_switch) THEN
      RAISE EXCEPTION 'AI kill switch is active';
    END IF;
    -- The only executable key is ANALYZE. It must already be owner-approved, request ops.fix,
    -- and is dispatched via the existing executor (permission check, audit, and kill switch).
    FOR row IN
      SELECT q.id
        FROM admin_ai_action_queue AS q
       WHERE q.status = 'approved'
         AND q.agent_key = a.agent_key
         AND q.action_type = 'analyze'
         AND q.required_permission = 'ops.fix'
         AND q.target_id IS NULL
       ORDER BY q.created_at, q.id
       LIMIT a.max_actions
       FOR UPDATE SKIP LOCKED
    LOOP
      PERFORM admin_ai_execute_action(row.id, false);
      n := n + 1;
    END LOOP;
  ELSIF a.agent_key = 'chief_of_staff' THEN
    -- Every digest item links to the record that needs the owner's decision.
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'kind','action','id',x.id,'label',x.title,'status',x.status,'agent',x.agent_key,
             'verdict', COALESCE(x.verdict,'not_reviewed'),
             'needs', CASE WHEN x.verdict = 'blocked' THEN 'owner override reason or rejection' ELSE 'owner decision' END)
           ORDER BY x.created_at DESC), '[]'::jsonb)
      INTO v_links
      FROM (SELECT q.id, q.title, q.status, q.agent_key, q.created_at,
                   (SELECT au.verdict FROM admin_ai_action_audits au WHERE au.action_id = q.id ORDER BY au.created_at DESC LIMIT 1) AS verdict
              FROM admin_ai_action_queue q
             WHERE q.status IN ('queued','approved')
             ORDER BY q.created_at DESC LIMIT 10) x;

    SELECT count(*) INTO v_pending FROM admin_ai_action_queue WHERE status IN ('queued','approved');

    v_links := v_links
      || COALESCE((
        SELECT jsonb_agg(jsonb_build_object('kind','experiment','id',e.id,'label',e.name,'status',e.status,
                                            'needs', CASE WHEN e.status = 'draft' THEN 'start decision (approve, then dispatch)' ELSE 'outcome review' END))
          FROM admin_ai_experiments e WHERE e.status IN ('draft','running')), '[]'::jsonb)
      || COALESCE((
        SELECT jsonb_agg(jsonb_build_object('kind','incident','id',i.id,'label',i.title,'status',i.status,'needs','acknowledge or resolve'))
          FROM (SELECT id, title, status FROM admin_ai_incidents WHERE status IN ('open','acknowledged') ORDER BY created_at DESC LIMIT 5) i), '[]'::jsonb);

    facts := jsonb_build_object(
      'pending_decisions', v_pending,
      'blocked_by_auditor', (SELECT count(*) FROM admin_ai_action_audits au WHERE au.verdict = 'blocked' AND au.overridden_at IS NULL),
      'active_experiments', (SELECT count(*) FROM admin_ai_experiments WHERE status = 'running'),
      'draft_experiments', (SELECT count(*) FROM admin_ai_experiments WHERE status = 'draft'),
      'open_incidents', (SELECT count(*) FROM admin_ai_incidents WHERE status IN ('open','acknowledged')),
      'links', v_links,
      'link_count', jsonb_array_length(v_links));

    action_id := admin_ai_queue_action(
      'chief_of_staff', 'operations_digest', 'Chief of Staff: linked owner follow-up digest',
      format('%s decision(s) waiting; %s blocked by the independent Auditor; %s experiment(s) running and %s awaiting a start decision. Each linked item names the record it refers to and what it needs; this digest sends nothing externally.',
             v_pending, facts ->> 'blocked_by_auditor', facts ->> 'active_experiments', facts ->> 'draft_experiments'),
      'low', 'suggest', 'admin.ai.reports', 'admin_ai_action_queue', NULL, facts, p_mission_id, job);
    n := 1;
  ELSE
    -- Preserve the existing deterministic brief for the legacy experiments agent and any
    -- pre-existing registry extensions; all six new boardroom roles have explicit branches above.
    INSERT INTO admin_ai_action_queue (fingerprint, agent_key, job_id, action_type, title, detail, risk, autonomy_level, required_permission, proposed, created_by)
    VALUES (md5(a.agent_key || ':growth:' || current_date), a.agent_key, job, 'growth_brief',
            'Create a growth review',
            'Review traffic, retention and conversion trends against the active mission.',
            'low', 'suggest', 'analytics.read', jsonb_build_object('agent',a.agent_key), auth.uid())
    ON CONFLICT DO NOTHING;
    n := 1;
  END IF;

  UPDATE admin_ai_jobs SET status='completed', result=jsonb_build_object('queued',n), finished_at=now() WHERE id=job;
  UPDATE admin_ai_agents SET last_run_at=now(), next_run_at=now() + make_interval(mins => a.cadence_minutes), updated_at=now() WHERE agent_key=a.agent_key;
  RETURN jsonb_build_object('job_id',job,'agent',a.agent_key,'queued',n);
EXCEPTION WHEN others THEN
  IF job IS NOT NULL THEN UPDATE admin_ai_jobs SET status='failed', error=SQLERRM, finished_at=now() WHERE id=job; END IF;
  RAISE;
END $$;

REVOKE ALL ON FUNCTION admin_ai_run_agent(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_ai_run_agent(text, uuid) TO authenticated;


NOTIFY pgrst, 'reload schema';
