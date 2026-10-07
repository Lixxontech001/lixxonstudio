-- =============================================================================
-- V22 — video templates the owner can change without a code deploy.
--
-- The look of a rendered vertical video used to be constants inside
-- scripts/render-video-test.mjs: the zoom and pan, the title card, the caption card,
-- the end card, the watermark, the duration and the silent-music mode. Those values
-- now live in `video_templates`, the owner edits them at Admin → Daily Kit → Video
-- templates, and the renderer accepts the document through
-- `--template <path>` (the workflow takes it as a bounded dispatch input). The code
-- default remains the fallback, and the seeded row reproduces today's look exactly, so
-- nothing changes visually until the owner edits it.
--
-- Safety of the boundary:
--   * Every column is a bounded integer, a `0xRRGGBB` colour or short text with a CHECK
--     constraint, mirroring `scripts/video-template.mjs` field for field. Numbers stay
--     numbers, so an owner value can never inject an FFmpeg filter, a shell command or
--     a new output. Free text is only ever written to a sidecar text file by the
--     renderer, never into the filter graph.
--   * Writes are owner-only (`automation_owner_authorized()`), audited by the existing
--     activity trigger, and versioned: saving creates a new row and activating is a
--     separate, explicit act, so a half-finished edit can never become the live look.
--   * This table cannot publish, upload, enqueue or touch article prose. Rendering stays
--     a test-only, runner-temp operation with `approvalEligible=false`.
-- =============================================================================

CREATE TABLE IF NOT EXISTS video_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE CHECK (name ~ '^[^\x00-\x1F\x7F]{1,80}$'),
  is_active boolean NOT NULL DEFAULT false,
  -- render window
  duration_seconds integer NOT NULL CHECK (duration_seconds BETWEEN 8 AND 60),
  fps integer NOT NULL DEFAULT 30 CHECK (fps IN (24, 25, 30)),
  music text NOT NULL DEFAULT 'none' CHECK (music = 'none'),
  -- movement
  zoom_step numeric(6,5) NOT NULL CHECK (zoom_step BETWEEN 0.0001 AND 0.002),
  zoom_max numeric(4,3) NOT NULL CHECK (zoom_max BETWEEN 1.02 AND 1.25),
  pan_x numeric(4,3) NOT NULL CHECK (pan_x BETWEEN 0 AND 0.4),
  pan_y numeric(4,3) NOT NULL CHECK (pan_y BETWEEN 0 AND 0.4),
  pan_x_period integer NOT NULL CHECK (pan_x_period BETWEEN 30 AND 300),
  pan_y_period integer NOT NULL CHECK (pan_y_period BETWEEN 30 AND 300),
  -- title card
  title_font_size integer NOT NULL CHECK (title_font_size BETWEEN 28 AND 96),
  title_line_spacing integer NOT NULL CHECK (title_line_spacing BETWEEN 0 AND 40),
  title_color text NOT NULL CHECK (title_color ~ '^0x[0-9A-Fa-f]{6}$'),
  title_box_height integer NOT NULL CHECK (title_box_height BETWEEN 200 AND 900),
  title_seconds numeric(3,1) NOT NULL CHECK (title_seconds BETWEEN 1 AND 6),
  -- caption card
  caption_font_size integer NOT NULL CHECK (caption_font_size BETWEEN 24 AND 72),
  caption_line_spacing integer NOT NULL CHECK (caption_line_spacing BETWEEN 0 AND 40),
  caption_color text NOT NULL CHECK (caption_color ~ '^0x[0-9A-Fa-f]{6}$'),
  caption_box_top integer NOT NULL CHECK (caption_box_top BETWEEN 200 AND 1700),
  caption_box_height integer NOT NULL CHECK (caption_box_height BETWEEN 200 AND 900),
  caption_line_width integer NOT NULL CHECK (caption_line_width BETWEEN 16 AND 48),
  caption_max_lines integer NOT NULL CHECK (caption_max_lines BETWEEN 3 AND 10),
  -- end card and watermark
  end_card_font_size integer NOT NULL CHECK (end_card_font_size BETWEEN 28 AND 96),
  end_card_line_spacing integer NOT NULL CHECK (end_card_line_spacing BETWEEN 0 AND 48),
  end_card_color text NOT NULL CHECK (end_card_color ~ '^0x[0-9A-Fa-f]{6}$'),
  end_card_text text NOT NULL CHECK (length(end_card_text) BETWEEN 1 AND 200 AND end_card_text !~ '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]' AND end_card_text !~ E'\\n\\n'),
  watermark_text text NOT NULL CHECK (length(watermark_text) BETWEEN 1 AND 60 AND watermark_text !~ '[\x00-\x1F\x7F]'),
  watermark_font_size integer NOT NULL CHECK (watermark_font_size BETWEEN 16 AND 48),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- The title and caption cards must fit the 1080x1920 canvas, as the document validator requires.
  CHECK (title_box_height + 100 <= 1920),
  CHECK (caption_box_top + caption_box_height <= 1900)
);

-- Exactly one active template: a partial unique index makes "two live looks" impossible.
CREATE UNIQUE INDEX IF NOT EXISTS video_templates_single_active
  ON video_templates (is_active) WHERE is_active;

ALTER TABLE video_templates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE video_templates FROM PUBLIC, anon, service_role;
GRANT SELECT ON TABLE video_templates TO authenticated;
DROP POLICY IF EXISTS video_templates_admin_read ON video_templates;
CREATE POLICY video_templates_admin_read ON video_templates
  FOR SELECT TO authenticated USING (admin_can('automation.check'));
-- There are intentionally no browser INSERT/UPDATE/DELETE policies; all writes go
-- through the owner-only RPCs below.

DROP TRIGGER IF EXISTS trg_video_templates_audit ON video_templates;
CREATE TRIGGER trg_video_templates_audit
  AFTER INSERT OR UPDATE OR DELETE ON video_templates
  FOR EACH ROW EXECUTE FUNCTION public.audit_admin_change();

-- The seeded default is the look the renderer shipped with; it is generated from
-- scripts/video-template.mjs DEFAULT_VIDEO_TEMPLATE.
INSERT INTO video_templates (
  name, is_active, duration_seconds, fps, music,
  zoom_step, zoom_max, pan_x, pan_y, pan_x_period, pan_y_period,
  title_font_size, title_line_spacing, title_color, title_box_height, title_seconds,
  caption_font_size, caption_line_spacing, caption_color, caption_box_top, caption_box_height,
  caption_line_width, caption_max_lines,
  end_card_font_size, end_card_line_spacing, end_card_color, end_card_text,
  watermark_text, watermark_font_size
) VALUES (
  'Lagos daylight (default)', true, 12, 30, 'none',
  0.00035, 1.08, 0.12, 0.08, 90, 110,
  50, 10, '0xFDFBF7', 330, 2.0,
  40, 16, '0xFFFFFF', 1120, 500,
  34, 6,
  58, 22, '0xF2EDE7', E'Lixxon Studio\nTEST ONLY · NOT FOR POSTING',
  'TEST ONLY — NOT FOR POSTING', 29
) ON CONFLICT (name) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Owner RPCs. The document the panel copies and the workflow dispatches is built
-- here, so the app never invents template JSON of its own.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION automation_video_template_document(p_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'schema', 'lixxon.video-template.v1',
    'name', t.name,
    'duration_seconds', t.duration_seconds,
    'music', t.music,
    'fps', t.fps,
    -- Numerics are emitted as clean JSON numbers (numeric(6,5) would otherwise render
    -- as 0.12000), so the document a human copies into the workflow reads naturally.
    'movement', jsonb_build_object(
      'zoom_step', t.zoom_step::float8, 'zoom_max', t.zoom_max::float8,
      'pan_x', t.pan_x::float8, 'pan_y', t.pan_y::float8,
      'pan_x_period', t.pan_x_period, 'pan_y_period', t.pan_y_period),
    'title', jsonb_build_object(
      'font_size', t.title_font_size, 'line_spacing', t.title_line_spacing,
      'color', t.title_color, 'box_height', t.title_box_height, 'seconds', t.title_seconds::float8),
    'caption', jsonb_build_object(
      'font_size', t.caption_font_size, 'line_spacing', t.caption_line_spacing,
      'color', t.caption_color, 'box_top', t.caption_box_top, 'box_height', t.caption_box_height,
      'max_characters_per_line', t.caption_line_width, 'max_lines', t.caption_max_lines),
    'end_card', jsonb_build_object(
      'font_size', t.end_card_font_size, 'line_spacing', t.end_card_line_spacing,
      'color', t.end_card_color, 'text', t.end_card_text),
    'watermark', jsonb_build_object('text', t.watermark_text, 'font_size', t.watermark_font_size)
  )
  FROM video_templates t WHERE t.id = p_id;
$$;

CREATE OR REPLACE FUNCTION automation_video_templates()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT admin_can('automation.check') THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object(
    'active_id', (SELECT id FROM video_templates WHERE is_active),
    'templates', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', t.id, 'name', t.name, 'is_active', t.is_active,
               'duration_seconds', t.duration_seconds, 'fps', t.fps, 'music', t.music,
               'created_at', t.created_at)
             ORDER BY t.is_active DESC, t.created_at DESC)
        FROM video_templates t), '[]'::jsonb),
    'active_document', automation_video_template_document((SELECT id FROM video_templates WHERE is_active))
  );
END $$;

-- Saving always creates a NEW version; activating is a separate, deliberate act, so a
-- half-edited look can never silently become the live one.
CREATE OR REPLACE FUNCTION automation_save_video_template(p_document jsonb, p_activate boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
  v_name text;
  v_movement jsonb;
  v_title jsonb;
  v_caption jsonb;
  v_end jsonb;
  v_mark jsonb;
BEGIN
  IF NOT automation_owner_authorized() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF p_document IS NULL OR jsonb_typeof(p_document) <> 'object'
     OR octet_length(p_document::text) > 4096
     OR (p_document ?& ARRAY['schema', 'name', 'duration_seconds', 'music', 'fps', 'movement', 'title', 'caption', 'end_card', 'watermark']) IS NOT TRUE
     OR p_document - ARRAY['schema', 'name', 'duration_seconds', 'music', 'fps', 'movement', 'title', 'caption', 'end_card', 'watermark'] <> '{}'::jsonb
     OR p_document ->> 'schema' <> 'lixxon.video-template.v1' THEN
    RAISE EXCEPTION 'A video template must be the lixxon.video-template.v1 document and nothing else';
  END IF;
  v_movement := p_document -> 'movement';
  v_title := p_document -> 'title';
  v_caption := p_document -> 'caption';
  v_end := p_document -> 'end_card';
  v_mark := p_document -> 'watermark';
  v_name := btrim(COALESCE(p_document ->> 'name', ''));
  IF NULLIF(v_name, '') IS NULL OR length(v_name) > 80 THEN RAISE EXCEPTION 'Invalid template name'; END IF;

  -- Every value is cast, so a non-numeric entry fails here instead of reaching a render.
  INSERT INTO video_templates (
    name, is_active, duration_seconds, fps, music,
    zoom_step, zoom_max, pan_x, pan_y, pan_x_period, pan_y_period,
    title_font_size, title_line_spacing, title_color, title_box_height, title_seconds,
    caption_font_size, caption_line_spacing, caption_color, caption_box_top, caption_box_height,
    caption_line_width, caption_max_lines,
    end_card_font_size, end_card_line_spacing, end_card_color, end_card_text,
    watermark_text, watermark_font_size, created_by
  ) VALUES (
    v_name, false,
    (p_document ->> 'duration_seconds')::integer, (p_document ->> 'fps')::integer, p_document ->> 'music',
    (v_movement ->> 'zoom_step')::numeric, (v_movement ->> 'zoom_max')::numeric,
    (v_movement ->> 'pan_x')::numeric, (v_movement ->> 'pan_y')::numeric,
    (v_movement ->> 'pan_x_period')::integer, (v_movement ->> 'pan_y_period')::integer,
    (v_title ->> 'font_size')::integer, (v_title ->> 'line_spacing')::integer, v_title ->> 'color',
    (v_title ->> 'box_height')::integer, (v_title ->> 'seconds')::numeric,
    (v_caption ->> 'font_size')::integer, (v_caption ->> 'line_spacing')::integer, v_caption ->> 'color',
    (v_caption ->> 'box_top')::integer, (v_caption ->> 'box_height')::integer,
    (v_caption ->> 'max_characters_per_line')::integer, (v_caption ->> 'max_lines')::integer,
    (v_end ->> 'font_size')::integer, (v_end ->> 'line_spacing')::integer, v_end ->> 'color', v_end ->> 'text',
    v_mark ->> 'text', (v_mark ->> 'font_size')::integer, auth.uid()
  ) RETURNING id INTO v_id;

  IF p_activate THEN
    PERFORM automation_activate_video_template(v_id);
  END IF;

  RETURN automation_video_templates();
END $$;

CREATE OR REPLACE FUNCTION automation_activate_video_template(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT automation_owner_authorized() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM video_templates WHERE id = p_id) THEN RAISE EXCEPTION 'Template not found'; END IF;
  -- Cleared and set in one transaction, so the partial unique index never sees two actives.
  UPDATE video_templates SET is_active = false WHERE is_active AND id <> p_id;
  UPDATE video_templates SET is_active = true WHERE id = p_id;
  RETURN automation_video_templates();
END $$;

CREATE OR REPLACE FUNCTION automation_delete_video_template(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT automation_owner_authorized() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF EXISTS (SELECT 1 FROM video_templates WHERE id = p_id AND is_active) THEN
    RAISE EXCEPTION 'Activate another template before deleting the active look';
  END IF;
  DELETE FROM video_templates WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Template not found'; END IF;
  RETURN automation_video_templates();
END $$;

REVOKE ALL ON FUNCTION automation_video_templates() FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION automation_video_template_document(uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION automation_save_video_template(jsonb, boolean) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION automation_activate_video_template(uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION automation_delete_video_template(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION automation_video_templates() TO authenticated;
GRANT EXECUTE ON FUNCTION automation_video_template_document(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION automation_save_video_template(jsonb, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION automation_activate_video_template(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION automation_delete_video_template(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
