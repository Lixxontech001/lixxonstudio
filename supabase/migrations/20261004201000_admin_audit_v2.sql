/*
# M5 · Audit trail v2 — who, what, before and after

The v1 trigger wrote one line per change ("Row updated") with no diff, no actor id, no
request context, and it only covered ten tables. This migration turns it into a real
ledger an owner can investigate and undo:

* `admin_activity_log` gains actor id/role, before/after snapshots, a per-column
  `changes` diff, IP + user agent (from the PostgREST `request.headers` GUC), severity,
  a human label and revert bookkeeping.
* `audit_admin_change()` is rewritten: only changed columns are stored, no-op updates
  are not logged, and the trigger set expands to ~35 admin-managed tables.
* `admin_audit_search()` — filtered, paginated, JSON (single round trip for the panel).
* `admin_audit_revert()` — undoes a recorded INSERT/UPDATE/DELETE on an allow-listed
  table, refuses when the row changed since, and writes its own audit entry.
* `admin_prune_audit()` + a monthly pg_cron job keep the log inside the free tier.
*/

-- =====================================================================
-- 1. RICHER LOG
-- =====================================================================
ALTER TABLE admin_activity_log ADD COLUMN IF NOT EXISTS actor_id uuid;
ALTER TABLE admin_activity_log ADD COLUMN IF NOT EXISTS actor_email text;
ALTER TABLE admin_activity_log ADD COLUMN IF NOT EXISTS actor_role text;
ALTER TABLE admin_activity_log ADD COLUMN IF NOT EXISTS entity_label text;
ALTER TABLE admin_activity_log ADD COLUMN IF NOT EXISTS before jsonb;
ALTER TABLE admin_activity_log ADD COLUMN IF NOT EXISTS after jsonb;
ALTER TABLE admin_activity_log ADD COLUMN IF NOT EXISTS changes jsonb;
ALTER TABLE admin_activity_log ADD COLUMN IF NOT EXISTS ip text;
ALTER TABLE admin_activity_log ADD COLUMN IF NOT EXISTS user_agent text;
ALTER TABLE admin_activity_log ADD COLUMN IF NOT EXISTS severity text NOT NULL DEFAULT 'info';
ALTER TABLE admin_activity_log ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'trigger';
ALTER TABLE admin_activity_log ADD COLUMN IF NOT EXISTS reverted_at timestamptz;
ALTER TABLE admin_activity_log ADD COLUMN IF NOT EXISTS reverted_by uuid;
ALTER TABLE admin_activity_log ADD COLUMN IF NOT EXISTS revert_of uuid;
-- monotonic ordering: rows written in the same transaction share now(), seq does not
ALTER TABLE admin_activity_log ADD COLUMN IF NOT EXISTS seq bigserial;

ALTER TABLE admin_activity_log DROP CONSTRAINT IF EXISTS admin_activity_log_severity_check;
ALTER TABLE admin_activity_log ADD CONSTRAINT admin_activity_log_severity_check
  CHECK (severity IN ('info', 'warning', 'critical'));

CREATE INDEX IF NOT EXISTS admin_activity_log_created_idx ON admin_activity_log (created_at DESC, seq DESC);
CREATE INDEX IF NOT EXISTS admin_activity_log_entity_idx ON admin_activity_log (entity_type, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_activity_log_actor_idx ON admin_activity_log (actor_email, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_activity_log_severity_idx ON admin_activity_log (severity, created_at DESC);

-- =====================================================================
-- 2. THE TRIGGER
-- =====================================================================
CREATE OR REPLACE FUNCTION audit_admin_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  oldj jsonb; newj jsonb; changes jsonb := '{}'::jsonb;
  rowj jsonb; k text;
  sev text := 'info';
  hdrs jsonb;
  v_ip text; v_ua text;
  v_actor_id uuid := auth.uid();
  v_email text := COALESCE(auth.jwt() ->> 'email', '');
  v_role text;
  v_label text;
BEGIN
  -- Community tables: only log a moderation decision, never the reader's own pending insert.
  IF TG_OP = 'INSERT' AND TG_TABLE_NAME IN ('comments', 'product_reviews', 'article_questions') THEN
    IF NOT COALESCE((to_jsonb(NEW) ->> 'is_approved')::boolean,
                    (to_jsonb(NEW) ->> 'is_public')::boolean, false) THEN
      RETURN NULL;
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    newj := to_jsonb(NEW);
    changes := newj;
  ELSIF TG_OP = 'DELETE' THEN
    oldj := to_jsonb(OLD);
    changes := oldj;
  ELSE
    oldj := to_jsonb(OLD); newj := to_jsonb(NEW);
    FOR k IN SELECT jsonb_object_keys(newj) LOOP
      IF oldj -> k IS DISTINCT FROM newj -> k THEN
        changes := changes || jsonb_build_object(k, jsonb_build_object('from', oldj -> k, 'to', newj -> k));
      END IF;
    END LOOP;
    IF changes = '{}'::jsonb THEN RETURN NULL; END IF;   -- no-op save: no noise
  END IF;

  rowj := COALESCE(newj, oldj);

  -- Severity: configuration and money first, ordinary content last.
  IF TG_TABLE_NAME IN ('app_admins', 'admin_roles', 'role_permissions', 'admin_permission_overrides',
                       'site_settings', 'gift_cards', 'promo_codes') THEN
    sev := 'critical';
  ELSIF TG_TABLE_NAME IN ('orders', 'order_items', 'refund_requests', 'download_entitlements',
                          'customers', 'products', 'email_queue') THEN
    sev := 'warning';
  END IF;
  IF TG_TABLE_NAME = 'posts' AND changes ? 'status' THEN sev := 'warning'; END IF;

  BEGIN
    v_role := (SELECT role FROM app_admins WHERE user_id = v_actor_id);
  EXCEPTION WHEN others THEN v_role := NULL;
  END;

  BEGIN
    hdrs := COALESCE(NULLIF(current_setting('request.headers', true), ''), '{}')::jsonb;
    v_ip := COALESCE(split_part(hdrs ->> 'x-forwarded-for', ',', 1), hdrs ->> 'cf-connecting-ip', hdrs ->> 'x-real-ip');
    v_ip := NULLIF(trim(COALESCE(v_ip, '')), '');
    v_ua := NULLIF(left(COALESCE(hdrs ->> 'user-agent', ''), 300), '');
  EXCEPTION WHEN others THEN
    v_ip := NULL; v_ua := NULL;
  END;

  -- a human label so the log reads like a sentence
  v_label := NULLIF(trim(COALESCE(
    rowj ->> 'title', rowj ->> 'name', rowj ->> 'order_number', rowj ->> 'code',
    rowj ->> 'plain_email', rowj ->> 'email', rowj ->> 'slug', rowj ->> 'key',
    rowj ->> 'query', rowj ->> 'subject', rowj ->> 'url'
  )), '');

  INSERT INTO admin_activity_log (
    action, entity_type, entity_id, entity_label, description,
    performed_by, actor_id, actor_email, actor_role,
    before, after, changes, ip, user_agent, severity, source
  ) VALUES (
    lower(TG_OP),
    TG_TABLE_NAME,
    COALESCE(rowj ->> 'id', rowj ->> 'key', rowj ->> 'user_id', ''),
    v_label,
    CASE TG_OP
      WHEN 'INSERT' THEN 'Created ' || TG_TABLE_NAME
      WHEN 'UPDATE' THEN 'Updated ' || TG_TABLE_NAME
      ELSE 'Deleted ' || TG_TABLE_NAME
    END || CASE WHEN v_label IS NULL THEN '' ELSE ': ' || v_label END,
    COALESCE(NULLIF(v_email, ''), current_setting('request.jwt.claim.role', true), 'system'),
    v_actor_id,
    NULLIF(v_email, ''),
    v_role,
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN oldj END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN newj END,
    changes,
    v_ip, v_ua, sev, 'trigger'
  );
  RETURN NULL;
END $$;

-- Expand coverage: the config/commerce/editorial tables an owner cares about.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'posts','products','promo_codes','gift_cards','orders','order_items','order_notes',
    'collections','collection_items','categories','authors','site_settings','app_admins',
    'admin_roles','role_permissions','admin_permission_overrides','glossary_terms',
    'article_series','featured_slots','content_templates','refund_requests','email_queue',
    'newsletter_subscribers','newsletter_preferences','sponsored_content','article_polls',
    'media','customers','download_entitlements','shop_categories','product_bundles',
    'currency_rates','comment_reports','contact_messages','user_feedback','product_reviews',
    'comments','article_questions','search_synonyms','headline_variants','social_shares',
    'product_notifications','abandoned_carts'
  ]
  LOOP
    CONTINUE WHEN to_regclass('public.' || t) IS NULL;
    EXECUTE format('DROP TRIGGER IF EXISTS trg_audit_%s ON public.%I', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_audit_%s AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION audit_admin_change()',
      t, t);
  END LOOP;
END $$;

-- =====================================================================
-- 3. SEARCH
-- =====================================================================
CREATE OR REPLACE FUNCTION admin_audit_search(p_filters jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE((p_filters ->> 'limit')::int, 50), 1), 200);
  v_offset integer := GREATEST(COALESCE((p_filters ->> 'offset')::int, 0), 0);
  v_from timestamptz := NULLIF(p_filters ->> 'from', '')::timestamptz;
  v_to timestamptz := NULLIF(p_filters ->> 'to', '')::timestamptz;
  v_q text := NULLIF(trim(COALESCE(p_filters ->> 'q', '')), '');
  v_rows jsonb;
  v_total bigint;
BEGIN
  IF NOT (admin_can('audit.read') OR admin_can('team.manage')) THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT count(*) INTO v_total
  FROM admin_activity_log l
  WHERE (NULLIF(p_filters ->> 'entity_type', '') IS NULL OR l.entity_type = p_filters ->> 'entity_type')
    AND (NULLIF(p_filters ->> 'action', '') IS NULL OR l.action = p_filters ->> 'action')
    AND (NULLIF(p_filters ->> 'severity', '') IS NULL OR l.severity = p_filters ->> 'severity')
    AND (NULLIF(p_filters ->> 'actor', '') IS NULL OR l.actor_email ILIKE '%' || (p_filters ->> 'actor') || '%')
    AND (v_from IS NULL OR l.created_at >= v_from)
    AND (v_to IS NULL OR l.created_at <= v_to)
    AND (v_q IS NULL OR l.description ILIKE '%' || v_q || '%' OR l.entity_id ILIKE '%' || v_q || '%'
         OR l.entity_label ILIKE '%' || v_q || '%' OR l.changes::text ILIKE '%' || v_q || '%');

  SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.seq DESC), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT l.id, l.action, l.entity_type, l.entity_id, l.entity_label, l.description,
           l.performed_by, l.actor_id, l.actor_email, l.actor_role, l.changes, l.ip,
           l.severity, l.source, l.created_at, l.reverted_at, l.reverted_by, l.revert_of,
           l.seq,
           jsonb_array_length(COALESCE(jsonb_path_query_array(COALESCE(l.changes, '{}'::jsonb), '$.*'), '[]'::jsonb)) AS change_count
    FROM admin_activity_log l
    WHERE (NULLIF(p_filters ->> 'entity_type', '') IS NULL OR l.entity_type = p_filters ->> 'entity_type')
      AND (NULLIF(p_filters ->> 'action', '') IS NULL OR l.action = p_filters ->> 'action')
      AND (NULLIF(p_filters ->> 'severity', '') IS NULL OR l.severity = p_filters ->> 'severity')
      AND (NULLIF(p_filters ->> 'actor', '') IS NULL OR l.actor_email ILIKE '%' || (p_filters ->> 'actor') || '%')
      AND (v_from IS NULL OR l.created_at >= v_from)
      AND (v_to IS NULL OR l.created_at <= v_to)
      AND (v_q IS NULL OR l.description ILIKE '%' || v_q || '%' OR l.entity_id ILIKE '%' || v_q || '%'
           OR l.entity_label ILIKE '%' || v_q || '%' OR l.changes::text ILIKE '%' || v_q || '%')
    ORDER BY l.seq DESC
    LIMIT v_limit OFFSET v_offset
  ) x;

  RETURN jsonb_build_object(
    'rows', v_rows, 'total', v_total, 'limit', v_limit, 'offset', v_offset,
    'entities', COALESCE((SELECT jsonb_agg(DISTINCT entity_type) FROM admin_activity_log WHERE entity_type IS NOT NULL), '[]'::jsonb),
    'actors', COALESCE((SELECT jsonb_agg(DISTINCT actor_email) FROM admin_activity_log WHERE actor_email IS NOT NULL), '[]'::jsonb)
  );
END $$;

CREATE OR REPLACE FUNCTION admin_audit_entry(p_log_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN NOT (admin_can('audit.read') OR admin_can('team.manage')) THEN NULL ELSE
    (SELECT to_jsonb(l) FROM admin_activity_log l WHERE l.id = p_log_id) END;
$$;

-- =====================================================================
-- 4. REVERT (undo)
-- =====================================================================
-- Rows are reconstructed with jsonb_populate_record, so the revert can never invent
-- columns: only the recorded columns are written back.
CREATE OR REPLACE FUNCTION admin_audit_revert(p_log_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  entry admin_activity_log;
  cols text;
  t text;
  n integer;
  acted timestamptz;
BEGIN
  IF NOT admin_can('audit.revert') THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT * INTO entry FROM admin_activity_log WHERE id = p_log_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Audit entry not found'; END IF;
  IF entry.reverted_at IS NOT NULL THEN RAISE EXCEPTION 'That change was already reverted'; END IF;

  t := entry.entity_type;
  IF t NOT IN ('posts','products','promo_codes','gift_cards','collections','collection_items',
               'categories','authors','site_settings','glossary_terms','article_series',
               'featured_slots','content_templates','currency_rates','shop_categories',
               'article_polls','sponsored_content','search_synonyms','headline_variants') THEN
    RAISE EXCEPTION 'Reverting % is not allowed from the panel', t;
  END IF;
  IF to_regclass('public.' || t) IS NULL THEN RAISE EXCEPTION 'Table % no longer exists', t; END IF;

  IF entry.action = 'insert' THEN
    EXECUTE format('DELETE FROM public.%I WHERE id = $1', t) USING entry.entity_id::uuid;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n = 0 THEN RAISE EXCEPTION 'The row was already removed — nothing to revert'; END IF;

  ELSIF entry.action = 'update' THEN
    -- refuse if the row moved on since (someone edited it after the audited change)
    IF EXISTS (
      SELECT 1 FROM public.admin_activity_log l
      WHERE l.entity_type = t AND l.entity_id = entry.entity_id
        AND l.seq > entry.seq AND l.action IN ('update', 'delete', 'insert')
    ) THEN
      RAISE EXCEPTION 'This row changed after that edit — review the newer entries first';
    END IF;
    SELECT string_agg(quote_ident(c.column_name), ', ' ORDER BY c.ordinal_position) INTO cols
      FROM information_schema.columns c
     WHERE c.table_schema = 'public' AND c.table_name = t
       AND c.is_generated = 'NEVER'
       AND entry.before ? c.column_name;
    IF cols IS NULL THEN RAISE EXCEPTION 'Nothing recorded to restore'; END IF;
    EXECUTE format(
      'UPDATE public.%I target SET (%s) = (SELECT %s FROM jsonb_populate_record(null::public.%I, $1) r) WHERE target.id = $2',
      t, cols, (SELECT string_agg('r.' || quote_ident(x), ', ') FROM unnest(string_to_array(cols, ', ')) AS x), t
    ) USING entry.before, entry.entity_id::uuid;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n = 0 THEN RAISE EXCEPTION 'The row no longer exists'; END IF;

  ELSIF entry.action = 'delete' THEN
    SELECT string_agg(quote_ident(c.column_name), ', ' ORDER BY c.ordinal_position) INTO cols
      FROM information_schema.columns c
     WHERE c.table_schema = 'public' AND c.table_name = t
       AND c.is_generated = 'NEVER'
       AND entry.before ? c.column_name;
    IF cols IS NULL THEN RAISE EXCEPTION 'Nothing recorded to restore'; END IF;
    EXECUTE format(
      'INSERT INTO public.%I (%s) SELECT %s FROM jsonb_populate_record(null::public.%I, $1) r',
      t, cols, (SELECT string_agg('r.' || quote_ident(x), ', ') FROM unnest(string_to_array(cols, ', ')) AS x), t
    ) USING entry.before;
  ELSE
    RAISE EXCEPTION 'Unknown action %', entry.action;
  END IF;

  UPDATE admin_activity_log
     SET reverted_at = now(), reverted_by = auth.uid(), description = description || ' [reverted]'
   WHERE id = p_log_id;

  INSERT INTO admin_activity_log (action, entity_type, entity_id, description, performed_by,
                                  actor_id, actor_email, actor_role, severity, source, revert_of)
  VALUES ('revert', t, entry.entity_id, 'Reverted audit entry ' || p_log_id::text,
          COALESCE(auth.jwt() ->> 'email', 'admin'), auth.uid(), auth.jwt() ->> 'email',
          (SELECT role FROM app_admins WHERE user_id = auth.uid()), 'warning', 'rpc', p_log_id);

  RETURN 'ok';
END $$;

-- =====================================================================
-- 5. RETENTION
-- =====================================================================
CREATE OR REPLACE FUNCTION admin_prune_audit(p_days integer DEFAULT 180)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  IF NOT (admin_can('ops.fix') OR admin_can('team.manage')) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF COALESCE(p_days, 0) < 30 THEN RAISE EXCEPTION 'Keep at least 30 days of audit history'; END IF;
  DELETE FROM admin_activity_log WHERE created_at < now() - make_interval(days => p_days);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION admin_audit_stats()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN NOT admin_can('audit.read') THEN '{}'::jsonb ELSE jsonb_build_object(
    'total', (SELECT count(*) FROM admin_activity_log),
    'critical', (SELECT count(*) FROM admin_activity_log WHERE severity = 'critical' AND created_at > now() - interval '30 days'),
    'warning', (SELECT count(*) FROM admin_activity_log WHERE severity = 'warning' AND created_at > now() - interval '30 days'),
    'last_24h', (SELECT count(*) FROM admin_activity_log WHERE created_at > now() - interval '24 hours'),
    'actors_7d', (SELECT count(DISTINCT COALESCE(actor_email, performed_by)) FROM admin_activity_log WHERE created_at > now() - interval '7 days'),
    'reverted', (SELECT count(*) FROM admin_activity_log WHERE reverted_at IS NOT NULL),
    'revertable', (SELECT count(*) FROM admin_activity_log WHERE action = 'update' AND reverted_at IS NULL
                     AND entity_type IN ('posts','products','promo_codes','gift_cards','collections','collection_items',
                       'categories','authors','site_settings','glossary_terms','article_series','featured_slots',
                       'content_templates','currency_rates','shop_categories','article_polls','sponsored_content',
                       'search_synonyms','headline_variants'))
  ) END;
$$;

REVOKE ALL ON FUNCTION admin_audit_search(jsonb) FROM public;
REVOKE ALL ON FUNCTION admin_audit_entry(uuid) FROM public;
REVOKE ALL ON FUNCTION admin_audit_revert(uuid) FROM public;
REVOKE ALL ON FUNCTION admin_prune_audit(integer) FROM public;
REVOKE ALL ON FUNCTION admin_audit_stats() FROM public;
GRANT EXECUTE ON FUNCTION admin_audit_search(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_audit_entry(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_audit_revert(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_prune_audit(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_audit_stats() TO authenticated;

-- monthly retention job (no-op unless pg_cron is installed, as on Supabase)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule('prune-admin-audit');
    EXCEPTION WHEN others THEN NULL;
    END;
    PERFORM cron.schedule('prune-admin-audit', '15 4 * * 0', 'SELECT public.admin_prune_audit(180);');
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
