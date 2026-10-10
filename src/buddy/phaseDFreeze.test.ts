// @vitest-environment node
// Phase D freeze, one group per slice of the Phase D spec. Source and fixture checks only: no network, no live keys,
// no live brain, no live door, no live push. Nothing here merges, deploys, or applies a migration.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALLOWED_ORDERS, MODEL_FILEABLE_ORDER, REFUSAL_LINE, filingKindFor, gateModelOrder, gateOrder } from '../../supabase/functions/_shared/buddyOrderPolicy';
import { NOT_OFFERED_KEY_NAMES } from '../../supabase/functions/_shared/notOfferedKeys';
import { NO_KEY_ACTION, NO_KEY_DETAIL } from './minds/mindGuards';
import { BUZZ_KINDS } from '../../supabase/functions/_shared/notablePush';
import { BRIEFING_NOTABLE_KINDS, CARTS_WORDING, COMMENTS_WORDING, REFUNDS_WORDING, queueLines } from '../../supabase/functions/_shared/buddyBriefing';
import { anyTryableBrainConfigured, tryableBrains } from '../../supabase/functions/_shared/brains';
import { orderOutcomeLine } from '../../supabase/functions/_shared/buddyFeedback';
import { LIVING_MINDS } from '../../supabase/functions/_shared/buddyLivingMinds';

const ROOT = process.cwd();
const read = (file: string) => readFileSync(join(ROOT, file), 'utf8');

describe('Phase D freeze, slice 1: the probe walks the brain chain', () => {
  const think = read('supabase/functions/_shared/buddyThink.ts');

  it('the probe checks any saved brain through the chain, not Gemini alone', () => {
    expect(think).toMatch(/const answer = await askBrains\(\{ system: BUDDY_SYSTEM_INSTRUCTION/);
    expect(think).toMatch(/if \(!\(await anyBrainSaved\(ports\)\)\)/);
  });

  it('the chain is Gemini, Groq, NVIDIA, Cloudflare, OpenRouter, Hugging Face, with Cerebras and DeepSeek skipped', () => {
    expect(tryableBrains().map((slot) => slot.id)).toEqual(['gemini', 'groq', 'nvidia', 'cloudflare', 'openrouter', 'huggingface']);
  });

  it('only a Gemini answer writes the stored Google status', () => {
    expect(think).toMatch(/const probedGoogle = answer\.ok \? answer\.brain === "gemini"/);
    expect(think).toMatch(/if \(probedGoogle && answer\.lastOutcome !== "unreadable" && answer\.lastOutcome !== "none_saved"\)/);
  });
});

describe('Phase D freeze, slice 2: every filed order hits the closed list', () => {
  it('the closed list is still the five kinds, and a model may file only mind_work', () => {
    expect([...ALLOWED_ORDERS]).toEqual(['run_today', 'pause_resume_free_door', 'kill_or_start_mind', 'product_line_apply', 'mind_work']);
    expect(MODEL_FILEABLE_ORDER).toBe('mind_work');
  });

  it('the model path and the router both pass the one gate, and a question is never filed', () => {
    const think = read('supabase/functions/_shared/buddyThink.ts');
    expect(think).toContain('gateModelOrder(answer.order.kind, answer.order.instruction)');
    expect(think).toContain('routeFilingGate(route)');
    expect(gateOrder('mind_work', 'What should the Strategist check?')).toEqual({ ok: false, line: null });
    expect(gateModelOrder('run_today', 'Run the products')).toEqual({ ok: false, line: REFUSAL_LINE });
  });

  it('the old off-list line is gone everywhere, and the refusal line is the one used', () => {
    expect(read('supabase/functions/_shared/buddyThink.ts')).not.toContain('NOT_ON_LIST_LINE');
    expect(read('supabase/functions/_shared/buddyOrderPolicy.ts')).not.toContain('NOT_ON_LIST_LINE');
    expect(REFUSAL_LINE).toMatch(/Nothing was filed or changed/);
  });

  it('the answer rules say only the five kinds become orders', () => {
    const think = read('supabase/functions/_shared/buddyThink.ts');
    expect(think).toMatch(/Only five kinds of order exist: run_today, pause_resume_free_door, kill_or_start_mind, product_line_apply and mind_work\. Only those five kinds become orders\./);
  });
});

describe('Phase D freeze, slice 3: Buddy status is any tryable brain', () => {
  it('configured is true for any tryable brain, Gemini first, and Cerebras or DeepSeek alone never count', () => {
    expect(anyTryableBrainConfigured(new Set(['gemini_api_key']))).toBe(true);
    expect(anyTryableBrainConfigured(new Set(tryableBrains().slice(1).map((slot) => slot.secretName)))).toBe(true);
    expect(anyTryableBrainConfigured(new Set())).toBe(false);
  });

  it('the status path reads flags from the list, not the Google key alone', () => {
    const source = read('supabase/functions/buddy-think/index.ts');
    expect(source).toContain('anyTryableBrainConfigured(savedNames)');
    expect(source).not.toMatch(/entry\?\.name === KEY_NAME/);
  });
});

describe('Phase D freeze, slice 4: notables attempt one owner push', () => {
  const run = read('supabase/functions/minds-run-placement/index.ts');
  const push = read('supabase/functions/_shared/notablePush.ts');

  it('every briefing kind buzzes, plus finished jobs', () => {
    for (const kind of BRIEFING_NOTABLE_KINDS) expect(BUZZ_KINDS).toContain(kind);
    expect(BUZZ_KINDS).toContain('job_finished');
    expect(BUZZ_KINDS).toContain('door_posted');
  });

  it('the one notable writer makes one push attempt through the existing helper, and records the status', () => {
    expect(run).toMatch(/if \(!shouldBuzz\(kind\)\) return null;/);
    expect(run).toMatch(/notifyOwnerDevices\(kind, title, ownerPushDeps\(sb, owner\)\)/);
    expect(run).toMatch(/update\(\{ push_note: outcome\.status \}\)/);
  });

  it('missing VAPID is an honest skip with one daily-log line, and no push is sent', () => {
    expect(push).toMatch(/if \(!credentials\) return \{ status: "not_configured"/);
    expect(run).toMatch(/outcome\.status === "no_device" \|\| outcome\.status === "not_configured"/);
  });

  it('a gone device is revoked through the record function, never by a direct update', () => {
    const server = read('supabase/functions/_shared/notablePushServer.ts');
    expect(server).toContain('sb.rpc("push_record_delivery", { p_id: target.id, p_status: "expired" })');
    expect(server).not.toMatch(/from\("push_device_subscriptions"\)\s*\.update\(\{\s*enabled: false/);
  });

  it('the kinds the database writes attempt one owner push too: a Takeover or Kill from Minds or chat, and a blocked order', () => {
    const chat = read('supabase/functions/buddy-think/index.ts');
    const mindsNotify = read('supabase/functions/minds-control-notify/index.ts');
    const minds = read('src/buddy/minds/mindsControlsStore.ts');
    expect(chat).toContain('if (!isDoor) await pushNewestNotable("kill_changed", ownerNotablePorts(sb, user.id));');
    expect(mindsNotify).toContain('const CONTROL_KINDS = ["takeover_changed", "kill_changed"] as const;');
    expect(minds).toContain("supabase.functions.invoke('minds-control-notify'");
    expect(run).toContain('await pushNewestNotable("order_blocked", ownerNotablePorts(sb, owner));');
  });

  it('the owner push for Minds switches is best effort: a failed notify never changes a saved switch', () => {
    const minds = read('src/buddy/minds/mindsControlsStore.ts');
    expect(minds).toMatch(/if \(error\) return \{ ok: false \};\s*notifyControlSaved\(\);\s*return \{ ok: true \};/);
  });

  it('the placement step returns a held outcome on a site-read failure, never reply(req) without req', () => {
    const fn = run.slice(run.indexOf('async function runAgainstSite('), run.indexOf('/**', run.indexOf('async function runAgainstSite(') + 10));
    expect(fn).toContain('return { status: "held", detail: "Site reads failed. Nothing changed." };');
    expect(fn).not.toMatch(/reply\(req/);
  });
});

describe('Phase D freeze, slice 5: swap, briefing sources, living mind steps', () => {
  it('a swap files as product_line_apply, and an applied change reads Done.', () => {
    expect(filingKindFor('Ask the Executioner to swap the Calm Skin Routine Guide onto the skin guide')).toBe('product_line_apply');
    expect(orderOutcomeLine('applied', 'Added Calm Skin Routine Guide to "Easy Skincare".')).toMatch(/^Done\. Added Calm Skin Routine Guide/);
  });

  it('the briefing counts comments, refunds and carts, quiet at zero and honest when unread', () => {
    expect(queueLines({ ok: true, count: 0 }, COMMENTS_WORDING)).toEqual([]);
    expect(queueLines({ ok: false, count: 0 }, REFUNDS_WORDING)).toEqual([REFUNDS_WORDING.unread]);
    expect(queueLines({ ok: true, count: 3 }, CARTS_WORDING)).toEqual(['3 abandoned carts have not been recovered yet.']);
  });

  it('the day run calls the Analyst, the Strategist and the CEO on a run with no order named, and writes their rows', () => {
    const run = read('supabase/functions/minds-run-placement/index.ts');
    expect(LIVING_MINDS).toEqual(['analyst', 'strategist', 'ceo']);
    expect(run).toMatch(/if \(orderId === null\) \{\s*try \{\s*await runLivingMindsForDay/);
    expect(run).toContain('await runLivingMinds(ports, { takeover, killScope, facts: await readMindFacts(sb)');
  });
});

describe('Phase D freeze, carried from earlier phases', () => {
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

  it('the handler has no WhatsApp channel or key map, and the adapters have no WhatsApp readback', () => {
    expect(read('supabase/functions/automation-distribution/handler.ts')).not.toMatch(/whatsapp/i);
    expect(read('supabase/functions/_shared/distributionAdapters.ts')).not.toMatch(/whatsapp/i);
    expect(NOT_OFFERED_KEY_NAMES).toEqual(['whatsapp_access_token', 'whatsapp_phone_number_id']);
  });

  it('the shared distribution lib is kept on purpose: the video-template editor decision is the owner\u2019s', () => {
    expect(existsSync(join(ROOT, 'src/lib/automationDistribution.ts'))).toBe(true);
  });

  it('the admin AI screen is not part of Buddy, and Buddy code stays in its own folders', () => {
    expect(existsSync(join(ROOT, 'src/admin/AdminAI.tsx'))).toBe(false);
    expect(existsSync(join(ROOT, 'src/admin/pages/AdminAI.tsx'))).toBe(false);
  });
});

describe('Phase D freeze, gaps closed after the first report', () => {
  it('the probe and ask read brain keys through the chain only: the Gemini-only readKey dep is gone', () => {
    const think = read('supabase/functions/_shared/buddyThink.ts');
    const handler = read('supabase/functions/buddy-think/index.ts');
    expect(think).not.toMatch(/readKey\(\): Promise/);
    expect(handler).not.toMatch(/readKey: \(\) =>/);
  });

  it('the Minds notify function is configured to need the owner session', () => {
    expect(read('supabase/config.toml')).toMatch(/\[functions\.minds-control-notify\]\s*\nverify_jwt = true/);
  });

  it('the shared push helper never sends to a device that is not the owner\'s', () => {
    const server = read('supabase/functions/_shared/notablePushServer.ts');
    expect(server).toContain('.eq("owner_id", owner)');
    expect(server).toContain('p_owner_user_id: owner');
  });
});
