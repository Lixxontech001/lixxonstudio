-- M9 assertions: strategy, command, knowledge, campaign, critic, provider and audience loops.
\set ON_ERROR_STOP on
DO $$
DECLARE
  owner jsonb := '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000001","email":"owner@lixxonstudio.com"}';
  goal uuid; plan uuid; command_id uuid; campaign uuid; segment uuid; action_id uuid; eval_id uuid; found_count integer;
  tower jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims', owner::text, true);
  PERFORM set_config('request.jwt.claim.sub', owner->>'sub', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  SELECT admin_ai_create_goal('M9 growth goal','Increase qualified organic readers without paid spend.','organic_traffic',40,10,now()+interval '90 days',90,'{"no_paid_spend":true}'::jsonb) INTO goal;
  SELECT admin_ai_generate_strategy(goal) INTO plan;
  IF NOT EXISTS (SELECT 1 FROM admin_ai_plan_steps WHERE plan_id=plan AND position=0 AND agent_key='growth') THEN RAISE EXCEPTION 'strategy steps missing'; END IF;
  PERFORM admin_ai_run_strategy(plan);

  SELECT admin_ai_ingest_command('Create a 30 day content campaign to grow organic traffic') INTO command_id;
  IF NOT EXISTS (SELECT 1 FROM admin_ai_commands WHERE id=command_id AND interpreted_intent='growth_strategy') THEN RAISE EXCEPTION 'command intent was not interpreted'; END IF;

  SELECT admin_ai_reindex_knowledge() INTO found_count;
  IF found_count < 0 THEN RAISE EXCEPTION 'knowledge sync returned invalid count'; END IF;
  IF admin_ai_search_knowledge('article',5) IS NULL THEN RAISE EXCEPTION 'knowledge search failed'; END IF;

  SELECT admin_ai_create_campaign('M9 campaign','Evidence-led skincare routines','returning readers',goal) INTO campaign;
  IF admin_ai_generate_campaign_pack(campaign) < 6 THEN RAISE EXCEPTION 'campaign pack incomplete'; END IF;

  SELECT id INTO action_id FROM admin_ai_action_queue LIMIT 1;
  IF action_id IS NOT NULL THEN
    SELECT admin_ai_review_action(action_id) INTO eval_id;
    IF eval_id IS NULL THEN RAISE EXCEPTION 'quality critic did not evaluate'; END IF;
  END IF;

  IF NOT admin_ai_set_provider_route('research','edge_provider','future-safe-model',100,true,true) THEN RAISE EXCEPTION 'provider route failed'; END IF;
  IF NOT admin_ai_set_guardrail('protect_pii','true'::jsonb) THEN RAISE EXCEPTION 'guardrail failed'; END IF;
  SELECT admin_ai_create_segment('M9 returning readers','Readers who return to the site weekly','{"type":"newsletter_subscribers"}'::jsonb) INTO segment;
  PERFORM admin_ai_refresh_segment(segment);

  SELECT admin_ai_control_tower() INTO tower;
  IF tower->'goals' IS NULL OR tower->'plans' IS NULL OR tower->'campaigns' IS NULL OR tower->'routes' IS NULL THEN RAISE EXCEPTION 'M9 control tower fields missing'; END IF;
END $$;
