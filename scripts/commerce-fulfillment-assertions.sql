-- Atomic checkout settlement, $0 unlocks, payment idempotency and private retry jobs.
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION _commerce_settle_as_service(
  p_order_id uuid, p_transaction_id text, p_amount numeric, p_currency text,
  p_internal_zero boolean DEFAULT false, p_via_webhook boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE result jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  EXECUTE 'SET LOCAL ROLE service_role';
  SELECT public.commerce_settle_verified_order(
    p_order_id, p_transaction_id, p_amount, p_currency, p_internal_zero, p_via_webhook
  ) INTO result;
  RESET ROLE;
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION _commerce_claim_as_service(p_order_id uuid, p_job_type text)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE result boolean;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  EXECUTE 'SET LOCAL ROLE service_role';
  SELECT public.commerce_claim_fulfillment_job(p_order_id, p_job_type) INTO result;
  RESET ROLE;
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION _commerce_complete_as_service(
  p_order_id uuid, p_job_type text, p_success boolean, p_error_code text DEFAULT NULL
) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE result boolean;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  EXECUTE 'SET LOCAL ROLE service_role';
  SELECT public.commerce_complete_fulfillment_job(p_order_id, p_job_type, p_success, p_error_code) INTO result;
  RESET ROLE;
  RETURN result;
END $$;

DO $$
DECLARE
  v_zero uuid := '40000000-0000-0000-0000-000000000001';
  v_paid uuid := '40000000-0000-0000-0000-000000000002';
  v_gift uuid := '40000000-0000-0000-0000-000000000003';
  v_product uuid := '10000000-0000-0000-0000-000000000001';
  v_result jsonb;
  v_token text;
  v_gift_code text;
  v_count integer;
  v_status text;
  v_claimed boolean;
  v_completed boolean;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = v_product AND is_digital AND file_path IS NOT NULL) THEN
    RAISE EXCEPTION 'fulfillment assertion needs the existing digital product fixture';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.commerce_fulfillment_jobs'::regclass) THEN
    RAISE EXCEPTION 'commerce fulfillment jobs must have RLS enabled';
  END IF;
  IF has_table_privilege('anon', 'public.commerce_fulfillment_jobs', 'SELECT')
     OR has_table_privilege('authenticated', 'public.commerce_fulfillment_jobs', 'SELECT')
     OR has_table_privilege('anon', 'public.commerce_fulfillment_jobs', 'INSERT')
     OR has_table_privilege('authenticated', 'public.commerce_fulfillment_jobs', 'UPDATE') THEN
    RAISE EXCEPTION 'client roles have direct access to private fulfillment jobs';
  END IF;
  IF has_function_privilege('anon', 'public.commerce_settle_verified_order(uuid,text,numeric,text,boolean,boolean)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.commerce_settle_verified_order(uuid,text,numeric,text,boolean,boolean)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.commerce_claim_fulfillment_job(uuid,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.commerce_complete_fulfillment_job(uuid,text,boolean,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'a client role can call a service-only fulfillment function';
  END IF;

  INSERT INTO public.orders (id, order_number, customer_email, customer_name, status, payment_status, payment_provider, amount, currency)
  VALUES (v_zero, 'LXX-ZERO-FULFILL', 'zero@example.com', 'Zero Buyer', 'pending', 'pending', 'promo', 0, 'USD');
  INSERT INTO public.order_items (order_id, product_id, product_name, product_slug, price, quantity, file_path)
  SELECT v_zero, p.id, p.name, p.slug, 0, 1, p.file_path FROM public.products p WHERE p.id = v_product;

  v_result := _commerce_settle_as_service(v_zero, NULL, 0, 'USD', true, false);
  IF v_result->>'ok' <> 'true' OR v_result->>'already_paid' <> 'false' THEN
    RAISE EXCEPTION 'zero-balance settlement did not complete the first fulfillment';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.orders WHERE id = v_zero AND payment_status = 'paid' AND status = 'fulfilled' AND paid_at IS NOT NULL AND payment_reference IS NULL) THEN
    RAISE EXCEPTION 'zero-balance order was not atomically marked fulfilled';
  END IF;
  SELECT download_token INTO v_token FROM public.download_entitlements WHERE order_id = v_zero AND product_id = v_product;
  IF v_token IS NULL OR jsonb_array_length(v_result->'entitlements') <> 1 THEN
    RAISE EXCEPTION 'zero-balance order did not unlock its digital item';
  END IF;
  IF (SELECT count(*) FROM public.commerce_fulfillment_jobs WHERE order_id = v_zero AND job_type = 'receipt') <> 1 THEN
    RAISE EXCEPTION 'zero-balance order did not queue exactly one receipt';
  END IF;
  v_result := _commerce_settle_as_service(v_zero, NULL, 0, 'USD', true, false);
  IF v_result->>'already_paid' <> 'true'
     OR (v_result->'entitlements'->0->>'download_token') <> v_token
     OR (SELECT count(*) FROM public.download_entitlements WHERE order_id = v_zero AND product_id = v_product) <> 1
     OR (SELECT count(*) FROM public.commerce_fulfillment_jobs WHERE order_id = v_zero AND job_type = 'receipt') <> 1 THEN
    RAISE EXCEPTION 'zero-balance retry created duplicate unlocks or receipt jobs';
  END IF;

  INSERT INTO public.orders (id, order_number, customer_email, customer_name, status, payment_status, payment_provider, amount, currency)
  VALUES (v_paid, 'LXX-PAID-FULFILL', 'paid@example.com', 'Paid Buyer', 'pending', 'pending', 'flutterwave', 19.99, 'USD');
  INSERT INTO public.order_items (order_id, product_id, product_name, product_slug, price, quantity, file_path)
  SELECT v_paid, p.id, p.name, p.slug, 19.99, 2, p.file_path FROM public.products p WHERE p.id = v_product;

  BEGIN
    PERFORM _commerce_settle_as_service(v_paid, '81726354', 19.98, 'USD', false, false);
    RAISE EXCEPTION 'wrong payment amount unexpectedly settled';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  IF NOT EXISTS (SELECT 1 FROM public.orders WHERE id = v_paid AND payment_status = 'pending' AND payment_reference IS NULL)
     OR EXISTS (SELECT 1 FROM public.download_entitlements WHERE order_id = v_paid) THEN
    RAISE EXCEPTION 'failed amount validation partially changed the order';
  END IF;
  BEGIN
    PERFORM _commerce_settle_as_service(v_paid, '81726354', 19.99, 'NGN', false, false);
    RAISE EXCEPTION 'wrong payment currency unexpectedly settled';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;

  v_result := _commerce_settle_as_service(v_paid, '81726354', 19.99, 'USD', false, false);
  IF v_result->>'already_paid' <> 'false'
     OR NOT EXISTS (SELECT 1 FROM public.orders WHERE id = v_paid AND payment_status = 'paid' AND payment_reference = '81726354' AND payment_provider = 'flutterwave') THEN
    RAISE EXCEPTION 'verified Flutterwave payment did not settle';
  END IF;
  SELECT download_token INTO v_token FROM public.download_entitlements WHERE order_id = v_paid AND product_id = v_product;
  IF v_token IS NULL OR (SELECT max_downloads FROM public.download_entitlements WHERE order_id = v_paid AND product_id = v_product) <> 10 THEN
    RAISE EXCEPTION 'verified order entitlement did not preserve purchased quantity';
  END IF;
  v_result := _commerce_settle_as_service(v_paid, '81726354', 19.99, 'USD', false, true);
  IF v_result->>'already_paid' <> 'true'
     OR (v_result->'entitlements'->0->>'download_token') <> v_token
     OR NOT EXISTS (SELECT 1 FROM public.orders WHERE id = v_paid AND webhook_verified)
     OR (SELECT count(*) FROM public.download_entitlements WHERE order_id = v_paid AND product_id = v_product) <> 1 THEN
    RAISE EXCEPTION 'duplicate webhook did not repair/confirm idempotently';
  END IF;
  BEGIN
    PERFORM _commerce_settle_as_service(v_paid, 'different-tx', 19.99, 'USD', false, false);
    RAISE EXCEPTION 'different payment reference unexpectedly settled an already-paid order';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  IF NOT EXISTS (SELECT 1 FROM public.orders WHERE id = v_paid AND payment_reference = '81726354') THEN
    RAISE EXCEPTION 'duplicate callback replaced the stored payment reference';
  END IF;

  -- Failed email delivery is retryable, concurrent claims cannot both win, and a
  -- completed job stays completed on later payment/webhook retries.
  v_claimed := _commerce_claim_as_service(v_paid, 'receipt');
  IF NOT v_claimed THEN RAISE EXCEPTION 'receipt job could not be claimed'; END IF;
  v_claimed := _commerce_claim_as_service(v_paid, 'receipt');
  IF v_claimed THEN RAISE EXCEPTION 'receipt outbox allowed a duplicate active claim'; END IF;
  v_completed := _commerce_complete_as_service(v_paid, 'receipt', false, 'EMAIL_PROVIDER_UNAVAILABLE');
  IF NOT v_completed THEN RAISE EXCEPTION 'failed receipt attempt was not recorded'; END IF;
  v_claimed := _commerce_claim_as_service(v_paid, 'receipt');
  IF NOT v_claimed THEN RAISE EXCEPTION 'failed receipt could not be retried'; END IF;
  v_completed := _commerce_complete_as_service(v_paid, 'receipt', true, NULL);
  IF NOT v_completed THEN RAISE EXCEPTION 'successful receipt was not recorded'; END IF;
  v_claimed := _commerce_claim_as_service(v_paid, 'receipt');
  IF v_claimed THEN RAISE EXCEPTION 'sent receipt job was claimed again'; END IF;
  SELECT status INTO v_status FROM public.commerce_fulfillment_jobs WHERE order_id = v_paid AND job_type = 'receipt';
  IF v_status <> 'sent' THEN RAISE EXCEPTION 'completed receipt job is not marked sent'; END IF;

  -- Gift-card creation lives in the settlement transaction and is unique per order.
  INSERT INTO public.orders (id, order_number, customer_email, customer_name, status, payment_status, payment_provider, amount, currency, meta)
  VALUES (v_gift, 'LXX-GIFT-FULFILL', 'buyer@example.com', 'Gift Buyer', 'pending', 'pending', 'flutterwave', 10, 'USD',
    '{"gift_card":{"amount":10,"recipient_email":"recipient@example.com","recipient_name":"Recipient","message":"Enjoy"}}'::jsonb);
  INSERT INTO public.order_items (order_id, product_id, product_name, product_slug, price, quantity)
  VALUES (v_gift, NULL, 'Gift card', 'gift-card', 10, 1);
  v_result := _commerce_settle_as_service(v_gift, '81726355', 10, 'USD', false, false);
  SELECT code INTO v_gift_code FROM public.gift_cards WHERE order_id = v_gift;
  IF v_gift_code IS NULL OR v_result->'gift_card'->>'code' <> v_gift_code THEN
    RAISE EXCEPTION 'gift card was not issued in the settlement transaction';
  END IF;
  v_result := _commerce_settle_as_service(v_gift, '81726355', 10, 'USD', false, true);
  SELECT count(*) INTO v_count FROM public.gift_cards WHERE order_id = v_gift;
  IF v_count <> 1 OR (SELECT count(*) FROM public.commerce_fulfillment_jobs WHERE order_id = v_gift AND job_type = 'gift_card_email') <> 1 THEN
    RAISE EXCEPTION 'duplicate callback created a second gift card or gift email job';
  END IF;
  v_claimed := _commerce_claim_as_service(v_gift, 'gift_card_email');
  IF NOT v_claimed THEN RAISE EXCEPTION 'gift-card email job could not be claimed'; END IF;
  v_completed := _commerce_complete_as_service(v_gift, 'gift_card_email', true, NULL);
  IF NOT v_completed OR NOT EXISTS (
    SELECT 1 FROM public.gift_cards WHERE order_id = v_gift AND delivered_at IS NOT NULL
  ) THEN RAISE EXCEPTION 'gift card delivery state was not recorded'; END IF;
END $$;

DROP FUNCTION _commerce_settle_as_service(uuid, text, numeric, text, boolean, boolean);
DROP FUNCTION _commerce_claim_as_service(uuid, text);
DROP FUNCTION _commerce_complete_as_service(uuid, text, boolean, text);
