-- Buddy phase 3 slice 2: which shop products sit on which article.
-- This table is the source of truth for the cap: at most 3 live products on one article, all types together.
-- The cap is a database rule, so no app path can get past it. Rows are written by the server only.
-- Additive. NOT applied to production.

CREATE TABLE IF NOT EXISTS public.post_product_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  added_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz,
  CHECK (removed_at IS NULL OR removed_at >= added_at)
);

-- One live slot per product on each article. A swap removes one slot, then adds another.
CREATE UNIQUE INDEX IF NOT EXISTS post_product_slots_live_unique
  ON public.post_product_slots (post_id, product_id) WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS post_product_slots_post ON public.post_product_slots (post_id);

-- The cap. A live slot may be added (or a removed one brought back) only while the article has fewer than 3 live slots.
CREATE OR REPLACE FUNCTION public.post_product_slots_cap()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  live integer;
BEGIN
  IF NEW.removed_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.removed_at IS NULL THEN
    RETURN NEW;
  END IF;
  -- Lock the article so two applies at once cannot both pass the count.
  PERFORM 1 FROM public.posts WHERE id = NEW.post_id FOR UPDATE;
  SELECT count(*) INTO live
    FROM public.post_product_slots
   WHERE post_id = NEW.post_id AND removed_at IS NULL AND id <> NEW.id;
  IF live >= 3 THEN
    RAISE EXCEPTION 'An article can have at most 3 products' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS post_product_slots_cap ON public.post_product_slots;
CREATE TRIGGER post_product_slots_cap
  BEFORE INSERT OR UPDATE OF removed_at ON public.post_product_slots
  FOR EACH ROW EXECUTE FUNCTION public.post_product_slots_cap();

ALTER TABLE public.post_product_slots ENABLE ROW LEVEL SECURITY;

-- The owner reads only their own slots. Nothing public, nothing anonymous.
DROP POLICY IF EXISTS post_product_slots_owner_select ON public.post_product_slots;
CREATE POLICY post_product_slots_owner_select ON public.post_product_slots
  FOR SELECT TO authenticated
  USING (owner_id = auth.uid() AND public.is_admin());

REVOKE ALL ON public.post_product_slots FROM PUBLIC, anon;
GRANT SELECT ON public.post_product_slots TO authenticated;
