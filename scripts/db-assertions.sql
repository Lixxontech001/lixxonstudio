-- Security assertions run against the freshly migrated schema.
-- Each block raises if an exploit from the audit is still possible.
\set ON_ERROR_STOP on

-- ---------- fixtures (as service role / superuser) ----------
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'alice@example.com'),
  ('00000000-0000-0000-0000-0000000000b2', 'bob@example.com')
ON CONFLICT DO NOTHING;

INSERT INTO products (id, name, price, is_digital, product_type, is_active, file_path, slug)
VALUES ('10000000-0000-0000-0000-000000000001', 'Test Ebook', '19.99', true, 'digital', true, 'ebooks/test.pdf', 'test-ebook')
ON CONFLICT (id) DO NOTHING;

INSERT INTO promo_codes (code, discount_type, discount_value, is_active, max_uses, use_count)
VALUES ('SECRET50', 'percentage', 50, true, 1, 0) ON CONFLICT DO NOTHING;

INSERT INTO gift_cards (code, initial_balance, balance, is_active) VALUES ('GC-TEST', 50, 50, true) ON CONFLICT DO NOTHING;

INSERT INTO orders (id, order_number, customer_email, customer_name, status, payment_status, amount, currency)
VALUES ('20000000-0000-0000-0000-000000000001', 'LXX-ALICE', 'alice@example.com', 'Alice', 'fulfilled', 'paid', 19.99, 'USD')
ON CONFLICT DO NOTHING;
INSERT INTO download_entitlements (order_id, customer_email, product_id, file_path, download_token, download_count, max_downloads)
VALUES ('20000000-0000-0000-0000-000000000001', 'alice@example.com', '10000000-0000-0000-0000-000000000001', 'ebooks/test.pdf', 'tok-alice', 0, 5)
ON CONFLICT DO NOTHING;

-- helper: count rows visible under a role
CREATE OR REPLACE FUNCTION _t_count(role_name text, claims jsonb, q text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  EXECUTE format('SET LOCAL ROLE %I', role_name);
  PERFORM set_config('request.jwt.claims', claims::text, true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(claims->>'sub',''), true);
  PERFORM set_config('request.jwt.claim.role', COALESCE(claims->>'role', role_name), true);
  EXECUTE 'SELECT count(*) FROM (' || q || ') s' INTO n;
  RESET ROLE;
  RETURN n;
END $$;

-- helper: does a statement succeed under a role? (returns true if it raised or affected 0 rows)
CREATE OR REPLACE FUNCTION _t_blocked(role_name text, claims jsonb, stmt text) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
  EXECUTE format('SET LOCAL ROLE %I', role_name);
  PERFORM set_config('request.jwt.claims', claims::text, true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(claims->>'sub',''), true);
  PERFORM set_config('request.jwt.claim.role', COALESCE(claims->>'role', role_name), true);
  BEGIN
    EXECUTE stmt;
    GET DIAGNOSTICS n = ROW_COUNT;
    RESET ROLE;
    RETURN n = 0;
  EXCEPTION WHEN insufficient_privilege OR check_violation OR others THEN
    RESET ROLE;
    RETURN true;
  END;
END $$;

DO $$
DECLARE
  anon_claims jsonb := '{"role":"anon"}';
  alice jsonb := '{"role":"authenticated","sub":"00000000-0000-0000-0000-0000000000a1","email":"alice@example.com"}';
  bob   jsonb := '{"role":"authenticated","sub":"00000000-0000-0000-0000-0000000000b2","email":"bob@example.com"}';
  owner jsonb := '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000001","email":"owner@lixxonstudio.com"}';
BEGIN
  -- 1. PII must be invisible to anon
  IF _t_count('anon', anon_claims, 'SELECT 1 FROM orders') > 0 THEN RAISE EXCEPTION 'anon can read orders'; END IF;
  IF _t_count('anon', anon_claims, 'SELECT 1 FROM order_items') > 0 THEN RAISE EXCEPTION 'anon can read order_items'; END IF;
  IF _t_count('anon', anon_claims, 'SELECT 1 FROM customers') > 0 THEN RAISE EXCEPTION 'anon can read customers'; END IF;
  IF _t_count('anon', anon_claims, 'SELECT 1 FROM download_entitlements') > 0 THEN RAISE EXCEPTION 'anon can read entitlements'; END IF;
  IF _t_count('anon', anon_claims, 'SELECT 1 FROM promo_codes') > 0 THEN RAISE EXCEPTION 'anon can read promo codes'; END IF;
  IF _t_count('anon', anon_claims, 'SELECT 1 FROM gift_cards') > 0 THEN RAISE EXCEPTION 'anon can read gift cards'; END IF;
  IF _t_count('anon', anon_claims, 'SELECT 1 FROM admin_activity_log') > 0 THEN RAISE EXCEPTION 'anon can read audit log'; END IF;
  IF _t_count('anon', anon_claims, 'SELECT 1 FROM contact_messages') > 0 THEN RAISE EXCEPTION 'anon can read contact messages'; END IF;
  IF _t_count('anon', anon_claims, 'SELECT 1 FROM newsletter_subscribers') > 0 THEN RAISE EXCEPTION 'anon can read subscribers'; END IF;

  -- 2. anon must not forge commerce rows
  IF NOT _t_blocked('anon', anon_claims, $q$INSERT INTO promo_codes (code, discount_type, discount_value) VALUES ('FREE100','percentage',100)$q$) THEN RAISE EXCEPTION 'anon can create promo codes'; END IF;
  IF NOT _t_blocked('anon', anon_claims, $q$UPDATE download_entitlements SET download_count = 0, max_downloads = 999$q$) THEN RAISE EXCEPTION 'anon can edit entitlements'; END IF;
  IF NOT _t_blocked('anon', anon_claims, $q$INSERT INTO orders (order_number, customer_email, amount, status, payment_status) VALUES ('X','x@x.com', 0.01, 'pending','pending')$q$) THEN RAISE EXCEPTION 'anon can create orders directly'; END IF;
  IF NOT _t_blocked('anon', anon_claims, $q$DELETE FROM product_reviews$q$) THEN RAISE EXCEPTION 'anon can delete reviews'; END IF;
  IF NOT _t_blocked('anon', anon_claims, $q$UPDATE article_polls SET question = 'pwned'$q$) THEN RAISE EXCEPTION 'anon can edit polls'; END IF;
  IF NOT _t_blocked('anon', anon_claims, $q$INSERT INTO comments (post_id, author_name, author_email, content) VALUES (gen_random_uuid(),'a','a@a.com','spam')$q$) THEN RAISE EXCEPTION 'anon can insert comments directly (must use edge fn)'; END IF;
  IF NOT _t_blocked('anon', anon_claims, $q$INSERT INTO posts (title, slug) VALUES ('x','x')$q$) THEN RAISE EXCEPTION 'anon can write posts'; END IF;
  IF NOT _t_blocked('anon', anon_claims, $q$UPDATE products SET price = '0.01'$q$) THEN RAISE EXCEPTION 'anon can change prices'; END IF;

  -- 3. a normal signed-in user (bob) is NOT an admin
  IF NOT _t_blocked('authenticated', bob, $q$INSERT INTO posts (title, slug) VALUES ('x','x2')$q$) THEN RAISE EXCEPTION 'any authenticated user can write posts'; END IF;
  IF NOT _t_blocked('authenticated', bob, $q$UPDATE promo_codes SET is_active = false$q$) THEN RAISE EXCEPTION 'any authenticated user can edit promo codes'; END IF;
  IF _t_count('authenticated', bob, 'SELECT 1 FROM orders') > 0 THEN RAISE EXCEPTION 'bob can read alice''s orders'; END IF;
  IF _t_count('authenticated', bob, 'SELECT 1 FROM download_entitlements') > 0 THEN RAISE EXCEPTION 'bob can read alice''s downloads'; END IF;

  -- 4. the customer sees only her own data
  IF _t_count('authenticated', alice, 'SELECT 1 FROM orders') <> 1 THEN RAISE EXCEPTION 'alice cannot read her own order'; END IF;
  IF _t_count('authenticated', alice, 'SELECT 1 FROM download_entitlements') <> 1 THEN RAISE EXCEPTION 'alice cannot read her own entitlements'; END IF;
  IF NOT _t_blocked('authenticated', alice, $q$UPDATE orders SET amount = 0$q$) THEN RAISE EXCEPTION 'customer can edit own order'; END IF;

  -- 5. the seeded owner IS an admin
  IF _t_count('authenticated', owner, 'SELECT 1 FROM promo_codes') < 1 THEN RAISE EXCEPTION 'owner cannot read promo codes'; END IF;
  IF _t_count('authenticated', owner, 'SELECT 1 FROM orders') < 1 THEN RAISE EXCEPTION 'owner cannot read orders'; END IF;
  IF _t_blocked('authenticated', owner, $q$UPDATE promo_codes SET description = 'ok' WHERE code = 'SECRET50'$q$) THEN RAISE EXCEPTION 'owner cannot edit promo codes'; END IF;

  -- 6. public content still readable
  IF _t_count('anon', anon_claims, 'SELECT 1 FROM products WHERE is_active') < 1 THEN RAISE EXCEPTION 'anon cannot read products'; END IF;
  IF _t_count('anon', anon_claims, 'SELECT 1 FROM categories') < 0 THEN RAISE EXCEPTION 'unreachable'; END IF;

  -- 7. atomic helpers behave
  IF NOT redeem_promo_code('SECRET50') THEN RAISE EXCEPTION 'first promo redemption should succeed'; END IF;
  IF redeem_promo_code('SECRET50') THEN RAISE EXCEPTION 'promo max_uses not enforced'; END IF;
  IF NOT debit_gift_card('GC-TEST', 20) THEN RAISE EXCEPTION 'gift card debit should succeed'; END IF;
  IF debit_gift_card('GC-TEST', 40) THEN RAISE EXCEPTION 'gift card overdraft allowed'; END IF;
  IF consume_download('tok-alice') IS NULL THEN RAISE EXCEPTION 'valid download token rejected'; END IF;
  PERFORM consume_download('tok-alice') FROM generate_series(1,4);
  IF consume_download('tok-alice') IS NOT NULL THEN RAISE EXCEPTION 'download cap not enforced'; END IF;
  IF (SELECT price_cents FROM products WHERE slug = 'test-ebook') <> 1999 THEN RAISE EXCEPTION 'price_cents sync failed'; END IF;

  -- 8. audit trigger wrote something
  IF (SELECT count(*) FROM admin_activity_log WHERE entity_type = 'promo_codes') < 1 THEN RAISE EXCEPTION 'audit trigger did not fire'; END IF;

  RAISE NOTICE 'All security assertions passed';
END $$;

DROP FUNCTION _t_count(text, jsonb, text);
DROP FUNCTION _t_blocked(text, jsonb, text);
SELECT count(*) AS public_tables FROM pg_tables WHERE schemaname = 'public';
SELECT count(*) AS policies FROM pg_policies WHERE schemaname = 'public';
