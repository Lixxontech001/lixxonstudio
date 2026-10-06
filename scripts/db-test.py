#!/usr/bin/env python3
"""
Local migration + RLS test harness.

Spins up an embedded PostgreSQL (via `pgserver`), installs a minimal Supabase-compatible
stub (auth / storage schemas, anon / authenticated / service_role roles, auth.uid(),
auth.jwt()), applies every migration in supabase/migrations in order, then runs the
security and feature assertions in scripts/*-assertions.sql.

Usage:  python3 scripts/db-test.py            # full run
        python3 scripts/db-test.py --keep     # keep the DB directory afterwards
"""
import glob, os, sys, shutil, subprocess, warnings
warnings.filterwarnings("ignore")
import pgserver  # pip install pgserver fasteners platformdirs psutil

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DBDIR = os.path.expanduser("~/.cache/lixxon-pgtest")
PSQL = os.path.join(os.path.dirname(pgserver.__file__), "pginstall", "bin", "psql")

STUB = r"""
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
-- pgcrypto not needed: gen_random_uuid() is core in PG13+

CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS storage;
CREATE SCHEMA IF NOT EXISTS extensions;
-- Test-only deterministic digest shim: the embedded pgserver build omits pgcrypto.
-- Production migrations install/use the real pgcrypto extension; this stub is never deployed.
CREATE OR REPLACE FUNCTION extensions.digest(p_data bytea, p_type text)
RETURNS bytea LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT decode(md5(encode(p_data, 'hex')) || md5(md5(encode(p_data, 'hex')) || p_type), 'hex')
$$;
-- Test-only Supabase Vault shim. It is intentionally inaccessible to client roles;
-- production uses the managed supabase_vault extension and encrypted storage.
CREATE SCHEMA IF NOT EXISTS vault;
CREATE TABLE IF NOT EXISTS vault.secrets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  description text,
  secret text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE VIEW vault.decrypted_secrets AS
  SELECT id, name, description, secret AS decrypted_secret, created_at, updated_at FROM vault.secrets;
CREATE OR REPLACE FUNCTION vault.create_secret(p_secret text, p_name text, p_description text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = vault, pg_temp AS $$
DECLARE secret_id uuid;
BEGIN
  INSERT INTO vault.secrets (secret, name, description)
  VALUES (p_secret, p_name, p_description)
  RETURNING id INTO secret_id;
  RETURN secret_id;
END $$;
REVOKE ALL ON TABLE vault.secrets FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE vault.decrypted_secrets FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION vault.create_secret(text, text, text) FROM PUBLIC, anon, authenticated, service_role;
CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text, created_at timestamptz DEFAULT now(), last_sign_in_at timestamptz);
CREATE TABLE IF NOT EXISTS auth.mfa_factors (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, status text, factor_type text, created_at timestamptz DEFAULT now());
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.role', true), '') $$;
CREATE TABLE IF NOT EXISTS storage.buckets (id text PRIMARY KEY, name text, public boolean DEFAULT false, created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text, owner uuid, created_at timestamptz DEFAULT now(), metadata jsonb);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA public, auth, storage TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA storage TO anon, authenticated, service_role;
-- an "existing admin" so the seed has someone to promote
INSERT INTO auth.users (id, email) VALUES ('00000000-0000-0000-0000-000000000001', 'owner@lixxonstudio.com') ON CONFLICT DO NOTHING;
"""

PROD_FIXTURES = r"""
INSERT INTO categories (id, name, slug) VALUES
  ('59d3acce-f83a-46db-84a3-c65f97d68a47','Skincare','skincare'),
  ('02110177-5210-4af8-8599-4759c930f3c4','Style','style'),
  ('a4c818a3-286a-45d7-b6f8-383fb326a971','Wellness','wellness')
ON CONFLICT (id) DO NOTHING;
INSERT INTO authors (id, name, slug) VALUES
  ('b0ab531e-88b4-4a31-8558-b68d657ef9f2','Elena','elena'),
  ('c0197c7a-386c-461b-9fed-5932b3b14f41','Sophie','sophie'),
  ('97709b9b-19e5-4bb5-a455-dcf8945be273','Amara','amara'),
  ('39aa56e1-3f34-48fb-8a61-d81e6737b98e','Mia','mia')
ON CONFLICT (id) DO NOTHING;
"""

def run_sql(uri, sql=None, file=None, label=""):
    cmd = [PSQL, uri, "-v", "ON_ERROR_STOP=1", "-q", "-X"]
    if file:
        cmd += ["-f", file]
    r = subprocess.run(cmd, input=sql, capture_output=True, text=True)
    if r.returncode != 0:
        print(f"\n❌ FAILED: {label or file}\n{r.stderr.strip()}")
        sys.exit(1)
    return r.stdout

def main():
    keep = "--keep" in sys.argv
    if os.path.exists(DBDIR):
        try:
            pgserver.get_server(DBDIR).cleanup()
        except Exception:
            pass
        shutil.rmtree(DBDIR, ignore_errors=True)
    srv = pgserver.get_server(DBDIR)
    uri = srv.get_uri()
    run_sql(uri, STUB, label="supabase stub")
    migs = sorted(glob.glob(os.path.join(ROOT, "supabase", "migrations", "*.sql")))
    for m in migs:
        if "add_20_seo_blog_posts" in m:
            # production rows created via the dashboard that this seed depends on
            run_sql(uri, PROD_FIXTURES, label="prod fixtures")
        run_sql(uri, file=m, label=os.path.basename(m))
        print(f"✓ {os.path.basename(m)}")
    for name in (
        "db-assertions.sql", "search-assertions.sql", "personalisation-assertions.sql",
        "community-assertions.sql", "commerce-assertions.sql", "commerce-fulfillment-assertions.sql", "editor-assertions.sql",
        "admin-assertions.sql", "automation-foundation-assertions.sql", "article-intake-assertions.sql", "automation-orchestration-assertions.sql", "security-ai-assertions.sql",
        "automation-run-monitor-assertions.sql",
        "admin-ai-autopilot-assertions.sql", "admin-ai-ceo-assertions.sql", "admin-ai-predictive-assertions.sql",
        "distribution-assertions.sql", "distribution-safety-assertions.sql",
        "push-subscriptions-assertions.sql", "push-delivery-assertions.sql",
        "automation-retention-assertions.sql",
        "agent-status-assertions.sql",
    ):
        assertions = os.path.join(ROOT, "scripts", name)
        if os.path.exists(assertions):
            out = run_sql(uri, file=assertions, label=name)
            if out.strip():
                print(out.strip().splitlines()[-1] if name != "search-assertions.sql" else out)
    print(f"\n✅ {len(migs)} migrations applied; assertions passed.")
    if not keep:
        srv.cleanup()
        shutil.rmtree(DBDIR, ignore_errors=True)
    else:
        print("DB kept at", uri)

if __name__ == "__main__":
    main()
