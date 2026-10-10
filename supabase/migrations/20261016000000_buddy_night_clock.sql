-- Buddy phase 9 slice 2: the night report on a clock.
-- Schedules buddy-night-clock every 30 minutes through pg_cron and pg_net, with the Vault-backed internal secret.
-- The function writes each owner's night report once, from 23:30 on the owner's clock until 04:00 (see _shared/nightReportClock.ts).
-- Guarded: if pg_cron, pg_net or the Vault credentials are missing, it changes nothing and says so.
-- NOT APPLIED to production. It applies only when the owner merges and turns the schedule on.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron is unavailable; the night report clock was not scheduled';
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_net') THEN
    RAISE NOTICE 'pg_net is unavailable; the night report clock was not scheduled';
    RETURN;
  END IF;

  CREATE EXTENSION IF NOT EXISTS pg_cron;
  CREATE EXTENSION IF NOT EXISTS pg_net;

  IF to_regclass('vault.decrypted_secrets') IS NULL THEN
    RAISE NOTICE 'Supabase Vault is unavailable; the night report clock was not scheduled';
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'lixxon_supabase_functions_url')
     OR NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'lixxon_internal_fn_secret') THEN
    RAISE NOTICE 'Vault scheduler credentials are missing; the night report clock was not scheduled';
    RETURN;
  END IF;

  PERFORM cron.unschedule(jobid)
    FROM cron.job WHERE jobname = 'lixxon_buddy_night_clock';
  PERFORM cron.schedule(
    'lixxon_buddy_night_clock',
    '*/30 * * * *',
    $job$
      SELECT net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'lixxon_supabase_functions_url') || '/buddy-night-clock',
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
