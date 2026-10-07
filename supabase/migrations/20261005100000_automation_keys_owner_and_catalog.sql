-- Phase 1.2 — make the Keys surface strictly owner-only, classify companion
-- identifiers/public keys, and persist provider-test outcomes without raw details.

ALTER TABLE public.automation_secret_catalog
  ADD COLUMN IF NOT EXISTS credential_type text NOT NULL DEFAULT 'secret';
ALTER TABLE public.automation_secret_catalog
  DROP CONSTRAINT IF EXISTS automation_secret_catalog_credential_type_check;
ALTER TABLE public.automation_secret_catalog
  ADD CONSTRAINT automation_secret_catalog_credential_type_check
  CHECK (credential_type IN ('secret', 'identifier', 'public_key'));

UPDATE public.automation_secret_catalog
   SET credential_type = CASE secret_name
     WHEN 'meta_app_id' THEN 'identifier'
     WHEN 'youtube_client_id' THEN 'identifier'
     WHEN 'tiktok_client_key' THEN 'identifier'
     WHEN 'linkedin_client_id' THEN 'identifier'
     WHEN 'x_api_key' THEN 'identifier'
     WHEN 'tumblr_consumer_key' THEN 'identifier'
     WHEN 'whatsapp_phone_number_id' THEN 'identifier'
     WHEN 'vapid_public_key' THEN 'public_key'
     WHEN 'vapid_subject' THEN 'identifier'
     WHEN 'instagram_user_id' THEN 'identifier'
     WHEN 'facebook_page_id' THEN 'identifier'
     WHEN 'threads_user_id' THEN 'identifier'
     WHEN 'pinterest_board_id' THEN 'identifier'
     WHEN 'linkedin_organization_id' THEN 'identifier'
     WHEN 'tumblr_blog_identifier' THEN 'identifier'
     ELSE credential_type
   END
 WHERE secret_name IN (
   'meta_app_id', 'youtube_client_id', 'tiktok_client_key', 'linkedin_client_id',
   'x_api_key', 'tumblr_consumer_key', 'whatsapp_phone_number_id', 'vapid_public_key',
   'vapid_subject', 'instagram_user_id', 'facebook_page_id', 'threads_user_id',
   'pinterest_board_id', 'linkedin_organization_id', 'tumblr_blog_identifier'
 );

INSERT INTO public.automation_secret_catalog
  (secret_name, label, category, purpose, required, sort_order, credential_type) VALUES
  ('meta_app_id', 'Meta app ID', 'social', 'Pair with the Meta app secret for future OAuth and channel setup', false, 91, 'identifier'),
  ('youtube_client_id', 'YouTube OAuth client ID', 'social', 'Pair with the client secret and refresh token for a read-only YouTube credential test', false, 121, 'identifier'),
  ('tiktok_client_key', 'TikTok client key', 'social', 'Public application identifier for TikTok OAuth setup', false, 141, 'identifier'),
  ('linkedin_client_id', 'LinkedIn client ID', 'social', 'Public application identifier for LinkedIn OAuth setup', false, 171, 'identifier'),
  ('x_api_key', 'X API key', 'social', 'Public application identifier for X OAuth setup; X calls are not made by this test', false, 191, 'identifier'),
  ('x_access_token_secret', 'X access-token secret', 'social', 'OAuth 1.0a companion credential; no provider call is made because X API use may be billable', false, 201, 'secret'),
  ('tumblr_consumer_key', 'Tumblr consumer key', 'social', 'Public application identifier for Tumblr OAuth setup', false, 211, 'identifier'),
  ('whatsapp_phone_number_id', 'WhatsApp phone-number ID', 'social', 'Pair with the WhatsApp Business access token for a read-only Graph API check', false, 241, 'identifier'),
  ('vapid_public_key', 'Web Push VAPID public key', 'push', 'Public key paired with the VAPID private key; safe to publish to push subscribers', false, 261, 'public_key'),
  ('vapid_subject', 'Web Push contact subject', 'push', 'VAPID application contact in mailto: or HTTPS form', false, 262, 'identifier'),
  ('instagram_user_id', 'Instagram account ID', 'social', 'Account identifier for future approved publishing', false, 270, 'identifier'),
  ('facebook_page_id', 'Facebook Page ID', 'social', 'Page identifier for future approved publishing', false, 271, 'identifier'),
  ('threads_user_id', 'Threads user ID', 'social', 'Account identifier for future approved publishing', false, 272, 'identifier'),
  ('pinterest_board_id', 'Pinterest board ID', 'social', 'Board identifier for future approved publishing', false, 273, 'identifier'),
  ('linkedin_organization_id', 'LinkedIn organization ID', 'social', 'Organization identifier for future approved publishing', false, 274, 'identifier'),
  ('tumblr_blog_identifier', 'Tumblr blog identifier', 'social', 'Blog hostname or identifier for future approved publishing', false, 275, 'identifier')
ON CONFLICT (secret_name) DO UPDATE SET
  label = EXCLUDED.label,
  category = EXCLUDED.category,
  purpose = EXCLUDED.purpose,
  required = EXCLUDED.required,
  sort_order = EXCLUDED.sort_order,
  credential_type = EXCLUDED.credential_type,
  enabled = true;

ALTER TABLE public.automation_secrets
  DROP CONSTRAINT IF EXISTS automation_secrets_last_test_status_check;
ALTER TABLE public.automation_secrets
  ADD CONSTRAINT automation_secrets_last_test_status_check
  CHECK (last_test_status IN ('not_tested', 'ok', 'local_ok', 'invalid', 'rate_limited', 'unavailable', 'not_configured'));

-- This helper has no direct grants. Definer-owned automation RPCs call it after
-- the PostgREST caller identity has been verified. A permission override can
-- never make a non-owner eligible to read or change Vault credentials.
CREATE OR REPLACE FUNCTION public.automation_owner_authorized()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT auth.uid() IS NOT NULL AND public.is_admin() AND (public.is_owner() OR public.is_founder());
$$;
REVOKE ALL ON FUNCTION public.automation_owner_authorized() FROM PUBLIC, anon, authenticated, service_role;

DROP POLICY IF EXISTS automation_secret_catalog_owner_read ON public.automation_secret_catalog;
CREATE POLICY automation_secret_catalog_owner_read ON public.automation_secret_catalog
  FOR SELECT TO authenticated USING (public.is_admin() AND (public.is_owner() OR public.is_founder()));
DROP POLICY IF EXISTS automation_secrets_owner_read ON public.automation_secrets;
CREATE POLICY automation_secrets_owner_read ON public.automation_secrets
  FOR SELECT TO authenticated USING (public.is_admin() AND (public.is_owner() OR public.is_founder()));

CREATE OR REPLACE FUNCTION public.automation_list_secrets()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.automation_owner_authorized() THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'name', c.secret_name,
      'label', c.label,
      'category', c.category,
      'credential_type', c.credential_type,
      'purpose', c.purpose,
      'required', c.required,
      'configured', s.vault_secret_id IS NOT NULL,
      'last_test_status', COALESCE(s.last_test_status, 'not_tested'),
      'last_test_message', COALESCE(s.last_test_message, 'Not configured.'),
      'last_tested_at', s.last_tested_at
    ) ORDER BY c.sort_order)
    FROM public.automation_secret_catalog c
    LEFT JOIN public.automation_secrets s USING (secret_name)
    WHERE c.enabled
  ), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.automation_secret_save(p_secret_name text, p_secret_value text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_name text := lower(btrim(COALESCE(p_secret_name, '')));
  v_secret_id uuid;
  v_old_id uuid;
  v_purpose text;
BEGIN
  IF NOT public.automation_owner_authorized() THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_secret_value IS NULL OR length(p_secret_value) < 1 OR length(p_secret_value) > 10000 THEN
    RAISE EXCEPTION 'Secret must contain 1 to 10000 characters';
  END IF;
  SELECT purpose INTO v_purpose FROM public.automation_secret_catalog WHERE secret_name = v_name AND enabled;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown or disabled secret name'; END IF;
  IF to_regclass('vault.secrets') IS NULL OR to_regclass('vault.decrypted_secrets') IS NULL THEN
    RAISE EXCEPTION 'Supabase Vault is not available';
  END IF;

  -- Replacing the Vault record and metadata is one transaction. The exception
  -- deliberately omits the value and all provider/Vault error text.
  BEGIN
    SELECT vault_secret_id INTO v_old_id FROM public.automation_secrets WHERE secret_name = v_name FOR UPDATE;
    IF v_old_id IS NOT NULL THEN DELETE FROM vault.secrets WHERE id = v_old_id; END IF;
    SELECT vault.create_secret(p_secret_value, 'lixxon_automation_' || v_name, v_purpose) INTO v_secret_id;
    IF v_secret_id IS NULL THEN RAISE EXCEPTION 'Vault returned no secret ID'; END IF;
    INSERT INTO public.automation_secrets
      (secret_name, vault_secret_id, last_test_status, last_test_message, created_by, updated_by)
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

CREATE OR REPLACE FUNCTION public.automation_secret_delete(p_secret_name text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_name text := lower(btrim(COALESCE(p_secret_name, ''))); v_secret_id uuid;
BEGIN
  IF NOT public.automation_owner_authorized() THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT vault_secret_id INTO v_secret_id FROM public.automation_secrets WHERE secret_name = v_name FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  BEGIN
    DELETE FROM vault.secrets WHERE id = v_secret_id;
    DELETE FROM public.automation_secrets WHERE secret_name = v_name;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'Vault delete failed; secret metadata was not changed' USING ERRCODE = '58000';
  END;
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.test_automation_secret(p_secret_name text, p_result text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_name text := lower(btrim(COALESCE(p_secret_name, ''))); v_message text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_result IS NULL OR p_result NOT IN ('ok', 'local_ok', 'invalid', 'rate_limited', 'unavailable', 'not_configured') THEN
    RAISE EXCEPTION 'Unknown safe test result';
  END IF;
  v_message := CASE p_result
    WHEN 'ok' THEN 'Read-only provider check verified; write scopes were not exercised.'
    WHEN 'local_ok' THEN 'Local format check passed; provider connectivity is not verified.'
    WHEN 'invalid' THEN 'Provider rejected this credential or required scope.'
    WHEN 'rate_limited' THEN 'Provider rate-limited the test; retry later.'
    WHEN 'unavailable' THEN 'Provider is temporarily unavailable.'
    ELSE 'This credential is not configured.'
  END;
  UPDATE public.automation_secrets
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

CREATE OR REPLACE FUNCTION public.automation_set_feature_flag(p_flag_key text, p_enabled boolean)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.automation_owner_authorized() THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_flag_key NOT IN (
    'automation.enabled', 'automation.daily_pipeline', 'automation.distribution',
    'automation.video', 'automation.agents', 'automation.push'
  ) THEN RAISE EXCEPTION 'Unknown automation feature flag'; END IF;
  UPDATE public.feature_flags
     SET enabled = COALESCE(p_enabled, false), updated_by = auth.uid(), updated_at = now()
   WHERE flag_key = p_flag_key;
  RETURN FOUND;
END $$;

REVOKE ALL ON FUNCTION public.automation_list_secrets() FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.automation_secret_save(text, text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.automation_secret_delete(text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.automation_set_feature_flag(text, boolean) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.automation_list_secrets() TO authenticated;
GRANT EXECUTE ON FUNCTION public.automation_secret_save(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.automation_secret_delete(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.automation_set_feature_flag(text, boolean) TO authenticated;

NOTIFY pgrst, 'reload schema';
