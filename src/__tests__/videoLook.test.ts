import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_VIDEO_TEMPLATE } from '../../scripts/video-template.mjs';
import { ROUTE_PERMISSIONS } from '../admin/permissions';
import { parseVideoTemplateDocument } from '../lib/automationDistribution';
import { BUILT_IN_LOOK, LOOK_NOT_USED_YET, applyLookEdits, lookSummary } from '../lib/videoLook';
import { resolveAutomationAdminRoute } from '../admin/automationRoutes';

// Phase E slice 4: the Video look. Three bounded values, saved through the existing template save call.
// Fake data only. No render, no network, no database.

const read = (path: string) => readFileSync(resolve(__dirname, '../..', path), 'utf8');
const GOOD = { durationSeconds: '12', captionFontSize: '40', captionColor: '0xFFFFFF' };

describe('the built-in look is the renderer default', () => {
  it('the built-in look passes the same parser the database and the renderer use', () => {
    expect(parseVideoTemplateDocument(BUILT_IN_LOOK)).not.toBeNull();
  });

  it('it matches DEFAULT_VIDEO_TEMPLATE in scripts/video-template.mjs, value for value', () => {
    expect(BUILT_IN_LOOK).toEqual(JSON.parse(JSON.stringify(DEFAULT_VIDEO_TEMPLATE)));
  });
});

describe('applyLookEdits: the three values, bounded', () => {
  it('good values are accepted, and the checked document carries them', () => {
    const result = applyLookEdits(BUILT_IN_LOOK, { durationSeconds: '20', captionFontSize: '48', captionColor: '0x112233' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.document.duration_seconds).toBe(20);
      expect(result.document.caption.font_size).toBe(48);
      expect(result.document.caption.color).toBe('0x112233');
    }
  });

  it('spaces around a number are trimmed, and the same look is kept', () => {
    const result = applyLookEdits(BUILT_IN_LOOK, { durationSeconds: ' 12 ', captionFontSize: ' 40', captionColor: ' 0xFFFFFF ' });
    expect(result.ok).toBe(true);
  });

  it('the length must be a whole number from 8 to 60', () => {
    for (const bad of ['7', '61', '12.5', '-3', 'twelve', '', '1e1']) {
      const result = applyLookEdits(BUILT_IN_LOOK, { ...GOOD, durationSeconds: bad });
      expect(result.ok, bad).toBe(false);
      if (!result.ok) expect(result.problems.join(' ')).toMatch(/Length must be a whole number of seconds from 8 to 60/);
    }
    expect(applyLookEdits(BUILT_IN_LOOK, { ...GOOD, durationSeconds: '8' }).ok).toBe(true);
    expect(applyLookEdits(BUILT_IN_LOOK, { ...GOOD, durationSeconds: '60' }).ok).toBe(true);
  });

  it('the caption size must be a whole number from 24 to 72', () => {
    for (const bad of ['23', '73', '40.5', 'big']) {
      const result = applyLookEdits(BUILT_IN_LOOK, { ...GOOD, captionFontSize: bad });
      expect(result.ok, bad).toBe(false);
    }
  });

  it('the caption colour must be 0x followed by six hex digits', () => {
    for (const bad of ['FFFFFF', '0xFFFFF', '0xGGGGGG', '#FFFFFF', '0xFFFFFFF', '']) {
      const result = applyLookEdits(BUILT_IN_LOOK, { ...GOOD, captionColor: bad });
      expect(result.ok, bad).toBe(false);
    }
  });

  it('a refused look says what to fix and returns no document', () => {
    const result = applyLookEdits(BUILT_IN_LOOK, { durationSeconds: '99', captionFontSize: '10', captionColor: 'red' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems).toHaveLength(3);
  });
});

describe('applyLookEdits: nothing else in the look changes', () => {
  it('the name, title, movement, end card, watermark and music are copied as they are', () => {
    const result = applyLookEdits(BUILT_IN_LOOK, { durationSeconds: '30', captionFontSize: '44', captionColor: '0xABCDEF' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.name).toBe(BUILT_IN_LOOK.name);
    expect(result.document.title).toEqual(BUILT_IN_LOOK.title);
    expect(result.document.movement).toEqual(BUILT_IN_LOOK.movement);
    expect(result.document.end_card).toEqual(BUILT_IN_LOOK.end_card);
    expect(result.document.watermark).toEqual(BUILT_IN_LOOK.watermark);
    expect(result.document.music).toBe('none');
    expect(result.document.fps).toBe(BUILT_IN_LOOK.fps);
    expect(result.document.caption.max_lines).toBe(BUILT_IN_LOOK.caption.max_lines);
  });
});

describe('the screen wording', () => {
  it('the summary shows plain words and no internal names', () => {
    const lines = lookSummary(BUILT_IN_LOOK);
    expect(lines.map((line) => line.label)).toEqual(['Name', 'Length', 'Frame rate', 'Caption size', 'Caption colour', 'Music']);
    expect(lines.find((line) => line.label === 'Length')?.value).toBe('12 seconds');
  });

  it('after a save the screen says the daily video does not use the look yet', () => {
    expect(LOOK_NOT_USED_YET).toMatch(/does not use this look yet/);
  });

  it('no Nigeria, Naira or Lagos on the new screen or in the look helper', () => {
    for (const path of ['src/admin/pages/AutomationVideoLook.tsx', 'src/lib/videoLook.ts']) {
      expect(read(path)).not.toMatch(/nigeria|naira|lagos/i);
    }
  });
});

describe('the page calls the existing template calls, and shows no raw error text', () => {
  const page = read('src/admin/pages/AutomationVideoLook.tsx');

  it('reads the list and saves with the existing RPCs, activating the saved look', () => {
    expect(page).toContain("supabase.rpc('automation_video_templates')");
    expect(page).toContain("supabase.rpc('automation_save_video_template', { p_document: result.document, p_activate: true })");
  });

  it('saves only a document the helper has checked', () => {
    expect(page).toMatch(/const result = applyLookEdits\(base, edits\);\s*if \(!result\.ok\) \{/);
  });

  it('a failed read or save shows a plain sentence, never the error message', () => {
    expect(page).toContain('Could not save this look. Nothing changed.');
    expect(page).toContain('The saved look could not be read. Nothing was changed.');
    expect(page).not.toMatch(/error\.message|rpcError\.message|\{error\}/);
  });
});

describe('the route, its permission and its link', () => {
  it('the path resolves to the new route', () => {
    expect(resolveAutomationAdminRoute('/admin/automation/video-look')).toBe('admin-automation-video-look');
  });

  it('the route needs the same permission as the other automation checks', () => {
    expect(ROUTE_PERMISSIONS['admin-automation-video-look']).toBe('automation.check');
  });

  it('the app lazy-loads the page and the admin layout links to it', () => {
    expect(read('src/admin/AdminApp.tsx')).toContain("import('./pages/AutomationVideoLook')");
    expect(read('src/admin/AdminLayout.tsx')).toContain("route: { name: 'admin-automation-video-look' }");
  });
});
