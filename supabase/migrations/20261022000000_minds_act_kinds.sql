-- Phase I slice 3: every act can be written as a notable event. Keeps every kind the table already allows, and adds
-- the four acts that were silent: a door that did not go out, a price change, a saved pack, and a product that looks
-- dead. All four are briefing kinds, so they buzz the phone and appear in the morning briefing and the night report.
-- Additive. NOT applied to production.

ALTER TABLE public.minds_notable_events DROP CONSTRAINT IF EXISTS minds_notable_events_kind_check;
ALTER TABLE public.minds_notable_events ADD CONSTRAINT minds_notable_events_kind_check CHECK (kind IN (
  'takeover_changed', 'kill_changed', 'order_blocked', 'auditor_blocked', 'mind_failed', 'night_report_written',
  'article_changed',
  'door_posted', 'pack_ready', 'sale', 'product_click', 'traffic_new_kind', 'job_finished',
  'door_failed',
  'week_up', 'week_down',
  'door_skipped', 'price_changed', 'pack_saved', 'product_looks_dead'
));
