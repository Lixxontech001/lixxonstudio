// @vitest-environment node
// Phase E freeze, one group per slice of the Phase E spec. Source and fixture checks only: no network, no live keys,
// no live brain, no live door, no live push, no database. Nothing here merges, deploys, or applies a migration.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALLOWED_ORDERS, MODEL_FILEABLE_ORDER, refusedRequest } from '../../supabase/functions/_shared/buddyOrderPolicy';
import { tryableBrains } from '../../supabase/functions/_shared/brains';
import { LOOK_NOT_USED_YET } from '../lib/videoLook';

const ROOT = process.cwd();
const read = (file: string) => readFileSync(join(ROOT, file), 'utf8');
const migrationNamed = (suffix: string) => readdirSync(join(ROOT, 'supabase/migrations')).find((file) => file.endsWith(suffix));

describe('Phase E freeze, slice 1: the owner push has a server path that covers closed tabs', () => {
  it('the night clock flushes unpushed notables before it runs the night clock', () => {
    const night = read('supabase/functions/buddy-night-clock/index.ts');
    expect(night.indexOf('flushUnpushedNotables(servicePushPorts(sb))')).toBeGreaterThan(-1);
    expect(night.indexOf('flushUnpushedNotables(servicePushPorts(sb))')).toBeLessThan(night.indexOf('runNightClock(sb, new Date())'));
  });

  it('the day run flushes for the caller before it reads Takeover', () => {
    const run = read('supabase/functions/minds-run-placement/index.ts');
    const flush = run.indexOf('flushUnpushedNotables(servicePushPorts(sb), Date.now(), owner)');
    const takeover = run.indexOf('const takeover = asRecord(controlsRow.data)?.takeover === true;');
    expect(flush).toBeGreaterThan(-1);
    expect(takeover).toBeGreaterThan(flush);
  });

  it('there is one attempt path, and every push goes through it', () => {
    const server = read('supabase/functions/_shared/notablePushServer.ts');
    expect(server).toMatch(/export async function attemptRow\(/);
    expect(server.match(/attemptRow\(row, ports/g)?.length).toBeGreaterThanOrEqual(2);
    expect(read('supabase/functions/minds-run-placement/index.ts')).toContain('return await attemptRow(row, servicePushPorts(sb));');
  });

  it('the browser path stays, as best effort, and is not the only path', () => {
    expect(read('supabase/functions/minds-control-notify/index.ts')).toContain('pushNewestNotable(kind, ownerNotablePorts(sb, user.id))');
    expect(read('supabase/functions/buddy-night-clock/index.ts')).toContain('flushUnpushedNotables(servicePushPorts(sb))');
  });

  it('a row already marked sent is never pushed again, and the flush also checks it', () => {
    const server = read('supabase/functions/_shared/notablePushServer.ts');
    expect(server).toMatch(/if \(row\.pushNote === "sent"\) continue;/);
    expect(server).toMatch(/if \(row\.pushNote !== null && !RETRYABLE_NOTES\.includes\(row\.pushNote\)\) continue;/);
  });

  it('a claim is written before the send, and a fresh pending claim is skipped', () => {
    const server = read('supabase/functions/_shared/notablePushServer.ts');
    expect(server).toMatch(/update\(\{ push_note: "pending", push_claimed_at: nowIso \}\)/);
    expect(server).toMatch(/row\.pushNote === "pending" && row\.claimedAt !== null && Date\.parse\(row\.claimedAt\) > nowMs - PENDING_STALE_MS\) continue;/);
  });

  it('the windows are the agreed ones: 120 s notice, 3 days retry, 10 min stale pending', () => {
    const server = read('supabase/functions/_shared/notablePushServer.ts');
    expect(server).toContain('export const NOTICE_WINDOW_MS = 120_000;');
    expect(server).toContain('export const RETRY_WINDOW_MS = 3 * 24 * 3_600_000;');
    expect(server).toContain('export const PENDING_STALE_MS = 10 * 60_000;');
  });

  it('the pending migration exists, adds the pending note and claim time, and is not applied', () => {
    const name = migrationNamed('_push_note_pending.sql');
    expect(name).toBeTruthy();
    const sql = read(`supabase/migrations/${name}`);
    expect(sql).toContain("'pending'");
    expect(sql).toContain('push_claimed_at');
    expect(sql).toContain('NOT applied to production');
  });

  it('until that migration is applied, the adapter reads no claim column, so pushes that work today still work', () => {
    const server = read('supabase/functions/_shared/notablePushServer.ts');
    const columns = server.match(/const ROW_COLUMNS = "([^"]+)";/);
    expect(columns?.[1]).not.toContain('push_claimed_at');
    expect(server).toContain('select("id,push_claimed_at")');
  });
});

describe('Phase E freeze, slice 2: a swap with no mind named goes to Executioner', () => {
  it('an unnamed imperative swap routes to the Executioner, with no "Which mind?" prompt', () => {
    const router = read('supabase/functions/_shared/buddyRouter.ts');
    expect(router).toMatch(/return \{ kind: "order", mind: "executioner", instruction: cleanInstruction\(text\), resolvesPending: false \};/);
  });

  it('a non-swap unnamed order still asks which mind (open decision, see the report)', () => {
    expect(read('supabase/functions/_shared/buddyRouter.ts')).toContain('Which mind should take this');
  });

  it('a question is never filed, and a refusal clause covers "and", "then", a comma and a semicolon', () => {
    const policy = read('supabase/functions/_shared/buddyOrderPolicy.ts');
    expect(policy).toMatch(/const REQUEST_CLAUSE = \/\(\\band\\b\|\\bthen\\b\|\[,;\]\)/);
  });

  it('the closed list is still the five kinds, and a model may file only mind_work', () => {
    expect([...ALLOWED_ORDERS]).toEqual(['run_today', 'pause_resume_free_door', 'kill_or_start_mind', 'product_line_apply', 'mind_work']);
    expect(MODEL_FILEABLE_ORDER).toBe('mind_work');
  });

  it('the open narrow spot is pinned and recorded: "Delete the old one" on its own is not refused', () => {
    // Known gap. The delete pattern needs a listed object noun (article, post, page, comment...). If this changes, update PHASE_E_REPORT.md.
    expect(refusedRequest('Delete the old one')).toBe(false);
    expect(read('PHASE_E_REPORT.md')).toMatch(/Delete the old one/);
  });
});

describe('Phase E freeze, slice 3: a failed or empty living-mind day may retry, a done row does not', () => {
  it('a mind with a done row today is skipped', () => {
    expect(read('supabase/functions/_shared/buddyLivingMinds.ts')).toContain('if (context.doneToday?.includes(mind)) continue;');
  });

  it('a killed mind with a stopped row today is skipped, and a killed mind without one is not', () => {
    expect(read('supabase/functions/_shared/buddyLivingMinds.ts')).toContain('if (isKilled(context.killScope, mind) && context.stoppedToday?.includes(mind)) continue;');
  });

  it('the day run reads per-mind done and stopped rows for today', () => {
    const run = read('supabase/functions/minds-run-placement/index.ts');
    expect(run).toMatch(/select\("mind,action,outcome"\)/);
    expect(run).toMatch(/doneToday/);
    expect(run).toMatch(/stoppedToday/);
  });
});

describe('Phase E freeze, slice 4: the Video look screen is small, saved, and not read by the daily video', () => {
  it('the look screen says the daily video does not use the saved look yet, under the heading', () => {
    expect(LOOK_NOT_USED_YET).toMatch(/does not use this look yet/);
    expect(read('src/admin/pages/AutomationVideoLook.tsx')).toContain('LOOK_NOT_USED_YET');
  });

  it('saving goes through the template RPC with activate, and reads through the template table', () => {
    const page = read('src/admin/pages/AutomationVideoLook.tsx');
    expect(page).toContain('automation_save_video_template');
    expect(page).toContain('p_activate: true');
    expect(page).toContain('automation_video_templates');
  });

  it('the daily video and its test render do not read the saved look (the test render takes only dispatch input)', () => {
    expect(read('scripts/pack-video.mjs')).not.toMatch(/automation_video_templates|automation_save_video_template/);
    expect(read('.github/workflows/video-render-test.yml')).not.toMatch(/automation_video_templates|automation_save_video_template/);
  });

  it('the new screen has no Nigeria, Naira or Lagos on it', () => {
    const screen = read('src/admin/pages/AutomationVideoLook.tsx');
    expect(screen).not.toMatch(/Nigeria|Naira|Lagos/);
  });

  it('the look is three bounded values, and the look is built-in by default with a parity test', () => {
    expect(read('src/lib/videoLook.ts')).toContain('BUILT_IN_LOOK');
    expect(read('src/__tests__/videoLook.test.ts')).toMatch(/BUILT_IN_LOOK/);
  });
});

describe('Phase E freeze, slice 5: carts and dead costume', () => {
  it('the carts policy migration is a new file that drops both old update policies and is not applied', () => {
    const name = migrationNamed('_abandoned_carts_no_anon_update.sql');
    expect(name).toBeTruthy();
    const sql = read(`supabase/migrations/${name}`);
    expect(sql).toContain('DROP POLICY IF EXISTS abandoned_carts_anon_update');
    expect(sql).toContain('DROP POLICY IF EXISTS "rl_ac_update"');
    expect(sql).not.toMatch(/CREATE POLICY/i);
    expect(sql).toContain('NOT applied to production');
  });

  it('the old Admin AI and Distribution pages are gone', () => {
    expect(existsSync(join(ROOT, 'src/admin/pages/AdminAI.tsx'))).toBe(false);
    expect(existsSync(join(ROOT, 'src/admin/pages/AutomationDistribution.tsx'))).toBe(false);
  });
});

describe('Phase E freeze, the whole phase: nothing reopened', () => {
  it('no new brain vendor, and the chain is still the six agreed brains (Cerebras and DeepSeek skipped)', () => {
    expect(tryableBrains().map((slot) => slot.id)).toEqual(['gemini', 'groq', 'nvidia', 'cloudflare', 'openrouter', 'huggingface']);
  });

  it('no WhatsApp door, no Feedly, X or 21st door was added', () => {
    const files = readdirSync(join(ROOT, 'supabase/functions/_shared')).join('\n');
    expect(files).not.toMatch(/whatsapp|feedly|21st/i);
  });

  it('Phase F is not started: no Phase F report or freeze file exists', () => {
    expect(existsSync(join(ROOT, 'PHASE_F_REPORT.md'))).toBe(false);
    expect(existsSync(join(ROOT, 'src/buddy/phaseFFreeze.test.ts'))).toBe(false);
  });

  it('the phase report exists at the repo root', () => {
    expect(existsSync(join(ROOT, 'PHASE_E_REPORT.md'))).toBe(true);
  });
});
