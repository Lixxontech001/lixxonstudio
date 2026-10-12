-- Phase I slice 5 assertions: the archive drip to the free doors, the watched rival pages, and the one US dollar price
-- change. The three migrations are files only (never applied to production); this suite proves their rules hold in a
-- real database: the gates, the caps, the honest refusals, and that only the server can write.
-- Every fixture is created here and removed again, and the owner's switches are put back as they were.
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION _m5_text(role_name text, statement text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE result text;
BEGIN
  EXECUTE format('SET LOCAL ROLE %I', role_name);
  EXECUTE 'SELECT (' || statement || ')::text' INTO result;
  RESET ROLE;
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION _m5_raises(role_name text, statement text)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE raised boolean := false;
BEGIN
  EXECUTE format('SET LOCAL ROLE %I', role_name);
  BEGIN EXECUTE statement; EXCEPTION WHEN others THEN raised := true; END;
  RESET ROLE;
  RETURN raised;
END $$;

CREATE OR REPLACE FUNCTION _m5_assert(condition boolean, message text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT condition THEN RAISE EXCEPTION '%', message; END IF;
END $$;

-- Also the exact refusal a call gives, so a rule cannot be proved by the wrong error.
CREATE OR REPLACE FUNCTION _m5_refusal(role_name text, statement text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE message text;
BEGIN
  EXECUTE format('SET LOCAL ROLE %I', role_name);
  BEGIN EXECUTE statement; message := '';
  EXCEPTION WHEN others THEN message := SQLERRM; END;
  RESET ROLE;
  RETURN message;
END $$;

DO $$
DECLARE
  v_owner uuid := '00000000-0000-0000-0000-00000000f5a1';
  v_other uuid := '00000000-0000-0000-0000-00000000f5a2';
  v_day date := DATE '2026-10-05';
  v_next_day date := DATE '2026-10-06';
  v_post_a uuid := '00000000-0000-0000-0000-00000000f5b1';
  v_post_b uuid := '00000000-0000-0000-0000-00000000f5b2';
  v_post_c uuid := '00000000-0000-0000-0000-00000000f5b3';
  v_post_d uuid := '00000000-0000-0000-0000-00000000f5b4';
  v_draft uuid := '00000000-0000-0000-0000-00000000f5b5';
  v_product_usd uuid := '00000000-0000-0000-0000-00000000f5c1';
  v_product_ngn uuid := '00000000-0000-0000-0000-00000000f5c2';
  v_product_off uuid := '00000000-0000-0000-0000-00000000f5c3';
  v_product_free uuid := '00000000-0000-0000-0000-00000000f5c4';
  v_saved uuid;
  v_saved_again uuid;
  v_answer text;
  v_competitor uuid;
  v_ids uuid[] := ARRAY[]::uuid[];
  v_index integer;
  v_freezing boolean;
  -- Names that are deliberately not in the fixtures: an unknown page and an unknown product.
  v_unknown uuid := '00000000-0000-0000-0000-00000000f5ff';
  v_no_such_product uuid := '00000000-0000-0000-0000-00000000f5ee';
BEGIN
  -- ---------------------------------------------------------------- 1. fixtures
  INSERT INTO auth.users (id, email) VALUES
    (v_owner, 'slice5-owner@example.test'),
    (v_other, 'slice5-other@example.test')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO app_admins (user_id, role) VALUES
    (v_owner, 'owner'),
    (v_other, 'editor')
  ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role;

  INSERT INTO posts (id, title, slug, status, content, published_at) VALUES
    (v_post_a, 'The first piece', 'slice5-first', 'published', 'One two three.', now() - interval '30 days'),
    (v_post_b, 'The second piece', 'slice5-second', 'published', 'Four five six.', now() - interval '20 days'),
    (v_post_c, 'The third piece', 'slice5-third', 'published', 'Seven eight nine.', now() - interval '15 days'),
    (v_post_d, 'The fourth piece', 'slice5-fourth', 'published', 'Ten eleven twelve.', now() - interval '12 days'),
    (v_draft, 'A draft nobody sees', 'slice5-draft', 'draft', 'Thirteen fourteen.', NULL)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO products (id, name, slug, price, price_cents, currency, product_type, is_active) VALUES
    (v_product_usd, 'Linen Bath Sheet', 'slice5-linen-bath-sheet', '34.00', 3400, 'USD', 'physical', true),
    (v_product_ngn, 'Naira Only Towel', 'slice5-naira-towel', '9000.00', 900000, 'NGN', 'physical', true),
    (v_product_off, 'A hidden product', 'slice5-hidden', '20.00', 2000, 'USD', 'physical', false),
    (v_product_free, 'A free sample', 'slice5-free-sample', '0.00', 0, 'USD', 'physical', true)
  ON CONFLICT (id) DO NOTHING;

  SELECT takeover = true OR kill_scope <> 'none' INTO v_freezing FROM public.minds_controls WHERE id = 1;

  -- ---------------------------------------------------------------- 2. the archive drip
  -- Takeover off: nothing is stamped. The same gate every live change passes.
  PERFORM _m5_assert(
    _m5_refusal('service_role', format('SELECT public.minds_record_drip(%L::uuid, %L::date, %L::uuid)', v_owner, v_day, v_post_a)) = 'takeover_off',
    'a drip was stamped while Takeover was off');

  PERFORM _m5_assert(
    _m5_refusal('service_role',
      format('SELECT public.minds_record_drip(%L::uuid, %L::date, %L::uuid)', v_owner, v_day, v_draft)) = 'takeover_off',
    'a drip was refused for the wrong reason while Takeover was off');

  -- Takeover on: the draft is never dripped, and another owner's editor is not the owner.
  UPDATE public.minds_controls SET takeover = true, kill_scope = 'none' WHERE id = 1;

  PERFORM _m5_assert(
    _m5_refusal('service_role',
      format('SELECT public.minds_record_drip(%L::uuid, %L::date, %L::uuid)', v_owner, v_day, v_draft)) = 'drip_not_published',
    'an unpublished article was dripped to a door');
  PERFORM _m5_assert(
    _m5_refusal('service_role',
      format('SELECT public.minds_record_drip(%L::uuid, %L::date, %L::uuid)', v_other, v_day, v_post_a)) = 'not_owner',
    'a drip was stamped for someone who is not the owner');

  -- Three different articles a day is the cap. The same article twice is a no-op, never a second stamp.
  PERFORM _m5_assert(_m5_text('service_role', format('SELECT public.minds_record_drip(%L::uuid, %L::date, %L::uuid)', v_owner, v_day, v_post_a)) = 'true', 'the first drip of the day was refused');
  PERFORM _m5_assert(_m5_text('service_role', format('SELECT public.minds_record_drip(%L::uuid, %L::date, %L::uuid)', v_owner, v_day, v_post_a)) = 'true', 'the same article could not be touched twice in one day');
  PERFORM _m5_assert(_m5_text('service_role', format('SELECT public.minds_record_drip(%L::uuid, %L::date, %L::uuid)', v_owner, v_day, v_post_b)) = 'true', 'the second drip of the day was refused');
  PERFORM _m5_assert(_m5_text('service_role', format('SELECT public.minds_record_drip(%L::uuid, %L::date, %L::uuid)', v_owner, v_day, v_post_c)) = 'true', 'the third drip of the day was refused');
  PERFORM _m5_assert(
    (SELECT count(*) FROM public.post_drip_days WHERE owner_id = v_owner AND local_day = v_day) = 3,
    'the day did not hold exactly three drip rows');
  PERFORM _m5_assert(
    _m5_raises('service_role', format('SELECT public.minds_record_drip(%L::uuid, %L::date, %L::uuid)', v_owner, v_day, v_post_d)),
    'a fourth article was stamped on the same day');
  -- A new day starts its own three, so an old archive can never be stamped in one morning.
  PERFORM _m5_assert(_m5_text('service_role', format('SELECT public.minds_record_drip(%L::uuid, %L::date, %L::uuid)', v_owner, v_next_day, v_post_d)) = 'true', 'the next day was not allowed its own drip');

  -- Kill on: the drip stops even with Takeover on.
  UPDATE public.minds_controls SET kill_scope = 'strategist' WHERE id = 1;
  PERFORM _m5_assert(
    _m5_refusal('service_role',
      format('SELECT public.minds_record_drip(%L::uuid, %L::date, %L::uuid)', v_owner, DATE '2026-10-07', v_post_a)) = 'killed',
    'a drip was stamped while a Kill switch was on');
  UPDATE public.minds_controls SET kill_scope = 'none' WHERE id = 1;

  -- Only the server may stamp. A signed-in reader and an anonymous visitor cannot even call it.
  PERFORM _m5_assert(
    _m5_raises('authenticated', format('SELECT public.minds_record_drip(%L::uuid, %L::date, %L::uuid)', v_owner, DATE '2026-10-08', v_post_a)),
    'a signed-in user could stamp the archive');
  PERFORM _m5_assert(
    _m5_raises('anon', format('SELECT public.minds_record_drip(%L::uuid, %L::date, %L::uuid)', v_owner, DATE '2026-10-08', v_post_a)),
    'an anonymous visitor could stamp the archive');

  -- ---------------------------------------------------------------- 3. the watched rival pages
  -- Only a public https page is saved, and the owner is named in every refusal.
  PERFORM _m5_assert(
    _m5_refusal('service_role', format('SELECT public.minds_save_competitor(%L::uuid, %L, %L)', v_owner, 'http://rival.example/guide', '')) = 'competitor_not_secure',
    'a page that is not https was saved to watch');
  PERFORM _m5_assert(
    _m5_refusal('service_role', format('SELECT public.minds_save_competitor(%L::uuid, %L, %L)', v_owner, 'https://user:secret@rival.example/guide', '')) = 'competitor_has_sign_in',
    'a page with a sign-in in the address was saved to watch');
  PERFORM _m5_assert(
    _m5_refusal('service_role', format('SELECT public.minds_save_competitor(%L::uuid, %L, %L)', v_owner, 'https://localhost:3000/guide', '')) = 'competitor_not_public',
    'a local address was saved to watch');
  PERFORM _m5_assert(
    _m5_refusal('service_role', format('SELECT public.minds_save_competitor(%L::uuid, %L, %L)', v_owner, 'https://192.168.0.4/guide', '')) = 'competitor_not_public',
    'a private address was saved to watch');
  PERFORM _m5_assert(
    _m5_refusal('service_role', format('SELECT public.minds_save_competitor(%L::uuid, %L, %L)', v_owner, 'https://shop.internal/guide', '')) = 'competitor_not_public',
    'an internal name was saved to watch');
  PERFORM _m5_assert(
    _m5_refusal('service_role', format('SELECT public.minds_save_competitor(%L::uuid, %L, %L)', v_other, 'https://rival.example/guide', '')) = 'not_owner',
    'someone who is not the owner saved a watched page');

  SELECT public.minds_save_competitor(v_owner, 'https://rival.example/guide', '') INTO v_saved;
  PERFORM _m5_assert(v_saved IS NOT NULL, 'a public https page could not be saved');
  PERFORM _m5_assert(
    (SELECT label FROM public.minds_competitors WHERE id = v_saved) = 'rival.example',
    'a saved page was not labelled by its own host');
  SELECT public.minds_save_competitor(v_owner, 'https://rival.example/guide', 'Rival') INTO v_saved_again;
  PERFORM _m5_assert(v_saved_again = v_saved, 'saving the same page twice made a second row');
  PERFORM _m5_assert(
    (SELECT count(*) FROM public.minds_competitors WHERE owner_id = v_owner) = 1,
    'the watched list held more than the one page saved');
  PERFORM _m5_assert(
    (SELECT label FROM public.minds_competitors WHERE id = v_saved) = 'Rival',
    'the name the owner gave the page was not kept');

  -- A read is a live act: Takeover off means nothing is read or recorded.
  UPDATE public.minds_controls SET takeover = false WHERE id = 1;
  PERFORM _m5_assert(
    _m5_refusal('service_role',
      format('SELECT public.minds_record_competitor_read(%L::uuid, %L::uuid, %L::date, %L, %L, null)', v_owner, v_saved, v_day, 'Rival home', 'fp-1')) = 'takeover_off',
    'a rival page was read while Takeover was off');
  UPDATE public.minds_controls SET takeover = true WHERE id = 1;

  PERFORM _m5_assert(
    _m5_refusal('service_role',
      format('SELECT public.minds_record_competitor_read(%L::uuid, %L::uuid, %L::date, %L, %L, null)', v_owner, v_unknown, v_day, 'Rival home', 'fp-1')) = 'competitor_unknown',
    'a read was recorded for a page that is not on the watched list');

  -- Ten pages a day, no more, however many are saved.
  FOR v_index IN 1..10 LOOP
    SELECT public.minds_save_competitor(v_owner, 'https://rival' || v_index || '.example/news', '') INTO v_competitor;
    v_ids := v_ids || v_competitor;
  END LOOP;
  FOR v_index IN 1..10 LOOP
    PERFORM _m5_assert(
      _m5_text('service_role',
        format('SELECT public.minds_record_competitor_read(%L::uuid, %L::uuid, %L::date, %L, %L, null)',
               v_owner, v_ids[v_index], v_day, 'Page ' || v_index, 'fp-' || v_index)) = 'true',
      'a read inside the day ten was refused');
  END LOOP;
  PERFORM _m5_assert(
    (SELECT count(*) FROM public.minds_competitor_reads WHERE owner_id = v_owner AND local_day = v_day) = 10,
    'the day did not hold exactly ten reads');
  PERFORM _m5_assert(
    _m5_raises('service_role',
      format('SELECT public.minds_record_competitor_read(%L::uuid, %L::uuid, %L::date, %L, %L, null)', v_owner, v_saved, v_day, 'Rival home', 'fp-extra')),
    'an eleventh page was read on the same day');
  -- The same page again the same day is a no-op, never a second read.
  PERFORM _m5_assert(
    _m5_text('service_role',
      format('SELECT public.minds_record_competitor_read(%L::uuid, %L::uuid, %L::date, %L, %L, null)', v_owner, v_ids[1], v_day, 'Page 1', 'fp-1')) = 'true',
    'the same page could not be touched twice in one day');

  -- A change is written on the row, and an unchanged read never overwrites the last change note.
  PERFORM _m5_assert(
    _m5_text('service_role',
      format('SELECT public.minds_record_competitor_read(%L::uuid, %L::uuid, %L::date, %L, %L, %L)',
             v_owner, v_saved, v_next_day, 'A new headline', 'fp-2', 'The headline changed.')) = 'true',
    'a change could not be recorded');
  PERFORM _m5_assert(
    (SELECT last_change_note FROM public.minds_competitors WHERE id = v_saved) = 'The headline changed.',
    'the change note was not kept');
  PERFORM _m5_assert(
    (SELECT last_title FROM public.minds_competitors WHERE id = v_saved) = 'A new headline',
    'the page headline was not kept');
  PERFORM _m5_assert(
    _m5_text('service_role',
      format('SELECT public.minds_record_competitor_read(%L::uuid, %L::uuid, %L::date, %L, %L, null)',
             v_owner, v_saved, DATE '2026-10-07', 'A new headline', 'fp-2')) = 'true',
    'a quiet read could not be recorded');
  PERFORM _m5_assert(
    (SELECT last_change_note FROM public.minds_competitors WHERE id = v_saved) = 'The headline changed.',
    'a quiet read wiped the last change note');
  -- Two real reads on that page: a change on one day, a quiet read on the next.
  PERFORM _m5_assert(
    (SELECT reads FROM public.minds_competitors WHERE id = v_saved) = 2,
    'the read count did not follow every read');

  PERFORM _m5_assert(
    _m5_raises('authenticated', format('SELECT public.minds_save_competitor(%L::uuid, %L, %L)', v_owner, 'https://rival.example/other', '')),
    'a signed-in user could save a watched page');
  PERFORM _m5_assert(
    _m5_raises('anon', format('SELECT public.minds_record_competitor_read(%L::uuid, %L::uuid, %L::date, %L, %L, null)', v_owner, v_saved, v_next_day, 't', 'f')),
    'an anonymous visitor could record a read');

  -- ---------------------------------------------------------------- 4. the one US dollar price change
  -- Takeover off: no price moves.
  UPDATE public.minds_controls SET takeover = false WHERE id = 1;
  PERFORM _m5_assert(
    _m5_refusal('service_role',
      format('SELECT public.minds_apply_price_change(%L::uuid, %L::uuid, 2950, %L::date, %L)', v_owner, v_product_usd, v_day, 'It sells well and the price is high.')) = 'takeover_off',
    'a price was written while Takeover was off');
  UPDATE public.minds_controls SET takeover = true WHERE id = 1;

  PERFORM _m5_assert(
    _m5_refusal('service_role',
      format('SELECT public.minds_apply_price_change(%L::uuid, %L::uuid, 2950, %L::date, %L)', v_other, v_product_usd, v_day, 'It sells well.')) = 'not_owner',
    'a price was written for someone who is not the owner');
  PERFORM _m5_assert(
    _m5_refusal('service_role',
      format('SELECT public.minds_apply_price_change(%L::uuid, %L::uuid, 2950, %L::date, %L)', v_owner, v_no_such_product, v_day, 'It sells well.')) = 'price_product_unknown',
    'a price was written for a product that does not exist');
  -- Nothing, free and Naira are all refused, with their own plain reason.
  PERFORM _m5_assert(
    _m5_refusal('service_role',
      format('SELECT public.minds_apply_price_change(%L::uuid, %L::uuid, 0, %L::date, %L)', v_owner, v_product_usd, v_day, 'It sells well.')) = 'price_free',
    'a price of nothing was written');
  PERFORM _m5_assert(
    _m5_refusal('service_role',
      format('SELECT public.minds_apply_price_change(%L::uuid, %L::uuid, 1500, %L::date, %L)', v_owner, v_product_free, v_day, 'It sells well.')) = 'price_missing',
    'a free product was given a price by the minds');
  PERFORM _m5_assert(
    _m5_refusal('service_role',
      format('SELECT public.minds_apply_price_change(%L::uuid, %L::uuid, 900000, %L::date, %L)', v_owner, v_product_ngn, v_day, 'It sells well.')) = 'price_not_usd',
    'a price that is not in US dollars was written');
  PERFORM _m5_assert(
    _m5_refusal('service_role',
      format('SELECT public.minds_apply_price_change(%L::uuid, %L::uuid, 2950, %L::date, %L)', v_owner, v_product_off, v_day, 'It sells well.')) = 'price_product_not_live',
    'a hidden product was priced by the minds');
  PERFORM _m5_assert(
    _m5_refusal('service_role',
      format('SELECT public.minds_apply_price_change(%L::uuid, %L::uuid, 60, %L::date, %L)', v_owner, v_product_usd, v_day, 'It sells well.')) = 'price_too_low',
    'a price below one dollar was written');
  PERFORM _m5_assert(
    _m5_refusal('service_role',
      format('SELECT public.minds_apply_price_change(%L::uuid, %L::uuid, 100000, %L::date, %L)', v_owner, v_product_usd, v_day, 'It sells well.')) = 'price_too_high',
    'a price over the ceiling was written');
  PERFORM _m5_assert(
    _m5_refusal('service_role',
      format('SELECT public.minds_apply_price_change(%L::uuid, %L::uuid, 3400, %L::date, %L)', v_owner, v_product_usd, v_day, 'It sells well.')) = 'price_same',
    'a price that did not move was written');
  PERFORM _m5_assert(
    _m5_refusal('service_role',
      format('SELECT public.minds_apply_price_change(%L::uuid, %L::uuid, 2000, %L::date, %L)', v_owner, v_product_usd, v_day, 'It sells well.')) = 'price_too_big_a_step',
    'a price that moved by more than a quarter was written');
  PERFORM _m5_assert(
    _m5_refusal('service_role',
      format('SELECT public.minds_apply_price_change(%L::uuid, %L::uuid, 2950, %L::date, %L)', v_owner, v_product_usd, v_day, 'Naira rate is better.')) = 'price_reason_money',
    'a reason that names another money was written');
  PERFORM _m5_assert(
    _m5_refusal('service_role',
      format('SELECT public.minds_apply_price_change(%L::uuid, %L::uuid, 2950, %L::date, %L)', v_owner, v_product_usd, v_day, '  ')) = 'price_no_reason',
    'a price was written with no reason at all');

  -- The change itself: the shop's price is written in both columns, and the change is recorded.
  SELECT _m5_text('service_role',
    format('SELECT public.minds_apply_price_change(%L::uuid, %L::uuid, 2950, %L::date, %L)', v_owner, v_product_usd, v_day, 'It sells well and the price is high.')) INTO v_answer;
  PERFORM _m5_assert(
    (v_answer::jsonb ->> 'from_cents') = '3400' AND (v_answer::jsonb ->> 'to_cents') = '2950',
    'the change did not report the old and the new price');
  PERFORM _m5_assert(
    (SELECT price FROM public.products WHERE id = v_product_usd) = '29.50',
    'the shop price text was not written');
  PERFORM _m5_assert(
    (SELECT price_cents FROM public.products WHERE id = v_product_usd) = 2950,
    'the shop price in cents was not written');
  PERFORM _m5_assert(
    (SELECT count(*) FROM public.minds_price_changes WHERE owner_id = v_owner AND product_id = v_product_usd AND local_day = v_day) = 1,
    'the price change was not recorded');
  -- One change a day for the same product.
  PERFORM _m5_assert(
    _m5_refusal('service_role',
      format('SELECT public.minds_apply_price_change(%L::uuid, %L::uuid, 2900, %L::date, %L)', v_owner, v_product_usd, v_day, 'It sells well.')) = 'price_already_changed_today',
    'a second change was written on the same day');
  -- The same product may change again on a later day, and the step is measured from the price it really shows.
  SELECT _m5_text('service_role',
    format('SELECT public.minds_apply_price_change(%L::uuid, %L::uuid, 3050, %L::date, %L)', v_owner, v_product_usd, v_next_day, 'It sells well at this price.')) INTO v_answer;
  PERFORM _m5_assert(
    (v_answer::jsonb ->> 'from_cents') = '2950' AND (v_answer::jsonb ->> 'to_cents') = '3050',
    'a later day could not change the price again');

  PERFORM _m5_assert(
    _m5_raises('authenticated', format('SELECT public.minds_apply_price_change(%L::uuid, %L::uuid, 3200, %L::date, %L)', v_owner, v_product_usd, v_next_day, 'It sells well.')),
    'a signed-in user could write a price');
  PERFORM _m5_assert(
    _m5_raises('anon', format('SELECT public.minds_apply_price_change(%L::uuid, %L::uuid, 3200, %L::date, %L)', v_owner, v_product_usd, v_next_day, 'It sells well.')),
    'an anonymous visitor could write a price');

  -- ---------------------------------------------------------------- 5. leave the database as it was found
  DELETE FROM public.minds_price_changes WHERE owner_id IN (v_owner, v_other);
  DELETE FROM public.minds_competitor_reads WHERE owner_id IN (v_owner, v_other);
  DELETE FROM public.minds_competitors WHERE owner_id IN (v_owner, v_other);
  DELETE FROM public.post_drip_days WHERE owner_id IN (v_owner, v_other);
  DELETE FROM public.minds_notable_events WHERE owner_id IN (v_owner, v_other);
  DELETE FROM public.minds_daily_log WHERE owner_id IN (v_owner, v_other);
  DELETE FROM public.products WHERE id IN (v_product_usd, v_product_ngn, v_product_off, v_product_free);
  DELETE FROM public.posts WHERE id IN (v_post_a, v_post_b, v_post_c, v_post_d, v_draft);
  DELETE FROM public.app_admins WHERE user_id IN (v_owner, v_other);
  DELETE FROM auth.users WHERE id IN (v_owner, v_other);
  -- The switches go back exactly as they were before this suite ran.
  IF COALESCE(v_freezing, false) THEN
    UPDATE public.minds_controls SET takeover = true WHERE id = 1;
  ELSE
    UPDATE public.minds_controls SET takeover = false, kill_scope = 'none' WHERE id = 1;
  END IF;

  RAISE NOTICE 'Phase I slice 5 assertions passed (drip, watched pages, one price change)';
END $$;

DROP FUNCTION _m5_text(text, text);
DROP FUNCTION _m5_raises(text, text);
DROP FUNCTION _m5_refusal(text, text);
DROP FUNCTION _m5_assert(boolean, text);
