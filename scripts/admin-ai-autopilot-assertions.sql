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

DROP FUNCTION _m8_raises(text, jsonb, text);
