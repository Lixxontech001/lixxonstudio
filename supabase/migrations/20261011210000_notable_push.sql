-- Phase 7 slice 4: the notable kinds that can buzz the owner's phone, and a short note of what the push did.
-- Keeps every kind the table already allows, and adds the new ones. Heartbeat is not a notable kind, so it never buzzes.
-- Additive. NOT applied to production. Nothing in this file sends a push: the day run does that, with the Web Push code.

ALTER TABLE public.minds_notable_events DROP CONSTRAINT IF EXISTS minds_notable_events_kind_check;
ALTER TABLE public.minds_notable_events ADD CONSTRAINT minds_notable_events_kind_check CHECK (kind IN (
  'takeover_changed', 'kill_changed', 'order_blocked', 'auditor_blocked', 'mind_failed', 'night_report_written',
  'article_changed',
  'door_posted', 'pack_ready', 'sale', 'product_click', 'traffic_new_kind', 'job_finished'
));

-- What the push did for this event. Null when the kind does not buzz. Written by the day run after the send.
ALTER TABLE public.minds_notable_events
  ADD COLUMN IF NOT EXISTS push_note text CHECK (push_note IS NULL OR push_note IN ('sent', 'no_device', 'not_configured', 'failed', 'not_buzzing'));
