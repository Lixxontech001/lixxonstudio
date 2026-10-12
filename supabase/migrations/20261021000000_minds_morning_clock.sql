-- Phase I slice 1: the 08:00 morning clock.
-- Schedules minds-morning-clock every 15 minutes through pg_cron and pg_net, with the Vault-backed internal secret.
-- The function queues the owner's day run itself, and only when Takeover is On: the same rule is enforced again in
-- public.minds_queue_daily_run, which refuses while Takeover is off or a Kill stops the run (_shared/morningClock.ts).
-- This is the 08:00 clock the Phase 4 migration left commented out; that commented 07:00 line is superseded by this
-- one and is not uncommented.
-- Guarded: if pg_cron, pg_net or the Vault credentials are missing, it changes nothing and says so.
-- NOT APPLIED to production. It applies only when the owner merges and turns the schedule on.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron is unavailable; the morning clock was not scheduled';
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_net') THEN
    RAISE NOTICE 'pg_net is unavailable; the morning clock was not scheduled';
    RETURN;
  END IF;

  CREATE EXTENSION IF NOT EXISTS pg_cron;
  CREATE EXTENSION IF NOT EXISTS pg_net;

  IF to_regclass('vault.decrypted_secrets') IS NULL THEN
    RAISE NOTICE 'Supabase Vault is unavailable; the morning clock was not scheduled';
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'lixxon_supabase_functions_url')
     OR NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'lixxon_internal_fn_secret') THEN
    RAISE NOTICE 'Vault scheduler credentials are missing; the morning clock was not scheduled';
    RETURN;
  END IF;

  PERFORM cron.unschedule(jobid)
    FROM cron.job WHERE jobname = 'lixxon_minds_morning_clock';
  PERFORM cron.schedule(
    'lixxon_minds_morning_clock',
    '*/15 * * * *',
    $job$
      SELECT net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'lixxon_supabase_functions_url') || '/minds-morning-clock',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-internal-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'lixxon_internal_fn_secret')
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 10000
      );
    $job$
  );
END $$;
