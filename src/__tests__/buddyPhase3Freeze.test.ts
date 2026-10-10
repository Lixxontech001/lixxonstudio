// Phase 3 freeze checks. Each test is one promise the owner was given at the end of Phase 3.
// Behaviour is checked with the real pure modules and a fake database and Gemini. Migrations and server files are read as text.
import { describe, expect, it, vi } from 'vitest';
import buddyThinkSource from '../../supabase/functions/_shared/buddyThink.ts?raw';
import functionSource from '../../supabase/functions/minds-run-placement/index.ts?raw';
import pushServerSource from '../../supabase/functions/_shared/notablePushServer.ts?raw';
import placementSource from '../../supabase/functions/_shared/productPlacement.ts?raw';
import runSource from '../../supabase/functions/_shared/placementRun.ts?raw';
import briefingSource from '../../supabase/functions/_shared/buddyBriefing.ts?raw';
import chatSource from '../buddy/BuddyChat.tsx?raw';
import changesSource from '../buddy/BuddyChanges.tsx?raw';
import changesStoreSource from '../buddy/buddyChanges.ts?raw';
import { laneFor } from '../../supabase/functions/_shared/buddyOrders';
import { MINDS_CONTROLS_DEFAULTS } from '../buddy/minds/mindsControlsStore';
import { renderMarkdown } from '../lib/markdown';
import { DRIP_DAILY_LIMIT, PRODUCT_CAP, paragraphChecksum, paragraphUnchanged } from '../../supabase/functions/_shared/postEdits';
import {
  NO_KEY_DETAIL,
  auditPlacement,
  paragraphsOf,
  type PlacementCandidate,
  type ShopProduct,
} from '../../supabase/functions/_shared/productPlacement';
import {
  DRIP_HELD_DETAIL,
  lineAfter,
  replaceLine,
  rankArticles,
  runPlacementOrder,
  swapFor,
  type ApplyEdit,
  type KillScope,
  type RunArticle,
  type RunInput,
  type RunLog,
  type RunPorts,
} from '../../supabase/functions/_shared/placementRun';
import type { MindThinkResult } from '../../supabase/functions/_shared/mindThink';

// Every migration written in Phase 2 and Phase 3 (all named 20261009...).
const MIGRATIONS = import.meta.glob('../../supabase/migrations/20261009*.sql', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const ALL_MIGRATION_SQL = Object.values(MIGRATIONS).join('\n');
const APPLY_SQL = Object.entries(MIGRATIONS).find(([path]) => path.includes('minds_apply_placement'))?.[1] ?? '';
const DRIP_SQL = Object.entries(MIGRATIONS).find(([path]) => path.includes('post_drip_days'))?.[1] ?? '';
const SLOTS_SQL = Object.entries(MIGRATIONS).find(([path]) => path.includes('post_product_slots'))?.[1] ?? '';

// A skincare article: a heading, two paragraphs, a list, a blank line, a heading, and one more paragraph.
const ARTICLE = [
  '# Easy Skincare Routine for Dry Skin',
  'Dry skin often feels tight after washing, and it can look dull by midday.',
  'A simple routine helps most people who want calm, comfortable skin.',
  '',
  '## What to look for',
  '- A gentle cleanser',
  '- A plain moisturiser',
  'Start with one change at a time, and give it a few weeks.',
].join('\n');

const SHOP: ShopProduct[] = [
  { id: 'p1', name: 'Calm Skin Routine Guide', isDigital: true, priceUsd: 12 },
  { id: 'p2', name: 'Barrier Repair Checklist', isDigital: true, priceUsd: 7.5 },
  { id: 'p3', name: 'Gentle Foaming Cleanser', isDigital: false, priceUsd: 18.99 },
  { id: 'p4', name: 'Night Cream Sample Pack', isDigital: false, priceUsd: 9 },
];

// The sentences the owner would accept. Reader-facing: warm, calm, plain, no dash, no country, real product names only.
const ALLOWED_FIXTURES = [
  { paragraph: 1, ids: ['p1'], sentences: 'The Calm Skin Routine Guide keeps the morning steps in one easy order.' },
  { paragraph: 2, ids: ['p2', 'p3'], sentences: 'The Barrier Repair Checklist is a calm place to start. Gentle Foaming Cleanser is one simple step to add.' },
  { paragraph: 7, ids: ['p4'], sentences: 'If nights feel harsh, the Night Cream Sample Pack lets you try a small amount first.' },
];

const ARTICLE_ROW: RunArticle = { id: 'post-1', title: 'Easy Skincare Routine for Dry Skin', content: ARTICLE, liveProductIds: [], liveEdits: [] };

function reply(paragraph: number, ids: string[], sentences: string): MindThinkResult {
  return { ok: true, text: JSON.stringify({ paragraph, product_ids: ids, sentences }) };
}

function input(overrides: Partial<RunInput> = {}): RunInput {
  return {
    order: { id: 'order-1', instruction: 'Add a product to the skin guide' },
    localDay: '2026-10-09',
    takeover: true,
    killScope: 'none',
    shop: SHOP,
    articles: [ARTICLE_ROW],
    touchedToday: [],
    ...overrides,
  };
}

function ports(thinkResult: MindThinkResult, applyReason?: string) {
  const logs: RunLog[] = [];
  const fake = {
    think: vi.fn(async (request: { mind: string; system: string; prompt: string }) => {
      expect(request.mind).toBe('strategist');
      return thinkResult;
    }),
    applyEdit: vi.fn(async (edit: ApplyEdit) => {
      expect(edit.orderId).toBe('order-1');
      return applyReason ? { ok: false as const, reason: applyReason } : { ok: true as const };
    }),
    recordGap: vi.fn(async () => ({ ok: true as const })),
    log: vi.fn(async (entry: RunLog) => {
      logs.push(entry);
    }),
    notable: vi.fn(async () => undefined),
  };
  return { ports: fake as typeof fake & RunPorts, logs };
}

describe('Takeover is off by default, and nothing turns it on', () => {
  it('the default is Takeover off', () => {
    expect(MINDS_CONTROLS_DEFAULTS.takeover).toBe(false);
  });

  it('no Phase 2 or Phase 3 migration sets Takeover to true', () => {
    expect(ALL_MIGRATION_SQL).toMatch(/takeover boolean NOT NULL DEFAULT false/);
    expect(ALL_MIGRATION_SQL).not.toMatch(/takeover\s*(=|boolean DEFAULT)\s*true/i);
    expect(ALL_MIGRATION_SQL).not.toMatch(/\(id,\s*takeover[^)]*\)\s*values\s*\([^)]*true/i);
  });

  it('with Takeover off, a run writes nothing and thinks nothing', async () => {
    const { ports: fake } = ports(reply(1, ['p1'], 'The Calm Skin Routine Guide keeps the steps in order.'));
    const out = await runPlacementOrder(input({ takeover: false }), fake);
    expect(out).toEqual({ status: 'held', detail: 'Takeover is off, so nothing changed on the site.' });
    expect(fake.think).not.toHaveBeenCalled();
    expect(fake.applyEdit).not.toHaveBeenCalled();
    expect(fake.recordGap).not.toHaveBeenCalled();
  });
});

describe('Kill blocks every write', () => {
  it.each<KillScope>(['all', 'executioner', 'strategist', 'auditor'])('Kill "%s" stops the run before any write', async (killScope) => {
    const { ports: fake } = ports(reply(1, ['p1'], 'The Calm Skin Routine Guide keeps the steps in order.'));
    const out = await runPlacementOrder(input({ killScope }), fake);
    expect(out.status).toBe('held');
    expect(fake.applyEdit).not.toHaveBeenCalled();
    expect(fake.recordGap).not.toHaveBeenCalled();
  });

  it('the database refuses an apply and a gap unless Kill is none, analyst or ceo', () => {
    expect(APPLY_SQL).toContain("COALESCE(ctrl.kill_scope, 'all') NOT IN ('none', 'analyst', 'ceo')");
    expect(APPLY_SQL).toMatch(/IF NOT FOUND OR ctrl\.takeover IS NOT TRUE THEN/);
  });
});

describe('at most 3 products on an article', () => {
  it('the Auditor blocks a plan with four products', () => {
    const candidate: PlacementCandidate = { paragraphIndex: 1, productIds: ['p1', 'p2', 'p3', 'p4'], sentences: ['Calm Skin Routine Guide and Barrier Repair Checklist help.'] };
    const verdict = auditPlacement(candidate, ARTICLE, SHOP);
    expect(verdict.verdict).toBe('block');
    expect(verdict.reasons).toContain('too many products');
  });

  it('a swap never leaves more than three live products', () => {
    const cases: Array<{ live: string[]; add: string[] }> = [
      { live: [], add: ['p1'] },
      { live: ['p2', 'p3'], add: ['p1'] },
      { live: ['p2', 'p3', 'p4'], add: ['p1'] },
      { live: ['p2', 'p3', 'p4'], add: ['p1', 'p2'] },
    ];
    for (const { live, add } of cases) {
      const article: RunArticle = {
        ...ARTICLE_ROW,
        liveProductIds: live,
        liveEdits: [{ id: 'old', productIds: live, sentencesAdded: 'Old line.' }],
        content: `${ARTICLE.split('\n')[1]} Old line.`,
      };
      const swap = swapFor(article, add, article.content as string);
      if (swap === null) continue;
      expect(live.length - swap.removeProductIds.length + add.length).toBeLessThanOrEqual(PRODUCT_CAP);
    }
    expect(PRODUCT_CAP).toBe(3);
    expect(SLOTS_SQL).toMatch(/IF live >= 3 THEN/);
  });
});

describe('the drip limit: at most 3 articles a day', () => {
  it('a fourth article on the same day is held and nothing is thought or written', async () => {
    const { ports: fake } = ports(reply(1, ['p1'], 'The Calm Skin Routine Guide keeps the steps in order.'));
    const out = await runPlacementOrder(input({ touchedToday: ['a', 'b', 'c'] }), fake);
    expect(out).toEqual({ status: 'held', detail: DRIP_HELD_DETAIL });
    expect(fake.think).not.toHaveBeenCalled();
    expect(fake.applyEdit).not.toHaveBeenCalled();
  });

  it('the limit is 3, and the database refuses a fourth article', () => {
    expect(DRIP_DAILY_LIMIT).toBe(3);
    expect(DRIP_SQL).toMatch(/IF touched >= 3 THEN/);
  });
});

describe('a changed paragraph is refused by its checksum', () => {
  it('a checksum from before the owner edited the paragraph does not match the new text', async () => {
    const original = 'Dry skin often feels tight after washing.';
    const expected = await paragraphChecksum(original);
    expect(await paragraphUnchanged(original, expected)).toEqual({ ok: true });
    expect(await paragraphUnchanged(`${original} Edited.`, expected)).toEqual({ ok: false, reason: 'paragraph_changed' });
  });

  it('a run whose apply is refused for a checksum mismatch is failed, not applied', async () => {
    const { ports: fake } = ports(reply(1, ['p1'], 'The Calm Skin Routine Guide keeps the steps in order.'), 'checksum_mismatch');
    const out = await runPlacementOrder(input(), fake);
    expect(out.status).toBe('failed');
  });

  it('the database refuses a changed paragraph and a checksum that does not match', () => {
    expect(APPLY_SQL).toContain("RAISE EXCEPTION 'paragraph_changed'");
    expect(APPLY_SQL).toContain("RAISE EXCEPTION 'checksum_mismatch'");
  });
});

describe('minds never create a product', () => {
  it('a plan that names a product not in the shop is blocked', async () => {
    const { ports: fake } = ports(reply(1, ['p9'], 'The Imaginary Serum Kit is a calm start.'));
    expect((await runPlacementOrder(input(), fake)).status).toBe('blocked');
    expect(fake.applyEdit).not.toHaveBeenCalled();
  });

  it('an order to create a product is held, not run', () => {
    expect(laneFor('Make a new product for the sleep kit')).toMatchObject({ lane: 'held' });
  });

  it('no Phase 3 code inserts or updates the shop products table', () => {
    for (const source of [runSource, functionSource, placementSource]) {
      expect(source).not.toMatch(/from\(["']products["']\)\s*\.\s*(insert|upsert|update|delete)/);
    }
    expect(ALL_MIGRATION_SQL).not.toMatch(/insert\s+into\s+public\.products/i);
    expect(ALL_MIGRATION_SQL).not.toMatch(/update\s+public\.products/i);
  });

  it('no Phase 3 code writes article text except through the one database function', () => {
    for (const source of [runSource, functionSource, placementSource, buddyThinkSource]) {
      expect(source).not.toMatch(/from\(["']posts["']\)\s*\.\s*update/);
    }
    expect(APPLY_SQL).toContain('UPDATE public.posts SET content = array_to_string(new_lines, E');
  });
});

describe('reader copy: no country, no dash, real product names, USD only', () => {
  it('every allowed fixture passes the Auditor', () => {
    for (const fixture of ALLOWED_FIXTURES) {
      const verdict = auditPlacement({ paragraphIndex: fixture.paragraph, productIds: fixture.ids, sentences: fixture.sentences.split(/(?<=\.)\s+/) }, ARTICLE, SHOP);
      expect(verdict.reasons, fixture.sentences).toEqual([]);
      expect(verdict.verdict).toBe('allow');
    }
  });

  it('no allowed fixture names a country, a city, or a currency other than US dollars', () => {
    for (const fixture of ALLOWED_FIXTURES) {
      expect(fixture.sentences).not.toMatch(/nigeria|nigerian|naira|lagos|abuja|£|€|₦|\bgbp\b|\beur\b|\bngn\b/i);
    }
  });

  it('no allowed fixture has a dash, and the Auditor blocks one', () => {
    for (const fixture of ALLOWED_FIXTURES) expect(fixture.sentences).not.toMatch(/[\u2013\u2014]/);
    const verdict = auditPlacement({ paragraphIndex: 1, productIds: ['p1'], sentences: ['The Calm Skin Routine Guide is calm \u2014 and simple.'] }, ARTICLE, SHOP);
    expect(verdict.reasons).toContain('dash');
  });

  it('the Auditor blocks a country name in new text', () => {
    const verdict = auditPlacement({ paragraphIndex: 1, productIds: ['p1'], sentences: ['The Calm Skin Routine Guide is loved in Lagos.'] }, ARTICLE, SHOP);
    expect(verdict.reasons).toContain('country');
  });

  it('the new copy in the server and the Changes screen has no dash and no country name', () => {
    for (const source of [runSource, briefingSource, changesSource, changesStoreSource, functionSource]) {
      expect(source).not.toMatch(/[\u2013\u2014]/);
      expect(source).not.toMatch(/nigeria|naira|lagos|abuja/i);
    }
  });

  it('the Strategist asks for no dash and no country, and uses US dollars for prices', () => {
    const plan = placementSource;
    expect(plan).toContain('Never use a dash character.');
    expect(plan).toContain('Never name a country or a city.');
    expect(plan).toContain('exact US dollar price');
  });

  it('a plan that uses no paragraph the article has is blocked, so nothing outside the article is touched', () => {
    const verdict = auditPlacement({ paragraphIndex: 99, productIds: ['p1'], sentences: ['The Calm Skin Routine Guide is calm.'] }, ARTICLE, SHOP);
    expect(verdict.reasons).toContain('not a paragraph');
  });
});

describe('only the chosen paragraph changes', () => {
  it('every other line and its checksum stay the same, and the chosen paragraph gains only the new sentences', async () => {
    const { ports: fake } = ports(reply(1, ['p1'], 'The Calm Skin Routine Guide keeps the morning steps in one easy order.'));
    const out = await runPlacementOrder(input(), fake);
    expect(out.status).toBe('applied');
    const edit = fake.applyEdit.mock.calls[0][0];

    const before = ARTICLE.split('\n');
    const after = replaceLine(ARTICLE, edit.lineIndex, edit.afterLine).split('\n');
    expect(after).toHaveLength(before.length);
    for (let index = 0; index < before.length; index += 1) {
      if (index === edit.lineIndex) continue;
      expect(after[index]).toBe(before[index]);
      expect(await paragraphChecksum(after[index])).toBe(await paragraphChecksum(before[index]));
    }
    expect(edit.afterLine.startsWith(before[edit.lineIndex])).toBe(true);
    expect(edit.afterLine.slice(before[edit.lineIndex].length).trim()).toBe('The Calm Skin Routine Guide keeps the morning steps in one easy order.');
  });

  it('a swap removes only the minds sentences in that paragraph and keeps the rest of it', () => {
    const old = 'The Barrier Repair Checklist keeps nights simple.';
    const line = `Dry skin often feels tight. ${old}`;
    expect(lineAfter(line, [old], ['The Calm Skin Routine Guide keeps mornings simple.'])).toBe(
      'Dry skin often feels tight. The Calm Skin Routine Guide keeps mornings simple.',
    );
  });
});

describe('the magazine renders the applied sentences', () => {
  it('after an apply, the reader page shows the new sentence in the same paragraph and nothing else new', async () => {
    const { ports: fake } = ports(reply(1, ['p1'], 'The Calm Skin Routine Guide keeps the morning steps in one easy order.'));
    await runPlacementOrder(input(), fake);
    const edit = fake.applyEdit.mock.calls[0][0];
    const applied = replaceLine(ARTICLE, edit.lineIndex, edit.afterLine);

    const beforeHtml = renderMarkdown(ARTICLE);
    const afterHtml = renderMarkdown(applied);
    expect(afterHtml).toContain('The Calm Skin Routine Guide keeps the morning steps in one easy order.');
    expect(beforeHtml).not.toContain('The Calm Skin Routine Guide keeps the morning steps');
    expect(afterHtml.match(/<h2/g)?.length ?? 0).toBe(beforeHtml.match(/<h2/g)?.length ?? 0);
    expect(afterHtml.match(/<li/g)?.length ?? 0).toBe(beforeHtml.match(/<li/g)?.length ?? 0);
    expect(paragraphsOf(applied).map((item) => item.index)).toEqual(paragraphsOf(ARTICLE).map((item) => item.index));
  });
});

describe('Buddy, not the minds, is the voice; the owner cannot chat with a mind', () => {
  it('the Buddy page has no screen for talking to a mind', () => {
    expect(chatSource).toMatch(/type Phase = 'greeting' \| 'chat' \| 'reports' \| 'changes' \| 'settings';/);
    expect(chatSource).not.toMatch(/strategist|executioner|auditor/i);
  });

  it('the Changes screen has no text box', () => {
    expect(changesSource).not.toMatch(/<textarea|<input/);
  });

  it('the Strategist, Executioner and Auditor send no email and no text of their own; a buzz goes out only through the shared notification helper, titled Buddy', () => {
    expect(runSource).not.toMatch(/sendEmail|sendMessage|sendPushNotification/);
    expect(functionSource).not.toMatch(/sendEmail|distributionAdapters|sendPushNotification/);
    // Phase E: the day run records through attemptRow, and attemptRow is the one path that calls the shared helper.
    expect(functionSource).toContain('attemptRow(');
    expect(pushServerSource).toContain('notifyOwnerDevices(');
  });
});

describe('the model and the key stay as they were', () => {
  it('the Gemini model is still gemini-3.8-flash', () => {
    expect(buddyThinkSource).toContain('gemini-3.8-flash');
  });

  it('no Phase 3 file names the key in a reply or a log', () => {
    expect(functionSource).not.toMatch(/return reply\([^)]*key/i);
    expect(runSource).not.toMatch(/gemini_api_key|apiKey/);
  });

  it('with no key, the planner says "Cannot think: no Google key." and writes nothing', async () => {
    const { ports: fake } = ports({ ok: false, reason: 'no_key' });
    const out = await runPlacementOrder(input(), fake);
    expect(out).toEqual({ status: 'cannot_think', detail: NO_KEY_DETAIL });
    expect(fake.applyEdit).not.toHaveBeenCalled();
  });
});

describe('the ranking puts the best-fit article first', () => {
  it('an article that matches a shop product comes before one that does not', () => {
    const food: RunArticle = { id: 'food', title: 'Weeknight pasta ideas', content: 'Quick sauces for busy evenings.', liveProductIds: [], liveEdits: [] };
    expect(rankArticles([food, ARTICLE_ROW], SHOP)[0].id).toBe('post-1');
  });
});
