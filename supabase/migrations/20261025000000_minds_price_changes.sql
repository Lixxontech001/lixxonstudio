-- Phase I slice 5: one US dollar price change, written by the database's own door.
-- The Auditor is checked before this call in the app's own rules; this function re-checks every rule itself, so a
-- price can never be written by a call that skipped a check. US dollars only, never nothing, never free, one change
-- per product per day, a quarter at most, and the old price and the new one are both recorded.
-- Additive. NOT applied to production.

CREATE TABLE IF NOT EXISTS public.minds_price_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  local_day date NOT NULL,
  from_cents integer NOT NULL CHECK (from_cents > 0),
  to_cents integer NOT NULL CHECK (to_cents > 0),
  why text NOT NULL DEFAULT '' CHECK (char_length(why) <= 200),
  applied_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, product_id, local_day)
);

CREATE INDEX IF NOT EXISTS minds_price_changes_owner_day ON public.minds_price_changes (owner_id, local_day DESC);

ALTER TABLE public.minds_price_changes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS minds_price_changes_owner_select ON public.minds_price_changes;
CREATE POLICY minds_price_changes_owner_select ON public.minds_price_changes
  FOR SELECT TO authenticated
  USING (owner_id = auth.uid() AND public.is_admin() AND (public.is_owner() OR public.is_founder()));

REVOKE ALL ON public.minds_price_changes FROM PUBLIC, anon;
GRANT SELECT ON public.minds_price_changes TO authenticated;

-- No insert, update or delete policy for signed-in users. Only this function writes, and only for the server.

-- Applies one US dollar price change. Returns the cents it recorded: {"from_cents": .., "to_cents": ..}.
-- Refused when Takeover is off or Kill stops the minds (minds_assert_can_act), when the product is not a live US
-- dollar product, when the new price is nothing or free, when the step is smaller than 50 cents, when it moves the
-- price by more than a quarter, when the same product already changed today, or when the reason names other money.
CREATE OR REPLACE FUNCTION public.minds_apply_price_change(
  p_owner_id uuid,
  p_product_id uuid,
  p_new_cents integer,
  p_local_day date,
  p_why text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product record;
  v_why text;
  v_from integer;
BEGIN
  PERFORM public.minds_assert_can_act();

  IF p_owner_id IS NULL OR p_product_id IS NULL OR p_new_cents IS NULL OR p_local_day IS NULL THEN
    RAISE EXCEPTION 'price_missing_value' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.app_admins WHERE user_id = p_owner_id AND role = 'owner') THEN
    RAISE EXCEPTION 'not_owner' USING ERRCODE = 'check_violation';
  END IF;

  SELECT id, is_active, currency, price_cents INTO v_product
    FROM public.products WHERE id = p_product_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'price_product_unknown' USING ERRCODE = 'check_violation';
  END IF;
  IF v_product.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'price_product_not_live' USING ERRCODE = 'check_violation';
  END IF;
  IF v_product.currency IS NOT NULL AND upper(v_product.currency) <> 'USD' THEN
    RAISE EXCEPTION 'price_not_usd' USING ERRCODE = 'check_violation';
  END IF;

  v_from := COALESCE(v_product.price_cents, 0);
  IF v_from <= 0 THEN
    RAISE EXCEPTION 'price_missing' USING ERRCODE = 'check_violation';
  END IF;

  -- Nothing, free and negative are all refused, and so is a step that is not really a change.
  IF p_new_cents <= 0 THEN
    RAISE EXCEPTION 'price_free' USING ERRCODE = 'check_violation';
  END IF;
  IF p_new_cents < 100 THEN
    RAISE EXCEPTION 'price_too_low' USING ERRCODE = 'check_violation';
  END IF;
  IF p_new_cents > 99999 THEN
    RAISE EXCEPTION 'price_too_high' USING ERRCODE = 'check_violation';
  END IF;
  IF abs(p_new_cents - v_from) < 50 THEN
    RAISE EXCEPTION 'price_same' USING ERRCODE = 'check_violation';
  END IF;
  IF abs(p_new_cents - v_from) > floor(v_from * 0.25) THEN
    RAISE EXCEPTION 'price_too_big_a_step' USING ERRCODE = 'check_violation';
  END IF;

  -- One change per product per day.
  IF EXISTS (
    SELECT 1 FROM public.minds_price_changes
     WHERE owner_id = p_owner_id AND product_id = p_product_id AND local_day = p_local_day
  ) THEN
    RAISE EXCEPTION 'price_already_changed_today' USING ERRCODE = 'check_violation';
  END IF;

  v_why := btrim(regexp_replace(COALESCE(p_why, ''), '\s+', ' ', 'g'));
  IF v_why = '' THEN
    RAISE EXCEPTION 'price_no_reason' USING ERRCODE = 'check_violation';
  END IF;
  IF char_length(v_why) > 200 THEN
    RAISE EXCEPTION 'price_reason_too_long' USING ERRCODE = 'check_violation';
  END IF;
  -- US dollars only, and no country or city in the words the owner reads.
  IF v_why ~* '(\yngn\y|\ynaira\y|\ygbp\y|\yeur\y|\ynigeria\y|\ynigerian\y|\ylagos\y|\yabuja\y)|[£€₦]' THEN
    RAISE EXCEPTION 'price_reason_money' USING ERRCODE = 'check_violation';
  END IF;

  -- The shop's own price column is kept in step by its existing trigger; both are written here.
  UPDATE public.products
     SET price = to_char(p_new_cents / 100.0, 'FM999999990.00'),
         price_cents = p_new_cents,
         updated_at = now()
   WHERE id = p_product_id;

  INSERT INTO public.minds_price_changes (owner_id, product_id, local_day, from_cents, to_cents, why)
  VALUES (p_owner_id, p_product_id, p_local_day, v_from, p_new_cents, v_why);

  RETURN jsonb_build_object('from_cents', v_from, 'to_cents', p_new_cents);
END;
$$;

REVOKE ALL ON FUNCTION public.minds_apply_price_change(uuid, uuid, integer, date, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.minds_apply_price_change(uuid, uuid, integer, date, text) TO service_role;
