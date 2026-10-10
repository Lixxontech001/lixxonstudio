-- Buddy phase 2 slice 3: the owner's orders to the minds.
-- An order is what the owner asks for in plain words. It starts as "waiting".
-- Only the owner can add one, and only as waiting. Workers move it to done or blocked later (service role).
-- Owner only, like Buddy's chats. Named buddy_orders so it does not clash with the shop's orders table.
-- Additive. NOT applied to production.

CREATE TABLE IF NOT EXISTS public.buddy_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  instruction text NOT NULL CHECK (char_length(instruction) BETWEEN 1 AND 1000),
  mind text CHECK (mind IS NULL OR mind IN ('analyst', 'strategist', 'ceo', 'executioner', 'auditor')),
  status text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'done', 'blocked')),
  blocked_reason text CHECK (blocked_reason IS NULL OR char_length(blocked_reason) BETWEEN 1 AND 300),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  done_at timestamptz,
  -- A blocked order must say why. Only a blocked order has a reason.
  CONSTRAINT buddy_orders_blocked_reason_rule CHECK ((status = 'blocked') = (blocked_reason IS NOT NULL)),
  -- A done order has a done time. Only a done order has one.
  CONSTRAINT buddy_orders_done_at_check CHECK ((status = 'done') = (done_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS buddy_orders_owner_recent ON public.buddy_orders (owner_id, created_at DESC);

ALTER TABLE public.buddy_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS buddy_orders_owner_select ON public.buddy_orders;
CREATE POLICY buddy_orders_owner_select ON public.buddy_orders
  FOR SELECT TO authenticated
  USING (owner_id = auth.uid() AND public.is_admin() AND (public.is_owner() OR public.is_founder()));

-- The owner may add an order only as "waiting", with no reason and no done time.
DROP POLICY IF EXISTS buddy_orders_owner_insert ON public.buddy_orders;
CREATE POLICY buddy_orders_owner_insert ON public.buddy_orders
  FOR INSERT TO authenticated
  WITH CHECK (
    owner_id = auth.uid()
    AND public.is_admin()
    AND (public.is_owner() OR public.is_founder())
    AND status = 'waiting'
    AND blocked_reason IS NULL
    AND done_at IS NULL
  );

REVOKE ALL ON public.buddy_orders FROM PUBLIC, anon;
GRANT SELECT, INSERT ON public.buddy_orders TO authenticated;
