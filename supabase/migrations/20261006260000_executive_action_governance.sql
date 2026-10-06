-- =============================================================================
-- Phase 4 gap 2 - grounded strategy/experiment, CEO decisions, an independent
-- Auditor that can block, owner-approved dispatch, and a linked digest.
--
-- What this adds, on top of the existing M7-M10 model (no new runner, no new
-- table for jobs, and no external publishing anywhere):
--   * `admin_ai_action_audits` records an INDEPENDENT review per proposal: who
--     proposed it, who reviewed it, the criteria version, findings and the reason
--     for a block. The Auditor may not review its own proposal.
--   * A `blocked` verdict pauses the proposal and is enforced at the single
--     execution choke point (`admin_ai_execute_action`) and in dispatch, so a
--     block holds. Only a written owner override (`admin_ai_override_block`,
--     reason required) plus an explicit approval releases it.
--   * `admin_ai_dispatch_approved` dispatches ONLY owner-approved, allow-listed
--     actions: `analyze` (the existing executor), `experiment_start` (internal
--     state change) and `channel_prepare` (creates a PENDING Daily Kit draft for
--     the owner to approve - it never sends). Anything else is refused.
--   * Strategist proposals must cite measured data; CEO turns a grounded draft
--     experiment into one explicit decision; the Auditor reviews other agents;
--     Chief of Staff emits a digest whose items link to the records they refer to.
-- =============================================================================

-- ---------------------------------------------------------------- audit records
CREATE TABLE IF NOT EXISTS admin_ai_action_audits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_id uuid NOT NULL REFERENCES admin_ai_action_queue(id) ON DELETE CASCADE,
  reviewer_agent text NOT NULL DEFAULT 'auditor',
  proposer_agent text,
  verdict text NOT NULL CHECK (verdict IN ('clear','concern','blocked')),
  findings jsonb NOT NULL DEFAULT '{}'::jsonb,
  blocked_reason text,
  criteria_version integer NOT NULL DEFAULT 1,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  overridden_by uuid,
  overridden_at timestamptz,
  override_reason text,
  CHECK (verdict <> 'blocked' OR NULLIF(btrim(blocked_reason), '') IS NOT NULL),
  CHECK (overridden_at IS NULL OR override_reason IS NOT NULL)
);
ALTER TABLE admin_ai_action_audits ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS admin_ai_action_audits_action_recent
  ON admin_ai_action_audits (action_id, created_at DESC);

-- ------------------------------------------------------- the independent review
CREATE OR REPLACE FUNCTION admin_ai_audit_action(p_action_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  a admin_ai_action_queue;
  blockers jsonb := '[]'::jsonb;
  hard_blockers jsonb := '[]'::jsonb;
  warnings jsonb := '[]'::jsonb;
  verdict text;
  v_reason text;
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
  END IF;
  -- These three can never be overridden: the owner may excuse a missing basis, but not
  -- a credential exposure, external publishing, or an auto_apply boardroom agent.
  IF lower(COALESCE(a.proposed::text, '')) ~ '(password|service.role|secret|api.key|private.key|bearer )' THEN
    hard_blockers := hard_blockers || to_jsonb('Possible secret or credential exposure'::text);
    blockers := blockers || to_jsonb('Possible secret or credential exposure'::text);
  END IF;
  IF a.action_type ~* '(publish|post_now|send|email_campaign|newsletter|approve_all)' THEN
    hard_blockers := hard_blockers || to_jsonb('External publishing or sending is not an auditable automation action'::text);
    blockers := blockers || to_jsonb('External publishing or sending is not an auditable automation action'::text);
  END IF;
  IF a.agent_key IN ('analyst','strategist','ceo','auditor','executioner','chief_of_staff')
     AND a.autonomy_level = 'auto_apply' THEN
    hard_blockers := hard_blockers || to_jsonb('Boardroom agents may not operate with auto_apply autonomy'::text);
    blockers := blockers || to_jsonb('Boardroom agents may not operate with auto_apply autonomy'::text);
  END IF;
  IF a.action_type IN ('experiment_proposal','experiment_start','strategy_brief','analytics_brief','operations_digest') THEN
    IF NOT (a.proposed ? 'basis' OR a.proposed ? 'evidence' OR a.proposed ? 'metric_keys') THEN
      blockers := blockers || to_jsonb('No measured basis, evidence or metric keys are attached'::text);
    ELSIF NOT (a.proposed ? 'basis') AND jsonb_array_length(COALESCE(a.proposed -> 'metric_keys', '[]'::jsonb)) = 0 THEN
      blockers := blockers || to_jsonb('The claim cites no metric keys'::text);
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM admin_ai_autopilot_settings WHERE id AND kill_switch)
     AND a.action_type IN ('experiment_start','analyze') THEN
    blockers := blockers || to_jsonb('The AI kill switch is active'::text);
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

  INSERT INTO admin_ai_action_audits (action_id, reviewer_agent, proposer_agent, verdict, findings, blocked_reason, created_by)
  VALUES (a.id, 'auditor', a.agent_key, verdict,
          jsonb_build_object('blockers', blockers, 'hard_blockers', hard_blockers, 'warnings', warnings),
          v_reason, auth.uid());

  IF verdict = 'blocked' THEN
    UPDATE admin_ai_action_queue
       SET status = CASE WHEN status IN ('applied','rejected') THEN status ELSE 'paused' END,
           decision_note = 'Blocked by the independent Auditor: ' || COALESCE(v_reason, 'policy exception')
     WHERE id = a.id;
  END IF;

  RETURN jsonb_build_object('action_id', a.id, 'verdict', verdict, 'proposer_agent', a.agent_key,
                            'blockers', blockers, 'hard_blockers', hard_blockers, 'warnings', warnings);
END $$;

-- ------------------------------------------------------- the owner's override
CREATE OR REPLACE FUNCTION admin_ai_override_block(p_action_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
  v_verdict text;
BEGIN
  PERFORM admin_ai_require('admin.ai.approve');
  IF length(btrim(COALESCE(p_reason, ''))) < 10 THEN
    RAISE EXCEPTION 'An override requires a written reason of at least 10 characters';
  END IF;
  SELECT x.id, x.verdict INTO v_id, v_verdict
    FROM admin_ai_action_audits x WHERE x.action_id = p_action_id
   ORDER BY x.created_at DESC LIMIT 1;
  IF v_id IS NULL THEN RAISE EXCEPTION 'This action has no Auditor verdict to override'; END IF;
  IF v_verdict <> 'blocked' THEN
    RAISE EXCEPTION 'Only a blocked verdict can be overridden (latest verdict: %)', v_verdict;
  END IF;
  IF jsonb_array_length(COALESCE((SELECT x.findings -> 'hard_blockers' FROM admin_ai_action_audits x WHERE x.id = v_id), '[]'::jsonb)) > 0 THEN
    RAISE EXCEPTION 'This block cannot be overridden: %',
      (SELECT x.findings -> 'hard_blockers' ->> 0 FROM admin_ai_action_audits x WHERE x.id = v_id);
  END IF;
  UPDATE admin_ai_action_audits
     SET overridden_by = auth.uid(), overridden_at = now(), override_reason = btrim(p_reason)
   WHERE id = v_id;
  RETURN jsonb_build_object('action_id', p_action_id, 'overridden', true, 'reason', btrim(p_reason));
END $$;

-- --------------------------------- owner-approved dispatch (no publishing path)
CREATE OR REPLACE FUNCTION admin_ai_dispatch_approved(p_action_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  a admin_ai_action_queue;
  settings admin_ai_autopilot_settings;
  v_result text;
  v_payload jsonb;
  v_sha text;
  v_post uuid;
  v_channel text;
BEGIN
  PERFORM admin_ai_require('admin.ai.approve');
  SELECT * INTO settings FROM admin_ai_autopilot_settings WHERE id;
  SELECT * INTO a FROM admin_ai_action_queue WHERE id = p_action_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Action not found'; END IF;

  IF a.status <> 'approved' THEN
    RAISE EXCEPTION 'Only an owner-approved action can be dispatched (this one is %)', a.status;
  END IF;
  IF settings.kill_switch AND a.action_type IN ('analyze','experiment_start') THEN
    RAISE EXCEPTION 'AI kill switch is active';
  END IF;
  IF a.required_permission IS NOT NULL AND NOT admin_can(a.required_permission) THEN
    RAISE EXCEPTION 'Underlying permission required: %', a.required_permission;
  END IF;
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

  IF a.action_type = 'analyze' THEN
    -- The existing executor keeps its own permission, kill-switch and audit path.
    RETURN admin_ai_execute_action(a.id, false);
  ELSIF a.action_type = 'experiment_start' THEN
    IF a.target_type <> 'admin_ai_experiments' OR a.target_id IS NULL THEN
      RAISE EXCEPTION 'Experiment dispatch requires a target experiment';
    END IF;
    UPDATE admin_ai_experiments SET status = 'running', started_at = COALESCE(started_at, now())
     WHERE id = a.target_id AND status = 'draft';
    IF NOT FOUND THEN
      IF EXISTS (SELECT 1 FROM admin_ai_experiments WHERE id = a.target_id AND status = 'running') THEN
        RAISE EXCEPTION 'That experiment is already running';
      END IF;
      RAISE EXCEPTION 'Target experiment not found or not a draft';
    END IF;
    v_result := 'Experiment started (internal state only; nothing was published)';
  ELSIF a.action_type = 'channel_prepare' THEN
    IF a.target_type <> 'automation_distribution_drafts' THEN
      RAISE EXCEPTION 'Channel preparation requires a distribution draft target';
    END IF;
    v_post := NULLIF(a.proposed ->> 'post_id', '')::uuid;
    v_channel := NULLIF(a.proposed ->> 'channel_key', '');
    v_payload := COALESCE(a.proposed -> 'payload', '{}'::jsonb);
    IF v_post IS NULL OR v_channel IS NULL OR jsonb_typeof(v_payload) <> 'object' THEN
      RAISE EXCEPTION 'Channel preparation needs post_id, channel_key and a payload object';
    END IF;
    IF EXISTS (SELECT 1 FROM automation_distribution_drafts d
                WHERE d.post_id = v_post AND d.channel_key = v_channel AND d.review_status = 'sent') THEN
      RAISE EXCEPTION 'That channel draft was already sent; prepare a new draft instead of rewriting it';
    END IF;
    v_sha := encode(extensions.digest(convert_to(v_payload::text, 'UTF8'), 'sha256'), 'hex');
    INSERT INTO automation_distribution_drafts (post_id, channel_key, payload, payload_sha256, review_status, created_by, updated_by)
    VALUES (v_post, v_channel, v_payload, v_sha, 'pending', auth.uid(), auth.uid())
    ON CONFLICT (post_id, channel_key) DO UPDATE
      SET payload = EXCLUDED.payload, payload_sha256 = EXCLUDED.payload_sha256, review_status = 'pending',
          approved_payload_sha256 = NULL, approved_by = NULL, approved_at = NULL,
          updated_by = auth.uid(), updated_at = now();
    v_result := 'Draft prepared for your approval in the Daily Kit; nothing was sent';
  ELSE
    RAISE EXCEPTION 'Action type % is not dispatchable', a.action_type;
  END IF;

  UPDATE admin_ai_action_queue
     SET status = 'applied', applied_at = now(), applied_by = auth.uid(), decision_note = v_result
   WHERE id = a.id;
  INSERT INTO admin_ai_metrics(metric_key, value, dimensions, source)
  VALUES ('ai_actions_dispatched', 1, jsonb_build_object('action', a.action_type), 'rule');
  RETURN jsonb_build_object('ok', true, 'action_id', a.id, 'action_type', a.action_type, 'message', v_result);
EXCEPTION WHEN others THEN
  UPDATE admin_ai_action_queue SET status = 'failed', decision_note = SQLERRM WHERE id = p_action_id;
  RAISE;
END $$;

-- =============================================================================
-- admin_ai_execute_action, with the independent Auditor gate added. Everything
-- else (permission check, kill switch, allow-list, audit metric) is unchanged.
-- =============================================================================

CREATE OR REPLACE FUNCTION admin_ai_execute_action(p_action_id uuid, p_force boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a admin_ai_action_queue; result text; settings admin_ai_autopilot_settings;
BEGIN
  PERFORM admin_ai_require('admin.ai.approve');
  SELECT * INTO settings FROM admin_ai_autopilot_settings WHERE id;
  SELECT * INTO a FROM admin_ai_action_queue WHERE id=p_action_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Action not found'; END IF;
  IF a.status NOT IN ('approved','queued') THEN RAISE EXCEPTION 'Action is %', a.status; END IF;
  IF settings.kill_switch THEN RAISE EXCEPTION 'AI kill switch is active'; END IF;
  IF NOT p_force AND a.status <> 'approved' AND a.autonomy_level <> 'auto_apply' THEN RAISE EXCEPTION 'Approval required'; END IF;
  IF a.required_permission IS NOT NULL AND NOT admin_can(a.required_permission) THEN RAISE EXCEPTION 'Underlying permission required: %', a.required_permission; END IF;
  -- Independent Auditor gate: the LATEST verdict decides, and a block holds until the
  -- owner records a written override reason. Nothing here can bypass it silently.
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
  UPDATE admin_ai_action_queue SET status='running', applied_by=auth.uid() WHERE id=a.id;
  IF a.action_type IN ('requeue_email','repair_image_urls','backfill_seo','analyze') THEN
    result := admin_fix_issue(a.action_type);
  ELSIF a.action_type = 'seo_patch' AND a.target_type='posts' THEN
    UPDATE posts SET seo_title=COALESCE(a.proposed->>'seo_title',seo_title), seo_description=COALESCE(a.proposed->>'seo_description',seo_description), last_edited_by=auth.uid() WHERE id=a.target_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Target article not found'; END IF;
    result := 'SEO patch applied';
  ELSE
    UPDATE admin_ai_action_queue SET status='approved', decision_note=COALESCE(decision_note,'Draft/proposal requires review') WHERE id=a.id;
    RETURN jsonb_build_object('ok',true,'status','approved','message','Proposal approved and remains queued for its specialised workflow.');
  END IF;
  UPDATE admin_ai_action_queue SET status='applied', applied_at=now(), decision_note=result WHERE id=a.id;
  INSERT INTO admin_ai_metrics(metric_key,value,dimensions,source) VALUES ('ai_actions_applied',1,jsonb_build_object('action',a.action_type),'rule');
  RETURN jsonb_build_object('ok',true,'status','applied','message',result);
EXCEPTION WHEN others THEN
  UPDATE admin_ai_action_queue SET status='failed', decision_note=SQLERRM WHERE id=p_action_id;
  RAISE;
END $$;

-- =============================================================================
-- admin_ai_run_agent, rebuilt from the LATEST definition (20261006240000). Only
-- the four executive branches changed; the Analyst measured brief and every other
-- agent branch, guard and idempotency rule are preserved verbatim.
-- =============================================================================

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
      action_id := admin_ai_queue_action(
        'ceo', 'executive_scorecard', 'CEO: aggregate operating scorecard',
        'No experiment is awaiting a start decision. This deterministic scorecard is not a production-health certification or a publishing instruction.',
        'low', 'suggest', 'admin.ai.reports', 'admin_ai_autopilot_settings', NULL,
        facts || jsonb_build_object('experiment_awaiting_decision', false, 'awaiting_experiment_id', NULL),
        p_mission_id, job);
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

REVOKE ALL ON FUNCTION admin_ai_audit_action(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION admin_ai_override_block(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION admin_ai_dispatch_approved(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION admin_ai_execute_action(uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION admin_ai_run_agent(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_ai_audit_action(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_ai_override_block(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_ai_dispatch_approved(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_ai_execute_action(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_ai_run_agent(text, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
