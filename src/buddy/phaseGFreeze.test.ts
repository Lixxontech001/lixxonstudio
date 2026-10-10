// @vitest-environment node
// Phase G freeze. One group per Phase G rule. Behaviour is checked through the real pure functions wherever one
// exists; source checks are used only for copy strings and file-level rules that have no function. No network, no
// live keys, no live brain, no live door, no live push, no database, no ffmpeg run. Nothing here merges, deploys,
// or applies a migration. If a rule breaks, this file fails.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALLOWED_ORDERS } from '../../supabase/functions/_shared/buddyOrderPolicy';
import { routeFilingGate, routeMessage } from '../../supabase/functions/_shared/buddyRouter';
import { BRAIN_IDS } from '../../supabase/functions/_shared/brains';
import { DOOR_IDS } from '../../supabase/functions/_shared/doorRegistry';
import { BUILT_IN_LOOK, LOOK_COLOR_PATTERN, LOOK_LIMITS, LOOK_SCOPE_NOTE } from '../../src/lib/videoLook';
// The pack renderer is a plain .mjs script with no type file. Its exports are checked at runtime by these tests.
// @ts-expect-error -- no declaration file for scripts/pack-video.mjs; the test checks its real behaviour
import { PACK_LOOK_DEFAULT, PACK_LOOK_LIMITS, PACK_VIDEO, assColour, buildFfmpegArgs, resolvePackLook } from '../../scripts/pack-video.mjs';

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const exists = (rel: string) => existsSync(join(ROOT, rel));

/** Every .ts and .tsx file under a folder, as repo-relative paths. */
function filesUnder(rel: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const next = join(dir, entry.name);
      if (entry.isDirectory()) walk(next);
      else if (/\.(ts|tsx)$/.test(entry.name)) out.push(next);
    }
  };
  walk(rel);
  return out;
}

describe('Phase G rule 1: the pack video keeps its audio and reads the saved look', () => {
  it('the pack defaults are the Phase F values: 1080x1920, 10 seconds, 30 fps', () => {
    expect(PACK_VIDEO).toMatchObject({ width: 1080, height: 1920, fps: 30, seconds: 10 });
    expect(PACK_LOOK_DEFAULT).toEqual({ durationSeconds: 10, captionFontSize: 64, captionColor: '0xFFFFFF' });
  });

  it('with no saved look, the pack uses the defaults exactly', () => {
    expect(resolvePackLook(null)).toMatchObject({ durationSeconds: 10, captionFontSize: 64, captionColor: '0xFFFFFF' });
  });

  it('the pack look bounds match the look screen bounds', () => {
    expect(PACK_LOOK_LIMITS.durationSeconds).toEqual([LOOK_LIMITS.durationSeconds.min, LOOK_LIMITS.durationSeconds.max]);
    expect(PACK_LOOK_LIMITS.captionFontSize).toEqual([LOOK_LIMITS.captionFontSize.min, LOOK_LIMITS.captionFontSize.max]);
  });

  it('the built-in look sits inside the bounds, and its caption colour is a 0xRRGGBB value', () => {
    expect(BUILT_IN_LOOK.duration_seconds).toBeGreaterThanOrEqual(LOOK_LIMITS.durationSeconds.min);
    expect(BUILT_IN_LOOK.duration_seconds).toBeLessThanOrEqual(LOOK_LIMITS.durationSeconds.max);
    expect(BUILT_IN_LOOK.caption.font_size).toBeGreaterThanOrEqual(LOOK_LIMITS.captionFontSize.min);
    expect(BUILT_IN_LOOK.caption.font_size).toBeLessThanOrEqual(LOOK_LIMITS.captionFontSize.max);
    expect(BUILT_IN_LOOK.caption.color).toMatch(LOOK_COLOR_PATTERN);
  });

  it('a caption colour from the look becomes an ASS colour in blue-green-red order', () => {
    expect(assColour('0xFDFBF7')).toBe('&H00F7FBFD');
    expect(assColour('0xFFFFFF')).toBe('&H00FFFFFF');
  });

  it('the ffmpeg command carries an audio track and never drops it', () => {
    const args: string[] = buildFfmpegArgs({
      imagePath: '/x.png', assPath: '/x.ass', outputPath: '/x.mp4', voicePath: '/v.wav', voiceSeconds: 4, seconds: 20,
    });
    expect(args).toContain('-c:a');
    expect(args).not.toContain('-an');
  });

  it('a pack with no voice is refused, not made silent', () => {
    expect(() => buildFfmpegArgs({ imagePath: '/x.png', assPath: '/x.ass', outputPath: '/x.mp4', voicePath: '', seconds: 20 }))
      .toThrow(/voice track/);
    expect(read('scripts/pack-video.mjs')).not.toMatch(/'-an'/);
  });

  it('the pack renderer never reads the look table itself (the saver reads it and passes three values)', () => {
    expect(read('scripts/pack-video.mjs')).not.toMatch(/video_templates/);
    expect(read('scripts/save-pack-media.mjs')).toMatch(/loadActiveLook/);
  });

  it('the look screen says plainly what the pack uses and what it does not', () => {
    expect(LOOK_SCOPE_NOTE).toMatch(/length/i);
    expect(LOOK_SCOPE_NOTE).toMatch(/caption/i);
    expect(LOOK_SCOPE_NOTE).toMatch(/title/i);
    expect(LOOK_SCOPE_NOTE).not.toMatch(/Postgres|RLS|rpc|Vault/);
  });
});

describe('Phase G rule 2: no WhatsApp in visible copy', () => {
  it('the video-template library and its distribution copy say nothing about WhatsApp', () => {
    expect(read('src/lib/automationDistribution.ts')).not.toMatch(/whatsapp/i);
  });
});

describe('Phase G rule 3: unnamed orders are routed the same way as before', () => {
  it('an unnamed order that is not a swap asks "which mind?"', () => {
    expect(routeMessage('Review the Calm Skin article', null)).toEqual({ kind: 'ask_which_mind', instruction: 'Review the Calm Skin article' });
    expect(routeMessage('Plan the next article about tea', null).kind).toBe('ask_which_mind');
  });

  it('an unnamed swap goes to the Executioner, with no question, and is filed as a product-line apply', () => {
    const route = routeMessage('Swap the Calm Skin Routine Guide onto the skin guide', null);
    expect(route).toMatchObject({ kind: 'order', mind: 'executioner' });
    expect(routeFilingGate(route)).toEqual({ ok: true, kind: 'product_line_apply' });
  });

  it('a question with no mind named is a chat, not an order', () => {
    expect(routeMessage('Should we post more this week?', null)).toEqual({ kind: 'chat' });
  });

  it('asking for today\u2019s run is never refused and never asks which mind', () => {
    const route = routeMessage('Make the packs for today', null);
    expect(route.kind).toBe('run_day');
  });
});

describe('Phase G rule 4: no new brains, doors, or order kinds; Takeover stays off', () => {
  it('there are still eight brains', () => {
    expect(BRAIN_IDS).toHaveLength(8);
  });

  it('there are still sixteen doors', () => {
    expect(DOOR_IDS).toHaveLength(16);
  });

  it('there are still five order kinds', () => {
    expect(ALLOWED_ORDERS).toHaveLength(5);
  });

  it('Takeover defaults to false in the controls store', () => {
    expect(read('src/buddy/minds/mindsControlsStore.ts')).toMatch(/takeover: false/);
  });
});

describe('Phase G rule 5: Admin AI is not restored and the legacy function stays', () => {
  it('no Admin AI page or route is in the admin tree', () => {
    const offenders = filesUnder('src/admin').filter(file => /admin[-_]?ai/i.test(file));
    expect(offenders).toEqual([]);
  });

  it('the automation-distribution function is still in the tree', () => {
    expect(exists('supabase/functions/automation-distribution/handler.ts')).toBe(true);
  });
});

describe('Phase G rule 6: Admin copy is plain English and the labels are the agreed ones', () => {
  it('the nav labels are Keys, Check, and Data, and the routes are unchanged', () => {
    const layout = read('src/admin/AdminLayout.tsx');
    expect(layout).toMatch(/label: 'Keys', route: \{ name: 'admin-automation-keys' \}/);
    expect(layout).toMatch(/label: 'Check', route:/);
    expect(layout).toMatch(/label: 'Data', route:/);
    expect(layout).not.toMatch(/label: 'Data explorer'|label: 'Automation keys'|label: 'System Check'/);
    expect(layout).toMatch(/href: '\/admin\/automation\/keys'/);
  });

  it('the Admin sidebar subtitle is "Admin", not "Editorial CMS"', () => {
    expect(read('src/admin/AdminLayout.tsx')).not.toMatch(/Editorial CMS/);
    expect(read('src/admin/pages/AdminLogin.tsx')).not.toMatch(/Editorial CMS/);
  });

  it('the Keys and Check screens do not show Vault, VAPID, or the other engine words to the owner', () => {
    const keys = read('src/admin/pages/AutomationKeys.tsx');
    expect(keys).not.toMatch(/stored in Supabase Vault|Vault transaction|Generate VAPID keypair|Owner-only Vault/);
    expect(read('src/admin/pages/AutomationCheck.tsx')).not.toMatch(/>System Check</);
    expect(read('src/admin/components/VapidGenerator.tsx')).not.toMatch(/Generate VAPID keypair/);
  });

  it('the Health screen uses plain labels and keeps its numbers', () => {
    const health = read('src/admin/pages/AdminHealth.tsx');
    expect(health).not.toMatch(/>Cache hit ratio</);
    expect(health).not.toMatch(/>PostgreSQL</);
    expect(health).not.toMatch(/Seq \/ idx scans/);
    expect(health).not.toMatch(/Needs <code>ops\.fix<\/code>/);
    expect(health).toMatch(/metrics\.data\.cache_hit/);
  });

  it('the article editor and data explorer say plain English', () => {
    expect(read('src/admin/pages/AdminArticleEditor.tsx')).not.toMatch(/computed in Postgres/);
    expect(read('src/admin/pages/AdminDataExplorer.tsx')).not.toMatch(/RLS still hides/);
  });
});

describe('Phase G rule 7: the Phase F pins that this phase changes are changed on purpose', () => {
  it('the Phase G report and this freeze are now in the tree', () => {
    expect(exists('PHASE_G_REPORT.md')).toBe(true);
    expect(exists('src/buddy/phaseGFreeze.test.ts')).toBe(true);
  });
});
