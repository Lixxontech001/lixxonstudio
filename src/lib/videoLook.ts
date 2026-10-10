// Phase E slice 4: the Video look. The owner edits a few bounded values of the saved look and saves them through the
// existing template save call. The rest of the look is kept as it is. Every value is checked here first, and again by
// the same parser the database and the renderer use, so the screen never saves a look the renderer would reject.

import { parseVideoTemplateDocument, type VideoTemplateDocument } from './automationDistribution';

/** The three values the screen may change. The bounds match parseVideoTemplateDocument. */
export const LOOK_LIMITS = {
  durationSeconds: { min: 8, max: 60 },
  captionFontSize: { min: 24, max: 72 },
} as const;

export const LOOK_COLOR_PATTERN = /^0x[0-9A-Fa-f]{6}$/;

export interface LookEdits {
  durationSeconds: string;
  captionFontSize: string;
  captionColor: string;
}

export type LookEditResult = { ok: true; document: VideoTemplateDocument } | { ok: false; problems: string[] };

/**
 * The look the renderer ships with. Same values as DEFAULT_VIDEO_TEMPLATE in scripts/video-template.mjs; a parity test
 * keeps them equal. It is used only when no look is saved yet.
 */
export const BUILT_IN_LOOK: VideoTemplateDocument = {
  schema: 'lixxon.video-template.v1',
  name: 'Clear daylight (default)',
  duration_seconds: 12,
  music: 'none',
  fps: 30,
  movement: { zoom_step: 0.00035, zoom_max: 1.08, pan_x: 0.12, pan_y: 0.08, pan_x_period: 90, pan_y_period: 110 },
  title: { font_size: 50, line_spacing: 10, color: '0xFDFBF7', box_height: 330, seconds: 2 },
  caption: {
    font_size: 40, line_spacing: 16, color: '0xFFFFFF', box_top: 1120, box_height: 500,
    max_characters_per_line: 34, max_lines: 6,
  },
  end_card: { font_size: 58, line_spacing: 22, color: '0xF2EDE7', text: 'Lixxon Studio\nTEST ONLY · NOT FOR POSTING' },
  watermark: { text: 'TEST ONLY — NOT FOR POSTING', font_size: 29 },
};

/** A whole number written as digits only ("12", not "12.5", "-3" or "twelve"). Null when it is not one. */
function wholeNumber(text: string): number | null {
  const trimmed = text.trim();
  return /^\d+$/.test(trimmed) ? Number(trimmed) : null;
}

/**
 * Applies the three edits to a saved look. Returns the checked document, or the plain reasons it was refused.
 * Nothing else in the look can change: the title, movement, end card, watermark and name are copied as they are.
 */
export function applyLookEdits(base: VideoTemplateDocument, edits: LookEdits): LookEditResult {
  const problems: string[] = [];
  const duration = wholeNumber(edits.durationSeconds);
  const { min: minDuration, max: maxDuration } = LOOK_LIMITS.durationSeconds;
  if (duration === null || duration < minDuration || duration > maxDuration) {
    problems.push(`Length must be a whole number of seconds from ${minDuration} to ${maxDuration}.`);
  }
  const font = wholeNumber(edits.captionFontSize);
  const { min: minFont, max: maxFont } = LOOK_LIMITS.captionFontSize;
  if (font === null || font < minFont || font > maxFont) {
    problems.push(`Caption size must be a whole number from ${minFont} to ${maxFont}.`);
  }
  const color = edits.captionColor.trim();
  if (!LOOK_COLOR_PATTERN.test(color)) problems.push('Caption colour must look like 0xFFFFFF (six hex digits after 0x).');
  if (problems.length > 0 || duration === null || font === null) return { ok: false, problems };

  const parsed = parseVideoTemplateDocument({
    ...base,
    duration_seconds: duration,
    caption: { ...base.caption, font_size: font, color },
  });
  if (!parsed) return { ok: false, problems: ['This look did not pass the checks. Nothing was saved.'] };
  return { ok: true, document: parsed };
}

/** The read-only lines the screen shows for a look. Plain words, no internal names. */
export function lookSummary(look: VideoTemplateDocument): Array<{ label: string; value: string }> {
  return [
    { label: 'Name', value: look.name },
    { label: 'Length', value: `${look.duration_seconds} seconds` },
    { label: 'Frame rate', value: `${look.fps} frames a second` },
    { label: 'Caption size', value: String(look.caption.font_size) },
    { label: 'Caption colour', value: look.caption.color },
    { label: 'Music', value: 'None' },
  ];
}

/**
 * Shown on the screen. The pack video (scripts/pack-video.mjs) reads three values of the saved look: length, caption
 * size and caption colour. Anything else in the look is not used by the pack video.
 */
export const LOOK_SCOPE_NOTE = "The pack video uses this look's length, caption size and caption colour. The title, movement, end card and watermark are not used by the pack video.";
