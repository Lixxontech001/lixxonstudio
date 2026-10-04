/*
# M9 · Admin AI CEO / Closed-loop Growth Engine

Adds strategy planning, command interpretation, grounded knowledge, content campaigns, quality
critics, audience segments and provider routing. The current provider is still `rules`; model
providers can only be introduced through an authenticated edge function that writes proposals.
*/

INSERT INTO admin_ai_agents (agent_key,label,description,autonomy_level,cadence_minutes,config) VALUES
 ('experiments','Experiment Analyst','Designs hypotheses, guardrails and measurement plans without selecting winners silently.','approval_required',1440,'{"never_auto_conclude":true}')
ON CONFLICT (agent_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS admin_ai_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 3 AND 160),
  objective text NOT NULL DEFAULT '',
  metric_key text NOT NULL DEFAULT 'health',
  target_value numeric,
  baseline_value numeric,
  deadline timestamptz,
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','active','paused','completed','cancelled')),
  priority integer NOT NULL DEFAULT 60 CHECK (priority BETWEEN 0 AND 100),
  constraints jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE admin_ai_goals ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS admin_ai_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id uuid NOT NULL REFERENCES admin_ai_goals(id) ON DELETE CASCADE,
  title text NOT NULL,
  rationale text NOT NULL DEFAULT '',
  expected_impact text NOT NULL DEFAULT '',
  risk text NOT NULL DEFAULT 'medium' CHECK (risk IN ('low','medium','high','critical')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','ready','running','paused','completed','failed')),
  owner_approved boolean NOT NULL DEFAULT false,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE admin_ai_plans ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS admin_ai_plan_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES admin_ai_plans(id) ON DELETE CASCADE,
  position integer NOT NULL,
  agent_key text REFERENCES admin_ai_agents(agent_key),
  task text NOT NULL,
  action_type text NOT NULL DEFAULT 'inspect',
  required_approval boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','blocked','completed','failed')),
  output jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(plan_id, position)
);
ALTER TABLE admin_ai_plan_steps ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS admin_ai_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  command text NOT NULL CHECK (length(btrim(command)) BETWEEN 3 AND 2000),
  status text NOT NULL DEFAULT 'interpreted' CHECK (status IN ('interpreted','planned','running','completed','failed','cancelled')),
  interpreted_intent text NOT NULL DEFAULT 'general_review',
  plan jsonb NOT NULL DEFAULT '{}'::jsonb,
  goal_id uuid REFERENCES admin_ai_goals(id) ON DELETE SET NULL,
  result jsonb,
  error text,
  requested_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
ALTER TABLE admin_ai_commands ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS admin_ai_knowledge_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_key text NOT NULL UNIQUE,
  source_type text NOT NULL CHECK (source_type IN ('article','product','comment','memory','policy','metric','manual')),
  source_id uuid,
  title text NOT NULL DEFAULT '',
  content text NOT NULL DEFAULT '',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  checksum text,
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE admin_ai_knowledge_sources ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_admin_ai_knowledge_type ON admin_ai_knowledge_sources(source_type, enabled);

CREATE TABLE IF NOT EXISTS admin_ai_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id uuid REFERENCES admin_ai_goals(id) ON DELETE SET NULL,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 3 AND 160),
  topic text NOT NULL DEFAULT '',
  audience text NOT NULL DEFAULT 'all readers',
  status text NOT NULL DEFAULT 'briefing' CHECK (status IN ('briefing','drafting','review','scheduled','running','completed','paused','cancelled')),
  start_at timestamptz,
  end_at timestamptz,
  guardrails jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE admin_ai_campaigns ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS admin_ai_campaign_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES admin_ai_campaigns(id) ON DELETE CASCADE,
  asset_type text NOT NULL CHECK (asset_type IN ('brief','article','seo','faq','newsletter','social','product_rail','measurement')),
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','draft','review','approved','scheduled','published','rejected')),
  source_ids uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(campaign_id, asset_type)
);
ALTER TABLE admin_ai_campaign_assets ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS admin_ai_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_id uuid REFERENCES admin_ai_action_queue(id) ON DELETE SET NULL,
  asset_id uuid REFERENCES admin_ai_campaign_assets(id) ON DELETE SET NULL,
  goal_id uuid REFERENCES admin_ai_goals(id) ON DELETE SET NULL,
  evaluator text NOT NULL DEFAULT 'rules',
  score integer NOT NULL DEFAULT 0 CHECK (score BETWEEN 0 AND 100),
  blockers jsonb NOT NULL DEFAULT '[]'::jsonb,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  citations uuid[] NOT NULL DEFAULT '{}',
  decision text NOT NULL DEFAULT 'review' CHECK (decision IN ('pass','review','block')),
  notes text NOT NULL DEFAULT '',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE admin_ai_evaluations ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS admin_ai_provider_routes (
  task_type text PRIMARY KEY,
  provider text NOT NULL DEFAULT 'rules' CHECK (provider IN ('rules','edge_provider','disabled')),
  model text,
  max_cost_cents integer NOT NULL DEFAULT 0 CHECK (max_cost_cents >= 0),
  enabled boolean NOT NULL DEFAULT true,
  requires_approval boolean NOT NULL DEFAULT true,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE admin_ai_provider_routes ENABLE ROW LEVEL SECURITY;
INSERT INTO admin_ai_provider_routes(task_type,provider,model) VALUES
 ('planning','rules',NULL),('research','rules',NULL),('content','rules',NULL),('seo','rules',NULL),('reply','rules',NULL),('classification','rules',NULL)
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS admin_ai_guardrails (
  rule_key text PRIMARY KEY,
  description text NOT NULL,
  value jsonb NOT NULL DEFAULT 'true'::jsonb,
  dangerous boolean NOT NULL DEFAULT false,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE admin_ai_guardrails ENABLE ROW LEVEL SECURITY;
INSERT INTO admin_ai_guardrails(rule_key,description,value,dangerous) VALUES
 ('never_auto_publish','Publishing always requires approval.','true',true),
 ('never_auto_reply','Public replies always require approval.','true',true),
 ('never_change_price','Prices and entitlements require owner approval.','true',true),
 ('require_citations_for_claims','Health/product claims need source citations.','true',true),
 ('pause_after_failures','Pause an agent after repeated failures.','3',true),
 ('protect_pii','Never expose PII to a model provider.','true',true)
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS admin_ai_audience_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text NOT NULL DEFAULT '',
  rule jsonb NOT NULL DEFAULT '{}'::jsonb,
  member_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','paused')),
  last_refreshed_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE admin_ai_audience_segments ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS admin_ai_segment_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  segment_id uuid NOT NULL REFERENCES admin_ai_audience_segments(id) ON DELETE CASCADE,
  member_count integer NOT NULL DEFAULT 0,
  dimensions jsonb NOT NULL DEFAULT '{}'::jsonb,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE admin_ai_segment_snapshots ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['admin_ai_goals','admin_ai_plans','admin_ai_plan_steps','admin_ai_commands','admin_ai_knowledge_sources','admin_ai_campaigns','admin_ai_campaign_assets','admin_ai_evaluations','admin_ai_provider_routes','admin_ai_guardrails','admin_ai_audience_segments','admin_ai_segment_snapshots'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_read ON %I',t,t);
    EXECUTE format('CREATE POLICY %I_read ON %I FOR SELECT TO authenticated USING (admin_can(''admin.ai.reports''))',t,t);
  END LOOP;
  IF to_regprocedure('public.audit_admin_change()') IS NOT NULL THEN
    FOREACH t IN ARRAY ARRAY['admin_ai_goals','admin_ai_plans','admin_ai_plan_steps','admin_ai_commands','admin_ai_knowledge_sources','admin_ai_campaigns','admin_ai_campaign_assets','admin_ai_evaluations','admin_ai_provider_routes','admin_ai_guardrails','admin_ai_audience_segments','admin_ai_segment_snapshots'] LOOP
      EXECUTE format('DROP TRIGGER IF EXISTS trg_m9_audit_%I ON %I',t,t);
      EXECUTE format('CREATE TRIGGER trg_m9_audit_%I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION audit_admin_change()',t,t);
    END LOOP;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION admin_ai_create_goal(p_title text,p_objective text,p_metric text,p_target numeric,p_baseline numeric,p_deadline timestamptz,p_priority integer DEFAULT 60,p_constraints jsonb DEFAULT '{}') RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE id uuid;
BEGIN PERFORM admin_ai_require('admin.ai.missions'); INSERT INTO admin_ai_goals(title,objective,metric_key,target_value,baseline_value,deadline,priority,constraints,created_by,updated_by) VALUES(btrim(p_title),COALESCE(p_objective,''),COALESCE(p_metric,'health'),p_target,p_baseline,p_deadline,GREATEST(0,LEAST(100,p_priority)),COALESCE(p_constraints,'{}'),auth.uid(),auth.uid()) RETURNING admin_ai_goals.id INTO id; RETURN id; END $$;

CREATE OR REPLACE FUNCTION admin_ai_generate_strategy(p_goal_id uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE plan uuid;
BEGIN
  PERFORM admin_ai_require('admin.ai.missions');
  IF NOT EXISTS(SELECT 1 FROM admin_ai_goals WHERE id=p_goal_id) THEN RAISE EXCEPTION 'Goal not found'; END IF;
  INSERT INTO admin_ai_plans(goal_id,title,rationale,expected_impact,risk,created_by,updated_by) SELECT id,'AI strategy: '||title,'The plan combines research, content, SEO, conversion and measurement steps around the owner goal.','Each step creates a reviewable proposal and records an outcome.','medium',auth.uid(),auth.uid() FROM admin_ai_goals WHERE id=p_goal_id RETURNING admin_ai_plans.id INTO plan;
  INSERT INTO admin_ai_plan_steps(plan_id,position,agent_key,task,action_type,required_approval) VALUES
   (plan,0,'growth','Research baseline and opportunity gaps.','research',true),(plan,1,'seo','Find pages and metadata with the greatest upside.','seo_patch',true),(plan,2,'content','Prepare a content brief and refresh candidates.','content_pack',true),(plan,3,'commerce','Find conversion and product-rail opportunities.','conversion_review',true),(plan,4,'community','Find questions and reader intent signals.','community_review',true),(plan,5,'experiments','Propose a controlled experiment.','experiment',true),(plan,6,'reliability','Check delivery and queue health.','health_check',false),(plan,7,'security','Review actions and guardrails before execution.','critic',true);
  UPDATE admin_ai_plans SET status='ready' WHERE id=plan; RETURN plan;
END $$;

CREATE OR REPLACE FUNCTION admin_ai_run_strategy(p_plan_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE p admin_ai_plans; s record; r jsonb:='[]'; x jsonb;
BEGIN
  PERFORM admin_ai_require('admin.ai.missions'); SELECT * INTO p FROM admin_ai_plans WHERE id=p_plan_id AND status IN ('ready','running'); IF NOT FOUND THEN RAISE EXCEPTION 'Strategy is not ready'; END IF;
  UPDATE admin_ai_plans SET status='running',updated_at=now() WHERE id=p.id;
  FOR s IN SELECT * FROM admin_ai_plan_steps WHERE plan_id=p.id AND status='pending' ORDER BY position LOOP
    UPDATE admin_ai_plan_steps SET status='running' WHERE id=s.id;
    BEGIN x:=admin_ai_run_agent(s.agent_key); UPDATE admin_ai_plan_steps SET status='completed',output=x WHERE id=s.id; r:=r||jsonb_build_array(x); EXCEPTION WHEN others THEN UPDATE admin_ai_plan_steps SET status='failed',output=jsonb_build_object('error',SQLERRM) WHERE id=s.id; r:=r||jsonb_build_array(jsonb_build_object('error',SQLERRM)); END;
  END LOOP;
  UPDATE admin_ai_plans SET status=CASE WHEN EXISTS(SELECT 1 FROM admin_ai_plan_steps WHERE plan_id=p.id AND status='failed') THEN 'failed' ELSE 'completed' END,updated_at=now() WHERE id=p.id;
  RETURN jsonb_build_object('plan_id',p.id,'steps',r);
END $$;

CREATE OR REPLACE FUNCTION admin_ai_ingest_command(p_command text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE id uuid; g uuid; intent text; plan jsonb; q text:=lower(btrim(p_command));
BEGIN
  PERFORM admin_ai_require('admin.ai.missions');
  intent:=CASE WHEN q ~ '(traffic|growth|retention|conversion)' THEN 'growth_strategy' WHEN q ~ '(seo|search|organic|ranking)' THEN 'seo_audit' WHEN q ~ '(content|article|campaign|newsletter)' THEN 'content_campaign' WHEN q ~ '(incident|broken|failure|security)' THEN 'incident_review' WHEN q ~ '(product|cart|revenue|sales)' THEN 'commerce_review' ELSE 'general_review' END;
  plan:=jsonb_build_object('intent',intent,'requested_actions',CASE intent WHEN 'growth_strategy' THEN jsonb_build_array('research','content','seo','experiment') WHEN 'content_campaign' THEN jsonb_build_array('brief','article','seo','newsletter','social') WHEN 'seo_audit' THEN jsonb_build_array('crawl','prioritise','patch','measure') ELSE jsonb_build_array('inspect','propose','measure') END,'approval_required',true);
  INSERT INTO admin_ai_goals(title,objective,metric_key,priority,status,created_by,updated_by) VALUES(left(p_command,160),p_command,CASE intent WHEN 'growth_strategy' THEN 'organic_traffic' WHEN 'commerce_review' THEN 'conversion_rate' ELSE intent END,70,'planned',auth.uid(),auth.uid()) RETURNING admin_ai_goals.id INTO g;
  INSERT INTO admin_ai_commands(command,status,interpreted_intent,plan,goal_id,requested_by) VALUES(p_command,'planned',intent,plan,g,auth.uid()) RETURNING admin_ai_commands.id INTO id;
  RETURN id;
END $$;

CREATE OR REPLACE FUNCTION admin_ai_reindex_knowledge() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE n integer:=0;
BEGIN
  PERFORM admin_ai_require('admin.ai.memory');
  INSERT INTO admin_ai_knowledge_sources(source_key,source_type,source_id,title,content,metadata,checksum,updated_at)
  SELECT 'post:'||p.id,'article',p.id,p.title,COALESCE(p.content,'')||E'\n'||COALESCE(p.excerpt,''),jsonb_build_object('slug',p.slug,'status',p.status),md5(COALESCE(p.content,'')||COALESCE(p.excerpt,'')),now() FROM posts p WHERE p.status='published' ON CONFLICT(source_key) DO UPDATE SET title=EXCLUDED.title,content=EXCLUDED.content,metadata=EXCLUDED.metadata,checksum=EXCLUDED.checksum,updated_at=now();
  GET DIAGNOSTICS n=ROW_COUNT; RETURN n;
END $$;

CREATE OR REPLACE FUNCTION admin_ai_search_knowledge(p_query text,p_limit integer DEFAULT 10) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path=public AS $$
BEGIN PERFORM admin_ai_require('admin.ai.reports'); RETURN COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT id,source_type,source_id,title,left(content,700) AS excerpt,metadata FROM admin_ai_knowledge_sources WHERE enabled AND (title ILIKE '%'||p_query||'%' OR content ILIKE '%'||p_query||'%') ORDER BY updated_at DESC LIMIT LEAST(GREATEST(p_limit,1),50)) x),'[]'); END $$;

CREATE OR REPLACE FUNCTION admin_ai_create_campaign(p_name text,p_topic text,p_audience text,p_goal_id uuid DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE id uuid;
BEGIN PERFORM admin_ai_require('admin.ai.missions'); INSERT INTO admin_ai_campaigns(name,topic,audience,goal_id,created_by) VALUES(btrim(p_name),btrim(p_topic),COALESCE(p_audience,'all readers'),p_goal_id,auth.uid()) RETURNING admin_ai_campaigns.id INTO id; INSERT INTO admin_ai_campaign_assets(campaign_id,asset_type,title,body) VALUES (id,'brief','Campaign brief','Define the audience, promise, sources, claims and success metric.'),(id,'article','Article draft','Draft an evidence-led article for owner review.'),(id,'seo','SEO package','Propose title, description, schema, FAQ and internal links.'),(id,'newsletter','Newsletter version','Prepare a newsletter adaptation for approval.'),(id,'social','Social distribution pack','Prepare channel-specific excerpts without auto-posting.'),(id,'measurement','Measurement plan','Track traffic, engagement, conversion and guardrails.'); RETURN id; END $$;

CREATE OR REPLACE FUNCTION admin_ai_generate_campaign_pack(p_campaign_id uuid) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c admin_ai_campaigns; n integer;
BEGIN PERFORM admin_ai_require('admin.ai.missions'); SELECT * INTO c FROM admin_ai_campaigns WHERE id=p_campaign_id; IF NOT FOUND THEN RAISE EXCEPTION 'Campaign not found'; END IF; UPDATE admin_ai_campaign_assets SET body=CASE asset_type WHEN 'brief' THEN 'Audience: '||c.audience||E'\nTopic: '||c.topic||E'\nSources and approval checkpoints are required.' WHEN 'article' THEN 'Proposed article topic: '||c.topic||E'\n\nOutline and draft require editorial approval.' WHEN 'seo' THEN 'Generate title, description, FAQ, schema and internal-link proposals for: '||c.topic WHEN 'newsletter' THEN 'Newsletter draft for '||c.audience||': '||c.topic WHEN 'social' THEN 'Approved excerpts for distribution about: '||c.topic WHEN 'measurement' THEN 'Primary metric, guardrails, baseline and review date for: '||c.topic ELSE body END,status='review',updated_at=now() WHERE campaign_id=c.id; GET DIAGNOSTICS n=ROW_COUNT; UPDATE admin_ai_campaigns SET status='review' WHERE id=c.id; RETURN n; END $$;

CREATE OR REPLACE FUNCTION admin_ai_review_action(p_action_id uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a admin_ai_action_queue; blockers jsonb:='[]'; warnings jsonb:='[]'; score integer:=100; decision text; id uuid;
BEGIN
  PERFORM admin_ai_require('admin.ai.approve'); SELECT q.* INTO a FROM admin_ai_action_queue q WHERE q.id=p_action_id; IF NOT FOUND THEN RAISE EXCEPTION 'Action not found'; END IF;
  IF a.proposed IS NULL OR a.proposed='{}'::jsonb THEN blockers:=blockers||jsonb_build_array('Proposal is empty'); score:=score-60; END IF;
  IF lower(COALESCE(a.proposed::text,'')) ~ '(password|service.role|secret|api.key|private.key)' THEN blockers:=blockers||jsonb_build_array('Possible secret or credential exposure'); score:=score-100; END IF;
  IF lower(COALESCE(a.proposed::text,'')) ~ '(cure|guaranteed|treats|prevents disease)' THEN warnings:=warnings||jsonb_build_array('Health claim requires a cited human review'); score:=score-20; END IF;
  decision:=CASE WHEN score<60 OR jsonb_array_length(blockers)>0 THEN 'block' WHEN score<90 OR jsonb_array_length(warnings)>0 THEN 'review' ELSE 'pass' END;
  INSERT INTO admin_ai_evaluations(action_id,evaluator,score,blockers,warnings,decision,notes,created_by) VALUES(a.id,'rules',GREATEST(0,score),blockers,warnings,decision,'Automated quality and safety critic',auth.uid()) RETURNING admin_ai_evaluations.id INTO id;
  IF decision='block' THEN UPDATE admin_ai_action_queue SET status='paused',decision_note='Quality critic blocked this proposal' WHERE id=a.id; END IF; RETURN id;
END $$;

CREATE OR REPLACE FUNCTION admin_ai_set_provider_route(p_task text,p_provider text,p_model text,p_cost integer,p_enabled boolean,p_requires_approval boolean) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN PERFORM admin_ai_require('admin.ai.policy'); IF p_provider='edge_provider' AND p_requires_approval IS NOT TRUE THEN RAISE EXCEPTION 'External providers must require approval'; END IF; INSERT INTO admin_ai_provider_routes(task_type,provider,model,max_cost_cents,enabled,requires_approval,updated_by,updated_at) VALUES(p_task,p_provider,p_model,GREATEST(0,p_cost),p_enabled,p_requires_approval,auth.uid(),now()) ON CONFLICT(task_type) DO UPDATE SET provider=EXCLUDED.provider,model=EXCLUDED.model,max_cost_cents=EXCLUDED.max_cost_cents,enabled=EXCLUDED.enabled,requires_approval=EXCLUDED.requires_approval,updated_by=auth.uid(),updated_at=now(); RETURN true; END $$;

CREATE OR REPLACE FUNCTION admin_ai_set_guardrail(p_key text,p_value jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN PERFORM admin_ai_require('admin.ai.policy'); UPDATE admin_ai_guardrails SET value=COALESCE(p_value,'true'),updated_by=auth.uid(),updated_at=now() WHERE rule_key=p_key; RETURN FOUND; END $$;

CREATE OR REPLACE FUNCTION admin_ai_create_segment(p_name text,p_description text,p_rule jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE id uuid;
BEGIN PERFORM admin_ai_require('admin.ai.missions'); INSERT INTO admin_ai_audience_segments(name,description,rule,created_by) VALUES(btrim(p_name),COALESCE(p_description,''),COALESCE(p_rule,'{}'),auth.uid()) RETURNING admin_ai_audience_segments.id INTO id; RETURN id; END $$;

CREATE OR REPLACE FUNCTION admin_ai_refresh_segment(p_id uuid) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s admin_ai_audience_segments; n integer:=0;
BEGIN PERFORM admin_ai_require('admin.ai.missions'); SELECT * INTO s FROM admin_ai_audience_segments WHERE id=p_id; IF NOT FOUND THEN RAISE EXCEPTION 'Segment not found'; END IF;
  IF COALESCE(s.rule->>'type','')='newsletter_subscribers' THEN SELECT count(*) INTO n FROM newsletter_subscribers WHERE status='subscribed'; ELSE SELECT count(*) INTO n FROM user_profiles; END IF;
  UPDATE admin_ai_audience_segments SET member_count=n,last_refreshed_at=now(),status='active' WHERE id=p_id; INSERT INTO admin_ai_segment_snapshots(segment_id,member_count,dimensions) VALUES(p_id,n,jsonb_build_object('rule',s.rule)); RETURN n;
END $$;

CREATE OR REPLACE FUNCTION admin_ai_control_tower() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path=public AS $$
DECLARE base jsonb;
BEGIN
  PERFORM admin_ai_require('admin.ai.reports');
  SELECT jsonb_build_object(
   'settings',(SELECT to_jsonb(x) FROM admin_ai_autopilot_settings x WHERE id),
   'agents',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.agent_key) FROM admin_ai_agents x),'[]'),
   'workflows',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.updated_at DESC) FROM admin_ai_workflows x),'[]'),
   'jobs',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC) FROM (SELECT * FROM admin_ai_jobs ORDER BY created_at DESC LIMIT 30) x),'[]'),
   'missions',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.priority DESC,x.created_at DESC) FROM admin_ai_missions x WHERE x.status IN ('planned','active','paused')),'[]'),
   'queue',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC) FROM admin_ai_action_queue x WHERE x.status IN ('queued','approved','paused')),'[]'),
   'legacy_suggestions',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.priority DESC,x.created_at DESC) FROM admin_ai_suggestions x WHERE x.status='open'),'[]'),
   'incidents',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC) FROM admin_ai_incidents x WHERE x.status IN ('open','acknowledged')),'[]'),
   'experiments',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC) FROM admin_ai_experiments x WHERE x.status NOT IN ('concluded','cancelled')),'[]'),
   'memory',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.category,x.memory_key) FROM admin_ai_memory x WHERE x.enabled),'[]'),
   'notifications',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC) FROM admin_ai_notifications x WHERE x.read_at IS NULL),'[]'),
   'metrics',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.recorded_at DESC) FROM admin_ai_metrics x LIMIT 40),'[]'),
   'costs',COALESCE((SELECT jsonb_build_object('today',COALESCE(sum(cost_cents),0),'total',COALESCE(sum(cost_cents),0)) FROM admin_ai_cost_ledger WHERE recorded_at::date=current_date),'{}'),
   'goals',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.priority DESC,x.created_at DESC) FROM admin_ai_goals x WHERE x.status IN ('planned','active','paused')),'[]'),
   'plans',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC) FROM admin_ai_plans x WHERE x.status NOT IN ('completed','failed')),'[]'),
   'commands',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC) FROM (SELECT * FROM admin_ai_commands ORDER BY created_at DESC LIMIT 20) x),'[]'),
   'knowledge',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.updated_at DESC) FROM (SELECT id,source_type,title,updated_at FROM admin_ai_knowledge_sources WHERE enabled ORDER BY updated_at DESC LIMIT 20) x),'[]'),
   'campaigns',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC) FROM admin_ai_campaigns x WHERE x.status NOT IN ('completed','cancelled')),'[]'),
   'evaluations',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC) FROM (SELECT * FROM admin_ai_evaluations ORDER BY created_at DESC LIMIT 20) x),'[]'),
   'routes',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.task_type) FROM admin_ai_provider_routes x),'[]'),
   'guardrails',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.rule_key) FROM admin_ai_guardrails x),'[]'),
   'segments',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.name) FROM admin_ai_audience_segments x),'[]')
  ) INTO base;
  RETURN base;
END $$;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT proname,oidvectortypes(proargtypes) args FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'admin_ai_%' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM public',r.proname,r.args);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO authenticated',r.proname,r.args);
  END LOOP;
END $$;
NOTIFY pgrst,'reload schema';
