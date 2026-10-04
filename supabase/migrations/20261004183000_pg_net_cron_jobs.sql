-- Move recurring HTTP work from GitHub's scheduler to Supabase pg_cron + pg_net.
-- The deploy workflow seeds both private values into Supabase Vault before this
-- migration runs. The manual GitHub Actions workflow remains as a recovery path.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron is unavailable; scheduled HTTP jobs were not changed';
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_net') THEN
    RAISE NOTICE 'pg_net is unavailable; scheduled HTTP jobs were not changed';
    RETURN;
  END IF;

  CREATE EXTENSION IF NOT EXISTS pg_cron;
  CREATE EXTENSION IF NOT EXISTS pg_net;

  IF to_regclass('vault.decrypted_secrets') IS NULL THEN
    RAISE NOTICE 'Supabase Vault is unavailable; scheduled HTTP jobs were not changed';
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets WHERE name = 'lixxon_supabase_functions_url'
  ) OR NOT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets WHERE name = 'lixxon_internal_fn_secret'
  ) THEN
    RAISE NOTICE 'Cron credentials are missing from Supabase Vault; scheduled HTTP jobs were not changed';
    RETURN;
  END IF;

  -- Idempotently replace only these two HTTP jobs. The existing `keep_alive`
  -- job is created by 20261003130000_platform_v3_features.sql; preserve it and
  -- do not register a second keep-alive schedule here.
  PERFORM cron.unschedule(jobid)
  FROM cron.job
  WHERE jobname IN ('lixxon_send_emails', 'lixxon_refresh_rates');

  PERFORM cron.schedule(
    'lixxon_send_emails',
    '*/20 * * * *',
    $job$
      SELECT net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'lixxon_supabase_functions_url') || '/send-emails',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-internal-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'lixxon_internal_fn_secret')
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 5000
      );
    $job$
  );

  PERFORM cron.schedule(
    'lixxon_refresh_rates',
    '15 3 * * *',
    $job$
      SELECT net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'lixxon_supabase_functions_url') || '/refresh-rates',
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
