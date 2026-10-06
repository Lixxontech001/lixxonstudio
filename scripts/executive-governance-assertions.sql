-- Phase 4 gap 2 assertions: grounded strategy/experiment, CEO decisions, an
-- independent Auditor that can block (hard blocks cannot be overridden), and
-- owner-approved dispatch that prepares channel drafts without ever sending.
\set ON_ERROR_STOP on

DO $$
DECLARE
  owner jsonb := '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000001","email":"owner@lixxonstudio.com"}';
  reader jsonb := '{"role":"authenticated","sub":"00000000-0000-0000-0000-0000000000d4"}';
  anon_claims jsonb := '{"role":"anon"}';
  post_a uuid; cust uuid; ord uuid;
  draft_exp uuid; started_exp uuid;
  proposal_id uuid; decision_id uuid; brief_id uuid;
  soft_block uuid; hard_block uuid; channel_id uuid;
  result jsonb; audit jsonb; v_verdict text; v_status text; v_draft uuid;
  v_sha text; v_logs bigint; v_links jsonb; v_kind text;
  raised boolean; role_key text; v_kill_initial boolean;
  channel_key_pick text := 'telegram';
BEGIN
  -- ------------------------------------------------------- 1. permission gates
  PERFORM set_config('request.jwt.claims', reader::text, true);
  PERFORM set_config('request.jwt.claim.sub', reader->>'sub', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  raised := false;
  BEGIN PERFORM admin_ai_dispatch_approved(gen_random_uuid()); EXCEPTION WHEN others THEN raised := true; END;
  IF NOT raised THEN RAISE EXCEPTION 'A non-owner dispatched an action'; END IF;
  raised := false;
  BEGIN PERFORM admin_ai_override_block(gen_random_uuid(), 'a sufficiently long reason'); EXCEPTION WHEN others THEN raised := true; END;
  IF NOT raised THEN RAISE EXCEPTION 'A non-owner overrode an Auditor block'; END IF;
  raised := false;
  BEGIN PERFORM admin_ai_audit_action(gen_random_uuid()); EXCEPTION WHEN others THEN raised := true; END;
  IF NOT raised THEN RAISE EXCEPTION 'A non-owner wrote an Auditor verdict'; END IF;

  PERFORM set_config('request.jwt.claims', anon_claims::text, true);
  PERFORM set_config('request.jwt.claim.role', 'anon', true);
  raised := false;
  BEGIN PERFORM admin_ai_dispatch_approved(gen_random_uuid()); EXCEPTION WHEN others THEN raised := true; END;
  IF NOT raised THEN RAISE EXCEPTION 'An anon caller dispatched an action'; END IF;

  PERFORM set_config('request.jwt.claims', owner::text, true);
  PERFORM set_config('request.jwt.claim.sub', owner->>'sub', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  -- The predictive security handler can engage the kill switch automatically during
  -- earlier fixtures. Record the real value, normalise it for this suite, restore it at
  -- the end, and never claim the switch was off when it was not.
  SELECT kill_switch INTO v_kill_initial FROM admin_ai_autopilot_settings WHERE id;
  UPDATE admin_ai_autopilot_settings SET kill_switch = false WHERE id;

  IF has_function_privilege('anon', 'admin_ai_dispatch_approved(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'admin_ai_audit_action(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'admin_ai_override_block(uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'gap 2 functions are executable by anon';
  END IF;

  -- ------------------------------------------ 2. grounded strategist proposal
  SELECT id INTO cust FROM customers LIMIT 1;
  -- Reuse an existing article (the daily-schedule guard rightly rejects extra publishes)
  -- and never modify or delete it; this suite only references its id.
  SELECT id INTO post_a FROM posts ORDER BY created_at LIMIT 1;
  IF post_a IS NULL THEN RAISE EXCEPTION 'this suite needs at least one existing article'; END IF;
  -- Repeated search demand: the grounding threshold is >= 3 hits in 30 days.
  INSERT INTO search_history (fingerprint, query, created_at) VALUES
    ('g2-1', 'retinol for beginners', now() - interval '3 days'),
    ('g2-2', 'retinol for beginners', now() - interval '2 days'),
    ('g2-3', 'retinol for beginners', now() - interval '1 day');

  PERFORM admin_ai_set_agent('strategist', true, 'suggest', 1440, 10, '{}'::jsonb);
  -- agent runs are idempotent per minute; clear this minute's row so the fixture runs
  DELETE FROM admin_ai_jobs WHERE agent_key = 'strategist' AND idempotency_key = 'agent:strategist:' || to_char(now(), 'YYYY-MM-DD-HH24-MI');
  result := admin_ai_run_agent('strategist');
  IF COALESCE((result->>'queued')::integer, 0) < 1 THEN RAISE EXCEPTION 'the strategist produced nothing'; END IF;

  SELECT id INTO draft_exp FROM admin_ai_experiments WHERE status = 'draft' ORDER BY created_at DESC LIMIT 1;
  IF draft_exp IS NULL THEN RAISE EXCEPTION 'no draft experiment was created from measured data'; END IF;
  IF NOT EXISTS (SELECT 1 FROM admin_ai_experiments e WHERE e.id = draft_exp AND e.status = 'draft' AND e.started_at IS NULL) THEN
    RAISE EXCEPTION 'a grounded proposal created an already-running experiment';
  END IF;
  IF (SELECT count(*) FROM admin_ai_experiment_variants v WHERE v.experiment_id = draft_exp) <> 2 THEN
    RAISE EXCEPTION 'the draft experiment does not have exactly two variants';
  END IF;
  IF (SELECT guardrails ->> 'external_publishing' FROM admin_ai_experiments WHERE id = draft_exp) <> 'false' THEN
    RAISE EXCEPTION 'the experiment guardrails do not forbid external publishing';
  END IF;

  SELECT id INTO proposal_id FROM admin_ai_action_queue WHERE agent_key = 'strategist' AND action_type = 'experiment_proposal' ORDER BY created_at DESC LIMIT 1;
  IF proposal_id IS NULL THEN RAISE EXCEPTION 'no grounded experiment proposal was queued'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM admin_ai_action_queue q
     WHERE q.id = proposal_id
       AND q.status = 'queued' AND q.autonomy_level = 'suggest'
       AND q.target_type = 'admin_ai_experiments' AND q.target_id = draft_exp
       AND q.proposed ? 'basis' AND q.proposed ->> 'basis' LIKE '%was searched 3 times%'
       AND jsonb_array_length(COALESCE(q.proposed -> 'metric_keys', '[]'::jsonb)) > 0
       AND q.proposed #>> '{signal,kind}' = 'search_demand'
  ) THEN RAISE EXCEPTION 'the proposal is not grounded in the measured signal'; END IF;
  -- The proposal must cite the metric keys the Auditor demands.
  IF (SELECT count(*) FROM admin_ai_action_queue WHERE agent_key = 'strategist' AND action_type = 'experiment_proposal') <> 1 THEN
    RAISE EXCEPTION 'the strategist proposed more than one experiment for the same signal';
  END IF;

  -- Running again must not duplicate the open experiment or its proposal.
  PERFORM admin_ai_run_agent('strategist');
  IF (SELECT count(*) FROM admin_ai_experiments WHERE hypothesis LIKE 'A dedicated article for the repeated search%' AND status IN ('draft','running')) <> 1 THEN
    RAISE EXCEPTION 'the grounded experiment was duplicated on a second run';
  END IF;

  -- ------------------------------------------------------------- 3. CEO decision
  PERFORM admin_ai_set_agent('ceo', true, 'suggest', 1440, 10, '{}'::jsonb);
  DELETE FROM admin_ai_jobs WHERE agent_key = 'ceo' AND idempotency_key = 'agent:ceo:' || to_char(now(), 'YYYY-MM-DD-HH24-MI');
  result := admin_ai_run_agent('ceo');
  IF COALESCE((result->>'queued')::integer, 0) <> 1 THEN
    RAISE EXCEPTION 'the CEO created % actions instead of exactly one', result->>'queued';
  END IF;
  SELECT id INTO decision_id FROM admin_ai_action_queue WHERE agent_key = 'ceo' AND action_type = 'experiment_start' ORDER BY created_at DESC LIMIT 1;
  IF decision_id IS NULL THEN RAISE EXCEPTION 'the CEO did not raise the experiment start decision'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM admin_ai_action_queue q
     WHERE q.id = decision_id AND q.status = 'queued' AND q.autonomy_level = 'suggest'
       AND q.required_permission = 'admin.ai.approve' AND q.target_id = draft_exp
       AND q.proposed ? 'scorecard' AND q.proposed ? 'basis'
  ) THEN RAISE EXCEPTION 'the CEO decision is missing its approval gate, target or scorecard'; END IF;

  -- Dispatch is refused before approval, and the experiment must still be a draft.
  raised := false;
  BEGIN PERFORM admin_ai_dispatch_approved(decision_id); EXCEPTION WHEN others THEN raised := true; END;
  IF NOT raised THEN RAISE EXCEPTION 'an unapproved action was dispatched'; END IF;
  IF (SELECT status FROM admin_ai_experiments WHERE id = draft_exp) <> 'draft' THEN
    RAISE EXCEPTION 'the experiment started before any approval or dispatch';
  END IF;

  -- ------------------------------------------------- 4. Auditor independence
  raised := false;
  BEGIN
    PERFORM admin_ai_queue_action('auditor', 'governance_brief', 'Gap2 self-review fixture',
      'The Auditor must never review its own proposal.', 'low', 'suggest', 'admin.ai.reports',
      'admin_ai_action_queue', NULL, jsonb_build_object('basis', 'fixture', 'metric_keys', jsonb_build_array('x')), NULL, NULL);
    SELECT id INTO brief_id FROM admin_ai_action_queue WHERE title = 'Gap2 self-review fixture' ORDER BY created_at DESC LIMIT 1;
    PERFORM admin_ai_audit_action(brief_id);
  EXCEPTION WHEN others THEN raised := true; END;
  IF NOT raised THEN RAISE EXCEPTION 'the Auditor reviewed its own proposal'; END IF;

  -- A claim with no measured basis is blocked, and the block records both identities.
  soft_block := admin_ai_queue_action('strategist', 'experiment_proposal', 'Gap2 unsupported proposal',
    'A proposal with no measured basis must not survive review.', 'medium', 'suggest', 'admin.ai.experiments',
    'admin_ai_experiments', NULL, jsonb_build_object('hypothesis', 'unsupported'), NULL, NULL);
  audit := admin_ai_audit_action(soft_block);
  IF audit ->> 'verdict' <> 'blocked' THEN RAISE EXCEPTION 'an unsupported proposal was not blocked'; END IF;
  IF audit ->> 'proposer_agent' <> 'strategist' THEN RAISE EXCEPTION 'the audit did not record the proposer'; END IF;
  IF jsonb_array_length(audit -> 'hard_blockers') <> 0 THEN RAISE EXCEPTION 'a soft block was marked non-overridable'; END IF;
  SELECT status INTO v_status FROM admin_ai_action_queue WHERE id = soft_block;
  IF v_status <> 'paused' THEN RAISE EXCEPTION 'a blocked proposal was left in status %', v_status; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM admin_ai_action_audits x
     WHERE x.action_id = soft_block AND x.reviewer_agent = 'auditor' AND x.proposer_agent = 'strategist'
       AND x.blocked_reason LIKE '%measured basis%'
  ) THEN RAISE EXCEPTION 'the block did not record its reason and reviewer separation'; END IF;

  -- The block holds against approval and execution.
  PERFORM admin_ai_decide_action(soft_block, 'approve', 'owner approved despite the block');
  raised := false;
  BEGIN PERFORM admin_ai_execute_action(soft_block, false); EXCEPTION WHEN others THEN raised := true; END;
  IF NOT raised THEN RAISE EXCEPTION 'a blocked proposal was executed'; END IF;
  raised := false;
  BEGIN PERFORM admin_ai_dispatch_approved(soft_block); EXCEPTION WHEN others THEN raised := true; END;
  IF NOT raised THEN RAISE EXCEPTION 'a blocked proposal was dispatched'; END IF;

  -- An override needs a written reason and a blocked verdict.
  raised := false;
  BEGIN PERFORM admin_ai_override_block(soft_block, 'too short'); EXCEPTION WHEN others THEN raised := true; END;
  IF NOT raised THEN RAISE EXCEPTION 'a block was overridden without a real reason'; END IF;
  raised := false;
  BEGIN PERFORM admin_ai_override_block(decision_id, 'not blocked, so nothing to override'); EXCEPTION WHEN others THEN raised := true; END;
  IF NOT raised THEN RAISE EXCEPTION 'a non-blocked action was overridden'; END IF;

  PERFORM admin_ai_override_block(soft_block, 'Owner accepts the missing basis for this one pilot.');
  IF NOT EXISTS (
    SELECT 1 FROM admin_ai_action_audits x
     WHERE x.action_id = soft_block AND x.overridden_by IS NOT NULL AND x.override_reason LIKE 'Owner accepts%'
  ) THEN RAISE EXCEPTION 'the override did not record who overrode the block and why'; END IF;
  -- After the override the proposal is executable again, but it is not dispatchable
  -- because its action type is not on the dispatch allow-list.
  raised := false;
  BEGIN PERFORM admin_ai_dispatch_approved(soft_block); EXCEPTION WHEN others THEN raised := true; END;
  IF NOT raised THEN RAISE EXCEPTION 'a non-allow-listed action type was dispatched'; END IF;

  -- Hard blocks cannot be overridden at all.
  hard_block := admin_ai_queue_action('strategist', 'experiment_proposal', 'Gap2 hard-block fixture',
    'A boardroom proposal must never carry auto_apply autonomy.', 'high', 'auto_apply', 'admin.ai.experiments',
    'admin_ai_experiments', NULL, jsonb_build_object('basis', 'fixture', 'metric_keys', jsonb_build_array('x')), NULL, NULL);
  audit := admin_ai_audit_action(hard_block);
  IF audit ->> 'verdict' <> 'blocked' OR jsonb_array_length(audit -> 'hard_blockers') = 0 THEN
    RAISE EXCEPTION 'an auto_apply boardroom proposal was not hard-blocked';
  END IF;
  raised := false;
  BEGIN PERFORM admin_ai_override_block(hard_block, 'Owner would like to allow this auto_apply action.'); EXCEPTION WHEN others THEN raised := true; END;
  IF NOT raised THEN RAISE EXCEPTION 'a hard block was overridden'; END IF;

  -- A filter trap must always trip: publish/send proposals are hard-blocked.
  INSERT INTO admin_ai_action_queue (fingerprint, agent_key, action_type, title, detail, risk, autonomy_level, required_permission, target_type, proposed)
  VALUES (md5('gap2-publish'), 'strategist', 'publish_now', 'Gap2 publish fixture', 'Publishing must never be an automation action.',
          'high', 'suggest', 'admin.ai.approve', 'posts', jsonb_build_object('basis', 'fixture', 'metric_keys', jsonb_build_array('x')));
  SELECT id INTO hard_block FROM admin_ai_action_queue WHERE action_type = 'publish_now' ORDER BY created_at DESC LIMIT 1;
  audit := admin_ai_audit_action(hard_block);
  IF audit ->> 'verdict' <> 'blocked' OR jsonb_array_length(audit -> 'hard_blockers') = 0 THEN
    RAISE EXCEPTION 'an external publishing action was not hard-blocked';
  END IF;

  -- -------------------------------------- 5. approved dispatch starts a study
  PERFORM admin_ai_decide_action(decision_id, 'approve', 'owner approves the grounded pilot');
  result := admin_ai_dispatch_approved(decision_id);
  IF (result ->> 'ok')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'the approved experiment decision was not dispatched'; END IF;
  IF (SELECT status FROM admin_ai_experiments WHERE id = draft_exp) <> 'running'
     OR (SELECT started_at FROM admin_ai_experiments WHERE id = draft_exp) IS NULL THEN
    RAISE EXCEPTION 'dispatch did not start the experiment';
  END IF;
  IF (SELECT status FROM admin_ai_action_queue WHERE id = decision_id) <> 'applied' THEN
    RAISE EXCEPTION 'the dispatched action was not marked applied';
  END IF;
  raised := false;
  BEGIN PERFORM admin_ai_dispatch_approved(decision_id); EXCEPTION WHEN others THEN raised := true; END;
  IF NOT raised THEN RAISE EXCEPTION 'the same action was dispatched twice'; END IF;
  IF (SELECT count(*) FROM distribution_log) <> v_logs THEN
    RAISE EXCEPTION 'starting an experiment wrote to the distribution ledger';
  END IF;

  -- ------------------------------------ 6. channel dispatch prepares, never sends
  v_logs := (SELECT count(*) FROM distribution_log);
  INSERT INTO admin_ai_action_queue (fingerprint, agent_key, action_type, title, detail, risk, autonomy_level, required_permission, target_type, proposed)
  VALUES (md5('gap2-channel'), 'chief_of_staff', 'channel_prepare', 'Gap2 channel preparation',
          'Prepare a Daily Kit draft for owner approval; never send from automation.', 'low', 'suggest', 'admin.ai.approve',
          'automation_distribution_drafts',
          jsonb_build_object('post_id', post_a, 'channel_key', channel_key_pick,
                             'payload', jsonb_build_object('caption', 'Gap2 draft caption'),
                             'basis', 'fixture', 'metric_keys', jsonb_build_array('x')));
  SELECT id INTO channel_id FROM admin_ai_action_queue WHERE action_type = 'channel_prepare' ORDER BY created_at DESC LIMIT 1;

  -- Unapproved channel preparation must not create a draft.
  raised := false;
  BEGIN PERFORM admin_ai_dispatch_approved(channel_id); EXCEPTION WHEN others THEN raised := true; END;
  IF NOT raised THEN RAISE EXCEPTION 'an unapproved channel preparation was dispatched'; END IF;
  IF EXISTS (SELECT 1 FROM automation_distribution_drafts d WHERE d.post_id = post_a AND d.channel_key = channel_key_pick) THEN
    RAISE EXCEPTION 'a draft was created before owner approval';
  END IF;

  PERFORM admin_ai_decide_action(channel_id, 'approve', 'owner approves preparing the draft');
  result := admin_ai_dispatch_approved(channel_id);
  SELECT id, payload_sha256, review_status INTO v_draft, v_sha, v_status
    FROM automation_distribution_drafts WHERE post_id = post_a AND channel_key = channel_key_pick;
  IF v_draft IS NULL THEN RAISE EXCEPTION 'channel dispatch did not prepare a draft'; END IF;
  IF v_sha !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'the prepared draft has no valid payload hash'; END IF;
  IF v_status <> 'pending' THEN RAISE EXCEPTION 'the prepared draft is in review state % instead of pending', v_status; END IF;
  IF NOT (result ->> 'message' LIKE '%nothing was sent%') THEN RAISE EXCEPTION 'the dispatch result does not state that nothing was sent'; END IF;
  IF (SELECT count(*) FROM distribution_log) <> v_logs THEN
    RAISE EXCEPTION 'preparing a channel draft wrote to the distribution ledger';
  END IF;
  -- Re-dispatch is blocked because the action is already applied, not because it sent.
  raised := false;
  BEGIN PERFORM admin_ai_dispatch_approved(channel_id); EXCEPTION WHEN others THEN raised := true; END;
  IF NOT raised THEN RAISE EXCEPTION 'channel preparation was dispatched twice'; END IF;

  -- ----------------------------------- 7. the kill switch stops dispatchable work
  UPDATE admin_ai_autopilot_settings SET kill_switch = true WHERE id;
  INSERT INTO admin_ai_action_queue (fingerprint, agent_key, action_type, title, detail, risk, autonomy_level, required_permission, target_type, proposed)
  VALUES (md5('gap2-killswitch'), 'ceo', 'experiment_start', 'Gap2 kill-switch fixture',
          'The kill switch must stop starting experiments.', 'low', 'suggest', 'admin.ai.approve',
          'admin_ai_experiments', jsonb_build_object('basis', 'fixture', 'metric_keys', jsonb_build_array('x')));
  SELECT id INTO started_exp FROM admin_ai_action_queue WHERE title = 'Gap2 kill-switch fixture';
  UPDATE admin_ai_action_queue SET status = 'approved', target_id = draft_exp WHERE id = started_exp;
  raised := false;
  BEGIN PERFORM admin_ai_dispatch_approved(started_exp); EXCEPTION WHEN others THEN raised := true; END;
  IF NOT raised THEN RAISE EXCEPTION 'the kill switch did not stop an experiment dispatch'; END IF;
  -- The same kill switch is a hard blocker for an Auditor review of that action.
  audit := admin_ai_audit_action(started_exp);
  IF audit ->> 'verdict' <> 'blocked' THEN RAISE EXCEPTION 'the kill switch did not block the review'; END IF;
  UPDATE admin_ai_autopilot_settings SET kill_switch = false WHERE id;
  UPDATE admin_ai_action_queue SET status = 'approved' WHERE id = started_exp AND status = 'paused';

  -- ------------------------------------------- 8. the linked Chief of Staff digest
  INSERT INTO admin_ai_incidents (severity, title, detail, source, status)
  VALUES ('warning', 'Gap2 linked incident', 'Must appear in the digest with its id.', 'agent', 'open');
  PERFORM admin_ai_set_agent('chief_of_staff', true, 'suggest', 1440, 10, '{}'::jsonb);
  DELETE FROM admin_ai_jobs WHERE agent_key = 'chief_of_staff' AND idempotency_key = 'agent:chief_of_staff:' || to_char(now(), 'YYYY-MM-DD-HH24-MI');
  result := admin_ai_run_agent('chief_of_staff');
  IF COALESCE((result->>'queued')::integer, 0) <> 1 THEN RAISE EXCEPTION 'the digest run was not bounded'; END IF;

  SELECT proposed -> 'links' INTO v_links FROM admin_ai_action_queue
   WHERE agent_key = 'chief_of_staff' AND action_type = 'operations_digest' ORDER BY created_at DESC LIMIT 1;
  IF v_links IS NULL OR jsonb_array_length(v_links) = 0 THEN RAISE EXCEPTION 'the digest carried no links'; END IF;
  FOREACH v_kind IN ARRAY ARRAY['action','experiment','incident'] LOOP
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_links) l WHERE l ->> 'kind' = v_kind
                     AND COALESCE(l ->> 'id', '') <> '' AND COALESCE(l ->> 'needs', '') <> '') THEN
      RAISE EXCEPTION 'the digest has no linked % with a stated need', v_kind;
    END IF;
  END LOOP;
  -- The blocked fixture must be linked with the override consequence spelled out.
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_links) l
     WHERE l ->> 'kind' = 'action' AND l ->> 'verdict' = 'blocked' AND l ->> 'needs' LIKE '%override%'
  ) THEN RAISE EXCEPTION 'the digest did not surface a blocked decision and what it needs'; END IF;
  IF COALESCE((SELECT (proposed ->> 'blocked_by_auditor')::integer FROM admin_ai_action_queue
                WHERE agent_key = 'chief_of_staff' AND action_type = 'operations_digest'
                ORDER BY created_at DESC LIMIT 1), 0) < 1 THEN
    RAISE EXCEPTION 'the digest did not count the outstanding Auditor blocks';
  END IF;
  IF (SELECT detail FROM admin_ai_action_queue WHERE agent_key = 'chief_of_staff' AND action_type = 'operations_digest'
       ORDER BY created_at DESC LIMIT 1) NOT LIKE '%sends nothing externally%' THEN
    RAISE EXCEPTION 'the digest does not state that it sends nothing';
  END IF;

  -- ------------------------------------------------------- 9. restore state
  DELETE FROM admin_ai_incidents WHERE title = 'Gap2 linked incident';
  DELETE FROM automation_distribution_drafts WHERE post_id = post_a;
  DELETE FROM admin_ai_experiment_variants WHERE experiment_id IN (SELECT id FROM admin_ai_experiments WHERE hypothesis LIKE '%repeated search%' OR name LIKE 'Gap2%');
  DELETE FROM admin_ai_experiments WHERE hypothesis LIKE '%repeated search%' OR name LIKE 'Gap2%';
  DELETE FROM admin_ai_jobs WHERE agent_key IN ('strategist','ceo','auditor','chief_of_staff');
  DELETE FROM admin_ai_action_queue WHERE id IN (proposal_id, decision_id, soft_block, hard_block, channel_id, started_exp)
     OR title IN ('Gap2 self-review fixture', 'Gap2 publish fixture')
     OR action_type IN ('experiment_proposal','experiment_start','channel_prepare','publish_now');
  DELETE FROM admin_ai_action_audits WHERE action_id NOT IN (SELECT id FROM admin_ai_action_queue);
  DELETE FROM search_history WHERE query = 'retinol for beginners';
  -- Restore the kill switch to whatever it genuinely was before this suite.
  UPDATE admin_ai_autopilot_settings SET kill_switch = v_kill_initial WHERE id;
  FOREACH role_key IN ARRAY ARRAY['strategist','ceo','auditor','chief_of_staff'] LOOP
    PERFORM admin_ai_set_agent(role_key, false, 'suggest', 1440, 10, '{}'::jsonb);
    UPDATE admin_ai_agents SET last_run_at = NULL, next_run_at = NULL WHERE agent_key = role_key;
  END LOOP;
END $$;
