// @vitest-environment node
// Phase A slice 4: the Brains page rows, the key-page hand-off, the one read-only ping per brain,
// Buddy's brain how-to, owner-only access, and the copy the owner reads.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BRAIN_SLOTS, brainSecretNames, tryableBrains } from '../../supabase/functions/_shared/brains';
import { brainHowTo, brainHowToReply } from '../../supabase/functions/_shared/buddyHowTo';
import { routeMessage } from '../../supabase/functions/_shared/buddyRouter';
import { buildProviderCheckRequest } from '../../supabase/functions/_shared/automationKeyChecks';
import { NONE_SAVED_LINE } from '../../supabase/functions/_shared/brainChain';
import { brainRows, withoutBrainKeys } from '../lib/brainRows';
import { canAccess } from '../admin/permissions';
import { resolveAutomationAdminRoute } from '../admin/automationRoutes';
import type { AdminAccess } from '../context/AuthContext';

const read = (file: string) => readFileSync(path.join(process.cwd(), file), 'utf8');
// "router" is matched as a whole word only, so the provider name OpenRouter (a brand) stays allowed.
/** The words the owner reads: quoted strings and JSX text. Code calls like rpc(...) are left out. */
function visibleText(source: string): string[] {
  const quoted = source.match(/'[^'\n]*'|"[^"\n]*"/g) ?? [];
  const jsxText = source.match(/>[^<>{}\n]+</g) ?? [];
  return [...quoted, ...jsxText];
}
const BANNED = /autonomy|control tower|orchestrat|\bRPC\b|payload|dispatch|daily kit|adapter|failover|\brouter\b/i;

describe('Brains page rows', () => {
  it('shows eight rows in the fixed try order, skipped brains included', () => {
    const rows = brainRows();
    expect(rows.map((row) => row.slot.id)).toEqual(['gemini', 'groq', 'nvidia', 'cloudflare', 'openrouter', 'cerebras', 'huggingface', 'deepseek']);
    expect(rows.map((row) => row.slot.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('Google keeps its existing Vault entry, and Cloudflare has a second box for the account ID', () => {
    const rows = brainRows();
    expect(rows[0].keyName).toBe('gemini_api_key');
    const cloudflare = rows.find((row) => row.slot.id === 'cloudflare');
    expect(cloudflare?.keyName).toBe('cloudflare_api_token');
    expect(cloudflare?.identifier).toEqual({ name: 'cloudflare_account_id', label: 'Account ID' });
    expect(rows.filter((row) => row.identifier).map((row) => row.slot.id)).toEqual(['cloudflare']);
  });

  it('Test is off for the two skipped brains, and on for the free ones', () => {
    const rows = brainRows();
    expect(rows.filter((row) => row.testable).map((row) => row.slot.id)).toEqual(tryableBrains().map((slot) => slot.id));
    expect(rows.find((row) => row.slot.id === 'cerebras')?.testable).toBe(false);
    expect(rows.find((row) => row.slot.id === 'deepseek')?.testable).toBe(false);
  });

  it('the Automation keys page hides every brain entry and keeps the others', () => {
    const names = brainSecretNames();
    const items = [...names, 'openai_api_key', 'resend_api_key'].map((name) => ({ name }));
    expect(withoutBrainKeys(items).map((item) => item.name)).toEqual(['openai_api_key', 'resend_api_key']);
    expect(read('src/admin/pages/AutomationKeys.tsx')).toContain('withoutBrainKeys(keysWithoutDoorDetails(safeItems))');
  });

  it('the page shows Saved or Not saved, and the key box is a password box with autocomplete off', () => {
    const source = read('src/admin/pages/AutomationBrains.tsx');
    expect(source).toContain("'Saved' : 'Not saved'");
    expect(source).toContain('type="password"');
    expect(source).toContain('autoComplete="off"');
    expect(source).toContain("rpc('automation_secret_save'");
    expect(source).toContain("functions.invoke('automation-keys'");
    // The typed value is never printed back: the page never renders a draft.
    expect(source).not.toMatch(/\{drafts\[[^\]]+\]\}/);
  });
});

describe('one read-only ping per brain', () => {
  const SECRET = 'FAKE-PING-SECRET-PHASE-A';
  const pinged = ['groq_api_key', 'nvidia_api_key', 'cloudflare_api_token', 'openrouter_api_key', 'huggingface_token'];

  it('each free brain has a GET request with the key in the header only', () => {
    for (const name of pinged) {
      const request = buildProviderCheckRequest(name, SECRET);
      expect(request, name).not.toBeNull();
      expect(request!.url.startsWith('https://')).toBe(true);
      expect(request!.url).not.toContain(SECRET);
      expect(request!.init.method).toBe('GET');
      expect(request!.init.redirect).toBe('error');
      expect(JSON.stringify(request!.init.headers)).toContain(SECRET);
    }
  });

  it('the skipped brains (Cerebras and DeepSeek) have no ping', () => {
    expect(buildProviderCheckRequest('cerebras_api_key', SECRET)).toBeNull();
    expect(buildProviderCheckRequest('deepseek_api_key', SECRET)).toBeNull();
  });

  it('no ping is a publish or a send: every request is a GET to a model or account list', () => {
    for (const name of pinged) {
      const request = buildProviderCheckRequest(name, SECRET)!;
      expect(request.url).toMatch(/models|whoami|verify|\/key$/);
    }
  });
});

describe('Buddy brain how-to', () => {
  it('a how-to question about one brain names that brain', () => {
    expect(brainHowTo('how do I get a Groq key?')).toBe('groq');
    expect(brainHowTo('how do I connect Hugging Face')).toBe('huggingface');
    expect(brainHowTo('how do I set up NVIDIA')).toBe('nvidia');
  });

  it('a question about a brain with no key words is not a how-to, and two brains are left alone', () => {
    expect(brainHowTo('how is Groq doing this week')).toBeNull();
    expect(brainHowTo('how do I get a Groq and a DeepSeek key')).toBeNull();
    expect(brainHowTo('how do I connect YouTube')).toBeNull();
  });

  it('the reply points to the Brains page and the site, and skipped brains say so', () => {
    const groq = brainHowToReply('groq');
    expect(groq).toContain('console.groq.com');
    expect(groq).toContain('Brains under Automation');
    expect(groq).toContain('Saved keys are never shown again');
    expect(brainHowToReply('cerebras')).toContain('skips this brain for now');
    expect(brainHowToReply('cloudflare')).toContain('account ID');
  });

  it('the router sends a brain how-to to the fixed reply, with no mind named', () => {
    expect(routeMessage('how do I get a Groq key?', null)).toEqual({ kind: 'brain_how_to', brain: 'groq' });
    expect(routeMessage('how do I connect YouTube?', null)).toMatchObject({ kind: 'how_to', door: 'youtube' });
  });

  it('every brain has a key site and a try-order label', () => {
    for (const slot of BRAIN_SLOTS) {
      expect(slot.keySite).toMatch(/^[a-z0-9.-]+\.[a-z]{2,}$/);
      expect(slot.label.length).toBeGreaterThan(0);
    }
  });
});

describe('owner-only access and routes', () => {
  const access = (over: Partial<AdminAccess>) => ({ status: 'active', is_founder: false, is_owner: false, permissions: [], ...over }) as unknown as AdminAccess;

  it('the Brains route is owner or founder only, even with the key permission', () => {
    expect(canAccess(access({ permissions: ['automation.keys'] }), 'admin-automation-brains')).toBe(false);
    expect(canAccess(access({ is_owner: true }), 'admin-automation-brains')).toBe(true);
    expect(canAccess(access({ is_founder: true }), 'admin-automation-brains')).toBe(true);
    expect(canAccess(null, 'admin-automation-brains')).toBe(false);
  });

  it('the URL /admin/automation/brains resolves to the Brains route', () => {
    expect(resolveAutomationAdminRoute('/admin/automation/brains')).toBe('admin-automation-brains');
    expect(resolveAutomationAdminRoute('/admin/automation/brains/')).toBe('admin-automation-brains');
  });
});

describe('owner copy: plain words, no em dash, no banned words, no Nigeria, Naira or Lagos', () => {
  const ownerCopy = (): string[] => [
    ...BRAIN_SLOTS.flatMap((slot) => [slot.label, slot.purpose, slot.accessNote]),
    NONE_SAVED_LINE,
    brainHowToReply('groq'),
    brainHowToReply('cerebras'),
    brainHowToReply('cloudflare'),
    ...visibleText(read('src/admin/pages/AutomationBrains.tsx')),
    ...visibleText(read('src/buddy/BuddyChat.tsx')),
  ];

  it('no em dash, no banned words, and no Nigeria, Naira or Lagos in the new copy', () => {
    for (const text of ownerCopy()) {
      expect(text).not.toContain('\u2014');
      expect(text).not.toMatch(BANNED);
      expect(text).not.toMatch(/nigeria|naira|lagos/i);
    }
  });
});
