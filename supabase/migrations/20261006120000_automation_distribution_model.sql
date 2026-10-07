-- Phase 3.1 — approval-first distribution model and Daily Kit.
-- Only owner-authored title/excerpt/tags/image metadata is copied into a
-- per-channel draft. Article prose in posts.content is never selected or changed.

DO $$
BEGIN
  IF to_regprocedure('extensions.digest(bytea,text)') IS NULL THEN
    IF to_regprocedure('public.digest(bytea,text)') IS NOT NULL THEN
      EXECUTE 'CREATE OR REPLACE FUNCTION extensions.digest(bytea,text) RETURNS bytea LANGUAGE sql IMMUTABLE STRICT SET search_path = pg_catalog, public AS $f$ SELECT public.digest($1,$2) $f$';
    ELSE
      CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
    END IF;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS automation_distribution_channels (
  channel_key text PRIMARY KEY CHECK (channel_key ~ '^[a-z][a-z0-9_]{0,31}$'),
  label text NOT NULL,
  state text NOT NULL DEFAULT 'manual_kit'
    CHECK (state IN ('connected', 'approval_required', 'manual_kit', 'paused',
                     'blocked_by_provider_review', 'quota_exhausted', 'not_configured')),
  state_reason text NOT NULL DEFAULT 'No verified provider readback is recorded; the manual kit is available.',
  approval_required boolean NOT NULL DEFAULT true CHECK (approval_required),
  auto_publish_enabled boolean NOT NULL DEFAULT false CHECK (NOT auto_publish_enabled),
  daily_free_quota integer CHECK (daily_free_quota IS NULL OR daily_free_quota >= 0),
  quota_remaining integer CHECK (quota_remaining IS NULL OR quota_remaining >= 0),
  last_readback_status text NOT NULL DEFAULT 'not_tested'
    CHECK (last_readback_status IN ('not_tested', 'connected', 'blocked_by_provider_review', 'quota_exhausted', 'not_configured', 'unavailable')),
  last_readback_at timestamptz,
  is_paused boolean NOT NULL DEFAULT false,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO automation_distribution_channels (channel_key, label) VALUES
  ('instagram', 'Instagram'),
  ('facebook', 'Facebook Pages'),
  ('youtube_shorts', 'YouTube Shorts'),
  ('tiktok', 'TikTok'),
  ('pinterest', 'Pinterest'),
  ('telegram', 'Telegram'),
  ('threads', 'Threads'),
  ('linkedin', 'LinkedIn'),
  ('x', 'X'),
  ('tumblr', 'Tumblr'),
  ('whatsapp', 'WhatsApp share / Business'),
  ('newsletter', 'Email newsletter'),
  ('site_widget', 'Lixxon Studio content widget')
ON CONFLICT (channel_key) DO UPDATE SET label = EXCLUDED.label;

-- Self-imposed protection only; this is not a claim about an account's provider quota.
UPDATE automation_distribution_channels SET daily_free_quota = 10, quota_remaining = 10
 WHERE channel_key = 'telegram' AND daily_free_quota IS NULL;

CREATE TABLE IF NOT EXISTS automation_distribution_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  channel_key text NOT NULL REFERENCES automation_distribution_channels(channel_key) ON DELETE RESTRICT,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
  review_status text NOT NULL DEFAULT 'pending'
    CHECK (review_status IN ('pending', 'approved', 'rejected', 'sent', 'paused')),
  approved_payload_sha256 text CHECK (approved_payload_sha256 IS NULL OR approved_payload_sha256 ~ '^[a-f0-9]{64}$'),
  approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (post_id, channel_key),
  CHECK ((review_status IN ('approved', 'sent') AND approved_payload_sha256 IS NOT NULL AND approved_at IS NOT NULL)
      OR (review_status NOT IN ('approved', 'sent') AND approved_payload_sha256 IS NULL))
);
CREATE INDEX IF NOT EXISTS automation_distribution_drafts_recent
  ON automation_distribution_drafts (review_status, updated_at DESC);

-- Append-only provider receipt/usage ledger; never stores payload text, keys,
-- provider response bodies, email addresses or customer data.
CREATE TABLE IF NOT EXISTS distribution_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  channel_key text NOT NULL REFERENCES automation_distribution_channels(channel_key) ON DELETE RESTRICT,
  idempotency_key text NOT NULL UNIQUE CHECK (idempotency_key ~ '^[a-f0-9-]{36}:[a-f0-9]{64}$'),
  approved_payload_sha256 text NOT NULL CHECK (approved_payload_sha256 ~ '^[a-f0-9]{64}$'),
  status text NOT NULL CHECK (status IN ('pending_approval', 'approved', 'dispatching', 'sent', 'manual_kit', 'failed', 'blocked', 'quota_exhausted', 'rejected')),
  remote_post_id text CHECK (remote_post_id IS NULL OR remote_post_id ~ '^[A-Za-z0-9._:-]{1,160}$'),
  remote_url text CHECK (remote_url IS NULL OR remote_url ~ '^https://[^[:space:]]{1,2048}$'),
  usage_count integer NOT NULL DEFAULT 0 CHECK (usage_count >= 0),
  safe_error_code text CHECK (safe_error_code IS NULL OR safe_error_code ~ '^[A-Z0-9_.:-]{1,64}$'),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS distribution_log_post_recent ON distribution_log (post_id, created_at DESC);
CREATE INDEX IF NOT EXISTS distribution_log_channel_recent ON distribution_log (channel_key, created_at DESC);

CREATE TABLE IF NOT EXISTS ab_test_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  channel_key text NOT NULL REFERENCES automation_distribution_channels(channel_key) ON DELETE RESTRICT,
  variant_label text NOT NULL CHECK (length(btrim(variant_label)) BETWEEN 1 AND 40),
  hypothesis text NOT NULL CHECK (length(btrim(hypothesis)) BETWEEN 12 AND 500),
  primary_metric text NOT NULL CHECK (primary_metric IN ('click_through_rate', 'engagement_rate', 'conversion_rate', 'save_rate', 'reply_rate')),
  guardrail_metric text NOT NULL CHECK (guardrail_metric IN ('unsubscribe_rate', 'negative_feedback_rate', 'conversion_rate', 'engagement_rate')),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'pending_approval'
    CHECK (status IN ('pending_approval', 'approved', 'active', 'completed', 'rejected', 'paused')),
  approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (post_id, channel_key, variant_label)
);

-- An approved email preview can be delivered only to the signed-in active
-- owner as a test. Store outcome/idempotency metadata, never the recipient.
CREATE TABLE IF NOT EXISTS distribution_test_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  draft_id uuid NOT NULL REFERENCES automation_distribution_drafts(id) ON DELETE CASCADE,
  payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
  actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('dispatching', 'sent', 'failed', 'blocked', 'quota_exhausted')),
  remote_email_id text CHECK (remote_email_id IS NULL OR remote_email_id ~ '^[A-Za-z0-9._:-]{1,160}$'),
  safe_error_code text CHECK (safe_error_code IS NULL OR safe_error_code ~ '^[A-Z0-9_.:-]{1,64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (draft_id, payload_sha256)
);
CREATE INDEX IF NOT EXISTS distribution_test_log_recent ON distribution_test_log (created_at DESC);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'automation_distribution_channels', 'automation_distribution_drafts',
    'distribution_log', 'ab_test_variants', 'distribution_test_log'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated, service_role', t);
  END LOOP;
END $$;

CREATE POLICY automation_distribution_channels_read ON automation_distribution_channels
  FOR SELECT TO authenticated USING (admin_can('automation.check'));
CREATE POLICY automation_distribution_drafts_read ON automation_distribution_drafts
  FOR SELECT TO authenticated USING (admin_can('automation.check'));
CREATE POLICY distribution_log_read ON distribution_log
  FOR SELECT TO authenticated USING (admin_can('automation.check'));
CREATE POLICY ab_test_variants_read ON ab_test_variants
  FOR SELECT TO authenticated USING (admin_can('automation.check'));
CREATE POLICY distribution_test_log_read ON distribution_test_log
  FOR SELECT TO authenticated USING (admin_can('automation.check'));
GRANT SELECT ON automation_distribution_channels, automation_distribution_drafts, distribution_log, ab_test_variants, distribution_test_log TO authenticated;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['automation_distribution_channels', 'automation_distribution_drafts', 'ab_test_variants', 'distribution_test_log'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', 'trg_dist_audit_' || t, t);
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.audit_admin_change()', 'trg_dist_audit_' || t, t);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION automation_distribution_snapshot(p_post_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_result jsonb;
BEGIN
  IF NOT admin_can('automation.check') THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF p_post_id IS NULL THEN RAISE EXCEPTION 'Article id is required'; END IF;

  SELECT jsonb_build_object(
    'post_id', p.id,
    'title', left(p.title, 200),
    'slug', p.slug,
    'status', p.status,
    'scheduled_at_utc', p.scheduled_at,
    'excerpt', left(COALESCE(p.excerpt, ''), 1000),
    'cover_image', CASE WHEN p.cover_image ~* '^https://[^[:space:]]+$' AND p.cover_image !~* '^https://[^/@]+:[^/@]*@' THEN p.cover_image ELSE NULL END,
    'cover_image_alt', left(COALESCE(p.cover_image_alt, ''), 500),
    'flags', jsonb_build_object(
      'automation.enabled', COALESCE((SELECT enabled FROM feature_flags WHERE flag_key = 'automation.enabled'), false),
      'automation.distribution', COALESCE((SELECT enabled FROM feature_flags WHERE flag_key = 'automation.distribution'), false)
    ),
    'channels', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'channel_key', c.channel_key,
        'label', c.label,
        'state', CASE WHEN c.is_paused THEN 'paused' ELSE c.state END,
        'state_reason', CASE WHEN c.is_paused THEN 'Paused by the owner.' ELSE c.state_reason END,
        'approval_required', c.approval_required,
        'auto_publish_enabled', c.auto_publish_enabled,
        'daily_free_quota', c.daily_free_quota,
        'quota_remaining', CASE WHEN c.channel_key = 'telegram' AND c.daily_free_quota IS NOT NULL THEN
          greatest(c.daily_free_quota - (
            SELECT count(*)::integer FROM distribution_log l
             WHERE l.channel_key = 'telegram' AND l.status = 'sent'
               AND l.completed_at >= date_trunc('day', now() AT TIME ZONE 'Africa/Lagos') AT TIME ZONE 'Africa/Lagos'
          ), 0) ELSE c.quota_remaining END,
        'last_readback_status', c.last_readback_status,
        'last_readback_at', c.last_readback_at,
        'draft', CASE WHEN d.id IS NULL THEN NULL ELSE jsonb_build_object(
          'id', d.id,
          'payload', d.payload,
          'payload_sha256', d.payload_sha256,
          'review_status', d.review_status,
          'approved_at', d.approved_at,
          'delivery', (
            SELECT jsonb_build_object(
              'status', l.status, 'remote_post_id', l.remote_post_id,
              'remote_url', l.remote_url, 'usage_count', l.usage_count,
              'safe_error_code', l.safe_error_code, 'created_at', l.created_at
            ) FROM distribution_log l
             WHERE l.post_id = p.id AND l.channel_key = c.channel_key
               AND l.approved_payload_sha256 = d.approved_payload_sha256
             ORDER BY l.id DESC LIMIT 1
          ),
          'test_delivery', CASE WHEN c.channel_key = 'newsletter' THEN (
            SELECT jsonb_build_object(
              'status', t.status, 'remote_email_id', t.remote_email_id,
              'safe_error_code', t.safe_error_code, 'created_at', t.created_at
            ) FROM distribution_test_log t
             WHERE t.draft_id = d.id AND t.payload_sha256 = d.approved_payload_sha256
             ORDER BY t.id DESC LIMIT 1
          ) ELSE NULL END
        ) END
      ) ORDER BY c.channel_key)
      FROM automation_distribution_channels c
      LEFT JOIN automation_distribution_drafts d ON d.post_id = p.id AND d.channel_key = c.channel_key
    ), '[]'::jsonb)
  ) INTO v_result
  FROM posts p
  WHERE p.id = p_post_id
    AND p.status IN ('scheduled', 'published')
    AND p.slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
    AND NULLIF(btrim(p.title), '') IS NOT NULL;
  IF v_result IS NULL THEN RAISE EXCEPTION 'A scheduled or published article is required'; END IF;
  RETURN v_result;
END $$;

-- Build a stable set of 13 owner-reviewed payloads from owner-entered title,
-- excerpt, tags and image metadata. Never select posts.content.
CREATE OR REPLACE FUNCTION automation_prepare_daily_kit(p_post_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_post record;
  v_excerpt text;
  v_tags text;
  v_link text;
  v_payload jsonb;
  v_channel record;
  v_caption text;
  v_checksum text;
BEGIN
  IF NOT automation_owner_authorized() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  SELECT p.id, p.title, p.slug, p.status, p.scheduled_at, p.excerpt,
         p.tags, p.cover_image, p.cover_image_alt
    INTO v_post FROM posts p
   WHERE p.id = p_post_id AND p.status IN ('scheduled', 'published')
     AND p.slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
     AND NULLIF(btrim(p.title), '') IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'A scheduled or published article is required'; END IF;
  v_excerpt := left(regexp_replace(regexp_replace(COALESCE(v_post.excerpt, ''), '<[^>]*>', ' ', 'g'), '[[:space:]]+', ' ', 'g'), 700);
  IF NULLIF(btrim(v_excerpt), '') IS NULL THEN RAISE EXCEPTION 'An owner-written excerpt is required before preparing a channel kit'; END IF;
  SELECT COALESCE(string_agg('#' || tag, ' ' ORDER BY ord), '') INTO v_tags
    FROM (
      SELECT safe.tag, safe.ord
      FROM (
        SELECT regexp_replace(lower(btrim(item)), '[^a-z0-9_]+', '', 'g') AS tag, ord
        FROM unnest(COALESCE(v_post.tags, ARRAY[]::text[])) WITH ORDINALITY AS t(item, ord)
      ) safe
      WHERE safe.tag <> ''
      ORDER BY safe.ord
      LIMIT 12
    ) safe_tags;

  FOR v_channel IN SELECT channel_key FROM automation_distribution_channels ORDER BY channel_key LOOP
    v_link := 'https://lixxonstudio.com/blog/' || v_post.slug || '?utm_source=' || v_channel.channel_key
      || '&utm_medium=' || CASE WHEN v_channel.channel_key = 'newsletter' THEN 'email' WHEN v_channel.channel_key = 'site_widget' THEN 'onsite' ELSE 'organic_social' END
      || '&utm_campaign=' || v_post.slug;
    v_caption := CASE v_channel.channel_key
      WHEN 'instagram' THEN v_post.title || E'\n\n' || v_excerpt || E'\n\nRead the full story: ' || v_link || CASE WHEN v_tags = '' THEN '' ELSE E'\n\n' || v_tags END
      WHEN 'facebook' THEN v_post.title || E'\n\n' || v_excerpt || E'\n\nContinue reading: ' || v_link
      WHEN 'youtube_shorts' THEN left(v_post.title, 100) || E'\n' || v_excerpt || E'\n\nFull article: ' || v_link
      WHEN 'tiktok' THEN v_post.title || E'\n' || v_excerpt || E'\n\nRead more: ' || v_link || CASE WHEN v_tags = '' THEN '' ELSE E'\n' || v_tags END
      WHEN 'pinterest' THEN v_excerpt || E'\n\nRead the full article: ' || v_link
      WHEN 'telegram' THEN v_post.title || E'\n\n' || v_excerpt || E'\n\n' || v_link
      WHEN 'threads' THEN v_post.title || E' — ' || v_excerpt || E'\n\n' || v_link
      WHEN 'linkedin' THEN v_post.title || E'\n\n' || v_excerpt || E'\n\nRead the article: ' || v_link
      WHEN 'x' THEN left(v_post.title || ' — ' || v_excerpt, 180) || ' ' || v_link
      WHEN 'tumblr' THEN v_post.title || E'\n\n' || v_excerpt || E'\n\n' || v_link
      WHEN 'whatsapp' THEN v_post.title || E'\n\n' || v_excerpt || E'\n\nShare only with people who have opted in: ' || v_link
      WHEN 'newsletter' THEN v_excerpt || E'\n\nRead the full article: ' || v_link
      ELSE v_post.title || E'\n\n' || v_excerpt || E'\n\n' || v_link
    END;
    v_payload := jsonb_build_object(
      'title', v_post.title,
      'subject', left(v_post.title, 180),
      'caption', left(v_caption, CASE WHEN v_channel.channel_key = 'x' THEN 280 ELSE 3000 END),
      'hashtags', COALESCE(to_jsonb(string_to_array(NULLIF(v_tags, ''), ' ')), '[]'::jsonb),
      'cta', 'Read the full owner-written article',
      'link', v_link,
      'image_url', CASE WHEN COALESCE(v_post.cover_image, '') ~* '^https://[^[:space:]]+$' AND COALESCE(v_post.cover_image, '') !~* '^https://[^/@]+:[^/@]*@' THEN v_post.cover_image ELSE NULL END,
      'image_alt', left(COALESCE(v_post.cover_image_alt, ''), 500)
    );
    v_checksum := encode(extensions.digest(convert_to(v_payload::text, 'UTF8'), 'sha256'), 'hex');
    INSERT INTO automation_distribution_drafts (
      post_id, channel_key, payload, payload_sha256, review_status, created_by, updated_by
    ) VALUES (
      v_post.id, v_channel.channel_key, v_payload, v_checksum, 'pending', auth.uid(), auth.uid()
    ) ON CONFLICT (post_id, channel_key) DO NOTHING;
  END LOOP;
  RETURN automation_distribution_snapshot(p_post_id);
END $$;

CREATE OR REPLACE FUNCTION automation_save_distribution_draft(p_draft_id uuid, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_draft automation_distribution_drafts%ROWTYPE;
  v_checksum text;
  v_key text;
BEGIN
  IF NOT automation_owner_authorized() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object'
     OR NOT (p_payload ?& ARRAY['title', 'subject', 'caption', 'hashtags', 'cta', 'link', 'image_url', 'image_alt'])
     OR p_payload ?| ARRAY['posts.content', 'content', 'article_body', 'secret', 'token', 'api_key']
     OR p_payload - ARRAY['title', 'subject', 'caption', 'hashtags', 'cta', 'link', 'image_url', 'image_alt'] <> '{}'::jsonb THEN
    RAISE EXCEPTION 'Distribution payload contains an unrecognized field';
  END IF;
  SELECT * INTO v_draft FROM automation_distribution_drafts WHERE id = p_draft_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Distribution draft not found'; END IF;
  IF v_draft.review_status = 'sent' THEN RAISE EXCEPTION 'A delivered draft cannot be edited'; END IF;
  FOR v_key IN SELECT jsonb_object_keys(p_payload) LOOP
    IF v_key IN ('title', 'subject', 'caption', 'cta', 'link', 'image_url', 'image_alt')
       AND jsonb_typeof(p_payload->v_key) NOT IN ('string', 'null') THEN
      RAISE EXCEPTION 'Invalid distribution field type';
    END IF;
  END LOOP;
  IF length(COALESCE(p_payload->>'title', '')) NOT BETWEEN 1 AND 200
     OR length(COALESCE(p_payload->>'subject', '')) NOT BETWEEN 1 AND 180
     OR length(COALESCE(p_payload->>'caption', '')) NOT BETWEEN 1 AND 3000
     OR length(COALESCE(p_payload->>'cta', '')) > 200
     OR p_payload->>'link' IS NULL
     OR p_payload->>'link' !~ '^https://lixxonstudio[.]com/blog/[a-z0-9]+(?:-[a-z0-9]+)*([?]utm_source=[a-z0-9_]+&utm_medium=(organic_social|email|onsite)&utm_campaign=[a-z0-9-]+)?$'
     OR (p_payload->>'image_url' IS NOT NULL AND (p_payload->>'image_url' !~ '^https://[^[:space:]]+$' OR p_payload->>'image_url' ~* '^https://[^/@]+:[^/@]*@'))
     OR length(COALESCE(p_payload->>'image_alt', '')) > 500
     OR jsonb_typeof(p_payload->'hashtags') <> 'array'
     OR jsonb_array_length(p_payload->'hashtags') > 12 THEN
    RAISE EXCEPTION 'Distribution payload failed validation';
  END IF;
  IF jsonb_typeof(p_payload->'hashtags') = 'array' AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_payload->'hashtags') AS h(value)
    WHERE jsonb_typeof(h.value) <> 'string' OR length(h.value #>> '{}') > 52 OR h.value #>> '{}' !~ '^#[A-Za-z0-9_]{1,50}$'
  ) THEN RAISE EXCEPTION 'Invalid distribution hashtag'; END IF;

  v_checksum := encode(extensions.digest(convert_to(p_payload::text, 'UTF8'), 'sha256'), 'hex');
  UPDATE automation_distribution_drafts SET payload = p_payload, payload_sha256 = v_checksum,
    review_status = 'pending', approved_payload_sha256 = NULL, approved_by = NULL, approved_at = NULL,
    updated_by = auth.uid(), updated_at = now()
   WHERE id = p_draft_id;
  INSERT INTO distribution_log (post_id, channel_key, idempotency_key, approved_payload_sha256, status, created_by)
  VALUES (v_draft.post_id, v_draft.channel_key, v_draft.id::text || ':' || v_checksum, v_checksum, 'pending_approval', auth.uid())
  ON CONFLICT (idempotency_key) DO NOTHING;
  RETURN jsonb_build_object('draft_id', p_draft_id, 'payload_sha256', v_checksum, 'review_status', 'pending');
END $$;

CREATE OR REPLACE FUNCTION automation_approve_distribution_draft(p_draft_id uuid, p_expected_sha256 text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_draft automation_distribution_drafts%ROWTYPE;
  v_checksum text;
BEGIN
  IF NOT automation_owner_authorized() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_draft FROM automation_distribution_drafts WHERE id = p_draft_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Distribution draft not found'; END IF;
  v_checksum := encode(extensions.digest(convert_to(v_draft.payload::text, 'UTF8'), 'sha256'), 'hex');
  IF v_checksum <> v_draft.payload_sha256 OR p_expected_sha256 IS DISTINCT FROM v_checksum THEN
    RAISE EXCEPTION 'Distribution copy changed; save and review the current version before approval';
  END IF;
  IF v_draft.review_status = 'sent' THEN RAISE EXCEPTION 'This distribution copy has already been delivered'; END IF;
  UPDATE automation_distribution_drafts SET review_status = 'approved',
    approved_payload_sha256 = v_checksum, approved_by = auth.uid(), approved_at = now(),
    updated_by = auth.uid(), updated_at = now()
   WHERE id = p_draft_id;
  INSERT INTO distribution_log (post_id, channel_key, idempotency_key, approved_payload_sha256, status, created_by)
  VALUES (v_draft.post_id, v_draft.channel_key, v_draft.id::text || ':' || v_checksum, v_checksum, 'approved', auth.uid())
  ON CONFLICT (idempotency_key) DO UPDATE SET status = 'approved', created_by = EXCLUDED.created_by;
  RETURN jsonb_build_object('draft_id', p_draft_id, 'payload_sha256', v_checksum, 'review_status', 'approved', 'side_effects', 0);
END $$;

CREATE OR REPLACE FUNCTION automation_reject_distribution_draft(p_draft_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_draft automation_distribution_drafts%ROWTYPE;
BEGIN
  IF NOT automation_owner_authorized() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_draft FROM automation_distribution_drafts WHERE id = p_draft_id FOR UPDATE;
  IF NOT FOUND OR v_draft.review_status = 'sent' THEN RETURN false; END IF;
  UPDATE automation_distribution_drafts SET review_status = 'rejected',
    approved_payload_sha256 = NULL, approved_by = NULL, approved_at = NULL,
    updated_by = auth.uid(), updated_at = now()
   WHERE id = p_draft_id;
  INSERT INTO distribution_log (post_id, channel_key, idempotency_key, approved_payload_sha256, status, created_by)
  VALUES (v_draft.post_id, v_draft.channel_key, v_draft.id::text || ':' || v_draft.payload_sha256, v_draft.payload_sha256, 'rejected', auth.uid())
  ON CONFLICT (idempotency_key) DO UPDATE SET status = 'rejected', created_by = EXCLUDED.created_by;
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION automation_set_distribution_pause(p_channel_key text, p_paused boolean)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT automation_owner_authorized() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  UPDATE automation_distribution_channels SET is_paused = COALESCE(p_paused, true),
    state = CASE WHEN COALESCE(p_paused, true) THEN 'paused'
      WHEN last_readback_status = 'connected' AND last_readback_at > now() - interval '24 hours' THEN 'approval_required'
      ELSE 'manual_kit' END,
    state_reason = CASE WHEN COALESCE(p_paused, true) THEN 'Paused by the owner.'
      WHEN last_readback_status = 'connected' AND last_readback_at > now() - interval '24 hours' THEN 'Recent provider readback is available; approval is still required.'
      ELSE 'No recent provider readback is recorded; use the owner-approved manual kit.' END,
    updated_by = auth.uid(), updated_at = now()
   WHERE channel_key = p_channel_key;
  RETURN FOUND;
END $$;

-- The Edge Function may record allow-listed readback evidence only after a
-- server-side provider call. Tokens and provider response bodies never enter SQL.
CREATE OR REPLACE FUNCTION automation_record_channel_readback(
  p_channel_key text, p_status text, p_safe_code text, p_quota_remaining integer DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF p_status NOT IN ('connected', 'blocked_by_provider_review', 'quota_exhausted', 'not_configured', 'unavailable')
     OR p_safe_code IS NULL OR p_safe_code NOT IN ('PROVIDER_READBACK_OK', 'PROVIDER_AUTH', 'PROVIDER_REVIEW_REQUIRED', 'PROVIDER_QUOTA', 'PROVIDER_UNAVAILABLE', 'PROVIDER_NOT_CONFIGURED', 'PROVIDER_UNEXPECTED')
     OR (p_quota_remaining IS NOT NULL AND p_quota_remaining < 0) THEN RAISE EXCEPTION 'Invalid channel readback'; END IF;
  UPDATE automation_distribution_channels SET last_readback_status = p_status,
    last_readback_at = now(), quota_remaining = CASE
      WHEN p_channel_key = 'telegram' AND automation_distribution_channels.daily_free_quota IS NOT NULL THEN
        greatest(automation_distribution_channels.daily_free_quota - (
          SELECT count(*)::integer FROM distribution_log
           WHERE channel_key = 'telegram' AND status = 'sent'
             AND completed_at >= date_trunc('day', now() AT TIME ZONE 'Africa/Lagos') AT TIME ZONE 'Africa/Lagos'
        ), 0)
      ELSE p_quota_remaining END,
    state = CASE WHEN is_paused THEN 'paused'
      WHEN p_status = 'connected' THEN 'approval_required'
      WHEN p_status = 'blocked_by_provider_review' THEN 'blocked_by_provider_review'
      WHEN p_status = 'quota_exhausted' THEN 'quota_exhausted'
      WHEN p_status = 'not_configured' THEN 'not_configured'
      ELSE 'manual_kit' END,
    state_reason = CASE WHEN is_paused THEN 'Paused by the owner.'
      WHEN p_status = 'connected' THEN 'Provider readback passed; owner approval is still required for each distribution.'
      WHEN p_status = 'blocked_by_provider_review' THEN 'The provider requires app review, account approval or additional scopes.'
      WHEN p_status = 'quota_exhausted' THEN 'The measured free quota is exhausted; the manual kit remains available.'
      WHEN p_status = 'not_configured' THEN 'No provider credential is configured; use the manual kit.'
      ELSE 'Provider readback failed safely; use the manual kit and review the safe status code.' END,
    updated_at = now()
   WHERE channel_key = p_channel_key;
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO automation_logs (event_code, status, entity_type, details)
  VALUES ('CHANNEL.READBACK', CASE WHEN p_status = 'connected' THEN 'succeeded' ELSE 'blocked' END,
    'distribution_channel', jsonb_build_object('channel', p_channel_key, 'error_code', p_safe_code));
  RETURN true;
END $$;

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
  v_day_start timestamptz;
  v_today_count integer;
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
  v_day_start := date_trunc('day', now() AT TIME ZONE 'Africa/Lagos') AT TIME ZONE 'Africa/Lagos';
  SELECT count(*)::integer INTO v_today_count FROM distribution_test_log WHERE created_at >= v_day_start;
  IF v_today_count >= 3 THEN RETURN jsonb_build_object('ok', false, 'safe_error_code', 'PROVIDER_QUOTA'); END IF;

  INSERT INTO distribution_test_log (draft_id, payload_sha256, actor_id, status)
  VALUES (v_draft.id, v_checksum, p_actor_id, 'dispatching')
  ON CONFLICT (draft_id, payload_sha256) DO NOTHING;
  SELECT * INTO v_test FROM distribution_test_log
   WHERE draft_id = v_draft.id AND payload_sha256 = v_checksum FOR UPDATE;
  IF v_test.status = 'sent' THEN
    RETURN jsonb_build_object('ok', true, 'already_sent', true, 'remote_email_id', v_test.remote_email_id);
  END IF;
  IF v_test.status <> 'dispatching' OR v_test.actor_id <> p_actor_id THEN
    RETURN jsonb_build_object('ok', false, 'safe_error_code', 'DISTRIBUTION_ALREADY_ATTEMPTED');
  END IF;
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
DECLARE v_test distribution_test_log%ROWTYPE;
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
  UPDATE distribution_test_log SET status = p_status,
    remote_email_id = CASE WHEN p_status = 'sent' THEN p_remote_email_id ELSE NULL END,
    safe_error_code = CASE WHEN p_status = 'sent' THEN NULL ELSE p_safe_error_code END,
    completed_at = now()
   WHERE id = p_test_id;
  INSERT INTO automation_logs (event_code, status, entity_type, entity_id, details)
  VALUES ('DISTRIBUTION.EMAIL_TEST', CASE WHEN p_status = 'sent' THEN 'succeeded' ELSE 'failed' END,
    'distribution_test', v_test.draft_id,
    jsonb_build_object('channel', 'newsletter', 'status', p_status,
      'remote_email_id', CASE WHEN p_status = 'sent' THEN p_remote_email_id ELSE NULL END,
      'error_code', p_safe_error_code));
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
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object'
     OR p_payload - ARRAY['title', 'subject', 'caption', 'hashtags', 'cta', 'link', 'image_url', 'image_alt'] <> '{}'::jsonb
     OR length(COALESCE(p_payload->>'caption', '')) NOT BETWEEN 1 AND 3000 THEN
    RAISE EXCEPTION 'Variant payload is invalid';
  END IF;
  v_hash := encode(extensions.digest(convert_to(p_payload::text, 'UTF8'), 'sha256'), 'hex');
  INSERT INTO ab_test_variants (post_id, channel_key, variant_label, hypothesis,
    primary_metric, guardrail_metric, payload, payload_sha256, created_by)
  VALUES (p_post_id, p_channel_key, p_variant_label, p_hypothesis,
    p_primary_metric, p_guardrail_metric, p_payload, v_hash, auth.uid())
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('id', v_id, 'status', 'pending_approval', 'payload_sha256', v_hash);
END $$;

CREATE OR REPLACE FUNCTION automation_distribution_articles()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_articles jsonb;
BEGIN
  IF NOT admin_can('automation.check') THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', p.id, 'title', left(p.title, 200), 'slug', p.slug,
    'status', p.status, 'scheduled_at_utc', p.scheduled_at
  ) ORDER BY p.scheduled_at DESC NULLS LAST, p.updated_at DESC), '[]'::jsonb)
    INTO v_articles
    FROM (SELECT id, title, slug, status, scheduled_at, updated_at
          FROM posts WHERE status IN ('scheduled', 'published')
            AND slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
          ORDER BY scheduled_at DESC NULLS LAST, updated_at DESC LIMIT 50) p;
  RETURN jsonb_build_object('articles', v_articles);
END $$;

CREATE OR REPLACE FUNCTION automation_distribution_owner_check()
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT automation_owner_authorized() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  RETURN true;
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
  v_wat_start timestamptz;
  v_today_count integer;
  v_post_slug text;
  v_expected_link text;
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

  v_wat_start := date_trunc('day', now() AT TIME ZONE 'Africa/Lagos') AT TIME ZONE 'Africa/Lagos';
  SELECT count(*)::integer INTO v_today_count FROM distribution_log
   WHERE channel_key = 'telegram' AND status = 'sent' AND completed_at >= v_wat_start;
  IF v_channel.daily_free_quota IS NOT NULL AND v_today_count >= v_channel.daily_free_quota THEN
    UPDATE automation_distribution_channels SET state = 'quota_exhausted', quota_remaining = 0,
      state_reason = 'The owner-set daily safety cap is exhausted; the manual kit remains available.', updated_at = now()
     WHERE channel_key = 'telegram';
    RETURN jsonb_build_object('ok', false, 'safe_error_code', 'PROVIDER_QUOTA');
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
  RETURN jsonb_build_object(
    'ok', true, 'already_sent', false, 'log_id', v_log.id,
    'draft_id', v_draft.id, 'post_id', v_draft.post_id, 'channel_key', v_draft.channel_key,
    'payload_sha256', v_checksum, 'payload', v_draft.payload, 'daily_cap', v_channel.daily_free_quota,
    'used_today', v_today_count
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
  v_today_count integer;
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
  UPDATE distribution_log SET status = p_status,
    remote_post_id = CASE WHEN p_status = 'sent' THEN p_remote_post_id ELSE NULL END,
    safe_error_code = CASE WHEN p_status = 'sent' THEN NULL ELSE p_safe_error_code END,
    completed_at = now()
   WHERE id = p_log_id;
  IF p_status = 'sent' THEN
    UPDATE automation_distribution_drafts SET review_status = 'sent', updated_at = now()
     WHERE id = v_draft_id;
    SELECT count(*)::integer INTO v_today_count FROM distribution_log
     WHERE channel_key = v_log.channel_key AND status = 'sent'
       AND completed_at >= date_trunc('day', now() AT TIME ZONE 'Africa/Lagos') AT TIME ZONE 'Africa/Lagos';
    UPDATE automation_distribution_channels SET quota_remaining = CASE
      WHEN daily_free_quota IS NULL THEN NULL ELSE greatest(daily_free_quota - v_today_count, 0) END,
      state = CASE WHEN daily_free_quota IS NOT NULL AND daily_free_quota <= v_today_count THEN 'quota_exhausted'
                   WHEN is_paused THEN 'paused' ELSE 'approval_required' END,
      state_reason = CASE WHEN daily_free_quota IS NOT NULL AND daily_free_quota <= v_today_count THEN 'The owner-set daily safety cap is exhausted; the manual kit remains available.'
                          WHEN is_paused THEN 'Paused by the owner.' ELSE 'Provider receipt verified; a separate owner approval is required for each post.' END,
      updated_at = now()
     WHERE channel_key = v_log.channel_key;
  END IF;
  INSERT INTO automation_logs (event_code, status, entity_type, entity_id, details)
  VALUES ('DISTRIBUTION.DELIVERY', CASE WHEN p_status = 'sent' THEN 'succeeded' ELSE 'failed' END,
    'distribution', COALESCE(v_draft_id, v_log.post_id),
    jsonb_build_object('channel', v_log.channel_key, 'status', p_status,
      'remote_post_id', CASE WHEN p_status = 'sent' THEN p_remote_post_id ELSE NULL END,
      'error_code', p_safe_error_code));
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION automation_distribution_owner_check() FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION automation_claim_distribution_delivery(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION automation_claim_newsletter_test(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION automation_complete_newsletter_test(bigint, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION automation_complete_distribution_delivery(bigint, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION automation_distribution_owner_check() TO authenticated;
GRANT EXECUTE ON FUNCTION automation_claim_distribution_delivery(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION automation_claim_newsletter_test(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION automation_complete_newsletter_test(bigint, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION automation_complete_distribution_delivery(bigint, text, text, text) TO service_role;
REVOKE ALL ON FUNCTION automation_distribution_articles() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION automation_distribution_articles() TO authenticated;
REVOKE ALL ON FUNCTION automation_distribution_snapshot(uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION automation_prepare_daily_kit(uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION automation_save_distribution_draft(uuid, jsonb) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION automation_approve_distribution_draft(uuid, text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION automation_reject_distribution_draft(uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION automation_set_distribution_pause(text, boolean) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION automation_record_channel_readback(text, text, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION automation_create_ab_variant(uuid, text, text, text, text, text, jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION automation_distribution_snapshot(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION automation_prepare_daily_kit(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION automation_save_distribution_draft(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION automation_approve_distribution_draft(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION automation_reject_distribution_draft(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION automation_set_distribution_pause(text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION automation_record_channel_readback(text, text, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION automation_create_ab_variant(uuid, text, text, text, text, text, jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
