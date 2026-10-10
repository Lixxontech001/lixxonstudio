-- Buddy phase 2 slice 3: the daily log. Every mind action is written here, one row each.
-- The owner can read it. Nobody in the browser can write, change or delete it:
-- only the server (service role) writes rows, so the log stays a true record.
-- Additive. NOT applied to production.

CREATE TABLE IF NOT EXISTS public.minds_daily_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  day date NOT NULL,
  happened_at timestamptz NOT NULL DEFAULT now(),
  mind text NOT NULL CHECK (mind IN ('buddy', 'analyst', 'strategist', 'ceo', 'executioner', 'auditor')),
  action text NOT NULL CHECK (char_length(action) BETWEEN 1 AND 120),
  outcome text NOT NULL CHECK (outcome IN ('done', 'skipped', 'blocked', 'failed')),
  detail text NOT NULL DEFAULT '' CHECK (char_length(detail) <= 500),
  order_id uuid REFERENCES public.buddy_orders(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS minds_daily_log_owner_day ON public.minds_daily_log (owner_id, day, happened_at);

ALTER TABLE public.minds_daily_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS minds_daily_log_owner_select ON public.minds_daily_log;
CREATE POLICY minds_daily_log_owner_select ON public.minds_daily_log
  FOR SELECT TO authenticated
  USING (owner_id = auth.uid() AND public.is_admin() AND (public.is_owner() OR public.is_founder()));

-- No insert, update or delete policy for the browser: the log is written by the server only.
REVOKE ALL ON public.minds_daily_log FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.minds_daily_log TO authenticated;
