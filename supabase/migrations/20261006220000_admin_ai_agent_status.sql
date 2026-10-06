-- =============================================================================
-- Phase 4 gap 3 — visible per-agent status, job transcript and incident context.
--
-- The backend already stamps `admin_ai_agents.last_run_at/next_run_at` and keeps
-- jobs, queued actions and incidents, but there was no per-agent read model, so
-- the control room could not show an agent's last/next run, what it actually did,
-- or the incidents attributable to it. This adds two read-only views over
-- existing tables — no new table, no new runner, no provider call — and reuses
-- the existing `admin_ai_resolve_incident` RPC for incident controls.
--
-- Both functions are read-only, SECURITY DEFINER with a pinned search_path, and
-- gated on the existing `admin.ai.reports` permission (the same gate the control
-- tower uses). No browser role can read another surface's rows: the transcript is
-- scoped to one agent key and its own jobs.
-- =============================================================================

CREATE OR REPLACE FUNCTION admin_ai_agent_status()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM admin_ai_require('admin.ai.reports');
  RETURN jsonb_build_object('agents', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'agent_key', a.agent_key,
      'label', a.label,
      'enabled', a.enabled,
      'autonomy_level', a.autonomy_level,
      'cadence_minutes', a.cadence_minutes,
      'last_run_at', a.last_run_at,
      'next_run_at', a.next_run_at,
      'schedule_state', CASE
        WHEN NOT a.enabled OR a.autonomy_level = 'disabled' THEN 'paused'
        WHEN a.next_run_at IS NULL THEN 'unscheduled'
        WHEN a.next_run_at <= now() THEN 'due'
        ELSE 'scheduled'
      END,
      'runs_last_24h', (
        SELECT count(*) FROM admin_ai_jobs j
         WHERE j.agent_key = a.agent_key AND j.created_at > now() - interval '24 hours'),
      'failed_runs_last_7d', (
        SELECT count(*) FROM admin_ai_jobs j
         WHERE j.agent_key = a.agent_key AND j.status = 'failed'
           AND j.created_at > now() - interval '7 days'),
      'queued_actions', (
        SELECT count(*) FROM admin_ai_action_queue q
         WHERE q.agent_key = a.agent_key AND q.status = 'queued'),
      'open_incidents', (
        SELECT count(*) FROM admin_ai_incidents i
         WHERE i.status IN ('open','acknowledged')
           AND i.related_job_id IN (SELECT j.id FROM admin_ai_jobs j WHERE j.agent_key = a.agent_key))
    ) ORDER BY a.label)
  FROM admin_ai_agents a), '[]'::jsonb));
END $$;

CREATE OR REPLACE FUNCTION admin_ai_agent_transcript(p_agent_key text, p_limit integer DEFAULT 10)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public, pg_temp
AS $$
DECLARE
  v_key text := lower(btrim(COALESCE(p_agent_key, '')));
  v_limit integer := GREATEST(1, LEAST(25, COALESCE(p_limit, 10)));
BEGIN
  PERFORM admin_ai_require('admin.ai.reports');
  IF NOT EXISTS (SELECT 1 FROM admin_ai_agents WHERE agent_key = v_key) THEN
    RAISE EXCEPTION 'Unknown agent: %', v_key;
  END IF;

  RETURN jsonb_build_object(
    'agent_key', v_key,
    'jobs', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', j.id,
        'kind', j.kind,
        'status', j.status,
        'created_at', j.created_at,
        'started_at', j.started_at,
        'finished_at', j.finished_at,
        'duration_ms', CASE
          WHEN j.started_at IS NOT NULL AND j.finished_at IS NOT NULL
          THEN (EXTRACT(EPOCH FROM (j.finished_at - j.started_at)) * 1000)::bigint
          ELSE NULL END,
        'error', j.error,
        'actions_created', (
          SELECT count(*) FROM admin_ai_action_queue q WHERE q.job_id = j.id),
        'incidents', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id', i.id, 'severity', i.severity, 'status', i.status, 'title', i.title
          ) ORDER BY i.created_at DESC)
          FROM admin_ai_incidents i WHERE i.related_job_id = j.id), '[]'::jsonb)
      ) ORDER BY j.created_at DESC)
      FROM (SELECT * FROM admin_ai_jobs WHERE agent_key = v_key ORDER BY created_at DESC LIMIT v_limit) j
    ), '[]'::jsonb),
    'incidents', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', i.id, 'severity', i.severity, 'status', i.status, 'title', i.title,
        'detail', i.detail, 'resolution', i.resolution,
        'created_at', i.created_at, 'acknowledged_at', i.acknowledged_at,
        'resolved_at', i.resolved_at
      ) ORDER BY (i.status IN ('resolved','ignored')), i.created_at DESC)
      FROM admin_ai_incidents i
      WHERE i.related_job_id IN (SELECT id FROM admin_ai_jobs WHERE agent_key = v_key)
    ), '[]'::jsonb)
  );
END $$;

REVOKE ALL ON FUNCTION admin_ai_agent_status() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION admin_ai_agent_transcript(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_ai_agent_status() TO authenticated;
GRANT EXECUTE ON FUNCTION admin_ai_agent_transcript(text, integer) TO authenticated;

NOTIFY pgrst, 'reload schema';
