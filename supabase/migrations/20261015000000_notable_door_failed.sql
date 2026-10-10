-- Buddy phase 9 slice 1: a failed door send is a notable. Keeps every kind the table already allows, and adds door_failed.
-- door_failed never buzzes the phone (it is not in the buzz list). It shows in the briefing's Problems section.
-- Additive. NOT applied to production.

ALTER TABLE public.minds_notable_events DROP CONSTRAINT IF EXISTS minds_notable_events_kind_check;
ALTER TABLE public.minds_notable_events ADD CONSTRAINT minds_notable_events_kind_check CHECK (kind IN (
  'takeover_changed', 'kill_changed', 'order_blocked', 'auditor_blocked', 'mind_failed', 'night_report_written',
  'article_changed',
  'door_posted', 'pack_ready', 'sale', 'product_click', 'traffic_new_kind', 'job_finished',
  'door_failed'
));
