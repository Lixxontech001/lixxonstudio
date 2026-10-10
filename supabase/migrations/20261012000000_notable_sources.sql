-- Phase 7 follow-up: a source key on each notable event, so the same paid order, day of clicks,
-- traffic source or finished job is written, and buzzed, once per owner.
-- Additive. Rows without a key are unchanged. NOT applied to production.
-- Writes nothing: the day run writes the rows, and the database only refuses a second row with the same key.

ALTER TABLE public.minds_notable_events
  ADD COLUMN IF NOT EXISTS source_key text CHECK (source_key IS NULL OR char_length(source_key) BETWEEN 1 AND 200);

CREATE UNIQUE INDEX IF NOT EXISTS minds_notable_events_source_key_uidx
  ON public.minds_notable_events (owner_id, source_key)
  WHERE source_key IS NOT NULL;
