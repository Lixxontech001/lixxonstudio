import { describe, expect, it, vi } from 'vitest';
import {
  CHANNEL_WINDOWS,
  NO_KEY_COPY_DETAIL,
  PIN_DESCRIPTION_LIMIT,
  PIN_TITLE_LIMIT,
  CAPTION_LIMIT,
  TIME_WINDOWS,
  auditCopy,
  buildCopyPrompt,
  choosePackArticle,
  chooseProductsForCopy,
  parseCopyReply,
  planPackCopy,
  sameTextKey,
  suggestedTimeFor,
  timeOptionsFor,
  timeProblem,
  type PackCopy,
} from '../../supabase/functions/_shared/packCopy';
import { copyProblem, PACK_CHANNELS } from '../../supabase/functions/_shared/packRules';
import type { ShopProduct } from '../../supabase/functions/_shared/productPlacement';

const SHOP: ShopProduct[] = [
  { id: 'p1', name: 'Calm Skin Routine Guide', isDigital: true, priceUsd: 12 },
  { id: 'p2', name: 'Gentle Foaming Cleanser', isDigital: false, priceUsd: 18 },
  { id: 'p3', name: 'Barrier Repair Checklist', isDigital: true, priceUsd: 9 },
];

const GOOD: PackCopy = {
  instagram: 'Dry skin feels tight by midday. A calm routine keeps the steps in one easy order.',
  tiktok: 'Three steps, one at a time. The Calm Skin Routine Guide shows the order.',
  facebook: 'If your skin feels dull after washing, start with one change at a time.',
  pinterest: { title: 'Calm routine for dry skin', description: 'A gentle morning routine for dry skin, step by step.' },
};

/** A think function that answers once with the given text. */
function thinkReturning(text: string) {
  return vi.fn(async () => ({ ok: true as const, text }));
}

function asJson(copy: PackCopy): string {
  return JSON.stringify(copy);
}

describe('pack copy: a Google key is needed to write it', () => {
  it('no key: the plan says so, and no copy is made', async () => {
    const think = vi.fn(async () => ({ ok: false as const, reason: 'no_key' as const }));
    const plan = await planPackCopy({ title: 'Easy Skincare Routine' }, SHOP, think);
    expect(plan).toEqual({ status: 'cannot_think', detail: NO_KEY_COPY_DETAIL, copy: null, verdict: null });
    expect(NO_KEY_COPY_DETAIL).toBe('Cannot think: no Google key.');
    expect(think).toHaveBeenCalledTimes(1);
  });

  it('a rejected or unavailable call is a plain failure with nothing saved', async () => {
    const think = vi.fn(async () => ({ ok: false as const, reason: 'unavailable' as const }));
    const plan = await planPackCopy({ title: 'Easy Skincare Routine' }, SHOP, think);
    expect(plan.status).toBe('failed');
    expect(plan.copy).toBeNull();
  });

  it('an answer that is not the four texts is a failure, never a guess', async () => {
    const plan = await planPackCopy({ title: 'x' }, SHOP, thinkReturning('Sure, here is some copy.'));
    expect(plan.status).toBe('failed');
    expect(plan.copy).toBeNull();
  });
});

describe('pack copy: a good answer is planned, a bad one is blocked', () => {
  it('a clean answer with four different texts is planned', async () => {
    const plan = await planPackCopy({ title: 'Easy Skincare Routine' }, SHOP, thinkReturning(asJson(GOOD)));
    expect(plan.status).toBe('planned');
    expect(plan.copy).toEqual(GOOD);
    expect(plan.verdict?.verdict).toBe('allow');
  });

  it('fenced JSON is accepted', async () => {
    const plan = await planPackCopy({ title: 'x' }, SHOP, thinkReturning('```json\n' + asJson(GOOD) + '\n```'));
    expect(plan.status).toBe('planned');
  });

  it('Instagram equal to TikTok fails the Auditor, and TikTok is the blocked channel', async () => {
    const copy = { ...GOOD, tiktok: GOOD.instagram };
    const plan = await planPackCopy({ title: 'x' }, SHOP, thinkReturning(asJson(copy)));
    expect(plan.status).toBe('blocked');
    expect(plan.verdict?.blockedChannels).toEqual(['tiktok']);
    expect(plan.verdict?.fix).toMatch(/same text as Instagram caption/);
  });

  it('the Pinterest title and description must differ', () => {
    const verdict = auditCopy({ ...GOOD, pinterest: { title: 'Same words', description: 'same   words!' } }, SHOP);
    expect(verdict.verdict).toBe('block');
    expect(verdict.blockedChannels).toEqual(['pinterest']);
  });

  it('two captions that differ only by case or punctuation are still the same', () => {
    expect(sameTextKey('Hello, World!')).toBe(sameTextKey('hello world'));
    const verdict = auditCopy({ ...GOOD, facebook: GOOD.instagram.toUpperCase() }, SHOP);
    expect(verdict.blockedChannels).toEqual(['facebook']);
  });

  it('a dash, a country name, or non-US money is blocked on that channel', () => {
    expect(auditCopy({ ...GOOD, instagram: 'A calm routine \u2014 for you.' }, SHOP).blockedChannels).toEqual(['instagram']);
    expect(auditCopy({ ...GOOD, tiktok: 'Made for readers in Nigeria.' }, SHOP).blockedChannels).toEqual(['tiktok']);
    expect(auditCopy({ ...GOOD, facebook: 'It costs \u00a39 today.' }, SHOP).blockedChannels).toEqual(['facebook']);
    expect(auditCopy({ ...GOOD, facebook: 'Costs 9 GBP today.' }, SHOP).blockedChannels).toEqual(['facebook']);
  });

  it('a health promise or a claim of a personal test is blocked', () => {
    expect(auditCopy({ ...GOOD, instagram: 'This cream cures dry skin for good.' }, SHOP).blockedChannels).toEqual(['instagram']);
    expect(auditCopy({ ...GOOD, tiktok: 'A dermatologist recommended this routine.' }, SHOP).blockedChannels).toEqual(['tiktok']);
    expect(auditCopy({ ...GOOD, facebook: 'I tested this for a month and it worked.' }, SHOP).blockedChannels).toEqual(['facebook']);
  });

  it('a product name that is not in the shop is blocked (invented product)', () => {
    const verdict = auditCopy({ ...GOOD, instagram: 'Try the Ultimate Sleep Planner today.' }, SHOP);
    expect(verdict.blockedChannels).toEqual(['instagram']);
    expect(verdict.fix).toMatch(/Ultimate Sleep Planner/);
  });

  it('a shop product name, with an article word in front, is fine', () => {
    const verdict = auditCopy({ ...GOOD, instagram: 'The Calm Skin Routine Guide keeps the steps in order.' }, SHOP);
    expect(verdict.verdict).toBe('allow');
  });

  it('captions over the limit are blocked, and pin limits are enforced', () => {
    const long = 'a'.repeat(CAPTION_LIMIT + 1);
    expect(auditCopy({ ...GOOD, instagram: long }, SHOP).blockedChannels).toEqual(['instagram']);
    expect(auditCopy({ ...GOOD, pinterest: { title: 'b'.repeat(PIN_TITLE_LIMIT + 1), description: 'Short.' } }, SHOP).blockedChannels).toEqual(['pinterest']);
    expect(auditCopy({ ...GOOD, pinterest: { title: 'Short', description: 'c'.repeat(PIN_DESCRIPTION_LIMIT + 1) } }, SHOP).blockedChannels).toEqual(['pinterest']);
  });

  it('an empty caption is blocked', () => {
    expect(auditCopy({ ...GOOD, facebook: '   ' }, SHOP).blockedChannels).toEqual(['facebook']);
  });

  it('markup and links are blocked', () => {
    expect(auditCopy({ ...GOOD, tiktok: 'Read more at https://example.com today.' }, SHOP).blockedChannels).toEqual(['tiktok']);
  });

  it('every blocked channel is listed, in the channel order', () => {
    // Instagram keeps its text, so TikTok is the duplicate. Facebook has non-US money.
    const verdict = auditCopy({ ...GOOD, tiktok: GOOD.instagram, facebook: 'It costs \u00a39.' }, SHOP);
    expect(verdict.blockedChannels).toEqual(['tiktok', 'facebook']);
  });
});

describe('pack copy: the prompt and the reply', () => {
  it('the prompt lists the digital product first and never asks for a dash', () => {
    const { system, prompt } = buildCopyPrompt('Easy Skincare Routine', SHOP);
    expect(prompt.indexOf('Calm Skin Routine Guide')).toBeLessThan(prompt.indexOf('Gentle Foaming Cleanser'));
    expect(system).toMatch(/No dashes of any kind/);
    expect(system).toMatch(/Use only the product names you are given/);
    expect(system).toMatch(/US dollars only/);
  });

  it('with no product, the prompt says to write about the article only', () => {
    expect(buildCopyPrompt('Easy Skincare Routine', []).prompt).toMatch(/Write about the article only/);
  });

  it('a reply with extra text around it is not used', () => {
    expect(parseCopyReply(`Here: ${asJson(GOOD)}`)).toBeNull();
    expect(parseCopyReply(JSON.stringify({ instagram: 'x' }))).toBeNull();
    expect(parseCopyReply(asJson(GOOD))).toEqual(GOOD);
  });

  it('the copy checks agree with the database copy rule', () => {
    expect(copyProblem('Costs 9 GBP')).toBe('copy_not_clean');
    expect(copyProblem('Clean words.')).toBeNull();
  });
});

describe('pack products: digital first, at most three', () => {
  it('digital products come first and the list is capped at three', () => {
    const many: ShopProduct[] = [
      { id: 'a', name: 'Physical A', isDigital: false, priceUsd: 1 },
      { id: 'b', name: 'Digital B', isDigital: true, priceUsd: 1 },
      { id: 'c', name: 'Digital C', isDigital: true, priceUsd: 1 },
      { id: 'd', name: 'Physical D', isDigital: false, priceUsd: 1 },
    ];
    expect(chooseProductsForCopy(many).map((p) => p.id)).toEqual(['b', 'c', 'a']);
  });
});

describe('pack article: a digital article is preferred', () => {
  it('while any article has a live digital product, a physical-only article is not chosen', () => {
    const physicalHeavy = { id: 'phys', title: 'Physical', liveProducts: [{ id: 'x', isDigital: false }, { id: 'y', isDigital: false }] };
    const digital = { id: 'dig', title: 'Digital', liveProducts: [{ id: 'z', isDigital: true }] };
    expect(choosePackArticle([physicalHeavy, digital])?.id).toBe('dig');
  });

  it('with no digital article, the article with the most live products is chosen', () => {
    const one = { id: 'one', title: 'One', liveProducts: [{ id: 'x', isDigital: false }] };
    const two = { id: 'two', title: 'Two', liveProducts: [{ id: 'y', isDigital: false }, { id: 'z', isDigital: false }] };
    expect(choosePackArticle([one, two])?.id).toBe('two');
  });

  it('an article with no live product is never chosen, and no article means nothing', () => {
    expect(choosePackArticle([{ id: 'none', title: 'None', liveProducts: [] }])).toBeNull();
    expect(choosePackArticle([])).toBeNull();
  });

  it('among digital articles, the one with more digital products wins', () => {
    const a = { id: 'a', title: 'A', liveProducts: [{ id: '1', isDigital: true }] };
    const b = { id: 'b', title: 'B', liveProducts: [{ id: '2', isDigital: true }, { id: '3', isDigital: true }] };
    expect(choosePackArticle([a, b])?.id).toBe('b');
  });
});

describe('pack times: top-country windows, stored as UTC, with plain labels', () => {
  it('every channel has at least two windows to pick from', () => {
    for (const channel of PACK_CHANNELS) expect(timeOptionsFor(channel).length).toBeGreaterThanOrEqual(2);
  });

  it('the first window is the suggestion, and it is a real UTC time on the local day', () => {
    const suggestion = suggestedTimeFor('instagram', '2026-10-10');
    expect(suggestion).toEqual({ atUtc: '2026-10-10T13:00:00.000Z', label: 'Morning, US Eastern', windowId: 'us-east-morning' });
  });

  it('the picker can choose another offered window', () => {
    const chosen = suggestedTimeFor('pinterest', '2026-10-10', 'sg-evening');
    expect(chosen?.atUtc).toBe('2026-10-10T11:00:00.000Z');
    expect(chosen?.label).toBe('Evening, Singapore');
  });

  it('a window not offered for that channel is refused', () => {
    expect(suggestedTimeFor('facebook', '2026-10-10', 'sg-evening')).toBeNull();
    expect(timeProblem('facebook', '2026-10-10T11:00:00.000Z', 'sg-evening')).toBe('time_not_offered');
  });

  it('a bad day is refused', () => {
    expect(suggestedTimeFor('instagram', '10/10/2026')).toBeNull();
    expect(suggestedTimeFor('instagram', '2026-02-31x')).toBeNull();
  });

  it('a time that does not match its window is refused', () => {
    expect(timeProblem('instagram', '2026-10-10T13:00:00.000Z', 'us-east-morning')).toBeNull();
    expect(timeProblem('instagram', '2026-10-10T14:00:00.000Z', 'us-east-morning')).toBe('time_mismatch');
  });

  it('the labels never name Lagos, Nigeria, WAT, or any non-listed country, and pass the copy rule', () => {
    for (const window of TIME_WINDOWS) {
      expect(copyProblem(window.label), window.label).toBeNull();
      expect(window.label).not.toMatch(/lagos|nigeria|wat\b|naira/i);
    }
    const allowed = /(US|UK|Ireland|Australia|New Zealand|Singapore|Canada)/;
    for (const window of TIME_WINDOWS) expect(window.label).toMatch(allowed);
  });

  it('every window a channel offers exists', () => {
    for (const channel of PACK_CHANNELS) {
      for (const id of CHANNEL_WINDOWS[channel]) expect(TIME_WINDOWS.some((window) => window.id === id)).toBe(true);
    }
  });
});
