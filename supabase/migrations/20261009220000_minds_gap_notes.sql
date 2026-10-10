-- Buddy phase 3 slice 2: gap notes. When an angle would sell but the shop has no product for it,
-- the server writes a note here and Buddy tells the owner to create one. A note never creates a product.
-- The owner can read his notes and mark them seen. Only the seen time can change.
-- Written by the server only. Additive. NOT applied to production.

CREATE TABLE IF NOT EXISTS public.minds_gap_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  post_id uuid REFERENCES public.posts(id) ON DELETE SET NULL,
  angle text NOT NULL CHECK (char_length(angle) BETWEEN 1 AND 300),
  note text NOT NULL CHECK (char_length(note) BETWEEN 1 AND 500),
  seen_at timestamptz
);

CREATE INDEX IF NOT EXISTS minds_gap_notes_owner_recent ON public.minds_gap_notes (owner_id, created_at DESC);

ALTER TABLE public.minds_gap_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS minds_gap_notes_owner_select ON public.minds_gap_notes;
CREATE POLICY minds_gap_notes_owner_select ON public.minds_gap_notes
  FOR SELECT TO authenticated
  USING (owner_id = auth.uid() AND public.is_admin());

-- The owner may only mark a note seen.
DROP POLICY IF EXISTS minds_gap_notes_owner_seen ON public.minds_gap_notes;
CREATE POLICY minds_gap_notes_owner_seen ON public.minds_gap_notes
  FOR UPDATE TO authenticated
  USING (owner_id = auth.uid() AND public.is_admin())
  WITH CHECK (owner_id = auth.uid() AND public.is_admin());

REVOKE ALL ON public.minds_gap_notes FROM PUBLIC, anon;
GRANT SELECT ON public.minds_gap_notes TO authenticated;
GRANT UPDATE (seen_at) ON public.minds_gap_notes TO authenticated;
