-- Phase E slice 5: the owner push claims a notable ('pending') before it sends, so a second attempt (the browser, the chat,
-- the server flush or the day run) cannot send the same notable again. push_claimed_at says when the claim was made, so
-- an old pending claim (a crashed attempt) can be retried. Additive. NOT applied to production.
-- Until this is applied, the claim write fails and the send goes ahead, as it did before Phase E (see PHASE_E_REPORT.md).
ALTER TABLE public.minds_notable_events DROP CONSTRAINT IF EXISTS minds_notable_events_push_note_check;
ALTER TABLE public.minds_notable_events ADD CONSTRAINT minds_notable_events_push_note_check
  CHECK (push_note IS NULL OR push_note IN ('pending', 'sent', 'no_device', 'not_configured', 'failed', 'not_buzzing'));
ALTER TABLE public.minds_notable_events ADD COLUMN IF NOT EXISTS push_claimed_at timestamptz;
