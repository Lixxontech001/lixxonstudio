-- Phase 4 gap 3 assertions: per-agent status, transcript and incident controls.
-- Proves the new read model is permission-gated, scoped to a single agent, counts
-- only that agent's work, reflects paused/due/scheduled correctly, and that the
-- incident control path (existing admin_ai_resolve_incident) works and is gated.
\set ON_ERROR_STOP on

DO $$
DECLARE
  owner jsonb := '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000001","email":"owner@lixxonstudio.com"}';
  reader jsonb := '{"role":"authenticated","sub":"00000000-0000-0000-0000-0000000000d4"}';
  anon_claims jsonb := '{"role":"anon"}';
  job_a uuid; job_b uuid; inc_id uuid;
  board jsonb; transcript jsonb;
  agent_row jsonb;
  raised boolean;
  resolved boolean;
BEGIN
  -- ------------------------------------------------------- 1. permission gate
  PERFORM set_config('request.jwt.claims', reader::text, true);
  PERFORM set_config('request.jwt.claim.sub', reader->>'sub', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  raised := false;
  BEGIN PERFORM admin_ai_agent_status(); EXCEPTION WHEN others THEN raised := true; END;
  IF NOT raised THEN RAISE EXCEPTION 'A non-owner read the per-agent status board'; END IF;
  raised := false;
  BEGIN PERFORM admin_ai_agent_transcript('analyst'); EXCEPTION WHEN others THEN raised := true; END;
  IF NOT raised THEN RAISE EXCEPTION 'A non-owner read an agent transcript'; END IF;

  PERFORM set_config('request.jwt.claims', anon_claims::text, true);
  PERFORM set_config('request.jwt.claim.role', 'anon', true);
  raised := false;
  BEGIN PERFORM admin_ai_agent_status(); EXCEPTION WHEN others THEN raised := true; END;
  IF NOT raised THEN RAISE EXCEPTION 'An anon caller read the per-agent status board'; END IF;

  -- ------------------------------------------------ 2. fixture: two agents
  PERFORM set_config('request.jwt.claims', owner::text, true);
  PERFORM set_config('request.jwt.claim.sub', owner->>'sub', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  -- Run two different agents so we can prove the transcript is not cross-agent.
  PERFORM admin_ai_set_agent('analyst', true, 'suggest', 60, 5, '{}'::jsonb);
  PERFORM admin_ai_set_agent('ceo', true, 'suggest', 120, 5, '{}'::jsonb);
  SELECT (admin_ai_run_agent('analyst') ->> 'job_id')::uuid INTO job_a;
  SELECT (admin_ai_run_agent('ceo') ->> 'job_id')::uuid INTO job_b;
  IF job_a IS NULL OR job_b IS NULL THEN RAISE EXCEPTION 'agent runs did not create jobs'; END IF;
  IF job_a = job_b THEN RAISE EXCEPTION 'two agents shared one job'; END IF;

  -- An incident attributable to the analyst's run only.
  INSERT INTO admin_ai_incidents (severity, title, detail, source, status, related_job_id)
  VALUES ('warning', 'GAP3_INCIDENT', 'Attributable to the analyst job only.', 'agent', 'open', job_a)
  RETURNING id INTO inc_id;

  -- ------------------------------------------------------ 3. status board
  board := admin_ai_agent_status();
  IF jsonb_array_length(board->'agents') < 2 THEN RAISE EXCEPTION 'status board is missing agents'; END IF;

  SELECT value INTO agent_row FROM jsonb_array_elements(board->'agents') WHERE value->>'agent_key' = 'analyst';
  IF agent_row IS NULL THEN RAISE EXCEPTION 'analyst missing from the status board'; END IF;
  IF agent_row->>'last_run_at' IS NULL OR agent_row->>'next_run_at' IS NULL THEN
    RAISE EXCEPTION 'last/next run were not surfaced';
  END IF;
  IF (agent_row->>'cadence_minutes')::integer <> 60 THEN
    RAISE EXCEPTION 'cadence was not surfaced truthfully';
  END IF;
  -- next_run_at = last_run_at + cadence, so a fresh run is scheduled (not due).
  IF agent_row->>'schedule_state' <> 'scheduled' THEN
    RAISE EXCEPTION 'a freshly run agent reported % instead of scheduled', agent_row->>'schedule_state';
  END IF;
  IF (agent_row->>'open_incidents')::integer <> 1 THEN
    RAISE EXCEPTION 'the agent incident count was % instead of 1', agent_row->>'open_incidents';
  END IF;
  IF (agent_row->>'runs_last_24h')::integer < 1 THEN
    RAISE EXCEPTION 'the last-24h run count did not include the fresh run';
  END IF;

  -- A disabled agent must report paused regardless of timestamps, and never due.
  PERFORM admin_ai_set_agent('ceo', false, 'suggest', 120, 5, '{}'::jsonb);
  SELECT value INTO agent_row FROM jsonb_array_elements(admin_ai_agent_status()->'agents') WHERE value->>'agent_key' = 'ceo';
  IF agent_row->>'schedule_state' <> 'paused' THEN
    RAISE EXCEPTION 'a disabled agent reported %', agent_row->>'schedule_state';
  END IF;

  -- An overdue schedule must report due.
  UPDATE admin_ai_agents SET next_run_at = now() - interval '5 minutes' WHERE agent_key = 'analyst';
  SELECT value INTO agent_row FROM jsonb_array_elements(admin_ai_agent_status()->'agents') WHERE value->>'agent_key' = 'analyst';
  IF agent_row->>'schedule_state' <> 'due' THEN
    RAISE EXCEPTION 'an overdue agent reported %', agent_row->>'schedule_state';
  END IF;
  UPDATE admin_ai_agents SET next_run_at = now() + interval '60 minutes' WHERE agent_key = 'analyst';

  -- ------------------------------------------------- 4. transcript scoping
  transcript := admin_ai_agent_transcript('analyst');
  IF jsonb_array_length(transcript->'jobs') < 1 THEN RAISE EXCEPTION 'analyst transcript is empty'; END IF;
  -- Every transcript job belongs to the requested agent, and the other agent never leaks in.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(transcript->'jobs') e
     WHERE NOT EXISTS (SELECT 1 FROM admin_ai_jobs j WHERE j.id = (e->>'id')::uuid AND j.agent_key = 'analyst')
  ) THEN RAISE EXCEPTION 'the transcript contained another agent''s job'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(transcript->'jobs') e WHERE (e->>'id')::uuid = job_b) THEN
    RAISE EXCEPTION 'the CEO job leaked into the analyst transcript';
  END IF;
  -- The transcript shows what the run produced and links its incident.
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(transcript->'jobs') e
     WHERE (e->>'id')::uuid = job_a AND (e->>'actions_created')::integer >= 1
  ) THEN RAISE EXCEPTION 'the transcript did not show the run output'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(transcript->'jobs') e, jsonb_array_elements(e->'incidents') i
     WHERE (e->>'id')::uuid = job_a AND i->>'id' = inc_id::text
  ) THEN RAISE EXCEPTION 'the transcript did not link the run incident'; END IF;

  -- The limit is honoured and clamped.
  IF jsonb_array_length(admin_ai_agent_transcript('analyst', 1)->'jobs') <> 1 THEN
    RAISE EXCEPTION 'the transcript limit was not honoured';
  END IF;
  IF jsonb_array_length(admin_ai_agent_transcript('analyst', 999)->'jobs') > 25 THEN
    RAISE EXCEPTION 'the transcript limit was not clamped';
  END IF;
  raised := false;
  BEGIN PERFORM admin_ai_agent_transcript('not_a_real_agent'); EXCEPTION WHEN others THEN raised := true; END;
  IF NOT raised THEN RAISE EXCEPTION 'an unknown agent returned a transcript'; END IF;

  -- ------------------------------------------------- 5. incident controls
  -- The control path is the existing RPC, and it stays permission-gated.
  PERFORM set_config('request.jwt.claims', reader::text, true);
  PERFORM set_config('request.jwt.claim.sub', reader->>'sub', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  raised := false;
  BEGIN PERFORM admin_ai_resolve_incident(inc_id, 'resolved', 'attempted by non-owner');
  EXCEPTION WHEN others THEN raised := true; END;
  IF NOT raised THEN RAISE EXCEPTION 'a non-owner resolved an incident'; END IF;
  IF (SELECT status FROM admin_ai_incidents WHERE id = inc_id) <> 'open' THEN
    RAISE EXCEPTION 'a rejected incident control still changed the row';
  END IF;

  PERFORM set_config('request.jwt.claims', owner::text, true);
  PERFORM set_config('request.jwt.claim.sub', owner->>'sub', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  SELECT admin_ai_resolve_incident(inc_id, 'acknowledged', NULL) INTO resolved;
  IF NOT resolved THEN RAISE EXCEPTION 'acknowledging an incident failed'; END IF;
  IF (SELECT acknowledged_at FROM admin_ai_incidents WHERE id = inc_id) IS NULL THEN
    RAISE EXCEPTION 'acknowledgement did not stamp acknowledged_at';
  END IF;
  IF (SELECT resolved_at FROM admin_ai_incidents WHERE id = inc_id) IS NOT NULL THEN
    RAISE EXCEPTION 'acknowledgement wrongly stamped resolved_at';
  END IF;
  -- It stays visible to the per-agent view while acknowledged, and the count follows.
  IF (SELECT count(*) FROM admin_ai_incidents WHERE id = inc_id AND status IN ('open','acknowledged')) <> 1 THEN
    RAISE EXCEPTION 'an acknowledged incident left the open-incident view';
  END IF;
  SELECT value INTO agent_row FROM jsonb_array_elements(admin_ai_agent_status()->'agents') WHERE value->>'agent_key' = 'analyst';
  IF (agent_row->>'open_incidents')::integer <> 1 THEN
    RAISE EXCEPTION 'the acknowledged incident was dropped from the agent count';
  END IF;

  SELECT admin_ai_resolve_incident(inc_id, 'resolved', 'gap 3 assertion cleanup') INTO resolved;
  IF NOT resolved THEN RAISE EXCEPTION 'resolving an incident failed'; END IF;
  IF (SELECT resolved_at FROM admin_ai_incidents WHERE id = inc_id) IS NULL
     OR (SELECT resolved_by FROM admin_ai_incidents WHERE id = inc_id) IS DISTINCT FROM (owner->>'sub')::uuid THEN
    RAISE EXCEPTION 'resolution did not record who resolved it';
  END IF;
  -- Resolved incidents leave the open count but stay in the transcript history.
  SELECT value INTO agent_row FROM jsonb_array_elements(admin_ai_agent_status()->'agents') WHERE value->>'agent_key' = 'analyst';
  IF (agent_row->>'open_incidents')::integer <> 0 THEN
    RAISE EXCEPTION 'a resolved incident stayed in the open count';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(admin_ai_agent_transcript('analyst')->'incidents') i
     WHERE i->>'id' = inc_id::text AND i->>'status' = 'resolved' AND i->>'resolution' = 'gap 3 assertion cleanup'
  ) THEN RAISE EXCEPTION 'the resolved incident left the transcript history'; END IF;

  -- ---------------------------------------------------------- 6. cleanup
  DELETE FROM admin_ai_incidents WHERE id = inc_id;
  DELETE FROM admin_ai_jobs WHERE id IN (job_a, job_b);
END $$;
