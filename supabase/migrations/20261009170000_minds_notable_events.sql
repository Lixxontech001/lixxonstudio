-- Buddy phase 2 slice 3: notable events. Things worth the owner's attention, recorded now.
-- Phase 7 is where these will buzz the phone; this slice only records them.
-- The owner can read them and mark them seen. Rows are added by the server or by the Takeover and Kill trigger below.
-- Additive. NOT applied to production.

CREATE TABLE IF NOT EXISTS public.minds_notable_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  happened_at timestamptz NOT NULL DEFAULT now(),
  mind text NOT NULL CHECK (mind IN ('owner', 'buddy', 'analyst', 'strategist', 'ceo', 'executioner', 'auditor')),
  kind text NOT NULL CHECK (kind IN (
    'takeover_changed', 'kill_changed', 'order_blocked', 'auditor_blocked', 'mind_failed', 'night_report_written'
  )),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 160),
  detail text NOT NULL DEFAULT '' CHECK (char_length(detail) <= 500),
  seen_at timestamptz
);

CREATE INDEX IF NOT EXISTS minds_notable_events_owner_recent ON public.minds_notable_events (owner_id, happened_at DESC);

ALTER TABLE public.minds_notable_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS minds_notable_events_owner_select ON public.minds_notable_events;
CREATE POLICY minds_notable_events_owner_select ON public.minds_notable_events
  FOR SELECT TO authenticated
  USING (owner_id = auth.uid() AND public.is_admin() AND (public.is_owner() OR public.is_founder()));

-- The owner may only mark an event seen. Nothing else in an event can change.
DROP POLICY IF EXISTS minds_notable_events_owner_seen ON public.minds_notable_events;
CREATE POLICY minds_notable_events_owner_seen ON public.minds_notable_events
  FOR UPDATE TO authenticated
  USING (owner_id = auth.uid() AND public.is_admin() AND (public.is_owner() OR public.is_founder()))
  WITH CHECK (owner_id = auth.uid() AND public.is_admin() AND (public.is_owner() OR public.is_founder()));

REVOKE ALL ON public.minds_notable_events FROM PUBLIC, anon;
GRANT SELECT ON public.minds_notable_events TO authenticated;
GRANT UPDATE (seen_at) ON public.minds_notable_events TO authenticated;

-- Takeover and Kill changes are notable. The trigger writes the event itself, so the owner's save cannot skip it.
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
            'Set by the owner in Minds.');
  END IF;
  IF NEW.kill_scope IS DISTINCT FROM OLD.kill_scope THEN
    INSERT INTO public.minds_notable_events (owner_id, mind, kind, title, detail)
    VALUES (NEW.updated_by, 'owner', 'kill_changed',
            'Kill set to ' || NEW.kill_scope,
            'Set by the owner in Minds.');
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.minds_note_control_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS minds_controls_note_change ON public.minds_controls;
CREATE TRIGGER minds_controls_note_change
  AFTER UPDATE ON public.minds_controls
  FOR EACH ROW
  EXECUTE FUNCTION public.minds_note_control_change();
