/*
# M5 · Admin super panel — RBAC core (database is the source of truth)

## Why
Until now "admin" was a single boolean (`app_admins` row) and the *only* place that
said which admin could open which screen was `src/admin/permissions.ts` — a hard-coded
list in the client bundle. Anyone who edited that file (or called PostgREST directly)
got around it; every admin could read orders, prices, refunds and backups.

## What this migration does
1. `admin_permissions` — the catalogue of every capability the panel can grant.
2. `admin_roles` + `role_permissions` — roles are rows, not constants; owners can add
   custom roles and edit the matrix from the UI (Team → Access).
3. `admin_permission_overrides` — per-admin `grant` / `deny` on top of the role.
4. `app_admins` gains `status`, `is_founder`, `display_name`, `note`, `last_seen_at`.
   The **original owner account is the ultra-super-admin (`is_founder`)**: it always has
   every permission, cannot be suspended, demoted or removed, and only it can hand the
   founder flag to another account.
5. `admin_can(permission)` is the single authority used by RLS, by the panel UI and by
   the edge functions. `is_admin()` now also requires `status = 'active'`.
6. RLS policies for every admin-managed table are re-created from a spec table: each
   table declares the permission needed to read it and the one needed to write it, and
   every legacy policy that merely said `is_admin()` is dropped first — including the
   oddly-named ones (`aq_admin_all`, `bs_admin_read`, `qu_admin`, …).
7. Team-management RPCs: `admin_team()`, `admin_update_member()`, `admin_set_override()`,
   role CRUD, `admin_force_signout()`, `admin_transfer_founder()`. Every one is
   SECURITY DEFINER and does its own authorisation check, so the client can never
   escalate by calling them wrongly.

Safe to re-run (idempotent): every object is IF NOT EXISTS / CREATE OR REPLACE, seeds use
ON CONFLICT DO NOTHING, and policies are dropped before being recreated.
*/

-- =====================================================================
-- 1. PERMISSION CATALOGUE
-- =====================================================================
CREATE TABLE IF NOT EXISTS admin_permissions (
  key text PRIMARY KEY,
  label text NOT NULL,
  description text NOT NULL DEFAULT '',
  category text NOT NULL,
  is_dangerous boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0
);
ALTER TABLE admin_permissions ENABLE ROW LEVEL SECURITY;

INSERT INTO admin_permissions (key, label, description, category, is_dangerous, sort_order) VALUES
  ('content.read',        'View editorial content',   'Read articles, drafts, categories, authors, series and glossary.', 'Editorial', false, 10),
  ('content.write',       'Write editorial content',  'Create and edit articles, categories, authors, series and glossary.', 'Editorial', false, 20),
  ('content.publish',     'Publish',                  'Publish, schedule and unpublish articles.', 'Editorial', false, 30),
  ('content.delete',      'Delete content',           'Delete articles and taxonomy entries.', 'Editorial', true, 40),
  ('content.moderate',    'Moderate the community',   'Approve, reply to or remove comments, reviews, questions, messages and feedback.', 'Moderation', false, 50),
  ('media.read',          'View the media library',   'Browse uploaded media.', 'Editorial', false, 60),
  ('media.write',         'Upload media',             'Upload and edit media files.', 'Editorial', false, 70),
  ('media.delete',        'Delete media',             'Permanently remove media files.', 'Editorial', true, 80),
  ('taxonomy.manage',     'Manage taxonomy',          'Categories, authors, series, glossary terms and collections.', 'Editorial', false, 90),
  ('collections.manage',  'Curate collections',       'Collections, featured slots and editors picks.', 'Marketing', false, 100),
  ('marketing.newsletter','Newsletter',               'Subscribers, preferences, digests and campaigns.', 'Marketing', false, 110),
  ('marketing.campaigns', 'Campaigns',                'Sponsored content, polls, social shares and content templates.', 'Marketing', false, 120),
  ('analytics.read',      'View analytics',           'Dashboards, content performance and growth reports.', 'Analytics', false, 130),
  ('analytics.export',    'Export reports',           'Download CSV/JSON exports of analytics data.', 'Analytics', false, 140),
  ('commerce.read',       'View commerce',            'Orders, customers, abandoned carts, gift cards and promo codes.', 'Commerce', false, 150),
  ('commerce.write',      'Manage orders',            'Edit orders, internal notes and fulfilment status.', 'Commerce', false, 160),
  ('commerce.pricing',    'Manage products & pricing','Products, bundles, prices, promo codes and gift cards.', 'Commerce', true, 170),
  ('commerce.refunds',    'Process refunds',          'Approve, reject and settle refund requests.', 'Commerce', true, 180),
  ('settings.read',       'View settings',            'See site settings, feature flags and front-end configuration.', 'Settings', false, 190),
  ('settings.write',      'Change settings',          'Edit site settings, SEO defaults and maintenance mode.', 'Settings', true, 200),
  ('settings.frontend',   'Edit the front end',       'Navigation, footer, homepage layout, theme accents, redirects and custom head.', 'Settings', true, 210),
  ('team.read',           'View the team',            'See admins, roles and the permission matrix.', 'Team', false, 220),
  ('team.manage',         'Manage admins',            'Invite, suspend, remove admins and change their role.', 'Team', true, 230),
  ('team.roles',          'Edit roles & permissions', 'Create roles and change what each role may do.', 'Team', true, 240),
  ('security.sessions',   'Revoke admin sessions',    'Force another admin to sign in again.', 'Security', true, 250),
  ('ops.health',          'Run health checks',        'Scan the database, queue and content for issues.', 'Operations', false, 260),
  ('ops.fix',             'Apply repairs',            'Run the automatic fixes suggested by the health checks.', 'Operations', true, 270),
  ('ops.backups',         'Backups & snapshots',      'Take snapshots and download backup data.', 'Operations', true, 280),
  ('ops.jobs',            'Scheduled jobs & queue',   'Email queue, cron jobs and rate limits.', 'Operations', false, 290),
  ('data.explore',        'Explore the database',     'Browse any table and row through the data explorer.', 'Data', false, 300),
  ('data.write',          'Edit rows directly',       'Insert, update and delete rows in the data explorer.', 'Data', true, 310),
  ('data.sql',            'Run read-only SQL',        'Execute SELECT statements against the database.', 'Data', true, 320),
  ('audit.read',          'Read the audit trail',     'See who changed what, with before/after diffs.', 'Security', false, 330),
  ('audit.revert',        'Revert audited changes',   'Undo a recorded change (the revert is itself audited).', 'Security', true, 340)
ON CONFLICT (key) DO UPDATE SET
  label = EXCLUDED.label, description = EXCLUDED.description, category = EXCLUDED.category,
  is_dangerous = EXCLUDED.is_dangerous, sort_order = EXCLUDED.sort_order;

-- =====================================================================
-- 2. ROLES
-- =====================================================================
CREATE TABLE IF NOT EXISTS admin_roles (
  name text PRIMARY KEY CHECK (name ~ '^[a-z][a-z0-9_]{1,30}$'),
  label text NOT NULL,
  description text NOT NULL DEFAULT '',
  rank integer NOT NULL DEFAULT 10,
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);
ALTER TABLE admin_roles ENABLE ROW LEVEL SECURITY;

INSERT INTO admin_roles (name, label, description, rank, is_system) VALUES
  ('owner',     'Owner (super admin)', 'Everything, including team, roles, settings, data tools and payments.', 100, true),
  ('editor',    'Editor',              'Writes, publishes and moderates content; curates marketing; reads analytics.', 60, true),
  ('moderator', 'Moderator',           'Approves and replies to community content only.', 40, true),
  ('analyst',   'Analyst',             'Read-only: analytics, growth reports, health checks and the explorer.', 30, false),
  ('support',   'Support',             'Reads orders and customers, processes refunds, moderates the community.', 20, false)
ON CONFLICT (name) DO UPDATE SET label = EXCLUDED.label, description = EXCLUDED.description, rank = EXCLUDED.rank;

CREATE TABLE IF NOT EXISTS role_permissions (
  role text NOT NULL REFERENCES admin_roles(name) ON DELETE CASCADE,
  permission text NOT NULL REFERENCES admin_permissions(key) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (role, permission)
);
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;

-- owner holds every permission on paper too (so the matrix renders faithfully);
-- `admin_can()` short-circuits owners anyway so a missing row can never lock them out.
INSERT INTO role_permissions (role, permission) SELECT 'owner', key FROM admin_permissions
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role, permission) VALUES
  -- editor: everything editorial + marketing, read-only commerce/analytics
  ('editor','content.read'),('editor','content.write'),('editor','content.publish'),('editor','content.delete'),
  ('editor','content.moderate'),('editor','media.read'),('editor','media.write'),('editor','media.delete'),
  ('editor','taxonomy.manage'),('editor','collections.manage'),('editor','marketing.newsletter'),
  ('editor','marketing.campaigns'),('editor','analytics.read'),('editor','analytics.export'),
  ('editor','data.explore'),('editor','ops.health'),('editor','audit.read'),
  -- moderator
  ('moderator','content.read'),('moderator','content.moderate'),('moderator','media.read'),
  ('moderator','ops.health'),
  -- analyst
  ('analyst','content.read'),('analyst','analytics.read'),('analyst','analytics.export'),
  ('analyst','commerce.read'),('analyst','data.explore'),('analyst','ops.health'),('analyst','ops.jobs'),
  ('analyst','audit.read'),('analyst','settings.read'),
  -- support
  ('support','content.read'),('support','content.moderate'),('support','commerce.read'),
  ('support','commerce.write'),('support','commerce.refunds'),('support','ops.health'),
  ('support','data.explore'),('support','audit.read')
ON CONFLICT DO NOTHING;

-- =====================================================================
-- 3. PER-ADMIN OVERRIDES + MEMBER METADATA
-- =====================================================================
CREATE TABLE IF NOT EXISTS admin_permission_overrides (
  user_id uuid NOT NULL REFERENCES app_admins(user_id) ON DELETE CASCADE,
  permission text NOT NULL REFERENCES admin_permissions(key) ON DELETE CASCADE,
  effect text NOT NULL CHECK (effect IN ('grant', 'deny')),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  PRIMARY KEY (user_id, permission)
);
ALTER TABLE admin_permission_overrides ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_admins ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';
ALTER TABLE app_admins ADD COLUMN IF NOT EXISTS is_founder boolean NOT NULL DEFAULT false;
ALTER TABLE app_admins ADD COLUMN IF NOT EXISTS display_name text;
ALTER TABLE app_admins ADD COLUMN IF NOT EXISTS note text;
ALTER TABLE app_admins ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;
ALTER TABLE app_admins ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE app_admins ADD COLUMN IF NOT EXISTS created_by uuid;

ALTER TABLE app_admins DROP CONSTRAINT IF EXISTS app_admins_status_check;
ALTER TABLE app_admins ADD CONSTRAINT app_admins_status_check CHECK (status IN ('active', 'suspended'));

-- exactly one founder; the account that has existed longest becomes it
CREATE UNIQUE INDEX IF NOT EXISTS app_admins_single_founder ON app_admins ((is_founder)) WHERE is_founder;
UPDATE app_admins SET is_founder = true
 WHERE user_id = (SELECT user_id FROM app_admins ORDER BY created_at, user_id LIMIT 1)
   AND NOT EXISTS (SELECT 1 FROM app_admins WHERE is_founder);

-- role column must point at a real role: the old hard-coded CHECK (owner/editor/moderator)
-- is replaced by a foreign key to admin_roles, so custom roles are possible.
ALTER TABLE app_admins DROP CONSTRAINT IF EXISTS app_admins_role_check;
ALTER TABLE app_admins DROP CONSTRAINT IF EXISTS app_admins_role_fkey;
ALTER TABLE app_admins ADD CONSTRAINT app_admins_role_fkey FOREIGN KEY (role) REFERENCES admin_roles(name) ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS app_admins_role_idx ON app_admins (role);
CREATE INDEX IF NOT EXISTS role_permissions_permission_idx ON role_permissions (permission);

-- =====================================================================
-- 4. THE AUTHORITY: admin_can() / is_admin() / admin_me()
-- =====================================================================

-- `is_admin()` = an ACTIVE member of the team (any role). It stays the coarse gate for
-- tables every admin may touch; section access uses admin_can().
CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM app_admins WHERE user_id = auth.uid() AND status = 'active')
     AND (
       COALESCE(auth.jwt()->>'aal', 'aal1') = 'aal2'
       OR NOT EXISTS (SELECT 1 FROM auth.mfa_factors f WHERE f.user_id = auth.uid() AND f.status = 'verified')
     );
$$;

CREATE OR REPLACE FUNCTION is_founder()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE((SELECT is_founder FROM app_admins WHERE user_id = auth.uid() AND status = 'active'), false);
$$;

-- The single source of truth for "may this request do X?".
-- not an admin -> no. founder or owner -> yes. explicit deny -> no.
-- explicit grant -> yes. role permission -> yes. otherwise -> no.
CREATE OR REPLACE FUNCTION admin_can(p_permission text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT CASE
    WHEN NOT is_admin() THEN false
    WHEN p_permission IS NULL OR p_permission = '' THEN false
    WHEN EXISTS (SELECT 1 FROM app_admins WHERE user_id = auth.uid() AND (is_founder OR role = 'owner')) THEN true
    WHEN EXISTS (SELECT 1 FROM admin_permission_overrides o
                  WHERE o.user_id = auth.uid() AND o.permission = p_permission AND o.effect = 'deny') THEN false
    WHEN EXISTS (SELECT 1 FROM admin_permission_overrides o
                  WHERE o.user_id = auth.uid() AND o.permission = p_permission AND o.effect = 'grant') THEN true
    ELSE EXISTS (
      SELECT 1 FROM app_admins a
      JOIN role_permissions rp ON rp.role = a.role
      WHERE a.user_id = auth.uid() AND a.status = 'active' AND rp.permission = p_permission
    )
  END;
$$;

-- Effective permission list for the signed-in admin (used by the panel to mirror the DB).
CREATE OR REPLACE FUNCTION admin_effective_permissions()
RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT CASE
    WHEN NOT is_admin() THEN ARRAY[]::text[]
    WHEN EXISTS (SELECT 1 FROM app_admins WHERE user_id = auth.uid() AND (is_founder OR role = 'owner')) THEN
      (SELECT array_agg(key ORDER BY key) FROM admin_permissions)
    ELSE COALESCE((
      SELECT array_agg(p.key ORDER BY p.key) FROM admin_permissions p WHERE admin_can(p.key)
    ), ARRAY[]::text[])
  END;
$$;

-- Everything the admin panel needs about the caller, in one round trip.
CREATE OR REPLACE FUNCTION admin_me()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT jsonb_build_object(
      'user_id', a.user_id,
      'email', (SELECT u.email::text FROM auth.users u WHERE u.id = a.user_id),
      'role', a.role,
      'role_label', (SELECT r.label FROM admin_roles r WHERE r.name = a.role),
      'display_name', a.display_name,
      'status', a.status,
      'is_founder', a.is_founder,
      'is_owner', a.role = 'owner',
      'mfa_enrolled', EXISTS (SELECT 1 FROM auth.mfa_factors f WHERE f.user_id = a.user_id AND f.status = 'verified'),
      'permissions', to_jsonb(admin_effective_permissions())
    )
    FROM app_admins a WHERE a.user_id = auth.uid()
  ), jsonb_build_object('status', 'none', 'permissions', '[]'::jsonb));
$$;

-- Record that an admin is alive (called from the panel on load; cheap, no audit noise).
CREATE OR REPLACE FUNCTION admin_touch()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  UPDATE app_admins SET last_seen_at = now() WHERE user_id = auth.uid();
END $$;

-- =====================================================================
-- 5. ROLES / MATRIX / TEAM RPCs
-- =====================================================================

CREATE OR REPLACE FUNCTION admin_roles_overview()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT CASE WHEN admin_can('team.read') THEN COALESCE(jsonb_agg(jsonb_build_object(
    'name', r.name, 'label', r.label, 'description', r.description, 'rank', r.rank,
    'is_system', r.is_system,
    'members', (SELECT count(*) FROM app_admins a WHERE a.role = r.name),
    'permissions', COALESCE((SELECT jsonb_agg(rp.permission ORDER BY rp.permission) FROM role_permissions rp WHERE rp.role = r.name), '[]'::jsonb)
  ) ORDER BY r.rank DESC, r.name), '[]'::jsonb) ELSE '[]'::jsonb END
  FROM admin_roles r;
$$;

CREATE OR REPLACE FUNCTION admin_permission_catalogue()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT CASE WHEN admin_can('team.read') OR admin_can('settings.read') THEN
    COALESCE(jsonb_agg(jsonb_build_object(
      'key', p.key, 'label', p.label, 'description', p.description, 'category', p.category,
      'is_dangerous', p.is_dangerous, 'sort_order', p.sort_order
    ) ORDER BY p.category, p.sort_order), '[]'::jsonb)
  ELSE '[]'::jsonb END
  FROM admin_permissions p;
$$;

CREATE OR REPLACE FUNCTION admin_team()
RETURNS TABLE (
  user_id uuid, email text, display_name text, role text, role_label text,
  status text, is_founder boolean, note text, created_at timestamptz,
  last_sign_in_at timestamptz, last_seen_at timestamptz,
  permissions text[], overrides jsonb
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT a.user_id,
         u.email::text,
         COALESCE(a.display_name, split_part(u.email::text, '@', 1)),
         a.role,
         COALESCE(r.label, a.role),
         a.status,
         a.is_founder,
         a.note,
         a.created_at,
         u.last_sign_in_at,
         a.last_seen_at,
         CASE
           WHEN a.is_founder OR a.role = 'owner' THEN ARRAY(SELECT key FROM admin_permissions ORDER BY key)
           ELSE ARRAY(
             SELECT p.key FROM admin_permissions p
             WHERE EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role = a.role AND rp.permission = p.key)
               AND NOT EXISTS (SELECT 1 FROM admin_permission_overrides o WHERE o.user_id = a.user_id AND o.permission = p.key AND o.effect = 'deny')
             UNION
             SELECT o.permission FROM admin_permission_overrides o WHERE o.user_id = a.user_id AND o.effect = 'grant'
             ORDER BY 1
           )
         END,
         COALESCE((SELECT jsonb_object_agg(o.permission, o.effect)
                     FROM admin_permission_overrides o WHERE o.user_id = a.user_id), '{}'::jsonb)
  FROM app_admins a
  JOIN auth.users u ON u.id = a.user_id
  LEFT JOIN admin_roles r ON r.name = a.role
  WHERE admin_can('team.read')
  ORDER BY a.is_founder DESC, r.rank DESC NULLS LAST, lower(u.email::text);
$$;

CREATE OR REPLACE FUNCTION admin_update_member(
  p_user_id uuid,
  p_display_name text DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_status text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_founder boolean; v_status text;
BEGIN
  IF NOT admin_can('team.manage') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'user id required'; END IF;
  SELECT is_founder, status INTO v_founder, v_status FROM app_admins WHERE user_id = p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'That account is not on the team'; END IF;
  IF v_founder THEN RAISE EXCEPTION 'The super admin account cannot be changed'; END IF;
  IF p_status IS NOT NULL THEN
    IF p_status NOT IN ('active', 'suspended') THEN RAISE EXCEPTION 'Invalid status'; END IF;
    IF p_status = 'suspended' AND p_user_id = auth.uid() THEN RAISE EXCEPTION 'You cannot suspend yourself'; END IF;
  END IF;
  UPDATE app_admins
     SET display_name = COALESCE(NULLIF(trim(p_display_name), ''), display_name),
         note = COALESCE(p_note, note),
         status = COALESCE(p_status, status),
         updated_at = now()
   WHERE user_id = p_user_id;
  RETURN 'ok';
END $$;

CREATE OR REPLACE FUNCTION admin_set_override(p_user_id uuid, p_permission text, p_effect text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_role text; v_founder boolean;
BEGIN
  IF NOT admin_can('team.roles') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_effect NOT IN ('grant', 'deny', '') THEN RAISE EXCEPTION 'Invalid effect'; END IF;
  IF NOT EXISTS (SELECT 1 FROM admin_permissions WHERE key = p_permission) THEN RAISE EXCEPTION 'Unknown permission'; END IF;
  SELECT role, is_founder INTO v_role, v_founder FROM app_admins WHERE user_id = p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'That account is not on the team'; END IF;
  IF v_founder OR v_role = 'owner' THEN RAISE EXCEPTION 'Owners always hold every permission'; END IF;
  IF p_effect = '' THEN
    DELETE FROM admin_permission_overrides WHERE user_id = p_user_id AND permission = p_permission;
    RETURN 'cleared';
  END IF;
  INSERT INTO admin_permission_overrides (user_id, permission, effect, created_by)
  VALUES (p_user_id, p_permission, p_effect, auth.uid())
  ON CONFLICT (user_id, permission) DO UPDATE SET effect = EXCLUDED.effect, created_by = auth.uid(), created_at = now();
  RETURN 'ok';
END $$;

CREATE OR REPLACE FUNCTION admin_set_role_permission(p_role text, p_permission text, p_enabled boolean)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT admin_can('team.roles') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_role = 'owner' THEN RAISE EXCEPTION 'The owner role always holds every permission'; END IF;
  IF NOT EXISTS (SELECT 1 FROM admin_roles WHERE name = p_role) THEN RAISE EXCEPTION 'Unknown role'; END IF;
  IF NOT EXISTS (SELECT 1 FROM admin_permissions WHERE key = p_permission) THEN RAISE EXCEPTION 'Unknown permission'; END IF;
  IF p_enabled THEN
    INSERT INTO role_permissions (role, permission) VALUES (p_role, p_permission) ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM role_permissions WHERE role = p_role AND permission = p_permission;
  END IF;
  RETURN 'ok';
END $$;

CREATE OR REPLACE FUNCTION admin_create_role(p_name text, p_label text, p_description text DEFAULT '', p_permissions text[] DEFAULT ARRAY[]::text[])
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_name text; v_perm text;
BEGIN
  IF NOT admin_can('team.roles') THEN RAISE EXCEPTION 'forbidden'; END IF;
  v_name := lower(trim(COALESCE(p_name, '')));
  IF v_name !~ '^[a-z][a-z0-9_]{1,30}$' THEN RAISE EXCEPTION 'Role keys use a-z, 0-9 and _ (2-31 chars)'; END IF;
  IF v_name IN ('owner', 'editor', 'moderator') THEN RAISE EXCEPTION 'That role name is reserved'; END IF;
  IF EXISTS (SELECT 1 FROM admin_roles WHERE name = v_name) THEN RAISE EXCEPTION 'That role already exists'; END IF;
  IF trim(COALESCE(p_label, '')) = '' THEN RAISE EXCEPTION 'Give the role a label'; END IF;
  INSERT INTO admin_roles (name, label, description, rank, is_system, created_by)
  VALUES (v_name, trim(p_label), COALESCE(p_description, ''), 25, false, auth.uid());
  FOREACH v_perm IN ARRAY COALESCE(p_permissions, ARRAY[]::text[]) LOOP
    IF EXISTS (SELECT 1 FROM admin_permissions WHERE key = v_perm) THEN
      INSERT INTO role_permissions (role, permission) VALUES (v_name, v_perm) ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;
  RETURN v_name;
END $$;

CREATE OR REPLACE FUNCTION admin_update_role(p_name text, p_label text, p_description text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT admin_can('team.roles') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF NOT EXISTS (SELECT 1 FROM admin_roles WHERE name = p_name) THEN RAISE EXCEPTION 'Unknown role'; END IF;
  IF p_name IN ('owner', 'editor', 'moderator') THEN RAISE EXCEPTION 'Built-in roles keep their name and label'; END IF;
  UPDATE admin_roles SET label = COALESCE(NULLIF(trim(p_label), ''), label),
                        description = COALESCE(p_description, description)
   WHERE name = p_name;
  RETURN 'ok';
END $$;

CREATE OR REPLACE FUNCTION admin_delete_role(p_name text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_members integer;
BEGIN
  IF NOT admin_can('team.roles') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_name IN ('owner', 'editor', 'moderator') THEN RAISE EXCEPTION 'Built-in roles cannot be deleted'; END IF;
  SELECT count(*) INTO v_members FROM app_admins WHERE role = p_name;
  IF v_members > 0 THEN RAISE EXCEPTION 'Move the % member(s) on this role to another role first', v_members; END IF;
  DELETE FROM admin_roles WHERE name = p_name;
  RETURN 'ok';
END $$;

-- =====================================================================
-- 6. TEAM MANAGEMENT (existing signatures kept for compatibility)
-- =====================================================================
CREATE OR REPLACE FUNCTION set_admin_role(p_email text, p_role text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid; v_is_founder boolean; v_active_owners integer; v_was_owner boolean;
BEGIN
  IF NOT admin_can('team.manage') THEN RAISE EXCEPTION 'Only team managers can manage the team'; END IF;
  IF p_role IS NULL OR NOT EXISTS (SELECT 1 FROM admin_roles WHERE name = p_role) THEN RAISE EXCEPTION 'Invalid role'; END IF;
  SELECT id INTO uid FROM auth.users WHERE lower(email) = lower(trim(p_email));
  IF uid IS NULL THEN RETURN 'not_found'; END IF;
  SELECT is_founder, role = 'owner' INTO v_is_founder, v_was_owner FROM app_admins WHERE user_id = uid;
  IF COALESCE(v_is_founder, false) THEN RAISE EXCEPTION 'The super admin account cannot be demoted'; END IF;
  IF p_role <> 'owner' AND COALESCE(v_was_owner, false) THEN
    SELECT count(*) INTO v_active_owners FROM app_admins WHERE role = 'owner' AND status = 'active' AND user_id <> uid;
    IF v_active_owners = 0 THEN RAISE EXCEPTION 'Keep at least one active owner'; END IF;
  END IF;
  INSERT INTO app_admins (user_id, role, created_by) VALUES (uid, p_role, auth.uid())
    ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role, status = 'active', updated_at = now();
  RETURN 'ok';
END $$;

CREATE OR REPLACE FUNCTION remove_admin(p_user_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_is_founder boolean;
BEGIN
  IF NOT admin_can('team.manage') THEN RAISE EXCEPTION 'Only team managers can manage the team'; END IF;
  IF p_user_id = auth.uid() THEN RAISE EXCEPTION 'You cannot remove yourself'; END IF;
  SELECT is_founder INTO v_is_founder FROM app_admins WHERE user_id = p_user_id;
  IF v_is_founder THEN RAISE EXCEPTION 'The super admin account cannot be removed'; END IF;
  IF (SELECT count(*) FROM app_admins WHERE role = 'owner') <= 1 AND EXISTS (SELECT 1 FROM app_admins WHERE user_id = p_user_id AND role = 'owner') THEN
    RAISE EXCEPTION 'Keep at least one owner';
  END IF;
  DELETE FROM app_admins WHERE user_id = p_user_id;
  RETURN FOUND;
END $$;

-- Hand the ultra-super-admin flag to another account (only the founder may).
CREATE OR REPLACE FUNCTION admin_transfer_founder(p_user_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_founder() THEN RAISE EXCEPTION 'Only the super admin can transfer this role'; END IF;
  IF p_user_id IS NULL OR p_user_id = auth.uid() THEN RAISE EXCEPTION 'Pick another account'; END IF;
  IF NOT EXISTS (SELECT 1 FROM app_admins WHERE user_id = p_user_id AND status = 'active') THEN
    RAISE EXCEPTION 'That account must be an active admin first';
  END IF;
  -- the protection trigger only allows the flag to move through this function
  PERFORM set_config('lixxon.founder_transfer', 'on', true);
  UPDATE app_admins SET is_founder = false, updated_at = now() WHERE is_founder;
  UPDATE app_admins SET is_founder = true, role = 'owner', updated_at = now() WHERE user_id = p_user_id;
  PERFORM set_config('lixxon.founder_transfer', 'off', true);
  RETURN 'ok';
END $$;

-- Force another admin to sign in again (deletes their sessions). Founder protected.
CREATE OR REPLACE FUNCTION admin_force_signout(p_user_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer := 0; m integer;
BEGIN
  IF NOT admin_can('security.sessions') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_user_id = auth.uid() THEN RAISE EXCEPTION 'Sign yourself out from the header'; END IF;
  IF EXISTS (SELECT 1 FROM app_admins WHERE user_id = p_user_id AND is_founder) THEN
    RAISE EXCEPTION 'The super admin cannot be signed out';
  END IF;
  IF to_regclass('auth.sessions') IS NOT NULL THEN
    EXECUTE 'DELETE FROM auth.sessions WHERE user_id = $1' USING p_user_id;
    GET DIAGNOSTICS m = ROW_COUNT; n := n + m;
  END IF;
  IF to_regclass('auth.refresh_tokens') IS NOT NULL THEN
    BEGIN
      EXECUTE 'DELETE FROM auth.refresh_tokens WHERE user_id = $1::text' USING p_user_id;
      GET DIAGNOSTICS m = ROW_COUNT; n := n + m;
    EXCEPTION WHEN undefined_column THEN NULL;
    END;
  END IF;
  RETURN n;
END $$;

REVOKE ALL ON FUNCTION is_founder() FROM public;
REVOKE ALL ON FUNCTION admin_can(text) FROM public;
REVOKE ALL ON FUNCTION admin_effective_permissions() FROM public;
REVOKE ALL ON FUNCTION admin_me() FROM public;
REVOKE ALL ON FUNCTION admin_touch() FROM public;
REVOKE ALL ON FUNCTION admin_roles_overview() FROM public;
REVOKE ALL ON FUNCTION admin_permission_catalogue() FROM public;
REVOKE ALL ON FUNCTION admin_team() FROM public;
REVOKE ALL ON FUNCTION admin_update_member(uuid, text, text, text) FROM public;
REVOKE ALL ON FUNCTION admin_set_override(uuid, text, text) FROM public;
REVOKE ALL ON FUNCTION admin_set_role_permission(text, text, boolean) FROM public;
REVOKE ALL ON FUNCTION admin_create_role(text, text, text, text[]) FROM public;
REVOKE ALL ON FUNCTION admin_update_role(text, text, text) FROM public;
REVOKE ALL ON FUNCTION admin_delete_role(text) FROM public;
REVOKE ALL ON FUNCTION set_admin_role(text, text) FROM public;
REVOKE ALL ON FUNCTION remove_admin(uuid) FROM public;
REVOKE ALL ON FUNCTION admin_transfer_founder(uuid) FROM public;
REVOKE ALL ON FUNCTION admin_force_signout(uuid) FROM public;

GRANT EXECUTE ON FUNCTION is_admin() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION is_owner() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_role() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION is_founder() TO authenticated;
GRANT EXECUTE ON FUNCTION admin_can(text) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_effective_permissions() TO authenticated;
GRANT EXECUTE ON FUNCTION admin_me() TO authenticated;
GRANT EXECUTE ON FUNCTION admin_touch() TO authenticated;
GRANT EXECUTE ON FUNCTION admin_roles_overview() TO authenticated;
GRANT EXECUTE ON FUNCTION admin_permission_catalogue() TO authenticated;
GRANT EXECUTE ON FUNCTION admin_team() TO authenticated;
GRANT EXECUTE ON FUNCTION admin_update_member(uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_set_override(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_set_role_permission(text, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_create_role(text, text, text, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_update_role(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_delete_role(text) TO authenticated;
GRANT EXECUTE ON FUNCTION set_admin_role(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION remove_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_transfer_founder(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_force_signout(uuid) TO authenticated;

-- =====================================================================
-- 7. RLS: catalogue + roles readable to the team, writable only through RPCs
-- =====================================================================
DROP POLICY IF EXISTS admin_permissions_read ON admin_permissions;
CREATE POLICY admin_permissions_read ON admin_permissions FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS admin_roles_read ON admin_roles;
CREATE POLICY admin_roles_read ON admin_roles FOR SELECT TO authenticated
  USING ((SELECT admin_can('team.read')) OR (SELECT admin_can('team.roles')));

DROP POLICY IF EXISTS role_permissions_read ON role_permissions;
CREATE POLICY role_permissions_read ON role_permissions FOR SELECT TO authenticated
  USING ((SELECT admin_can('team.read')) OR (SELECT admin_can('team.roles')));

DROP POLICY IF EXISTS admin_overrides_read ON admin_permission_overrides;
CREATE POLICY admin_overrides_read ON admin_permission_overrides FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR (SELECT admin_can('team.read')));

DROP POLICY IF EXISTS app_admins_self_read ON app_admins;
DROP POLICY IF EXISTS app_admins_read ON app_admins;
CREATE POLICY app_admins_read ON app_admins FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR (SELECT admin_can('team.read')));

DROP POLICY IF EXISTS app_admins_owner_write ON app_admins;
CREATE POLICY app_admins_owner_write ON app_admins FOR ALL TO authenticated
  USING ((SELECT admin_can('team.manage'))) WITH CHECK ((SELECT admin_can('team.manage')));

-- =====================================================================
-- 8. RLS: one spec table drives every section permission.
--    Legacy policies that only checked is_admin() are dropped first — including the
--    ones with non-obvious names (aq_admin_all, bs_admin_read, eq_admin_read, qu_admin…).
-- =====================================================================
DO $$
DECLARE
  spec record;
  pol record;
  v_sql text;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('orders',                'commerce.read',        'commerce.write'),
      ('order_items',           'commerce.read',        'commerce.write'),
      ('order_notes',           'commerce.read',        'commerce.write'),
      ('customers',             'commerce.read',        'commerce.write'),
      ('refund_requests',       'commerce.refunds',     'commerce.refunds'),
      ('download_entitlements', 'commerce.read',        'commerce.write'),
      ('abandoned_carts',       'commerce.read',        'commerce.write'),
      ('promo_codes',           'commerce.pricing',     'commerce.pricing'),
      ('gift_cards',            'commerce.pricing',     'commerce.pricing'),
      ('products',              'commerce.read',        'commerce.pricing'),
      ('product_bundles',       'commerce.read',        'commerce.pricing'),
      ('product_bundle_items',  'commerce.read',        'commerce.pricing'),
      ('shop_categories',       'commerce.read',        'commerce.pricing'),
      ('product_notifications', 'commerce.read',        'commerce.pricing'),
      ('article_polls',         'marketing.campaigns',  'marketing.campaigns'),
      ('article_poll_votes',    'marketing.campaigns',  'marketing.campaigns'),
      ('social_shares',         'marketing.campaigns',  'marketing.campaigns'),
      ('sponsored_content',     'marketing.campaigns',  'marketing.campaigns'),
      ('newsletter_subscribers','marketing.newsletter', 'marketing.newsletter'),
      ('newsletter_preferences','marketing.newsletter', 'marketing.newsletter'),
      ('content_templates',     'content.write',        'content.write'),
      ('headline_variants',     'content.write',        'content.write'),
      ('search_synonyms',       'content.write',        'content.write'),
      ('article_series',        'taxonomy.manage',      'taxonomy.manage'),
      ('glossary_terms',        'taxonomy.manage',      'taxonomy.manage'),
      ('categories',            'taxonomy.manage',      'taxonomy.manage'),
      ('authors',               'taxonomy.manage',      'taxonomy.manage'),
      ('collections',           'collections.manage',   'collections.manage'),
      ('collection_items',      'collections.manage',   'collections.manage'),
      ('featured_slots',        'collections.manage',   'collections.manage'),
      ('comments',              'content.moderate',     'content.moderate'),
      ('comment_reports',       'content.moderate',     'content.moderate'),
      ('comment_likes',         'content.moderate',     'content.moderate'),
      ('article_questions',     'content.moderate',     'content.moderate'),
      ('question_upvotes',      'content.moderate',     'content.moderate'),
      ('contact_messages',      'content.moderate',     'content.moderate'),
      ('user_feedback',         'content.moderate',     'content.moderate'),
      ('product_reviews',       'content.moderate',     'content.moderate'),
      ('site_settings',         'settings.read',        'settings.write'),
      ('currency_rates',        'settings.read',        'settings.write'),
      ('email_queue',           'ops.jobs',             'ops.jobs'),
      ('backup_snapshots',      'ops.backups',          'ops.backups')
    ) AS v(tbl, read_perm, write_perm)
  LOOP
    CONTINUE WHEN to_regclass('public.' || spec.tbl) IS NULL;

    -- Every policy on this table that mentions is_admin() is either:
    --  * a blanket admin policy (name ends in admin/_all/_read/_write) -> dropped, the
    --    RBAC policies below replace it; or
    --  * a mixed policy such as `self_read USING (own_row OR is_admin())` -> recreated
    --    with the permission check, so the "any admin" escape hatch disappears while the
    --    original owner/customer/self path is preserved verbatim.
    FOR pol IN
      SELECT p.policyname, p.cmd, p.roles, p.qual, p.with_check FROM pg_policies p
      WHERE p.schemaname = 'public' AND p.tablename = spec.tbl
        AND (COALESCE(p.qual, '') LIKE '%is_admin()%' OR COALESCE(p.with_check, '') LIKE '%is_admin()%')
    LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', pol.policyname, spec.tbl);
      IF pol.policyname !~ 'admin(_all|_read|_write)?$' THEN
        v_sql := format('CREATE POLICY %I ON public.%I FOR %s TO %s',
                        pol.policyname, spec.tbl, pol.cmd, array_to_string(pol.roles, ', '));
        IF pol.qual IS NOT NULL THEN
          v_sql := v_sql || format(' USING (%s)',
            replace(pol.qual, 'is_admin()', format('admin_can(%L)', spec.read_perm)));
        END IF;
        IF pol.with_check IS NOT NULL THEN
          v_sql := v_sql || format(' WITH CHECK (%s)',
            replace(pol.with_check, 'is_admin()', format('admin_can(%L)', spec.write_perm)));
        END IF;
        EXECUTE v_sql;
      END IF;
    END LOOP;

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', spec.tbl || '_rbac_read', spec.tbl);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING ((SELECT admin_can(%L)))',
      spec.tbl || '_rbac_read', spec.tbl, spec.read_perm);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', spec.tbl || '_rbac_write', spec.tbl);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING ((SELECT admin_can(%L))) WITH CHECK ((SELECT admin_can(%L)))',
      spec.tbl || '_rbac_write', spec.tbl, spec.write_perm, spec.write_perm);
  END LOOP;
END $$;

-- --- special cases: articles and media need a real delete permission, and publishing
-- --- is its own capability.
DO $$
DECLARE pol record;
BEGIN
  IF to_regclass('public.posts') IS NOT NULL THEN
    FOR pol IN SELECT p.policyname FROM pg_policies p
      WHERE p.schemaname = 'public' AND p.tablename = 'posts'
        AND p.policyname ~ 'admin(_all|_read|_write)?$'
        AND (COALESCE(p.qual,'') LIKE '%is_admin()%' OR COALESCE(p.with_check,'') LIKE '%is_admin()%') LOOP
      EXECUTE format('DROP POLICY %I ON public.posts', pol.policyname);
    END LOOP;
    DROP POLICY IF EXISTS posts_rbac_read ON posts;
    CREATE POLICY posts_rbac_read ON posts FOR SELECT TO authenticated USING ((SELECT admin_can('content.read')));
    DROP POLICY IF EXISTS posts_rbac_write ON posts;
    CREATE POLICY posts_rbac_write ON posts FOR INSERT TO authenticated WITH CHECK ((SELECT admin_can('content.write')));
    DROP POLICY IF EXISTS posts_rbac_update ON posts;
    CREATE POLICY posts_rbac_update ON posts FOR UPDATE TO authenticated
      USING ((SELECT admin_can('content.write'))) WITH CHECK ((SELECT admin_can('content.write')));
    DROP POLICY IF EXISTS posts_rbac_delete ON posts;
    CREATE POLICY posts_rbac_delete ON posts FOR DELETE TO authenticated USING ((SELECT admin_can('content.delete')));
    -- drafts above are content.read; published articles stay world-readable through the
    -- pre-existing `posts_public_read` policy.
  END IF;

  IF to_regclass('public.media') IS NOT NULL THEN
    FOR pol IN SELECT p.policyname FROM pg_policies p
      WHERE p.schemaname = 'public' AND p.tablename = 'media'
        AND p.policyname ~ 'admin(_all|_read|_write)?$'
        AND (COALESCE(p.qual,'') LIKE '%is_admin()%' OR COALESCE(p.with_check,'') LIKE '%is_admin()%') LOOP
      EXECUTE format('DROP POLICY %I ON public.media', pol.policyname);
    END LOOP;
    DROP POLICY IF EXISTS media_rbac_read ON media;
    CREATE POLICY media_rbac_read ON media FOR SELECT TO authenticated USING ((SELECT admin_can('media.read')));
    DROP POLICY IF EXISTS media_rbac_insert ON media;
    CREATE POLICY media_rbac_insert ON media FOR INSERT TO authenticated WITH CHECK ((SELECT admin_can('media.write')));
    DROP POLICY IF EXISTS media_rbac_update ON media;
    CREATE POLICY media_rbac_update ON media FOR UPDATE TO authenticated
      USING ((SELECT admin_can('media.write'))) WITH CHECK ((SELECT admin_can('media.write')));
    DROP POLICY IF EXISTS media_rbac_delete ON media;
    CREATE POLICY media_rbac_delete ON media FOR DELETE TO authenticated USING ((SELECT admin_can('media.delete')));
  END IF;
END $$;

-- audit trail: readable with audit.read, never writable by the client (trigger/RPC only)
DROP POLICY IF EXISTS admin_activity_log_admin_all ON admin_activity_log;
DROP POLICY IF EXISTS admin_activity_log_read_perm ON admin_activity_log;
CREATE POLICY admin_activity_log_read_perm ON admin_activity_log FOR SELECT TO authenticated
  USING ((SELECT admin_can('audit.read')) OR (SELECT admin_can('team.manage')));

-- publishing is a capability, not an accident: non-publishers cannot move a post into a
-- published/scheduled state (service role and cron are unaffected).
CREATE OR REPLACE FUNCTION guard_post_publish()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('published', 'scheduled')
     AND current_setting('request.jwt.claim.role', true) = 'authenticated'
     AND NOT admin_can('content.publish') THEN
    RAISE EXCEPTION 'You do not have permission to publish articles';
  END IF;
  IF NEW.featured IS DISTINCT FROM OLD.featured AND NEW.featured
     AND current_setting('request.jwt.claim.role', true) = 'authenticated'
     AND NOT (admin_can('collections.manage') OR admin_can('content.publish')) THEN
    RAISE EXCEPTION 'You do not have permission to feature articles';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_guard_post_publish ON posts;
CREATE TRIGGER trg_guard_post_publish BEFORE UPDATE ON posts
  FOR EACH ROW EXECUTE FUNCTION guard_post_publish();

-- =====================================================================
-- 9. Super-admin protections: never strand the site without an owner/founder
-- =====================================================================
CREATE OR REPLACE FUNCTION admin_guard_last_owner()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.role = 'owner' AND OLD.status = 'active' THEN
    IF NOT EXISTS (SELECT 1 FROM app_admins a WHERE a.user_id <> OLD.user_id AND a.role = 'owner' AND a.status = 'active') THEN
      RAISE EXCEPTION 'At least one active owner must remain';
    END IF;
  ELSIF TG_OP = 'UPDATE' AND OLD.role = 'owner' AND OLD.status = 'active'
        AND (NEW.role <> 'owner' OR NEW.status <> 'active') THEN
    IF NOT EXISTS (SELECT 1 FROM app_admins a WHERE a.user_id <> OLD.user_id AND a.role = 'owner' AND a.status = 'active') THEN
      RAISE EXCEPTION 'At least one active owner must remain';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS trg_admin_guard_last_owner ON app_admins;
CREATE TRIGGER trg_admin_guard_last_owner BEFORE UPDATE OR DELETE ON app_admins
  FOR EACH ROW EXECUTE FUNCTION admin_guard_last_owner();

CREATE OR REPLACE FUNCTION admin_protect_founder()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.is_founder AND (TG_OP = 'DELETE' OR NOT NEW.is_founder OR NEW.status <> 'active') THEN
    -- only admin_transfer_founder() clears the flag; it sets a transaction-local marker
    IF COALESCE(current_setting('lixxon.founder_transfer', true), '') <> 'on' THEN
      RAISE EXCEPTION 'The super admin account is protected';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS trg_admin_protect_founder ON app_admins;
CREATE TRIGGER trg_admin_protect_founder BEFORE UPDATE OR DELETE ON app_admins
  FOR EACH ROW EXECUTE FUNCTION admin_protect_founder();

-- =====================================================================
-- 10. Legacy admin RPCs, re-pointed at capabilities
-- =====================================================================
-- Both predate the permission layer and only asked `is_admin()`, so any admin —
-- including a moderator — could take a database snapshot or list every admin's
-- email. Re-declared here so the capability check is the only way in.
CREATE OR REPLACE FUNCTION admin_take_backup()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT admin_can('ops.backups') THEN RAISE EXCEPTION 'forbidden'; END IF;
  PERFORM take_backup_snapshot();
END $$;

CREATE OR REPLACE FUNCTION list_admins()
RETURNS TABLE (user_id uuid, email text, role text, created_at timestamptz, last_sign_in_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT a.user_id, u.email::text, a.role, a.created_at, u.last_sign_in_at
  FROM app_admins a JOIN auth.users u ON u.id = a.user_id
  WHERE admin_can('team.read')
  ORDER BY a.created_at;
$$;

REVOKE ALL ON FUNCTION admin_take_backup() FROM public;
REVOKE ALL ON FUNCTION list_admins() FROM public;
GRANT EXECUTE ON FUNCTION admin_take_backup() TO authenticated;
GRANT EXECUTE ON FUNCTION list_admins() TO authenticated;

NOTIFY pgrst, 'reload schema';
