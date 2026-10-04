/*
# M8 · Admin AI Autopilot OS

The M7 AI queue becomes a policy-driven operating system. It is intentionally provider-neutral:
rule-based agents work on free tiers today; a future model may only create proposals through an
edge function. Database permissions, autonomy levels, budgets, idempotency, approval and rollback
remain authoritative.
*/

-- -----------------------------------------------------------------------------
-- Capabilities
-- -----------------------------------------------------------------------------
INSERT INTO admin_permissions (key, label, description, category, is_dangerous, sort_order) VALUES
  ('admin.ai.policy', 'Manage AI policies', 'Enable agents, autonomy levels, budgets and the emergency stop.', 'AI Operations', true, 277),
  ('admin.ai.missions', 'Manage AI missions', 'Create growth objectives and assign them to agents.', 'AI Operations', false, 278),
  ('admin.ai.workflows', 'Manage AI workflows', 'Build and run multi-step automation workflows.', 'AI Operations', true, 279),
  ('admin.ai.memory', 'Manage AI memory', 'Review and edit durable brand, editorial and operational memory.', 'AI Operations', false, 280),
  ('admin.ai.experiments', 'Manage AI experiments', 'Create, measure and conclude controlled growth experiments.', 'AI Operations', true, 281),
  ('admin.ai.incidents', 'Manage AI incidents', 'Acknowledge, pause and resolve AI or site incidents.', 'AI Operations', true, 282),
  ('admin.ai.reports', 'View AI reports', 'View AI metrics, costs, outcomes and notifications.', 'AI Operations', false, 283)
ON CONFLICT (key) DO UPDATE SET label = EXCLUDED.label, description = EXCLUDED.description,
  category = EXCLUDED.category, is_dangerous = EXCLUDED.is_dangerous, sort_order = EXCLUDED.sort_order;
INSERT INTO role_permissions (role, permission)
SELECT 'owner', key FROM admin_permissions WHERE key LIKE 'admin.ai.%' ON CONFLICT DO NOTHING;

-- -----------------------------------------------------------------------------
-- Durable operating-system state
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_ai_autopilot_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  enabled boolean NOT NULL DEFAULT false,
  kill_switch boolean NOT NULL DEFAULT false,
  default_autonomy text NOT NULL DEFAULT 'suggest' CHECK (default_autonomy IN ('observe','suggest','draft','auto_apply','approval_required','disabled')),
  daily_budget_cents integer NOT NULL DEFAULT 0 CHECK (daily_budget_cents >= 0 AND daily_budget_cents <= 100000),
  provider text NOT NULL DEFAULT 'rules' CHECK (provider IN ('rules','edge_provider','disabled')),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO admin_ai_autopilot_settings (id) VALUES (true) ON CONFLICT DO NOTHING;
ALTER TABLE admin_ai_autopilot_settings ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS admin_ai_agents (
  agent_key text PRIMARY KEY CHECK (agent_key ~ '^[a-z][a-z0-9_]{2,40}$'),
  label text NOT NULL,
  description text NOT NULL DEFAULT '',
  enabled boolean NOT NULL DEFAULT true,
  autonomy_level text NOT NULL DEFAULT 'suggest' CHECK (autonomy_level IN ('observe','suggest','draft','auto_apply','approval_required','disabled')),
  cadence_minutes integer NOT NULL DEFAULT 1440 CHECK (cadence_minutes BETWEEN 5 AND 525600),
  max_actions integer NOT NULL DEFAULT 20 CHECK (max_actions BETWEEN 1 AND 200),
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_run_at timestamptz,
  next_run_at timestamptz,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE admin_ai_agents ENABLE ROW LEVEL SECURITY;
INSERT INTO admin_ai_agents (agent_key, label, description, autonomy_level, cadence_minutes, config) VALUES
 ('growth','Growth Agent','Finds traffic, retention, conversion and scaling opportunities.','suggest',1440,'{"goals":["traffic","retention","conversion"]}'),
 ('seo','SEO Agent','Finds metadata, schema, internal-link and content-decay opportunities.','approval_required',720,'{"max_patch_fields":["seo_title","seo_description","focus_keyword"]}'),
 ('content','Content Agent','Creates article briefs, refresh plans and repurposing proposals.','draft',1440,'{"tone":"editorial","requires_review":true}'),
 ('commerce','Commerce Agent','Finds product, bundle, abandoned-cart and conversion opportunities.','approval_required',720,'{"never_change_price":true}'),
 ('community','Community Agent','Finds unanswered, risky and high-intent community conversations.','draft',360,'{"never_auto_reply":true}'),
 ('reliability','Reliability Agent','Finds failed jobs, stale queues and safe self-healing actions.','auto_apply',60,'{"allow_list":["requeue_email","repair_image_urls","backfill_seo","analyze"]}'),
 ('security','Security Agent','Finds suspicious admin activity and pauses unsafe automation.','approval_required',60,'{"pause_on_critical":true}')
ON CONFLICT (agent_key) DO UPDATE SET label = EXCLUDED.label, description = EXCLUDED.description;

CREATE TABLE IF NOT EXISTS admin_ai_missions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 3 AND 160),
  objective text NOT NULL DEFAULT '',
  metric_key text NOT NULL DEFAULT 'health',
  target_value numeric,
  baseline_value numeric,
  deadline timestamptz,
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','active','paused','completed','cancelled')),
  priority integer NOT NULL DEFAULT 50 CHECK (priority BETWEEN 0 AND 100),
  agent_keys text[] NOT NULL DEFAULT '{}',
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  outcome jsonb,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE admin_ai_missions ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_admin_ai_missions_status ON admin_ai_missions(status, priority DESC);

CREATE TABLE IF NOT EXISTS admin_ai_workflows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 3 AND 100),
  description text NOT NULL DEFAULT '',
  trigger_type text NOT NULL DEFAULT 'manual' CHECK (trigger_type IN ('manual','schedule','event','threshold')),
  trigger_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled boolean NOT NULL DEFAULT false,
  autonomy_level text NOT NULL DEFAULT 'approval_required' CHECK (autonomy_level IN ('observe','suggest','draft','auto_apply','approval_required','disabled')),
  run_count integer NOT NULL DEFAULT 0,
  last_run_at timestamptz,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE admin_ai_workflows ENABLE ROW LEVEL SECURITY;
CREATE TABLE IF NOT EXISTS admin_ai_workflow_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id uuid NOT NULL REFERENCES admin_ai_workflows(id) ON DELETE CASCADE,
  position integer NOT NULL CHECK (position >= 0),
  agent_key text REFERENCES admin_ai_agents(agent_key),
  action_type text NOT NULL,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  requires_approval boolean NOT NULL DEFAULT true,
  UNIQUE (workflow_id, position)
);
ALTER TABLE admin_ai_workflow_steps ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS admin_ai_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('agent','workflow','mission','autopilot','report')),
  agent_key text REFERENCES admin_ai_agents(agent_key),
  mission_id uuid REFERENCES admin_ai_missions(id) ON DELETE SET NULL,
  workflow_id uuid REFERENCES admin_ai_workflows(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','completed','failed','cancelled')),
  idempotency_key text NOT NULL UNIQUE,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb,
  error text,
  requested_by uuid,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE admin_ai_jobs ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_admin_ai_jobs_recent ON admin_ai_jobs(created_at DESC, status);

CREATE TABLE IF NOT EXISTS admin_ai_action_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint text NOT NULL UNIQUE,
  agent_key text REFERENCES admin_ai_agents(agent_key),
  mission_id uuid REFERENCES admin_ai_missions(id) ON DELETE SET NULL,
  job_id uuid REFERENCES admin_ai_jobs(id) ON DELETE SET NULL,
  action_type text NOT NULL,
  title text NOT NULL,
  detail text NOT NULL DEFAULT '',
  risk text NOT NULL DEFAULT 'medium' CHECK (risk IN ('low','medium','high','critical')),
  autonomy_level text NOT NULL DEFAULT 'approval_required' CHECK (autonomy_level IN ('observe','suggest','draft','auto_apply','approval_required','disabled')),
  required_permission text,
  target_type text,
  target_id uuid,
  proposed jsonb NOT NULL DEFAULT '{}'::jsonb,
  before_state jsonb,
  after_state jsonb,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','approved','rejected','running','applied','failed','paused','expired')),
  decision_note text,
  created_by uuid,
  approved_by uuid,
  applied_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  applied_at timestamptz,
  expires_at timestamptz DEFAULT (now() + interval '30 days')
);
ALTER TABLE admin_ai_action_queue ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_admin_ai_action_queue_open ON admin_ai_action_queue(status, risk, created_at DESC);

CREATE TABLE IF NOT EXISTS admin_ai_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_key text NOT NULL UNIQUE CHECK (length(btrim(memory_key)) BETWEEN 2 AND 120),
  category text NOT NULL DEFAULT 'brand' CHECK (category IN ('brand','editorial','seo','commerce','community','security','operations')),
  content text NOT NULL CHECK (length(btrim(content)) BETWEEN 1 AND 2000),
  confidence numeric NOT NULL DEFAULT 1 CHECK (confidence BETWEEN 0 AND 1),
  source text NOT NULL DEFAULT 'owner' CHECK (source IN ('owner','decision','metric','provider','rule')),
  enabled boolean NOT NULL DEFAULT true,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE admin_ai_memory ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS admin_ai_experiments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 3 AND 140),
  hypothesis text NOT NULL DEFAULT '',
  target_type text NOT NULL,
  target_id uuid,
  metric_key text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','running','paused','concluded','cancelled')),
  traffic_percent integer NOT NULL DEFAULT 100 CHECK (traffic_percent BETWEEN 1 AND 100),
  winner text,
  conclusion text,
  guardrails jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  started_at timestamptz,
  concluded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE admin_ai_experiments ENABLE ROW LEVEL SECURITY;
CREATE TABLE IF NOT EXISTS admin_ai_experiment_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id uuid NOT NULL REFERENCES admin_ai_experiments(id) ON DELETE CASCADE,
  variant_key text NOT NULL,
  label text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  impressions integer NOT NULL DEFAULT 0,
  conversions integer NOT NULL DEFAULT 0,
  value numeric NOT NULL DEFAULT 0,
  UNIQUE (experiment_id, variant_key)
);
ALTER TABLE admin_ai_experiment_variants ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS admin_ai_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  severity text NOT NULL DEFAULT 'warning' CHECK (severity IN ('info','warning','critical')), 
  title text NOT NULL,
  detail text NOT NULL DEFAULT '',
  source text NOT NULL DEFAULT 'agent',
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved','ignored')),
  related_job_id uuid REFERENCES admin_ai_jobs(id) ON DELETE SET NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  resolution text,
  created_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  resolved_by uuid
);
ALTER TABLE admin_ai_incidents ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS admin_ai_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL DEFAULT 'info',
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  href text,
  severity text NOT NULL DEFAULT 'info',
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE admin_ai_notifications ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS admin_ai_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_key text NOT NULL,
  value numeric NOT NULL DEFAULT 0,
  dimensions jsonb NOT NULL DEFAULT '{}'::jsonb,
  source text NOT NULL DEFAULT 'rule',
  recorded_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE admin_ai_metrics ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_admin_ai_metrics_key_time ON admin_ai_metrics(metric_key, recorded_at DESC);

CREATE TABLE IF NOT EXISTS admin_ai_cost_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid REFERENCES admin_ai_jobs(id) ON DELETE SET NULL,
  provider text NOT NULL DEFAULT 'rules',
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  cost_cents integer NOT NULL DEFAULT 0 CHECK (cost_cents >= 0),
  recorded_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE admin_ai_cost_ledger ENABLE ROW LEVEL SECURITY;

-- Read access is capability-gated; all writes happen through SECURITY DEFINER RPCs.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['admin_ai_autopilot_settings','admin_ai_agents','admin_ai_missions','admin_ai_workflows','admin_ai_workflow_steps','admin_ai_jobs','admin_ai_action_queue','admin_ai_memory','admin_ai_experiments','admin_ai_experiment_variants','admin_ai_incidents','admin_ai_notifications','admin_ai_metrics','admin_ai_cost_ledger'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_read ON %I', t, t);
    EXECUTE format('CREATE POLICY %I_read ON %I FOR SELECT TO authenticated USING (admin_can(''admin.ai.reports''))', t, t);
  END LOOP;
END $$;

-- Audit every durable AI object. The trigger is idempotent and already exists from M7.
DO $$
DECLARE t text;
BEGIN
  IF to_regprocedure('public.audit_admin_change()') IS NOT NULL THEN
    FOREACH t IN ARRAY ARRAY['admin_ai_autopilot_settings','admin_ai_agents','admin_ai_missions','admin_ai_workflows','admin_ai_workflow_steps','admin_ai_jobs','admin_ai_action_queue','admin_ai_memory','admin_ai_experiments','admin_ai_experiment_variants','admin_ai_incidents','admin_ai_notifications','admin_ai_metrics','admin_ai_cost_ledger'] LOOP
      EXECUTE format('DROP TRIGGER IF EXISTS trg_m8_audit_%I ON %I', t, t);
      EXECUTE format('CREATE TRIGGER trg_m8_audit_%I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION audit_admin_change()', t, t);
    END LOOP;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- Helpers and action generation
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION admin_ai_require(p_permission text DEFAULT 'admin.ai.run')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT admin_can(p_permission) THEN RAISE EXCEPTION 'forbidden'; END IF;
END $$;
REVOKE ALL ON FUNCTION admin_ai_require(text) FROM public;

CREATE OR REPLACE FUNCTION admin_ai_queue_action(
  p_agent text, p_action text, p_title text, p_detail text, p_risk text, p_autonomy text,
  p_permission text, p_target_type text, p_target_id uuid, p_proposed jsonb,
  p_mission uuid DEFAULT NULL, p_job uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE id uuid; fp text;
BEGIN
  fp := md5(concat_ws(':', p_agent, p_action, COALESCE(p_target_type,''), COALESCE(p_target_id::text,''), COALESCE(p_proposed::text,'')));
  INSERT INTO admin_ai_action_queue (fingerprint, agent_key, mission_id, job_id, action_type, title, detail, risk, autonomy_level, required_permission, target_type, target_id, proposed, created_by)
  VALUES (fp, p_agent, p_mission, p_job, p_action, left(p_title,160), left(p_detail,4000), p_risk, p_autonomy, p_permission, p_target_type, p_target_id, COALESCE(p_proposed,'{}'), auth.uid())
  ON CONFLICT (fingerprint) DO UPDATE SET detail = EXCLUDED.detail, proposed = EXCLUDED.proposed,
    autonomy_level = EXCLUDED.autonomy_level, risk = EXCLUDED.risk,
    status = CASE WHEN admin_ai_action_queue.status IN ('applied','rejected') THEN admin_ai_action_queue.status ELSE 'queued' END
  RETURNING admin_ai_action_queue.id INTO id;
  RETURN id;
END $$;

CREATE OR REPLACE FUNCTION admin_ai_run_agent(p_agent_key text, p_mission_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a admin_ai_agents; job uuid; n integer := 0; row record; action_id uuid;
  idem text := 'agent:' || p_agent_key || ':' || to_char(now(),'YYYY-MM-DD-HH24-MI');
BEGIN
  PERFORM admin_ai_require('admin.ai.run');
  SELECT * INTO a FROM admin_ai_agents WHERE agent_key = lower(trim(p_agent_key)) AND enabled AND autonomy_level <> 'disabled';
  IF NOT FOUND THEN RAISE EXCEPTION 'Agent is disabled or unknown'; END IF;
  INSERT INTO admin_ai_jobs (kind, agent_key, mission_id, idempotency_key, requested_by, status, started_at)
  VALUES ('agent', a.agent_key, p_mission_id, idem, auth.uid(), 'running', now())
  ON CONFLICT (idempotency_key) DO UPDATE SET status = CASE WHEN admin_ai_jobs.status = 'failed' THEN 'running' ELSE admin_ai_jobs.status END
  RETURNING id INTO job;
  IF EXISTS (SELECT 1 FROM admin_ai_jobs WHERE id = job AND status = 'completed') THEN RETURN jsonb_build_object('job_id',job,'queued',0,'deduplicated',true); END IF;

  IF a.agent_key IN ('seo','content') THEN
    FOR row IN SELECT id, title, excerpt FROM posts WHERE status = 'published' AND (seo_title IS NULL OR btrim(seo_title) = '' OR seo_description IS NULL OR btrim(seo_description) = '') ORDER BY updated_at DESC NULLS LAST LIMIT a.max_actions LOOP
      action_id := admin_ai_queue_action(a.agent_key, 'seo_patch', 'Improve SEO: ' || row.title, 'A safe metadata patch is available; content body is never changed by this agent.', 'low', CASE WHEN a.agent_key = 'seo' THEN a.autonomy_level ELSE 'approval_required' END, 'content.write', 'posts', row.id, jsonb_build_object('seo_title', left(row.title,60), 'seo_description', left(COALESCE(NULLIF(row.excerpt,''),row.title),155)), p_mission_id, job);
      n := n + 1;
    END LOOP;
  ELSIF a.agent_key = 'community' THEN
    FOR row IN SELECT id, content FROM comments WHERE is_approved AND is_visible AND (admin_reply IS NOT TRUE) ORDER BY created_at ASC LIMIT a.max_actions LOOP
      action_id := admin_ai_queue_action(a.agent_key, 'reply_draft', 'Reply needed for community comment', 'A context-aware reply draft is ready for review.', 'medium', 'draft', 'content.moderate', 'comments', row.id, jsonb_build_object('body', 'Thanks for joining the conversation. We appreciate you reading and will keep this in mind for a future guide.'), p_mission_id, job);
      n := n + 1;
    END LOOP;
  ELSIF a.agent_key = 'commerce' THEN
    FOR row IN SELECT id, name FROM products WHERE is_active AND (description IS NULL OR btrim(description) = '') ORDER BY updated_at DESC NULLS LAST LIMIT a.max_actions LOOP
      action_id := admin_ai_queue_action(a.agent_key, 'product_copy_draft', 'Improve product copy: ' || row.name, 'The product needs a clearer description and conversion-focused structure.', 'medium', 'draft', 'commerce.pricing', 'products', row.id, jsonb_build_object('brief', 'Add what it is, who it is for, benefits, proof and a clear next step.'), p_mission_id, job);
      n := n + 1;
    END LOOP;
  ELSIF a.agent_key = 'reliability' THEN
    FOR row IN SELECT fix_key, title, detail FROM admin_suggestions() WHERE fix_key IN ('requeue_email','repair_image_urls','backfill_seo','analyze') LIMIT a.max_actions LOOP
      action_id := admin_ai_queue_action(a.agent_key, row.fix_key, row.title, row.detail, 'low', 'auto_apply', 'ops.fix', 'system', NULL, jsonb_build_object('fix_key',row.fix_key), p_mission_id, job);
      n := n + 1;
    END LOOP;
  ELSIF a.agent_key = 'security' THEN
    INSERT INTO admin_ai_incidents (severity, title, detail, source, evidence, related_job_id)
    SELECT CASE WHEN count(*) > 10 THEN 'critical' ELSE 'warning' END, 'Review recent AI activity', 'Security agent requests an owner review of AI actions and policy changes.', 'security', jsonb_build_object('ai_actions_last_day', count(*)), job
    FROM admin_ai_action_queue WHERE created_at > now() - interval '1 day';
    n := 1;
  ELSE
    INSERT INTO admin_ai_action_queue (fingerprint, agent_key, job_id, action_type, title, detail, risk, autonomy_level, required_permission, proposed, created_by)
    VALUES (md5(a.agent_key || ':growth:' || current_date), a.agent_key, job, 'growth_brief', 'Create a growth review', 'Review traffic, retention and conversion trends against the active mission.', 'low', 'suggest', 'analytics.read', jsonb_build_object('agent',a.agent_key), auth.uid()) ON CONFLICT DO NOTHING;
    n := 1;
  END IF;
  UPDATE admin_ai_jobs SET status='completed', result=jsonb_build_object('queued',n), finished_at=now() WHERE id=job;
  UPDATE admin_ai_agents SET last_run_at=now(), next_run_at=now() + make_interval(mins => a.cadence_minutes), updated_at=now() WHERE agent_key=a.agent_key;
  RETURN jsonb_build_object('job_id',job,'agent',a.agent_key,'queued',n);
EXCEPTION WHEN others THEN
  IF job IS NOT NULL THEN UPDATE admin_ai_jobs SET status='failed', error=SQLERRM, finished_at=now() WHERE id=job; END IF;
  RAISE;
END $$;

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

CREATE OR REPLACE FUNCTION admin_ai_decide_action(p_action_id uuid, p_decision text, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a admin_ai_action_queue;
BEGIN
  PERFORM admin_ai_require('admin.ai.approve');
  SELECT * INTO a FROM admin_ai_action_queue WHERE id=p_action_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Action not found'; END IF;
  IF lower(p_decision) NOT IN ('approve','reject','pause','apply') THEN RAISE EXCEPTION 'Unknown decision'; END IF;
  IF lower(p_decision)='apply' THEN RETURN admin_ai_execute_action(p_action_id,true); END IF;
  UPDATE admin_ai_action_queue SET status=CASE lower(p_decision) WHEN 'approve' THEN 'approved' WHEN 'reject' THEN 'rejected' ELSE 'paused' END, decision_note=p_note, approved_by=CASE WHEN lower(p_decision)='approve' THEN auth.uid() ELSE approved_by END, approved_at=CASE WHEN lower(p_decision)='approve' THEN now() ELSE approved_at END WHERE id=p_action_id;
  RETURN jsonb_build_object('ok',true,'status',CASE lower(p_decision) WHEN 'approve' THEN 'approved' WHEN 'reject' THEN 'rejected' ELSE 'paused' END);
END $$;

CREATE OR REPLACE FUNCTION admin_ai_execute_autonomous()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s admin_ai_autopilot_settings; a record; n integer:=0;
BEGIN
  PERFORM admin_ai_require('admin.ai.run');
  SELECT * INTO s FROM admin_ai_autopilot_settings WHERE id;
  IF NOT s.enabled OR s.kill_switch THEN RETURN jsonb_build_object('enabled',false,'applied',0); END IF;
  FOR a IN SELECT id FROM admin_ai_action_queue WHERE status='queued' AND autonomy_level='auto_apply' AND risk='low' ORDER BY created_at LIMIT 50 LOOP
    BEGIN PERFORM admin_ai_execute_action(a.id,false); n:=n+1; EXCEPTION WHEN others THEN NULL; END;
  END LOOP;
  RETURN jsonb_build_object('enabled',true,'applied',n);
END $$;

CREATE OR REPLACE FUNCTION admin_ai_run_autopilot()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s admin_ai_autopilot_settings; a record; out jsonb:='[]'::jsonb; x jsonb;
BEGIN
  PERFORM admin_ai_require('admin.ai.run');
  SELECT * INTO s FROM admin_ai_autopilot_settings WHERE id;
  IF NOT s.enabled OR s.kill_switch THEN RETURN jsonb_build_object('enabled',false,'reason',CASE WHEN s.kill_switch THEN 'kill_switch' ELSE 'disabled' END); END IF;
  FOR a IN SELECT agent_key FROM admin_ai_agents WHERE enabled AND autonomy_level <> 'disabled' AND (next_run_at IS NULL OR next_run_at <= now()) ORDER BY agent_key LOOP
    BEGIN x:=admin_ai_run_agent(a.agent_key); out:=out || jsonb_build_array(x); EXCEPTION WHEN others THEN out:=out || jsonb_build_array(jsonb_build_object('agent',a.agent_key,'error',SQLERRM)); END;
  END LOOP;
  RETURN jsonb_build_object('enabled',true,'agents',out,'execution',admin_ai_execute_autonomous());
END $$;

-- -----------------------------------------------------------------------------
-- Missions, policies, memory, experiments, incidents and reports
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION admin_ai_set_autopilot(p_enabled boolean, p_kill_switch boolean, p_default_autonomy text, p_budget integer, p_provider text DEFAULT 'rules') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  PERFORM admin_ai_require('admin.ai.policy');
  IF p_default_autonomy NOT IN ('observe','suggest','draft','auto_apply','approval_required','disabled') THEN RAISE EXCEPTION 'invalid autonomy'; END IF;
  IF p_provider NOT IN ('rules','edge_provider','disabled') THEN RAISE EXCEPTION 'invalid provider'; END IF;
  UPDATE admin_ai_autopilot_settings SET enabled=COALESCE(p_enabled,false), kill_switch=COALESCE(p_kill_switch,false), default_autonomy=p_default_autonomy, daily_budget_cents=GREATEST(0,LEAST(100000,COALESCE(p_budget,0))), provider=p_provider, updated_by=auth.uid(), updated_at=now() WHERE id;
  RETURN (SELECT to_jsonb(x) FROM admin_ai_autopilot_settings x WHERE id);
END $$;

CREATE OR REPLACE FUNCTION admin_ai_set_agent(p_agent_key text,p_enabled boolean,p_autonomy text,p_cadence integer,p_max_actions integer,p_config jsonb DEFAULT '{}'::jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  PERFORM admin_ai_require('admin.ai.policy');
  UPDATE admin_ai_agents SET enabled=p_enabled, autonomy_level=p_autonomy, cadence_minutes=GREATEST(5,LEAST(525600,p_cadence)), max_actions=GREATEST(1,LEAST(200,p_max_actions)), config=COALESCE(p_config,'{}'), updated_by=auth.uid(), updated_at=now() WHERE agent_key=lower(p_agent_key);
  IF NOT FOUND THEN RAISE EXCEPTION 'agent not found'; END IF; RETURN (SELECT to_jsonb(x) FROM admin_ai_agents x WHERE agent_key=lower(p_agent_key));
END $$;

CREATE OR REPLACE FUNCTION admin_ai_create_mission(p_title text,p_objective text,p_metric text,p_target numeric,p_deadline timestamptz,p_agents text[],p_priority integer DEFAULT 50) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE id uuid;
BEGIN
  PERFORM admin_ai_require('admin.ai.missions');
  INSERT INTO admin_ai_missions(title,objective,metric_key,target_value,deadline,agent_keys,priority,status,created_by,updated_by) VALUES (btrim(p_title),COALESCE(p_objective,''),COALESCE(p_metric,'health'),p_target,p_deadline,COALESCE(p_agents,'{}'),GREATEST(0,LEAST(100,p_priority)),'planned',auth.uid(),auth.uid()) RETURNING admin_ai_missions.id INTO id; RETURN id;
END $$;

CREATE OR REPLACE FUNCTION admin_ai_set_mission_status(p_id uuid,p_status text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN PERFORM admin_ai_require('admin.ai.missions'); IF p_status NOT IN ('planned','active','paused','completed','cancelled') THEN RAISE EXCEPTION 'invalid status'; END IF; UPDATE admin_ai_missions SET status=p_status,updated_by=auth.uid(),updated_at=now() WHERE id=p_id; RETURN FOUND; END $$;

CREATE OR REPLACE FUNCTION admin_ai_upsert_memory(p_key text,p_category text,p_content text,p_confidence numeric DEFAULT 1,p_enabled boolean DEFAULT true) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE id uuid;
BEGIN PERFORM admin_ai_require('admin.ai.memory'); INSERT INTO admin_ai_memory(memory_key,category,content,confidence,source,enabled,created_by,updated_by) VALUES (btrim(p_key),p_category,btrim(p_content),LEAST(1,GREATEST(0,p_confidence)),'owner',p_enabled,auth.uid(),auth.uid()) ON CONFLICT(memory_key) DO UPDATE SET category=EXCLUDED.category,content=EXCLUDED.content,confidence=EXCLUDED.confidence,enabled=EXCLUDED.enabled,updated_by=auth.uid(),updated_at=now() RETURNING admin_ai_memory.id INTO id; RETURN id; END $$;

CREATE OR REPLACE FUNCTION admin_ai_create_experiment(p_name text,p_hypothesis text,p_target_type text,p_target_id uuid,p_metric text,p_variants jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE id uuid; v jsonb;
BEGIN PERFORM admin_ai_require('admin.ai.experiments'); INSERT INTO admin_ai_experiments(name,hypothesis,target_type,target_id,metric_key,created_by) VALUES (btrim(p_name),COALESCE(p_hypothesis,''),p_target_type,p_target_id,p_metric,auth.uid()) RETURNING admin_ai_experiments.id INTO id; FOR v IN SELECT value FROM jsonb_array_elements(COALESCE(p_variants,'[]')) LOOP INSERT INTO admin_ai_experiment_variants(experiment_id,variant_key,label,payload) VALUES(id,v->>'key',COALESCE(v->>'label',v->>'key'),COALESCE(v->'payload','{}')); END LOOP; RETURN id; END $$;

CREATE OR REPLACE FUNCTION admin_ai_record_experiment_event(p_experiment uuid,p_variant text,p_converted boolean,p_value numeric DEFAULT 0) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN PERFORM admin_ai_require('admin.ai.experiments'); UPDATE admin_ai_experiment_variants SET impressions=impressions+1,conversions=conversions+CASE WHEN p_converted THEN 1 ELSE 0 END,value=value+COALESCE(p_value,0) WHERE experiment_id=p_experiment AND variant_key=p_variant; RETURN FOUND; END $$;

CREATE OR REPLACE FUNCTION admin_ai_set_experiment_status(p_id uuid,p_status text,p_winner text DEFAULT NULL,p_conclusion text DEFAULT NULL) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN PERFORM admin_ai_require('admin.ai.experiments'); IF p_status NOT IN ('draft','running','paused','concluded','cancelled') THEN RAISE EXCEPTION 'invalid experiment status'; END IF; UPDATE admin_ai_experiments SET status=p_status,winner=COALESCE(p_winner,winner),conclusion=COALESCE(p_conclusion,conclusion),started_at=CASE WHEN p_status='running' AND started_at IS NULL THEN now() ELSE started_at END,concluded_at=CASE WHEN p_status='concluded' THEN now() ELSE concluded_at END WHERE id=p_id; RETURN FOUND; END $$;

CREATE OR REPLACE FUNCTION admin_ai_resolve_incident(p_id uuid,p_status text,p_resolution text DEFAULT NULL) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN PERFORM admin_ai_require('admin.ai.incidents'); IF p_status NOT IN ('open','acknowledged','resolved','ignored') THEN RAISE EXCEPTION 'invalid incident status'; END IF; UPDATE admin_ai_incidents SET status=p_status,resolution=COALESCE(p_resolution,resolution),acknowledged_at=CASE WHEN p_status IN ('acknowledged','resolved') AND acknowledged_at IS NULL THEN now() ELSE acknowledged_at END,resolved_at=CASE WHEN p_status IN ('resolved','ignored') THEN now() ELSE resolved_at END,resolved_by=CASE WHEN p_status IN ('resolved','ignored') THEN auth.uid() ELSE resolved_by END WHERE id=p_id; RETURN FOUND; END $$;

CREATE OR REPLACE FUNCTION admin_ai_ack_notification(p_id uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN PERFORM admin_ai_require('admin.ai.reports'); UPDATE admin_ai_notifications SET read_at=now() WHERE id=p_id; RETURN FOUND; END $$;

CREATE OR REPLACE FUNCTION admin_ai_create_workflow(p_name text, p_description text, p_trigger text, p_autonomy text, p_steps jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE id uuid; step jsonb; pos integer := 0;
BEGIN
  PERFORM admin_ai_require('admin.ai.workflows');
  IF p_trigger NOT IN ('manual','schedule','event','threshold') OR p_autonomy NOT IN ('observe','suggest','draft','auto_apply','approval_required','disabled') THEN RAISE EXCEPTION 'invalid workflow policy'; END IF;
  INSERT INTO admin_ai_workflows(name,description,trigger_type,autonomy_level,created_by,updated_by)
  VALUES (btrim(p_name),COALESCE(p_description,''),p_trigger,p_autonomy,auth.uid(),auth.uid()) RETURNING admin_ai_workflows.id INTO id;
  FOR step IN SELECT value FROM jsonb_array_elements(COALESCE(p_steps,'[]'::jsonb)) LOOP
    INSERT INTO admin_ai_workflow_steps(workflow_id,position,agent_key,action_type,config,requires_approval)
    VALUES (id,pos,NULLIF(step->>'agent_key',''),COALESCE(step->>'action_type','inspect'),COALESCE(step->'config','{}'::jsonb),COALESCE((step->>'requires_approval')::boolean,true));
    pos := pos + 1;
  END LOOP;
  RETURN id;
END $$;

CREATE OR REPLACE FUNCTION admin_ai_set_workflow(p_id uuid, p_enabled boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN PERFORM admin_ai_require('admin.ai.workflows'); UPDATE admin_ai_workflows SET enabled=COALESCE(p_enabled,false),updated_by=auth.uid(),updated_at=now() WHERE id=p_id; RETURN FOUND; END $$;

CREATE OR REPLACE FUNCTION admin_ai_run_workflow(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE w admin_ai_workflows; s record; result jsonb := '[]'::jsonb; x jsonb;
BEGIN
  PERFORM admin_ai_require('admin.ai.workflows');
  SELECT * INTO w FROM admin_ai_workflows WHERE id=p_id AND enabled;
  IF NOT FOUND THEN RAISE EXCEPTION 'Workflow is disabled or missing'; END IF;
  INSERT INTO admin_ai_jobs(kind,workflow_id,idempotency_key,requested_by,status,started_at) VALUES ('workflow',w.id,'workflow:'||w.id::text||':'||to_char(now(),'YYYY-MM-DD-HH24-MI'),auth.uid(),'running',now()) ON CONFLICT (idempotency_key) DO NOTHING;
  FOR s IN SELECT * FROM admin_ai_workflow_steps WHERE workflow_id=w.id ORDER BY position LOOP
    BEGIN
      IF s.agent_key IS NOT NULL THEN x := admin_ai_run_agent(s.agent_key,NULL); ELSE x := jsonb_build_object('step',s.action_type,'status','queued'); END IF;
      result := result || jsonb_build_array(x);
    EXCEPTION WHEN others THEN result := result || jsonb_build_array(jsonb_build_object('step',s.position,'error',SQLERRM)); END;
  END LOOP;
  UPDATE admin_ai_workflows SET run_count=run_count+1,last_run_at=now(),updated_at=now() WHERE id=w.id;
  RETURN jsonb_build_object('workflow_id',w.id,'steps',result);
END $$;

CREATE OR REPLACE FUNCTION admin_ai_control_tower() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path=public AS $$
BEGIN PERFORM admin_ai_require('admin.ai.reports'); RETURN jsonb_build_object(
 'settings',(SELECT to_jsonb(x) FROM admin_ai_autopilot_settings x WHERE id),
 'agents',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.agent_key) FROM admin_ai_agents x),'[]'),
 'workflows',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.updated_at DESC) FROM admin_ai_workflows x),'[]'),
 'jobs',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC) FROM (SELECT * FROM admin_ai_jobs ORDER BY created_at DESC LIMIT 30) x),'[]'),
 'missions',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.priority DESC,x.created_at DESC) FROM admin_ai_missions x WHERE x.status IN ('planned','active','paused')),'[]'),
 'queue',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY CASE x.risk WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,x.created_at DESC) FROM admin_ai_action_queue x WHERE x.status IN ('queued','approved','paused')),'[]'),
 'legacy_suggestions',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.priority DESC,x.created_at DESC) FROM admin_ai_suggestions x WHERE x.status='open'),'[]'),
 'incidents',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC) FROM admin_ai_incidents x WHERE x.status IN ('open','acknowledged')),'[]'),
 'experiments',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC) FROM admin_ai_experiments x WHERE x.status NOT IN ('concluded','cancelled')),'[]'),
 'memory',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.category,x.memory_key) FROM admin_ai_memory x WHERE x.enabled),'[]'),
 'notifications',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC) FROM admin_ai_notifications x WHERE x.read_at IS NULL LIMIT 20),'[]'),
 'metrics',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.recorded_at DESC) FROM admin_ai_metrics x LIMIT 40),'[]'),
 'costs',COALESCE((SELECT jsonb_build_object('today',COALESCE(sum(cost_cents),0),'total',COALESCE(sum(cost_cents),0)) FROM admin_ai_cost_ledger WHERE recorded_at::date=current_date),'{}')
 ); END $$;

-- Granted only to authenticated admins; each function performs its own capability check.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT proname, oidvectortypes(proargtypes) args FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'admin_ai_%' AND proname NOT IN ('admin_ai_require') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM public',r.proname,r.args);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO authenticated',r.proname,r.args);
  END LOOP;
END $$;
NOTIFY pgrst, 'reload schema';
