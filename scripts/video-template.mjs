#!/usr/bin/env node
/**
 * The video template: the *look* of a rendered vertical video, as data rather than
 * code (V22). A template is an owner-editable document; the renderer accepts one via
 * `--template <path>` and falls back to DEFAULT_VIDEO_TEMPLATE, which reproduces the
 * original hard-coded look exactly.
 *
 * Every value here ends up in an FFmpeg filter graph, so validation is a safety
 * boundary, not a nicety:
 *   * numbers stay numbers (formatted with a fixed decimal form, never a locale string),
 *   * colours must be `0xRRGGBB`,
 *   * free text is never placed in the filter graph at all — it is written to a text
 *     file and referenced with `textfile=`, exactly as before, so a template can never
 *     inject a filter, a shell command or a new output.
 *
 * Bounds are deliberately narrow: this is a calm editorial look, not an effects tool.
 */

export const VIDEO_TEMPLATE_SCHEMA = 'lixxon.video-template.v1';
export const MAX_TEMPLATE_BYTES = 4096;

/** The look the renderer shipped with, now expressible as a document. */
export const DEFAULT_VIDEO_TEMPLATE = Object.freeze({
  schema: VIDEO_TEMPLATE_SCHEMA,
  name: 'Lagos daylight (default)',
  duration_seconds: 12,
  music: 'none',
  fps: 30,
  movement: {
    zoom_step: 0.00035,
    zoom_max: 1.08,
    pan_x: 0.12,
    pan_y: 0.08,
    pan_x_period: 90,
    pan_y_period: 110,
  },
  title: {
    font_size: 50,
    line_spacing: 10,
    color: '0xFDFBF7',
    box_height: 330,
    seconds: 2,
  },
  caption: {
    font_size: 40,
    line_spacing: 16,
    color: '0xFFFFFF',
    box_top: 1120,
    box_height: 500,
    max_characters_per_line: 34,
    max_lines: 6,
  },
  end_card: {
    font_size: 58,
    line_spacing: 22,
    color: '0xF2EDE7',
    text: 'Lixxon Studio\nTEST ONLY · NOT FOR POSTING',
  },
  watermark: {
    text: 'TEST ONLY — NOT FOR POSTING',
    font_size: 29,
  },
});

const COLOR_RE = /^0x[0-9A-F]{6}$/i;
const NAME_RE = /^[^\u0000-\u001F\u007F]{1,80}$/;
const LINE_RE = /^[^\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]{1,200}$/;
const DECIMALS = { zoom_step: 5, zoom_max: 3, pan_x: 3, pan_y: 3 };

/** Format a validated number with a fixed decimal form; never scientific notation. */
export function templateNumber(value, decimals) {
  return Number(value).toFixed(decimals).replace(/0+$/, '').replace(/\.$/, '');
}

function requireInteger(value, min, max, label) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${label} must be an integer from ${min} to ${max}.`);
  }
  return value;
}

function requireNumber(value, min, max, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${label} must be a number from ${min} to ${max}.`);
  }
  return value;
}

function requireColor(value, label) {
  if (typeof value !== 'string' || !COLOR_RE.test(value)) {
    throw new Error(`${label} must be a 0xRRGGBB colour.`);
  }
  return value.toUpperCase().replace('0X', '0x');
}

function requireExactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const actual = Object.keys(value);
  if (actual.length !== keys.length || actual.some(key => !keys.includes(key))) {
    throw new Error(`${label} must contain exactly: ${keys.join(', ')}.`);
  }
  return value;
}

function requireText(value, { label, maxLength, maxLines }) {
  if (typeof value !== 'string' || value.length < 1 || value.length > maxLength) {
    throw new Error(`${label} must be 1 to ${maxLength} characters.`);
  }
  const normalized = value.normalize('NFC');
  const lines = normalized.split('\n');
  if (lines.length > maxLines) throw new Error(`${label} must be at most ${maxLines} lines.`);
  if (lines.some(line => !LINE_RE.test(line))) {
    throw new Error(`${label} may not contain control characters or empty lines.`);
  }
  return normalized;
}

/**
 * Validate a template document. Returns a frozen, normalised copy — never the input —
 * so a caller cannot smuggle an unvalidated value past this boundary later.
 */
export function validateVideoTemplate(value) {
  const text = JSON.stringify(value ?? null);
  if (text.length > MAX_TEMPLATE_BYTES) {
    throw new Error(`A video template must serialize to at most ${MAX_TEMPLATE_BYTES} bytes.`);
  }
  requireExactKeys(value, [
    'schema', 'name', 'duration_seconds', 'music', 'fps',
    'movement', 'title', 'caption', 'end_card', 'watermark',
  ], 'The video template');
  if (value.schema !== VIDEO_TEMPLATE_SCHEMA) {
    throw new Error(`The video template schema must be ${VIDEO_TEMPLATE_SCHEMA}.`);
  }
  if (typeof value.name !== 'string' || !NAME_RE.test(value.name)) {
    throw new Error('The template name must be 1 to 80 printable characters.');
  }
  if (value.music !== 'none') {
    // The contract asserts a silent MP4 with alt text. Music needs an owner-supplied
    // audio asset and its own licence record, so only `none` is accepted today.
    throw new Error('The only supported music value is "none"; the render is silent by contract.');
  }
  const fps = requireInteger(value.fps, 0, 60, 'fps');
  if (![24, 25, 30].includes(fps)) throw new Error('fps must be 24, 25 or 30.');

  const movement = requireExactKeys(value.movement, Object.keys(DEFAULT_VIDEO_TEMPLATE.movement), 'movement');
  const zoomStep = requireNumber(movement.zoom_step, 0.0001, 0.002, 'movement.zoom_step');
  const zoomMax = requireNumber(movement.zoom_max, 1.02, 1.25, 'movement.zoom_max');
  const panX = requireNumber(movement.pan_x, 0, 0.4, 'movement.pan_x');
  const panY = requireNumber(movement.pan_y, 0, 0.4, 'movement.pan_y');
  const panXPeriod = requireInteger(movement.pan_x_period, 30, 300, 'movement.pan_x_period');
  const panYPeriod = requireInteger(movement.pan_y_period, 30, 300, 'movement.pan_y_period');

  const title = requireExactKeys(value.title, Object.keys(DEFAULT_VIDEO_TEMPLATE.title), 'title');
  const titleFont = requireInteger(title.font_size, 28, 96, 'title.font_size');
  const titleSpacing = requireInteger(title.line_spacing, 0, 40, 'title.line_spacing');
  const titleColor = requireColor(title.color, 'title.color');
  const titleBox = requireInteger(title.box_height, 200, 900, 'title.box_height');
  const titleSeconds = requireNumber(title.seconds, 1, 6, 'title.seconds');
  if (Math.round(titleSeconds * 10) !== titleSeconds * 10) {
    throw new Error('title.seconds must be given to one decimal place or fewer.');
  }

  const caption = requireExactKeys(value.caption, Object.keys(DEFAULT_VIDEO_TEMPLATE.caption), 'caption');
  const captionFont = requireInteger(caption.font_size, 24, 72, 'caption.font_size');
  const captionSpacing = requireInteger(caption.line_spacing, 0, 40, 'caption.line_spacing');
  const captionColor = requireColor(caption.color, 'caption.color');
  const captionTop = requireInteger(caption.box_top, 200, 1700, 'caption.box_top');
  const captionBox = requireInteger(caption.box_height, 200, 900, 'caption.box_height');
  const captionLineWidth = requireInteger(caption.max_characters_per_line, 16, 48, 'caption.max_characters_per_line');
  const captionLines = requireInteger(caption.max_lines, 3, 10, 'caption.max_lines');

  const endCard = requireExactKeys(value.end_card, Object.keys(DEFAULT_VIDEO_TEMPLATE.end_card), 'end_card');
  const endFont = requireInteger(endCard.font_size, 28, 96, 'end_card.font_size');
  const endSpacing = requireInteger(endCard.line_spacing, 0, 48, 'end_card.line_spacing');
  const endColor = requireColor(endCard.color, 'end_card.color');
  const endText = requireText(endCard.text, { label: 'end_card.text', maxLength: 200, maxLines: 4 });

  const watermark = requireExactKeys(value.watermark, Object.keys(DEFAULT_VIDEO_TEMPLATE.watermark), 'watermark');
  const watermarkText = requireText(watermark.text, { label: 'watermark.text', maxLength: 60, maxLines: 1 });
  const watermarkFont = requireInteger(watermark.font_size, 16, 48, 'watermark.font_size');

  const duration = requireInteger(value.duration_seconds, 8, 60, 'duration_seconds');
  if (titleBox + 100 > 1920 || captionTop + captionBox > 1900) {
    throw new Error('The title and caption boxes must fit inside the 1080x1920 canvas.');
  }

  return Object.freeze({
    schema: VIDEO_TEMPLATE_SCHEMA,
    name: value.name,
    duration_seconds: duration,
    music: 'none',
    fps,
    movement: Object.freeze({
      zoom_step: Number(templateNumber(zoomStep, DECIMALS.zoom_step)),
      zoom_max: Number(templateNumber(zoomMax, DECIMALS.zoom_max)),
      pan_x: Number(templateNumber(panX, DECIMALS.pan_x)),
      pan_y: Number(templateNumber(panY, DECIMALS.pan_y)),
      pan_x_period: panXPeriod,
      pan_y_period: panYPeriod,
    }),
    title: Object.freeze({ font_size: titleFont, line_spacing: titleSpacing, color: titleColor, box_height: titleBox, seconds: titleSeconds }),
    caption: Object.freeze({
      font_size: captionFont, line_spacing: captionSpacing, color: captionColor,
      box_top: captionTop, box_height: captionBox,
      max_characters_per_line: captionLineWidth, max_lines: captionLines,
    }),
    end_card: Object.freeze({ font_size: endFont, line_spacing: endSpacing, color: endColor, text: endText }),
    watermark: Object.freeze({ text: watermarkText, font_size: watermarkFont }),
  });
}

/** The canonical, validated default — what the renderer uses when no template is given. */
export const VALIDATED_DEFAULT_VIDEO_TEMPLATE = validateVideoTemplate(DEFAULT_VIDEO_TEMPLATE);

/** The caption window implied by a template: the title holds the first `title.seconds`. */
export function templateCaptionWindow(template) {
  const duration = template.duration_seconds;
  const hold = template.title.seconds;
  return {
    start: Math.min(hold, duration / 4),
    end: duration - Math.min(hold, duration / 6),
  };
}
