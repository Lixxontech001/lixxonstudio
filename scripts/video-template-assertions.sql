-- V22 assertions: the video template store.
--
-- The look is data now, so the assertions care about three things: the document the
-- panel copies is exactly the seeded default (no drift from scripts/video-template.mjs),
-- every bound rejects an out-of-range or non-numeric value, and only the owner can write
-- while exactly one template is ever active.
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION _template_text(role_name text, claims jsonb, expr text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE result text;
BEGIN
  EXECUTE format('SET LOCAL ROLE %I', role_name);
  PERFORM set_config('request.jwt.claims', claims::text, true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(claims->>'sub', ''), true);
  PERFORM set_config('request.jwt.claim.role', COALESCE(claims->>'role', role_name), true);
  EXECUTE 'SELECT (' || expr || ')::text' INTO result;
  RESET ROLE;
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION _template_raises(role_name text, claims jsonb, statement text)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE raised boolean := false;
BEGIN
  EXECUTE format('SET LOCAL ROLE %I', role_name);
  PERFORM set_config('request.jwt.claims', claims::text, true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(claims->>'sub', ''), true);
  PERFORM set_config('request.jwt.claim.role', COALESCE(claims->>'role', role_name), true);
  BEGIN
    EXECUTE statement;
  EXCEPTION WHEN others THEN
    raised := true;
  END;
  RESET ROLE;
  RETURN raised;
END $$;

DO $$
DECLARE
  v_owner jsonb := '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000001"}';
  v_editor jsonb := '{"role":"authenticated","sub":"00000000-0000-0000-0000-0000000000e5"}';
  v_reader jsonb := '{"role":"authenticated","sub":"00000000-0000-0000-0000-0000000000d4"}';
  v_anon jsonb := '{"role":"anon"}';
  v_list jsonb;
  v_active jsonb;
  v_doc jsonb;
  v_saved jsonb;
  v_new_id uuid;
  v_default_id uuid;
BEGIN
  PERFORM set_config('request.jwt.claims', v_owner::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_owner->>'sub', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('lixxon.automation_agent', 'off', true);

  -- ---------------------------------------------------------------- seeded default
  v_list := _template_text('authenticated', v_owner, 'SELECT automation_video_templates()')::jsonb;
  v_default_id := (v_list ->> 'active_id')::uuid;
  IF v_default_id IS NULL THEN RAISE EXCEPTION 'no active video template is seeded'; END IF;
  IF (SELECT count(*) FROM video_templates) <> 1 THEN
    RAISE EXCEPTION 'the migration must seed exactly one template, found %', (SELECT count(*) FROM video_templates);
  END IF;

  v_active := v_list -> 'active_document';
  IF v_active ->> 'schema' <> 'lixxon.video-template.v1' THEN
    RAISE EXCEPTION 'the active document is not the v1 template schema';
  END IF;
  -- Field-for-field the document must equal the renderer's code default
  -- (scripts/video-template.mjs DEFAULT_VIDEO_TEMPLATE). Comparing the whole object at
  -- once means a drifted field can never hide behind a long OR chain, and the clean
  -- numbers prove the document carries no numeric column padding.
  IF v_active IS DISTINCT FROM '{
    "schema": "lixxon.video-template.v1",
    "name": "Lagos daylight (default)",
    "duration_seconds": 12,
    "music": "none",
    "fps": 30,
    "movement": {"zoom_step": 0.00035, "zoom_max": 1.08, "pan_x": 0.12, "pan_y": 0.08, "pan_x_period": 90, "pan_y_period": 110},
    "title": {"font_size": 50, "line_spacing": 10, "color": "0xFDFBF7", "box_height": 330, "seconds": 2},
    "caption": {"font_size": 40, "line_spacing": 16, "color": "0xFFFFFF", "box_top": 1120, "box_height": 500, "max_characters_per_line": 34, "max_lines": 6},
    "end_card": {"font_size": 58, "line_spacing": 22, "color": "0xF2EDE7", "text": "Lixxon Studio\nTEST ONLY · NOT FOR POSTING"},
    "watermark": {"text": "TEST ONLY — NOT FOR POSTING", "font_size": 29}
  }'::jsonb THEN
    RAISE EXCEPTION 'the seeded template drifted from the renderer default: %', v_active;
  END IF;

  -- ---------------------------------------------------------------- read boundary
  IF NOT _template_raises('authenticated', v_reader, 'SELECT automation_video_templates()') THEN
    RAISE EXCEPTION 'a non-admin read the template list';
  END IF;
  IF NOT _template_raises('anon', v_anon, 'SELECT automation_video_templates()') THEN
    RAISE EXCEPTION 'an anonymous caller read the template list';
  END IF;
  IF NOT _template_raises('anon', v_anon, 'SELECT id FROM video_templates') THEN
    RAISE EXCEPTION 'an anonymous caller could select the template table directly';
  END IF;

  -- ---------------------------------------------------------------- write boundary
  IF NOT _template_raises('authenticated', v_editor,
       format('SELECT automation_save_video_template(%L::jsonb, false)', v_active::text)) THEN
    RAISE EXCEPTION 'an editor saved a video template';
  END IF;
  IF NOT _template_raises('authenticated', v_editor,
       format('SELECT automation_activate_video_template(%L::uuid)', v_default_id)) THEN
    RAISE EXCEPTION 'an editor activated a video template';
  END IF;
  IF NOT _template_raises('anon', v_anon,
       'SELECT automation_save_video_template(''{"schema":"lixxon.video-template.v1"}''::jsonb, false)') THEN
    RAISE EXCEPTION 'an anonymous caller saved a video template';
  END IF;
  IF NOT _template_raises('authenticated', v_owner,
       format('SELECT automation_delete_video_template(%L::uuid)', v_default_id)) THEN
    RAISE EXCEPTION 'the active template was deleted';
  END IF;

  -- ---------------------------------------------------------------- bounds
  DECLARE
    base jsonb := v_active;
    long_text text := repeat('y', 400);
  BEGIN
    -- every one of these must be refused by the column bounds or the explicit checks
    IF NOT _template_raises('authenticated', v_owner,
         format('SELECT automation_save_video_template(%L::jsonb, false)',
           (base || jsonb_build_object('duration_seconds', 90))::text)) THEN
      RAISE EXCEPTION 'a 90 second template was accepted';
    END IF;
    IF NOT _template_raises('authenticated', v_owner,
         format('SELECT automation_save_video_template(%L::jsonb, false)',
           (base || jsonb_build_object('music', 'upbeat'))::text)) THEN
      RAISE EXCEPTION 'music other than none was accepted';
    END IF;
    IF NOT _template_raises('authenticated', v_owner,
         format('SELECT automation_save_video_template(%L::jsonb, false)',
           (base || jsonb_build_object('duration_seconds', 'fast'))::text)) THEN
      RAISE EXCEPTION 'a non-numeric duration was accepted';
    END IF;
    IF NOT _template_raises('authenticated', v_owner,
         format('SELECT automation_save_video_template(%L::jsonb, false)',
           (jsonb_set(base, '{caption,color}', '"red"'::jsonb))::text)) THEN
      RAISE EXCEPTION 'a non-hex colour was accepted';
    END IF;
    IF NOT _template_raises('authenticated', v_owner,
         format('SELECT automation_save_video_template(%L::jsonb, false)',
           (jsonb_set(base, '{movement,zoom_max}', '1.9'::jsonb))::text)) THEN
      RAISE EXCEPTION 'an out-of-range zoom was accepted';
    END IF;
    IF NOT _template_raises('authenticated', v_owner,
         format('SELECT automation_save_video_template(%L::jsonb, false)',
           (jsonb_set(base, '{end_card,text}', to_jsonb(long_text)))::text)) THEN
      RAISE EXCEPTION 'an over-long end-card text was accepted';
    END IF;
    IF NOT _template_raises('authenticated', v_owner,
         format('SELECT automation_save_video_template(%L::jsonb, false)',
           (base || jsonb_build_object('prose', 'the AI must never smuggle prose here'))::text)) THEN
      RAISE EXCEPTION 'a document carrying an extra field was accepted';
    END IF;
    IF NOT _template_raises('authenticated', v_owner,
         format('SELECT automation_save_video_template(%L::jsonb, false)',
           (jsonb_set(base, '{caption,box_top}', '2500'::jsonb))::text)) THEN
      RAISE EXCEPTION 'a caption box outside the canvas was accepted';
    END IF;

    -- a legitimate edit saves a new version without becoming active
    v_saved := _template_text('authenticated', v_owner,
      format('SELECT automation_save_video_template(%L::jsonb, false)',
        (base || jsonb_build_object('name', 'Gap-slice evening contrast'))::text))::jsonb;
    SELECT id INTO v_new_id FROM video_templates WHERE name = 'Gap-slice evening contrast';
    IF v_new_id IS NULL THEN RAISE EXCEPTION 'a valid template was not saved'; END IF;
    IF (SELECT is_active FROM video_templates WHERE id = v_new_id) THEN
      RAISE EXCEPTION 'saving without activate made the new version live';
    END IF;
    IF (SELECT is_active FROM video_templates WHERE id = v_default_id) IS NOT TRUE THEN
      RAISE EXCEPTION 'saving a new version deactivated the current look';
    END IF;
    IF (SELECT count(*) FROM video_templates WHERE is_active) <> 1 THEN
      RAISE EXCEPTION 'more than one template is active';
    END IF;

    -- a renamed document activates as the single live look
    PERFORM _template_text('authenticated', v_owner,
      format('SELECT automation_activate_video_template(%L::uuid)', v_new_id));
    IF (SELECT is_active FROM video_templates WHERE id = v_new_id) IS NOT TRUE
       OR (SELECT count(*) FROM video_templates WHERE is_active) <> 1 THEN
      RAISE EXCEPTION 'activation did not leave exactly one live template';
    END IF;
    v_doc := _template_text('authenticated', v_owner,
      format('SELECT automation_video_template_document(%L::uuid)', v_new_id))::jsonb;
    IF v_doc ->> 'name' <> 'Gap-slice evening contrast' THEN
      RAISE EXCEPTION 'the document builder returned the wrong template';
    END IF;

    -- the internal reader is service_role only, and a non-admin session cannot call the
    -- document builder directly even knowing an id
    IF NOT _template_raises('authenticated', v_reader,
         format('SELECT automation_video_template_document(%L::uuid)', v_new_id)) THEN
      RAISE EXCEPTION 'a non-admin session read a template document directly';
    END IF;
    IF _template_text('service_role', NULL,
         'SELECT automation_video_template_active_internal()')::jsonb ->> 'name'
       <> 'Gap-slice evening contrast' THEN
      RAISE EXCEPTION 'the internal reader did not return the active look';
    END IF;
    IF NOT _template_raises('anon', NULL,
         'SELECT automation_video_template_active_internal()') THEN
      RAISE EXCEPTION 'an anonymous session reached the internal reader';
    END IF;

    -- the former default can now be deleted, and deleting the live one is refused
    PERFORM _template_text('authenticated', v_owner,
      format('SELECT automation_delete_video_template(%L::uuid)', v_default_id));
    IF EXISTS (SELECT 1 FROM video_templates WHERE id = v_default_id) THEN
      RAISE EXCEPTION 'an inactive template was not deleted';
    END IF;
    IF NOT _template_raises('authenticated', v_owner,
         format('SELECT automation_delete_video_template(%L::uuid)', v_new_id)) THEN
      RAISE EXCEPTION 'the active template was deleted';
    END IF;

    -- ------------------------------------------------------------- restore
    -- Put the seeded default back so later suites and a fresh reader see the operator's
    -- original look with the same id-independent name.
    PERFORM _template_text('authenticated', v_owner,
      format('SELECT automation_save_video_template(%L::jsonb, true)',
        (base || jsonb_build_object('name', 'Lagos daylight (default)'))::text));
    PERFORM _template_text('authenticated', v_owner,
      format('SELECT automation_delete_video_template(%L::uuid)', v_new_id));
    IF (SELECT count(*) FROM video_templates) <> 1
       OR (SELECT count(*) FROM video_templates WHERE is_active) <> 1 THEN
      RAISE EXCEPTION 'the template store was not restored to one active default';
    END IF;
  END;
END $$;
