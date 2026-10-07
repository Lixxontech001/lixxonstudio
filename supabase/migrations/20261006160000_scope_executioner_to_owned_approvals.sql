-- Restrict Executioner to approved analyze actions created for Executioner itself.
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
      'analyst', 'analytics_brief', 'Analyst: 30-day aggregate review',
      'Review aggregate metric totals and sample counts; no raw visitor, customer, or article-body records are included.',
      'low', 'suggest', 'admin.ai.reports', 'admin_ai_metrics', NULL,
      jsonb_build_object('window_days',30,'aggregates',COALESCE(facts,'[]'::jsonb)), p_mission_id, job
    );
    n := 1;
  ELSIF a.agent_key = 'strategist' THEN
    SELECT jsonb_build_object(
      'pending_actions', (SELECT count(*) FROM admin_ai_action_queue WHERE status = 'queued'),
      'approved_actions', (SELECT count(*) FROM admin_ai_action_queue WHERE status = 'approved'),
      'active_missions', (SELECT count(*) FROM admin_ai_missions WHERE status = 'active'),
      'measured_metric_keys', (SELECT count(DISTINCT metric_key) FROM admin_ai_metrics WHERE recorded_at >= now() - interval '30 days'),
      'window_days', 30
    ) INTO facts;
    action_id := admin_ai_queue_action(
      'strategist', 'strategy_brief', 'Strategist: evidence-led priority review',
      'A deterministic planning snapshot is ready. Review current proposals and active missions before changing priorities.',
      'low', 'suggest', 'admin.ai.reports', 'admin_ai_missions', NULL, facts, p_mission_id, job
    );
    n := 1;
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
    action_id := admin_ai_queue_action(
      'ceo', 'executive_scorecard', 'CEO: aggregate operating scorecard',
      'Review this deterministic operations scorecard; it is not a production-health certification or a publishing instruction.',
      'low', 'suggest', 'admin.ai.reports', 'admin_ai_autopilot_settings', NULL, facts, p_mission_id, job
    );
    n := 1;
  ELSIF a.agent_key = 'auditor' THEN
    SELECT jsonb_build_object(
      'approved_without_note', (SELECT count(*) FROM admin_ai_action_queue WHERE status = 'approved' AND NULLIF(btrim(decision_note),'') IS NULL),
      'enabled_auto_apply_agents', (SELECT count(*) FROM admin_ai_agents WHERE enabled AND autonomy_level = 'auto_apply'),
      'failed_jobs_30d', (SELECT count(*) FROM admin_ai_jobs WHERE status = 'failed' AND created_at >= now() - interval '30 days'),
      'open_critical_incidents', (SELECT count(*) FROM admin_ai_incidents WHERE severity = 'critical' AND status NOT IN ('resolved','ignored','closed')),
      'window_days', 30
    ) INTO facts;
    action_id := admin_ai_queue_action(
      'auditor', 'governance_brief', 'Auditor: approval and policy review',
      'Aggregate governance exceptions are listed for owner review; this check is read-only and does not alter records.',
      'low', 'suggest', 'admin.ai.reports', 'admin_ai_action_queue', NULL, facts, p_mission_id, job
    );
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
    SELECT jsonb_build_object(
      'pending_actions', (SELECT count(*) FROM admin_ai_action_queue WHERE status = 'queued'),
      'approved_actions', (SELECT count(*) FROM admin_ai_action_queue WHERE status = 'approved'),
      'active_missions', (SELECT count(*) FROM admin_ai_missions WHERE status = 'active'),
      'failed_jobs_7d', (SELECT count(*) FROM admin_ai_jobs WHERE status = 'failed' AND created_at >= now() - interval '7 days'),
      'open_incidents', (SELECT count(*) FROM admin_ai_incidents WHERE status NOT IN ('resolved','ignored','closed')),
      'owner_follow_up', jsonb_build_array('Review queued proposals','Check open incidents','Confirm active mission owners')
    ) INTO facts;
    action_id := admin_ai_queue_action(
      'chief_of_staff', 'operations_digest', 'Chief of Staff: owner follow-up digest',
      'A compact aggregate digest is ready for the owner; it does not send messages or mutate business records.',
      'low', 'suggest', 'admin.ai.reports', 'admin_ai_jobs', NULL, facts, p_mission_id, job
    );
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
