-- Atomic, idempotent checkout settlement and retryable customer notifications.
-- No prices, products, refunds, or existing payment rows are changed by this migration.

CREATE TABLE IF NOT EXISTS public.commerce_fulfillment_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  job_type text NOT NULL CHECK (job_type IN ('receipt', 'gift_card_email')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sending', 'sent', 'failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 20),
  lease_until timestamptz,
  last_error_code text CHECK (last_error_code IS NULL OR last_error_code IN (
    'EMAIL_NOT_CONFIGURED', 'EMAIL_PROVIDER_UNAVAILABLE', 'EMAIL_RECIPIENT_INVALID', 'EMAIL_TEMPLATE_ERROR'
  )),
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, job_type)
);

ALTER TABLE public.commerce_fulfillment_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.commerce_fulfillment_jobs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.commerce_fulfillment_jobs TO service_role;

CREATE INDEX IF NOT EXISTS commerce_fulfillment_jobs_retry_idx
  ON public.commerce_fulfillment_jobs (status, lease_until, created_at)
  WHERE status <> 'sent';

CREATE OR REPLACE FUNCTION public.commerce_settle_verified_order(
  p_order_id uuid,
  p_transaction_id text,
  p_amount numeric,
  p_currency text,
  p_internal_zero boolean DEFAULT false,
  p_via_webhook boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_already_paid boolean := false;
  v_item record;
  v_gift jsonb;
  v_gift_amount numeric;
  v_gift_card public.gift_cards%ROWTYPE;
  v_gift_card_json jsonb := NULL;
  v_code text;
  v_entitlements jsonb := '[]'::jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_order_id IS NULL OR p_currency IS NULL OR length(btrim(p_currency)) NOT BETWEEN 3 AND 8 THEN
    RAISE EXCEPTION 'invalid settlement request' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_order
    FROM public.orders
   WHERE id = p_order_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order not found' USING ERRCODE = 'P0002'; END IF;

  IF upper(btrim(p_currency)) <> upper(btrim(v_order.currency)) THEN
    RAISE EXCEPTION 'currency mismatch' USING ERRCODE = '22023';
  END IF;

  IF COALESCE(p_internal_zero, false) THEN
    IF p_transaction_id IS NOT NULL OR p_amount IS DISTINCT FROM 0::numeric
       OR v_order.amount IS DISTINCT FROM 0::numeric
       OR v_order.payment_provider NOT IN ('promo', 'gift_card', 'promo_or_gift_card')
       OR v_order.payment_reference IS NOT NULL THEN
      RAISE EXCEPTION 'invalid zero-amount settlement' USING ERRCODE = '22023';
    END IF;
    v_already_paid := v_order.payment_status = 'paid';
    IF v_order.payment_status NOT IN ('pending', 'paid') THEN
      RAISE EXCEPTION 'zero-amount order is not settleable' USING ERRCODE = '22023';
    END IF;
  ELSE
    IF p_transaction_id IS NULL OR length(btrim(p_transaction_id)) NOT BETWEEN 1 AND 128
       OR p_transaction_id !~ '^[A-Za-z0-9._:-]+$'
       OR p_amount IS NULL OR p_amount <= 0
       OR abs(round(p_amount, 2) - round(v_order.amount, 2)) > 0.009
       OR v_order.amount <= 0 THEN
      RAISE EXCEPTION 'payment amount or reference mismatch' USING ERRCODE = '22023';
    END IF;
    IF v_order.payment_status = 'paid' THEN
      IF v_order.payment_provider IS DISTINCT FROM 'flutterwave'
         OR v_order.payment_reference IS DISTINCT FROM p_transaction_id THEN
        RAISE EXCEPTION 'payment reference mismatch' USING ERRCODE = '22023';
      END IF;
      v_already_paid := true;
    END IF;
  END IF;

  -- The order row lock serializes callbacks for the same order. A duplicate of the
  -- same verified transaction repairs missing legacy fulfilment; a different tx
  -- can never replace the stored payment reference.
  UPDATE public.orders
     SET payment_status = 'paid',
         status = 'fulfilled',
         payment_reference = CASE WHEN COALESCE(p_internal_zero, false) THEN payment_reference ELSE p_transaction_id END,
         payment_provider = CASE WHEN COALESCE(p_internal_zero, false) THEN payment_provider ELSE 'flutterwave' END,
         paid_at = COALESCE(paid_at, now()),
         webhook_verified = webhook_verified OR COALESCE(p_via_webhook, false),
         updated_at = now()
   WHERE id = p_order_id;

  -- Use the immutable line-item file snapshot where available. The order lock
  -- makes the existence check safe against concurrent callback fulfilment.
  FOR v_item IN
    SELECT oi.product_id,
           COALESCE(max(NULLIF(p.name, '')), max(NULLIF(oi.product_name, '')), 'Digital product') AS product_name,
           max(COALESCE(NULLIF(p.file_path, ''), NULLIF(oi.file_path, ''))) AS file_path,
           sum(GREATEST(COALESCE(oi.quantity, 1), 1))::integer AS quantity
      FROM public.order_items oi
      LEFT JOIN public.products p ON p.id = oi.product_id
     WHERE oi.order_id = p_order_id
       AND oi.product_id IS NOT NULL
       AND (COALESCE(p.is_digital, false) OR COALESCE(p.product_type, '') = 'digital' OR NULLIF(oi.file_path, '') IS NOT NULL)
       AND COALESCE(NULLIF(p.file_path, ''), NULLIF(oi.file_path, '')) IS NOT NULL
     GROUP BY oi.product_id
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.download_entitlements e
       WHERE e.order_id = p_order_id AND e.product_id = v_item.product_id
    ) THEN
      INSERT INTO public.download_entitlements (
        order_id, customer_email, product_id, file_path, download_token,
        download_count, max_downloads, expires_at
      ) VALUES (
        p_order_id, v_order.customer_email, v_item.product_id, v_item.file_path,
        gen_random_uuid()::text, 0, 5 * GREATEST(v_item.quantity, 1), now() + interval '30 days'
      );
    END IF;
  END LOOP;

  -- Issue a purchased gift card in the same transaction as settlement. The
  -- unique order lock prevents duplicate cards without deleting legacy rows.
  v_gift := v_order.meta->'gift_card';
  IF jsonb_typeof(v_gift) = 'object' THEN
    BEGIN
      v_gift_amount := NULLIF(v_gift->>'amount', '')::numeric;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'invalid gift-card order details' USING ERRCODE = '22023';
    END;
    IF v_gift_amount IS NULL OR v_gift_amount <= 0 OR v_gift_amount > 500
       OR COALESCE(v_gift->>'recipient_email', '') !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$' THEN
      RAISE EXCEPTION 'invalid gift-card order details' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_gift_card
      FROM public.gift_cards
     WHERE order_id = p_order_id
     ORDER BY created_at, id
     LIMIT 1
     FOR UPDATE;
    IF NOT FOUND THEN
      LOOP
        v_code := 'LXG-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 4)) || '-'
          || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 4)) || '-'
          || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 4));
        INSERT INTO public.gift_cards (
          code, initial_balance, balance, buyer_email, recipient_email, message,
          is_active, order_id, expires_at, delivered_at
        ) VALUES (
          v_code, v_gift_amount, v_gift_amount, v_order.customer_email,
          lower(btrim(v_gift->>'recipient_email')), NULLIF(v_gift->>'message', ''),
          true, p_order_id, now() + interval '365 days', NULL
        ) ON CONFLICT (code) DO NOTHING;
        EXIT WHEN FOUND;
      END LOOP;
      SELECT * INTO v_gift_card FROM public.gift_cards WHERE order_id = p_order_id ORDER BY created_at, id LIMIT 1 FOR UPDATE;
    END IF;
    INSERT INTO public.commerce_fulfillment_jobs (order_id, job_type)
    VALUES (p_order_id, 'gift_card_email')
    ON CONFLICT (order_id, job_type) DO NOTHING;
    v_gift_card_json := jsonb_build_object(
      'code', v_gift_card.code,
      'amount', v_gift_card.initial_balance,
      'recipient_email', v_gift_card.recipient_email,
      'recipient_name', NULLIF(v_gift->>'recipient_name', ''),
      'message', v_gift_card.message,
      'delivered_at', v_gift_card.delivered_at
    );
  END IF;

  INSERT INTO public.commerce_fulfillment_jobs (order_id, job_type)
  VALUES (p_order_id, 'receipt')
  ON CONFLICT (order_id, job_type) DO NOTHING;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'product_id', e.product_id,
        'product_name', COALESCE(p.name, 'Digital product'),
        'download_token', e.download_token
      ) ORDER BY e.created_at, e.id
    ), '[]'::jsonb
  ) INTO v_entitlements
    FROM public.download_entitlements e
    LEFT JOIN public.products p ON p.id = e.product_id
   WHERE e.order_id = p_order_id;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  RETURN jsonb_build_object(
    'ok', true,
    'already_paid', v_already_paid,
    'order', jsonb_build_object(
      'id', v_order.id,
      'order_number', v_order.order_number,
      'customer_email', v_order.customer_email,
      'customer_name', v_order.customer_name,
      'amount', v_order.amount,
      'currency', v_order.currency,
      'subtotal', v_order.subtotal,
      'discount_amount', v_order.discount_amount,
      'gift_card_amount', v_order.gift_card_amount,
      'promo_code', v_order.promo_code
    ),
    'entitlements', v_entitlements,
    'gift_card', v_gift_card_json
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.commerce_claim_fulfillment_job(p_order_id uuid, p_job_type text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_job_id uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_job_type NOT IN ('receipt', 'gift_card_email') THEN
    RAISE EXCEPTION 'invalid fulfillment job' USING ERRCODE = '22023';
  END IF;
  SELECT id INTO v_job_id
    FROM public.commerce_fulfillment_jobs
   WHERE order_id = p_order_id
     AND job_type = p_job_type
     AND attempts < 20
     AND (status = 'queued' OR (status = 'sending' AND lease_until < now()))
   FOR UPDATE SKIP LOCKED
   LIMIT 1;
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE public.commerce_fulfillment_jobs
     SET status = 'sending', attempts = attempts + 1,
         lease_until = now() + interval '5 minutes',
         updated_at = now()
   WHERE id = v_job_id;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.commerce_complete_fulfillment_job(
  p_order_id uuid,
  p_job_type text,
  p_success boolean,
  p_error_code text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_updated integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_job_type NOT IN ('receipt', 'gift_card_email') THEN
    RAISE EXCEPTION 'invalid fulfillment job' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(p_success, false) THEN
    UPDATE public.commerce_fulfillment_jobs
       SET status = 'sent', sent_at = COALESCE(sent_at, now()), lease_until = NULL,
           last_error_code = NULL, updated_at = now()
     WHERE order_id = p_order_id AND job_type = p_job_type AND status = 'sending';
  ELSE
    IF p_error_code IS NULL OR p_error_code NOT IN ('EMAIL_NOT_CONFIGURED', 'EMAIL_PROVIDER_UNAVAILABLE', 'EMAIL_RECIPIENT_INVALID', 'EMAIL_TEMPLATE_ERROR') THEN
      RAISE EXCEPTION 'invalid safe email error code' USING ERRCODE = '22023';
    END IF;
    UPDATE public.commerce_fulfillment_jobs
       SET status = CASE WHEN attempts >= 20 THEN 'failed' ELSE 'queued' END,
           lease_until = NULL,
           last_error_code = p_error_code, updated_at = now()
     WHERE order_id = p_order_id AND job_type = p_job_type AND status = 'sending';
  END IF;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN RETURN false; END IF;

  IF COALESCE(p_success, false) AND p_job_type = 'gift_card_email' THEN
    UPDATE public.gift_cards SET delivered_at = COALESCE(delivered_at, now())
     WHERE order_id = p_order_id;
  END IF;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.commerce_settle_verified_order(uuid, text, numeric, text, boolean, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.commerce_claim_fulfillment_job(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.commerce_complete_fulfillment_job(uuid, text, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commerce_settle_verified_order(uuid, text, numeric, text, boolean, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.commerce_claim_fulfillment_job(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.commerce_complete_fulfillment_job(uuid, text, boolean, text) TO service_role;

NOTIFY pgrst, 'reload schema';
