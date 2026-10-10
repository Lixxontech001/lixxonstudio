// @vitest-environment node
// Phase C freeze. Source and function checks only: no network, no live keys, no live brain, no live door.
// Nothing here merges, deploys, or applies a migration.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MINDS } from '../buddy/minds/mindRoster';
import { VIBES } from '../buddy/buddyVibes';
import { BRAIN_SLOTS, BRAIN_IDS } from '../../supabase/functions/_shared/brains';
import { DOOR_IDS } from '../../supabase/functions/_shared/doorRegistry';
import { RSS_DOORS } from '../../supabase/functions/_shared/rssHub';
import { controlDoneLine } from '../../supabase/functions/_shared/buddyControls';
import { REFUSAL_LINE, ALLOWED_ORDERS } from '../../supabase/functions/_shared/buddyOrderPolicy';
import { NOT_OFFERED_KEY_NAMES } from '../../supabase/functions/_shared/notOfferedKeys';

const ROOT = process.cwd();
const read = (file: string) => readFileSync(join(ROOT, file), 'utf8');

// Removes // line comments and /* block */ comments, so only code and visible strings are checked.
const withoutComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');

describe('Phase C freeze 1: the old Admin AI tower is gone', () => {
  it('AdminAI.tsx does not exist', () => {
    expect(existsSync(join(ROOT, 'src/admin/pages/AdminAI.tsx'))).toBe(false);
  });

  it('AdminApp does not import or render a 22-tab Admin AI page', () => {
    const app = read('src/admin/AdminApp.tsx');
    expect(app).not.toMatch(/pages\/AdminAI['"]/);
    expect(app).not.toMatch(/<AdminAI\b/);
  });
});

describe('Phase C freeze 2 and 3: the dead Distribution page is gone; the address still goes to Minds', () => {
  it('AutomationDistribution.tsx does not exist', () => {
    expect(existsSync(join(ROOT, 'src/admin/pages/AutomationDistribution.tsx'))).toBe(false);
  });

  it('the retired Distribution route still redirects to Minds', () => {
    const app = read('src/admin/AdminApp.tsx');
    expect(app).toMatch(/function RetiredDistributionRedirect\(/);
    expect(app).toMatch(/RetiredDistributionRedirect \/>/);
    expect(app).toMatch(/admin-automation-distribution/);
  });
});

describe('Phase C freeze 4 and 5: the Executioner line is honest', () => {
  const executioner = MINDS.find((mind) => mind.key === 'executioner');

  it('the Executioner job text does not say it publishes nothing on its own', () => {
    expect(executioner?.job).toBeDefined();
    expect(executioner?.job).not.toContain('Publishes nothing on its own');
  });

  it('the Executioner job text says it publishes nothing while Takeover is off, and never posts the four hand channels', () => {
    expect(executioner?.job).toBe(
      'Prepares packs and the free-door send. Publishes nothing while Takeover is off. Never posts the four you post by hand.',
    );
  });
});

describe('Phase C freeze 6: the owner calendar shows a studio clock, not a country', () => {
  const calendar = withoutComments(read('src/admin/pages/ArticleQueueCalendar.tsx'));
  const runs = withoutComments(read('src/admin/pages/AutomationRuns.tsx'));
  const intake = withoutComments(read('src/lib/articleIntake.ts'));

  it('the calendar has no en-NG and no visible Lagos, Nigeria or WAT', () => {
    expect(calendar).not.toMatch(/en-NG/);
    expect(calendar).not.toMatch(/\bNigeria\b|\bWAT\b|\bLagos\b/);
  });

  it('no quoted visible string on the calendar names Lagos, Nigeria or WAT', () => {
    const quoted = calendar.match(/'[^'\n]*'|"[^"\n]*"|`[^`\n]*`/g) ?? [];
    const hits = quoted.filter((text) => /\b(Lagos|Nigeria|WAT)\b/.test(text) && !/timeZone/.test(text));
    expect(hits).toEqual([]);
  });

  it('the run monitor and intake helpers show the studio clock in their visible strings', () => {
    expect(runs).not.toMatch(/en-NG|\bWAT\b|\bNigeria\b|Africa\/Lagos \(WAT\)|08:00 Lagos/);
    expect(intake).not.toMatch(/en-NG|\bWAT\b|\bNigeria\b|in Lagos\./);
    expect(intake).toContain('(studio clock)');
  });

  it('the clock itself still runs on Africa/Lagos in code', () => {
    expect(read('src/lib/articleIntake.ts')).toContain("LAGOS_TIME_ZONE = 'Africa/Lagos'");
    expect(read('src/admin/pages/AutomationRuns.tsx')).toContain("timeZone: 'Africa/Lagos'");
  });
});

describe('Phase C freeze 7: WhatsApp is not a door on Keys or Connections', () => {
  it('the Keys page has no WhatsApp help sentence', () => {
    expect(read('src/admin/pages/AutomationKeys.tsx')).not.toMatch(/whatsapp/i);
  });

  it('the Connections page does not list WhatsApp', () => {
    expect(read('src/admin/pages/AdminConnections.tsx')).not.toMatch(/whatsapp/i);
  });

  it('the shared filter names the two WhatsApp keys, and the keys function refuses them without a test', () => {
    expect(NOT_OFFERED_KEY_NAMES).toEqual(['whatsapp_access_token', 'whatsapp_phone_number_id']);
    const keysFunction = read('supabase/functions/automation-keys/index.ts');
    expect(keysFunction).not.toMatch(/testWhatsAppCredential/);
    expect(keysFunction).toMatch(/isNotOfferedKey\(name\)\) return "invalid"/);
  });
});

describe('Phase C freeze 8: Buddy does not say Google is the only brain', () => {
  const think = read('supabase/functions/_shared/buddyThink.ts');

  it('the outcome lines no longer say "Google rejected the saved key"', () => {
    expect(think).not.toContain('Google rejected the saved key');
    expect(think).not.toContain('Google is limiting');
    expect(think).not.toContain('Google could not be reached');
    expect(think).not.toContain('Google sent back nothing');
  });

  it('the outcome lines name Gemini, which is the one brain the probe checks', () => {
    expect(think).toMatch(/rejected: "Gemini, Buddy's first brain, rejected the saved key\./);
  });

  it('the probe says which brain answered (the chain walks every saved brain)', () => {
    expect(think).toMatch(/action, brain: answer\.brain, model: answer\.model/);
  });

  it('the stale "Gemini below" comment is gone, and the ask path goes through the brain chain', () => {
    expect(think).not.toContain('Everything else goes to Gemini below');
    expect(think).toMatch(/askBrains\(/);
  });

  it('the all-failed line names no single provider', () => {
    const allFailed = think.match(/const ALL_FAILED_LINE = ([^;]+);/);
    expect(allFailed?.[1] ?? '').not.toMatch(/Google|Gemini/);
  });
});

describe('Phase C: four Buddy looks and five minds unchanged', () => {
  it('four looks and five background minds', () => {
    expect(VIBES).toHaveLength(4);
    expect(MINDS).toHaveLength(5);
  });
});

describe('Phase C freeze 9: Takeover default is still false', () => {
  it('the minds controls migration defaults takeover to false', () => {
    expect(read('supabase/migrations/20261009140000_minds_controls.sql')).toMatch(/takeover boolean NOT NULL DEFAULT false/);
  });
});

describe('Phase C freeze 10: Social Shares sends nothing', () => {
  it('the Social Shares page does not call a publisher, a send, or an insert', () => {
    const page = read('src/admin/pages/AdminSocialShares.tsx');
    expect(page).not.toMatch(/functions\.invoke|fetch\(|publish|\.insert\(|\.upsert\(/i);
  });
});

describe('Phase C freeze 11: no new door, and the RSS pause line says ping', () => {
  it('the door list is still the sixteen auto doors, with no WhatsApp or 21st door', () => {
    expect(DOOR_IDS).toHaveLength(16);
    expect(DOOR_IDS).not.toContain('whatsapp');
    const sixteen = [
      'bluesky', 'blogger', 'discord', 'flipboard', 'google_news', 'medium', 'mastodon', 'microsoft_start',
      'pixelfed', 'podcast', 'smartnews', 'telegram', 'tumblr', 'vimeo', 'wordpress_com', 'youtube',
    ];
    expect([...DOOR_IDS].sort()).toEqual([...sixteen].sort());
  });

  it('the RSS door set in buddyControls matches RSS_DOORS', () => {
    const controls = read('supabase/functions/_shared/buddyControls.ts');
    for (const door of RSS_DOORS) expect(controls).toContain(`"${door}"`);
  });

  it('pausing an RSS door says the feed ping is paused, not that Buddy posts', () => {
    const line = controlDoneLine({ kind: 'pause_door', door: 'flipboard' });
    expect(line).toContain('ping your feed');
    expect(line).not.toContain('post there');
  });

  it('pausing a normal door still says post', () => {
    expect(controlDoneLine({ kind: 'pause_door', door: 'bluesky' })).toContain('post there');
  });
});

describe('Phase C freeze 12: Cerebras and DeepSeek stay skipped', () => {
  it('the brain catalogue still skips Cerebras and DeepSeek, and keeps eight slots', () => {
    expect(BRAIN_IDS).toHaveLength(8);
    expect(BRAIN_SLOTS.find((slot) => slot.id === 'cerebras')?.access).toBe('skip');
    expect(BRAIN_SLOTS.find((slot) => slot.id === 'deepseek')?.access).toBe('skip');
    expect(BRAIN_SLOTS[0].id).toBe('gemini');
  });
});

describe('Phase C freeze 13: the closed order list and the refusal line still stand', () => {
  it('the closed list has five kinds, and the refusal line exists', () => {
    expect(ALLOWED_ORDERS).toHaveLength(5);
    expect(REFUSAL_LINE).toMatch(/Buddy will not do that\./);
    expect(REFUSAL_LINE).toMatch(/Nothing was filed or changed\./);
  });
});

describe('Phase C freeze 14 (also): Advisor is site health, not Buddy', () => {
  it('AdminAdvisor does not import Buddy, does not set Takeover, and does not reach a publisher', () => {
    const advisor = read('src/admin/pages/AdminAdvisor.tsx');
    expect(advisor).not.toMatch(/buddy/i);
    expect(advisor).not.toMatch(/takeover/i);
    expect(advisor).not.toMatch(/functions\.invoke|publish/i);
  });
});

describe('Phase C: the Brains screen wears the taupe and charcoal look, not grey', () => {
  it('AutomationBrains has no grey Tailwind classes', () => {
    expect(read('src/admin/pages/AutomationBrains.tsx')).not.toMatch(/\bgray-\d+/);
  });
});

describe('Phase C: no en-NG in the admin or the shared libraries', () => {
  it('no admin page or library uses the en-NG locale', () => {
    for (const file of ['src/admin/pages/ArticleQueueCalendar.tsx', 'src/admin/pages/AutomationRuns.tsx', 'src/lib/articleIntake.ts', 'src/lib/automationRuns.ts']) {
      expect(read(file), file).not.toMatch(/en-NG/);
    }
  });
});
