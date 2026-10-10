import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { displayCurrencyCodes, getDisplayCurrency, isShownCurrency } from '../lib/money';

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

function walk(rel: string, out: string[] = []): string[] {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) return out;
  if (statSync(abs).isFile()) return [...out, rel];
  for (const name of readdirSync(abs)) {
    const child = relative(ROOT, join(abs, name));
    if (statSync(join(ROOT, child)).isDirectory()) walk(child, out);
    else if (/\.(ts|tsx|mjs|js|sql)$/.test(name) && !/\.test\./.test(name)) out.push(child);
  }
  return out;
}

// Words that must never reach template or owner-facing copy. "Africa/Lagos" is a timezone id used for date maths, so it is stripped first.
// packRules.ts is the guard that rejects these words in generated copy, so it is the one file allowed to name them.
const GUARD_FILES = ['supabase/functions/_shared/packRules.ts'];
const FORBIDDEN_COPY = /\b(Nigeria|Naira|Lagos|Abuja|WAT)\b|₦|NGN/;
const stripTimezoneIds = (text: string) => text.replace(/Africa\/Lagos/g, '');

describe('Phase B slice 5: new and remaining template copy is clean', () => {
  const GREP_SET = [
    ...walk('src/buddy'),
    ...walk('src/components'),
    ...walk('src/pages'),
    ...walk('supabase/functions/_shared'),
    ...walk('supabase/functions/feeds'),
    'scripts/video-template.mjs',
    'scripts/video-template-assertions.sql',
    'src/admin/pages/AdminMinds.tsx',
    'src/admin/pages/AdminConnections.tsx',
    'src/admin/pages/AutomationBrains.tsx',
  ].filter((file, i, all) => all.indexOf(file) === i && existsSync(join(ROOT, file)));

  it('covers the Buddy, Minds, Connections, Brains, video template, pack copy, briefing and feed files', () => {
    expect(GREP_SET).toEqual(expect.arrayContaining([
      'src/admin/pages/AdminMinds.tsx',
      'src/admin/pages/AdminConnections.tsx',
      'scripts/video-template.mjs',
    ]));
    expect(GREP_SET.some((file) => file.startsWith('src/buddy/'))).toBe(true);
  });

  it('has no Nigeria, Naira, Lagos, Abuja, WAT or NGN in those files', () => {
    const hits = GREP_SET.filter((file) => !GUARD_FILES.includes(file) && FORBIDDEN_COPY.test(stripTimezoneIds(read(file))));
    expect(hits).toEqual([]);
  });

  it('keeps the video template label as Clear daylight', () => {
    expect(read('scripts/video-template.mjs')).toContain('Clear daylight (default)');
    expect(read('scripts/video-template.mjs')).not.toMatch(/Lagos daylight/);
  });
});

describe('Phase B slice 5: Naira is hidden from readers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not offer NGN as a shown currency', () => {
    expect(isShownCurrency('NGN')).toBe(false);
    expect(isShownCurrency('ngn')).toBe(false);
    expect(isShownCurrency('GBP')).toBe(true);
  });

  it('builds the reader list from the rates without NGN, USD first, rest sorted', () => {
    expect(displayCurrencyCodes({ NGN: 1500, GBP: 0.8, USD: 1, CAD: 1.4 })).toEqual(['USD', 'CAD', 'GBP']);
  });

  it('falls back to USD when a saved choice is NGN', () => {
    vi.stubGlobal('localStorage', { getItem: () => 'NGN' });
    expect(getDisplayCurrency()).toBe('USD');
  });

  it('keeps a saved shown choice', () => {
    vi.stubGlobal('localStorage', { getItem: () => 'GBP' });
    expect(getDisplayCurrency()).toBe('GBP');
  });

  it('has no NGN symbol and the footer selector uses the shared list', () => {
    // NGN appears only in the hide list; it never gets a symbol or a rate line.
    expect(read('src/lib/money.ts')).not.toMatch(/₦|NGN:\s*'/);
    expect(read('src/components/CurrencySelector.tsx')).toContain('displayCurrencyCodes(rates)');
    expect(read('supabase/functions/refresh-rates/index.ts')).not.toMatch(/"NGN"/);
  });
});

describe('Phase B slice 5: old sender keys are retired', () => {
  const migration = read('supabase/migrations/20261018010000_retire_old_sender_keys.sql');

  it('disables only the WhatsApp, Facebook and Pinterest sender keys', () => {
    for (const name of ['whatsapp_access_token', 'whatsapp_phone_number_id', 'meta_access_token', 'facebook_page_id', 'pinterest_access_token', 'pinterest_board_id']) {
      expect(migration).toContain(`'${name}'`);
    }
    expect(migration).toMatch(/SET enabled = false/);
    expect(migration).not.toMatch(/^\s*(DELETE|DROP|INSERT)\b/im);
    expect(migration).toMatch(/NOT applied to production/);
  });

  it('relies on the database refusing disabled names on save', () => {
    const keysMigration = read('supabase/migrations/20261005100000_automation_keys_owner_and_catalog.sql');
    expect(keysMigration).toMatch(/WHERE secret_name = v_name AND enabled/);
    expect(keysMigration).toMatch(/Unknown or disabled secret name/);
    expect(keysMigration).toMatch(/WHERE c\.enabled/);
  });

  it('keeps the Telegram-only send gate in the distribution handler', () => {
    const handler = read('supabase/functions/automation-distribution/handler.ts');
    expect(handler).toMatch(/telegram/);
    expect(handler).toMatch(/manual-kit only/);
  });
});

describe('Phase B slice 5: no owner Distribution or WhatsApp send path is wired', () => {
  it('redirects the old Distribution route to Minds and has no sidebar item for it', () => {
    const app = read('src/admin/AdminApp.tsx');
    expect(app).toMatch(/RetiredDistributionRedirect/);
    const layout = read('src/admin/AdminLayout.tsx');
    expect(layout).not.toMatch(/distribution|whatsapp|pinterest|facebook/i);
  });

  it('does not import the distribution lib from Buddy', () => {
    const buddyFiles = [...walk('src/buddy'), ...walk('supabase/functions/_shared').filter((f) => /buddy/i.test(f))];
    const offenders = buddyFiles.filter((file) => /automationDistribution|distributionAdapters|AutomationDistribution/.test(read(file)));
    expect(offenders).toEqual([]);
  });
});
