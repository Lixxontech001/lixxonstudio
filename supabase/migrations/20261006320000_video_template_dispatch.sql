-- V22 (slice 4) — dispatch support for changing the video look without a code deploy.
--
-- `automation-video-template` (Edge Function) needs to read the live look, apply nothing of its
-- own, and hand the document straight to the render workflow. It runs as service_role, so the
-- admin-gated reader the panel uses would refuse it. This migration therefore:
--   1. splits the document builder into an unexported worker (`_internal`, callable only from
--      other SECURITY DEFINER functions) and a gated wrapper that keeps requiring
--      `automation.check` for admin sessions;
--   2. adds `automation_video_template_active_internal()`, granted to service_role only, which
--      returns the one active look (or null) so the dispatcher never has to pick a template
--      itself and can never dispatch a look the owner did not activate.

CREATE OR REPLACE FUNCTION automation_video_template_document_internal(p_id uuid)
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

CREATE OR REPLACE FUNCTION automation_video_template_document(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT admin_can('automation.check') THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  RETURN automation_video_template_document_internal(p_id);
END $$;

CREATE OR REPLACE FUNCTION automation_video_template_active_internal()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'id', t.id,
    'name', t.name,
    'document', automation_video_template_document_internal(t.id)
  )
  FROM video_templates t
  WHERE t.is_active;
$$;

-- The worker is reachable from other SECURITY DEFINER functions only.
REVOKE ALL ON FUNCTION automation_video_template_document_internal(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION automation_video_template_document(uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION automation_video_template_active_internal() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION automation_video_template_document(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION automation_video_template_active_internal() TO service_role;
