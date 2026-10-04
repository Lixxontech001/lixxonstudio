-- Commerce assertions: one-time restock consent is private and queues exactly one alert.
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION _commerce_count(role_name text, claims jsonb, q text)
RETURNS bigint LANGUAGE plpgsql AS $$
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

CREATE OR REPLACE FUNCTION _commerce_blocked(role_name text, claims jsonb, stmt text)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
  EXECUTE format('SET LOCAL ROLE %I', role_name);
  PERFORM set_config('request.jwt.claims', claims::text, true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(claims->>'sub', ''), true);
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

CREATE OR REPLACE FUNCTION _commerce_run(role_name text, claims jsonb, stmt text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('SET LOCAL ROLE %I', role_name);
  PERFORM set_config('request.jwt.claims', claims::text, true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(claims->>'sub', ''), true);
  PERFORM set_config('request.jwt.claim.role', COALESCE(claims->>'role', role_name), true);
  EXECUTE stmt;
  RESET ROLE;
END $$;

DO $$
DECLARE
  v_product_id uuid := '10000000-0000-0000-0000-000000000001';
  v_email text := 'restock-batch5@example.com';
  v_alert_id uuid := '30000000-0000-0000-0000-000000000005';
  v_original_status text;
  v_key text;
  anon_claims jsonb := '{"role":"anon"}';
  owner_claims jsonb := '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000001","email":"owner@lixxonstudio.com"}';
  n bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = v_product_id AND is_active) THEN
    RAISE EXCEPTION 'commerce fixture requires the active test product';
  END IF;
  IF has_table_privilege('anon', 'public.product_notifications', 'SELECT')
     OR has_table_privilege('anon', 'public.product_notifications', 'INSERT') THEN
    RAISE EXCEPTION 'anon has direct access to product notification email addresses';
  END IF;
  IF has_table_privilege('anon', 'public.email_queue', 'SELECT') THEN
    RAISE EXCEPTION 'anon can read the private email queue';
  END IF;
  IF NOT _commerce_blocked('anon', anon_claims,
    'SELECT email FROM public.product_notifications') THEN
    RAISE EXCEPTION 'anon can read restock subscriber addresses';
  END IF;
  IF NOT _commerce_blocked('anon', anon_claims,
    'INSERT INTO public.product_notifications(product_id,email) VALUES (''10000000-0000-0000-0000-000000000001'',''victim@example.com'')') THEN
    RAISE EXCEPTION 'anon can create restock alerts directly';
  END IF;

  SELECT stock_status INTO v_original_status FROM public.products WHERE id = v_product_id;
  v_key := 'restock:' || v_product_id::text || ':' || v_alert_id::text;
  DELETE FROM public.email_queue WHERE dedupe_key = v_key;
  DELETE FROM public.product_notifications WHERE product_id = v_product_id AND email = v_email;

  UPDATE public.products SET stock_status = 'out_of_stock' WHERE id = v_product_id;
  INSERT INTO public.product_notifications (product_id, email, alert_id, consented_at)
  VALUES (v_product_id, v_email, v_alert_id, now());
  IF EXISTS (SELECT 1 FROM public.email_queue WHERE dedupe_key = v_key) THEN
    RAISE EXCEPTION 'an alert was queued before the product became available';
  END IF;

  UPDATE public.products SET stock_status = 'in_stock' WHERE id = v_product_id;
  SELECT count(*) INTO n FROM public.email_queue WHERE dedupe_key = v_key AND kind = 'restock' AND status = 'queued';
  IF n <> 1 THEN RAISE EXCEPTION 'restock transition did not enqueue exactly one email'; END IF;
  IF _commerce_count('authenticated', owner_claims,
    format('SELECT 1 FROM public.product_notifications WHERE product_id = %L::uuid AND email = %L', v_product_id, v_email)) <> 1 THEN
    RAISE EXCEPTION 'admin-only restock subscriber access stopped working';
  END IF;

  -- A failed delivery can be re-queued after a later restock without a duplicate row.
  UPDATE public.email_queue SET status = 'failed', attempts = 3 WHERE dedupe_key = v_key;
  UPDATE public.products SET stock_status = 'out_of_stock' WHERE id = v_product_id;
  UPDATE public.products SET stock_status = 'in_stock' WHERE id = v_product_id;
  IF NOT EXISTS (SELECT 1 FROM public.email_queue WHERE dedupe_key = v_key AND status = 'queued' AND attempts = 0) THEN
    RAISE EXCEPTION 'failed restock email was not safely re-queued';
  END IF;

  UPDATE public.email_queue SET status = 'sent', sent_at = now() WHERE dedupe_key = v_key;
  UPDATE public.product_notifications SET notified_at = now() WHERE product_id = v_product_id AND alert_id = v_alert_id;
  UPDATE public.products SET stock_status = 'out_of_stock' WHERE id = v_product_id;
  UPDATE public.products SET stock_status = 'in_stock' WHERE id = v_product_id;
  SELECT count(*) INTO n FROM public.email_queue WHERE dedupe_key = v_key;
  IF n <> 1 THEN RAISE EXCEPTION 'a completed one-time alert was duplicated'; END IF;

  DELETE FROM public.product_notifications WHERE product_id = v_product_id AND email = v_email;
  DELETE FROM public.email_queue WHERE dedupe_key = v_key;
  UPDATE public.products SET stock_status = v_original_status WHERE id = v_product_id;
END $$;

DROP FUNCTION _commerce_count(text, jsonb, text);
DROP FUNCTION _commerce_blocked(text, jsonb, text);
