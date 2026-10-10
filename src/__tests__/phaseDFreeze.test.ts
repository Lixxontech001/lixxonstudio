// @vitest-environment node
// Phase D freeze. Source checks only: no network, no live keys, no live brain, no live push.
// Nothing here merges, deploys, or applies a migration.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALLOWED_ORDERS, MODEL_FILEABLE_ORDER, REFUSAL_LINE } from '../../supabase/functions/_shared/buddyOrderPolicy';
import { NOT_OFFERED_KEY_NAMES } from '../../supabase/functions/_shared/notOfferedKeys';
import { NO_KEY_ACTION, NO_KEY_DETAIL } from '../../src/buddy/minds/mindGuards';
import { BUZZ_KINDS } from '../../supabase/functions/_shared/notablePush';

const ROOT = process.cwd();
const read = (file: string) => readFileSync(join(ROOT, file), 'utf8');

describe('Phase D freeze 1: the probe walks the brain chain', () => {
  const think = read('supabase/functions/_shared/buddyThink.ts');

  it('the probe checks any saved brain through the chain, not Gemini alone', () => {
    expect(think).toMatch(/const answer = await askBrains\(\{ system: BUDDY_SYSTEM_INSTRUCTION/);
    expect(think).toMatch(/if \(!\(await anyBrainSaved\(ports\)\)\)/);
  });

  it('only a Gemini answer writes the stored Google status', () => {
    expect(think).toMatch(/const probedGoogle = answer\.ok \? answer\.brain === "gemini"/);
    expect(think).toMatch(/if \(probedGoogle && answer\.lastOutcome !== "unreadable" && answer\.lastOutcome !== "none_saved"\)/);
  });
});

describe('Phase D freeze 2: model-filed orders are checked against the closed list', () => {
  it('the closed list is still the five kinds, and a model may file only mind_work', () => {
    expect([...ALLOWED_ORDERS]).toEqual(['run_today', 'pause_resume_free_door', 'kill_or_start_mind', 'product_line_apply', 'mind_work']);
    expect(MODEL_FILEABLE_ORDER).toBe('mind_work');
  });

  it('the chat path gates every model order through the closed list, with the one refusal line', () => {
    const think = read('supabase/functions/_shared/buddyThink.ts');
    expect(think).toContain('gateModelOrder(answer.order.kind, answer.order.instruction)');
    expect(think).toContain('if (modelGate.line) reply = modelGate.line;');
    expect(think).not.toContain('NOT_ON_LIST_LINE');
    expect(REFUSAL_LINE).toMatch(/Nothing was filed or changed/);
  });
});

describe('Phase D freeze 3: notifications fire from the day run', () => {
  const run = read('supabase/functions/minds-run-placement/index.ts');
  const push = read('supabase/functions/_shared/notablePush.ts');

  it('a gone device is revoked through the record function, never by a direct update', () => {
    expect(run).toContain('sb.rpc("push_record_delivery", { p_id: target.id, p_status: "expired" })');
    expect(run).not.toMatch(/from\("push_device_subscriptions"\)\s*\.update\(\{\s*enabled: false/);
  });

  it('a delivered push is recorded as sent, and a failed status write cannot stop the send', () => {
    expect(run).toContain('p_status: "sent"');
    expect(push).toMatch(/await deps\.markSent\?\.\(target\);\s*\} catch/);
  });

  it('the buzz list is unchanged', () => {
    expect(BUZZ_KINDS).toContain('door_posted');
    expect(BUZZ_KINDS).toContain('auditor_blocked');
  });

  it('the placement step returns a held outcome on a site-read failure, never reply(req) without req', () => {
    const fn = run.slice(run.indexOf('async function runAgainstSite('), run.indexOf('/**', run.indexOf('async function runAgainstSite(') + 10));
    expect(fn).toContain('return { status: "held", detail: "Site reads failed. Nothing changed." };');
    expect(fn).not.toMatch(/reply\(req/);
  });
});

describe('Phase D freeze 4: the minds walk the brain chain, and the wording is brain-neutral', () => {
  it('the minds think door takes a secret reader and walks askBrains', () => {
    const mindThink = read('supabase/functions/_shared/mindThink.ts');
    expect(mindThink).toMatch(/makeMindThink\(\s*readSecret: \(secretName: string\)/);
    expect(mindThink).toContain('await askBrains(');
  });

  it('the no-key line names a brain, not Google', () => {
    expect(NO_KEY_ACTION).toBe('Cannot think: no brain key saved');
    expect(NO_KEY_DETAIL).toMatch(/brain key/);
    for (const file of [
      'src/buddy/minds/mindGuards.ts',
      'src/buddy/minds/mindCore.ts',
      'src/buddy/minds/auditor.ts',
      'supabase/functions/_shared/placementRun.ts',
      'supabase/functions/_shared/productPlacement.ts',
      'supabase/functions/_shared/packCopy.ts',
    ]) {
      expect(read(file), file).not.toMatch(/Google (key|refused|is busy|could not|sent)|no Google key/);
    }
  });
});

describe('Phase D freeze 5: WhatsApp is gone from the distribution code', () => {
  it('the handler has no WhatsApp channel or key map, and the adapters have no WhatsApp readback', () => {
    const handler = read('supabase/functions/automation-distribution/handler.ts');
    const adapters = read('supabase/functions/_shared/distributionAdapters.ts');
    expect(handler).not.toMatch(/whatsapp/i);
    expect(adapters).not.toMatch(/whatsapp/i);
  });

  it('the WhatsApp key names stay on the not-offered list, so old rows stay hidden', () => {
    expect(NOT_OFFERED_KEY_NAMES).toEqual(['whatsapp_access_token', 'whatsapp_phone_number_id']);
  });

  it('the shared distribution lib is kept on purpose: its video-template parsing still has a test', () => {
    expect(existsSync(join(ROOT, 'src/lib/automationDistribution.ts'))).toBe(true);
  });
});
