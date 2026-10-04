-- M10 assertions: event stream, digital twin, forecasts, debate, graph, lifecycle, security and learning.
\set ON_ERROR_STOP on
DO $$
DECLARE
  owner jsonb := '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000001","email":"owner@lixxonstudio.com"}';
  event_id uuid; v_action_id uuid; command_id uuid; replay_id uuid; twin jsonb; n integer;
BEGIN
  PERFORM set_config('request.jwt.claims', owner::text, true);
  PERFORM set_config('request.jwt.claim.sub', owner->>'sub', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  SELECT admin_ai_record_event('traffic_drop','site',NULL,'{"observed_value":20,"expected_value":50,"window":"7d"}'::jsonb,'assertion:traffic-drop','assertions') INTO event_id;
  IF event_id IS NULL THEN RAISE EXCEPTION 'event was not recorded'; END IF;
  IF (admin_ai_process_events(50)->>'processed')::integer < 1 THEN RAISE EXCEPTION 'event was not processed'; END IF;
  IF NOT EXISTS (SELECT 1 FROM admin_ai_event_stream WHERE id=event_id AND status='processed') THEN RAISE EXCEPTION 'event status missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM admin_ai_anomalies WHERE metric_key='organic_traffic') THEN RAISE EXCEPTION 'traffic anomaly missing'; END IF;

  SELECT admin_ai_refresh_digital_twin() INTO twin;
  IF twin->'measures' IS NULL OR twin->'measures'->'published_posts' IS NULL THEN RAISE EXCEPTION 'digital twin measures missing'; END IF;
  INSERT INTO admin_ai_metrics(metric_key,value,source,recorded_at) VALUES ('organic_traffic',100,'assertion',now()-interval '2 days'),('organic_traffic',150,'assertion',now());
  IF admin_ai_generate_forecasts(30) < 1 THEN RAISE EXCEPTION 'forecast missing'; END IF;
  PERFORM admin_ai_scan_anomalies();

  SELECT id INTO v_action_id FROM admin_ai_action_queue WHERE fingerprint='event:'||event_id LIMIT 1;
  IF v_action_id IS NULL THEN RAISE EXCEPTION 'event proposal missing'; END IF;
  IF admin_ai_debate_queue() < 1 THEN RAISE EXCEPTION 'agent debate missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM admin_ai_agent_reviews r WHERE r.action_id=v_action_id) THEN RAISE EXCEPTION 'agent review missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM admin_ai_trust_scores t WHERE t.target_id=v_action_id) THEN RAISE EXCEPTION 'trust score missing'; END IF;

  PERFORM admin_ai_reindex_knowledge();
  PERFORM admin_ai_refresh_knowledge_graph();
  PERFORM admin_ai_generate_maintenance_tasks();
  IF admin_ai_refresh_lifecycle() < 7 THEN RAISE EXCEPTION 'lifecycle stages missing'; END IF;

  SELECT admin_ai_record_event('secret_exposure','action',v_action_id,'{"source":"assertion","field":"api_key"}'::jsonb,'assertion:secret-exposure','assertions') INTO event_id;
  PERFORM admin_ai_process_events(50);
  IF admin_ai_run_security_sweep() < 1 THEN RAISE EXCEPTION 'security sweep missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM admin_ai_security_findings WHERE finding_key='event:'||event_id) THEN RAISE EXCEPTION 'security finding missing'; END IF;

  IF admin_ai_learn_from_outcomes() < 1 THEN RAISE EXCEPTION 'learning signal missing'; END IF;
  SELECT id INTO command_id FROM admin_ai_commands ORDER BY created_at LIMIT 1;
  IF command_id IS NOT NULL THEN
    SELECT admin_ai_replay_command(command_id) INTO replay_id;
    IF NOT EXISTS (SELECT 1 FROM admin_ai_commands WHERE id=replay_id AND replay_of=command_id) THEN RAISE EXCEPTION 'command replay missing'; END IF;
  END IF;

  SELECT admin_ai_control_tower() INTO twin;
  IF twin->'events' IS NULL OR twin->'forecasts' IS NULL OR twin->'agent_reviews' IS NULL OR twin->'lifecycle' IS NULL OR twin->'security_findings' IS NULL OR twin->'learning_signals' IS NULL THEN RAISE EXCEPTION 'M10 control tower fields missing'; END IF;
END $$;
