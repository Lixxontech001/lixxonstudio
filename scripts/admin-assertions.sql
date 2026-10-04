-- Admin super panel assertions: RBAC, audit trail, SQL sandbox, explorer, health, settings.
-- Every block raises if the database lets someone do something they should not, or stops
-- someone who should be allowed. Runs after every migration (scripts/db-test.py).
\set ON_ERROR_STOP on

-- ---------- fixtures ----------
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-0000000000ab', 'reader@example.com'),
  ('00000000-0000-0000-0000-0000000000c3', 'editor@example.com'),
  ('00000000-0000-0000-0000-0000000000d4', 'moderator@example.com'),
  ('00000000-0000-0000-0000-0000000000e5', 'support@example.com'),
  ('00000000-0000-0000-0000-0000000000f6', 'suspended@example.com'),
  ('00000000-0000-0000-0000-0000000000aa', 'secondowner@example.com')
ON CONFLICT DO NOTHING;

INSERT INTO app_admins (user_id, role, display_name) VALUES
  ('00000000-0000-0000-0000-0000000000c3', 'editor', 'Editor Eve'),
  ('00000000-0000-0000-0000-0000000000d4', 'moderator', 'Mod Mo'),
  ('00000000-0000-0000-0000-0000000000e5', 'support', 'Support Sam'),
  ('00000000-0000-0000-0000-0000000000f6', 'editor', 'Suspended Sue'),
  ('00000000-0000-0000-0000-0000000000aa', 'owner', 'Second Owner')
ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role, status = 'active';
UPDATE app_admins SET status = 'suspended' WHERE user_id = '00000000-0000-0000-0000-0000000000f6';

INSERT INTO posts (id, title, slug, status, excerpt) VALUES
  ('40000000-0000-0000-0000-000000000001', 'RBAC test article', 'rbac-test-article', 'draft', 'A fixture.')
ON CONFLICT (id) DO NOTHING;

INSERT INTO products (id, name, price, slug, is_active, image_url) VALUES
  ('50000000-0000-0000-0000-000000000001', 'RBAC test product', '9.99', 'rbac-test-product', true,
   'https://www.pexels.com/photo/some-cream-1234567/')
ON CONFLICT (id) DO NOTHING;

INSERT INTO email_queue (to_email, subject, html, kind, status, attempts, scheduled_for) VALUES
  ('stuck@example.com', 'Receipt', '<p>x</p>', 'receipt', 'failed', 3, now() - interval '2 hours')
ON CONFLICT DO NOTHING;

-- ---------- helpers ----------
CREATE OR REPLACE FUNCTION _adm_run(role_name text, claims jsonb, stmt text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('SET LOCAL ROLE %I', role_name);
  PERFORM set_config('request.jwt.claims', claims::text, true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(claims->>'sub', ''), true);
  PERFORM set_config('request.jwt.claim.role', COALESCE(claims->>'role', role_name), true);
  EXECUTE stmt;
  RESET ROLE;
  RESET default_transaction_read_only;
END $$;

CREATE OR REPLACE FUNCTION _adm_count(role_name text, claims jsonb, q text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  EXECUTE format('SET LOCAL ROLE %I', role_name);
  PERFORM set_config('request.jwt.claims', claims::text, true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(claims->>'sub', ''), true);
  PERFORM set_config('request.jwt.claim.role', COALESCE(claims->>'role', role_name), true);
  EXECUTE 'SELECT count(*) FROM (' || q || ') s' INTO n;
  RESET ROLE;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION _adm_text(role_name text, claims jsonb, expr text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  EXECUTE format('SET LOCAL ROLE %I', role_name);
  PERFORM set_config('request.jwt.claims', claims::text, true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(claims->>'sub', ''), true);
  PERFORM set_config('request.jwt.claim.role', COALESCE(claims->>'role', role_name), true);
  EXECUTE 'SELECT (' || expr || ')::text' INTO v;
  RESET ROLE;
  RESET default_transaction_read_only;
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION _adm_raises(role_name text, claims jsonb, stmt text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('SET LOCAL ROLE %I', role_name);
  PERFORM set_config('request.jwt.claims', claims::text, true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(claims->>'sub', ''), true);
  PERFORM set_config('request.jwt.claim.role', COALESCE(claims->>'role', role_name), true);
  BEGIN
    EXECUTE stmt;
    RESET ROLE;
    RETURN false;
  EXCEPTION WHEN others THEN
    RESET ROLE;
    RETURN true;
  END;
END $$;

DO $$
DECLARE
  anon_claims jsonb := '{"role":"anon"}';
  reader jsonb := '{"role":"authenticated","sub":"00000000-0000-0000-0000-0000000000ab","email":"reader@example.com"}';
  owner jsonb := '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000001","email":"owner@lixxonstudio.com"}';
  editor jsonb := '{"role":"authenticated","sub":"00000000-0000-0000-0000-0000000000c3","email":"editor@example.com"}';
  moderator jsonb := '{"role":"authenticated","sub":"00000000-0000-0000-0000-0000000000d4","email":"moderator@example.com"}';
  support jsonb := '{"role":"authenticated","sub":"00000000-0000-0000-0000-0000000000e5","email":"support@example.com"}';
  suspended jsonb := '{"role":"authenticated","sub":"00000000-0000-0000-0000-0000000000f6","email":"suspended@example.com"}';
  v_text text; v_bool boolean; v_count bigint; v_log uuid; v_price text;
BEGIN
  -- ================= 1. the catalogue and the super admin =================
  IF (SELECT count(*) FROM admin_permissions) < 30 THEN RAISE EXCEPTION 'permission catalogue not seeded'; END IF;
  IF (SELECT count(*) FROM admin_roles) < 5 THEN RAISE EXCEPTION 'roles not seeded'; END IF;
  IF (SELECT count(*) FROM role_permissions WHERE role = 'owner') <> (SELECT count(*) FROM admin_permissions) THEN
    RAISE EXCEPTION 'the owner role must hold every permission';
  END IF;
  IF (SELECT count(*) FROM app_admins WHERE is_founder) <> 1 THEN RAISE EXCEPTION 'exactly one founder expected'; END IF;

  IF NOT _adm_text('authenticated', owner, $q$ admin_can('team.manage') $q$)::boolean THEN RAISE EXCEPTION 'owner cannot manage the team'; END IF;
  IF NOT _adm_text('authenticated', owner, $q$ is_founder() $q$)::boolean THEN RAISE EXCEPTION 'owner is not the founder'; END IF;
  IF NOT _adm_text('authenticated', owner, $q$ array_length(admin_effective_permissions(), 1) >= 30 $q$)::boolean THEN
    RAISE EXCEPTION 'owner is missing effective permissions';
  END IF;
  IF _adm_text('authenticated', owner, $q$ admin_me()->>'role' $q$) <> 'owner' THEN RAISE EXCEPTION 'admin_me() must report the role'; END IF;
  IF NOT _adm_text('authenticated', owner, $q$ admin_me()->>'is_founder' $q$)::boolean THEN RAISE EXCEPTION 'admin_me() must report the founder flag'; END IF;

  -- ================= 2. non-admins and anon =================
  IF _adm_text('authenticated', reader, $q$ admin_can('content.read') $q$)::boolean THEN RAISE EXCEPTION 'a reader can call admin_can true'; END IF;
  IF _adm_count('authenticated', reader, 'SELECT 1 FROM admin_team()') > 0 THEN RAISE EXCEPTION 'a reader can list the team'; END IF;
  IF _adm_text('authenticated', reader, $q$ admin_table_catalog() $q$) <> '[]' THEN RAISE EXCEPTION 'a reader can read the explorer catalogue'; END IF;
  IF NOT _adm_raises('authenticated', reader, $q$ SELECT admin_audit_search('{}'::jsonb) $q$) THEN RAISE EXCEPTION 'a reader can search the audit log'; END IF;
  IF NOT _adm_raises('authenticated', reader, $q$ SELECT admin_run_sql('SELECT 1') $q$) THEN RAISE EXCEPTION 'a reader can run SQL'; END IF;
  IF NOT _adm_raises('authenticated', reader, $q$ SELECT admin_run_checks() $q$) THEN RAISE EXCEPTION 'a reader can run health checks'; END IF;
  IF NOT _adm_raises('authenticated', reader, $q$ SELECT admin_fix_issue('analyze') $q$) THEN RAISE EXCEPTION 'a reader can apply fixes'; END IF;
  IF _adm_count('authenticated', reader, 'SELECT 1 FROM app_admins WHERE user_id <> auth.uid()') > 0 THEN
    RAISE EXCEPTION 'a reader can see other admin rows';
  END IF;

  -- ================= 3. the editor role is scoped =================
  IF NOT _adm_text('authenticated', editor, $q$ admin_can('content.write') $q$)::boolean THEN RAISE EXCEPTION 'editor cannot write content'; END IF;
  IF _adm_text('authenticated', editor, $q$ admin_can('team.manage') $q$)::boolean THEN RAISE EXCEPTION 'editor can manage the team'; END IF;
  IF _adm_text('authenticated', editor, $q$ admin_can('commerce.pricing') $q$)::boolean THEN RAISE EXCEPTION 'editor can change prices'; END IF;
  IF _adm_text('authenticated', editor, $q$ admin_can('data.sql') $q$)::boolean THEN RAISE EXCEPTION 'editor can run SQL'; END IF;
  IF _adm_text('authenticated', editor, $q$ admin_can('audit.revert') $q$)::boolean THEN RAISE EXCEPTION 'editor can revert audit entries'; END IF;

  -- RLS: an editor reads content but not money or PII
  IF _adm_count('authenticated', editor, 'SELECT 1 FROM posts') < 1 THEN RAISE EXCEPTION 'editor cannot read articles'; END IF;
  IF _adm_count('authenticated', editor, 'SELECT 1 FROM promo_codes') > 0 THEN RAISE EXCEPTION 'editor can read promo codes'; END IF;
  IF _adm_count('authenticated', editor, 'SELECT 1 FROM orders') > 0 THEN RAISE EXCEPTION 'editor can read orders'; END IF;
  IF _adm_count('authenticated', editor, 'SELECT 1 FROM customers') > 0 THEN RAISE EXCEPTION 'editor can read customers'; END IF;
  IF _adm_count('authenticated', editor, 'SELECT 1 FROM backup_snapshots') > 0 THEN RAISE EXCEPTION 'editor can read backups'; END IF;
  IF _adm_count('authenticated', editor, 'SELECT 1 FROM email_queue') > 0 THEN RAISE EXCEPTION 'editor can read the email queue'; END IF;

  -- moderator: community only
  IF NOT _adm_text('authenticated', moderator, $q$ admin_can('content.moderate') $q$)::boolean THEN RAISE EXCEPTION 'moderator cannot moderate'; END IF;
  IF _adm_text('authenticated', moderator, $q$ admin_can('content.write') $q$)::boolean THEN RAISE EXCEPTION 'moderator can write articles'; END IF;
  IF _adm_count('authenticated', moderator, 'SELECT 1 FROM orders') > 0 THEN RAISE EXCEPTION 'moderator can read orders'; END IF;

  -- support: money read + refunds, no content writing
  IF NOT _adm_text('authenticated', support, $q$ admin_can('commerce.refunds') $q$)::boolean THEN RAISE EXCEPTION 'support cannot process refunds'; END IF;
  IF _adm_count('authenticated', support, 'SELECT 1 FROM orders') < 1 THEN RAISE EXCEPTION 'support cannot read orders'; END IF;
  IF _adm_text('authenticated', support, $q$ admin_can('content.write') $q$)::boolean THEN RAISE EXCEPTION 'support can write articles'; END IF;

  -- ================= 4. publishing is its own capability =================
  IF _adm_text('authenticated', editor, $q$ admin_can('content.publish') $q$)::boolean <> true THEN RAISE EXCEPTION 'editor should publish by default'; END IF;
  PERFORM _adm_run('authenticated', owner, $q$ SELECT admin_set_role_permission('editor', 'content.publish', false) $q$);
  IF _adm_text('authenticated', editor, $q$ admin_can('content.publish') $q$)::boolean THEN RAISE EXCEPTION 'role permission removal had no effect'; END IF;
  IF NOT _adm_raises('authenticated', editor, $q$UPDATE posts SET status = 'published' WHERE id = '40000000-0000-0000-0000-000000000001'$q$) THEN
    RAISE EXCEPTION 'a non-publisher managed to publish an article';
  END IF;
  IF (SELECT status FROM posts WHERE id = '40000000-0000-0000-0000-000000000001') <> 'draft' THEN
    RAISE EXCEPTION 'the draft changed despite the guard';
  END IF;
  PERFORM _adm_run('authenticated', owner, $q$ SELECT admin_set_role_permission('editor', 'content.publish', true) $q$);
  IF NOT _adm_text('authenticated', editor, $q$ admin_can('content.publish') $q$)::boolean THEN RAISE EXCEPTION 'role permission restore failed'; END IF;

  -- ================= 5. per-admin overrides =================
  PERFORM _adm_run('authenticated', owner,
    $q$ SELECT admin_set_override('00000000-0000-0000-0000-0000000000c3', 'content.publish', 'deny') $q$);
  IF _adm_text('authenticated', editor, $q$ admin_can('content.publish') $q$)::boolean THEN RAISE EXCEPTION 'deny override ignored'; END IF;
  PERFORM _adm_run('authenticated', owner,
    $q$ SELECT admin_set_override('00000000-0000-0000-0000-0000000000c3', 'commerce.pricing', 'grant') $q$);
  IF NOT _adm_text('authenticated', editor, $q$ admin_can('commerce.pricing') $q$)::boolean THEN RAISE EXCEPTION 'grant override ignored'; END IF;
  PERFORM _adm_run('authenticated', owner,
    $q$ SELECT admin_set_override('00000000-0000-0000-0000-0000000000c3', 'commerce.pricing', '') $q$);
  IF _adm_text('authenticated', editor, $q$ admin_can('commerce.pricing') $q$)::boolean THEN RAISE EXCEPTION 'override clear failed'; END IF;
  IF NOT _adm_raises('authenticated', owner,
      $q$ SELECT admin_set_override('00000000-0000-0000-0000-000000000001', 'content.read', 'deny') $q$) THEN
    RAISE EXCEPTION 'an override was accepted for the owner';
  END IF;

  -- ================= 6. suspension cuts access everywhere =================
  IF _adm_text('authenticated', suspended, $q$ is_admin() $q$)::boolean THEN RAISE EXCEPTION 'a suspended admin is still an admin'; END IF;
  IF _adm_text('authenticated', suspended, $q$ admin_can('content.read') $q$)::boolean THEN RAISE EXCEPTION 'a suspended admin keeps permissions'; END IF;
  -- public articles stay readable like any reader sees them; drafts must not
  IF _adm_count('authenticated', suspended, $q$SELECT 1 FROM posts WHERE status <> 'published'$q$) > 0 THEN
    RAISE EXCEPTION 'a suspended admin can still read drafts';
  END IF;
  IF _adm_count('authenticated', suspended, 'SELECT 1 FROM orders') > 0 THEN RAISE EXCEPTION 'a suspended admin can still read orders'; END IF;

  -- ================= 7. the founder is protected =================
  IF NOT _adm_raises('authenticated', owner,
      $q$ SELECT admin_update_member('00000000-0000-0000-0000-000000000001', NULL, NULL, 'suspended') $q$) THEN
    RAISE EXCEPTION 'the founder could be suspended';
  END IF;
  IF NOT _adm_raises('authenticated', owner,
      $q$ SELECT set_admin_role('owner@lixxonstudio.com', 'editor') $q$) THEN
    RAISE EXCEPTION 'the founder could be demoted';
  END IF;
  IF NOT _adm_raises('authenticated', owner,
      $q$ SELECT remove_admin('00000000-0000-0000-0000-000000000001') $q$) THEN
    RAISE EXCEPTION 'the founder could be removed';
  END IF;
  IF NOT _adm_raises('authenticated', owner,
      $q$ UPDATE app_admins SET is_founder = true WHERE user_id = '00000000-0000-0000-0000-0000000000aa' $q$) THEN
    RAISE EXCEPTION 'the founder flag could be forged';
  END IF;
  -- a second owner can be removed while the founder remains
  IF _adm_raises('authenticated', owner, $q$ SELECT remove_admin('00000000-0000-0000-0000-0000000000aa') $q$) THEN
    RAISE EXCEPTION 'a non-founder owner could not be removed';
  END IF;
  UPDATE app_admins SET role = 'owner' WHERE user_id = '00000000-0000-0000-0000-0000000000aa';

  -- ================= 8. the audit trail records real diffs =================
  UPDATE products SET price = '12.99' WHERE id = '50000000-0000-0000-0000-000000000001';
  SELECT id INTO v_log FROM admin_activity_log
   WHERE entity_type = 'products' AND entity_id = '50000000-0000-0000-0000-000000000001'
   ORDER BY seq DESC LIMIT 1;
  IF v_log IS NULL THEN RAISE EXCEPTION 'the product update was not audited'; END IF;
  IF (SELECT changes FROM admin_activity_log WHERE id = v_log) -> 'price' ->> 'from' <> '9.99' THEN
    RAISE EXCEPTION 'the audit diff did not record the previous value';
  END IF;
  IF (SELECT severity FROM admin_activity_log WHERE id = v_log) <> 'warning' THEN
    RAISE EXCEPTION 'money changes must be audited as warning severity';
  END IF;
  IF (SELECT actor_email FROM admin_activity_log WHERE id = v_log) IS NULL THEN
    RAISE EXCEPTION 'the audit entry has no actor email';
  END IF;
  -- no-op updates are not noise
  v_count := (SELECT count(*) FROM admin_activity_log WHERE entity_type = 'products');
  UPDATE products SET price = '12.99' WHERE id = '50000000-0000-0000-0000-000000000001';
  IF (SELECT count(*) FROM admin_activity_log WHERE entity_type = 'products') <> v_count THEN
    RAISE EXCEPTION 'a no-op update was audited';
  END IF;
  -- admin membership changes are critical
  IF NOT EXISTS (SELECT 1 FROM admin_activity_log
                  WHERE entity_type IN ('app_admins', 'app_admins'::text)
                    AND severity IN ('critical', 'warning')) THEN
    RAISE EXCEPTION 'team changes must be audited';
  END IF;

  -- audit search is filterable and paginated
  v_text := _adm_text('authenticated', owner, $q$ (admin_audit_search('{"entity_type":"products"}'::jsonb))->>'total' $q$);
  IF v_text::bigint < 1 THEN RAISE EXCEPTION 'audit search returned nothing for products'; END IF;
  IF _adm_raises('authenticated', editor, $q$ SELECT admin_audit_revert(gen_random_uuid()) $q$) THEN
    -- editor lacks audit.revert: this must raise, so the call above must NOT have succeeded
    NULL;
  ELSE
    RAISE EXCEPTION 'an editor could call audit revert';
  END IF;

  -- ================= 9. revert =================
  UPDATE products SET price = '1.00' WHERE id = '50000000-0000-0000-0000-000000000001';
  SELECT id INTO v_log FROM admin_activity_log
   WHERE entity_type = 'products' AND entity_id = '50000000-0000-0000-0000-000000000001'
     AND action = 'update' AND changes -> 'price' ->> 'to' = '1.00'
   ORDER BY seq DESC LIMIT 1;
  PERFORM _adm_run('authenticated', owner, format($q$ SELECT admin_audit_revert(%L) $q$, v_log));
  SELECT price INTO v_price FROM products WHERE id = '50000000-0000-0000-0000-000000000001';
  IF v_price <> '12.99' THEN RAISE EXCEPTION 'revert did not restore the previous value (got %)', v_price; END IF;
  IF (SELECT reverted_at FROM admin_activity_log WHERE id = v_log) IS NULL THEN
    RAISE EXCEPTION 'the reverted entry was not marked';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM admin_activity_log WHERE action = 'revert' AND revert_of = v_log) THEN
    RAISE EXCEPTION 'the revert was not itself audited';
  END IF;
  IF NOT _adm_raises('authenticated', owner, format($q$ SELECT admin_audit_revert(%L) $q$, v_log)) THEN
    RAISE EXCEPTION 'an entry could be reverted twice';
  END IF;

  -- ================= 10. health checks + repairs =================
  v_text := _adm_text('authenticated', owner, $q$ (admin_run_checks())->>'warning' $q$);
  IF v_text IS NULL THEN RAISE EXCEPTION 'health checks returned no summary'; END IF;
  IF _adm_count('authenticated', owner, 'SELECT 1 FROM admin_health_checks') < 10 THEN
    RAISE EXCEPTION 'health checks did not persist results';
  END IF;
  IF (SELECT severity FROM admin_health_checks WHERE key = 'email.failed') = 'ok' THEN
    RAISE EXCEPTION 'a failed email must raise the queue check';
  END IF;
  IF (SELECT severity FROM admin_health_checks WHERE key = 'content.images') = 'ok' THEN
    RAISE EXCEPTION 'a broken image URL must raise the image check';
  END IF;
  IF (SELECT fix_key FROM admin_health_checks WHERE key = 'email.failed') <> 'requeue_email' THEN
    RAISE EXCEPTION 'the email check must offer the requeue fix';
  END IF;
  PERFORM _adm_run('authenticated', owner, $q$ SELECT admin_fix_issue('requeue_email') $q$);
  IF (SELECT status FROM email_queue WHERE to_email = 'stuck@example.com') <> 'queued' THEN
    RAISE EXCEPTION 'the requeue fix did not reset the failed email';
  END IF;
  PERFORM _adm_run('authenticated', owner, $q$ SELECT admin_fix_issue('repair_images') $q$);
  IF (SELECT image_url FROM products WHERE id = '50000000-0000-0000-0000-000000000001')
     <> 'https://images.pexels.com/photos/1234567/pexels-photo-1234567.jpeg?auto=compress&cs=tinysrgb&w=1600' THEN
    RAISE EXCEPTION 'the image repair did not normalise the Pexels page URL';
  END IF;
  IF NOT _adm_raises('authenticated', owner, $q$ SELECT admin_fix_issue('not_a_real_fix') $q$) THEN
    RAISE EXCEPTION 'an unknown fix key was accepted';
  END IF;
  IF NOT _adm_raises('authenticated', editor, $q$ SELECT admin_fix_issue('analyze') $q$) THEN
    RAISE EXCEPTION 'an editor could apply repairs';
  END IF;

  -- ================= 11. growth + advisor =================
  v_text := _adm_text('authenticated', owner, $q$ (admin_growth_report(30)) ? 'commerce' $q$);
  IF v_text <> 'true' THEN RAISE EXCEPTION 'growth report is missing sections'; END IF;
  IF _adm_text('authenticated', owner, $q$ jsonb_array_length(admin_suggestions()) $q$)::int < 1 THEN
    RAISE EXCEPTION 'the advisor returned nothing while issues exist';
  END IF;

  -- ================= 12. settings =================
  IF NOT _adm_text('anon', anon_claims, $q$ site_config() ? 'nav_menu' $q$)::boolean THEN
    RAISE EXCEPTION 'the storefront cannot read the public site config';
  END IF;
  IF NOT _adm_raises('authenticated', editor,
      $q$ SELECT admin_set_setting('nav_menu', '{"items":[]}'::jsonb) $q$) THEN
    RAISE EXCEPTION 'an editor could rewrite the navigation';
  END IF;
  PERFORM _adm_run('authenticated', owner,
    $q$ SELECT admin_set_setting('nav_menu', '{"items":[{"label":"Skincare","href":"/category/skincare"}]}'::jsonb) $q$);
  IF NOT (_adm_text('anon', anon_claims, $q$ (site_config()->'nav_menu'->'items')->0->>'href' $q$) = '/category/skincare') THEN
    RAISE EXCEPTION 'the new navigation was not exposed to the storefront';
  END IF;
  IF NOT _adm_raises('authenticated', owner, $q$ SELECT admin_set_setting('footer', '{"nope":true}'::jsonb) $q$) THEN
    RAISE EXCEPTION 'a malformed footer setting was accepted';
  END IF;
  PERFORM _adm_run('authenticated', owner,
    $q$ SELECT admin_set_setting('flags', '{"comments":false}'::jsonb) $q$);
  IF (SELECT value ->> 'comments' FROM site_settings WHERE key = 'features') <> 'false' THEN
    RAISE EXCEPTION 'the legacy features row was not kept in step';
  END IF;
  IF NOT _adm_raises('authenticated', reader, $q$ SELECT admin_set_setting('flags', '{"comments":true}'::jsonb) $q$) THEN
    RAISE EXCEPTION 'a reader could change feature flags';
  END IF;

  RAISE NOTICE 'Admin panel assertions passed';
END $$;

-- ================= 13. the SQL sandbox (separate transaction) =================
DO $$
DECLARE
  owner jsonb := '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000001","email":"owner@lixxonstudio.com"}';
  editor jsonb := '{"role":"authenticated","sub":"00000000-0000-0000-0000-0000000000c3","email":"editor@example.com"}';
  v jsonb;
BEGIN
  -- a plain SELECT works and is capped
  v := _adm_text('authenticated', owner, $q$ admin_run_sql('SELECT generate_series(1, 500) AS n') $q$)::jsonb;
  IF (v ->> 'ok')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'the sandbox refused a valid SELECT: %', v ->> 'error'; END IF;
  IF (v ->> 'row_count')::int <> 200 THEN RAISE EXCEPTION 'the sandbox row cap is not 200 (got %)', v ->> 'row_count'; END IF;
  IF (v ->> 'truncated')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'the sandbox did not report truncation'; END IF;

  -- WITH ... SELECT is allowed
  v := _adm_text('authenticated', owner, $q$ admin_run_sql('WITH x AS (SELECT 1 AS n) SELECT * FROM x') $q$)::jsonb;
  IF (v ->> 'ok')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'the sandbox refused a CTE: %', v ->> 'error'; END IF;

  -- writes are refused and the row is untouched
  IF NOT _adm_raises('authenticated', owner, $q$ SELECT admin_run_sql('UPDATE posts SET title = ''hacked''') $q$) THEN
    RAISE EXCEPTION 'the sandbox accepted an UPDATE';
  END IF;
  IF NOT _adm_raises('authenticated', owner, $q$ SELECT admin_run_sql('SELECT 1; DROP TABLE posts') $q$) THEN
    RAISE EXCEPTION 'the sandbox accepted multiple statements';
  END IF;
  IF NOT _adm_raises('authenticated', owner, $q$ SELECT admin_run_sql('SELECT admin_audit_revert(gen_random_uuid())') $q$) THEN
    RAISE EXCEPTION 'the sandbox allowed an internal admin function';
  END IF;
  IF (SELECT title FROM posts WHERE id = '40000000-0000-0000-0000-000000000001') <> 'RBAC test article' THEN
    RAISE EXCEPTION 'the sandbox wrote to a table';
  END IF;

  -- a role without data.sql is refused
  IF NOT _adm_raises('authenticated', editor, $q$ SELECT admin_run_sql('SELECT 1') $q$) THEN
    RAISE EXCEPTION 'an editor could use the SQL sandbox';
  END IF;

  -- the explorer catalogue is gated too
  IF _adm_text('authenticated', owner, $q$ jsonb_array_length(admin_table_catalog()) $q$)::int < 30 THEN
    RAISE EXCEPTION 'the explorer catalogue is too small';
  END IF;
  IF NOT (_adm_text('authenticated', owner, $q$ (admin_table_catalog()) @> '[{"table":"posts"}]'::jsonb $q$)::boolean) THEN
    RAISE EXCEPTION 'the explorer catalogue is missing posts';
  END IF;
  IF _adm_text('authenticated', editor, $q$ jsonb_array_length(admin_table_catalog()) $q$)::int < 1 THEN
    RAISE EXCEPTION 'an editor with data.explore cannot read the catalogue';
  END IF;

  RAISE NOTICE 'Admin sandbox assertions passed';
END $$;

DROP FUNCTION _adm_run(text, jsonb, text);
DROP FUNCTION _adm_count(text, jsonb, text);
DROP FUNCTION _adm_text(text, jsonb, text);
DROP FUNCTION _adm_raises(text, jsonb, text);
