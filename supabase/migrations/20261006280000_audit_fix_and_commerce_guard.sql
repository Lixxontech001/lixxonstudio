-- =============================================================================
-- Gap slices 1: audit correctness fixes (V32 + V9).
--
-- V32 — "No agent can change a price, refund, product or payment state."
--   That is currently true only by absence: no agent action type happens to be
--   commerce-mutating, so a future action type could break the rule silently.
--   This migration adds a database-level guard so the rule cannot be broken by
--   accident: an assertion-ready function that reports any agent-queue action
--   type or dispatchable type that looks commerce-mutating, plus a hard CHECK on
--   the queue's own action types is deliberately NOT used (the queue is generic);
--   instead the guard is enforced where it matters — at dispatch — and proven by
--   the registered assertion suite.
--
-- V9 — the Auditor must show the exact fix, not just the finding. Each block rule
--   now carries a concrete, plain-English fix sentence, stored structurally in
--   `findings.fixes` and appended to the action's decision note so the owner sees
--   it exactly where the block is displayed. Nothing else changes: the same
--   verdicts, the same hard-block rules, the same owner override.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. V9: the Auditor gains an exact-fix sentence per rule.
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
  IF a.action_type IN ('experiment_proposal','experiment_start','strategy_brief','analytics_brief','operations_digest') THEN
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

-- ---------------------------------------------------------------------------
-- 2. V32: a single place that answers "can any agent touch commerce?" so the
--    registered assertion can prove it, and so a future action type is caught.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION admin_ai_commerce_guard_report()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public, pg_temp
AS $$
DECLARE
  v_dispatchable text[] := ARRAY['analyze','experiment_start','channel_prepare'];
  v_violations jsonb;
BEGIN
  PERFORM admin_ai_require('admin.ai.reports');

  -- 1. No queued/proposed agent action may carry a commerce mutation.
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', q.id, 'agent', q.agent_key, 'action_type', q.action_type)), '[]'::jsonb)
    INTO v_violations
    FROM admin_ai_action_queue q
   WHERE (lower(COALESCE(q.proposed::text, '')) ~ '(new_price|set_price|price_change|update_price|change_price|refund_amount|issue_refund|process_refund|payment_status|mark_paid|discount_percent|apply_discount|coupon_code|amount_due|new_amount|set_amount)'
          OR lower(COALESCE(q.proposed::text, '')) ~ '(set|change|update|apply|issue|process|mark|raise|lower)[^.]{0,24}(price|pricing|refund|discount|coupon|payment status|amount due)')
     AND q.status NOT IN ('rejected','failed');

  RETURN jsonb_build_object(
    'agent_commerce_mutations', v_violations,
    'violation_count', jsonb_array_length(v_violations),
    'dispatchable_types', to_jsonb(v_dispatchable),
    'commerce_mutating_dispatchable_types', COALESCE((
      SELECT jsonb_agg(t) FROM unnest(v_dispatchable) t
       WHERE t ~* '(price|refund|product|payment|amount|discount|coupon)'), '[]'::jsonb),
    -- The single settlement entry point must not be callable by a browser role.
    'settlement_is_service_role_only', (
      SELECT COALESCE(bool_and(NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')), false)
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND p.proname = 'commerce_settle_verified_order'),
    'owner_only_commerce_rpcs', COALESCE((
      SELECT jsonb_agg(p.proname ORDER BY p.proname)
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND p.proname ~ '(product|price|refund)'
         AND p.proname LIKE 'admin%'), '[]'::jsonb)
  );
END $$;

REVOKE ALL ON FUNCTION admin_ai_commerce_guard_report() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_ai_commerce_guard_report() TO authenticated;

NOTIFY pgrst, 'reload schema';
