-- Buddy phase B slice 3: a week spike or drop is a notable. Keeps every kind the table already allows, and adds week_up and week_down.
-- week_up and week_down are briefing kinds, so they buzz the phone too (Phase D slice 4). They show in the briefing's Money & readers section.
-- Additive. NOT applied to production.

ALTER TABLE public.minds_notable_events DROP CONSTRAINT IF EXISTS minds_notable_events_kind_check;
ALTER TABLE public.minds_notable_events ADD CONSTRAINT minds_notable_events_kind_check CHECK (kind IN (
  'takeover_changed', 'kill_changed', 'order_blocked', 'auditor_blocked', 'mind_failed', 'night_report_written',
  'article_changed',
  'door_posted', 'pack_ready', 'sale', 'product_click', 'traffic_new_kind', 'job_finished',
  'door_failed',
  'week_up', 'week_down'
));
