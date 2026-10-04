/*
# M10 · Admin AI Predictive Control Centre

Adds the predictive, event-driven and self-improving layer on top of M8/M9. The rules engine is
fully deterministic and provider-neutral: it records signals, forecasts, debates and proposals,
but never silently publishes, replies, changes prices, changes permissions or exposes member PII.
*/

-- -----------------------------------------------------------------------------
-- Capabilities and controlled state
-- -----------------------------------------------------------------------------
INSERT INTO admin_permissions (key, label, description, category, is_dangerous, sort_order) VALUES
  ('admin.ai.events', 'Manage AI events', 'Record and process event-driven AI signals.', 'AI Operations', true, 284),
  ('admin.ai.predictive', 'Manage AI predictions', 'Refresh the digital twin, forecasts and anomaly reviews.', 'AI Operations', false, 285),
  ('admin.ai.security', 'Manage AI security', 'Run AI security sweeps and review security findings.', 'AI Operations', true, 286),
  ('admin.ai.learning', 'Manage AI learning', 'Review workflow outcomes and self-improvement recommendations.', 'AI Operations', false, 287)
ON CONFLICT (key) DO UPDATE SET label = EXCLUDED.label, description = EXCLUDED.description,
  category = EXCLUDED.category, is_dangerous = EXCLUDED.is_dangerous, sort_order = EXCLUDED.sort_order;
INSERT INTO role_permissions (role, permission)
SELECT 'owner', key FROM admin_permissions WHERE key IN ('admin.ai.events','admin.ai.predictive','admin.ai.security','admin.ai.learning')
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS admin_ai_event_rules (
  event_type text PRIMARY KEY,
  label text NOT NULL,
  description text NOT NULL DEFAULT '',
  enabled boolean NOT NULL DEFAULT true,
  severity text NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','critical')),
  action_type text NOT NULL DEFAULT 'inspect',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE admin_ai_event_rules ENABLE ROW LEVEL SECURITY;
INSERT INTO admin_ai_event_rules(event_type,label,description,severity,action_type) VALUES
 ('traffic_drop','Traffic drop','Investigate traffic, content decay and SEO opportunities.','warning','growth_investigation'),
 ('checkout_failed','Checkout failure','Open a conversion and reliability investigation without changing payment state.','critical','commerce_investigation'),
 ('cart_abandoned','Cart abandoned','Prepare a lifecycle recommendation; never send or discount automatically.','info','lifecycle_recommendation'),
 ('article_published','Article published','Check links, citations, SEO and content graph coverage.','info','content_maintenance'),
 ('broken_link','Broken link','Create a repair proposal for owner review.','warning','link_repair'),
 ('permission_anomaly','Permission anomaly','Create a security incident and pause unsafe automation.','critical','security_review'),
 ('prompt_injection','Prompt injection signal','Quarantine the signal and require a security review.','critical','security_review'),
 ('secret_exposure','Secret exposure signal','Block the related proposal and create a critical incident.','critical','security_review')
ON CONFLICT(event_type) DO UPDATE SET label=EXCLUDED.label,description=EXCLUDED.description,severity=EXCLUDED.severity,action_type=EXCLUDED.action_type;

CREATE TABLE IF NOT EXISTS admin_ai_event_stream (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key text NOT NULL UNIQUE,
  event_type text NOT NULL,
  entity_type text,
  entity_id uuid,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  source text NOT NULL DEFAULT 'admin',
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','processing','processed','failed','ignored')),
  error text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);
ALTER TABLE admin_ai_event_stream ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_admin_ai_events_status_time ON admin_ai_event_stream(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_ai_events_type_time ON admin_ai_event_stream(event_type, created_at DESC);

CREATE TABLE IF NOT EXISTS admin_ai_twin_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_key text NOT NULL UNIQUE,
  dimensions jsonb NOT NULL DEFAULT '{}'::jsonb,
  measures jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence numeric NOT NULL DEFAULT 0 CHECK (confidence BETWEEN 0 AND 1),
  source text NOT NULL DEFAULT 'rules',
  captured_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE admin_ai_twin_snapshots ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS admin_ai_forecasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_key text NOT NULL,
  horizon_days integer NOT NULL CHECK (horizon_days BETWEEN 1 AND 365),
  baseline_value numeric NOT NULL DEFAULT 0,
  forecast_value numeric NOT NULL DEFAULT 0,
  confidence numeric NOT NULL DEFAULT 0 CHECK (confidence BETWEEN 0 AND 1),
  method text NOT NULL DEFAULT 'deterministic_trend',
  assumptions jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'review' CHECK (status IN ('draft','review','accepted','rejected')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE admin_ai_forecasts ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_admin_ai_forecasts_metric_time ON admin_ai_forecasts(metric_key, created_at DESC);

CREATE TABLE IF NOT EXISTS admin_ai_anomalies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_key text NOT NULL,
  severity text NOT NULL DEFAULT 'warning' CHECK (severity IN ('info','warning','critical')),
  observed_value numeric,
  expected_value numeric,
  explanation text NOT NULL DEFAULT '',
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved','ignored')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
ALTER TABLE admin_ai_anomalies ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_admin_ai_anomalies_open ON admin_ai_anomalies(status, created_at DESC);

CREATE TABLE IF NOT EXISTS admin_ai_agent_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_id uuid NOT NULL REFERENCES admin_ai_action_queue(id) ON DELETE CASCADE,
  plan_id uuid REFERENCES admin_ai_plans(id) ON DELETE SET NULL,
  reviewer_agent text NOT NULL,
  verdict text NOT NULL CHECK (verdict IN ('pass','review','block')),
  confidence numeric NOT NULL DEFAULT 0 CHECK (confidence BETWEEN 0 AND 1),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  concerns jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(action_id, reviewer_agent)
);
ALTER TABLE admin_ai_agent_reviews ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS admin_ai_trust_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type text NOT NULL,
  target_id uuid NOT NULL,
  confidence numeric NOT NULL DEFAULT 0 CHECK (confidence BETWEEN 0 AND 1),
  evidence_count integer NOT NULL DEFAULT 0,
  freshness_hours numeric NOT NULL DEFAULT 0,
  risk text NOT NULL DEFAULT 'medium' CHECK (risk IN ('low','medium','high','critical')),
  rationale text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(target_type, target_id)
);
ALTER TABLE admin_ai_trust_scores ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS admin_ai_knowledge_edges (
  source_id uuid NOT NULL REFERENCES admin_ai_knowledge_sources(id) ON DELETE CASCADE,
  related_source_id uuid NOT NULL REFERENCES admin_ai_knowledge_sources(id) ON DELETE CASCADE,
  relation text NOT NULL,
  strength numeric NOT NULL DEFAULT 0 CHECK (strength BETWEEN 0 AND 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(source_id, related_source_id, relation),
  CHECK(source_id <> related_source_id)
);
ALTER TABLE admin_ai_knowledge_edges ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS admin_ai_maintenance_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint text NOT NULL UNIQUE,
  task_type text NOT NULL,
  title text NOT NULL,
  detail text NOT NULL DEFAULT '',
  target_source_id uuid REFERENCES admin_ai_knowledge_sources(id) ON DELETE SET NULL,
  risk text NOT NULL DEFAULT 'low' CHECK (risk IN ('low','medium','high','critical')),
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','approved','applied','ignored')),
  proposed jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  reviewed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz
);
ALTER TABLE admin_ai_maintenance_tasks ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_admin_ai_maintenance_status ON admin_ai_maintenance_tasks(status, created_at DESC);

CREATE TABLE IF NOT EXISTS admin_ai_lifecycle_stages (
  stage_key text PRIMARY KEY,
  label text NOT NULL,
  description text NOT NULL DEFAULT '',
  position integer NOT NULL UNIQUE,
  enabled boolean NOT NULL DEFAULT true
);
ALTER TABLE admin_ai_lifecycle_stages ENABLE ROW LEVEL SECURITY;
INSERT INTO admin_ai_lifecycle_stages(stage_key,label,description,position) VALUES
 ('anonymous_reader','Anonymous reader','A reader without an identified subscription or order.','1'),
 ('returning_reader','Returning reader','A reader showing repeat engagement signals.','2'),
 ('subscriber','Subscriber','A reader with an active newsletter subscription.','3'),
 ('high_intent','High-intent visitor','A privacy-safe aggregate product or checkout signal.','4'),
 ('customer','Customer','A reader with at least one completed order.','5'),
 ('repeat_customer','Repeat customer','A customer with multiple completed orders.','6'),
 ('dormant_customer','Dormant customer','A customer without a recent order signal.','7')
ON CONFLICT(stage_key) DO UPDATE SET label=EXCLUDED.label,description=EXCLUDED.description,position=EXCLUDED.position;

CREATE TABLE IF NOT EXISTS admin_ai_lifecycle_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_key text NOT NULL REFERENCES admin_ai_lifecycle_stages(stage_key),
  member_count integer NOT NULL DEFAULT 0,
  dimensions jsonb NOT NULL DEFAULT '{}'::jsonb,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE admin_ai_lifecycle_snapshots ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_admin_ai_lifecycle_time ON admin_ai_lifecycle_snapshots(stage_key, recorded_at DESC);

CREATE TABLE IF NOT EXISTS admin_ai_security_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  finding_key text NOT NULL UNIQUE,
  severity text NOT NULL DEFAULT 'warning' CHECK (severity IN ('info','warning','critical')),
  title text NOT NULL,
  detail text NOT NULL DEFAULT '',
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved','ignored')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
ALTER TABLE admin_ai_security_findings ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS admin_ai_learning_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_type text NOT NULL,
  agent_key text REFERENCES admin_ai_agents(agent_key) ON DELETE SET NULL,
  source_id uuid,
  outcome text NOT NULL DEFAULT '',
  recommendation text NOT NULL DEFAULT '',
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','accepted','rejected','applied')),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE admin_ai_learning_signals ENABLE ROW LEVEL SECURITY;

ALTER TABLE admin_ai_commands ADD COLUMN IF NOT EXISTS replay_of uuid REFERENCES admin_ai_commands(id) ON DELETE SET NULL;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'admin_ai_event_rules','admin_ai_event_stream','admin_ai_twin_snapshots','admin_ai_forecasts','admin_ai_anomalies',
    'admin_ai_agent_reviews','admin_ai_trust_scores','admin_ai_knowledge_edges','admin_ai_maintenance_tasks',
    'admin_ai_lifecycle_stages','admin_ai_lifecycle_snapshots','admin_ai_security_findings','admin_ai_learning_signals'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_read ON %I',t,t);
    EXECUTE format('CREATE POLICY %I_read ON %I FOR SELECT TO authenticated USING (admin_can(''admin.ai.reports''))',t,t);
  END LOOP;
  IF to_regprocedure('public.audit_admin_change()') IS NOT NULL THEN
    FOREACH t IN ARRAY ARRAY[
      'admin_ai_event_rules','admin_ai_event_stream','admin_ai_twin_snapshots','admin_ai_forecasts','admin_ai_anomalies',
      'admin_ai_agent_reviews','admin_ai_trust_scores','admin_ai_knowledge_edges','admin_ai_maintenance_tasks',
      'admin_ai_lifecycle_stages','admin_ai_lifecycle_snapshots','admin_ai_security_findings','admin_ai_learning_signals'
    ] LOOP
      EXECUTE format('DROP TRIGGER IF EXISTS trg_m10_audit_%I ON %I',t,t);
      EXECUTE format('CREATE TRIGGER trg_m10_audit_%I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION audit_admin_change()',t,t);
    END LOOP;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- Event-driven signal ingestion and deterministic processing
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION admin_ai_record_event(
  p_event_type text,
  p_entity_type text DEFAULT NULL,
  p_entity_id uuid DEFAULT NULL,
  p_payload jsonb DEFAULT '{}',
  p_event_key text DEFAULT NULL,
  p_source text DEFAULT 'admin'
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE id uuid; k text;
BEGIN
  PERFORM admin_ai_require('admin.ai.events');
  k := COALESCE(NULLIF(btrim(p_event_key),''), p_event_type||':'||COALESCE(p_entity_id::text,'none')||':'||md5(COALESCE(p_payload,'{}')::text));
  INSERT INTO admin_ai_event_stream(event_key,event_type,entity_type,entity_id,payload,source,created_by)
  VALUES(k,btrim(p_event_type),p_entity_type,p_entity_id,COALESCE(p_payload,'{}'),COALESCE(p_source,'admin'),auth.uid())
  ON CONFLICT(event_key) DO UPDATE SET payload=EXCLUDED.payload, status=CASE WHEN admin_ai_event_stream.status='processed' THEN admin_ai_event_stream.status ELSE 'new' END
  RETURNING admin_ai_event_stream.id INTO id;
  RETURN id;
END $$;

CREATE OR REPLACE FUNCTION admin_ai_process_events(p_limit integer DEFAULT 50) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE e record; rule admin_ai_event_rules; processed integer:=0; failed integer:=0; created integer:=0;
BEGIN
  PERFORM admin_ai_require('admin.ai.events');
  FOR e IN SELECT * FROM admin_ai_event_stream WHERE status='new' ORDER BY created_at LIMIT LEAST(GREATEST(p_limit,1),200) LOOP
    UPDATE admin_ai_event_stream SET status='processing' WHERE id=e.id;
    BEGIN
      SELECT * INTO rule FROM admin_ai_event_rules WHERE event_type=e.event_type AND enabled;
      IF FOUND THEN
        IF e.event_type='traffic_drop' THEN
          INSERT INTO admin_ai_anomalies(metric_key,severity,explanation,evidence)
          VALUES('organic_traffic',rule.severity,'Traffic drop signal received; compare content decay, search visibility and recent releases.',e.payload);
          INSERT INTO admin_ai_action_queue(fingerprint,agent_key,action_type,title,detail,risk,autonomy_level,required_permission,proposed,status,created_by)
          VALUES('event:'||e.id,'growth','growth_investigation','Investigate traffic drop','Review digital-twin context, forecasts and affected content before proposing a change.','medium','approval_required','admin.ai.approve',e.payload,'queued',auth.uid()) ON CONFLICT(fingerprint) DO NOTHING;
          created:=created+1;
        ELSIF e.event_type='checkout_failed' THEN
          INSERT INTO admin_ai_incidents(severity,title,detail,source,evidence)
          VALUES('critical','Checkout failure signal','Payment or checkout failures require an owner-reviewed reliability and commerce investigation.','event_stream',e.payload);
          INSERT INTO admin_ai_action_queue(fingerprint,agent_key,action_type,title,detail,risk,autonomy_level,required_permission,proposed,status,created_by)
          VALUES('event:'||e.id,'commerce','commerce_investigation','Investigate checkout failure','Inspect the failure pattern without changing payment, entitlement or pricing state.','critical','approval_required','admin.ai.approve',e.payload,'queued',auth.uid()) ON CONFLICT(fingerprint) DO NOTHING;
          created:=created+1;
        ELSIF e.event_type IN ('permission_anomaly','prompt_injection','secret_exposure') THEN
          INSERT INTO admin_ai_security_findings(finding_key,severity,title,detail,evidence)
          VALUES('event:'||e.id,'critical',rule.label,'Signal quarantined. Review evidence before resuming related automation.',e.payload) ON CONFLICT(finding_key) DO NOTHING;
          INSERT INTO admin_ai_incidents(severity,title,detail,source,evidence)
          VALUES('critical',rule.label,'Security event requires review; related autonomous work must remain paused.','event_stream',e.payload);
          UPDATE admin_ai_autopilot_settings SET kill_switch=true,updated_at=now() WHERE id;
          created:=created+1;
        ELSIF e.event_type='broken_link' THEN
          INSERT INTO admin_ai_maintenance_tasks(fingerprint,task_type,title,detail,risk,proposed,created_by)
          VALUES('event:'||e.id,'link_repair','Repair broken link','Prepare a link replacement proposal and verify the destination before applying.','medium',e.payload,auth.uid()) ON CONFLICT(fingerprint) DO NOTHING;
          created:=created+1;
        ELSIF e.event_type='cart_abandoned' THEN
          INSERT INTO admin_ai_action_queue(fingerprint,agent_key,action_type,title,detail,risk,autonomy_level,required_permission,proposed,status,created_by)
          VALUES('event:'||e.id,'commerce','lifecycle_recommendation','Prepare cart recovery recommendation','Draft a privacy-safe lifecycle recommendation; sending and discounts remain approval-gated.','high','approval_required','admin.ai.approve',jsonb_build_object('aggregate_only',true)||e.payload,'queued',auth.uid()) ON CONFLICT(fingerprint) DO NOTHING;
          created:=created+1;
        ELSIF e.event_type='article_published' THEN
          INSERT INTO admin_ai_maintenance_tasks(fingerprint,task_type,title,detail,risk,proposed,created_by)
          VALUES('event:'||e.id,'content_maintenance','Run post-publication content checks','Check citations, internal links, SEO metadata and knowledge-graph coverage.','low',e.payload,auth.uid()) ON CONFLICT(fingerprint) DO NOTHING;
          created:=created+1;
        END IF;
      END IF;
      UPDATE admin_ai_event_stream SET status='processed',processed_at=now() WHERE id=e.id;
      processed:=processed+1;
    EXCEPTION WHEN others THEN
      UPDATE admin_ai_event_stream SET status='failed',error=SQLERRM,processed_at=now() WHERE id=e.id;
      failed:=failed+1;
    END;
  END LOOP;
  RETURN jsonb_build_object('processed',processed,'failed',failed,'proposals',created);
END $$;

-- -----------------------------------------------------------------------------
-- Digital twin, forecasts and anomaly detection
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION admin_ai_refresh_digital_twin() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE measures jsonb; dims jsonb; result jsonb;
BEGIN
  PERFORM admin_ai_require('admin.ai.predictive');
  measures:=jsonb_build_object(
    'published_posts',(SELECT count(*) FROM posts WHERE status='published'),
    'products',(SELECT count(*) FROM products),
    'orders',(SELECT count(*) FROM orders),
    'paid_orders',(SELECT count(*) FROM orders WHERE payment_status='paid'),
    'subscribers',(SELECT count(*) FROM newsletter_subscribers),
    'comments',(SELECT count(*) FROM comments),
    'open_actions',(SELECT count(*) FROM admin_ai_action_queue WHERE status IN ('queued','approved','paused')),
    'open_incidents',(SELECT count(*) FROM admin_ai_incidents WHERE status IN ('open','acknowledged')),
    'active_campaigns',(SELECT count(*) FROM admin_ai_campaigns WHERE status NOT IN ('completed','cancelled')),
    'revenue',(SELECT COALESCE(sum(amount),0) FROM orders WHERE payment_status='paid')
  );
  dims:=jsonb_build_object('captured_for','admin_ai','privacy','aggregate_only','source_tables',jsonb_build_array('posts','products','orders','newsletter_subscribers','comments'));
  INSERT INTO admin_ai_twin_snapshots(snapshot_key,dimensions,measures,confidence,source,captured_at)
  VALUES('current',dims,measures,0.85,'rules',now())
  ON CONFLICT(snapshot_key) DO UPDATE SET dimensions=EXCLUDED.dimensions,measures=EXCLUDED.measures,confidence=EXCLUDED.confidence,source=EXCLUDED.source,captured_at=EXCLUDED.captured_at;
  INSERT INTO admin_ai_metrics(metric_key,value,dimensions,source)
  SELECT key,value::numeric,jsonb_build_object('twin','current'),'digital_twin' FROM jsonb_each_text(measures)
  WHERE value ~ '^-?[0-9]+(\\.[0-9]+)?$';
  result:=jsonb_build_object('dimensions',dims,'measures',measures,'captured_at',now());
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION admin_ai_generate_forecasts(p_horizon_days integer DEFAULT 30) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE m record; current_value numeric; previous_value numeric; delta numeric; prediction numeric; n integer:=0;
BEGIN
  PERFORM admin_ai_require('admin.ai.predictive');
  PERFORM admin_ai_refresh_digital_twin();
  FOR m IN SELECT DISTINCT metric_key FROM admin_ai_metrics WHERE metric_key IN ('published_posts','products','orders','paid_orders','subscribers','comments','revenue','organic_traffic','conversion_rate','returning_readers') LOOP
    SELECT value INTO current_value FROM admin_ai_metrics WHERE metric_key=m.metric_key ORDER BY recorded_at DESC LIMIT 1;
    SELECT value INTO previous_value FROM admin_ai_metrics WHERE metric_key=m.metric_key ORDER BY recorded_at DESC OFFSET 1 LIMIT 1;
    previous_value:=COALESCE(previous_value,current_value);
    delta:=COALESCE(current_value,0)-COALESCE(previous_value,0);
    prediction:=GREATEST(0,COALESCE(current_value,0)+(delta*GREATEST(p_horizon_days,1)/30));
    INSERT INTO admin_ai_forecasts(metric_key,horizon_days,baseline_value,forecast_value,confidence,method,assumptions,status,created_by)
    VALUES(m.metric_key,LEAST(GREATEST(p_horizon_days,1),365),COALESCE(current_value,0),prediction,CASE WHEN current_value=previous_value THEN .55 ELSE .72 END,'deterministic_trend',jsonb_build_object('uses_recent_observation',true,'no_external_provider',true),'review',auth.uid());
    n:=n+1;
  END LOOP;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION admin_ai_scan_anomalies() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE m record; current_value numeric; previous_value numeric; change numeric; n integer:=0; sev text;
BEGIN
  PERFORM admin_ai_require('admin.ai.predictive');
  FOR m IN SELECT DISTINCT metric_key FROM admin_ai_metrics LOOP
    SELECT value INTO current_value FROM admin_ai_metrics WHERE metric_key=m.metric_key ORDER BY recorded_at DESC LIMIT 1;
    SELECT value INTO previous_value FROM admin_ai_metrics WHERE metric_key=m.metric_key ORDER BY recorded_at DESC OFFSET 1 LIMIT 1;
    IF previous_value IS NOT NULL AND previous_value<>0 THEN
      change:=(current_value-previous_value)/abs(previous_value);
      IF abs(change)>=.20 AND NOT EXISTS(SELECT 1 FROM admin_ai_anomalies WHERE metric_key=m.metric_key AND created_at>now()-interval '24 hours' AND status='open') THEN
        sev:=CASE WHEN abs(change)>=.50 THEN 'critical' ELSE 'warning' END;
        INSERT INTO admin_ai_anomalies(metric_key,severity,observed_value,expected_value,explanation,evidence)
        VALUES(m.metric_key,sev,current_value,previous_value,'Recent observation changed materially versus the previous observation.',jsonb_build_object('change_ratio',change));
        INSERT INTO admin_ai_notifications(kind,title,body,severity)
        VALUES('anomaly','AI detected a '||m.metric_key||' anomaly','Observation changed by '||round((change*100)::numeric,1)||' percent. Review the predictive control centre.',sev);
        n:=n+1;
      END IF;
    END IF;
  END LOOP;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION admin_ai_refresh_predictive() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE twin jsonb; forecasts integer; anomalies integer;
BEGIN
  PERFORM admin_ai_require('admin.ai.predictive');
  twin:=admin_ai_refresh_digital_twin(); forecasts:=admin_ai_generate_forecasts(30); anomalies:=admin_ai_scan_anomalies();
  RETURN jsonb_build_object('twin',twin,'forecasts',forecasts,'anomalies',anomalies);
END $$;

-- -----------------------------------------------------------------------------
-- Agent debate, trust and explainability
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION admin_ai_debate_queue() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a record; reviewer text; verdict text; n integer:=0; concerns jsonb; confidence numeric;
BEGIN
  PERFORM admin_ai_require('admin.ai.reports');
  FOR a IN SELECT * FROM admin_ai_action_queue WHERE status IN ('queued','approved') ORDER BY created_at DESC LIMIT 100 LOOP
    FOREACH reviewer IN ARRAY ARRAY['security','growth','content'] LOOP
      verdict:=CASE WHEN a.risk='critical' OR (reviewer='security' AND lower(a.proposed::text)~'(secret|password|service.role|private.key)') THEN 'block' WHEN a.risk IN ('high','medium') OR reviewer='content' THEN 'review' ELSE 'pass' END;
      concerns:=CASE WHEN verdict='block' THEN jsonb_build_array('High-risk or sensitive proposal requires security review') WHEN verdict='review' THEN jsonb_build_array('Human approval and evidence review required') ELSE '[]'::jsonb END;
      confidence:=CASE WHEN verdict='pass' THEN .82 WHEN verdict='review' THEN .68 ELSE .96 END;
      INSERT INTO admin_ai_agent_reviews(action_id,reviewer_agent,verdict,confidence,evidence,concerns)
      VALUES(a.id,reviewer,verdict,confidence,jsonb_build_object('action_type',a.action_type,'risk',a.risk,'deterministic',true),concerns)
      ON CONFLICT(action_id,reviewer_agent) DO UPDATE SET verdict=EXCLUDED.verdict,confidence=EXCLUDED.confidence,evidence=EXCLUDED.evidence,concerns=EXCLUDED.concerns,created_at=now();
      n:=n+1;
    END LOOP;
    INSERT INTO admin_ai_trust_scores(target_type,target_id,confidence,evidence_count,freshness_hours,risk,rationale)
    VALUES('action',a.id,CASE WHEN a.risk='critical' THEN .15 WHEN a.risk='high' THEN .52 ELSE .78 END,3,0, a.risk,'Confidence combines deterministic critic evidence, proposal risk and human approval requirements.')
    ON CONFLICT(target_type,target_id) DO UPDATE SET confidence=EXCLUDED.confidence,evidence_count=EXCLUDED.evidence_count,freshness_hours=EXCLUDED.freshness_hours,risk=EXCLUDED.risk,rationale=EXCLUDED.rationale,updated_at=now();
    IF a.risk='critical' THEN UPDATE admin_ai_action_queue SET status='paused',decision_note='Agent debate requires security review' WHERE id=a.id; END IF;
  END LOOP;
  RETURN n;
END $$;

-- -----------------------------------------------------------------------------
-- Knowledge graph and content maintenance
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION admin_ai_reindex_knowledge() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE n integer:=0; changed integer;
BEGIN
  PERFORM admin_ai_require('admin.ai.memory');
  INSERT INTO admin_ai_knowledge_sources(source_key,source_type,source_id,title,content,metadata,checksum,updated_at)
  SELECT 'post:'||p.id,'article',p.id,p.title,COALESCE(p.content,'')||E'\\n'||COALESCE(p.excerpt,''),jsonb_build_object('slug',p.slug,'status',p.status),md5(COALESCE(p.content,'')||COALESCE(p.excerpt,'')),now()
  FROM posts p WHERE p.status='published'
  ON CONFLICT(source_key) DO UPDATE SET title=EXCLUDED.title,content=EXCLUDED.content,metadata=EXCLUDED.metadata,checksum=EXCLUDED.checksum,updated_at=now();
  GET DIAGNOSTICS changed=ROW_COUNT; n:=n+changed;
  INSERT INTO admin_ai_knowledge_sources(source_key,source_type,source_id,title,content,metadata,checksum,updated_at)
  SELECT 'product:'||p.id,'product',p.id,p.name,COALESCE(p.description,'')||E'\\nBrand: '||COALESCE(p.brand,'')||E'\\nCategory: '||COALESCE(p.category,''),jsonb_build_object('brand',p.brand,'category',p.category,'price',p.price),md5(COALESCE(p.description,'')||COALESCE(p.name,'')),now()
  FROM products p
  ON CONFLICT(source_key) DO UPDATE SET title=EXCLUDED.title,content=EXCLUDED.content,metadata=EXCLUDED.metadata,checksum=EXCLUDED.checksum,updated_at=now();
  GET DIAGNOSTICS changed=ROW_COUNT; n:=n+changed;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION admin_ai_refresh_knowledge_graph() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE n integer:=0; changed integer;
BEGIN
  PERFORM admin_ai_require('admin.ai.memory');
  INSERT INTO admin_ai_knowledge_edges(source_id,related_source_id,relation,strength)
  SELECT a.id,p.id,'mentions_product',.82 FROM admin_ai_knowledge_sources a JOIN admin_ai_knowledge_sources p ON p.source_type='product' AND a.source_type='article'
  WHERE a.content ILIKE '%'||left(p.title,80)||'%' ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS changed=ROW_COUNT; n:=n+changed;
  INSERT INTO admin_ai_knowledge_edges(source_id,related_source_id,relation,strength)
  SELECT a.id,b.id,'same_topic',.55 FROM admin_ai_knowledge_sources a JOIN admin_ai_knowledge_sources b ON a.id<>b.id AND a.source_type='article' AND b.source_type='article'
  WHERE split_part(lower(a.title),' ',1)=split_part(lower(b.title),' ',1) AND length(split_part(a.title,' ',1))>4 ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS changed=ROW_COUNT; n:=n+changed;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION admin_ai_generate_maintenance_tasks() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE n integer:=0; s record;
BEGIN
  PERFORM admin_ai_require('admin.ai.predictive');
  FOR s IN SELECT * FROM admin_ai_knowledge_sources WHERE enabled AND updated_at<now()-interval '180 days' ORDER BY updated_at LIMIT 100 LOOP
    INSERT INTO admin_ai_maintenance_tasks(fingerprint,task_type,title,detail,target_source_id,risk,proposed,created_by)
    VALUES('stale:'||s.id,'content_refresh','Refresh stale knowledge source','Source has not been refreshed in 180 days; review facts, links, claims and SEO before editing.',s.id,'medium',jsonb_build_object('source_id',s.id,'source_type',s.source_type),auth.uid()) ON CONFLICT(fingerprint) DO NOTHING;
    n:=n+1;
  END LOOP;
  RETURN n;
END $$;

-- -----------------------------------------------------------------------------
-- Privacy-safe lifecycle intelligence, security sweep and learning loop
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION admin_ai_refresh_lifecycle() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE n integer:=0; count_value integer; stage text;
BEGIN
  PERFORM admin_ai_require('admin.ai.predictive');
  FOREACH stage IN ARRAY ARRAY['anonymous_reader','returning_reader','subscriber','high_intent','customer','repeat_customer','dormant_customer'] LOOP
    count_value:=CASE stage
      WHEN 'subscriber' THEN (SELECT count(*) FROM newsletter_subscribers)
      WHEN 'high_intent' THEN (SELECT count(*) FROM admin_ai_event_stream WHERE event_type IN ('product_viewed','cart_abandoned') AND created_at>now()-interval '30 days')
      WHEN 'customer' THEN (SELECT count(DISTINCT customer_email) FROM orders WHERE payment_status='paid')
      WHEN 'repeat_customer' THEN (SELECT count(*) FROM (SELECT customer_email FROM orders WHERE payment_status='paid' GROUP BY customer_email HAVING count(*)>1) x)
      WHEN 'dormant_customer' THEN (SELECT count(DISTINCT customer_email) FROM orders WHERE payment_status='paid' AND created_at<now()-interval '90 days')
      WHEN 'returning_reader' THEN (SELECT count(*) FROM user_profiles WHERE updated_at>now()-interval '30 days')
      ELSE (SELECT greatest(0,(SELECT count(*) FROM posts WHERE status='published')-(SELECT count(*) FROM newsletter_subscribers))) END;
    INSERT INTO admin_ai_lifecycle_snapshots(stage_key,member_count,dimensions) VALUES(stage,count_value,jsonb_build_object('privacy','aggregate_only','window','current'));
    n:=n+1;
  END LOOP;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION admin_ai_run_security_sweep() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE n integer:=0; a record; e record;
BEGIN
  PERFORM admin_ai_require('admin.ai.security');
  FOR a IN SELECT * FROM admin_ai_action_queue WHERE status IN ('queued','approved','running') AND lower(proposed::text)~'(password|service.role|secret|api.key|private.key)' LOOP
    INSERT INTO admin_ai_security_findings(finding_key,severity,title,detail,evidence) VALUES('action:'||a.id,'critical','Possible secret exposure in AI proposal','The proposal was quarantined by the deterministic security sweep.',jsonb_build_object('action_id',a.id,'agent_key',a.agent_key)) ON CONFLICT(finding_key) DO NOTHING;
    UPDATE admin_ai_action_queue SET status='paused',decision_note='Security sweep quarantined proposal' WHERE id=a.id;
    n:=n+1;
  END LOOP;
  FOR e IN SELECT * FROM admin_ai_event_stream WHERE event_type IN ('prompt_injection','permission_anomaly','secret_exposure') AND created_at>now()-interval '30 days' LOOP
    INSERT INTO admin_ai_security_findings(finding_key,severity,title,detail,evidence) VALUES('event:'||e.id,'critical','Security event requires review','Event stream signal remains visible until resolved.',e.payload) ON CONFLICT(finding_key) DO NOTHING;
    n:=n+1;
  END LOOP;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION admin_ai_learn_from_outcomes() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a record; n integer:=0; total integer; rejected integer;
BEGIN
  PERFORM admin_ai_require('admin.ai.learning');
  FOR a IN SELECT agent_key FROM admin_ai_action_queue WHERE agent_key IS NOT NULL GROUP BY agent_key LOOP
    SELECT count(*),count(*) FILTER(WHERE status IN ('rejected','failed','paused')) INTO total,rejected FROM admin_ai_action_queue WHERE agent_key=a.agent_key;
    IF total>0 THEN
      INSERT INTO admin_ai_learning_signals(signal_type,agent_key,outcome,recommendation,evidence)
      VALUES('agent_outcome',a.agent_key,format('%s of %s recent proposals require review or failed',rejected,total),CASE WHEN rejected*2>total THEN 'Reduce autonomy, strengthen evidence requirements and increase debate coverage.' ELSE 'Keep current policy and continue measuring downstream outcomes.' END,jsonb_build_object('total',total,'rejected_or_failed',rejected,'deterministic',true));
      n:=n+1;
    END IF;
  END LOOP;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION admin_ai_decide_maintenance(p_task_id uuid,p_decision text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  PERFORM admin_ai_require('admin.ai.approve');
  IF p_decision NOT IN ('approve','ignore') THEN RAISE EXCEPTION 'Unsupported maintenance decision'; END IF;
  UPDATE admin_ai_maintenance_tasks SET status=CASE WHEN p_decision='approve' THEN 'approved' ELSE 'ignored' END,reviewed_by=auth.uid(),reviewed_at=now() WHERE id=p_task_id;
  RETURN FOUND;
END $$;

CREATE OR REPLACE FUNCTION admin_ai_resolve_security_finding(p_finding_id uuid,p_status text DEFAULT 'resolved') RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  PERFORM admin_ai_require('admin.ai.security');
  IF p_status NOT IN ('resolved','ignored','acknowledged') THEN RAISE EXCEPTION 'Unsupported security status'; END IF;
  UPDATE admin_ai_security_findings SET status=p_status,resolved_at=CASE WHEN p_status IN ('resolved','ignored') THEN now() ELSE NULL END WHERE id=p_finding_id;
  RETURN FOUND;
END $$;

CREATE OR REPLACE FUNCTION admin_ai_replay_command(p_command_id uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE original admin_ai_commands; replay uuid;
BEGIN
  PERFORM admin_ai_require('admin.ai.missions');
  SELECT * INTO original FROM admin_ai_commands WHERE id=p_command_id; IF NOT FOUND THEN RAISE EXCEPTION 'Command not found'; END IF;
  SELECT admin_ai_ingest_command(original.command) INTO replay;
  UPDATE admin_ai_commands SET replay_of=p_command_id WHERE id=replay;
  RETURN replay;
END $$;

-- -----------------------------------------------------------------------------
-- Extend the existing control tower without removing M8/M9 data.
-- -----------------------------------------------------------------------------
ALTER FUNCTION public.admin_ai_control_tower() RENAME TO admin_ai_control_tower_m9;
CREATE OR REPLACE FUNCTION admin_ai_control_tower() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path=public AS $$
DECLARE base jsonb;
BEGIN
  PERFORM admin_ai_require('admin.ai.reports');
  base:=admin_ai_control_tower_m9();
  RETURN base || jsonb_build_object(
   'event_rules',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.event_type) FROM admin_ai_event_rules x),'[]'),
   'events',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC) FROM (SELECT * FROM admin_ai_event_stream ORDER BY created_at DESC LIMIT 40) x),'[]'),
   'twin',COALESCE((SELECT to_jsonb(x) FROM admin_ai_twin_snapshots x WHERE snapshot_key='current'),'{}'),
   'forecasts',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC) FROM (SELECT * FROM admin_ai_forecasts ORDER BY created_at DESC LIMIT 40) x),'[]'),
   'anomalies',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC) FROM admin_ai_anomalies x WHERE x.status IN ('open','acknowledged')),'[]'),
   'agent_reviews',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC) FROM (SELECT * FROM admin_ai_agent_reviews ORDER BY created_at DESC LIMIT 50) x),'[]'),
   'trust_scores',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.updated_at DESC) FROM admin_ai_trust_scores x),'[]'),
   'knowledge_edges',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC) FROM (SELECT * FROM admin_ai_knowledge_edges ORDER BY created_at DESC LIMIT 50) x),'[]'),
   'maintenance_tasks',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC) FROM (SELECT * FROM admin_ai_maintenance_tasks WHERE status IN ('proposed','approved') ORDER BY created_at DESC LIMIT 40) x),'[]'),
   'lifecycle',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.recorded_at DESC) FROM (SELECT DISTINCT ON(stage_key) * FROM admin_ai_lifecycle_snapshots ORDER BY stage_key,recorded_at DESC) x),'[]'),
   'security_findings',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC) FROM admin_ai_security_findings x WHERE x.status IN ('open','acknowledged')),'[]'),
   'learning_signals',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC) FROM (SELECT * FROM admin_ai_learning_signals WHERE status='proposed' ORDER BY created_at DESC LIMIT 40) x),'[]')
  );
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
