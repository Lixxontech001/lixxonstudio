-- Buddy phase 3 slice 4: the one door that changes an article, and the one door that records a gap.
-- Each function does all its writes in one transaction. If any step fails, nothing is kept.
-- Both check the owner's switches first: Takeover must be on, and Kill must not stop the Executioner.
-- Both are callable by the server (service role) only. The browser cannot call them.
-- Additive. NOT applied to production.

-- A new kind of notable event: an article was changed by the minds (buzzes in Phase 7).
ALTER TABLE public.minds_notable_events DROP CONSTRAINT IF EXISTS minds_notable_events_kind_check;
ALTER TABLE public.minds_notable_events ADD CONSTRAINT minds_notable_events_kind_check CHECK (kind IN (
  'takeover_changed', 'kill_changed', 'order_blocked', 'auditor_blocked', 'mind_failed', 'night_report_written',
  'article_changed'
));

-- Raises unless Takeover is on and Kill does not stop the Executioner. A missing or unknown Kill value stops it.
CREATE OR REPLACE FUNCTION public.minds_assert_can_act()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ctrl record;
BEGIN
  SELECT takeover, kill_scope INTO ctrl FROM public.minds_controls WHERE id = 1;
  IF NOT FOUND OR ctrl.takeover IS NOT TRUE THEN
    RAISE EXCEPTION 'takeover_off' USING ERRCODE = 'check_violation';
  END IF;
  -- Only Kill set to none, analyst or ceo lets an article change. Strategist and Auditor are needed for every plan.
  IF COALESCE(ctrl.kill_scope, 'all') NOT IN ('none', 'analyst', 'ceo') THEN
    RAISE EXCEPTION 'killed' USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

-- Applies one sentence-level edit to one paragraph of one article, and records it.
-- p_line_index is the 0-based line number in posts.content. Only that one line changes.
-- The before line must still be the line the plan was made for (text and SHA-256 checksum), or nothing is written.
CREATE OR REPLACE FUNCTION public.minds_apply_placement(
  p_owner_id uuid,
  p_order_id uuid,
  p_post_id uuid,
  p_local_day date,
  p_line_index integer,
  p_before_line text,
  p_after_line text,
  p_before_checksum text,
  p_after_checksum text,
  p_sentences_added text,
  p_product_ids uuid[],
  p_removed_product_ids uuid[],
  p_auditor_note text,
  p_title text,
  p_detail text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cur text;
  lines text[];
  new_lines text[];
  pid uuid;
  edit_id uuid;
BEGIN
  PERFORM public.minds_assert_can_act();

  PERFORM 1 FROM public.buddy_orders
   WHERE id = p_order_id AND owner_id = p_owner_id AND status = 'waiting'
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_waiting' USING ERRCODE = 'check_violation';
  END IF;

  -- Lock the article so two applies at once cannot both read the same paragraph.
  SELECT content INTO cur FROM public.posts WHERE id = p_post_id FOR UPDATE;
  IF NOT FOUND OR cur IS NULL THEN
    RAISE EXCEPTION 'article_missing' USING ERRCODE = 'no_data_found';
  END IF;

  lines := string_to_array(cur, E'\n');
  IF p_line_index < 0 OR p_line_index >= COALESCE(array_length(lines, 1), 0) THEN
    RAISE EXCEPTION 'paragraph_changed' USING ERRCODE = 'check_violation';
  END IF;
  IF lines[p_line_index + 1] IS DISTINCT FROM p_before_line THEN
    RAISE EXCEPTION 'paragraph_changed' USING ERRCODE = 'check_violation';
  END IF;
  IF encode(sha256(convert_to(p_before_line, 'UTF8')), 'hex') <> p_before_checksum THEN
    RAISE EXCEPTION 'checksum_mismatch' USING ERRCODE = 'check_violation';
  END IF;
  IF encode(sha256(convert_to(p_after_line, 'UTF8')), 'hex') <> p_after_checksum THEN
    RAISE EXCEPTION 'checksum_mismatch' USING ERRCODE = 'check_violation';
  END IF;

  -- The article text: the same lines, with only the one paragraph replaced.
  new_lines := lines;
  new_lines[p_line_index + 1] := p_after_line;
  UPDATE public.posts SET content = array_to_string(new_lines, E'\n') WHERE id = p_post_id;

  -- Swaps: free the slots of the products taken off the article first, so the cap trigger sees the room.
  FOREACH pid IN ARRAY COALESCE(p_removed_product_ids, '{}') LOOP
    UPDATE public.post_product_slots SET removed_at = now()
     WHERE post_id = p_post_id AND product_id = pid AND removed_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'slot_missing' USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;

  -- New slots. The cap trigger refuses a fourth live product on one article.
  FOREACH pid IN ARRAY p_product_ids LOOP
    INSERT INTO public.post_product_slots (owner_id, post_id, product_id)
    VALUES (p_owner_id, p_post_id, pid);
  END LOOP;

  -- The drip count. A new article for the day is counted here; the trigger refuses a fourth one.
  IF NOT EXISTS (
    SELECT 1 FROM public.post_drip_days
     WHERE owner_id = p_owner_id AND local_day = p_local_day AND post_id = p_post_id
  ) THEN
    INSERT INTO public.post_drip_days (owner_id, local_day, post_id)
    VALUES (p_owner_id, p_local_day, p_post_id);
  END IF;

  -- The applied-edit record: the paragraph before and after, both checksums, the products, and the Auditor's verdict.
  INSERT INTO public.post_product_edits (
    owner_id, post_id, mind, local_day,
    before_paragraph, after_paragraph, before_checksum, after_checksum,
    sentences_added, product_ids, removed_product_ids, auditor_verdict, auditor_note
  ) VALUES (
    p_owner_id, p_post_id, 'executioner', p_local_day,
    p_before_line, p_after_line, p_before_checksum, p_after_checksum,
    p_sentences_added, p_product_ids, COALESCE(p_removed_product_ids, '{}'), 'allow', COALESCE(p_auditor_note, '')
  ) RETURNING id INTO edit_id;

  INSERT INTO public.minds_daily_log (owner_id, day, mind, action, outcome, detail, order_id)
  VALUES (p_owner_id, p_local_day, 'executioner', p_title, 'done', p_detail, p_order_id);

  INSERT INTO public.minds_notable_events (owner_id, mind, kind, title, detail)
  VALUES (p_owner_id, 'executioner', 'article_changed', p_title, p_detail);

  UPDATE public.buddy_orders
     SET status = 'done', done_at = now(), updated_at = now()
   WHERE id = p_order_id;

  RETURN edit_id;
END;
$$;

-- Records a product gap: the shop has no product that fits. Writes a gap note, blocks the order with a plain reason,
-- and logs it. It never creates a product.
CREATE OR REPLACE FUNCTION public.minds_record_gap(
  p_owner_id uuid,
  p_order_id uuid,
  p_post_id uuid,
  p_angle text,
  p_note text,
  p_reason text,
  p_title text,
  p_local_day date
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  note_id uuid;
BEGIN
  PERFORM public.minds_assert_can_act();

  PERFORM 1 FROM public.buddy_orders
   WHERE id = p_order_id AND owner_id = p_owner_id AND status = 'waiting'
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_waiting' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.minds_gap_notes (owner_id, post_id, angle, note)
  VALUES (p_owner_id, p_post_id, p_angle, p_note)
  RETURNING id INTO note_id;

  UPDATE public.buddy_orders
     SET status = 'blocked', blocked_reason = p_reason, updated_at = now()
   WHERE id = p_order_id;

  INSERT INTO public.minds_daily_log (owner_id, day, mind, action, outcome, detail, order_id)
  VALUES (p_owner_id, p_local_day, 'executioner', p_title, 'blocked', p_reason, p_order_id);

  INSERT INTO public.minds_notable_events (owner_id, mind, kind, title, detail)
  VALUES (p_owner_id, 'executioner', 'order_blocked', p_title, p_reason);

  RETURN note_id;
END;
$$;

REVOKE ALL ON FUNCTION public.minds_assert_can_act() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.minds_apply_placement(uuid, uuid, uuid, date, integer, text, text, text, text, text, uuid[], uuid[], text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.minds_record_gap(uuid, uuid, uuid, text, text, text, text, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.minds_apply_placement(uuid, uuid, uuid, date, integer, text, text, text, text, text, uuid[], uuid[], text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.minds_record_gap(uuid, uuid, uuid, text, text, text, text, date) TO service_role;
