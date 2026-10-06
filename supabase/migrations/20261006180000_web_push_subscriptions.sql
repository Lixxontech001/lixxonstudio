-- =============================================================================
-- Phase 5 (Slice 1) — Web Push device subscriptions (data layer only).
--
-- One row per owner device. Opt-in is OFF by default: a row exists as soon as
-- the owner's browser registers, but it is only eligible for delivery when the
-- owner explicitly confirms that device and complete key material is present.
--
-- Privacy/least-privilege:
--   * RLS is enabled and every direct table grant is revoked first (the harness
--     and production both apply schema-wide default privileges).
--   * `authenticated` gets a column-level SELECT grant that deliberately omits
--     `endpoint`, `p256dh` and `auth_key`; the RLS policy limits rows to the
--     acting owner/user.
--   * `anon` gets nothing. `service_role` gets no table grant either; the only
--     way to read delivery key material is the service-role RPC below.
--   * Revocation scrubs endpoint and key material in place, so a revoked device
--     keeps a human-readable audit trail but no usable push credentials.
--   * Audit rows carry fixed event codes and an empty details object only.
--
-- No browser-reachable function returns endpoint or key material, and no
-- function here publishes anything or touches article content.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.push_device_subscriptions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id        uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE CASCADE,
  device_id            text NOT NULL CHECK (device_id ~ '^[A-Za-z0-9_-]{8,128}$'),
  label                text NOT NULL DEFAULT 'This device' CHECK (char_length(label) BETWEEN 1 AND 80),
  endpoint             text CHECK (endpoint IS NULL OR (endpoint ~ '^https://' AND char_length(endpoint) BETWEEN 16 AND 2048)),
  p256dh               text CHECK (p256dh IS NULL OR char_length(p256dh) BETWEEN 20 AND 256),
  auth_key             text CHECK (auth_key IS NULL OR char_length(auth_key) BETWEEN 8 AND 256),
  enabled              boolean NOT NULL DEFAULT false,
  revoked_at           timestamptz,
  last_delivery_at     timestamptz,
  last_delivery_status text CHECK (last_delivery_status IS NULL OR last_delivery_status IN ('sent', 'failed', 'expired')),
  failure_count        integer NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  last_seen_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT push_device_subscriptions_owner_device_key UNIQUE (owner_user_id, device_id),
  -- A device can only be delivery-eligible with a complete, live subscription.
  CONSTRAINT push_device_subscriptions_enabled_complete CHECK (
    NOT enabled OR (endpoint IS NOT NULL AND p256dh IS NOT NULL AND auth_key IS NOT NULL AND revoked_at IS NULL)
  ),
  -- Revoked devices keep no credentials at all.
  CONSTRAINT push_device_subscriptions_revoked_scrubbed CHECK (
    revoked_at IS NULL OR (NOT enabled AND endpoint IS NULL AND p256dh IS NULL AND auth_key IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS push_device_subscriptions_owner_active
  ON public.push_device_subscriptions (owner_user_id)
  WHERE enabled AND revoked_at IS NULL;

ALTER TABLE public.push_device_subscriptions ENABLE ROW LEVEL SECURITY;

-- Least privilege: start from nothing, then hand back only safe columns.
REVOKE ALL ON TABLE public.push_device_subscriptions FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT (
  id, owner_user_id, device_id, label, enabled, revoked_at,
  last_delivery_at, last_delivery_status, failure_count,
  created_at, updated_at, last_seen_at
) ON public.push_device_subscriptions TO authenticated;

DROP POLICY IF EXISTS push_device_subscriptions_owner_read ON public.push_device_subscriptions;
CREATE POLICY push_device_subscriptions_owner_read ON public.push_device_subscriptions
  FOR SELECT TO authenticated
  USING (auth.uid() = owner_user_id AND public.is_admin() AND (public.is_owner() OR public.is_founder()));

-- -----------------------------------------------------------------------------
-- Internal audit helper: fixed event code, allow-listed entity type, empty
-- details. Owner-written article prose is untouched; nothing here is readable
-- by a browser role except through the existing owner-only automation logs.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.push_audit_event(
  p_event_code text, p_entity_type text, p_entity_id uuid, p_actor_id uuid
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_id bigint;
BEGIN
  IF p_event_code !~ '^[A-Z][A-Z0-9_.:-]{1,63}$' THEN RAISE EXCEPTION 'Invalid push audit event code'; END IF;
  IF p_entity_type !~ '^[a-z][a-z0-9_-]{0,31}$' THEN RAISE EXCEPTION 'Invalid push entity type'; END IF;
  INSERT INTO public.automation_logs (event_code, status, entity_type, entity_id, details, actor_id)
  VALUES (p_event_code, 'succeeded', p_entity_type, p_entity_id, '{}'::jsonb, p_actor_id)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.push_audit_event(text, text, uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Owner device registration / opt-in. Idempotent on (owner, device_id).
--   p_enable IS NULL  -> touch only (metadata/keys refreshed, eligibility kept)
--   p_enable IS TRUE  -> opt in and enable delivery (complete keys required)
--   p_enable IS FALSE -> soft opt-out (keys retained, delivery off, no revoke)
-- Returns metadata only; never endpoint or key material.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.push_device_upsert(
  p_device_id text,
  p_label text DEFAULT NULL,
  p_endpoint text DEFAULT NULL,
  p_p256dh text DEFAULT NULL,
  p_auth text DEFAULT NULL,
  p_enable boolean DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_device text := btrim(COALESCE(p_device_id, ''));
  v_label text := left(COALESCE(NULLIF(btrim(COALESCE(p_label, '')), ''), 'This device'), 80);
  v_endpoint text := NULLIF(btrim(COALESCE(p_endpoint, '')), '');
  v_p256dh text := NULLIF(btrim(COALESCE(p_p256dh, '')), '');
  v_auth text := NULLIF(btrim(COALESCE(p_auth, '')), '');
  v_enable boolean := p_enable;
  v_existed boolean;
  v_was_enabled boolean;
  v_id uuid;
  v_enabled boolean;
  v_updated_at timestamptz;
BEGIN
  IF NOT public.automation_owner_authorized() THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF v_device !~ '^[A-Za-z0-9_-]{8,128}$' THEN RAISE EXCEPTION 'Invalid device id'; END IF;
  IF v_endpoint IS NOT NULL AND (v_endpoint !~ '^https://' OR char_length(v_endpoint) > 2048) THEN
    RAISE EXCEPTION 'Invalid push endpoint';
  END IF;
  IF v_p256dh IS NOT NULL AND (char_length(v_p256dh) < 20 OR char_length(v_p256dh) > 256) THEN
    RAISE EXCEPTION 'Invalid push public key';
  END IF;
  IF v_auth IS NOT NULL AND (char_length(v_auth) < 8 OR char_length(v_auth) > 256) THEN
    RAISE EXCEPTION 'Invalid push auth secret';
  END IF;
  IF v_enable IS TRUE AND (v_endpoint IS NULL OR v_p256dh IS NULL OR v_auth IS NULL) THEN
    RAISE EXCEPTION 'Complete push key material is required to enable a device';
  END IF;

  SELECT true, d.enabled INTO v_existed, v_was_enabled
    FROM public.push_device_subscriptions d
   WHERE d.owner_user_id = v_uid AND d.device_id = v_device;

  INSERT INTO public.push_device_subscriptions AS d (
    owner_user_id, device_id, label, endpoint, p256dh, auth_key, enabled,
    revoked_at, failure_count, updated_at, last_seen_at
  ) VALUES (
    v_uid, v_device, v_label, v_endpoint, v_p256dh, v_auth,
    COALESCE(v_enable, false), NULL,
    CASE WHEN v_enable IS TRUE THEN 0 ELSE 0 END,
    now(), now()
  )
  ON CONFLICT (owner_user_id, device_id) DO UPDATE SET
    label         = EXCLUDED.label,
    endpoint      = COALESCE(EXCLUDED.endpoint, d.endpoint),
    p256dh        = COALESCE(EXCLUDED.p256dh, d.p256dh),
    auth_key      = COALESCE(EXCLUDED.auth_key, d.auth_key),
    enabled       = CASE WHEN v_enable IS NULL THEN d.enabled WHEN v_enable THEN true ELSE false END,
    revoked_at    = CASE WHEN v_enable IS TRUE THEN NULL ELSE d.revoked_at END,
    failure_count = CASE WHEN v_enable IS TRUE THEN 0 ELSE d.failure_count END,
    updated_at    = now(),
    last_seen_at  = now()
  RETURNING id, enabled, updated_at INTO v_id, v_enabled, v_updated_at;

  IF v_existed IS NOT TRUE THEN
    PERFORM public.push_audit_event('PUSH_DEVICE_REGISTERED', 'push_device', v_id, v_uid);
  ELSIF v_enabled AND COALESCE(v_was_enabled, false) IS NOT TRUE THEN
    PERFORM public.push_audit_event('PUSH_DEVICE_ENABLED', 'push_device', v_id, v_uid);
  ELSE
    PERFORM public.push_audit_event('PUSH_DEVICE_UPDATED', 'push_device', v_id, v_uid);
  END IF;

  RETURN jsonb_build_object(
    'id', v_id,
    'device_id', v_device,
    'label', v_label,
    'enabled', v_enabled,
    'revoked', false,
    'updated_at', v_updated_at
  );
END $$;

-- Revocation: opt out, disable delivery and scrub endpoint/key material in place.
CREATE OR REPLACE FUNCTION public.push_device_revoke(p_device_id text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_device text := btrim(COALESCE(p_device_id, ''));
  v_id uuid;
BEGIN
  IF NOT public.automation_owner_authorized() THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF v_device !~ '^[A-Za-z0-9_-]{8,128}$' THEN RAISE EXCEPTION 'Invalid device id'; END IF;

  UPDATE public.push_device_subscriptions
     SET enabled = false,
         endpoint = NULL,
         p256dh = NULL,
         auth_key = NULL,
         revoked_at = now(),
         last_delivery_status = NULL,
         updated_at = now()
   WHERE owner_user_id = v_uid AND device_id = v_device AND revoked_at IS NULL
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN RETURN false; END IF;
  PERFORM public.push_audit_event('PUSH_DEVICE_REVOKED', 'push_device', v_id, v_uid);
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.push_device_revoke_all()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_count integer := 0;
BEGIN
  IF NOT public.automation_owner_authorized() THEN RAISE EXCEPTION 'forbidden'; END IF;

  UPDATE public.push_device_subscriptions
     SET enabled = false,
         endpoint = NULL,
         p256dh = NULL,
         auth_key = NULL,
         revoked_at = now(),
         last_delivery_status = NULL,
         updated_at = now()
   WHERE owner_user_id = v_uid AND revoked_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  IF v_count > 0 THEN
    PERFORM public.push_audit_event('PUSH_ALL_DEVICES_REVOKED', 'push_owner', v_uid, v_uid);
  END IF;
  RETURN v_count;
END $$;

-- -----------------------------------------------------------------------------
-- Service-role-only delivery surface. This is the only path that returns
-- endpoint/key material, and it is reachable only by the server role.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.push_delivery_targets(p_limit integer DEFAULT 20)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100);
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  -- Fail closed: with the owner's kill switch off there are no delivery targets.
  IF NOT EXISTS (SELECT 1 FROM public.feature_flags WHERE flag_key = 'automation.push' AND enabled) THEN
    RETURN '[]'::jsonb;
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', d.id,
      'owner_user_id', d.owner_user_id,
      'device_id', d.device_id,
      'label', d.label,
      'endpoint', d.endpoint,
      'p256dh', d.p256dh,
      'auth_key', d.auth_key
    ) ORDER BY d.last_seen_at DESC)
    FROM (
      SELECT s.* FROM public.push_device_subscriptions s
       WHERE s.enabled AND s.revoked_at IS NULL
         AND s.endpoint IS NOT NULL AND s.p256dh IS NOT NULL AND s.auth_key IS NOT NULL
       ORDER BY s.last_seen_at DESC
       LIMIT v_limit
    ) d
  ), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.push_record_delivery(p_id uuid, p_status text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_id uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_status NOT IN ('sent', 'failed', 'expired') THEN RAISE EXCEPTION 'Invalid delivery status'; END IF;

  IF p_status = 'expired' THEN
    -- The push service reported a gone/unknown subscription: revoke and scrub.
    UPDATE public.push_device_subscriptions
       SET enabled = false,
           endpoint = NULL,
           p256dh = NULL,
           auth_key = NULL,
           revoked_at = now(),
           last_delivery_at = now(),
           last_delivery_status = 'expired',
           failure_count = failure_count + 1,
           updated_at = now()
     WHERE id = p_id AND revoked_at IS NULL
    RETURNING id INTO v_id;
    IF v_id IS NOT NULL THEN
      PERFORM public.push_audit_event('PUSH_SUBSCRIPTION_EXPIRED', 'push_device', v_id, NULL);
    END IF;
  ELSIF p_status = 'sent' THEN
    UPDATE public.push_device_subscriptions
       SET last_delivery_at = now(), last_delivery_status = 'sent', failure_count = 0, updated_at = now()
     WHERE id = p_id AND revoked_at IS NULL
    RETURNING id INTO v_id;
    IF v_id IS NOT NULL THEN
      PERFORM public.push_audit_event('PUSH_DELIVERY_SENT', 'push_device', v_id, NULL);
    END IF;
  ELSE
    UPDATE public.push_device_subscriptions
       SET last_delivery_at = now(), last_delivery_status = 'failed',
           failure_count = failure_count + 1, updated_at = now()
     WHERE id = p_id AND revoked_at IS NULL
    RETURNING id INTO v_id;
    IF v_id IS NOT NULL THEN
      PERFORM public.push_audit_event('PUSH_DELIVERY_FAILED', 'push_device', v_id, NULL);
    END IF;
  END IF;

  RETURN v_id IS NOT NULL;
END $$;

REVOKE ALL ON FUNCTION public.push_device_upsert(text, text, text, text, text, boolean) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.push_device_revoke(text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.push_device_revoke_all() FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.push_delivery_targets(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.push_record_delivery(uuid, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.push_device_upsert(text, text, text, text, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.push_device_revoke(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.push_device_revoke_all() TO authenticated;
GRANT EXECUTE ON FUNCTION public.push_delivery_targets(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.push_record_delivery(uuid, text) TO service_role;
