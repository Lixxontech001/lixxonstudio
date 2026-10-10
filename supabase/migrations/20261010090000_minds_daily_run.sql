-- Buddy phase 4 slice 1: the once-a-day run's queue.
-- Queues one "Daily run" order for one owner and one local day. It is a waiting order, the same kind the owner files.
-- It returns null when Takeover is off, when Kill stops the run, or when the owner is not the owner. Nothing else is written.
-- Idempotent per day: a second call for the same day returns the order already queued (waiting or done).
-- Service role only. No anon or signed-in access. Additive. NOT applied to production.
-- Scheduling is NOT attached in this phase. It applies at Phase 6 merge, when the owner merges and turns the schedule on.

CREATE OR REPLACE FUNCTION public.minds_queue_daily_run(p_owner_id uuid, p_local_day date)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ctrl record;
  existing uuid;
  new_id uuid;
  day_text text;
BEGIN
  IF p_owner_id IS NULL OR p_local_day IS NULL THEN
    RETURN NULL;
  END IF;

  -- Takeover must be on. Kill must leave the run's minds alone (none, analyst or ceo), the same rule as the placement door.
  SELECT takeover, kill_scope INTO ctrl FROM public.minds_controls WHERE id = 1;
  IF NOT FOUND OR ctrl.takeover IS NOT TRUE THEN
    RETURN NULL;
  END IF;
  IF COALESCE(ctrl.kill_scope, 'all') NOT IN ('none', 'analyst', 'ceo') THEN
    RETURN NULL;
  END IF;

  -- Only the owner has a daily run.
  IF NOT EXISTS (SELECT 1 FROM public.app_admins WHERE user_id = p_owner_id AND role = 'owner') THEN
    RETURN NULL;
  END IF;

  day_text := p_local_day::text;
  -- Two calls for the same owner and day at once cannot both queue an order.
  PERFORM pg_advisory_xact_lock(hashtext('minds_daily_run:' || p_owner_id::text || ':' || day_text));

  SELECT id INTO existing
    FROM public.buddy_orders
   WHERE owner_id = p_owner_id
     AND instruction LIKE 'Daily run for ' || day_text || ':%'
     AND status IN ('waiting', 'done')
   ORDER BY created_at
   LIMIT 1;
  IF existing IS NOT NULL THEN
    RETURN existing;
  END IF;

  INSERT INTO public.buddy_orders (owner_id, instruction, status)
  VALUES (p_owner_id, 'Daily run for ' || day_text || ': today''s products and posts.', 'waiting')
  RETURNING id INTO new_id;

  RETURN new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.minds_queue_daily_run(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.minds_queue_daily_run(uuid, date) TO service_role;

-- The schedule is NOT attached in this phase. The line below would only queue today's order. The run itself starts
-- through the owner-only run function, after the order is waiting. At Phase 6 merge the owner turns this on. Until then it stays a comment.
-- SELECT cron.schedule('minds-daily-run', '0 7 * * *', $cron$ SELECT public.minds_queue_daily_run('<owner-id>'::uuid, current_date) $cron$);
