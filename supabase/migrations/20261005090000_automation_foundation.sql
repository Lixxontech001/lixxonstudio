-- Phase 1.1 — automation foundation.
-- Secret values live only in Supabase Vault; application tables retain Vault IDs
-- and safe health metadata. The service-role runner is explicitly barred from
-- inserting/updating/deleting posts, and an additional trigger guards article text.

-- -----------------------------------------------------------------------------
-- 1. Narrow automation permissions; the existing owner/founder short-circuit and
--    34-permission M5 model remain authoritative.
-- -----------------------------------------------------------------------------
INSERT INTO admin_permissions (key, label, description, category, is_dangerous, sort_order) VALUES
  ('automation.keys', 'Manage automation keys', 'Save, replace, test and revoke server-side automation credentials.', 'Automation', true, 950),
  ('automation.check', 'View automation health', 'Read secret-free automation readiness and run metadata.', 'Automation', false, 951),
  ('automation.manage', 'Manage automation policy', 'Change automation feature flags and owner-controlled policy.', 'Automation', true, 952)
ON CONFLICT (key) DO UPDATE SET
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  is_dangerous = EXCLUDED.is_dangerous,
  sort_order = EXCLUDED.sort_order;

INSERT INTO role_permissions (role, permission)
VALUES ('owner', 'automation.keys'), ('owner', 'automation.check'), ('owner', 'automation.manage')
ON CONFLICT DO NOTHING;

-- -----------------------------------------------------------------------------
-- 2. Secret catalogue and Vault metadata. No secret value column is permitted.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS automation_secret_catalog (
  secret_name text PRIMARY KEY CHECK (secret_name ~ '^[a-z][a-z0-9_]{1,63}$'),
  label text NOT NULL,
  category text NOT NULL CHECK (category IN ('ai', 'actions', 'commerce', 'email', 'social', 'video', 'push')),
  purpose text NOT NULL,
  required boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 100,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO automation_secret_catalog (secret_name, label, category, purpose, required, sort_order) VALUES
  ('openai_api_key', 'OpenAI API key', 'ai', 'Optional OpenAI provider route', false, 10),
  ('gemini_api_key', 'Gemini API key', 'ai', 'Optional Google Gemini provider route', false, 20),
  ('anthropic_api_key', 'Anthropic API key', 'ai', 'Optional Anthropic provider route', false, 30),
  ('github_dispatch_token', 'GitHub Actions dispatch token', 'actions', 'Dispatch the public-repository automation workflow; grant only Actions write on this repository', false, 40),
  ('flutterwave_secret_key', 'Flutterwave secret key', 'commerce', 'Server-side payment verification; never used in browser code', false, 50),
  ('flutterwave_webhook_hash', 'Flutterwave webhook hash', 'commerce', 'Verify signed Flutterwave webhook requests', false, 60),
  ('resend_api_key', 'Resend API key', 'email', 'Send approved owner-requested email and notifications', false, 70),
  ('telegram_bot_token', 'Telegram bot token', 'social', 'Send owner alerts and approved channel content', false, 80),
  ('meta_app_secret', 'Meta app secret', 'social', 'Instagram/Facebook/Threads server-side OAuth', false, 90),
  ('meta_access_token', 'Meta access token', 'social', 'Instagram/Facebook server-side publishing', false, 100),
  ('threads_access_token', 'Threads access token', 'social', 'Threads server-side publishing', false, 110),
  ('youtube_client_secret', 'YouTube client secret', 'social', 'YouTube server-side OAuth', false, 120),
  ('youtube_refresh_token', 'YouTube refresh token', 'social', 'YouTube Shorts upload authorization', false, 130),
  ('tiktok_client_secret', 'TikTok client secret', 'social', 'TikTok Content Posting API OAuth', false, 140),
  ('tiktok_access_token', 'TikTok access token', 'social', 'TikTok Content Posting API authorization', false, 150),
  ('pinterest_access_token', 'Pinterest access token', 'social', 'Pinterest server-side publishing', false, 160),
  ('linkedin_client_secret', 'LinkedIn client secret', 'social', 'LinkedIn server-side OAuth', false, 170),
  ('linkedin_access_token', 'LinkedIn access token', 'social', 'LinkedIn organization publishing', false, 180),
  ('x_api_secret', 'X API secret', 'social', 'X API server-side OAuth', false, 190),
  ('x_access_token', 'X access token', 'social', 'X API publishing authorization', false, 200),
  ('tumblr_consumer_secret', 'Tumblr consumer secret', 'social', 'Tumblr server-side OAuth', false, 210),
  ('tumblr_access_token', 'Tumblr access token', 'social', 'Tumblr publishing authorization', false, 220),
  ('tumblr_token_secret', 'Tumblr token secret', 'social', 'Tumblr signed API requests', false, 230),
  ('whatsapp_access_token', 'WhatsApp Business access token', 'social', 'WhatsApp Business API where supported; Status/Channel may remain manual-only', false, 240),
  ('coverr_api_key', 'Coverr API key', 'video', 'Retrieve licensed stock footage for optional local rendering', false, 250),
  ('vapid_private_key', 'Web Push VAPID private key', 'push', 'Sign Web Push notifications on the server', false, 260)
ON CONFLICT (secret_name) DO UPDATE SET
  label = EXCLUDED.label,
  category = EXCLUDED.category,
  purpose = EXCLUDED.purpose,
  sort_order = EXCLUDED.sort_order,
  enabled = true;

CREATE TABLE IF NOT EXISTS automation_secrets (
  secret_name text PRIMARY KEY REFERENCES automation_secret_catalog(secret_name) ON DELETE RESTRICT,
  vault_secret_id uuid NOT NULL UNIQUE,
  last_test_status text NOT NULL DEFAULT 'not_tested'
    CHECK (last_test_status IN ('not_tested', 'ok', 'invalid', 'rate_limited', 'unavailable', 'not_configured')),
  last_test_message text NOT NULL DEFAULT 'Not tested yet.',
  last_tested_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- 3. Feature gates and pipeline observability. Article prose is never copied here.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS feature_flags (
  flag_key text PRIMARY KEY CHECK (flag_key ~ '^automation\.[a-z0-9_.-]{1,64}$'),
  enabled boolean NOT NULL DEFAULT false,
  description text NOT NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO feature_flags (flag_key, enabled, description) VALUES
  ('automation.enabled', false, 'Master automation kill switch; must be explicitly enabled by the owner.'),
  ('automation.daily_pipeline', false, '08:00 Africa/Lagos article pipeline dispatch.'),
  ('automation.distribution', false, 'Approved channel distribution and Daily Kit actions.'),
  ('automation.video', false, 'Optional local FFmpeg rendering on a GitHub-hosted runner.'),
  ('automation.agents', false, 'The six business-operations agents.'),
  ('automation.push', false, 'Opt-in owner Web Push notifications.')
ON CONFLICT (flag_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS article_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL UNIQUE,
  source_sha256 text CHECK (source_sha256 IS NULL OR source_sha256 ~ '^[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'awaiting_approval', 'completed', 'failed', 'paused', 'cancelled')),
  phase text NOT NULL DEFAULT 'preflight',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  started_at timestamptz,
  finished_at timestamptz,
  safe_error_code text CHECK (safe_error_code IS NULL OR safe_error_code ~ '^[A-Z0-9_.:-]{1,64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS article_runs_post_recent ON article_runs (post_id, created_at DESC);
CREATE INDEX IF NOT EXISTS article_runs_status_recent ON article_runs (status, created_at DESC);

CREATE TABLE IF NOT EXISTS article_pipeline_state (
  post_id uuid PRIMARY KEY REFERENCES posts(id) ON DELETE CASCADE,
  state text NOT NULL DEFAULT 'draft'
    CHECK (state IN ('draft', 'queued', 'approved', 'preflight', 'kit_ready', 'awaiting_approval', 'published', 'failed', 'paused')),
  last_run_id uuid REFERENCES article_runs(id) ON DELETE SET NULL,
  owner_approved_at timestamptz,
  owner_approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  last_safe_error_code text CHECK (last_safe_error_code IS NULL OR last_safe_error_code ~ '^[A-Z0-9_.:-]{1,64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS automation_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_code text NOT NULL CHECK (event_code ~ '^[A-Z][A-Z0-9_.:-]{1,63}$'),
  status text NOT NULL CHECK (status IN ('started', 'succeeded', 'failed', 'paused', 'blocked', 'retried', 'cancelled')),
  entity_type text CHECK (entity_type IS NULL OR entity_type ~ '^[a-z][a-z0-9_-]{0,31}$'),
  entity_id uuid,
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS automation_logs_recent ON automation_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS automation_logs_entity ON automation_logs (entity_type, entity_id, created_at DESC);

-- Only a SHA-256 digest is stored. The raw, random capability exists only in the
-- authorized Actions process and is single-use, scoped, run-bound and short-lived.
CREATE TABLE IF NOT EXISTS automation_run_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES article_runs(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  scopes text[] NOT NULL DEFAULT ARRAY['article:read'],
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (cardinality(scopes) BETWEEN 1 AND 8),
  CHECK (expires_at <= created_at + interval '15 minutes')
);
CREATE INDEX IF NOT EXISTS automation_run_tokens_run ON automation_run_tokens (run_id, expires_at DESC);

-- -----------------------------------------------------------------------------
-- 4. RLS, least-privilege grants and append-only safe logging.
-- -----------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'automation_secret_catalog', 'automation_secrets', 'feature_flags',
    'article_runs', 'article_pipeline_state', 'automation_logs', 'automation_run_tokens'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated, service_role', t);
  END LOOP;
END $$;

DROP POLICY IF EXISTS automation_secret_catalog_owner_read ON automation_secret_catalog;
CREATE POLICY automation_secret_catalog_owner_read ON automation_secret_catalog
  FOR SELECT TO authenticated USING (admin_can('automation.keys'));
DROP POLICY IF EXISTS automation_secrets_owner_read ON automation_secrets;
CREATE POLICY automation_secrets_owner_read ON automation_secrets
  FOR SELECT TO authenticated USING (admin_can('automation.keys'));
DROP POLICY IF EXISTS feature_flags_owner_read ON feature_flags;
CREATE POLICY feature_flags_owner_read ON feature_flags
  FOR SELECT TO authenticated USING (admin_can('automation.check'));
DROP POLICY IF EXISTS article_runs_owner_read ON article_runs;
CREATE POLICY article_runs_owner_read ON article_runs
  FOR SELECT TO authenticated USING (admin_can('automation.check'));
DROP POLICY IF EXISTS article_pipeline_state_owner_read ON article_pipeline_state;
CREATE POLICY article_pipeline_state_owner_read ON article_pipeline_state
  FOR SELECT TO authenticated USING (admin_can('automation.check'));
DROP POLICY IF EXISTS automation_logs_owner_read ON automation_logs;
CREATE POLICY automation_logs_owner_read ON automation_logs
  FOR SELECT TO authenticated USING (admin_can('automation.check'));
-- No browser read policy for run-token digests; no direct DML policies for any table.

-- Metadata tables are audited; the append-only log is its own audit record and
-- run-token digests are deliberately excluded from row-diff audit payloads.
DO $$
DECLARE t text;
BEGIN
  IF to_regprocedure('public.audit_admin_change()') IS NULL THEN
    RAISE EXCEPTION 'Admin audit function must exist before automation migrations';
  END IF;
  FOREACH t IN ARRAY ARRAY['automation_secrets', 'feature_flags', 'article_runs', 'article_pipeline_state'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_automation_audit_%I ON public.%I', t, t);
    EXECUTE format('CREATE TRIGGER trg_automation_audit_%I AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.audit_admin_change()', t, t);
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 5. Owner RPCs. The only value-bearing input is the save call; it is immediately
--    encrypted by Vault and never copied to a Lixxon table or audit diff.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION automation_list_secrets()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT admin_can('automation.keys') THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'name', c.secret_name,
      'label', c.label,
      'category', c.category,
      'purpose', c.purpose,
      'required', c.required,
      'configured', s.vault_secret_id IS NOT NULL,
      'last_test_status', COALESCE(s.last_test_status, 'not_tested'),
      'last_test_message', COALESCE(s.last_test_message, 'Not configured.'),
      'last_tested_at', s.last_tested_at
    ) ORDER BY c.sort_order)
    FROM automation_secret_catalog c
    LEFT JOIN automation_secrets s USING (secret_name)
    WHERE c.enabled
  ), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION automation_secret_save(p_secret_name text, p_secret_value text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_name text := lower(btrim(COALESCE(p_secret_name, '')));
  v_secret_id uuid;
  v_old_id uuid;
  v_purpose text;
BEGIN
  IF NOT admin_can('automation.keys') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_secret_value IS NULL OR length(p_secret_value) < 1 OR length(p_secret_value) > 10000 THEN
    RAISE EXCEPTION 'Secret must contain 1 to 10000 characters';
  END IF;
  SELECT purpose INTO v_purpose FROM automation_secret_catalog WHERE secret_name = v_name AND enabled;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown or disabled secret name'; END IF;
  IF to_regclass('vault.secrets') IS NULL OR to_regclass('vault.decrypted_secrets') IS NULL THEN
    RAISE EXCEPTION 'Supabase Vault is not available';
  END IF;

  -- A nested exception block rolls back the old Vault row if replacing it fails.
  BEGIN
    SELECT vault_secret_id INTO v_old_id FROM automation_secrets WHERE secret_name = v_name FOR UPDATE;
    IF v_old_id IS NOT NULL THEN DELETE FROM vault.secrets WHERE id = v_old_id; END IF;
    SELECT vault.create_secret(p_secret_value, 'lixxon_automation_' || v_name, v_purpose) INTO v_secret_id;
    IF v_secret_id IS NULL THEN RAISE EXCEPTION 'Vault returned no secret ID'; END IF;
    INSERT INTO automation_secrets (secret_name, vault_secret_id, last_test_status, last_test_message, created_by, updated_by)
    VALUES (v_name, v_secret_id, 'not_tested', 'Saved; test this connection.', auth.uid(), auth.uid())
    ON CONFLICT (secret_name) DO UPDATE SET
      vault_secret_id = EXCLUDED.vault_secret_id,
      last_test_status = 'not_tested',
      last_test_message = 'Saved; test this connection.',
      last_tested_at = NULL,
      updated_by = auth.uid(),
      updated_at = now();
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'Vault write failed; secret value was not recorded' USING ERRCODE = '58000';
  END;

  RETURN jsonb_build_object('ok', true, 'name', v_name, 'configured', true, 'last_test_status', 'not_tested');
END $$;

CREATE OR REPLACE FUNCTION automation_secret_delete(p_secret_name text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_name text := lower(btrim(COALESCE(p_secret_name, ''))); v_secret_id uuid;
BEGIN
  IF NOT admin_can('automation.keys') THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT vault_secret_id INTO v_secret_id FROM automation_secrets WHERE secret_name = v_name FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  BEGIN
    DELETE FROM vault.secrets WHERE id = v_secret_id;
    DELETE FROM automation_secrets WHERE secret_name = v_name;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'Vault delete failed; secret metadata was not changed' USING ERRCODE = '58000';
  END;
  RETURN true;
END $$;

-- This RPC is callable only by a trusted Edge Function using the service role.
-- The caller uses the returned value in memory and must never log/return it.
CREATE OR REPLACE FUNCTION automation_secret_get_internal(p_secret_name text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_value text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT d.decrypted_secret INTO v_value
    FROM automation_secrets s
    JOIN vault.decrypted_secrets d ON d.id = s.vault_secret_id
   WHERE s.secret_name = lower(btrim(COALESCE(p_secret_name, '')));
  IF v_value IS NULL THEN RAISE EXCEPTION 'Secret is not configured'; END IF;
  RETURN v_value;
END $$;

-- Provider checks happen in the server-side Edge Function. This internal RPC only
-- records a small allow-listed result; it cannot accept provider response text.
CREATE OR REPLACE FUNCTION test_automation_secret(p_secret_name text, p_result text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_name text := lower(btrim(COALESCE(p_secret_name, ''))); v_message text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_result NOT IN ('ok', 'invalid', 'rate_limited', 'unavailable', 'not_configured') THEN
    RAISE EXCEPTION 'Unknown safe test result';
  END IF;
  v_message := CASE p_result
    WHEN 'ok' THEN 'Provider connection verified.'
    WHEN 'invalid' THEN 'Provider rejected this credential.'
    WHEN 'rate_limited' THEN 'Provider rate-limited the test; retry later.'
    WHEN 'unavailable' THEN 'Provider is temporarily unavailable.'
    ELSE 'This credential is not configured.'
  END;
  UPDATE automation_secrets
     SET last_test_status = p_result, last_test_message = v_message,
         last_tested_at = now(), updated_at = now()
   WHERE secret_name = v_name;
  IF NOT FOUND THEN
    IF p_result = 'not_configured' THEN
      RETURN jsonb_build_object('ok', false, 'name', v_name, 'status', p_result, 'message', v_message);
    END IF;
    RAISE EXCEPTION 'Secret is not configured';
  END IF;
  RETURN jsonb_build_object('ok', p_result = 'ok', 'name', v_name, 'status', p_result, 'message', v_message);
END $$;

CREATE OR REPLACE FUNCTION automation_feature_flags()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT admin_can('automation.check') THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN COALESCE((SELECT jsonb_object_agg(flag_key, enabled ORDER BY flag_key) FROM feature_flags), '{}'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION automation_set_feature_flag(p_flag_key text, p_enabled boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT admin_can('automation.manage') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_flag_key NOT IN (
    'automation.enabled', 'automation.daily_pipeline', 'automation.distribution',
    'automation.video', 'automation.agents', 'automation.push'
  ) THEN RAISE EXCEPTION 'Unknown automation feature flag'; END IF;
  UPDATE feature_flags SET enabled = COALESCE(p_enabled, false), updated_by = auth.uid(), updated_at = now()
   WHERE flag_key = p_flag_key;
  RETURN FOUND;
END $$;

-- Structured logs only: no free-form provider response, prompt, email, token or
-- credential fields. All keys are allow-listed and event data is size-capped.
CREATE OR REPLACE FUNCTION automation_write_log(
  p_event_code text, p_status text, p_entity_type text DEFAULT NULL,
  p_entity_id uuid DEFAULT NULL, p_details jsonb DEFAULT '{}'
) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id bigint;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_event_code !~ '^[A-Z][A-Z0-9_.:-]{1,63}$' THEN RAISE EXCEPTION 'Invalid event code'; END IF;
  IF p_status NOT IN ('started', 'succeeded', 'failed', 'paused', 'blocked', 'retried', 'cancelled') THEN
    RAISE EXCEPTION 'Invalid event status';
  END IF;
  IF jsonb_typeof(COALESCE(p_details, '{}'::jsonb)) IS DISTINCT FROM 'object'
     OR (COALESCE(p_details, '{}'::jsonb) - ARRAY['run_id', 'step', 'elapsed_ms', 'error_code', 'http_status', 'retry', 'quota_remaining', 'channel', 'remote_post_id', 'cost_cents', 'source_hash']) <> '{}'::jsonb
     OR length(COALESCE(p_details, '{}'::jsonb)::text) > 2048 THEN
    RAISE EXCEPTION 'Log details contain unsupported fields or exceed the safe size limit';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_each_text(COALESCE(p_details, '{}'::jsonb)) x
    WHERE length(x.value) > 128 OR x.value ~* '(secret|password|bearer|token|api[_ -]?key|private[_ -]?key)'
  ) THEN RAISE EXCEPTION 'Log details failed redaction validation'; END IF;
  INSERT INTO automation_logs (event_code, status, entity_type, entity_id, details)
  VALUES (p_event_code, p_status, p_entity_type, p_entity_id, COALESCE(p_details, '{}'::jsonb))
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- -----------------------------------------------------------------------------
-- 6. Defense in depth: service-role and automation actors cannot mutate article
--    bodies. Human editors continue using the existing authenticated M5 workflow.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION automation_guard_post_content()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_agent_actor boolean := COALESCE(current_setting('lixxon.automation_agent', true), '') = 'on';
BEGIN
  IF auth.role() IS NOT DISTINCT FROM 'service_role' OR v_agent_actor THEN
    IF (TG_OP = 'INSERT' AND NEW.content IS NOT NULL)
       OR (TG_OP = 'UPDATE' AND NEW.content IS DISTINCT FROM OLD.content) THEN
      RAISE EXCEPTION 'Automation actors may not write posts.content' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_automation_guard_post_content ON public.posts;
CREATE TRIGGER trg_automation_guard_post_content
  BEFORE INSERT OR UPDATE OF content ON public.posts
  FOR EACH ROW EXECUTE FUNCTION public.automation_guard_post_content();

-- Supabase Edge Functions use this role for backend work. They may read posts but
-- have no direct post write path; owner/editor writes remain authenticated and
-- continue through existing RLS and M5 permission checks.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.posts FROM service_role;

-- -----------------------------------------------------------------------------
-- 7. Function grants. New privileged functions have PUBLIC execution revoked.
-- -----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION automation_list_secrets() FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION automation_secret_save(text, text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION automation_secret_delete(text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION automation_secret_get_internal(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION test_automation_secret(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION automation_feature_flags() FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION automation_set_feature_flag(text, boolean) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION automation_write_log(text, text, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION automation_guard_post_content() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION automation_list_secrets() TO authenticated;
GRANT EXECUTE ON FUNCTION automation_secret_save(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION automation_secret_delete(text) TO authenticated;
GRANT EXECUTE ON FUNCTION automation_secret_get_internal(text) TO service_role;
GRANT EXECUTE ON FUNCTION test_automation_secret(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION automation_feature_flags() TO authenticated;
GRANT EXECUTE ON FUNCTION automation_set_feature_flag(text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION automation_write_log(text, text, text, uuid, jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';
