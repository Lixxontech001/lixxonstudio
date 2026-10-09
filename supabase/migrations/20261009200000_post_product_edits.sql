-- Buddy phase 3 slice 2: one row per applied edit to an article.
-- Each row keeps the exact paragraph before and after, the checksum of the paragraph before the edit,
-- the products on the article after the edit, and the Auditor's verdict. That makes every edit reviewable and reversible.
-- Written by the server only. The owner can read his own rows (for "Show the paragraph").
-- Additive. NOT applied to production.

CREATE TABLE IF NOT EXISTS public.post_product_edits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  mind text NOT NULL DEFAULT 'executioner' CHECK (mind = 'executioner'),
  local_day date NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  before_paragraph text NOT NULL CHECK (char_length(before_paragraph) BETWEEN 1 AND 4000),
  after_paragraph text NOT NULL CHECK (char_length(after_paragraph) BETWEEN 1 AND 4000),
  before_checksum text NOT NULL CHECK (before_checksum ~ '^[0-9a-f]{64}$'),
  after_checksum text NOT NULL CHECK (after_checksum ~ '^[0-9a-f]{64}$'),
  sentences_added text NOT NULL CHECK (char_length(sentences_added) BETWEEN 1 AND 600),
  product_ids uuid[] NOT NULL CHECK (cardinality(product_ids) BETWEEN 1 AND 3),
  removed_product_ids uuid[] NOT NULL DEFAULT '{}' CHECK (cardinality(removed_product_ids) <= 3),
  auditor_verdict text NOT NULL CHECK (auditor_verdict = 'allow'),
  auditor_note text NOT NULL DEFAULT '' CHECK (char_length(auditor_note) <= 300),
  CHECK (before_paragraph <> after_paragraph),
  CHECK (before_checksum <> after_checksum)
);

CREATE INDEX IF NOT EXISTS post_product_edits_post ON public.post_product_edits (post_id, applied_at DESC);
CREATE INDEX IF NOT EXISTS post_product_edits_owner_day ON public.post_product_edits (owner_id, local_day);

ALTER TABLE public.post_product_edits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS post_product_edits_owner_select ON public.post_product_edits;
CREATE POLICY post_product_edits_owner_select ON public.post_product_edits
  FOR SELECT TO authenticated
  USING (owner_id = auth.uid() AND public.is_admin());

REVOKE ALL ON public.post_product_edits FROM PUBLIC, anon;
GRANT SELECT ON public.post_product_edits TO authenticated;
