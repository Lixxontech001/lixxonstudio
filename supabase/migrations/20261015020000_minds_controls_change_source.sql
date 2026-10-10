-- Buddy phase 9 slice 1: say where a Takeover or Kill change was made. The chat path writes 'chat'; the Minds screen writes 'minds'.
-- The notable trigger reads it, so a Kill from chat reads "Stopped from chat." instead of "Set by the owner in Minds."
-- Both paths use the owner's session, so the role cannot tell them apart. Additive. NOT applied to production.

ALTER TABLE public.minds_controls ADD COLUMN IF NOT EXISTS change_source text NOT NULL DEFAULT 'minds'
  CHECK (change_source IN ('minds', 'chat'));

CREATE OR REPLACE FUNCTION public.minds_note_control_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.updated_by IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.takeover IS DISTINCT FROM OLD.takeover THEN
    INSERT INTO public.minds_notable_events (owner_id, mind, kind, title, detail)
    VALUES (NEW.updated_by, 'owner', 'takeover_changed',
            CASE WHEN NEW.takeover THEN 'Takeover turned on' ELSE 'Takeover turned off' END,
            CASE WHEN NEW.change_source = 'chat' THEN 'Set from chat.' ELSE 'Set by the owner in Minds.' END);
  END IF;
  IF NEW.kill_scope IS DISTINCT FROM OLD.kill_scope THEN
    INSERT INTO public.minds_notable_events (owner_id, mind, kind, title, detail)
    VALUES (NEW.updated_by, 'owner', 'kill_changed',
            'Kill set to ' || NEW.kill_scope,
            CASE
              WHEN NEW.change_source = 'chat' AND NEW.kill_scope = 'none' THEN 'Started again from chat.'
              WHEN NEW.change_source = 'chat' THEN 'Stopped from chat.'
              ELSE 'Set by the owner in Minds.'
            END);
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.minds_note_control_change() FROM PUBLIC, anon, authenticated;
