-- Phase I slice 5: the rival pages the owner asked Buddy to watch.
-- The owner saves the links (his own words, so this writes nothing on the site). The day run reads at most ten of
-- them a day, oldest read first, public pages only, and records what it saw so the next read can say honestly
-- whether something changed. The read is written by the server only, and only when the minds may act.
-- Additive. NOT applied to production.

CREATE TABLE IF NOT EXISTS public.minds_competitors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  url text NOT NULL CHECK (char_length(url) BETWEEN 8 AND 300),
  label text NOT NULL DEFAULT '' CHECK (char_length(label) <= 80),
  added_at timestamptz NOT NULL DEFAULT now(),
  last_read_at timestamptz,
  last_title text CHECK (last_title IS NULL OR char_length(last_title) <= 200),
  last_fingerprint text CHECK (last_fingerprint IS NULL OR char_length(last_fingerprint) <= 80),
  last_change_at timestamptz,
  last_change_note text CHECK (last_change_note IS NULL OR char_length(last_change_note) <= 300),
  reads integer NOT NULL DEFAULT 0 CHECK (reads >= 0),
  UNIQUE (owner_id, url)
);

CREATE INDEX IF NOT EXISTS minds_competitors_owner ON public.minds_competitors (owner_id, last_read_at);

-- One row per page read, per owner day. The cap of ten a day is a database rule, so two runs cannot read twenty.
CREATE TABLE IF NOT EXISTS public.minds_competitor_reads (
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  local_day date NOT NULL,
  competitor_id uuid NOT NULL REFERENCES public.minds_competitors(id) ON DELETE CASCADE,
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, local_day, competitor_id)
);

CREATE OR REPLACE FUNCTION public.minds_competitor_reads_cap()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  read_today integer;
BEGIN
  -- An already counted page passes through; the primary key handles a repeat.
  IF EXISTS (
    SELECT 1 FROM public.minds_competitor_reads
     WHERE owner_id = NEW.owner_id AND local_day = NEW.local_day AND competitor_id = NEW.competitor_id
  ) THEN
    RETURN NEW;
  END IF;
  -- Serialise per owner and day, so two runs at once cannot both pass the count.
  PERFORM pg_advisory_xact_lock(hashtext(NEW.owner_id::text || ':pages:' || NEW.local_day::text));
  SELECT count(*) INTO read_today
    FROM public.minds_competitor_reads
   WHERE owner_id = NEW.owner_id AND local_day = NEW.local_day;
  IF read_today >= 10 THEN
    RAISE EXCEPTION 'At most 10 pages a day' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS minds_competitor_reads_cap ON public.minds_competitor_reads;
CREATE TRIGGER minds_competitor_reads_cap
  BEFORE INSERT ON public.minds_competitor_reads
  FOR EACH ROW EXECUTE FUNCTION public.minds_competitor_reads_cap();

ALTER TABLE public.minds_competitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.minds_competitor_reads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS minds_competitors_owner_select ON public.minds_competitors;
CREATE POLICY minds_competitors_owner_select ON public.minds_competitors
  FOR SELECT TO authenticated
  USING (owner_id = auth.uid() AND public.is_admin() AND (public.is_owner() OR public.is_founder()));

DROP POLICY IF EXISTS minds_competitor_reads_owner_select ON public.minds_competitor_reads;
CREATE POLICY minds_competitor_reads_owner_select ON public.minds_competitor_reads
  FOR SELECT TO authenticated
  USING (owner_id = auth.uid() AND public.is_admin() AND (public.is_owner() OR public.is_founder()));

-- No insert, update or delete policy for signed-in users. Only the server writes these two tables.

REVOKE ALL ON public.minds_competitors FROM PUBLIC, anon;
REVOKE ALL ON public.minds_competitor_reads FROM PUBLIC, anon;
GRANT SELECT ON public.minds_competitors TO authenticated;
GRANT SELECT ON public.minds_competitor_reads TO authenticated;

-- Saves one link to watch. Public https pages only, the same rule the app's own words use.
-- Nothing on the site changes, so this is allowed whether Takeover is on or off: it is the owner's own list.
CREATE OR REPLACE FUNCTION public.minds_save_competitor(
  p_owner_id uuid,
  p_url text,
  p_label text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url text;
  v_authority text;
  v_host text;
  v_label text;
  v_saved integer;
  v_id uuid;
BEGIN
  IF p_owner_id IS NULL OR p_url IS NULL THEN
    RAISE EXCEPTION 'competitor_missing_value' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.app_admins WHERE user_id = p_owner_id AND role = 'owner') THEN
    RAISE EXCEPTION 'not_owner' USING ERRCODE = 'check_violation';
  END IF;

  v_url := btrim(p_url);
  IF char_length(v_url) > 300 THEN
    RAISE EXCEPTION 'competitor_too_long' USING ERRCODE = 'check_violation';
  END IF;
  IF lower(v_url) NOT LIKE 'https://%' THEN
    RAISE EXCEPTION 'competitor_not_secure' USING ERRCODE = 'check_violation';
  END IF;
  v_authority := split_part(regexp_replace(v_url, '^https://', '', 'i'), '/', 1);
  v_authority := split_part(v_authority, '?', 1);
  v_authority := split_part(v_authority, '#', 1);
  IF v_authority = '' OR position('@' IN v_authority) > 0 THEN
    RAISE EXCEPTION 'competitor_has_sign_in' USING ERRCODE = 'check_violation';
  END IF;
  v_host := lower(split_part(v_authority, ':', 1));
  IF v_host = '' OR v_host = 'localhost' OR v_host LIKE '%.localhost' OR v_host LIKE '%.local' OR v_host LIKE '%.internal' THEN
    RAISE EXCEPTION 'competitor_not_public' USING ERRCODE = 'check_violation';
  END IF;
  IF v_host ~ '^[0-9.]+$' OR position(':' IN v_host) > 0 OR position('[' IN v_host) > 0 THEN
    RAISE EXCEPTION 'competitor_not_public' USING ERRCODE = 'check_violation';
  END IF;
  IF position('.' IN v_host) = 0 OR left(v_host, 1) = '.' OR right(v_host, 1) = '.' THEN
    RAISE EXCEPTION 'competitor_not_public' USING ERRCODE = 'check_violation';
  END IF;

  v_label := btrim(regexp_replace(COALESCE(p_label, ''), '\s+', ' ', 'g'));
  IF v_label = '' THEN
    v_label := regexp_replace(v_host, '^www\.', '');
  END IF;
  v_label := left(v_label, 80);

  -- Many links may be saved. The list stops at a hundred, so the daily read always has somewhere to start.
  SELECT count(*) INTO v_saved FROM public.minds_competitors WHERE owner_id = p_owner_id;
  IF v_saved >= 100 AND NOT EXISTS (SELECT 1 FROM public.minds_competitors WHERE owner_id = p_owner_id AND url = v_url) THEN
    RAISE EXCEPTION 'competitor_list_full' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.minds_competitors (owner_id, url, label)
  VALUES (p_owner_id, v_url, v_label)
  ON CONFLICT (owner_id, url) DO UPDATE SET label = EXCLUDED.label
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- Records one read of one page. Refused when Takeover is off or Kill stops the minds, and by the ten-a-day rule.
CREATE OR REPLACE FUNCTION public.minds_record_competitor_read(
  p_owner_id uuid,
  p_competitor_id uuid,
  p_local_day date,
  p_title text,
  p_fingerprint text,
  p_change_note text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.minds_assert_can_act();

  IF p_owner_id IS NULL OR p_competitor_id IS NULL OR p_local_day IS NULL OR p_fingerprint IS NULL THEN
    RAISE EXCEPTION 'competitor_read_missing_value' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.minds_competitors WHERE id = p_competitor_id AND owner_id = p_owner_id) THEN
    RAISE EXCEPTION 'competitor_unknown' USING ERRCODE = 'check_violation';
  END IF;

  -- A page already read today is not read again: this is a no-op, never a second count.
  IF EXISTS (
    SELECT 1 FROM public.minds_competitor_reads
     WHERE owner_id = p_owner_id AND local_day = p_local_day AND competitor_id = p_competitor_id
  ) THEN
    RETURN true;
  END IF;

  -- The cap trigger serialises per owner and day and refuses an eleventh page.
  INSERT INTO public.minds_competitor_reads (owner_id, local_day, competitor_id)
  VALUES (p_owner_id, p_local_day, p_competitor_id);

  UPDATE public.minds_competitors
     SET last_read_at = now(),
         last_title = left(p_title, 200),
         last_fingerprint = left(p_fingerprint, 80),
         reads = reads + 1,
         last_change_at = CASE WHEN p_change_note IS NULL THEN last_change_at ELSE now() END,
         last_change_note = CASE WHEN p_change_note IS NULL THEN last_change_note ELSE left(p_change_note, 300) END
   WHERE id = p_competitor_id AND owner_id = p_owner_id;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.minds_save_competitor(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.minds_record_competitor_read(uuid, uuid, date, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.minds_save_competitor(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.minds_record_competitor_read(uuid, uuid, date, text, text, text) TO service_role;

-- A changed rival page is a telling of its own: it buzzes the phone, appears in the morning briefing and in the
-- night report, and it is written once per page per day.
ALTER TABLE public.minds_notable_events DROP CONSTRAINT IF EXISTS minds_notable_events_kind_check;
ALTER TABLE public.minds_notable_events ADD CONSTRAINT minds_notable_events_kind_check CHECK (kind IN (
  'takeover_changed', 'kill_changed', 'order_blocked', 'auditor_blocked', 'mind_failed', 'night_report_written',
  'article_changed',
  'door_posted', 'pack_ready', 'sale', 'product_click', 'traffic_new_kind', 'job_finished',
  'door_failed',
  'week_up', 'week_down',
  'door_skipped', 'price_changed', 'pack_saved', 'product_looks_dead',
  'competitor_changed'
));
