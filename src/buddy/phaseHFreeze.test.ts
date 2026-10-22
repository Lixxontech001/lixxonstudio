// @vitest-environment node
// Phase H freeze. One group per slice of the Phase H spec. Behaviour is checked through the real pure functions
// wherever one exists; source checks are used only for copy strings and file-level rules that have no function.
// No network, no live keys, no live brain, no live door, no live push, no database, no ffmpeg run, no migration.
// Nothing here merges, deploys, or applies a migration. If a rule breaks, this file fails.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BRAIN_IDS, BRAIN_SLOTS, tryableBrains } from '../../supabase/functions/_shared/brains';
import { DOOR_IDS, DOORS } from '../../supabase/functions/_shared/doorRegistry';
import { OPEN_DOORS } from '../../supabase/functions/_shared/doorPosts';
import { NOT_OFFERED_KEY_NAMES, isNotOfferedKey } from '../../supabase/functions/_shared/notOfferedKeys';
import { PUSH_HELP_COPY } from '../../supabase/functions/_shared/notablePush';
import {
  DEFAULT_MIND,
  MIND_KEYS,
  mindFit,
  neverListLine,
  routeMessage,
} from '../../supabase/functions/_shared/buddyRouter';
import {
  GUIDE_ANCHOR_IDS,
  GUIDE_BACK_DEFAULT,
  GUIDE_LINK_LABEL,
  GUIDE_PATH,
  GUIDE_SHORTS,
  guideHref,
  safeGuideBack,
} from '../../src/admin/lib/guide';
import { guideGroups } from '../../src/admin/lib/guideSections';

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

/**
 * The text an Admin screen shows: JSX text nodes, with comments and import lines already gone, because a module
 * path or a code comment is not on screen. String literals are covered by `adminPlainEnglish.test.ts`.
 */
function jsxText(src: string): string[] {
  const stripped = src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/import[\s\S]*?from\s+['"][^'"]+['"];?/g, ' ')
    .replace(/^\s*import\s+['"][^'"]+['"];?\s*$/gm, ' ');
  return [...stripped.matchAll(/>([^<>{}]{2,})</g)].map((match) => match[1]);
}

/** The words Phase H takes off the Admin screens. `supabase` is added while auditing: the owner never sees the host. */
const ENGINE_WORDS =
  /vault|\brpc\b|oauth|postgres|\bjwt\b|\brls\b|seq_scan|supabase|vercel|automation keys|system check|ai provider|editorial cms|point-in-time/i;

describe('Phase H slice 1: the guide page, the line beside each action, and the way back', () => {
  it('the guide lives at one address, and every link into it uses the same words', () => {
    expect(GUIDE_PATH).toBe('/admin/guide');
    expect(GUIDE_LINK_LABEL).toBe("Don't get it? Open the guide");
  });

  it('the anchors the pages point at exist, including gemini, vapid and takeover', () => {
    for (const id of [
      'keys',
      'save-key',
      'test-key',
      'delete-key',
      'vapid',
      'minds',
      'takeover',
      'kill',
      'video-look',
      'packs',
      'i-posted-this',
      'buddy-chat',
      'product-slots',
      'connections',
      'gemini',
    ]) {
      expect(GUIDE_ANCHOR_IDS, id).toContain(id);
    }
  });

  it('every anchor has a real section: a title, the same short line, and numbered steps', () => {
    const sections = guideGroups().flatMap((group) => group.sections);
    expect([...new Set(sections.map((section) => section.id))].sort()).toEqual([...GUIDE_ANCHOR_IDS].sort());
    expect(sections.length).toBe(GUIDE_ANCHOR_IDS.length);
    for (const section of sections) {
      expect(section.title.length, section.id).toBeGreaterThan(3);
      expect(section.steps.length, section.id).toBeGreaterThan(1);
      expect(section.short, section.id).toBe(GUIDE_SHORTS[section.id]);
    }
  });

  it('the guide link carries the page and the field to come back to', () => {
    expect(guideHref('vapid', '/admin/settings')).toBe('/admin/guide?back=%2Fadmin%2Fsettings#vapid');
    expect(guideHref('takeover', '/admin/ai#minds-takeover')).toBe(
      '/admin/guide?back=%2Fadmin%2Fai%23minds-takeover#takeover',
    );
    expect(guideHref('gemini', '/buddy')).toBe('/admin/guide?back=%2Fbuddy#gemini');
    expect(guideHref('gemini', 'https://example.com')).toBe('/admin/guide#gemini');
    expect(safeGuideBack('/buddy/controls')).toBe('/buddy/controls');
    expect(safeGuideBack('/buddyx')).toBeNull();
    expect(GUIDE_BACK_DEFAULT).toBe('/admin/automation/keys');
  });

  it('the guide page renders one article per anchor, loads the steps only when it opens, and has a Back link', () => {
    const page = read('src/admin/pages/AdminGuide.tsx');
    expect(page).toContain('id={section.id}');
    expect(page).toContain('guideBackTarget(window.location.search)');
    expect(page).toContain('Back to where I was');
    expect(page).toContain("import('../lib/guideSections')");
    expect(read('src/admin/AdminApp.tsx')).toContain("case 'admin-guide':");
  });

  it('every screen the spec names shows the line next to the action', () => {
    const surfaces: Readonly<Record<string, string[]>> = {
      'src/admin/pages/AutomationBrains.tsx': ['section={row.slot.id}', "components/GuideLink"],
      'src/admin/pages/AutomationKeys.tsx': ['section="keys"', 'section="vapid"', 'section="save-key"'],
      'src/admin/pages/AdminConnections.tsx': ['section="connections"', 'section={`door-${id}`}'],
      'src/admin/pages/AdminMinds.tsx': ['section="minds"', 'section="takeover"', 'section="kill"'],
      'src/admin/pages/AutomationVideoLook.tsx': ['section="video-look"'],
      'src/admin/pages/AdminArticleEditor.tsx': ['section="product-slots"', 'guideBackFor(postId)'],
      'src/buddy/BuddyChanges.tsx': ['section="packs"', 'section="i-posted-this"'],
      'src/buddy/BuddyChat.tsx': ['section="buddy-chat"'],
    };
    for (const [file, needles] of Object.entries(surfaces)) {
      for (const needle of needles) expect(read(file), `${file}: ${needle}`).toContain(needle);
    }
    // Buddy's own link goes back to the chat. Both link components carry the one label and the guide address.
    expect(read('src/buddy/BuddyGuideLink.tsx')).toContain("guideHref(section, '/buddy')");
    expect(read('src/buddy/BuddyGuideLink.tsx')).toContain('{GUIDE_LINK_LABEL}');
    expect(read('src/buddy/BuddyGuideLink.tsx')).toContain('guideShort(section)');
    expect(read('src/admin/components/GuideLink.tsx')).toContain('guideHref(section, back)');
    expect(read('src/admin/components/GuideLink.tsx')).toContain('{GUIDE_LINK_LABEL}');
  });
});

describe('Phase H slice 3: the Keys page is honest', () => {
  it('the Keys page source holds no dead thinking key and no social row', () => {
    const page = read('src/admin/pages/AutomationKeys.tsx');
    expect(page).not.toMatch(/openai|anthropic|claude/i);
    expect(page).not.toMatch(/facebook|instagram|tiktok|pinterest|threads|linkedin|whatsapp/i);
  });

  it('the retired names are still refused by the one list the whole site reads', () => {
    for (const name of [
      'openai_api_key',
      'anthropic_api_key',
      'claude_api_key',
      'whatsapp_access_token',
      'facebook_page_token',
      'threads_access_token',
      'linkedin_access_token',
      'x_api_key',
    ]) {
      expect(isNotOfferedKey(name), name).toBe(true);
    }
    expect(NOT_OFFERED_KEY_NAMES.length).toBeGreaterThanOrEqual(19);
  });

  it('a key the site still uses is not hidden', () => {
    for (const name of ['gemini_api_key', 'resend_api_key', 'flutterwave_secret_key']) {
      expect(isNotOfferedKey(name), name).toBe(false);
    }
  });

  it('saving over a saved key says what happens, and an empty save does nothing', () => {
    const page = read('src/admin/pages/AutomationKeys.tsx');
    expect(page).toContain('This replaces the key that is there. The old one is gone.');
    expect(page).toMatch(/if \(!value\.length\) return;/);
    expect(page).toMatch(/window\.confirm\(REPLACE_SAVED_KEY_LINE\)/);
  });

  it('the phone alert line names Keys, the phone and Register this device, from the one place it is written', () => {
    expect(PUSH_HELP_COPY).toMatch(/Keys page/);
    expect(PUSH_HELP_COPY).toMatch(/phone/);
    expect(PUSH_HELP_COPY).toMatch(/\/admin\/settings/);
    expect(PUSH_HELP_COPY).toMatch(/Register this device/);
    const generator = read('src/admin/components/VapidGenerator.tsx');
    expect(generator).toContain('{PUSH_HELP_COPY}');
    // The generator is its own chunk. Importing the guide layer here re-creates a chunk cycle.
    expect(generator).not.toContain("from '../lib/guide'");
  });

  it('no Keys, Brains or Connections screen reads a hosting value into the browser', () => {
    for (const file of [
      'src/admin/pages/AutomationKeys.tsx',
      'src/admin/pages/AutomationBrains.tsx',
      'src/admin/pages/AdminConnections.tsx',
      'src/admin/components/VapidGenerator.tsx',
    ]) {
      expect(read(file), file).not.toMatch(/import\.meta\.env/);
    }
  });
});

describe('Phase H slice 4: the Admin screens say plain words', () => {
  it('the left menu says Keys, Check and Data, and none of the retired labels', () => {
    const layout = read('src/admin/AdminLayout.tsx');
    expect(layout).toContain("label: 'Keys'");
    expect(layout).toContain("label: 'Check'");
    expect(layout).toContain("label: 'Data'");
    expect(layout).not.toMatch(/Automation keys|System Check|AI providers|Editorial CMS/);
  });

  it('no engine word is left in the text an Admin screen shows', () => {
    const offending: string[] = [];
    for (const file of filesUnder('src/admin')) {
      for (const text of jsxText(read(file))) {
        if (ENGINE_WORDS.test(text)) offending.push(`${file}: ${text.trim().slice(0, 120)}`);
      }
    }
    expect(offending).toEqual([]);
  });

  it('the Check screen keeps one plain label for every check the database can raise', () => {
    const migration = read('supabase/migrations/20261004202000_admin_ops_tools.sql');
    const health = read('src/admin/pages/AdminHealth.tsx');
    const keys = new Set([...migration.matchAll(/admin_health_set\(\s*'([a-z._]+)'/g)].map((match) => match[1]));
    const labels = new Map(
      [...health.matchAll(/'([a-z._]+)': '([^']+)'/g)].map((match) => [match[1], match[2]]),
    );
    expect([...keys].filter((key) => !labels.has(key))).toEqual([]);
    for (const [key, label] of labels) expect(label, key).not.toMatch(ENGINE_WORDS);
  });

  it('the parts of the Admin copy Phase H changed read plainly', () => {
    expect(read('src/admin/pages/AdminDataExplorer.tsx')).not.toMatch(/pg_stat_user_tables|information_schema|seq_scan/);
    expect(read('src/admin/pages/AdminDataExplorer.tsx')).not.toMatch(/Row-level security|read-only transaction/);
    expect(read('src/admin/pages/AdminAccess.tsx')).not.toMatch(/row-level security|rows in the database/);
    expect(read('src/admin/pages/AutomationRuns.tsx')).not.toMatch(/database-verified/);
    expect(read('src/admin/pages/AdminBackups.tsx')).not.toMatch(/Supabase|point-in-time/);
    expect(read('src/admin/pages/AdminSettings.tsx')).not.toMatch(/Supabase|\.env file|Project Settings/);
  });
});

describe('Phase H slice 5: Buddy never asks which mind', () => {
  it('an order with no mind named goes to the mind that fits, with no question', () => {
    const table: Readonly<Record<string, string>> = {
      'Read the numbers for last week': 'analyst',
      'Get the weekly figures ready': 'analyst',
      'Plan the strategy for the kit': 'strategist',
      'Compare us with the two rivals': 'strategist',
      'Find the dead products in the shop': 'strategist',
      'Sort the waiting orders': 'ceo',
      'Rank the drafts by hand': 'ceo',
      'Write the captions for the pack': 'executioner',
      'Open the doors on the new templates': 'executioner',
      'Check the spring guide': 'auditor',
      'Audit the Calm Skin article': 'auditor',
      'Do the new article': 'executioner',
    };
    for (const [message, mind] of Object.entries(table)) {
      const route = routeMessage(message, null);
      expect(route, message).toMatchObject({ kind: 'order', mind, routed: true });
      if (route.kind === 'order') {
        expect(route.others ?? [], message).toEqual([]);
        expect(route.instruction, message).not.toMatch(/which mind/i);
      }
    }
  });

  it('work with no named helper still routes internally, and two matches stay out of the reply', () => {
    expect(DEFAULT_MIND).toBe('executioner');
    expect(mindFit('Do the new article')).toEqual({ mind: 'executioner', others: [] });
    const both = mindFit('Check the numbers for the week');
    expect(both).toEqual({ mind: 'analyst', others: ['auditor'] });
    const route = routeMessage('Check the numbers for the week', null);
    expect(route).toMatchObject({ kind: 'order', mind: 'analyst', routed: true, others: ['auditor'] });
  });

  it('"how are sales" stays a question, "run today" is the day run, and a swap is the Executioner', () => {
    for (const question of ['How are sales?', 'What were the sales this week?', 'Should we post more this week?']) {
      expect(routeMessage(question, null).kind, question).not.toBe('order');
    }
    expect(routeMessage('run today', null)).toEqual({ kind: 'run_day', instruction: 'run today' });
    expect(routeMessage('Swap the Calm Skin Routine Guide onto the skin guide', null)).toMatchObject({
      kind: 'order',
      mind: 'executioner',
    });
  });

  it('the question is gone from the code, so it cannot come back by accident', () => {
    for (const file of ['supabase/functions/_shared/buddyRouter.ts', 'supabase/functions/_shared/buddyThink.ts']) {
      const source = read(file);
      expect(source, file).not.toMatch(/Which mind should take this/);
      expect(source, file).not.toMatch(/ask_which_mind/);
      expect(source, file).not.toMatch(/ASK_WHICH_MIND_LINE/);
    }
    // Every rule verb also starts an order: the rule list and the imperative list stay in step.
    const router = read('supabase/functions/_shared/buddyRouter.ts');
    expect(router).toMatch(/audit\|verify\|inspect\|rank\|prioritise\|prioritize\|triage/);
    expect(MIND_KEYS).toHaveLength(5);
  });

  it('the never-list is still refused, and nothing is filed', () => {
    for (const message of ['Reply to the readers as me', 'Buy ads for this post', 'Rewrite the whole article']) {
      expect(neverListLine(message), message).toBeTruthy();
      expect(routeMessage(message, null).kind, message).not.toBe('order');
    }
  });
});

describe('Phase H locks: no new door, no new brain, Takeover off', () => {
  it('Takeover is off by default in the app and in the database', () => {
    expect(read('src/buddy/minds/mindsControlsStore.ts')).toContain(
      "MINDS_CONTROLS_DEFAULTS: MindsControls = { takeover: false, killScope: 'none' }",
    );
    expect(read('supabase/migrations/20261009140000_minds_controls.sql')).toMatch(
      /takeover boolean NOT NULL DEFAULT false/,
    );
  });

  it('the doors are unchanged: sixteen free doors, the four gated channels are not doors, no WhatsApp', () => {
    const sixteen = [
      'telegram',
      'discord',
      'bluesky',
      'mastodon',
      'tumblr',
      'blogger',
      'medium',
      'pixelfed',
      'wordpress_com',
      'youtube',
      'vimeo',
      'podcast',
      'flipboard',
      'google_news',
      'microsoft_start',
      'smartnews',
    ];
    expect([...DOOR_IDS].sort()).toEqual([...sixteen].sort());
    expect([...OPEN_DOORS].sort()).toEqual([...sixteen].sort());
    expect(Object.keys(DOORS).sort()).toEqual([...sixteen].sort());
    for (const gated of ['instagram', 'tiktok', 'facebook', 'pinterest', 'whatsapp']) {
      expect(DOOR_IDS as readonly string[], gated).not.toContain(gated);
    }
  });

  it('the brains are unchanged: eight slots, six tried, Cerebras and DeepSeek skipped', () => {
    expect([...BRAIN_IDS]).toEqual([
      'gemini',
      'groq',
      'nvidia',
      'cloudflare',
      'openrouter',
      'cerebras',
      'huggingface',
      'deepseek',
    ]);
    expect(tryableBrains().map((slot) => slot.id)).toEqual([
      'gemini',
      'groq',
      'nvidia',
      'cloudflare',
      'openrouter',
      'huggingface',
    ]);
    expect(BRAIN_SLOTS.filter((slot) => slot.access === 'skip').map((slot) => slot.id)).toEqual([
      'cerebras',
      'deepseek',
    ]);
  });
});

describe('Phase H itself: this freeze and the older freezes', () => {
  it('this freeze is in the tree, beside the older freezes', () => {
    expect(exists('src/buddy/phaseHFreeze.test.ts')).toBe(true);
    for (const file of [
      'src/buddy/phaseDFreeze.test.ts',
      'src/buddy/phaseEFreeze.test.ts',
      'src/buddy/phaseFFreeze.test.ts',
      'src/buddy/phaseGFreeze.test.ts',
      'src/__tests__/phase8Freeze.test.ts',
    ]) {
      expect(exists(file), file).toBe(true);
    }
  });
});
