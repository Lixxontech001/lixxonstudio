-- Owner-only VAPID generation storage.
-- The Edge function generates the pair; this RPC stores all three values in one
-- Vault transaction so a failed replacement cannot leave a partial key set.

CREATE OR REPLACE FUNCTION public.automation_vapid_store(
  p_private_key text,
  p_public_key text,
  p_subject text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_name text;
  v_value text;
  v_secret_id uuid;
  v_old_id uuid;
  v_purpose text;
BEGIN
  IF NOT public.automation_owner_authorized() THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_private_key IS NULL OR p_private_key !~ '^[A-Za-z0-9_-]{43}$'
     OR p_public_key IS NULL OR p_public_key !~ '^[A-Za-z0-9_-]{87}$'
     OR p_subject IS NULL OR (
       p_subject !~ '^mailto:[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
       AND p_subject !~ '^https://[^[:space:]]+$'
     ) THEN
    RAISE EXCEPTION 'Invalid VAPID values';
  END IF;
  IF to_regclass('vault.secrets') IS NULL OR to_regclass('vault.decrypted_secrets') IS NULL THEN
    RAISE EXCEPTION 'Supabase Vault is not available';
  END IF;

  BEGIN
    FOR v_name, v_value IN
      SELECT * FROM (VALUES
        ('vapid_private_key', p_private_key),
        ('vapid_public_key', p_public_key),
        ('vapid_subject', p_subject)
      ) AS generated_keys(secret_name, secret_value)
    LOOP
      SELECT purpose INTO v_purpose
        FROM public.automation_secret_catalog
       WHERE secret_name = v_name AND enabled;
      IF NOT FOUND THEN RAISE EXCEPTION 'VAPID key catalogue is incomplete'; END IF;

      SELECT vault_secret_id INTO v_old_id
        FROM public.automation_secrets
       WHERE secret_name = v_name
       FOR UPDATE;
      IF v_old_id IS NOT NULL THEN DELETE FROM vault.secrets WHERE id = v_old_id; END IF;

      SELECT vault.create_secret(v_value, 'lixxon_automation_' || v_name, v_purpose)
        INTO v_secret_id;
      IF v_secret_id IS NULL THEN RAISE EXCEPTION 'Vault returned no secret ID'; END IF;

      INSERT INTO public.automation_secrets
        (secret_name, vault_secret_id, last_test_status, last_test_message, created_by, updated_by)
      VALUES (v_name, v_secret_id, 'not_tested', 'Generated; test this connection.', auth.uid(), auth.uid())
      ON CONFLICT (secret_name) DO UPDATE SET
        vault_secret_id = EXCLUDED.vault_secret_id,
        last_test_status = 'not_tested',
        last_test_message = 'Generated; test this connection.',
        last_tested_at = NULL,
        updated_by = auth.uid(),
        updated_at = now();
    END LOOP;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'VAPID values were not recorded; Vault transaction rolled back' USING ERRCODE = '58000';
  END;

  RETURN jsonb_build_object('ok', true, 'public_key', p_public_key, 'subject', p_subject);
END $$;

REVOKE ALL ON FUNCTION public.automation_vapid_store(text, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.automation_vapid_store(text, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
