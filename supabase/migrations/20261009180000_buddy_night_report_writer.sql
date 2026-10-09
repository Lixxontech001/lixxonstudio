-- Buddy phase 2 slice 3: one night report per owner per day, so a retry cannot write a second one.
-- The writer itself is server code (supabase/functions/_shared/mindsNightReport.ts). It writes with the service role.
-- Nothing calls the writer yet: no cron, no scheduler. Additive. NOT applied to production.

CREATE UNIQUE INDEX IF NOT EXISTS buddy_reports_one_per_owner_day ON public.buddy_reports (owner_id, report_date);
