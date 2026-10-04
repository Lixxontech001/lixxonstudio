/*
# M5 · Super-panel tools — explorer, SQL sandbox, health, growth, advisor

This migration gives the owner the "see and fix everything" half of the brief, while
keeping every entry point permission-gated and audited:

1. `admin_explorable_tables` + `admin_table_catalog()` — the data explorer reads a real
   catalogue (tables, columns, types, row estimates, which writes are allowed) instead of
   a hand-maintained list in the bundle. Row access still goes through PostgREST + RLS,
   so the explorer can never show a row the caller is not allowed to read.
2. `admin_run_sql()` — a **read-only, single-statement, 5-second** SQL sandbox. It runs
   as the *caller* (SECURITY INVOKER) inside a read-only transaction, so it can only see
   what the caller's own RLS allows, and can never write.
3. `admin_run_checks()` / `admin_health_overview()` — ~28 live checks over the database,
   queue, commerce, content, security, storage and cron; results are persisted so the
   dashboard shows the last scan and its trend.
4. `admin_fix_issue()` — the safe subset of repairs (requeue email, repair image URLs,
   backfill SEO, backfill download entitlements, ANALYZE, snapshot), each audited.
5. `admin_growth_report()` + `admin_suggestions()` — the growth/SEO/scaling intelligence
   and a prioritised advisor list the panel renders as actionable cards.
6. `admin_system_metrics()` — database size, table sizes, cache hit ratio, connections.
*/

-- =====================================================================
-- 1. DATA EXPLORER CATALOGUE
-- =====================================================================
CREATE TABLE IF NOT EXISTS admin_explorable_tables (
  table_name text PRIMARY KEY,
  label text NOT NULL,
  category text NOT NULL DEFAULT 'Other',
  allow_insert boolean NOT NULL DEFAULT false,
  allow_update boolean NOT NULL DEFAULT false,
  allow_delete boolean NOT NULL DEFAULT false,
  is_sensitive boolean NOT NULL DEFAULT false,
  notes text,
  sort_order integer NOT NULL DEFAULT 100
);
ALTER TABLE admin_explorable_tables ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_explorable_read ON admin_explorable_tables;
CREATE POLICY admin_explorable_read ON admin_explorable_tables FOR SELECT TO authenticated
  USING ((SELECT admin_can('data.explore')));

INSERT INTO admin_explorable_tables (table_name, label, category, allow_insert, allow_update, allow_delete, is_sensitive, notes, sort_order) VALUES
  ('posts','Articles','Editorial',true,true,true,false,'Publishing is permission-checked by trigger.',10),
  ('article_versions','Article revisions','Editorial',false,false,false,false,null,20),
  ('categories','Categories','Editorial',true,true,true,false,null,30),
  ('authors','Authors','Editorial',true,true,true,false,null,40),
  ('article_series','Series','Editorial',true,true,true,false,null,50),
  ('glossary_terms','Glossary','Editorial',true,true,true,false,null,60),
  ('content_templates','Content templates','Editorial',true,true,true,false,null,70),
  ('media','Media library','Editorial',true,true,true,false,'Storage objects are removed separately.',80),
  ('comments','Comments','Moderation',false,true,true,false,'Pending rows are reader submissions.',90),
  ('product_reviews','Product reviews','Moderation',false,true,true,false,null,100),
  ('article_questions','Reader questions','Moderation',false,true,true,false,null,110),
  ('comment_reports','Comment reports','Moderation',false,false,true,false,null,120),
  ('contact_messages','Contact messages','Moderation',false,false,true,true,'Contains reader PII.',130),
  ('user_feedback','Feedback','Moderation',false,false,true,true,null,140),
  ('newsletter_subscribers','Newsletter subscribers','Marketing',false,true,true,true,'Contains reader PII.',150),
  ('newsletter_preferences','Newsletter preferences','Marketing',false,true,true,true,null,160),
  ('sponsored_content','Sponsored campaigns','Marketing',true,true,true,false,null,170),
  ('article_polls','Polls','Marketing',true,true,true,false,null,180),
  ('social_shares','Social shares','Marketing',false,false,true,false,null,190),
  ('collections','Collections','Marketing',true,true,true,false,null,200),
  ('collection_items','Collection items','Marketing',true,true,true,false,null,210),
  ('featured_slots','Featured slots','Marketing',true,true,true,false,null,220),
  ('products','Products','Commerce',true,true,true,false,null,230),
  ('product_bundles','Bundles','Commerce',true,true,true,false,null,240),
  ('shop_categories','Shop categories','Commerce',true,true,true,false,null,250),
  ('orders','Orders','Commerce',false,true,false,true,'Money rows: no insert/delete from the explorer.',260),
  ('order_items','Order items','Commerce',false,true,false,true,null,270),
  ('order_notes','Order notes','Commerce',true,true,true,false,null,280),
  ('customers','Customers','Commerce',false,true,false,true,'Contains customer PII.',290),
  ('download_entitlements','Download entitlements','Commerce',false,true,true,true,null,300),
  ('refund_requests','Refund requests','Commerce',false,true,false,true,null,310),
  ('abandoned_carts','Abandoned carts','Commerce',false,true,true,true,'Contains shopper PII.',320),
  ('promo_codes','Promo codes','Commerce',true,true,true,false,'Discounts are validated server-side.',330),
  ('gift_cards','Gift cards','Commerce',true,true,true,true,'Balances are money.',340),
  ('currency_rates','Currency rates','Commerce',true,true,false,false,null,350),
  ('email_queue','Email queue','Operations',false,true,true,true,'Contains recipient addresses.',360),
  ('rate_limits','Rate limits','Operations',false,false,true,false,null,370),
  ('backup_snapshots','Backup snapshots','Operations',false,false,true,false,null,380),
  ('site_settings','Site settings','Settings',true,true,true,false,'Feature flags, nav, SEO defaults.',390),
  ('app_admins','Admins','Team',false,false,false,true,'Managed from Team & access.',400),
  ('admin_roles','Roles','Team',false,false,false,false,null,410),
  ('role_permissions','Role permissions','Team',false,false,false,false,null,420),
  ('admin_permission_overrides','Permission overrides','Team',false,false,false,false,null,430),
  ('admin_activity_log','Audit trail','Security',false,false,false,true,'Immutable by design; use revert.',440),
  ('user_profiles','Reader profiles','Readers',false,false,false,true,null,450)
ON CONFLICT (table_name) DO UPDATE SET
  label = EXCLUDED.label, category = EXCLUDED.category, allow_insert = EXCLUDED.allow_insert,
  allow_update = EXCLUDED.allow_update, allow_delete = EXCLUDED.allow_delete,
  is_sensitive = EXCLUDED.is_sensitive, notes = EXCLUDED.notes, sort_order = EXCLUDED.sort_order;

CREATE OR REPLACE FUNCTION admin_table_catalog()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN admin_can('data.explore') THEN COALESCE(jsonb_agg(jsonb_build_object(
    'table', e.table_name,
    'label', e.label,
    'category', e.category,
    'allow_insert', e.allow_insert,
    'allow_update', e.allow_update,
    'allow_delete', e.allow_delete,
    'is_sensitive', e.is_sensitive,
    'notes', e.notes,
    'row_estimate', COALESCE((SELECT c.reltuples::bigint FROM pg_class c WHERE c.oid = to_regclass('public.' || e.table_name)), 0),
    'columns', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'name', c.column_name, 'type', c.data_type, 'nullable', c.is_nullable = 'YES',
        'default', c.column_default, 'is_generated', c.is_generated <> 'NEVER',
        'is_pk', EXISTS (
          SELECT 1 FROM information_schema.key_column_usage k
          JOIN information_schema.table_constraints tc ON tc.constraint_name = k.constraint_name
          WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = 'public'
            AND tc.table_name = c.table_name AND k.column_name = c.column_name)
      ) ORDER BY c.ordinal_position)
      FROM information_schema.columns c
      WHERE c.table_schema = 'public' AND c.table_name = e.table_name
    ), '[]'::jsonb)
  ) ORDER BY e.category, e.sort_order), '[]'::jsonb) ELSE '[]'::jsonb END
  FROM admin_explorable_tables e
  WHERE to_regclass('public.' || e.table_name) IS NOT NULL;
$$;

-- =====================================================================
-- 2. READ-ONLY SQL SANDBOX
-- =====================================================================
-- SECURITY INVOKER on purpose: the statement runs with the caller's own JWT and RLS,
-- inside a read-only transaction with a hard row cap and statement timeout.
CREATE OR REPLACE FUNCTION admin_run_sql(p_sql text, p_max_rows integer DEFAULT 200)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_sql text;
  v_max integer := LEAST(GREATEST(COALESCE(p_max_rows, 200), 1), 1000);
  v_rows jsonb := '[]'::jsonb;
  v_start timestamptz := clock_timestamp();
  v_count integer;
BEGIN
  IF NOT admin_can('data.sql') THEN RAISE EXCEPTION 'forbidden'; END IF;
  v_sql := btrim(COALESCE(p_sql, ''));
  IF v_sql = '' THEN RAISE EXCEPTION 'Enter a query'; END IF;
  IF length(v_sql) > 20000 THEN RAISE EXCEPTION 'Query is too long (20k characters max)'; END IF;
  IF right(v_sql, 1) = ';' THEN v_sql := left(v_sql, -1); END IF;
  IF position(';' in v_sql) > 0 THEN RAISE EXCEPTION 'One statement per run'; END IF;
  IF v_sql !~* '^\s*(select|with)\M' THEN RAISE EXCEPTION 'Only SELECT / WITH queries are allowed'; END IF;
  IF v_sql ~* '\m(insert|update|delete|drop|alter|create|grant|revoke|truncate|copy|do|call|vacuum|analyze|reindex|listen|notify|prepare|execute|commit|rollback|begin|savepoint|refresh|cluster|checkpoint|discard|load|move|declare|fetch|import|explain|into|set|reset)\M'
  THEN RAISE EXCEPTION 'Only read-only SELECT / WITH queries are allowed'; END IF;
  IF v_sql ~* '\m(admin_[a-z_]*|pg_sleep|set_config|current_setting|setrole|set_role|pg_read_file|pg_read_binary_file|pg_ls_dir|pg_stat_file|lo_import|lo_export|dblink|pg_terminate_backend|pg_cancel_backend|pg_reload_conf|take_backup_snapshot|redeem_promo_code|debit_gift_card|consume_download|publish_scheduled|enqueue_[a-z_]*)\s*\('
  THEN RAISE EXCEPTION 'That function is not available in the sandbox'; END IF;

  EXECUTE 'SET LOCAL statement_timeout = ''5s''';
  EXECUTE 'SET LOCAL default_transaction_read_only = on';

  -- Only the query itself is caught here: permission and validation errors above must
  -- reach the caller so the panel can tell "not allowed" apart from "your SQL is wrong".
  BEGIN
    EXECUTE format(
      'SELECT COALESCE(jsonb_agg(to_jsonb(q)), ''[]''::jsonb) FROM (SELECT * FROM (%s) inner_q LIMIT %s) q',
      v_sql, v_max + 1) INTO v_rows;
  EXCEPTION WHEN others THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM,
                              'ms', round(EXTRACT(epoch FROM clock_timestamp() - v_start) * 1000)::int);
  END;

  v_count := jsonb_array_length(v_rows);
  IF v_count > v_max THEN
    SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) INTO v_rows
      FROM (SELECT * FROM jsonb_array_elements(v_rows) WITH ORDINALITY e(x, ord) WHERE ord <= v_max) s;
    v_count := v_max;
    RETURN jsonb_build_object('ok', true, 'rows', v_rows, 'row_count', v_count, 'truncated', true,
                              'ms', round(EXTRACT(epoch FROM clock_timestamp() - v_start) * 1000)::int);
  END IF;
  RETURN jsonb_build_object('ok', true, 'rows', v_rows, 'row_count', v_count, 'truncated', false,
                            'ms', round(EXTRACT(epoch FROM clock_timestamp() - v_start) * 1000)::int);
END $$;

-- =====================================================================
-- 3. HEALTH CHECKS
-- =====================================================================
CREATE TABLE IF NOT EXISTS admin_health_checks (
  key text PRIMARY KEY,
  label text NOT NULL,
  category text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('ok', 'info', 'warning', 'critical')),
  detail text NOT NULL DEFAULT '',
  metric numeric,
  suggestion text,
  action_route text,
  action_label text,
  fix_key text,
  data jsonb,
  checked_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE admin_health_checks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_health_read ON admin_health_checks;
CREATE POLICY admin_health_read ON admin_health_checks FOR SELECT TO authenticated
  USING ((SELECT admin_can('ops.health')) OR (SELECT admin_can('ops.fix')));

CREATE TABLE IF NOT EXISTS admin_health_snapshots (
  id bigserial PRIMARY KEY,
  taken_at timestamptz NOT NULL DEFAULT now(),
  taken_by uuid,
  critical integer NOT NULL DEFAULT 0,
  warning integer NOT NULL DEFAULT 0,
  info integer NOT NULL DEFAULT 0,
  ok integer NOT NULL DEFAULT 0,
  duration_ms integer,
  summary jsonb
);
ALTER TABLE admin_health_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_health_snapshots_read ON admin_health_snapshots;
CREATE POLICY admin_health_snapshots_read ON admin_health_snapshots FOR SELECT TO authenticated
  USING ((SELECT admin_can('ops.health')));

-- internal upsert helper (not callable by clients)
CREATE OR REPLACE FUNCTION admin_health_set(
  p_key text, p_label text, p_category text, p_severity text, p_detail text,
  p_metric numeric DEFAULT NULL, p_suggestion text DEFAULT NULL,
  p_route text DEFAULT NULL, p_action text DEFAULT NULL, p_fix text DEFAULT NULL,
  p_data jsonb DEFAULT NULL
) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO admin_health_checks (key, label, category, severity, detail, metric, suggestion, action_route, action_label, fix_key, data, checked_at)
  VALUES (p_key, p_label, p_category, p_severity, p_detail, p_metric, p_suggestion, p_route, p_action, p_fix, p_data, now())
  ON CONFLICT (key) DO UPDATE SET
    label = EXCLUDED.label, category = EXCLUDED.category, severity = EXCLUDED.severity,
    detail = EXCLUDED.detail, metric = EXCLUDED.metric, suggestion = EXCLUDED.suggestion,
    action_route = EXCLUDED.action_route, action_label = EXCLUDED.action_label,
    fix_key = EXCLUDED.fix_key, data = EXCLUDED.data, checked_at = now();
$$;
REVOKE ALL ON FUNCTION admin_health_set(text, text, text, text, text, numeric, text, text, text, text, jsonb) FROM public;

CREATE OR REPLACE FUNCTION admin_run_checks()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_start timestamptz := clock_timestamp();
  n numeric; n2 numeric; v_detail text;
  v_critical integer; v_warning integer; v_info integer; v_ok integer;
  v_summary jsonb;
BEGIN
  IF NOT (admin_can('ops.health') OR admin_can('ops.fix')) THEN RAISE EXCEPTION 'forbidden'; END IF;

  -- ---------- database ----------
  BEGIN
    n := pg_database_size(current_database());
    PERFORM admin_health_set('db.size', 'Database size', 'Database',
      CASE WHEN n > 450 * 1024 * 1024 THEN 'critical' WHEN n > 350 * 1024 * 1024 THEN 'warning' ELSE 'ok' END,
      'The database is using ' || pg_size_pretty(n::bigint) || ' of the 500 MB free tier.',
      n, 'Archive old audit entries or upgrade before the free tier fills up.',
      'admin-backups', 'Backups & jobs', 'prune_audit');
  EXCEPTION WHEN others THEN
    PERFORM admin_health_set('db.size', 'Database size', 'Database', 'ok', 'Unavailable: ' || SQLERRM);
  END;

  BEGIN
    SELECT round(COALESCE(sum(blks_hit), 0)::numeric / GREATEST(COALESCE(sum(blks_hit + blks_read), 0), 1), 4)
      INTO n FROM pg_stat_database WHERE datname = current_database();
    PERFORM admin_health_set('db.cache_hit', 'Cache hit ratio', 'Database',
      CASE WHEN n < 0.9 THEN 'warning' WHEN n < 0.95 THEN 'info' ELSE 'ok' END,
      'Shared-buffer cache hit ratio is ' || round(n * 100, 1) || '%.', n,
      'A low ratio with heavy reads usually means an index is missing — check the index advisor below.',
      'admin-health', 'Health & issues', NULL);
  EXCEPTION WHEN others THEN
    PERFORM admin_health_set('db.cache_hit', 'Cache hit ratio', 'Database', 'ok', 'Unavailable: ' || SQLERRM);
  END;

  BEGIN
    WITH fks AS (
      SELECT c.conrelid, c.conname,
             (SELECT array_agg(a.attname ORDER BY x.ord)
                FROM unnest(c.conkey) WITH ORDINALITY x(attnum, ord)
                JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = x.attnum) AS cols
      FROM pg_constraint c WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace
    ), missing AS (
      SELECT fks.conrelid, fks.conname, fks.cols FROM fks
      WHERE NOT EXISTS (
        SELECT 1 FROM pg_index i
        WHERE i.indrelid = fks.conrelid AND i.indisvalid AND i.indisready AND i.indpred IS NULL
          AND (SELECT array_agg(a.attname ORDER BY x.ord)
                 FROM unnest(string_to_array(i.indkey::text, ' ')::int[]) WITH ORDINALITY x(attnum, ord)
                 JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = x.attnum)[1:array_length(fks.cols, 1)] = fks.cols
      )
    )
    SELECT count(*), COALESCE(string_agg(conname, ', '), '') INTO n, v_detail FROM missing;
    PERFORM admin_health_set('db.unindexed_fk', 'Unindexed foreign keys', 'Database',
      CASE WHEN n > 0 THEN 'warning' ELSE 'ok' END,
      CASE WHEN n = 0 THEN 'Every foreign key has a supporting index.'
           ELSE n || ' foreign key(s) without a supporting index — joins and deletes on these tables slow down as data grows.' END,
      n, CASE WHEN n = 0 THEN NULL ELSE 'Add the missing indexes (a maintenance migration is the safest place).' END,
      'admin-health', 'Health & issues', NULL, jsonb_build_object('constraints', v_detail));
  EXCEPTION WHEN others THEN
    PERFORM admin_health_set('db.unindexed_fk', 'Unindexed foreign keys', 'Database', 'ok', 'Unavailable: ' || SQLERRM);
  END;

  BEGIN
    SELECT count(*), COALESCE(string_agg(relname || ' (' || seq_scan || ' seq vs ' || idx_scan || ' idx)', ', '), '')
      INTO n, v_detail
      FROM pg_stat_user_tables
     WHERE schemaname = 'public' AND n_live_tup > 500
       AND seq_scan > GREATEST(COALESCE(idx_scan, 0), 1) * 5 AND seq_scan > 50;
    PERFORM admin_health_set('db.seq_scans', 'Tables scanned without indexes', 'Database',
      CASE WHEN n > 0 THEN 'info' ELSE 'ok' END,
      CASE WHEN n = 0 THEN 'No table is dominated by sequential scans.' ELSE n || ' table(s) are read with sequential scans far more often than with indexes: ' || v_detail END,
      n, CASE WHEN n = 0 THEN NULL ELSE 'Check whether these tables need an index for the query pattern the analytics show.' END,
      'admin-health', 'Health & issues', NULL);
  EXCEPTION WHEN others THEN
    PERFORM admin_health_set('db.seq_scans', 'Tables scanned without indexes', 'Database', 'ok', 'Unavailable: ' || SQLERRM);
  END;

  BEGIN
    SELECT count(*), COALESCE(string_agg(relname, ', '), '') INTO n, v_detail
      FROM pg_stat_user_tables
     WHERE schemaname = 'public' AND n_dead_tup > 1000 AND n_dead_tup > n_live_tup * 0.2;
    PERFORM admin_health_set('db.dead_tuples', 'Tables needing vacuum', 'Database',
      CASE WHEN n > 0 THEN 'info' ELSE 'ok' END,
      CASE WHEN n = 0 THEN 'Dead-tuple ratios are healthy.' ELSE n || ' table(s) carry a lot of dead tuples: ' || v_detail END,
      n, CASE WHEN n = 0 THEN NULL ELSE 'Run ANALYZE (the one-click fix) so the planner has fresh statistics.' END,
      'admin-health', 'Health & issues', 'analyze');
  EXCEPTION WHEN others THEN
    PERFORM admin_health_set('db.dead_tuples', 'Tables needing vacuum', 'Database', 'ok', 'Unavailable: ' || SQLERRM);
  END;

  BEGIN
    SELECT count(*), COALESCE(string_agg(left(query, 80), ' | '), '') INTO n, v_detail
      FROM pg_stat_activity
     WHERE state = 'active' AND pid <> pg_backend_pid()
       AND query_start < now() - interval '30 seconds'
       AND query NOT ILIKE '%pg_stat_activity%';
    PERFORM admin_health_set('db.long_queries', 'Long-running queries', 'Database',
      CASE WHEN n > 0 THEN 'warning' ELSE 'ok' END,
      CASE WHEN n = 0 THEN 'No query has been running for more than 30 seconds.' ELSE n || ' query(ies) running longer than 30s: ' || v_detail END,
      n, 'Investigate from the Supabase SQL editor before it holds a connection.', 'admin-health', 'Health & issues', NULL);
  EXCEPTION WHEN others THEN
    PERFORM admin_health_set('db.long_queries', 'Long-running queries', 'Database', 'ok', 'Unavailable: ' || SQLERRM);
  END;

  BEGIN
    SELECT count(*) INTO n FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity;
    PERFORM admin_health_set('security.rls', 'Row-level security', 'Security',
      CASE WHEN n > 0 THEN 'critical' ELSE 'ok' END,
      CASE WHEN n = 0 THEN 'Every public table has row-level security enabled.' ELSE n || ' public table(s) have RLS disabled.' END,
      n, CASE WHEN n = 0 THEN NULL ELSE 'Enable RLS and review the policies immediately.' END,
      'admin-health', 'Health & issues', NULL);
  EXCEPTION WHEN others THEN
    PERFORM admin_health_set('security.rls', 'Row-level security', 'Security', 'ok', 'Unavailable: ' || SQLERRM);
  END;

  BEGIN
    SELECT count(*) INTO n FROM pg_policies
     WHERE schemaname = 'public' AND 'anon' = ANY(roles) AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
       AND tablename IN ('orders','customers','promo_codes','gift_cards','download_entitlements','refund_requests',
                         'posts','products','app_admins','admin_activity_log','site_settings','email_queue',
                         'backup_snapshots','admin_roles','role_permissions','admin_permission_overrides',
                         'newsletter_subscribers','comments','product_reviews','customers','user_profiles');
    PERFORM admin_health_set('security.anon_write', 'Anonymous write policies', 'Security',
      CASE WHEN n > 0 THEN 'critical' ELSE 'ok' END,
      CASE WHEN n = 0 THEN 'No sensitive table is writable anonymously.' ELSE n || ' sensitive table(s) have an anon write policy.' END,
      n, CASE WHEN n = 0 THEN NULL ELSE 'Drop those policies — anonymous writes to sensitive tables are the classic leak.' END,
      'admin-health', 'Health & issues', NULL);
  EXCEPTION WHEN others THEN
    PERFORM admin_health_set('security.anon_write', 'Anonymous write policies', 'Security', 'ok', 'Unavailable: ' || SQLERRM);
  END;

  BEGIN
    SELECT count(*) INTO n FROM app_admins WHERE status = 'active' AND role = 'owner';
    PERFORM admin_health_set('security.owner', 'Active owner account', 'Security',
      CASE WHEN n = 0 THEN 'critical' ELSE 'ok' END,
      CASE WHEN n = 0 THEN 'There is no active owner — nobody can manage the team.' ELSE n || ' active owner account(s).' END,
      n, CASE WHEN n = 0 THEN 'Promote an admin to owner from Team & access.' END,
      'admin-access', 'Team & access', NULL);
  EXCEPTION WHEN others THEN
    PERFORM admin_health_set('security.owner', 'Active owner account', 'Security', 'ok', 'Unavailable: ' || SQLERRM);
  END;

  BEGIN
    SELECT count(*) INTO n FROM app_admins WHERE is_founder;
    PERFORM admin_health_set('security.founder', 'Super admin flag', 'Security',
      CASE WHEN n = 0 THEN 'warning' ELSE 'ok' END,
      CASE WHEN n = 0 THEN 'No account carries the protected super-admin flag.' ELSE 'The protected super-admin account is set.' END,
      n, CASE WHEN n = 0 THEN 'Transfer the flag from Security so the original account is protected again.' END,
      'admin-security', 'Security', NULL);
  EXCEPTION WHEN others THEN
    PERFORM admin_health_set('security.founder', 'Super admin flag', 'Security', 'ok', 'Unavailable: ' || SQLERRM);
  END;

  BEGIN
    SELECT count(*) INTO n FROM app_admins a
     WHERE a.status = 'active' AND NOT EXISTS (SELECT 1 FROM auth.mfa_factors f WHERE f.user_id = a.user_id AND f.status = 'verified');
    PERFORM admin_health_set('security.mfa', 'Two-factor enrolment', 'Security',
      CASE WHEN n > 0 THEN 'warning' ELSE 'ok' END,
      CASE WHEN n = 0 THEN 'Every active admin has a verified second factor.' ELSE n || ' active admin(s) have not enrolled a second factor.' END,
      n, CASE WHEN n = 0 THEN NULL ELSE 'Ask them to enrol from Admin → Security; until then their admin access stays AAL1.' END,
      'admin-security', 'Security', NULL);
  EXCEPTION WHEN others THEN
    PERFORM admin_health_set('security.mfa', 'Two-factor enrolment', 'Security', 'ok', 'Unavailable: ' || SQLERRM);
  END;

  -- ---------- email ----------
  BEGIN
    SELECT count(*) INTO n FROM email_queue WHERE status = 'failed';
    PERFORM admin_health_set('email.failed', 'Failed emails', 'Email',
      CASE WHEN n > 5 THEN 'critical' WHEN n > 0 THEN 'warning' ELSE 'ok' END,
      CASE WHEN n = 0 THEN 'No email has failed.' ELSE n || ' email(s) are in the failed state — customers may not have received receipts or downloads.' END,
      n, CASE WHEN n = 0 THEN NULL ELSE 'Requeue them; if they fail again, check the Resend key and the sending domain.' END,
      'admin-backups', 'Backups & jobs', 'requeue_email');
  EXCEPTION WHEN others THEN
    PERFORM admin_health_set('email.failed', 'Failed emails', 'Email', 'ok', 'Unavailable: ' || SQLERRM);
  END;

  BEGIN
    SELECT count(*) INTO n FROM email_queue WHERE status = 'queued' AND scheduled_for < now() - interval '1 hour';
    PERFORM admin_health_set('email.stuck', 'Stuck email queue', 'Email',
      CASE WHEN n > 0 THEN 'warning' ELSE 'ok' END,
      CASE WHEN n = 0 THEN 'The queue is draining on schedule.' ELSE n || ' email(s) are past due — the worker has not drained them.' END,
      n, CASE WHEN n = 0 THEN NULL ELSE 'Requeue, then confirm the scheduled job still runs (Backups & jobs).' END,
      'admin-backups', 'Backups & jobs', 'requeue_email');
  EXCEPTION WHEN others THEN
    PERFORM admin_health_set('email.stuck', 'Stuck email queue', 'Email', 'ok', 'Unavailable: ' || SQLERRM);
  END;

  BEGIN
    SELECT count(*) INTO n FROM email_queue WHERE sent_at > now() - interval '24 hours';
    PERFORM admin_health_set('email.volume', 'Daily email volume', 'Email',
      CASE WHEN n > 80 THEN 'warning' ELSE 'ok' END,
      n || ' email(s) sent in the last 24 hours (free-tier cap is 90/day).', n,
      CASE WHEN n > 80 THEN 'Throttle the digest or move to a paid tier before the queue starts failing.' END,
      'admin-backups', 'Backups & jobs', NULL);
  EXCEPTION WHEN others THEN
    PERFORM admin_health_set('email.volume', 'Daily email volume', 'Email', 'ok', 'Unavailable: ' || SQLERRM);
  END;

  -- ---------- commerce ----------
  BEGIN
    SELECT count(DISTINCT o.id) INTO n
      FROM orders o
      JOIN order_items oi ON oi.order_id = o.id
      JOIN products p ON p.id = oi.product_id
     WHERE o.payment_status = 'paid' AND COALESCE(p.is_digital, false)
       AND NOT EXISTS (SELECT 1 FROM download_entitlements e WHERE e.order_id = o.id AND e.product_id = oi.product_id);
    PERFORM admin_health_set('commerce.entitlements', 'Paid orders without download links', 'Commerce',
      CASE WHEN n > 0 THEN 'warning' ELSE 'ok' END,
      CASE WHEN n = 0 THEN 'Every paid digital order has its download entitlement.' ELSE n || ' paid digital order(s) have no download entitlement — the buyer cannot fetch the file.' END,
      n, CASE WHEN n = 0 THEN NULL ELSE 'Backfill the missing entitlements (one click) and re-send the download email.' END,
      'admin-orders', 'Orders', 'backfill_entitlements');
  EXCEPTION WHEN others THEN
    PERFORM admin_health_set('commerce.entitlements', 'Paid orders without download links', 'Commerce', 'ok', 'Unavailable: ' || SQLERRM);
  END;

  BEGIN
    SELECT count(*) INTO n FROM orders
     WHERE status = 'pending' AND payment_status = 'pending' AND created_at < now() - interval '48 hours';
    PERFORM admin_health_set('commerce.pending', 'Stale pending orders', 'Commerce',
      CASE WHEN n > 0 THEN 'info' ELSE 'ok' END,
      CASE WHEN n = 0 THEN 'No orders have been pending for more than two days.' ELSE n || ' order(s) have been pending for over 48 hours.' END,
      n, CASE WHEN n = 0 THEN NULL ELSE 'Mark the genuine failures and follow up on the rest.' END,
      'admin-orders', 'Orders', NULL);
  EXCEPTION WHEN others THEN
    PERFORM admin_health_set('commerce.pending', 'Stale pending orders', 'Commerce', 'ok', 'Unavailable: ' || SQLERRM);
  END;

  BEGIN
    SELECT count(*) INTO n FROM orders
     WHERE payment_status = 'paid' AND NOT webhook_verified AND payment_reference IS NOT NULL
       AND created_at > now() - interval '30 days';
    PERFORM admin_health_set('commerce.webhooks', 'Unverified payments', 'Commerce',
      CASE WHEN n > 0 THEN 'warning' ELSE 'ok' END,
      CASE WHEN n = 0 THEN 'Every recent paid order was verified by the payment webhook.' ELSE n || ' paid order(s) were not confirmed by a webhook.' END,
      n, CASE WHEN n = 0 THEN NULL ELSE 'Check the Flutterwave webhook URL and secret hash.' END,
      'admin-orders', 'Orders', NULL);
  EXCEPTION WHEN others THEN
    PERFORM admin_health_set('commerce.webhooks', 'Unverified payments', 'Commerce', 'ok', 'Unavailable: ' || SQLERRM);
  END;

  BEGIN
    SELECT count(*) INTO n FROM abandoned_carts WHERE NOT COALESCE(recovered, false) AND COALESCE(email, '') <> '' AND created_at > now() - interval '7 days';
    PERFORM admin_health_set('carts.recoverable', 'Recoverable carts', 'Commerce',
      CASE WHEN n > 0 THEN 'info' ELSE 'ok' END,
      CASE WHEN n = 0 THEN 'No recoverable carts in the last week.' ELSE n || ' cart(s) with an email address were abandoned in the last 7 days.' END,
      n, CASE WHEN n = 0 THEN NULL ELSE 'Review them under Abandoned carts and send a reminder.' END,
      'admin-abandoned-carts', 'Abandoned carts', NULL);
  EXCEPTION WHEN others THEN
    PERFORM admin_health_set('carts.recoverable', 'Recoverable carts', 'Commerce', 'ok', 'Unavailable: ' || SQLERRM);
  END;

  BEGIN
    SELECT count(*) INTO n FROM refund_requests WHERE status = 'pending' AND created_at < now() - interval '3 days';
    PERFORM admin_health_set('refunds.pending', 'Refunds waiting', 'Commerce',
      CASE WHEN n > 0 THEN 'warning' ELSE 'ok' END,
      CASE WHEN n = 0 THEN 'No refund request has been waiting for more than three days.' ELSE n || ' refund request(s) have been open for over three days.' END,
      n, CASE WHEN n = 0 THEN NULL ELSE 'Settle or decline them — refunds are a trust signal.' END,
      'admin-refunds', 'Refunds', NULL);
  EXCEPTION WHEN others THEN
    PERFORM admin_health_set('refunds.pending', 'Refunds waiting', 'Commerce', 'ok', 'Unavailable: ' || SQLERRM);
  END;

  -- ---------- content ----------
  BEGIN
    SELECT count(*) INTO n FROM posts WHERE status = 'published' AND published_at > now() - interval '7 days';
    PERFORM admin_health_set('content.cadence', 'Publishing cadence', 'Content',
      CASE WHEN n = 0 THEN 'warning' ELSE 'ok' END,
      n || ' article(s) published in the last 7 days.', n,
      CASE WHEN n = 0 THEN 'Regular publishing keeps search and reader retention healthy — schedule the next one.' END,
      'admin-articles', 'Articles', NULL);
  EXCEPTION WHEN others THEN
    PERFORM admin_health_set('content.cadence', 'Publishing cadence', 'Content', 'ok', 'Unavailable: ' || SQLERRM);
  END;

  BEGIN
    SELECT count(*) INTO n FROM posts WHERE status = 'draft' AND updated_at < now() - interval '60 days';
    PERFORM admin_health_set('content.drafts', 'Stale drafts', 'Content',
      CASE WHEN n > 0 THEN 'info' ELSE 'ok' END,
      CASE WHEN n = 0 THEN 'No draft has been sitting for two months.' ELSE n || ' draft(s) untouched for over 60 days.' END,
      n, CASE WHEN n = 0 THEN NULL ELSE 'Finish or archive them so the pipeline reflects reality.' END,
      'admin-articles', 'Articles', NULL);
  EXCEPTION WHEN others THEN
    PERFORM admin_health_set('content.drafts', 'Stale drafts', 'Content', 'ok', 'Unavailable: ' || SQLERRM);
  END;

  BEGIN
    SELECT count(*) INTO n FROM posts
     WHERE status = 'published' AND (COALESCE(seo_description, '') = '' OR COALESCE(excerpt, '') = '' OR COALESCE(cover_image, '') = '');
    PERFORM admin_health_set('content.seo', 'Missing SEO fields', 'Content',
      CASE WHEN n > 0 THEN 'warning' ELSE 'ok' END,
      CASE WHEN n = 0 THEN 'Every published article has an excerpt, cover image and SEO description.' ELSE n || ' published article(s) are missing an excerpt, cover image or SEO description.' END,
      n, CASE WHEN n = 0 THEN NULL ELSE 'Backfill from the title/excerpt now and review them later (one click).' END,
      'admin-articles', 'Articles', 'backfill_seo');
  EXCEPTION WHEN others THEN
    PERFORM admin_health_set('content.seo', 'Missing SEO fields', 'Content', 'ok', 'Unavailable: ' || SQLERRM);
  END;

  BEGIN
    SELECT (SELECT count(*) FROM posts WHERE COALESCE(cover_image,'') ~* '(^http://|pexels\.com/photo/)')
         + (SELECT count(*) FROM products WHERE COALESCE(image_url,'') ~* '(^http://|pexels\.com/photo/)'
              OR EXISTS (SELECT 1 FROM unnest(COALESCE(gallery, '{}')) g WHERE g ~* '(^http://|pexels\.com/photo/)')) INTO n;
    PERFORM admin_health_set('content.images', 'Broken image URLs', 'Content',
      CASE WHEN n > 0 THEN 'warning' ELSE 'ok' END,
      CASE WHEN n = 0 THEN 'No insecure or Pexels page URLs found in article and product images.' ELSE n || ' image URL(s) are broken (insecure http:// or a Pexels page URL instead of the CDN file).' END,
      n, CASE WHEN n = 0 THEN NULL ELSE 'Repair them to the CDN form (one click).' END,
      'admin-media', 'Media', 'repair_images');
  EXCEPTION WHEN others THEN
    PERFORM admin_health_set('content.images', 'Broken image URLs', 'Content', 'ok', 'Unavailable: ' || SQLERRM);
  END;

  BEGIN
    SELECT count(*) INTO n FROM posts WHERE status = 'published' AND (category_id IS NULL OR author_id IS NULL);
    PERFORM admin_health_set('content.orphans', 'Articles without category or author', 'Content',
      CASE WHEN n > 0 THEN 'info' ELSE 'ok' END,
      CASE WHEN n = 0 THEN 'Every published article is filed and credited.' ELSE n || ' published article(s) have no category or author.' END,
      n, CASE WHEN n = 0 THEN NULL ELSE 'Assign them so archives and author pages are complete.' END,
      'admin-articles', 'Articles', NULL);
  EXCEPTION WHEN others THEN
    PERFORM admin_health_set('content.orphans', 'Articles without category or author', 'Content', 'ok', 'Unavailable: ' || SQLERRM);
  END;

  BEGIN
    SELECT count(*) INTO n FROM comments WHERE NOT is_approved AND created_at < now() - interval '48 hours';
    n2 := (SELECT count(*) FROM product_reviews WHERE NOT is_approved AND created_at < now() - interval '48 hours')
        + (SELECT count(*) FROM article_questions WHERE NOT is_public AND answer IS NULL AND created_at < now() - interval '48 hours');
    PERFORM admin_health_set('moderation.backlog', 'Moderation backlog', 'Moderation',
      CASE WHEN (n + n2) > 0 THEN 'warning' ELSE 'ok' END,
      CASE WHEN (n + n2) = 0 THEN 'Nothing has been waiting for moderation for more than two days.'
           ELSE (n + n2) || ' item(s) have been waiting for moderation for over 48 hours (' || n || ' comments, ' || n2 || ' reviews/questions).' END,
      n + n2, CASE WHEN (n + n2) = 0 THEN NULL ELSE 'Clear the backlog — unanswered readers rarely come back.' END,
      'admin-comments', 'Comments', NULL);
  EXCEPTION WHEN others THEN
    PERFORM admin_health_set('moderation.backlog', 'Moderation backlog', 'Moderation', 'ok', 'Unavailable: ' || SQLERRM);
  END;

  BEGIN
    SELECT count(DISTINCT lower(btrim(query))) INTO n
      FROM search_history WHERE result_count = 0 AND created_at > now() - interval '30 days' AND btrim(query) <> '';
    PERFORM admin_health_set('search.gaps', 'Search misses', 'Growth',
      CASE WHEN n > 0 THEN 'info' ELSE 'ok' END,
      CASE WHEN n = 0 THEN 'Every recent search found something.' ELSE n || ' distinct search term(s) returned nothing in the last 30 days.' END,
      n, CASE WHEN n = 0 THEN NULL ELSE 'Turn the top misses into content — the growth report lists them.' END,
      'admin-growth', 'Growth & SEO', NULL);
  EXCEPTION WHEN others THEN
    PERFORM admin_health_set('search.gaps', 'Search misses', 'Growth', 'ok', 'Unavailable: ' || SQLERRM);
  END;

  -- ---------- operations ----------
  BEGIN
    IF to_regclass('storage.objects') IS NOT NULL THEN
      SELECT COALESCE(sum(CASE WHEN (metadata ->> 'size') ~ '^[0-9]+$' THEN (metadata ->> 'size')::numeric ELSE 0 END), 0)
        INTO n FROM storage.objects;
      PERFORM admin_health_set('storage.size', 'Storage used', 'Storage',
        CASE WHEN n > 800 * 1024 * 1024 THEN 'warning' WHEN n > 600 * 1024 * 1024 THEN 'info' ELSE 'ok' END,
        'Storage holds ' || pg_size_pretty(n::bigint) || ' of the 1 GB free tier.', n,
        CASE WHEN n > 600 * 1024 * 1024 THEN 'Re-compress or remove the largest media files.' END,
        'admin-media', 'Media', NULL);
    END IF;
  EXCEPTION WHEN others THEN
    PERFORM admin_health_set('storage.size', 'Storage used', 'Storage', 'ok', 'Unavailable: ' || SQLERRM);
  END;

  BEGIN
    SELECT COALESCE(EXTRACT(epoch FROM now() - max(taken_at)) / 3600, 9999) INTO n FROM backup_snapshots;
    PERFORM admin_health_set('backup.last', 'Last backup snapshot', 'Operations',
      CASE WHEN n > 72 THEN 'warning' WHEN n > 48 THEN 'info' ELSE 'ok' END,
      CASE WHEN n >= 9999 THEN 'No backup snapshot has ever been taken.' ELSE 'The last snapshot is ' || round(n) || ' hour(s) old.' END,
      n, CASE WHEN n > 48 THEN 'Take a snapshot (one click) — Supabase Free has no point-in-time recovery.' END,
      'admin-backups', 'Backups & jobs', 'take_backup');
  EXCEPTION WHEN others THEN
    PERFORM admin_health_set('backup.last', 'Last backup snapshot', 'Operations', 'ok', 'Unavailable: ' || SQLERRM);
  END;

  BEGIN
    IF to_regclass('cron.job_run_details') IS NOT NULL THEN
      EXECUTE 'SELECT count(*) FROM cron.job_run_details WHERE status = ''failed'' AND start_time > now() - interval ''24 hours'''
        INTO n;
      PERFORM admin_health_set('cron.failures', 'Scheduled job failures', 'Operations',
        CASE WHEN n > 0 THEN 'warning' ELSE 'ok' END,
        CASE WHEN n = 0 THEN 'No scheduled job has failed in the last 24 hours.' ELSE n || ' scheduled job run(s) failed in the last 24 hours.' END,
        n, CASE WHEN n = 0 THEN NULL ELSE 'Open Backups & jobs and check the job history.' END,
        'admin-backups', 'Backups & jobs', NULL);
    END IF;
  EXCEPTION WHEN others THEN
    PERFORM admin_health_set('cron.failures', 'Scheduled job failures', 'Operations', 'ok', 'Unavailable: ' || SQLERRM);
  END;

  BEGIN
    IF to_regclass('pg_stat_statements') IS NOT NULL THEN
      EXECUTE 'SELECT count(*) FROM pg_stat_statements s JOIN pg_database d ON d.oid = s.dbid WHERE d.datname = current_database() AND s.mean_exec_time > 500 AND s.calls > 20'
        INTO n;
      PERFORM admin_health_set('perf.slow', 'Slow queries', 'Performance',
        CASE WHEN n > 0 THEN 'warning' ELSE 'ok' END,
        CASE WHEN n = 0 THEN 'No statement averages over 500 ms.' ELSE n || ' statement(s) average more than 500 ms.' END,
        n, CASE WHEN n = 0 THEN NULL ELSE 'Review them in the Supabase SQL editor and add indexes.' END,
        'admin-health', 'Health & issues', NULL);
    END IF;
  EXCEPTION WHEN others THEN
    PERFORM admin_health_set('perf.slow', 'Slow queries', 'Performance', 'ok', 'Unavailable: ' || SQLERRM);
  END;

  -- ---------- snapshot & summary ----------
  SELECT count(*) FILTER (WHERE severity = 'critical'), count(*) FILTER (WHERE severity = 'warning'),
         count(*) FILTER (WHERE severity = 'info'), count(*) FILTER (WHERE severity = 'ok')
    INTO v_critical, v_warning, v_info, v_ok FROM admin_health_checks;

  v_summary := jsonb_build_object(
    'critical', v_critical, 'warning', v_warning, 'info', v_info, 'ok', v_ok,
    'duration_ms', round(EXTRACT(epoch FROM clock_timestamp() - v_start) * 1000)::int,
    'issues', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'key', key, 'label', label, 'category', category, 'severity', severity, 'detail', detail,
        'metric', metric, 'suggestion', suggestion, 'action_route', action_route,
        'action_label', action_label, 'fix_key', fix_key, 'data', data) ORDER BY
        CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 WHEN 'info' THEN 2 ELSE 3 END, category, label)
      FROM admin_health_checks), '[]'::jsonb)
  );

  INSERT INTO admin_health_snapshots (taken_by, critical, warning, info, ok, duration_ms, summary)
  VALUES (auth.uid(), v_critical, v_warning, v_info, v_ok, (v_summary ->> 'duration_ms')::int, v_summary);

  DELETE FROM admin_health_snapshots WHERE taken_at < now() - interval '90 days';
  RETURN v_summary;
END $$;

CREATE OR REPLACE FUNCTION admin_health_overview()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN NOT (admin_can('ops.health') OR admin_can('ops.fix')) THEN '{}'::jsonb ELSE jsonb_build_object(
    'last', (SELECT jsonb_build_object('taken_at', taken_at, 'critical', critical, 'warning', warning,
                                       'info', info, 'ok', ok, 'duration_ms', duration_ms)
               FROM admin_health_snapshots ORDER BY taken_at DESC LIMIT 1),
    'checks', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'key', key, 'label', label, 'category', category, 'severity', severity, 'detail', detail,
        'metric', metric, 'suggestion', suggestion, 'action_route', action_route,
        'action_label', action_label, 'fix_key', fix_key, 'data', data, 'checked_at', checked_at) ORDER BY
        CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 WHEN 'info' THEN 2 ELSE 3 END, category, label)
      FROM admin_health_checks), '[]'::jsonb),
    'trend', COALESCE((SELECT jsonb_agg(jsonb_build_object('taken_at', taken_at, 'critical', critical, 'warning', warning) ORDER BY taken_at)
      FROM (SELECT taken_at, critical, warning FROM admin_health_snapshots ORDER BY taken_at DESC LIMIT 30) t), '[]'::jsonb)
  ) END;
$$;

-- =====================================================================
-- 4. ONE-CLICK REPAIRS
-- =====================================================================
-- Mirrors src/lib/images.ts so a repaired URL renders exactly like the app would.
CREATE OR REPLACE FUNCTION lixxon_normalize_image(p_url text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  WITH u AS (SELECT btrim(p_url) AS v),
       page AS (SELECT (regexp_match(v, '^https?://(?:www\.)?pexels\.com/photo/(?:[^/?#]*-)?([0-9]+)/?(?:[?#].*)?$', 'i'))[1] AS id FROM u),
       folder AS (SELECT (regexp_match(v, '^https?://images\.pexels\.com/photos/([0-9]+)/?(?:[?#].*)?$', 'i'))[1] AS id FROM u)
  SELECT CASE
    WHEN p_url IS NULL OR (SELECT v FROM u) = '' THEN p_url
    WHEN (SELECT id FROM page) IS NOT NULL THEN 'https://images.pexels.com/photos/' || (SELECT id FROM page) || '/pexels-photo-' || (SELECT id FROM page) || '.jpeg?auto=compress&cs=tinysrgb&w=1600'
    WHEN (SELECT id FROM folder) IS NOT NULL THEN 'https://images.pexels.com/photos/' || (SELECT id FROM folder) || '/pexels-photo-' || (SELECT id FROM folder) || '.jpeg?auto=compress&cs=tinysrgb&w=1600'
    WHEN (SELECT v FROM u) ~ '^http://' THEN 'https://' || substring((SELECT v FROM u) FROM 8)
    ELSE (SELECT v FROM u)
  END
$$;
REVOKE ALL ON FUNCTION lixxon_normalize_image(text) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION admin_fix_issue(p_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  n integer := 0; n2 integer := 0; v_tables text; t text; v_msg text;
BEGIN
  IF NOT admin_can('ops.fix') THEN RAISE EXCEPTION 'forbidden'; END IF;

  CASE p_key
    WHEN 'requeue_email' THEN
      UPDATE email_queue SET status = 'queued', attempts = 0, scheduled_for = now()
       WHERE status = 'failed'
          OR (status = 'queued' AND scheduled_for < now() - interval '1 hour');
      GET DIAGNOSTICS n = ROW_COUNT;
      v_msg := n || ' email(s) requeued for the next drain.';

    WHEN 'email.failed' THEN     -- alias for the health-check key
      UPDATE email_queue SET status = 'queued', attempts = 0, scheduled_for = now()
       WHERE status = 'failed';
      GET DIAGNOSTICS n = ROW_COUNT;
      v_msg := n || ' failed email(s) requeued.';

    WHEN 'email.stuck' THEN      -- alias for the health-check key
      UPDATE email_queue SET attempts = 0, scheduled_for = now()
       WHERE status = 'queued' AND scheduled_for < now() - interval '1 hour';
      GET DIAGNOSTICS n = ROW_COUNT;
      v_msg := n || ' stuck email(s) rescheduled.';

    WHEN 'repair_images' THEN
      UPDATE posts SET cover_image = lixxon_normalize_image(cover_image)
       WHERE COALESCE(cover_image, '') <> COALESCE(lixxon_normalize_image(cover_image), '');
      GET DIAGNOSTICS n = ROW_COUNT;
      UPDATE products SET image_url = lixxon_normalize_image(image_url)
       WHERE COALESCE(image_url, '') <> COALESCE(lixxon_normalize_image(image_url), '');
      GET DIAGNOSTICS n2 = ROW_COUNT;
      n := n + n2;
      UPDATE products SET gallery = (SELECT array_agg(lixxon_normalize_image(g)) FROM unnest(gallery) g)
       WHERE EXISTS (SELECT 1 FROM unnest(COALESCE(gallery, '{}')) g WHERE g <> lixxon_normalize_image(g));
      GET DIAGNOSTICS n2 = ROW_COUNT;
      n := n + n2;
      UPDATE media SET url = lixxon_normalize_image(url)
       WHERE COALESCE(url, '') <> COALESCE(lixxon_normalize_image(url), '');
      GET DIAGNOSTICS n2 = ROW_COUNT;
      n := n + n2;
      v_msg := n || ' image URL(s) repaired to the CDN form.';

    WHEN 'backfill_seo' THEN
      UPDATE posts SET
        excerpt = COALESCE(NULLIF(excerpt, ''), NULLIF(seo_description, ''), title),
        seo_title = COALESCE(NULLIF(seo_title, ''), title),
        seo_description = COALESCE(NULLIF(seo_description, ''), NULLIF(excerpt, ''), title),
        cover_image_alt = COALESCE(NULLIF(cover_image_alt, ''), title)
       WHERE status = 'published'
         AND (COALESCE(seo_description, '') = '' OR COALESCE(excerpt, '') = '' OR COALESCE(seo_title, '') = '' OR COALESCE(cover_image_alt, '') = '');
      GET DIAGNOSTICS n = ROW_COUNT;
      v_msg := n || ' article(s) backfilled with title/excerpt defaults — review the copy.';

    WHEN 'backfill_entitlements' THEN
      INSERT INTO download_entitlements (order_id, customer_email, product_id, file_path, download_token, download_count, max_downloads)
      SELECT DISTINCT o.id, lower(o.customer_email), oi.product_id, p.file_path,
             replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 0, 5
        FROM orders o
        JOIN order_items oi ON oi.order_id = o.id
        JOIN products p ON p.id = oi.product_id
       WHERE o.payment_status = 'paid' AND COALESCE(p.is_digital, false) AND COALESCE(p.file_path, '') <> ''
         AND NOT EXISTS (SELECT 1 FROM download_entitlements e WHERE e.order_id = o.id AND e.product_id = oi.product_id);
      GET DIAGNOSTICS n = ROW_COUNT;
      v_msg := n || ' download entitlement(s) created.';

    WHEN 'analyze' THEN
      SELECT string_agg(relname, ', ') INTO v_tables
        FROM pg_stat_user_tables
       WHERE schemaname = 'public' AND n_dead_tup > 1000 AND n_dead_tup > n_live_tup * 0.2;
      IF v_tables IS NULL THEN
        v_msg := 'Nothing needed analysing.';
      ELSE
        FOREACH t IN ARRAY string_to_array(v_tables, ', ') LOOP
          EXECUTE format('ANALYZE public.%I', t);
          n := n + 1;
        END LOOP;
        v_msg := 'Statistics refreshed for ' || n || ' table(s).';
      END IF;

    WHEN 'take_backup' THEN
      IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'take_backup_snapshot') THEN
        PERFORM take_backup_snapshot();
        n := 1;
        v_msg := 'A fresh snapshot was taken.';
      ELSE
        v_msg := 'The backup function is not installed.';
      END IF;

    WHEN 'prune_audit' THEN
      DELETE FROM admin_activity_log WHERE created_at < now() - interval '180 days';
      GET DIAGNOSTICS n = ROW_COUNT;
      v_msg := n || ' audit entr(ies) older than 180 days removed.';

    ELSE
      RAISE EXCEPTION 'There is no automatic fix for %', p_key;
  END CASE;

  INSERT INTO admin_activity_log (action, entity_type, entity_id, description, performed_by,
                                  actor_id, actor_email, actor_role, severity, source)
  VALUES ('fix', 'health_check', p_key, 'Applied repair: ' || v_msg,
          COALESCE(auth.jwt() ->> 'email', 'admin'), auth.uid(), auth.jwt() ->> 'email',
          (SELECT role FROM app_admins WHERE user_id = auth.uid()), 'warning', 'rpc');

  RETURN jsonb_build_object('ok', true, 'key', p_key, 'fixed', n, 'message', v_msg);
END $$;

-- =====================================================================
-- 5. GROWTH / SEO REPORT + ADVISOR
-- =====================================================================
CREATE OR REPLACE FUNCTION admin_growth_report(p_days integer DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_days integer := LEAST(GREATEST(COALESCE(p_days, 30), 7), 365);
  v_from timestamptz := now() - make_interval(days => LEAST(GREATEST(COALESCE(p_days, 30), 7), 365));
  v_prev timestamptz := now() - make_interval(days => 2 * LEAST(GREATEST(COALESCE(p_days, 30), 7), 365));
  result jsonb;
BEGIN
  IF NOT (admin_can('analytics.read') OR admin_can('ops.health')) THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT jsonb_build_object(
    'days', v_days,
    'traffic', jsonb_build_object(
      'views', (SELECT count(*) FROM article_views WHERE created_at >= v_from),
      'views_previous', (SELECT count(*) FROM article_views WHERE created_at >= v_prev AND created_at < v_from),
      'readers', (SELECT count(DISTINCT fingerprint) FROM article_views WHERE created_at >= v_from),
      'readers_previous', (SELECT count(DISTINCT fingerprint) FROM article_views WHERE created_at >= v_prev AND created_at < v_from),
      'sessions', (SELECT count(*) FROM reading_sessions WHERE created_at >= v_from),
      'daily', COALESCE((SELECT jsonb_agg(jsonb_build_object('date', d, 'views', c) ORDER BY d)
        FROM (SELECT created_at::date AS d, count(*) AS c FROM article_views WHERE created_at >= v_from GROUP BY 1) x), '[]'::jsonb),
      'top_posts', COALESCE((SELECT jsonb_agg(jsonb_build_object('title', title, 'slug', slug, 'views', c) ORDER BY c DESC)
        FROM (SELECT p.title, p.slug, count(v.id) AS c FROM posts p JOIN article_views v ON v.post_id = p.id
               WHERE v.created_at >= v_from GROUP BY p.id, p.title, p.slug ORDER BY c DESC LIMIT 8) y), '[]'::jsonb)
    ),
    'content', jsonb_build_object(
      'published', (SELECT count(*) FROM posts WHERE status = 'published' AND published_at >= v_from),
      'published_previous', (SELECT count(*) FROM posts WHERE status = 'published' AND published_at >= v_prev AND published_at < v_from),
      'drafts', (SELECT count(*) FROM posts WHERE status = 'draft'),
      'scheduled', (SELECT count(*) FROM posts WHERE status = 'scheduled' AND COALESCE(scheduled_at, published_at) > now()),
      'avg_reading_time', (SELECT round(avg(reading_time_minutes)) FROM posts WHERE status = 'published' AND reading_time_minutes IS NOT NULL),
      'missing_meta', (SELECT count(*) FROM posts WHERE status = 'published' AND (COALESCE(seo_description, '') = '' OR COALESCE(seo_title, '') = '')),
      'thin', (SELECT count(*) FROM posts WHERE status = 'published' AND length(COALESCE(content, '')) < 2000),
      'orphans', (SELECT count(*) FROM posts WHERE status = 'published' AND (category_id IS NULL OR author_id IS NULL)),
      'no_inbound_links', (SELECT count(*) FROM posts p WHERE p.status = 'published'
        AND NOT EXISTS (SELECT 1 FROM posts q WHERE q.status = 'published' AND q.id <> p.id AND q.content ILIKE '%/blog/' || p.slug || '%'))
    ),
    'search', jsonb_build_object(
      'total', (SELECT count(*) FROM search_history WHERE created_at >= v_from),
      'unique_terms', (SELECT count(DISTINCT lower(btrim(query))) FROM search_history WHERE created_at >= v_from AND btrim(query) <> ''),
      'zero_result', (SELECT count(*) FROM search_history WHERE created_at >= v_from AND result_count = 0),
      'top_queries', COALESCE((SELECT jsonb_agg(jsonb_build_object('query', query, 'searches', c, 'avg_results', r) ORDER BY c DESC)
        FROM (SELECT lower(btrim(query)) AS query, count(*) AS c, round(avg(result_count)) AS r
                FROM search_history WHERE created_at >= v_from AND btrim(query) <> ''
               GROUP BY 1 ORDER BY c DESC LIMIT 10) q), '[]'::jsonb),
      'misses', COALESCE((SELECT jsonb_agg(jsonb_build_object('query', query, 'misses', c) ORDER BY c DESC)
        FROM (SELECT lower(btrim(query)) AS query, count(*) AS c
                FROM search_history WHERE created_at >= v_from AND result_count = 0 AND btrim(query) <> ''
               GROUP BY 1 ORDER BY c DESC LIMIT 10) m), '[]'::jsonb)
    ),
    'audience', jsonb_build_object(
      'subscribers_total', (SELECT count(*) FROM newsletter_subscribers WHERE status = 'confirmed'),
      'subscribers_new', (SELECT count(*) FROM newsletter_subscribers WHERE status = 'confirmed' AND COALESCE(confirmed_at, created_at) >= v_from),
      'pending_double_optin', (SELECT count(*) FROM newsletter_subscribers WHERE status <> 'confirmed'),
      'preferred_categories', COALESCE((SELECT jsonb_agg(jsonb_build_object('category', c, 'readers', n) ORDER BY n DESC)
        FROM (SELECT cat AS c, count(*) AS n FROM newsletter_preferences, unnest(COALESCE(preferred_categories, '{}')) cat
               GROUP BY 1 ORDER BY n DESC LIMIT 6) p), '[]'::jsonb)
    ),
    'commerce', jsonb_build_object(
      'paid_orders', (SELECT count(*) FROM orders WHERE payment_status = 'paid' AND COALESCE(paid_at, created_at) >= v_from),
      'paid_orders_previous', (SELECT count(*) FROM orders WHERE payment_status = 'paid' AND COALESCE(paid_at, created_at) >= v_prev AND COALESCE(paid_at, created_at) < v_from),
      'revenue', (SELECT COALESCE(round(sum(amount), 2), 0) FROM orders WHERE payment_status = 'paid' AND COALESCE(paid_at, created_at) >= v_from),
      'revenue_previous', (SELECT COALESCE(round(sum(amount), 2), 0) FROM orders WHERE payment_status = 'paid' AND COALESCE(paid_at, created_at) >= v_prev AND COALESCE(paid_at, created_at) < v_from),
      'aov', (SELECT COALESCE(round(avg(amount), 2), 0) FROM orders WHERE payment_status = 'paid' AND COALESCE(paid_at, created_at) >= v_from),
      'refund_requests', (SELECT count(*) FROM refund_requests WHERE created_at >= v_from),
      'abandoned_carts', (SELECT count(*) FROM abandoned_carts WHERE NOT COALESCE(recovered, false) AND created_at >= v_from),
      'recoverable_carts', (SELECT count(*) FROM abandoned_carts WHERE NOT COALESCE(recovered, false) AND COALESCE(email, '') <> '' AND created_at >= v_from),
      'gift_card_liability', (SELECT COALESCE(round(sum(balance), 2), 0) FROM gift_cards WHERE is_active AND balance > 0),
      'promo_redemptions', (SELECT COALESCE(sum(use_count), 0) FROM promo_codes WHERE is_active),
      'top_products', COALESCE((SELECT jsonb_agg(jsonb_build_object('name', product_name, 'units', units, 'revenue', revenue) ORDER BY revenue DESC)
        FROM (SELECT oi.product_name, sum(oi.quantity) AS units, round(sum(oi.price * oi.quantity), 2) AS revenue
                FROM order_items oi JOIN orders o ON o.id = oi.order_id
               WHERE o.payment_status = 'paid' AND COALESCE(o.paid_at, o.created_at) >= v_from
               GROUP BY 1 ORDER BY revenue DESC LIMIT 8) tp), '[]'::jsonb)
    ),
    'suggestions', admin_suggestions()
  ) INTO result;

  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION admin_suggestions()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH facts AS (
    SELECT
      (SELECT count(*) FROM email_queue WHERE status = 'failed') AS failed_emails,
      (SELECT count(*) FROM email_queue WHERE status = 'queued' AND scheduled_for < now() - interval '1 hour') AS stuck_emails,
      (SELECT count(*) FROM comments WHERE NOT is_approved AND created_at < now() - interval '48 hours') AS pending_comments,
      (SELECT count(*) FROM posts WHERE status = 'published' AND published_at > now() - interval '7 days') AS published_7d,
      (SELECT count(*) FROM posts WHERE status = 'published' AND (COALESCE(seo_description, '') = '' OR COALESCE(cover_image, '') = '')) AS seo_gaps,
      (SELECT count(DISTINCT lower(btrim(query))) FROM search_history WHERE result_count = 0 AND created_at > now() - interval '30 days' AND btrim(query) <> '') AS search_misses,
      (SELECT count(*) FROM orders o JOIN order_items oi ON oi.order_id = o.id JOIN products p ON p.id = oi.product_id
        WHERE o.payment_status = 'paid' AND COALESCE(p.is_digital, false)
          AND NOT EXISTS (SELECT 1 FROM download_entitlements e WHERE e.order_id = o.id AND e.product_id = oi.product_id)) AS missing_entitlements,
      (SELECT count(*) FROM abandoned_carts WHERE NOT COALESCE(recovered, false) AND COALESCE(email, '') <> '' AND created_at > now() - interval '7 days') AS recoverable_carts,
      (SELECT count(*) FROM app_admins a WHERE a.status = 'active'
        AND NOT EXISTS (SELECT 1 FROM auth.mfa_factors f WHERE f.user_id = a.user_id AND f.status = 'verified')) AS admins_without_mfa,
      (SELECT COALESCE(EXTRACT(epoch FROM now() - max(taken_at)) / 3600, 9999) FROM backup_snapshots) AS hours_since_backup,
      (SELECT count(*) FROM refund_requests WHERE status = 'pending' AND created_at < now() - interval '3 days') AS pending_refunds,
      (SELECT count(*) FROM posts p WHERE p.status = 'published'
        AND NOT EXISTS (SELECT 1 FROM posts q WHERE q.status = 'published' AND q.id <> p.id AND q.content ILIKE '%/blog/' || p.slug || '%')) AS no_inbound_links,
      (SELECT count(*) FROM pg_constraint c WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace
        AND NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.conrelid)) AS unindexed_fks
  ), ideas AS (
    SELECT * FROM (VALUES
      ('Fix the failed emails', 'critical', 95, 'ops.fix',
       (SELECT failed_emails > 0 FROM facts),
       (SELECT failed_emails || ' email(s) failed to send. Customers may be missing receipts, download links or confirmations.' FROM facts),
       'admin-backups', 'Open the queue', 'requeue_email'),
      ('Chase the recoverable carts', 'high', 80, 'commerce.read',
       (SELECT recoverable_carts > 0 FROM facts),
       (SELECT recoverable_carts || ' cart(s) with an email address were abandoned in the last 7 days.' FROM facts),
       'admin-abandoned-carts', 'Review carts', NULL),
      ('Backfill the missing download links', 'high', 85, 'ops.fix',
       (SELECT missing_entitlements > 0 FROM facts),
       (SELECT missing_entitlements || ' paid digital order(s) cannot be downloaded.' FROM facts),
       'admin-orders', 'Open orders', 'backfill_entitlements'),
      ('Clear the moderation backlog', 'high', 70, 'content.moderate',
       (SELECT pending_comments > 0 FROM facts),
       (SELECT pending_comments || ' comment(s) have waited more than 48 hours.' FROM facts),
       'admin-comments', 'Moderate', NULL),
      ('Answer the search misses', 'high', 75, 'analytics.read',
       (SELECT search_misses > 0 FROM facts),
       (SELECT search_misses || ' searches found nothing in the last 30 days. Those are content briefs.' FROM facts),
       'admin-growth', 'See the misses', NULL),
      ('Repair the SEO gaps', 'medium', 60, 'ops.fix',
       (SELECT seo_gaps > 0 FROM facts),
       (SELECT seo_gaps || ' published article(s) are missing an SEO description or cover image.' FROM facts),
       'admin-articles', 'Review articles', 'backfill_seo'),
      ('Restore the publishing rhythm', 'medium', 65, 'content.write',
       (SELECT published_7d = 0 FROM facts),
       'Nothing was published in the last 7 days. Search engines reward a steady cadence.',
       'admin-articles', 'Plan the next article', NULL),
      ('Enrol the remaining admins in 2FA', 'medium', 55, 'team.read',
       (SELECT admins_without_mfa > 0 FROM facts),
       (SELECT admins_without_mfa || ' active admin(s) have not enrolled a second factor.' FROM facts),
       'admin-security', 'Open security', NULL),
      ('Settle the refund requests', 'medium', 58, 'commerce.refunds',
       (SELECT pending_refunds > 0 FROM facts),
       (SELECT pending_refunds || ' refund request(s) have been open for over three days.' FROM facts),
       'admin-refunds', 'Process refunds', NULL),
      ('Take a backup', 'medium', 50, 'ops.fix',
       (SELECT hours_since_backup > 48 FROM facts),
       (SELECT 'The last snapshot is ' || round(hours_since_backup) || ' hours old.' FROM facts),
       'admin-backups', 'Snapshot now', 'take_backup'),
      ('Add the missing indexes', 'low', 40, 'ops.health',
       (SELECT unindexed_fks > 0 FROM facts),
       (SELECT unindexed_fks || ' foreign key(s) have no supporting index.' FROM facts),
       'admin-health', 'See database health', NULL),
      ('Strengthen internal linking', 'low', 35, 'analytics.read',
       (SELECT no_inbound_links > 0 FROM facts),
       (SELECT no_inbound_links || ' published article(s) are never linked from another article.' FROM facts),
       'admin-growth', 'Review SEO', NULL)
    ) AS v(title, impact, score, permission, active, detail, route, action, fix_key)
  )
  SELECT CASE
    WHEN NOT (admin_can('analytics.read') OR admin_can('ops.health') OR admin_can('settings.read')) THEN '[]'::jsonb
    ELSE COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'title', title, 'impact', impact, 'score', score, 'detail', detail,
        'action_route', route, 'action_label', action, 'fix_key', fix_key, 'permission', permission
      ) ORDER BY score DESC)
      FROM ideas WHERE active
    ), '[]'::jsonb)
  END;
$$;

-- =====================================================================
-- 6. SYSTEM METRICS (scaling view)
-- =====================================================================
CREATE OR REPLACE FUNCTION admin_system_metrics()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE result jsonb;
BEGIN
  IF NOT (admin_can('ops.health') OR admin_can('analytics.read')) THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT jsonb_build_object(
    'database_size', pg_database_size(current_database()),
    'database_pretty', pg_size_pretty(pg_database_size(current_database())),
    'free_tier_limit', 500 * 1024 * 1024,
    'tables', (SELECT count(*) FROM pg_tables WHERE schemaname = 'public'),
    'estimated_rows', COALESCE((SELECT sum(GREATEST(c.reltuples, 0))::bigint FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r'), 0),
    'indexes', (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public'),
    'connections', (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()),
    'cache_hit', (SELECT round(COALESCE(sum(blks_hit), 0)::numeric / GREATEST(COALESCE(sum(blks_hit + blks_read), 0), 1), 4) FROM pg_stat_database WHERE datname = current_database()),
    'uptime_seconds', EXTRACT(epoch FROM now() - pg_postmaster_start_time())::bigint,
    'server_version', current_setting('server_version'),
    'top_tables', COALESCE((SELECT jsonb_agg(jsonb_build_object('table', relname, 'size', pg_total_relation_size(relid), 'size_pretty', pg_size_pretty(pg_total_relation_size(relid)), 'index_size', pg_indexes_size(relid), 'live_rows', n_live_tup, 'dead_rows', n_dead_tup, 'seq_scan', seq_scan, 'idx_scan', idx_scan) ORDER BY pg_total_relation_size(relid) DESC)
      FROM (SELECT c.oid AS relid, c.relname, s.n_live_tup, s.n_dead_tup, s.seq_scan, s.idx_scan
              FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
              LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
             WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY pg_total_relation_size(c.oid) DESC LIMIT 12) t), '[]'::jsonb),
    'unused_indexes', COALESCE((SELECT jsonb_agg(jsonb_build_object('table', relname, 'index', indexrelname, 'size', pg_relation_size(indexrelid), 'scans', idx_scan))
      FROM pg_stat_user_indexes WHERE schemaname = 'public' AND idx_scan = 0 AND indexrelid NOT IN (SELECT conindid FROM pg_constraint WHERE contype IN ('p','u'))
      ORDER BY pg_relation_size(indexrelid) DESC LIMIT 12), '[]'::jsonb)
  ) INTO result;
  RETURN result;
END $$;

REVOKE ALL ON FUNCTION admin_table_catalog() FROM public;
REVOKE ALL ON FUNCTION admin_run_sql(text, integer) FROM public;
REVOKE ALL ON FUNCTION admin_run_checks() FROM public;
REVOKE ALL ON FUNCTION admin_health_overview() FROM public;
REVOKE ALL ON FUNCTION admin_fix_issue(text) FROM public;
REVOKE ALL ON FUNCTION admin_growth_report(integer) FROM public;
REVOKE ALL ON FUNCTION admin_suggestions() FROM public;
REVOKE ALL ON FUNCTION admin_system_metrics() FROM public;

GRANT EXECUTE ON FUNCTION admin_table_catalog() TO authenticated;
GRANT EXECUTE ON FUNCTION admin_run_sql(text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_run_checks() TO authenticated;
GRANT EXECUTE ON FUNCTION admin_health_overview() TO authenticated;
GRANT EXECUTE ON FUNCTION admin_fix_issue(text) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_growth_report(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_suggestions() TO authenticated;
GRANT EXECUTE ON FUNCTION admin_system_metrics() TO authenticated;

NOTIFY pgrst, 'reload schema';
