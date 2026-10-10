// @vitest-environment node
// The day run's notable events: which ones call the push helper, and that the push can never fail the run.
// Source checks: the day run runs on Deno, so these read the files as text.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUZZ_KINDS } from '../../supabase/functions/_shared/notablePush';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const RUN = read('supabase/functions/minds-run-placement/index.ts');
const MIGRATION = read('supabase/migrations/20261011210000_notable_push.sql');
// The kind list the table accepts today (the newest CHECK). Every kind that buzzes must be in it.
const KIND_CHECK = read('supabase/migrations/20261018000000_notable_week_change.sql');

describe('the day run records and buzzes through one helper', () => {
  it('a door post, a ready pack, the Auditor, and a broken door step each call the helper', () => {
    expect(RUN).toContain('"executioner",\n      "door_posted"');
    expect(RUN).toContain('"executioner",\n      "pack_ready"');
    expect(RUN).toContain('recordNotable(sb, owner, localDay, "executioner", "mind_failed"');
    expect(RUN).toContain('recordNotable(sb, owner, localDay, "auditor", kind, title, detail)');
  });

  it('the day run sends only through the shared helper, never through a provider call of its own', () => {
    expect(RUN).toContain('notifyOwnerDevices(');
    expect(RUN).not.toMatch(/sendPushNotification\(/);
    expect(RUN).not.toMatch(/fetch\([^)]*push\./i);
  });

  it('a heartbeat is never recorded through the helper', () => {
    expect(RUN).not.toMatch(/recordNotable\([^)]*heartbeat/i);
    expect(RUN).not.toMatch(/"heartbeat"/);
  });

  it('a push problem is caught inside the helper, so the run keeps going', () => {
    const helper = RUN.slice(RUN.indexOf('async function recordNotable('), RUN.indexOf('/** The door step never throws'));
    expect(helper).toMatch(/catch \{\n\s*return null;\n\s*\}/);
    expect(helper).toContain('const outcome = await notifyOwnerDevices(');
  });

  it('no device or no keys writes the plain words once to the daily log, and never a key', () => {
    expect(RUN).toContain('outcome.status === "no_device" ? NO_DEVICE_COPY : PUSH_HELP_COPY');
    expect(RUN).not.toMatch(/vapid_private_key[^)]*\)\s*,\s*\n\s*detail/);
  });

  it('the keys come from the same Vault reads the push handler uses', () => {
    // The Vault reads and the device list now live in the shared server module, used by the day run and the chat path.
    const SERVER = read('supabase/functions/_shared/notablePushServer.ts');
    expect(SERVER).toContain('sb.rpc("automation_secret_get_internal"');
    expect(SERVER).toContain('read("vapid_private_key")');
    expect(SERVER).toContain('sb.rpc("push_test_targets"');
  });
});

describe('the database accepts the new kinds, and keeps the old ones', () => {
  it('every kind that buzzes is allowed by the table check', () => {
    for (const kind of BUZZ_KINDS) expect(KIND_CHECK).toContain(`'${kind}'`);
  });

  it('the old kinds stay allowed, and heartbeat is not added', () => {
    for (const kind of ['takeover_changed', 'kill_changed', 'order_blocked', 'auditor_blocked', 'mind_failed', 'night_report_written', 'article_changed']) {
      expect(MIGRATION).toContain(`'${kind}'`);
    }
    expect(MIGRATION).not.toContain("'heartbeat'");
  });

  it('the push note has a fixed list of values', () => {
    expect(MIGRATION).toMatch(/push_note IN \('sent', 'no_device', 'not_configured', 'failed', 'not_buzzing'\)/);
  });
});

describe('the day run marks devices through the record function', () => {
  it('a gone device is revoked and scrubbed by push_record_delivery, not by a direct update', () => {
    const SERVER = read('supabase/functions/_shared/notablePushServer.ts');
    expect(SERVER).toContain('sb.rpc("push_record_delivery", { p_id: target.id, p_status: "expired" })');
    expect(SERVER).toContain('p_status: "sent"');
    expect(SERVER).not.toMatch(/from\("push_device_subscriptions"\)\.update\(\{\s*enabled: false/);
  });
});

describe('the placement step never replies to a request it does not have', () => {
  it('a site-read failure inside runAgainstSite returns a held outcome, not a reply(req, ...) that has no req in scope', () => {
    const fn = RUN.slice(RUN.indexOf('async function runAgainstSite('), RUN.indexOf('/**', RUN.indexOf('async function runAgainstSite(') + 10));
    expect(fn).toContain('return { status: "held", detail: "Site reads failed. Nothing changed." };');
    expect(fn).not.toMatch(/reply\(req/);
  });
});
