-- Phase E slice 5: no anonymous or ordinary UPDATE policy on abandoned carts.
-- The storefront writes a cart only through the definer function upsert_abandoned_cart, and clears it through
-- clear_abandoned_cart. The owner's admin policy (from 20261003120000) still covers the owner's mark-as-recovered.
-- 20261004230000 already drops both old names. This file makes the removal explicit, and it is safe to run again,
-- so it also covers a database where that earlier file was never applied. NOT applied to production.
DROP POLICY IF EXISTS abandoned_carts_anon_update ON public.abandoned_carts;
DROP POLICY IF EXISTS "rl_ac_update" ON public.abandoned_carts;
