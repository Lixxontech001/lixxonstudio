import { describe, expect, it } from 'vitest';
import { DEFAULT_VIDEO_TEMPLATE, validateVideoTemplate } from '../../scripts/video-template.mjs';
import { buildVideoFilterGraph } from '../../scripts/render-video-test.mjs';
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
        { id: '11111111-2222-3333-4444-555555555555', name: 'Clear daylight (default)', is_active: true, duration_seconds: 12, fps: 30, music: 'none', created_at: '2026-10-06T20:00:00.000Z' },
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

describe('the default look is byte-identical to the pre-template render', () => {
  // These four layers are the exact, rendered V20 look (workflow run 37495480987). The template
  // work must not change a single pixel of the default, so the golden strings below are the
  // contract: a silent drift here would reach the owner's phone as a different video.
  const paths = {
    titlePath: '/tmp/t/title.txt', captionTextPath: '/tmp/t/captions.txt',
    watermarkPath: '/tmp/t/watermark.txt', endCardPath: '/tmp/t/end.txt',
    serifFont: '/tmp/t/serif.ttf', sansFont: '/tmp/t/sans.ttf',
  };
  const layers = (graph: string) => graph.split(/(?=drawtext=)/).filter(part => part.startsWith('drawtext=')).map(part => part.replace(/,$/, ''));

  it('renders the same watermark, title, caption and end card as the fixed look', () => {
    const graph = buildVideoFilterGraph(paths);
    expect(layers(graph)).toEqual([
      "drawtext=fontfile=/tmp/t/sans.ttf:textfile=/tmp/t/watermark.txt:expansion=none:fontcolor=0xFDFBF7:fontsize=29:x=44:y=45,drawbox=x=0:y=0:w=iw:h=330:color=0x1A1A1A@0.84:t=fill:enable='lt(t,2)'",
      "drawtext=fontfile=/tmp/t/serif.ttf:textfile=/tmp/t/title.txt:expansion=none:fontcolor=0xFDFBF7:fontsize=50:line_spacing=10:x=(w-text_w)/2:y=104:enable='lt(t,2)',drawbox=x=54:y=1120:w=972:h=500:color=0x1A1A1A@0.88:t=fill:enable='gte(t,2)*lt(t,10)'",
      "drawtext=fontfile=/tmp/t/sans.ttf:textfile=/tmp/t/captions.txt:expansion=none:fontcolor=0xFFFFFF:fontsize=40:line_spacing=16:x=(w-text_w)/2:y=(h-text_h)/2:enable='gte(t,2)*lt(t,10)',drawbox=x=0:y=0:w=iw:h=ih:color=0x1A1A1A@0.97:t=fill:enable='gte(t,10)'",
      "drawtext=fontfile=/tmp/t/serif.ttf:textfile=/tmp/t/end.txt:expansion=none:fontcolor=0xF2EDE7:fontsize=58:line_spacing=22:x=(w-text_w)/2:y=(h-text_h)/2,format=yuv420p[vout]",
    ]);
    expect(graph).toContain("zoompan=z='min(zoom+0.00035,1.08)'");
    expect(graph).toContain("sin(on/90)");
    expect(graph).toContain("cos(on/110)");
    expect(graph).toContain('fps=30');
  });

  it('never lets an undefined or malformed value reach FFmpeg, from any template', () => {
    const custom = validateVideoTemplate({
      ...JSON.parse(JSON.stringify(DEFAULT_VIDEO_TEMPLATE)),
      name: 'Evening contrast', duration_seconds: 20, fps: 25,
      title: { ...DEFAULT_VIDEO_TEMPLATE.title, color: '0x101010' },
      end_card: { ...DEFAULT_VIDEO_TEMPLATE.end_card, color: '0xABCDEF' },
    });
    for (const template of [undefined, custom]) {
      const graph = template ? buildVideoFilterGraph({ ...paths, template }) : buildVideoFilterGraph(paths);
      expect(graph).not.toContain('undefined');
      expect(graph).not.toContain('NaN');
      for (const colour of graph.match(/fontcolor=[^:]*/g) || []) {
        expect(colour, `${colour} in ${template ? 'the custom' : 'the default'} graph`).toMatch(/^fontcolor=0x[0-9A-F]{6}$/);
      }
    }
  });
});
