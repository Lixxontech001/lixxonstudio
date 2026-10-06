import { describe, expect, it } from 'vitest';
import { DEFAULT_VIDEO_TEMPLATE, validateVideoTemplate } from '../../scripts/video-template.mjs';
import { parseVideoTemplateDocument, parseVideoTemplates } from '../lib/automationDistribution';

/**
 * The panel (TypeScript) and the renderer (JavaScript) must agree on the same bounds:
 * a look the panel accepts and saves must be a look the renderer accepts and renders, and
 * a value the renderer refuses must never be presented as saveable.
 */
const DEFAULT_DOCUMENT = JSON.parse(JSON.stringify(DEFAULT_VIDEO_TEMPLATE));

function docWith(patch: Record<string, unknown>) {
  return { ...JSON.parse(JSON.stringify(DEFAULT_DOCUMENT)), ...patch };
}

describe('video template documents', () => {
  it('accepts the checked-in default in both the panel parser and the renderer validator', () => {
    expect(parseVideoTemplateDocument(DEFAULT_DOCUMENT)).not.toBeNull();
    expect(validateVideoTemplate(DEFAULT_VIDEO_TEMPLATE).name).toBe(DEFAULT_VIDEO_TEMPLATE.name);
    // Round-tripped through JSON, exactly as the panel sends it and the DB returns it.
    const fromJson = JSON.parse(JSON.stringify(DEFAULT_DOCUMENT));
    expect(parseVideoTemplateDocument(fromJson)).toEqual(DEFAULT_DOCUMENT);
  });

  it('refuses, in both implementations, every value that could reach a render unsafely', () => {
    const cases: Record<string, unknown>[] = [
      docWith({ music: 'upbeat' }),
      docWith({ duration_seconds: 90 }),
      docWith({ duration_seconds: 9.5 }),
      docWith({ fps: 60 }),
      docWith({ schema: 'lixxon.video-template.v2' }),
      docWith({ name: '' }),
      docWith({ movement: { ...DEFAULT_DOCUMENT.movement, zoom_max: 1.9 } }),
      docWith({ movement: { ...DEFAULT_DOCUMENT.movement, pan_x: -0.2 } }),
      docWith({ movement: { ...DEFAULT_DOCUMENT.movement, zoom_step: 0.5 } }),
      docWith({ title: { ...DEFAULT_DOCUMENT.title, font_size: 6 } }),
      docWith({ title: { ...DEFAULT_DOCUMENT.title, color: 'red' } }),
      docWith({ title: { ...DEFAULT_DOCUMENT.title, color: '0xFFF;drawtext=evil' } }),
      docWith({ title: { ...DEFAULT_DOCUMENT.title, seconds: 12 } }),
      docWith({ caption: { ...DEFAULT_DOCUMENT.caption, max_characters_per_line: 4 } }),
      docWith({ caption: { ...DEFAULT_DOCUMENT.caption, box_top: 2500 } }),
      docWith({ caption: { ...DEFAULT_DOCUMENT.caption, color: '#FFFFFF' } }),
      docWith({ end_card: { ...DEFAULT_DOCUMENT.end_card, text: '' } }),
      docWith({ end_card: { ...DEFAULT_DOCUMENT.end_card, text: 'x'.repeat(201) } }),
      docWith({ watermark: { ...DEFAULT_DOCUMENT.watermark, text: 'bad\ncontrol' } }),
      docWith({ watermark: { ...DEFAULT_DOCUMENT.watermark, font_size: 100 } }),
    ];
    for (const candidate of cases) {
      let rendererRefused = false;
      try { validateVideoTemplate(candidate); } catch { rendererRefused = true; }
      expect(rendererRefused, `renderer accepted ${JSON.stringify(candidate).slice(0, 80)}`).toBe(true);
      expect(parseVideoTemplateDocument(candidate), `panel accepted ${JSON.stringify(candidate).slice(0, 80)}`).toBeNull();
    }
  });

  it('requires a future document to drop unknown fields rather than silently ignoring them', () => {
    expect(parseVideoTemplateDocument(docWith({ prose: 'never' }))).not.toBeNull();
    // The panel parser is deliberately permissive about *extra* keys — the database RPC is
    // the authority that refuses them (see scripts/video-template-assertions.sql) — but it
    // must still refuse anything that would change how a render behaves.
    let rendererRefused = false;
    try { validateVideoTemplate(docWith({ prose: 'never' })); } catch { rendererRefused = true; }
    expect(rendererRefused).toBe(true);
  });

  it('parses the template list the RPC returns and refuses a malformed one', () => {
    const list = parseVideoTemplates({
      active_id: '11111111-2222-3333-4444-555555555555',
      templates: [
        { id: '11111111-2222-3333-4444-555555555555', name: 'Lagos daylight (default)', is_active: true, duration_seconds: 12, fps: 30, music: 'none', created_at: '2026-10-06T20:00:00.000Z' },
      ],
      active_document: DEFAULT_DOCUMENT,
    });
    expect(list?.activeId).toBe('11111111-2222-3333-4444-555555555555');
    expect(list?.templates).toHaveLength(1);
    expect(list?.activeDocument?.duration_seconds).toBe(12);

    expect(parseVideoTemplates(null)).toBeNull();
    expect(parseVideoTemplates({ templates: 'nope' })).toBeNull();
    expect(parseVideoTemplates({ templates: [{ id: 1, name: 'x', is_active: true }] })).toBeNull();
    expect(parseVideoTemplates({ templates: [{ id: 'a', name: 'x', is_active: true, duration_seconds: 12, fps: 30, music: 'loud' }] })).toBeNull();
    expect(parseVideoTemplates({ active_id: 'x', templates: [], active_document: { ...DEFAULT_DOCUMENT, music: 'loud' } })?.activeDocument).toBeNull();
  });
});
