-- Buddy phase 2 slice 2: the owner's Takeover and Kill switches for the five minds.
-- One row. Takeover defaults to off. Kill defaults to nothing stopped.
-- Owner only: same rule as Buddy's chats (admin, and owner or founder). No delete, no anon access.
-- Nothing reads these switches yet; the minds that obey them arrive in later slices.
-- This migration is additive and is NOT applied to production.

CREATE TABLE IF NOT EXISTS public.minds_controls (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  takeover boolean NOT NULL DEFAULT false,
  kill_scope text NOT NULL DEFAULT 'none'
    CHECK (kill_scope IN ('none', 'all', 'analyst', 'strategist', 'ceo', 'executioner', 'auditor')),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.minds_controls (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.minds_controls ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.minds_controls FROM anon;

DROP POLICY IF EXISTS minds_controls_owner_select ON public.minds_controls;
CREATE POLICY minds_controls_owner_select ON public.minds_controls
  FOR SELECT TO authenticated
  USING (public.is_admin() AND (public.is_owner() OR public.is_founder()));

DROP POLICY IF EXISTS minds_controls_owner_insert ON public.minds_controls;
CREATE POLICY minds_controls_owner_insert ON public.minds_controls
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin() AND (public.is_owner() OR public.is_founder()) AND updated_by = auth.uid());

DROP POLICY IF EXISTS minds_controls_owner_update ON public.minds_controls;
CREATE POLICY minds_controls_owner_update ON public.minds_controls
  FOR UPDATE TO authenticated
  USING (public.is_admin() AND (public.is_owner() OR public.is_founder()))
  WITH CHECK (public.is_admin() AND (public.is_owner() OR public.is_founder()) AND updated_by = auth.uid());
