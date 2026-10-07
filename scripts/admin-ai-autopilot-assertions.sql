-- M8 assertions: the autopilot is durable, policy-gated and approval/kill-switch aware.
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION _m8_raises(role_name text, claims jsonb, stmt text)
RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('SET LOCAL ROLE %I', role_name);
  PERFORM set_config('request.jwt.claims', claims::text, true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(claims->>'sub', ''), true);
  PERFORM set_config('request.jwt.claim.role', COALESCE(claims->>'role', role_name), true);
  BEGIN
    EXECUTE stmt;
    RESET ROLE;
    RETURN false;
  EXCEPTION WHEN others THEN
    RESET ROLE;
    RETURN true;
  END;
END $$;

DO $$
DECLARE
  owner jsonb := '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000001","email":"owner@lixxonstudio.com"}';
  editor jsonb := '{"role":"authenticated","sub":"00000000-0000-0000-0000-0000000000c3","email":"editor@example.com"}';
  tower jsonb;
  mission uuid;
  experiment uuid;
  action_count integer;
BEGIN
  PERFORM set_config('request.jwt.claims', owner::text, true);
  PERFORM set_config('request.jwt.claim.sub', owner->>'sub', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  SELECT admin_ai_control_tower() INTO tower;
  IF tower -> 'agents' IS NULL OR jsonb_array_length(tower -> 'agents') < 7 THEN RAISE EXCEPTION 'agent registry incomplete'; END IF;
  IF NOT EXISTS (SELECT 1 FROM admin_ai_agents WHERE agent_key = 'reliability' AND autonomy_level = 'auto_apply') THEN RAISE EXCEPTION 'safe reliability policy missing'; END IF;

  SELECT admin_ai_create_mission('M8 assertion mission','Test the mission and agent planner','ai_actions_applied',10,now()+interval '7 days',ARRAY['growth','seo'],80) INTO mission;
  IF NOT EXISTS (SELECT 1 FROM admin_ai_missions WHERE id=mission AND status='planned') THEN RAISE EXCEPTION 'mission was not persisted'; END IF;
  PERFORM admin_ai_set_mission_status(mission,'active');
  IF NOT EXISTS (SELECT 1 FROM admin_ai_missions WHERE id=mission AND status='active') THEN RAISE EXCEPTION 'mission status did not update'; END IF;

  PERFORM admin_ai_upsert_memory('m8.assertion.voice','editorial','Use a calm, evidence-led tone.',0.95,true);
  IF NOT EXISTS (SELECT 1 FROM admin_ai_memory WHERE memory_key='m8.assertion.voice' AND enabled) THEN RAISE EXCEPTION 'memory was not persisted'; END IF;

  SELECT admin_ai_create_experiment('M8 assertion experiment','The shorter CTA converts better.','homepage',NULL,'cta_click', '[{"key":"control","label":"Control"},{"key":"variant","label":"Variant"}]'::jsonb) INTO experiment;
  PERFORM admin_ai_record_experiment_event(experiment,'variant',true,1);
  IF NOT EXISTS (SELECT 1 FROM admin_ai_experiment_variants WHERE experiment_id=experiment AND variant_key='variant' AND impressions=1 AND conversions=1) THEN RAISE EXCEPTION 'experiment event was not recorded'; END IF;

  SELECT (admin_ai_run_agent('growth')->>'queued')::integer INTO action_count;
  IF action_count IS NULL THEN RAISE EXCEPTION 'growth agent did not run'; END IF;

  IF NOT _m8_raises('authenticated', editor, 'SELECT admin_ai_set_autopilot(true,false,''auto_apply'',100,''rules'')') THEN
    RAISE EXCEPTION 'editor could change autopilot policy';
  END IF;
  -- The helper temporarily changes the database role; restore the owner context.
  PERFORM set_config('request.jwt.claims', owner::text, true);
  PERFORM set_config('request.jwt.claim.sub', owner->>'sub', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;

  PERFORM admin_ai_set_autopilot(true,true,'auto_apply',100,'rules');
  IF (admin_ai_run_autopilot() ->> 'enabled')::boolean IS NOT FALSE THEN RAISE EXCEPTION 'kill switch did not stop autopilot'; END IF;
  PERFORM admin_ai_set_autopilot(false,false,'suggest',0,'rules');
END $$;

-- Phase 4 boardroom: paused/suggestion-only defaults, distinct aggregate handlers,
-- owner-only Executioner dispatch, pause behavior, and article-body immutability.
DO $$
DECLARE
  owner jsonb := '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000001","email":"owner@lixxonstudio.com"}';
  editor jsonb := '{"role":"authenticated","sub":"00000000-0000-0000-0000-0000000000c3","email":"editor@example.com"}';
  role_key text;
  role_count integer;
  queued_count integer;
  result jsonb;
  unapproved_analyze uuid;
  approved_analyze uuid;
  other_agent_analyze uuid;
  approved_unsafe uuid;
  body_before text;
  body_after text;
  fixture_post uuid := '00000000-0000-4000-8000-000000000401';
  added_editor_run boolean := false;
BEGIN
  PERFORM set_config('request.jwt.claims', owner::text, true);
  PERFORM set_config('request.jwt.claim.sub', owner->>'sub', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;

  SELECT count(*) INTO role_count
    FROM admin_ai_agents
   WHERE agent_key = ANY(ARRAY['analyst','strategist','ceo','auditor','executioner','chief_of_staff']);
  IF role_count <> 6 THEN RAISE EXCEPTION 'Phase 4 agent registry must contain exactly six roles'; END IF;
  IF EXISTS (
    SELECT 1 FROM admin_ai_agents
     WHERE agent_key = ANY(ARRAY['analyst','strategist','ceo','auditor','executioner','chief_of_staff'])
       AND (enabled OR autonomy_level <> 'suggest')
  ) THEN RAISE EXCEPTION 'Phase 4 agents must seed paused and suggestion-only'; END IF;
  IF NOT _m8_raises('authenticated', owner, 'SELECT admin_ai_run_agent(''analyst'')') THEN
    RAISE EXCEPTION 'disabled Analyst agent was allowed to run';
  END IF;
  IF NOT _m8_raises('authenticated', owner, 'SELECT admin_ai_set_agent(''analyst'',true,''auto_apply'',1440,10)') THEN
    RAISE EXCEPTION 'Analyst autonomy was raised above suggestion-only';
  END IF;

  INSERT INTO posts (id, title, slug, content, status, published_at)
  VALUES (fixture_post, 'Phase 4 body immutability fixture', 'phase-4-body-immutability-fixture', 'Owner-authored fixture prose must remain byte-for-byte unchanged.', 'draft', '1900-01-01T00:00:00Z')
  ON CONFLICT (id) DO UPDATE SET content = EXCLUDED.content, status = 'draft', published_at = EXCLUDED.published_at;
  SELECT md5(content) INTO body_before FROM posts WHERE id = fixture_post;

  FOREACH role_key IN ARRAY ARRAY['analyst','strategist','ceo','auditor','chief_of_staff'] LOOP
    PERFORM admin_ai_set_agent(role_key,true,'suggest',1440,10);
    SELECT admin_ai_run_agent(role_key) INTO result;
    -- Bounded and deterministic, not necessarily one: with measured data the Strategist
    -- adds a single grounded experiment proposal alongside its brief (Phase 4 gap 2).
    IF COALESCE((result->>'queued')::integer,0) NOT BETWEEN 1 AND 2 THEN
      RAISE EXCEPTION 'Phase 4 handler % created % suggestions, expected 1-2', role_key, result->>'queued';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM admin_ai_action_queue
       WHERE agent_key = role_key AND autonomy_level = 'suggest' AND status = 'queued'
    ) THEN RAISE EXCEPTION 'Phase 4 handler % did not leave a suggestion in the approval queue', role_key; END IF;
  END LOOP;
  SELECT count(DISTINCT action_type) INTO role_count
    FROM admin_ai_action_queue
   WHERE agent_key = ANY(ARRAY['analyst','strategist','ceo','auditor','chief_of_staff']);
  -- Each read-only role must own at least one distinct handler. Gap 2 adds
  -- experiment_proposal/experiment_start, so this is a floor, not an exact count.
  IF role_count < 5 THEN RAISE EXCEPTION 'Phase 4 read-only agents do not have distinct handlers'; END IF;
  -- A grounded proposal must never exist without its measured basis attached.
  IF EXISTS (
    SELECT 1 FROM admin_ai_action_queue
     WHERE action_type = 'experiment_proposal'
       AND (NOT (proposed ? 'basis') OR jsonb_array_length(COALESCE(proposed -> 'metric_keys', '[]'::jsonb)) = 0)
  ) THEN RAISE EXCEPTION 'A grounded experiment proposal was queued without its measured basis'; END IF;

  PERFORM admin_ai_set_agent('executioner',true,'suggest',1440,10);
  SELECT admin_ai_queue_action(
    'executioner','analyze','M8 unapproved Executioner fixture','Must remain queued until an owner approves it.',
    'low','approval_required','ops.fix','system',NULL,'{"fixture":"executioner-unapproved"}'::jsonb,NULL,NULL
  ) INTO unapproved_analyze;
  SELECT admin_ai_queue_action(
    'executioner','analyze','M8 approved Executioner fixture','Owner-approved safe statistics maintenance.',
    'low','approval_required','ops.fix','system',NULL,'{"fixture":"executioner-approved"}'::jsonb,NULL,NULL
  ) INTO approved_analyze;
  SELECT admin_ai_queue_action(
    'analyst','analyze','M8 other-agent approved fixture','Must remain approved; Executioner only dispatches its own row.',
    'low','approval_required','ops.fix','system',NULL,'{"fixture":"other-agent-approved"}'::jsonb,NULL,NULL
  ) INTO other_agent_analyze;
  SELECT admin_ai_queue_action(
    'executioner','requeue_email','M8 non-allow-listed fixture','Must not be dispatched by Executioner.',
    'low','approval_required','ops.fix','system',NULL,'{"fixture":"executioner-not-allow-listed"}'::jsonb,NULL,NULL
  ) INTO approved_unsafe;
  PERFORM admin_ai_decide_action(approved_analyze,'approve','Owner-approved Executioner fixture');
  PERFORM admin_ai_decide_action(other_agent_analyze,'approve','Approved for Analyst; not executable by Executioner');
  PERFORM admin_ai_decide_action(approved_unsafe,'approve','Owner approval does not expand Executioner allow-list');

  IF NOT EXISTS (SELECT 1 FROM role_permissions WHERE role='editor' AND permission='admin.ai.run') THEN
    INSERT INTO role_permissions(role,permission) VALUES ('editor','admin.ai.run') ON CONFLICT DO NOTHING;
    added_editor_run := true;
  END IF;
  IF NOT _m8_raises('authenticated', editor, 'SELECT admin_ai_run_agent(''executioner'')') THEN
    RAISE EXCEPTION 'Executioner ran without admin.ai.approve';
  END IF;
  IF added_editor_run THEN DELETE FROM role_permissions WHERE role='editor' AND permission='admin.ai.run'; END IF;

  PERFORM set_config('request.jwt.claims', owner::text, true);
  PERFORM set_config('request.jwt.claim.sub', owner->>'sub', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;
  SELECT admin_ai_run_agent('executioner') INTO result;
  queued_count := COALESCE((result->>'queued')::integer,0);
  IF queued_count <> 1 THEN RAISE EXCEPTION 'Executioner did not dispatch exactly one owner-approved allow-listed action'; END IF;
  IF NOT EXISTS (SELECT 1 FROM admin_ai_action_queue WHERE id=approved_analyze AND agent_key='executioner' AND action_type='analyze' AND status='applied') THEN
    RAISE EXCEPTION 'Executioner-owned approved ANALYZE action did not pass through the existing executor';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM admin_ai_action_queue WHERE id=unapproved_analyze AND agent_key='executioner' AND status='queued') THEN
    RAISE EXCEPTION 'Executioner dispatched an unapproved action';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM admin_ai_action_queue WHERE id=other_agent_analyze AND agent_key='analyst' AND status='approved') THEN
    RAISE EXCEPTION 'Executioner dispatched an approved ANALYZE action owned by another agent';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM admin_ai_action_queue WHERE id=approved_unsafe AND agent_key='executioner' AND status='approved') THEN
    RAISE EXCEPTION 'Executioner dispatched an action outside its allow-list';
  END IF;

  PERFORM admin_ai_set_agent('analyst',false,'suggest',1440,10);
  IF NOT _m8_raises('authenticated', owner, 'SELECT admin_ai_run_agent(''analyst'')') THEN
    RAISE EXCEPTION 'paused Analyst agent was allowed to run';
  END IF;
  SELECT md5(content) INTO body_after FROM posts WHERE id = fixture_post;
  IF body_before IS DISTINCT FROM body_after THEN RAISE EXCEPTION 'Phase 4 changed posts.content'; END IF;
  IF lower(pg_get_functiondef('public.admin_ai_run_agent(text,uuid)'::regprocedure)) LIKE '%update posts set content%' THEN
    RAISE EXCEPTION 'Phase 4 runner contains a posts.content write';
  END IF;
END $$;

DROP FUNCTION _m8_raises(text, jsonb, text);
