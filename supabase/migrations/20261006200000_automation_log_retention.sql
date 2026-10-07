-- =============================================================================
-- Phase 5 (Slice 4) — cleanup: automation log retention.
--
-- Mirrors the existing `admin_prune_audit(180)` pattern that already governs the
-- admin audit trail. Automation logs (run evidence, channel delivery receipts,
-- push test evidence) are operationally useful for a bounded window and are
-- personal-data-free by construction, but they should not accumulate forever.
--
-- Safety:
--   * Owner or service_role only. No browser role can execute it.
--   * Hard floor of 90 days: a smaller request is clamped, so a bug or a careless
--     call can never wipe recent evidence.
--   * Never touches articles, posts, orders, customers, media or the admin audit
--     trail — only rows in `public.automation_logs`.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.automation_prune_logs(p_retain_days integer DEFAULT 180)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_days integer := GREATEST(COALESCE(p_retain_days, 180), 90);
  v_deleted integer := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND NOT public.automation_owner_authorized() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.automation_logs
   WHERE created_at < now() - make_interval(days => v_days);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END $$;

REVOKE ALL ON FUNCTION public.automation_prune_logs(integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.automation_prune_logs(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.automation_prune_logs(integer) TO service_role;

-- Weekly retention job (no-op unless pg_cron is installed, as on Supabase).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule('prune-automation-logs');
    EXCEPTION WHEN others THEN NULL;
    END;
    PERFORM cron.schedule('prune-automation-logs', '25 4 * * 0', 'SELECT public.automation_prune_logs(180);');
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
