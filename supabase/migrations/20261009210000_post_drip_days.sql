-- Buddy phase 3 slice 2: the drip counter. Each row is one article touched on one owner day.
-- At most 3 different articles a day, so the old archive is never stamped in one hour.
-- The cap is a database rule. Touching the same article again the same day is allowed.
-- Written by the server only. The owner can read his own rows.
-- Additive. NOT applied to production.

CREATE TABLE IF NOT EXISTS public.post_drip_days (
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  local_day date NOT NULL,
  post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  touched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, local_day, post_id)
);

CREATE OR REPLACE FUNCTION public.post_drip_days_cap()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  touched integer;
BEGIN
  -- An article already counted today passes through; the primary key handles a repeat.
  IF EXISTS (
    SELECT 1 FROM public.post_drip_days
     WHERE owner_id = NEW.owner_id AND local_day = NEW.local_day AND post_id = NEW.post_id
  ) THEN
    RETURN NEW;
  END IF;
  -- Serialise per owner and day so two applies at once cannot both pass the count.
  PERFORM pg_advisory_xact_lock(hashtext(NEW.owner_id::text || ':' || NEW.local_day::text));
  SELECT count(*) INTO touched
    FROM public.post_drip_days
   WHERE owner_id = NEW.owner_id AND local_day = NEW.local_day;
  IF touched >= 3 THEN
    RAISE EXCEPTION 'At most 3 articles a day' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS post_drip_days_cap ON public.post_drip_days;
CREATE TRIGGER post_drip_days_cap
  BEFORE INSERT ON public.post_drip_days
  FOR EACH ROW EXECUTE FUNCTION public.post_drip_days_cap();

ALTER TABLE public.post_drip_days ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS post_drip_days_owner_select ON public.post_drip_days;
CREATE POLICY post_drip_days_owner_select ON public.post_drip_days
  FOR SELECT TO authenticated
  USING (owner_id = auth.uid() AND public.is_admin());

REVOKE ALL ON public.post_drip_days FROM PUBLIC, anon;
GRANT SELECT ON public.post_drip_days TO authenticated;
