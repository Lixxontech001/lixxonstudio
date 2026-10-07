-- Phase 3.2 — per-channel safety counters, circuit breakers, aggregate-only
-- measurement, and owner alerts. Provider send retries remain manual after a
-- verified transient failure to avoid duplicate external messages.

ALTER TABLE automation_distribution_channels
  ADD COLUMN IF NOT EXISTS circuit_state text NOT NULL DEFAULT 'closed'
    CHECK (circuit_state IN ('closed', 'open', 'half_open')),
  ADD COLUMN IF NOT EXISTS failure_streak integer NOT NULL DEFAULT 0
    CHECK (failure_streak BETWEEN 0 AND 1000),
  ADD COLUMN IF NOT EXISTS last_failure_class text
    CHECK (last_failure_class IS NULL OR last_failure_class IN ('quota', 'authentication', 'policy', 'transient')),
  ADD COLUMN IF NOT EXISTS retry_after timestamptz,
  ADD COLUMN IF NOT EXISTS circuit_probe_claimed_at timestamptz;

CREATE TABLE IF NOT EXISTS automation_channel_usage_daily (
  channel_key text NOT NULL REFERENCES automation_distribution_channels(channel_key) ON DELETE RESTRICT,
  usage_day date NOT NULL,
  readback_attempts integer NOT NULL DEFAULT 0 CHECK (readback_attempts BETWEEN 0 AND 100000),
  delivery_attempts integer NOT NULL DEFAULT 0 CHECK (delivery_attempts BETWEEN 0 AND 100000),
  delivery_successes integer NOT NULL DEFAULT 0 CHECK (delivery_successes BETWEEN 0 AND 100000),
  delivery_failures integer NOT NULL DEFAULT 0 CHECK (delivery_failures BETWEEN 0 AND 100000),
  owner_test_email_attempts integer NOT NULL DEFAULT 0 CHECK (owner_test_email_attempts BETWEEN 0 AND 1000),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_key, usage_day),
  CHECK (delivery_successes + delivery_failures <= delivery_attempts)
);
CREATE INDEX IF NOT EXISTS automation_channel_usage_recent
  ON automation_channel_usage_daily (usage_day DESC, channel_key);
ALTER TABLE automation_channel_usage_daily
  ADD COLUMN IF NOT EXISTS owner_test_email_successes integer NOT NULL DEFAULT 0
    CHECK (owner_test_email_successes BETWEEN 0 AND 1000),
  ADD COLUMN IF NOT EXISTS owner_test_email_failures integer NOT NULL DEFAULT 0
    CHECK (owner_test_email_failures BETWEEN 0 AND 1000);

-- Aggregate counts only: no user IDs, addresses, device IDs, request URLs,
-- event payloads or provider response bodies are stored here.
CREATE TABLE IF NOT EXISTS distribution_metric_samples (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  channel_key text NOT NULL REFERENCES automation_distribution_channels(channel_key) ON DELETE RESTRICT,
  variant_id uuid REFERENCES ab_test_variants(id) ON DELETE RESTRICT,
  period_start date NOT NULL,
  period_end date NOT NULL,
  metric_key text NOT NULL CHECK (metric_key IN (
    'reach', 'impressions', 'clicks', 'conversions', 'engagements', 'saves', 'replies',
    'unsubscribes', 'negative_feedback', 'click_through_rate', 'engagement_rate',
    'conversion_rate', 'save_rate', 'reply_rate', 'unsubscribe_rate', 'negative_feedback_rate'
  )),
  metric_value numeric(18, 8) NOT NULL CHECK (metric_value >= 0 AND metric_value <= 1000000000000),
  measurement_kind text NOT NULL CHECK (measurement_kind IN ('measured', 'estimated')),
  collection_basis text NOT NULL CHECK (collection_basis IN (
    'provider_aggregate', 'consented_site_aggregate', 'estimate'
  )),
  consent_verified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (period_start <= period_end AND period_start >= period_end - 30),
  CHECK ((collection_basis = 'estimate' AND measurement_kind = 'estimated')
      OR (collection_basis <> 'estimate' AND measurement_kind = 'measured')),
  CHECK (collection_basis <> 'consented_site_aggregate' OR consent_verified),
  CHECK (metric_key NOT LIKE '%_rate' OR metric_value <= 1)
);
CREATE UNIQUE INDEX IF NOT EXISTS distribution_metric_samples_idempotent
  ON distribution_metric_samples (
    post_id, channel_key, (COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid)),
    period_start, period_end, metric_key, collection_basis
  );
CREATE INDEX IF NOT EXISTS distribution_metric_samples_recent
  ON distribution_metric_samples (post_id, period_end DESC, channel_key, metric_key);

CREATE TABLE IF NOT EXISTS automation_distribution_failure_alerts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  channel_key text NOT NULL REFERENCES automation_distribution_channels(channel_key) ON DELETE RESTRICT,
  usage_day date NOT NULL,
  failure_class text NOT NULL CHECK (failure_class IN ('quota', 'authentication', 'policy', 'transient')),
  safe_error_code text NOT NULL CHECK (safe_error_code ~ '^[A-Z0-9_.:-]{1,64}$'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'dispatching', 'delivered', 'failed', 'blocked')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 3),
  delivery_channel text CHECK (delivery_channel IS NULL OR delivery_channel IN ('email', 'telegram', 'none')),
  retry_after timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  UNIQUE (channel_key, usage_day, failure_class)
);
CREATE INDEX IF NOT EXISTS automation_distribution_failure_alerts_pending
  ON automation_distribution_failure_alerts (status, retry_after, created_at);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'automation_channel_usage_daily', 'distribution_metric_samples',
    'automation_distribution_failure_alerts'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated, service_role', t);
  END LOOP;
END $$;

CREATE POLICY automation_channel_usage_daily_read ON automation_channel_usage_daily
  FOR SELECT TO authenticated USING (admin_can('automation.check'));
CREATE POLICY distribution_metric_samples_read ON distribution_metric_samples
  FOR SELECT TO authenticated USING (admin_can('automation.check'));
CREATE POLICY automation_distribution_failure_alerts_read ON automation_distribution_failure_alerts
  FOR SELECT TO authenticated USING (admin_can('automation.check'));
GRANT SELECT ON automation_channel_usage_daily, distribution_metric_samples,
  automation_distribution_failure_alerts TO authenticated;

DROP TRIGGER IF EXISTS trg_dist_safety_audit_metric ON distribution_metric_samples;
CREATE TRIGGER trg_dist_safety_audit_metric AFTER INSERT OR UPDATE OR DELETE ON distribution_metric_samples
  FOR EACH ROW EXECUTE FUNCTION public.audit_admin_change();
DROP TRIGGER IF EXISTS trg_dist_safety_audit_alert ON automation_distribution_failure_alerts;
CREATE TRIGGER trg_dist_safety_audit_alert AFTER INSERT OR UPDATE OR DELETE ON automation_distribution_failure_alerts
  FOR EACH ROW EXECUTE FUNCTION public.audit_admin_change();

CREATE OR REPLACE FUNCTION automation_record_channel_readback(
  p_channel_key text, p_status text, p_safe_code text, p_quota_remaining integer DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_failure_class text;
  v_failure_streak integer;
  v_retry_after timestamptz;
  v_usage_day date := (now() AT TIME ZONE 'Africa/Lagos')::date;
  v_delay_seconds integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF p_status NOT IN ('connected', 'blocked_by_provider_review', 'quota_exhausted', 'not_configured', 'unavailable')
     OR p_safe_code IS NULL OR p_safe_code NOT IN (
       'PROVIDER_READBACK_OK', 'PROVIDER_AUTH', 'PROVIDER_REVIEW_REQUIRED', 'PROVIDER_QUOTA',
       'PROVIDER_UNAVAILABLE', 'PROVIDER_NOT_CONFIGURED', 'PROVIDER_UNEXPECTED'
     )
     OR (p_quota_remaining IS NOT NULL AND p_quota_remaining < 0) THEN
    RAISE EXCEPTION 'Invalid channel readback';
  END IF;

  INSERT INTO automation_channel_usage_daily (channel_key, usage_day, readback_attempts)
  VALUES (p_channel_key, v_usage_day, 1)
  ON CONFLICT (channel_key, usage_day) DO UPDATE SET
    readback_attempts = automation_channel_usage_daily.readback_attempts + 1,
    updated_at = now();

  v_failure_class := CASE
    WHEN p_status = 'not_configured' THEN NULL
    WHEN p_safe_code = 'PROVIDER_QUOTA' THEN 'quota'
    WHEN p_safe_code IN ('PROVIDER_AUTH', 'PROVIDER_NOT_CONFIGURED') THEN 'authentication'
    WHEN p_safe_code IN ('PROVIDER_REVIEW_REQUIRED', 'PROVIDER_UNEXPECTED') THEN 'policy'
    WHEN p_status = 'connected' THEN NULL
    ELSE 'transient'
  END;

  SELECT failure_streak INTO v_failure_streak
    FROM automation_distribution_channels WHERE channel_key = p_channel_key FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  IF p_status = 'connected' THEN
    v_failure_streak := 0;
    v_retry_after := NULL;
  ELSIF p_status = 'not_configured' THEN
    v_failure_streak := COALESCE(v_failure_streak, 0);
    v_retry_after := NULL;
  ELSE
    v_failure_streak := COALESCE(v_failure_streak, 0) + 1;
    IF v_failure_class = 'quota' THEN
      v_retry_after := ((date_trunc('day', now() AT TIME ZONE 'Africa/Lagos') + interval '1 day') AT TIME ZONE 'Africa/Lagos');
    ELSIF v_failure_class IN ('authentication', 'policy') THEN
      v_retry_after := NULL;
    ELSE
      v_delay_seconds := ceil(LEAST(3600.0,
        30 * power(2.0, LEAST(v_failure_streak - 1, 7)) * (0.75 + random() * 0.5)))::integer;
      v_retry_after := now() + make_interval(secs => v_delay_seconds);
    END IF;
  END IF;

  UPDATE automation_distribution_channels SET
    last_readback_status = p_status,
    last_readback_at = now(),
    quota_remaining = CASE
      WHEN p_channel_key = 'telegram' AND daily_free_quota IS NOT NULL THEN greatest(daily_free_quota - COALESCE((
        SELECT u.delivery_attempts FROM automation_channel_usage_daily u
         WHERE u.channel_key = p_channel_key AND u.usage_day = v_usage_day
      ), 0), 0)
      ELSE p_quota_remaining END,
    failure_streak = v_failure_streak,
    last_failure_class = CASE WHEN p_status = 'not_configured' THEN last_failure_class ELSE v_failure_class END,
    retry_after = CASE WHEN p_status = 'not_configured' THEN retry_after ELSE v_retry_after END,
    circuit_state = CASE
      WHEN p_status = 'not_configured' THEN circuit_state
      WHEN p_status = 'connected' THEN 'closed'
      WHEN v_failure_class IN ('quota', 'authentication', 'policy') OR v_failure_streak >= 3 THEN 'open'
      ELSE 'closed' END,
    circuit_probe_claimed_at = NULL,
    state = CASE
      WHEN is_paused THEN 'paused'
      WHEN p_status = 'connected' THEN 'approval_required'
      WHEN p_status = 'blocked_by_provider_review' THEN 'blocked_by_provider_review'
      WHEN p_status = 'quota_exhausted' THEN 'quota_exhausted'
      WHEN p_status = 'not_configured' THEN 'not_configured'
      ELSE 'manual_kit' END,
    state_reason = CASE
      WHEN is_paused THEN 'Paused by the owner.'
      WHEN p_status = 'connected' THEN 'Provider readback passed; owner approval is still required for each distribution.'
      WHEN p_status = 'not_configured' THEN 'Required credentials are not configured; the manual Daily Kit remains available.'
      WHEN v_failure_class = 'authentication' THEN 'The provider rejected or could not verify credentials. This channel is paused until a fresh read-only check passes; the Daily Kit remains available.'
      WHEN v_failure_class = 'policy' THEN 'The platform requires account review, permission changes or policy attention. This channel is paused; the Daily Kit remains available.'
      WHEN v_failure_class = 'quota' THEN 'The provider allowance or owner-set daily safety cap is exhausted. This channel is paused until the allowance resets; the Daily Kit remains available.'
      WHEN v_failure_streak >= 3 THEN 'Repeated temporary provider failures opened this channel circuit. It is backing off; the Daily Kit remains available.'
      ELSE 'Provider readback failed temporarily; a bounded backoff is active and the Daily Kit remains available.' END,
    updated_at = now()
   WHERE channel_key = p_channel_key;
  IF NOT FOUND THEN RETURN false; END IF;

  IF p_status NOT IN ('connected', 'not_configured') AND (
    v_failure_class IN ('quota', 'authentication', 'policy') OR v_failure_streak >= 3
  ) THEN
    INSERT INTO automation_distribution_failure_alerts (
      channel_key, usage_day, failure_class, safe_error_code
    ) VALUES (p_channel_key, v_usage_day, v_failure_class, p_safe_code)
    ON CONFLICT (channel_key, usage_day, failure_class) DO NOTHING;
  END IF;

  INSERT INTO automation_logs (event_code, status, entity_type, details)
  VALUES ('CHANNEL.READBACK', CASE WHEN p_status = 'connected' THEN 'succeeded' ELSE 'blocked' END,
    'distribution_channel', jsonb_build_object(
      'channel', p_channel_key, 'error_code', p_safe_code, 'failure_class', v_failure_class,
      'usage_day', v_usage_day
    ));
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION automation_set_distribution_pause(p_channel_key text, p_paused boolean)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT automation_owner_authorized() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  UPDATE automation_distribution_channels SET
    is_paused = COALESCE(p_paused, true),
    state = CASE WHEN COALESCE(p_paused, true) THEN 'paused'
      WHEN circuit_state = 'open' AND last_failure_class IN ('authentication', 'policy') THEN 'blocked_by_provider_review'
      WHEN circuit_state = 'open' AND last_failure_class = 'quota' THEN 'quota_exhausted'
      WHEN circuit_state = 'open' OR retry_after > now() THEN 'manual_kit'
      WHEN last_readback_status = 'connected' AND last_readback_at > now() - interval '24 hours' THEN 'approval_required'
      ELSE 'manual_kit' END,
    state_reason = CASE WHEN COALESCE(p_paused, true) THEN 'Paused by the owner.'
      WHEN circuit_state = 'open' AND last_failure_class IN ('authentication', 'policy') THEN 'The channel circuit remains open until credentials or platform permissions are corrected and a fresh read-only check passes.'
      WHEN circuit_state = 'open' AND last_failure_class = 'quota' THEN 'The channel circuit remains open until the daily allowance resets; the Daily Kit is available.'
      WHEN circuit_state = 'open' OR retry_after > now() THEN 'A bounded provider backoff is active; the Daily Kit remains available.'
      WHEN last_readback_status = 'connected' AND last_readback_at > now() - interval '24 hours' THEN 'Recent provider readback is available; approval is still required.'
      ELSE 'No recent provider readback is recorded; use the owner-approved manual kit.' END,
    updated_by = auth.uid(), updated_at = now()
   WHERE channel_key = p_channel_key;
  RETURN FOUND;
END $$;

CREATE OR REPLACE FUNCTION automation_claim_distribution_delivery(
  p_actor_id uuid, p_draft_id uuid, p_expected_sha256 text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_draft automation_distribution_drafts%ROWTYPE;
  v_channel automation_distribution_channels%ROWTYPE;
  v_log distribution_log%ROWTYPE;
  v_checksum text;
  v_idempotency text;
  v_flags boolean := false;
  v_usage_day date := (now() AT TIME ZONE 'Africa/Lagos')::date;
  v_today_count integer := 0;
  v_post_slug text;
  v_expected_link text;
  v_probe_claimed_at timestamptz;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF p_actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM app_admins a WHERE a.user_id = p_actor_id AND a.status = 'active'
      AND (a.is_founder OR a.role = 'owner')
  ) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_draft FROM automation_distribution_drafts WHERE id = p_draft_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'A current owner-approved distribution copy is required'; END IF;
  v_checksum := encode(extensions.digest(convert_to(v_draft.payload::text, 'UTF8'), 'sha256'), 'hex');
  IF p_expected_sha256 IS DISTINCT FROM v_checksum
     OR v_draft.payload_sha256 <> v_checksum OR v_draft.approved_payload_sha256 <> v_checksum THEN
    RAISE EXCEPTION 'The approved distribution copy has changed';
  END IF;
  v_idempotency := v_draft.id::text || ':' || v_checksum;
  IF v_draft.review_status = 'sent' THEN
    SELECT * INTO v_log FROM distribution_log WHERE idempotency_key = v_idempotency FOR UPDATE;
    IF FOUND AND v_log.status = 'sent' THEN
      RETURN jsonb_build_object('ok', true, 'already_sent', true, 'remote_post_id', v_log.remote_post_id, 'log_id', v_log.id);
    END IF;
    RAISE EXCEPTION 'The delivered distribution receipt is not available';
  END IF;
  IF v_draft.review_status <> 'approved' OR v_draft.approved_at IS NULL THEN
    RAISE EXCEPTION 'A current owner-approved distribution copy is required';
  END IF;
  SELECT slug INTO v_post_slug FROM posts
   WHERE id = v_draft.post_id AND status IN ('scheduled', 'published');
  IF NOT FOUND THEN RAISE EXCEPTION 'The article is no longer scheduled or published'; END IF;
  v_expected_link := 'https://lixxonstudio.com/blog/' || v_post_slug || '?utm_source=' || v_draft.channel_key
    || '&utm_medium=' || CASE WHEN v_draft.channel_key = 'newsletter' THEN 'email' WHEN v_draft.channel_key = 'site_widget' THEN 'onsite' ELSE 'organic_social' END
    || '&utm_campaign=' || v_post_slug;
  IF v_draft.payload->>'link' IS DISTINCT FROM v_expected_link THEN
    RAISE EXCEPTION 'The approved distribution link no longer matches the article';
  END IF;
  IF v_draft.channel_key <> 'telegram' THEN RAISE EXCEPTION 'This channel is manual-kit only in the current verified adapter set'; END IF;
  SELECT * INTO v_channel FROM automation_distribution_channels WHERE channel_key = v_draft.channel_key FOR UPDATE;
  IF NOT FOUND OR v_channel.is_paused OR v_channel.state <> 'approval_required'
     OR v_channel.last_readback_status <> 'connected'
     OR v_channel.last_readback_at IS NULL OR v_channel.last_readback_at < now() - interval '24 hours' THEN
    RAISE EXCEPTION 'A fresh successful provider readback is required; use the manual kit while this channel is not ready';
  END IF;
  SELECT count(*) = 2 AND bool_and(enabled) INTO v_flags FROM feature_flags
   WHERE flag_key IN ('automation.enabled', 'automation.distribution');
  IF NOT COALESCE(v_flags, false) THEN RAISE EXCEPTION 'The master and distribution switches must both be enabled by the owner'; END IF;

  IF v_channel.circuit_state = 'open' THEN
    IF v_channel.retry_after IS NULL OR v_channel.retry_after > now() THEN
      RETURN jsonb_build_object('ok', false, 'safe_error_code', 'CHANNEL_CIRCUIT_OPEN', 'retry_after', v_channel.retry_after);
    END IF;
    IF v_channel.circuit_probe_claimed_at IS NOT NULL
       AND v_channel.circuit_probe_claimed_at > now() - interval '3 minutes' THEN
      RETURN jsonb_build_object('ok', false, 'safe_error_code', 'CHANNEL_CIRCUIT_OPEN', 'retry_after', v_channel.retry_after);
    END IF;
    UPDATE automation_distribution_channels SET circuit_state = 'half_open',
      circuit_probe_claimed_at = now(), retry_after = NULL, updated_at = now()
     WHERE channel_key = v_draft.channel_key;
  ELSIF v_channel.circuit_state = 'half_open' THEN
    IF v_channel.circuit_probe_claimed_at IS NOT NULL
       AND v_channel.circuit_probe_claimed_at > now() - interval '3 minutes' THEN
      RETURN jsonb_build_object('ok', false, 'safe_error_code', 'CHANNEL_CIRCUIT_OPEN', 'retry_after', v_channel.circuit_probe_claimed_at + interval '3 minutes');
    END IF;
    UPDATE automation_distribution_channels SET circuit_probe_claimed_at = now(), updated_at = now()
     WHERE channel_key = v_draft.channel_key;
  ELSIF v_channel.retry_after IS NOT NULL AND v_channel.retry_after > now() THEN
    RETURN jsonb_build_object('ok', false, 'safe_error_code', 'CHANNEL_BACKOFF', 'retry_after', v_channel.retry_after);
  ELSE
    UPDATE automation_distribution_channels SET retry_after = NULL, updated_at = now()
     WHERE channel_key = v_draft.channel_key AND retry_after IS NOT NULL;
  END IF;

  SELECT COALESCE(delivery_attempts, 0) INTO v_today_count
    FROM automation_channel_usage_daily
   WHERE channel_key = v_draft.channel_key AND usage_day = v_usage_day FOR UPDATE;
  v_today_count := COALESCE(v_today_count, 0);
  IF v_channel.daily_free_quota IS NOT NULL AND v_today_count >= v_channel.daily_free_quota THEN
    v_probe_claimed_at := ((date_trunc('day', now() AT TIME ZONE 'Africa/Lagos') + interval '1 day') AT TIME ZONE 'Africa/Lagos');
    UPDATE automation_distribution_channels SET state = 'quota_exhausted', circuit_state = 'open',
      last_failure_class = 'quota', retry_after = v_probe_claimed_at,
      state_reason = 'The owner-set daily safety cap is exhausted. This channel is paused until the next Lagos day; the Daily Kit remains available.',
      quota_remaining = 0, updated_at = now()
     WHERE channel_key = v_draft.channel_key;
    INSERT INTO automation_distribution_failure_alerts (channel_key, usage_day, failure_class, safe_error_code)
    VALUES (v_draft.channel_key, v_usage_day, 'quota', 'PROVIDER_QUOTA') ON CONFLICT DO NOTHING;
    INSERT INTO automation_logs (event_code, status, entity_type, entity_id, details)
    VALUES ('DISTRIBUTION.CIRCUIT', 'blocked', 'distribution_draft', v_draft.id,
      jsonb_build_object('channel', v_draft.channel_key, 'failure_class', 'quota', 'error_code', 'PROVIDER_QUOTA'));
    RETURN jsonb_build_object('ok', false, 'safe_error_code', 'PROVIDER_QUOTA', 'retry_after', v_probe_claimed_at);
  END IF;

  INSERT INTO distribution_log (post_id, channel_key, idempotency_key, approved_payload_sha256, status, created_by)
  VALUES (v_draft.post_id, v_draft.channel_key, v_idempotency, v_checksum, 'approved', p_actor_id)
  ON CONFLICT (idempotency_key) DO NOTHING;
  SELECT * INTO v_log FROM distribution_log WHERE idempotency_key = v_idempotency FOR UPDATE;
  IF v_log.status = 'sent' THEN
    RETURN jsonb_build_object('ok', true, 'already_sent', true, 'remote_post_id', v_log.remote_post_id, 'log_id', v_log.id);
  END IF;
  IF v_log.status <> 'approved' THEN
    RETURN jsonb_build_object('ok', false, 'in_progress', v_log.status = 'dispatching', 'safe_error_code', 'DISTRIBUTION_ALREADY_ATTEMPTED');
  END IF;

  UPDATE distribution_log SET status = 'dispatching', usage_count = usage_count + 1, created_by = p_actor_id
   WHERE id = v_log.id;
  INSERT INTO automation_channel_usage_daily (channel_key, usage_day, delivery_attempts)
  VALUES (v_draft.channel_key, v_usage_day, 1)
  ON CONFLICT (channel_key, usage_day) DO UPDATE SET
    delivery_attempts = automation_channel_usage_daily.delivery_attempts + 1,
    updated_at = now();
  RETURN jsonb_build_object(
    'ok', true, 'already_sent', false, 'log_id', v_log.id,
    'draft_id', v_draft.id, 'post_id', v_draft.post_id, 'channel_key', v_draft.channel_key,
    'payload_sha256', v_checksum, 'payload', v_draft.payload, 'daily_cap', v_channel.daily_free_quota,
    'used_today', v_today_count + 1
  );
END $$;

CREATE OR REPLACE FUNCTION automation_complete_distribution_delivery(
  p_log_id bigint, p_status text, p_remote_post_id text DEFAULT NULL, p_safe_error_code text DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_log distribution_log%ROWTYPE;
  v_draft_id uuid;
  v_channel automation_distribution_channels%ROWTYPE;
  v_usage_day date := (now() AT TIME ZONE 'Africa/Lagos')::date;
  v_today_count integer := 0;
  v_failure_class text;
  v_failure_streak integer;
  v_retry_after timestamptz;
  v_delay_seconds integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF p_status NOT IN ('sent', 'failed', 'blocked', 'quota_exhausted')
     OR (p_status = 'sent' AND (p_remote_post_id IS NULL OR p_remote_post_id !~ '^[A-Za-z0-9._:-]{1,160}$'))
     OR (p_status <> 'sent' AND p_safe_error_code NOT IN (
       'PROVIDER_AUTH', 'PROVIDER_REVIEW_REQUIRED', 'PROVIDER_QUOTA',
       'PROVIDER_UNAVAILABLE', 'PROVIDER_UNEXPECTED', 'PROVIDER_NOT_CONFIGURED'
     )) THEN RAISE EXCEPTION 'Invalid provider delivery receipt'; END IF;
  SELECT * INTO v_log FROM distribution_log WHERE id = p_log_id FOR UPDATE;
  IF NOT FOUND OR v_log.status <> 'dispatching' THEN RETURN false; END IF;
  SELECT id INTO v_draft_id FROM automation_distribution_drafts
   WHERE post_id = v_log.post_id AND channel_key = v_log.channel_key
     AND approved_payload_sha256 = v_log.approved_payload_sha256;
  SELECT * INTO v_channel FROM automation_distribution_channels WHERE channel_key = v_log.channel_key FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Distribution channel is unavailable'; END IF;

  UPDATE distribution_log SET status = p_status,
    remote_post_id = CASE WHEN p_status = 'sent' THEN p_remote_post_id ELSE NULL END,
    safe_error_code = CASE WHEN p_status = 'sent' THEN NULL ELSE p_safe_error_code END,
    completed_at = now()
   WHERE id = p_log_id;
  IF p_status = 'sent' THEN
    UPDATE automation_channel_usage_daily SET delivery_successes = delivery_successes + 1, updated_at = now()
     WHERE channel_key = v_log.channel_key AND usage_day = v_usage_day;
    UPDATE automation_distribution_drafts SET review_status = 'sent', updated_at = now()
     WHERE id = v_draft_id;
    SELECT COALESCE(delivery_attempts, 0) INTO v_today_count FROM automation_channel_usage_daily
     WHERE channel_key = v_log.channel_key AND usage_day = v_usage_day;
    UPDATE automation_distribution_channels SET
      quota_remaining = CASE WHEN daily_free_quota IS NULL THEN NULL ELSE greatest(daily_free_quota - COALESCE(v_today_count, 0), 0) END,
      circuit_state = 'closed', failure_streak = 0, last_failure_class = NULL,
      retry_after = NULL, circuit_probe_claimed_at = NULL,
      state = CASE WHEN is_paused THEN 'paused'
        WHEN daily_free_quota IS NOT NULL AND daily_free_quota <= COALESCE(v_today_count, 0) THEN 'quota_exhausted'
        ELSE 'approval_required' END,
      state_reason = CASE WHEN is_paused THEN 'Paused by the owner.'
        WHEN daily_free_quota IS NOT NULL AND daily_free_quota <= COALESCE(v_today_count, 0) THEN 'The owner-set daily safety cap is exhausted; the Daily Kit remains available.'
        ELSE 'Provider receipt verified; a separate owner approval is required for each post.' END,
      updated_at = now()
     WHERE channel_key = v_log.channel_key;
  ELSE
    UPDATE automation_channel_usage_daily SET delivery_failures = delivery_failures + 1, updated_at = now()
     WHERE channel_key = v_log.channel_key AND usage_day = v_usage_day;
    v_failure_class := CASE
      WHEN p_safe_error_code = 'PROVIDER_QUOTA' THEN 'quota'
      WHEN p_safe_error_code IN ('PROVIDER_AUTH', 'PROVIDER_NOT_CONFIGURED') THEN 'authentication'
      WHEN p_safe_error_code IN ('PROVIDER_REVIEW_REQUIRED', 'PROVIDER_UNEXPECTED') THEN 'policy'
      ELSE 'transient' END;
    v_failure_streak := v_channel.failure_streak + 1;
    IF v_failure_class = 'quota' THEN
      v_retry_after := ((date_trunc('day', now() AT TIME ZONE 'Africa/Lagos') + interval '1 day') AT TIME ZONE 'Africa/Lagos');
    ELSIF v_failure_class IN ('authentication', 'policy') THEN
      v_retry_after := NULL;
    ELSE
      v_delay_seconds := ceil(LEAST(3600.0,
        30 * power(2.0, LEAST(v_failure_streak - 1, 7)) * (0.75 + random() * 0.5)))::integer;
      v_retry_after := now() + make_interval(secs => v_delay_seconds);
    END IF;
    UPDATE automation_distribution_channels SET
      failure_streak = v_failure_streak, last_failure_class = v_failure_class,
      retry_after = v_retry_after,
      circuit_state = CASE WHEN v_failure_class IN ('quota', 'authentication', 'policy') OR v_failure_streak >= 3 THEN 'open' ELSE 'closed' END,
      circuit_probe_claimed_at = NULL,
      state = CASE WHEN is_paused THEN 'paused'
        WHEN v_failure_class = 'quota' THEN 'quota_exhausted'
        WHEN v_failure_class IN ('authentication', 'policy') THEN 'blocked_by_provider_review'
        WHEN last_readback_status = 'connected' THEN 'approval_required' ELSE 'manual_kit' END,
      state_reason = CASE
        WHEN is_paused THEN 'Paused by the owner.'
        WHEN v_failure_class = 'quota' THEN 'The provider allowance or owner-set daily safety cap is exhausted. This channel is paused until the allowance resets; the Daily Kit remains available.'
        WHEN v_failure_class = 'authentication' THEN 'The provider rejected or could not verify credentials. This channel is paused until a fresh read-only check passes; the Daily Kit remains available.'
        WHEN v_failure_class = 'policy' THEN 'The platform requires account review, permission changes or policy attention. This channel is paused; the Daily Kit remains available.'
        WHEN v_failure_streak >= 3 THEN 'Repeated temporary provider failures opened this channel circuit. It is backing off; the Daily Kit remains available.'
        ELSE 'A temporary provider failure is backing off before a later owner-confirmed attempt; the Daily Kit remains available.' END,
      updated_at = now()
     WHERE channel_key = v_log.channel_key;
    IF v_failure_class IN ('quota', 'authentication', 'policy') OR v_failure_streak >= 3 THEN
      INSERT INTO automation_distribution_failure_alerts (channel_key, usage_day, failure_class, safe_error_code)
      VALUES (v_log.channel_key, v_usage_day, v_failure_class, p_safe_error_code)
      ON CONFLICT (channel_key, usage_day, failure_class) DO NOTHING;
    END IF;
  END IF;

  INSERT INTO automation_logs (event_code, status, entity_type, entity_id, details)
  VALUES ('DISTRIBUTION.DELIVERY', CASE WHEN p_status = 'sent' THEN 'succeeded' ELSE 'failed' END,
    'distribution', COALESCE(v_draft_id, v_log.post_id),
    jsonb_build_object('channel', v_log.channel_key, 'status', p_status,
      'remote_post_id', CASE WHEN p_status = 'sent' THEN p_remote_post_id ELSE NULL END,
      'error_code', p_safe_error_code, 'failure_class', v_failure_class));
  RETURN true;
END $$;

ALTER TABLE automation_channel_usage_daily
  ADD CONSTRAINT automation_channel_usage_test_counts
  CHECK (owner_test_email_successes + owner_test_email_failures <= owner_test_email_attempts);

CREATE OR REPLACE FUNCTION automation_claim_newsletter_test(
  p_actor_id uuid, p_draft_id uuid, p_expected_sha256 text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_draft automation_distribution_drafts%ROWTYPE;
  v_channel automation_distribution_channels%ROWTYPE;
  v_test distribution_test_log%ROWTYPE;
  v_checksum text;
  v_usage_day date := (now() AT TIME ZONE 'Africa/Lagos')::date;
  v_today_count integer := 0;
  v_next_day timestamptz;
  v_new_attempt boolean := false;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF p_actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM app_admins a WHERE a.user_id = p_actor_id AND a.status = 'active'
      AND (a.is_founder OR a.role = 'owner')
  ) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_draft FROM automation_distribution_drafts WHERE id = p_draft_id FOR UPDATE;
  IF NOT FOUND OR v_draft.channel_key <> 'newsletter' OR v_draft.review_status <> 'approved'
     OR v_draft.approved_at IS NULL THEN RAISE EXCEPTION 'A current owner-approved newsletter copy is required'; END IF;
  v_checksum := encode(extensions.digest(convert_to(v_draft.payload::text, 'UTF8'), 'sha256'), 'hex');
  IF p_expected_sha256 IS DISTINCT FROM v_checksum
     OR v_draft.payload_sha256 <> v_checksum OR v_draft.approved_payload_sha256 <> v_checksum THEN
    RAISE EXCEPTION 'The approved newsletter copy has changed';
  END IF;
  IF v_draft.payload->>'link' !~ '^https://lixxonstudio[.]com/blog/[a-z0-9]+(?:-[a-z0-9]+)*[?]utm_source=newsletter&utm_medium=email&utm_campaign=[a-z0-9-]+$' THEN
    RAISE EXCEPTION 'The approved newsletter link is invalid';
  END IF;
  SELECT * INTO v_channel FROM automation_distribution_channels WHERE channel_key = 'newsletter' FOR UPDATE;
  IF NOT FOUND OR v_channel.is_paused OR v_channel.state <> 'approval_required'
     OR v_channel.last_readback_status <> 'connected'
     OR v_channel.last_readback_at IS NULL OR v_channel.last_readback_at < now() - interval '24 hours' THEN
    RAISE EXCEPTION 'A fresh verified newsletter readback is required';
  END IF;
  IF v_channel.circuit_state = 'open' THEN
    IF v_channel.retry_after IS NULL OR v_channel.retry_after > now() THEN
      RETURN jsonb_build_object('ok', false, 'safe_error_code', 'CHANNEL_CIRCUIT_OPEN', 'retry_after', v_channel.retry_after);
    END IF;
    IF v_channel.circuit_probe_claimed_at IS NOT NULL
       AND v_channel.circuit_probe_claimed_at > now() - interval '3 minutes' THEN
      RETURN jsonb_build_object('ok', false, 'safe_error_code', 'CHANNEL_CIRCUIT_OPEN', 'retry_after', v_channel.circuit_probe_claimed_at + interval '3 minutes');
    END IF;
    UPDATE automation_distribution_channels SET circuit_state = 'half_open',
      circuit_probe_claimed_at = now(), retry_after = NULL, updated_at = now()
     WHERE channel_key = 'newsletter';
  ELSIF v_channel.circuit_state = 'half_open' THEN
    IF v_channel.circuit_probe_claimed_at IS NOT NULL
       AND v_channel.circuit_probe_claimed_at > now() - interval '3 minutes' THEN
      RETURN jsonb_build_object('ok', false, 'safe_error_code', 'CHANNEL_CIRCUIT_OPEN', 'retry_after', v_channel.circuit_probe_claimed_at + interval '3 minutes');
    END IF;
    UPDATE automation_distribution_channels SET circuit_probe_claimed_at = now(), updated_at = now()
     WHERE channel_key = 'newsletter';
  ELSIF v_channel.retry_after IS NOT NULL AND v_channel.retry_after > now() THEN
    RETURN jsonb_build_object('ok', false, 'safe_error_code', 'CHANNEL_BACKOFF', 'retry_after', v_channel.retry_after);
  END IF;

  SELECT COALESCE(owner_test_email_attempts, 0) INTO v_today_count
    FROM automation_channel_usage_daily
   WHERE channel_key = 'newsletter' AND usage_day = v_usage_day FOR UPDATE;
  v_today_count := COALESCE(v_today_count, 0);
  IF v_today_count >= 3 THEN
    v_next_day := ((date_trunc('day', now() AT TIME ZONE 'Africa/Lagos') + interval '1 day') AT TIME ZONE 'Africa/Lagos');
    UPDATE automation_distribution_channels SET state = 'quota_exhausted', circuit_state = 'open',
      last_failure_class = 'quota', retry_after = v_next_day,
      state_reason = 'The owner-only email test cap is exhausted. Testing is paused until the next Lagos day; the Daily Kit remains available.',
      updated_at = now() WHERE channel_key = 'newsletter';
    INSERT INTO automation_distribution_failure_alerts (channel_key, usage_day, failure_class, safe_error_code)
    VALUES ('newsletter', v_usage_day, 'quota', 'PROVIDER_QUOTA') ON CONFLICT DO NOTHING;
    RETURN jsonb_build_object('ok', false, 'safe_error_code', 'PROVIDER_QUOTA', 'retry_after', v_next_day);
  END IF;

  INSERT INTO distribution_test_log (draft_id, payload_sha256, actor_id, status)
  VALUES (v_draft.id, v_checksum, p_actor_id, 'dispatching')
  ON CONFLICT (draft_id, payload_sha256) DO NOTHING
  RETURNING * INTO v_test;
  v_new_attempt := FOUND;
  IF NOT v_new_attempt THEN
    SELECT * INTO v_test FROM distribution_test_log
     WHERE draft_id = v_draft.id AND payload_sha256 = v_checksum FOR UPDATE;
    IF v_test.status = 'sent' THEN
      RETURN jsonb_build_object('ok', true, 'already_sent', true, 'remote_email_id', v_test.remote_email_id);
    END IF;
    RETURN jsonb_build_object('ok', false, 'safe_error_code', 'DISTRIBUTION_ALREADY_ATTEMPTED');
  END IF;
  INSERT INTO automation_channel_usage_daily (channel_key, usage_day, owner_test_email_attempts)
  VALUES ('newsletter', v_usage_day, 1)
  ON CONFLICT (channel_key, usage_day) DO UPDATE SET
    owner_test_email_attempts = automation_channel_usage_daily.owner_test_email_attempts + 1,
    updated_at = now();
  RETURN jsonb_build_object(
    'ok', true, 'already_sent', false, 'test_id', v_test.id,
    'payload', v_draft.payload, 'payload_sha256', v_checksum
  );
END $$;

CREATE OR REPLACE FUNCTION automation_complete_newsletter_test(
  p_test_id bigint, p_status text, p_remote_email_id text DEFAULT NULL, p_safe_error_code text DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_test distribution_test_log%ROWTYPE;
  v_channel automation_distribution_channels%ROWTYPE;
  v_failure_class text;
  v_failure_streak integer;
  v_retry_after timestamptz;
  v_usage_day date;
  v_delay_seconds integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF p_status NOT IN ('sent', 'failed', 'blocked', 'quota_exhausted')
     OR (p_status = 'sent' AND (p_remote_email_id IS NULL OR p_remote_email_id !~ '^[A-Za-z0-9._:-]{1,160}$'))
     OR (p_status <> 'sent' AND p_safe_error_code NOT IN (
       'PROVIDER_AUTH', 'PROVIDER_REVIEW_REQUIRED', 'PROVIDER_QUOTA',
       'PROVIDER_UNAVAILABLE', 'PROVIDER_UNEXPECTED', 'PROVIDER_NOT_CONFIGURED'
     )) THEN RAISE EXCEPTION 'Invalid newsletter test receipt'; END IF;
  SELECT * INTO v_test FROM distribution_test_log WHERE id = p_test_id FOR UPDATE;
  IF NOT FOUND OR v_test.status <> 'dispatching' THEN RETURN false; END IF;
  v_usage_day := (v_test.created_at AT TIME ZONE 'Africa/Lagos')::date;
  SELECT * INTO v_channel FROM automation_distribution_channels WHERE channel_key = 'newsletter' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Newsletter channel is unavailable'; END IF;
  UPDATE distribution_test_log SET status = p_status,
    remote_email_id = CASE WHEN p_status = 'sent' THEN p_remote_email_id ELSE NULL END,
    safe_error_code = CASE WHEN p_status = 'sent' THEN NULL ELSE p_safe_error_code END,
    completed_at = now()
   WHERE id = p_test_id;

  IF p_status = 'sent' THEN
    UPDATE automation_channel_usage_daily SET owner_test_email_successes = owner_test_email_successes + 1,
      updated_at = now() WHERE channel_key = 'newsletter' AND usage_day = v_usage_day;
    UPDATE automation_distribution_channels SET circuit_state = 'closed', failure_streak = 0,
      last_failure_class = NULL, retry_after = NULL, circuit_probe_claimed_at = NULL,
      state = CASE WHEN is_paused THEN 'paused' ELSE 'approval_required' END,
      state_reason = CASE WHEN is_paused THEN 'Paused by the owner.'
        ELSE 'The confirmed owner-only test was accepted; subscriber campaigns remain disabled.' END,
      updated_at = now() WHERE channel_key = 'newsletter';
  ELSE
    UPDATE automation_channel_usage_daily SET owner_test_email_failures = owner_test_email_failures + 1,
      updated_at = now() WHERE channel_key = 'newsletter' AND usage_day = v_usage_day;
    v_failure_class := CASE
      WHEN p_safe_error_code = 'PROVIDER_QUOTA' THEN 'quota'
      WHEN p_safe_error_code IN ('PROVIDER_AUTH', 'PROVIDER_NOT_CONFIGURED') THEN 'authentication'
      WHEN p_safe_error_code IN ('PROVIDER_REVIEW_REQUIRED', 'PROVIDER_UNEXPECTED') THEN 'policy'
      ELSE 'transient' END;
    v_failure_streak := v_channel.failure_streak + 1;
    IF v_failure_class = 'quota' THEN
      v_retry_after := ((date_trunc('day', now() AT TIME ZONE 'Africa/Lagos') + interval '1 day') AT TIME ZONE 'Africa/Lagos');
    ELSIF v_failure_class IN ('authentication', 'policy') THEN
      v_retry_after := NULL;
    ELSE
      v_delay_seconds := ceil(LEAST(3600.0,
        30 * power(2.0, LEAST(v_failure_streak - 1, 7)) * (0.75 + random() * 0.5)))::integer;
      v_retry_after := now() + make_interval(secs => v_delay_seconds);
    END IF;
    UPDATE automation_distribution_channels SET failure_streak = v_failure_streak,
      last_failure_class = v_failure_class, retry_after = v_retry_after,
      circuit_state = CASE WHEN v_failure_class IN ('quota', 'authentication', 'policy') OR v_failure_streak >= 3 THEN 'open' ELSE 'closed' END,
      circuit_probe_claimed_at = NULL,
      state = CASE WHEN is_paused THEN 'paused'
        WHEN v_failure_class = 'quota' THEN 'quota_exhausted'
        WHEN v_failure_class IN ('authentication', 'policy') THEN 'blocked_by_provider_review'
        WHEN last_readback_status = 'connected' THEN 'approval_required' ELSE 'manual_kit' END,
      state_reason = CASE
        WHEN is_paused THEN 'Paused by the owner.'
        WHEN v_failure_class = 'quota' THEN 'The owner-only email test allowance is exhausted. Testing is paused until reset; the Daily Kit remains available.'
        WHEN v_failure_class = 'authentication' THEN 'The email provider rejected or could not verify credentials. This channel is paused until a fresh read-only check passes; the Daily Kit remains available.'
        WHEN v_failure_class = 'policy' THEN 'The email provider requires a verified sender or additional account approval. This channel is paused; the Daily Kit remains available.'
        WHEN v_failure_streak >= 3 THEN 'Repeated temporary email-provider failures opened this channel circuit. It is backing off; the Daily Kit remains available.'
        ELSE 'A temporary email-provider failure is backing off before a later owner-confirmed attempt; the Daily Kit remains available.' END,
      updated_at = now() WHERE channel_key = 'newsletter';
    IF v_failure_class IN ('quota', 'authentication', 'policy') OR v_failure_streak >= 3 THEN
      INSERT INTO automation_distribution_failure_alerts (channel_key, usage_day, failure_class, safe_error_code)
      VALUES ('newsletter', v_usage_day, v_failure_class, p_safe_error_code)
      ON CONFLICT (channel_key, usage_day, failure_class) DO NOTHING;
    END IF;
  END IF;
  INSERT INTO automation_logs (event_code, status, entity_type, entity_id, details)
  VALUES ('DISTRIBUTION.EMAIL_TEST', CASE WHEN p_status = 'sent' THEN 'succeeded' ELSE 'failed' END,
    'distribution_test', v_test.draft_id,
    jsonb_build_object('channel', 'newsletter', 'status', p_status,
      'remote_email_id', CASE WHEN p_status = 'sent' THEN p_remote_email_id ELSE NULL END,
      'error_code', p_safe_error_code, 'failure_class', v_failure_class));
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION automation_create_ab_variant(
  p_post_id uuid, p_channel_key text, p_variant_label text, p_hypothesis text,
  p_primary_metric text, p_guardrail_metric text, p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_hash text; v_id uuid;
BEGIN
  IF NOT automation_owner_authorized() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF p_hypothesis IS NULL OR length(btrim(p_hypothesis)) NOT BETWEEN 12 AND 500
     OR p_primary_metric NOT IN ('click_through_rate', 'engagement_rate', 'conversion_rate', 'save_rate', 'reply_rate')
     OR p_guardrail_metric NOT IN ('unsubscribe_rate', 'negative_feedback_rate', 'conversion_rate', 'engagement_rate')
     OR p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object'
     OR p_payload - ARRAY['title', 'subject', 'caption', 'hashtags', 'cta', 'link', 'image_url', 'image_alt'] <> '{}'::jsonb
     OR length(COALESCE(p_payload->>'caption', '')) NOT BETWEEN 1 AND 3000 THEN
    RAISE EXCEPTION 'An owner-approved variant needs a hypothesis, primary metric, guardrail metric and safe distribution copy';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM automation_distribution_drafts d
     WHERE d.post_id = p_post_id AND d.channel_key = p_channel_key
       AND d.review_status = 'approved' AND d.approved_at IS NOT NULL
  ) THEN RAISE EXCEPTION 'Approve the baseline distribution copy before creating an experiment'; END IF;
  v_hash := encode(extensions.digest(convert_to(p_payload::text, 'UTF8'), 'sha256'), 'hex');
  INSERT INTO ab_test_variants (post_id, channel_key, variant_label, hypothesis,
    primary_metric, guardrail_metric, payload, payload_sha256, status, approved_by, approved_at, created_by)
  VALUES (p_post_id, p_channel_key, p_variant_label, p_hypothesis,
    p_primary_metric, p_guardrail_metric, p_payload, v_hash, 'approved', auth.uid(), now(), auth.uid())
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('id', v_id, 'status', 'approved', 'approved_at', now(), 'payload_sha256', v_hash,
    'hypothesis', p_hypothesis, 'primary_metric', p_primary_metric, 'guardrail_metric', p_guardrail_metric);
END $$;

-- Add safe quota/circuit fields and aggregate metrics to the existing owner-only
-- snapshot without ever selecting posts.content.
ALTER FUNCTION public.automation_distribution_snapshot(uuid)
  RENAME TO automation_distribution_snapshot_phase31;
REVOKE ALL ON FUNCTION public.automation_distribution_snapshot_phase31(uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION automation_distribution_snapshot(p_post_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_result jsonb;
  v_channels jsonb;
  v_metrics jsonb;
  v_usage_day date := (now() AT TIME ZONE 'Africa/Lagos')::date;
BEGIN
  IF NOT admin_can('automation.check') THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  v_result := automation_distribution_snapshot_phase31(p_post_id);

  SELECT COALESCE(jsonb_agg(c.value || jsonb_build_object(
    'quota_remaining', CASE WHEN config.daily_free_quota IS NULL THEN config.quota_remaining
      ELSE greatest(config.daily_free_quota - COALESCE(usage.delivery_attempts, 0), 0) END,
    'circuit_state', config.circuit_state,
    'failure_streak', config.failure_streak,
    'last_failure_class', config.last_failure_class,
    'retry_after', config.retry_after,
    'usage_today', jsonb_build_object(
      'readback_attempts', COALESCE(usage.readback_attempts, 0),
      'delivery_attempts', COALESCE(usage.delivery_attempts, 0),
      'delivery_successes', COALESCE(usage.delivery_successes, 0),
      'delivery_failures', COALESCE(usage.delivery_failures, 0),
      'owner_test_email_attempts', COALESCE(usage.owner_test_email_attempts, 0),
      'usage_day', v_usage_day
    )
  ) ORDER BY c.value->>'channel_key'), '[]'::jsonb)
    INTO v_channels
    FROM jsonb_array_elements(v_result->'channels') AS c(value)
    JOIN automation_distribution_channels config ON config.channel_key = c.value->>'channel_key'
    LEFT JOIN automation_channel_usage_daily usage
      ON usage.channel_key = config.channel_key AND usage.usage_day = v_usage_day;

  SELECT COALESCE(jsonb_agg(metrics.row_value
    ORDER BY metrics.channel_key, metrics.metric_key, metrics.measurement_kind), '[]'::jsonb)
    INTO v_metrics
    FROM (
      SELECT sample.channel_key, sample.metric_key, sample.measurement_kind,
        jsonb_build_object(
          'channel_key', sample.channel_key,
          'metric_key', sample.metric_key,
          'value', CASE WHEN sample.metric_key LIKE '%_rate' THEN round(avg(sample.metric_value), 6)
                        ELSE sum(sample.metric_value) END,
          'measurement_kind', sample.measurement_kind,
          'collection_basis', sample.collection_basis,
          'period_start', min(sample.period_start),
          'period_end', max(sample.period_end),
          'sample_count', count(*),
          'variant_id', sample.variant_id
        ) AS row_value
      FROM distribution_metric_samples sample
      WHERE sample.post_id = p_post_id AND sample.period_end >= v_usage_day - 29
      GROUP BY sample.channel_key, sample.metric_key, sample.measurement_kind, sample.collection_basis, sample.variant_id
    ) metrics;

  RETURN v_result || jsonb_build_object('channels', v_channels, 'metrics', v_metrics);
END $$;

CREATE OR REPLACE FUNCTION automation_record_distribution_metric(
  p_post_id uuid, p_channel_key text, p_period_start date, p_period_end date,
  p_metric_key text, p_metric_value numeric, p_collection_basis text,
  p_consent_verified boolean DEFAULT false, p_variant_id uuid DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_kind text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF p_post_id IS NULL OR p_channel_key IS NULL
     OR p_period_start IS NULL OR p_period_end IS NULL
     OR p_period_start > p_period_end OR p_period_end > (now() AT TIME ZONE 'UTC')::date
     OR p_period_start < p_period_end - 30
     OR p_metric_key NOT IN (
       'reach', 'impressions', 'clicks', 'conversions', 'engagements', 'saves', 'replies',
       'unsubscribes', 'negative_feedback', 'click_through_rate', 'engagement_rate',
       'conversion_rate', 'save_rate', 'reply_rate', 'unsubscribe_rate', 'negative_feedback_rate'
     )
     OR p_metric_value IS NULL OR p_metric_value < 0 OR p_metric_value > 1000000000000
     OR (p_metric_key LIKE '%_rate' AND p_metric_value > 1)
     OR p_collection_basis NOT IN ('provider_aggregate', 'consented_site_aggregate', 'estimate')
     OR (p_collection_basis = 'consented_site_aggregate' AND p_consent_verified IS DISTINCT FROM true) THEN
    RAISE EXCEPTION 'Invalid aggregate measurement';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM posts p WHERE p.id = p_post_id AND p.status IN ('scheduled', 'published')
  ) THEN RAISE EXCEPTION 'An eligible article is required'; END IF;
  IF p_variant_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM ab_test_variants v WHERE v.id = p_variant_id AND v.post_id = p_post_id
      AND v.channel_key = p_channel_key AND v.status IN ('approved', 'active', 'completed')
      AND (v.primary_metric = p_metric_key OR v.guardrail_metric = p_metric_key)
      AND v.approved_at IS NOT NULL AND v.hypothesis IS NOT NULL
  ) THEN RAISE EXCEPTION 'The A/B metric must match an owner-approved experiment'; END IF;

  v_kind := CASE WHEN p_collection_basis = 'estimate' THEN 'estimated' ELSE 'measured' END;
  INSERT INTO distribution_metric_samples (
    post_id, channel_key, variant_id, period_start, period_end, metric_key,
    metric_value, measurement_kind, collection_basis, consent_verified
  ) VALUES (
    p_post_id, p_channel_key, p_variant_id, p_period_start, p_period_end, p_metric_key,
    p_metric_value, v_kind, p_collection_basis, COALESCE(p_consent_verified, false)
  ) ON CONFLICT (
    post_id, channel_key, (COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid)),
    period_start, period_end, metric_key, collection_basis
  ) DO UPDATE SET
    metric_value = EXCLUDED.metric_value,
    measurement_kind = EXCLUDED.measurement_kind,
    consent_verified = EXCLUDED.consent_verified,
    created_at = now();

  INSERT INTO automation_logs (event_code, status, entity_type, entity_id, details)
  VALUES ('DISTRIBUTION.METRIC', 'succeeded', 'distribution_metric', p_post_id,
    jsonb_build_object('channel', p_channel_key, 'metric', p_metric_key,
      'measurement_kind', v_kind, 'collection_basis', p_collection_basis,
      'period_start', p_period_start, 'period_end', p_period_end));
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION automation_claim_distribution_failure_alerts(p_limit integer DEFAULT 5)
RETURNS TABLE(alert_id bigint, channel_key text, failure_class text, safe_error_code text, attempt_count integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  WITH candidates AS (
    SELECT a.id FROM automation_distribution_failure_alerts a
     WHERE a.status = 'pending' AND a.attempt_count < 3
       AND (a.retry_after IS NULL OR a.retry_after <= now())
     ORDER BY a.created_at, a.id
     FOR UPDATE SKIP LOCKED
     LIMIT greatest(1, least(COALESCE(p_limit, 5), 10))
  ), claimed AS (
    UPDATE automation_distribution_failure_alerts a SET status = 'dispatching',
      attempt_count = a.attempt_count + 1, updated_at = now()
     FROM candidates c WHERE a.id = c.id
     RETURNING a.id, a.channel_key, a.failure_class, a.safe_error_code, a.attempt_count
  )
  SELECT claimed.id, claimed.channel_key, claimed.failure_class, claimed.safe_error_code, claimed.attempt_count
    FROM claimed;
END $$;

CREATE OR REPLACE FUNCTION automation_complete_distribution_failure_alert(
  p_alert_id bigint, p_status text, p_delivery_channel text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_alert automation_distribution_failure_alerts%ROWTYPE; v_delay integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF p_status NOT IN ('delivered', 'failed', 'blocked')
     OR p_delivery_channel NOT IN ('email', 'telegram', 'none') THEN
    RAISE EXCEPTION 'Invalid distribution alert result';
  END IF;
  SELECT * INTO v_alert FROM automation_distribution_failure_alerts WHERE id = p_alert_id FOR UPDATE;
  IF NOT FOUND OR v_alert.status <> 'dispatching' THEN RETURN false; END IF;
  v_delay := ceil(LEAST(86400.0, 60 * power(2.0, LEAST(v_alert.attempt_count - 1, 10)) * (0.75 + random() * 0.5)))::integer;
  UPDATE automation_distribution_failure_alerts SET
    status = CASE WHEN p_status = 'delivered' THEN 'delivered'
      WHEN p_status = 'blocked' OR attempt_count >= 3 THEN 'blocked' ELSE 'pending' END,
    delivery_channel = p_delivery_channel,
    retry_after = CASE WHEN p_status = 'failed' AND attempt_count < 3 THEN now() + make_interval(secs => v_delay) ELSE NULL END,
    delivered_at = CASE WHEN p_status = 'delivered' THEN now() ELSE NULL END,
    updated_at = now()
   WHERE id = p_alert_id;
  INSERT INTO automation_logs (event_code, status, entity_type, entity_id, details)
  VALUES ('DISTRIBUTION.ALERT', CASE WHEN p_status = 'delivered' THEN 'succeeded' ELSE 'blocked' END,
    'distribution_alert', NULL::uuid,
    jsonb_build_object('alert_id', p_alert_id, 'channel', v_alert.channel_key,
      'failure_class', v_alert.failure_class, 'delivery_channel', p_delivery_channel, 'status', p_status));
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION public.automation_distribution_snapshot(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.automation_distribution_snapshot(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.automation_distribution_snapshot_phase31(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.automation_record_channel_readback(text,text,text,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.automation_record_channel_readback(text,text,text,integer) TO service_role;
REVOKE ALL ON FUNCTION public.automation_set_distribution_pause(text,boolean) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.automation_set_distribution_pause(text,boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.automation_claim_distribution_delivery(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.automation_claim_distribution_delivery(uuid,uuid,text) TO service_role;
REVOKE ALL ON FUNCTION public.automation_complete_distribution_delivery(bigint,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.automation_complete_distribution_delivery(bigint,text,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.automation_create_ab_variant(uuid,text,text,text,text,text,jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.automation_create_ab_variant(uuid,text,text,text,text,text,jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.automation_record_distribution_metric(uuid,text,date,date,text,numeric,text,boolean,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.automation_record_distribution_metric(uuid,text,date,date,text,numeric,text,boolean,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.automation_claim_distribution_failure_alerts(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.automation_claim_distribution_failure_alerts(integer) TO service_role;
REVOKE ALL ON FUNCTION public.automation_complete_distribution_failure_alert(bigint,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.automation_complete_distribution_failure_alert(bigint,text,text) TO service_role;

NOTIFY pgrst, 'reload schema';
