// @vitest-environment node
// The day run's shop scan and job event: what they read, what they write, and that the migration only adds a key.
// Source checks: the day run runs on Deno, so these read the files as text.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const RUN = read('supabase/functions/minds-run-placement/index.ts');
const MIGRATION = read('supabase/migrations/20261012000000_notable_sources.sql');
const SHARED = read('supabase/functions/_shared/notableSources.ts');

/** The text of the shop scan wrapper, from its start to the next top-level function. */
function scanBody(): string {
  const start = RUN.indexOf('async function scanShopNotables(');
  const end = RUN.indexOf('\n/** Reads the site for one order', start);
  return RUN.slice(start, end);
}

describe('the day run calls the shop scan and the job event', () => {
  it('runs the scan and the job event after the free doors, and never lets the scan stop the run', () => {
    const doorsAt = RUN.indexOf('const doors = await runDoorsSafely(');
    const scanAt = RUN.indexOf('await scanShopNotables(sb, owner, localDay);');
    const jobAt = RUN.indexOf('planJobNotable(outcome.status, outcome.orderId)');
    expect(doorsAt).toBeGreaterThan(0);
    expect(scanAt).toBeGreaterThan(doorsAt);
    expect(jobAt).toBeGreaterThan(scanAt);
    const block = RUN.slice(scanAt - 200, scanAt + 60);
    expect(block).toMatch(/try \{[\s\S]*catch \{/);
  });

  it('a job event is written with its source key, so it is written once', () => {
    expect(RUN).toContain('if (job) await recordNotable(sb, owner, localDay, job.mind, job.kind, job.title, job.detail, job.key);');
  });
});

describe('the shop scan only reads the shop, and only writes notable rows', () => {
  const body = scanBody();

  it('is found, and reads paid orders, product clicks and sources', () => {
    expect(body.length).toBeGreaterThan(500);
    expect(body).toContain('.from("orders")');
    expect(body).toContain('.eq("payment_status", "paid")');
    expect(body).toContain('.from("product_clicks")');
    expect(body).toContain('.in("source", sources)');
  });

  it('never inserts, updates or deletes anything except through the notable writer', () => {
    expect(body).not.toMatch(/\.(insert|update|upsert|delete)\(/);
    expect(body).not.toMatch(/\.from\("(orders|products|posts|product_clicks)"\)\s*\.(insert|update|upsert|delete)/);
    expect(body).not.toContain('.rpc(');
  });

  it('never selects the article body', () => {
    expect(body).not.toMatch(/select\([^)]*\bcontent\b/);
  });

  it('writes through recordNotable, which is the only writer of notable rows', () => {
    expect(body).toContain('recordNotable(sb, owner, localDay, plan.mind, plan.kind, plan.title, plan.detail, plan.key)');
  });
});

describe('the source key is sent only when there is one', () => {
  it('recordNotable adds the key only when present, so the run works before the migration is applied', () => {
    expect(RUN).toContain('...(sourceKey ? { source_key: sourceKey } : {})');
    expect(RUN).not.toMatch(/source_key: sourceKey(?!\s*\}\s*:)/);
  });

  it('the shared module has no provider call, no fetch, and no country', () => {
    expect(SHARED).not.toMatch(/fetch\(|sendPushNotification|sendEmail|sendMessage/);
    expect(SHARED).not.toMatch(/nigeria|naira|lagos/i);
    expect(SHARED).not.toMatch(/[\u2014\u2013]/);
  });
});

describe('the migration only adds a key and a unique index', () => {
  it('adds the column and the index on notable events, and nothing else', () => {
    expect(MIGRATION).toMatch(/ALTER TABLE public\.minds_notable_events\s+ADD COLUMN IF NOT EXISTS source_key text/);
    expect(MIGRATION).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS minds_notable_events_source_key_uidx\s+ON public\.minds_notable_events \(owner_id, source_key\)\s+WHERE source_key IS NOT NULL/);
    expect(MIGRATION).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP TABLE|TRUNCATE)\b/i);
    expect(MIGRATION).not.toMatch(/\b(orders|products|posts|product_clicks)\b/);
  });

  it('says it is not applied to production', () => {
    expect(MIGRATION).toMatch(/NOT applied to production/);
  });
});
