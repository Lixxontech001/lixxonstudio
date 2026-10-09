import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  NO_KEY_DETAIL,
  auditPlacement,
  buildPlacementPrompt,
  paragraphsOf,
  parsePlacementReply,
  planPlacement,
  sentencesOf,
  type PlacementCandidate,
  type ShopProduct,
} from '../../supabase/functions/_shared/productPlacement';

// A skincare article. Line 0 is the heading, lines 1 and 2 are paragraphs, line 3 is blank,
// line 4 is a heading, lines 5 and 6 are list items, line 8 is a paragraph.
const ARTICLE = [
  '# Easy Skincare Routine for Dry Skin',
  'Dry skin often feels tight after washing, and it can look dull by midday.',
  'A simple routine helps most people who want calm, comfortable skin.',
  '',
  '## What to look for',
  '- A gentle cleanser',
  '- A plain moisturiser',
  '',
  'Start with one change at a time, and give it a few weeks.',
].join('\n');

// Two digital products and two physical ones. Prices are US dollars from the shop's cents.
const SHOP: ShopProduct[] = [
  { id: 'p1', name: 'Calm Skin Routine Guide', isDigital: true, priceUsd: 12 },
  { id: 'p2', name: 'Barrier Repair Checklist', isDigital: true, priceUsd: 7.5 },
  { id: 'p3', name: 'Gentle Foaming Cleanser', isDigital: false, priceUsd: 18.99 },
  { id: 'p4', name: 'Night Cream Sample Pack', isDigital: false, priceUsd: 9 },
];

const GOOD: PlacementCandidate = {
  paragraphIndex: 2,
  productIds: ['p1', 'p2'],
  sentences: [
    'If you want a clear plan, the Calm Skin Routine Guide walks you through it step by step.',
    'The Barrier Repair Checklist is a short list you can keep by the sink.',
  ],
};

function audit(overrides: Partial<PlacementCandidate>) {
  return auditPlacement({ ...GOOD, ...overrides }, ARTICLE, SHOP);
}

describe('paragraphs of the article', () => {
  it('takes only plain text lines, each with its own line number', () => {
    expect(paragraphsOf(ARTICLE)).toEqual([
      { index: 1, text: 'Dry skin often feels tight after washing, and it can look dull by midday.' },
      { index: 2, text: 'A simple routine helps most people who want calm, comfortable skin.' },
      { index: 8, text: 'Start with one change at a time, and give it a few weeks.' },
    ]);
  });

  it('splits sentences on full stops, question marks and exclamation marks', () => {
    expect(sentencesOf('One thing. Two things? Three!')).toEqual(['One thing.', 'Two things?', 'Three!']);
  });
});

describe('the Auditor allows a good plan', () => {
  it('allows one paragraph, two digital products, and two plain sentences with the shop names', () => {
    expect(audit({})).toEqual({ verdict: 'allow', fix: '', reasons: [] });
  });

  it('allows a single affiliate product, so digital is preferred but never required', () => {
    expect(audit({ productIds: ['p3'], sentences: ['A gentle cleanser like the Gentle Foaming Cleanser can be a calm first step.'] }).verdict).toBe('allow');
  });

  it('allows the exact shop price, written in dollars', () => {
    const verdict = audit({
      sentences: ['The Calm Skin Routine Guide costs $12.00 and walks you through the basics.'],
      productIds: ['p1'],
    });
    expect(verdict.verdict).toBe('allow');
  });
});

describe('the Auditor blocks what the owner ruled out', () => {
  it('blocks four products on one article, with a plain fix', () => {
    const verdict = audit({ productIds: ['p1', 'p2', 'p3', 'p4'] });
    expect(verdict.verdict).toBe('block');
    expect(verdict.reasons).toContain('too many products');
    expect(verdict.fix).toContain('three products or fewer');
  });

  it('blocks an em dash', () => {
    const verdict = audit({ sentences: ['The Calm Skin Routine Guide helps — step by step.', 'The Barrier Repair Checklist is short.'] });
    expect(verdict.reasons).toContain('dash');
  });

  it('blocks an en dash too', () => {
    expect(audit({ sentences: ['The Calm Skin Routine Guide helps – step by step.', 'The Barrier Repair Checklist is short.'] }).reasons).toContain('dash');
  });

  it('blocks Nigeria, Naira and Lagos in any form', () => {
    for (const phrase of ['for readers in Nigeria', 'priced in Naira', 'a shop in Lagos']) {
      const verdict = audit({ sentences: [`The Calm Skin Routine Guide suits readers ${phrase}.`, 'The Barrier Repair Checklist is short.'] });
      expect(verdict.reasons, phrase).toContain('country');
      expect(verdict.verdict).toBe('block');
    }
  });

  it('blocks a product that is not in the shop, and says to create it yourself', () => {
    const verdict = audit({ productIds: ['p1', 'p9'] });
    expect(verdict.reasons).toContain('not in shop');
    expect(verdict.fix).toContain('Create it yourself');
  });

  it('blocks a 200-word rewrite: too many sentences and too many words', () => {
    const filler = 'This line keeps going with plain words that a reader can follow without any strain at all';
    const long = `${'The Calm Skin Routine Guide helps. '}${filler} ${filler} ${filler}. ${filler} ${filler} ${filler}. ${filler} ${filler}.`;
    const verdict = audit({ sentences: sentencesOf(long) });
    expect(verdict.reasons).toEqual(expect.arrayContaining(['too many sentences', 'too long']));
    expect(verdict.verdict).toBe('block');
  });

  it('blocks a price that is not the shop price', () => {
    expect(audit({ sentences: ['The Calm Skin Routine Guide is $15.00 today.', 'The Barrier Repair Checklist is short.'] }).reasons).toContain('price');
  });

  it('blocks money that is not US dollars', () => {
    expect(audit({ sentences: ['The Calm Skin Routine Guide is £10 in some places.', 'The Barrier Repair Checklist is short.'] }).reasons).toContain('currency');
  });

  it('blocks a cure or a medical promise', () => {
    expect(audit({ sentences: ['The Calm Skin Routine Guide cures dry skin fast.', 'The Barrier Repair Checklist is short.'] }).reasons).toContain('medical');
    expect(audit({ sentences: ['A dermatologist recommended the Calm Skin Routine Guide.', 'The Barrier Repair Checklist is short.'] }).reasons).toContain('medical');
  });

  it('blocks an invented personal test', () => {
    expect(audit({ sentences: ['I tested the Calm Skin Routine Guide myself and it worked.', 'The Barrier Repair Checklist is short.'] }).reasons).toContain('personal claim');
  });

  it('blocks a sentence that is already in the article', () => {
    const verdict = audit({ sentences: ['A simple routine helps most people who want calm, comfortable skin.', 'The Calm Skin Routine Guide is a good place to read.'] });
    expect(verdict.reasons).toContain('repeat');
  });

  it('blocks text that does not name the product as it appears in the shop', () => {
    expect(audit({ sentences: ['A short guide can make the first week easier.', 'A checklist can keep you on track.'] }).reasons).toContain('not named');
  });

  it('blocks a place that is a heading, a list item, or a blank line', () => {
    for (const paragraphIndex of [0, 4, 5, 3]) {
      expect(audit({ paragraphIndex }).reasons, `line ${paragraphIndex}`).toContain('not a paragraph');
    }
  });

  it('blocks markup in the sentences', () => {
    expect(audit({ sentences: ['The <b>Calm Skin Routine Guide</b> helps.', 'The Barrier Repair Checklist is short.'] }).reasons).toContain('markup');
  });
});

describe('the Strategist reply is read strictly', () => {
  it('finds the JSON inside a sentence of prose', () => {
    const reply = 'Here is my plan: {"paragraph": 2, "product_ids": ["p1"], "sentences": "The Calm Skin Routine Guide is a calm start."} Thanks.';
    expect(parsePlacementReply(reply)).toEqual({
      paragraphIndex: 2,
      productIds: ['p1'],
      sentences: ['The Calm Skin Routine Guide is a calm start.'],
    });
  });

  it('refuses a reply with no clear shape', () => {
    expect(parsePlacementReply('Sorry, I cannot help with that.')).toBeNull();
    expect(parsePlacementReply('{"paragraph": "two", "product_ids": [], "sentences": "x"}')).toBeNull();
    expect(parsePlacementReply('{"paragraph": 2, "product_ids": "p1", "sentences": "x"}')).toBeNull();
    expect(parsePlacementReply('{"paragraph": 2, "product_ids": ["p1"], "sentences": ""}')).toBeNull();
  });
});

describe('making a plan', () => {
  const goodReply = JSON.stringify({
    paragraph: 2,
    product_ids: ['p1', 'p2'],
    sentences: 'If you want a clear plan, the Calm Skin Routine Guide walks you through it step by step. The Barrier Repair Checklist is a short list you can keep by the sink.',
  });
  const article = { id: 'post-1', title: 'Easy Skincare Routine for Dry Skin', content: ARTICLE };

  it('is planned and allowed when the Strategist gives a clean plan', async () => {
    const think = vi.fn(async () => ({ ok: true as const, text: goodReply }));
    const plan = await planPlacement(article, SHOP, think);
    expect(plan.status).toBe('planned');
    expect(plan.verdict?.verdict).toBe('allow');
    expect(plan.candidate?.paragraphIndex).toBe(2);
    expect(think).toHaveBeenCalledTimes(1);
  });

  it('says Cannot think when there is no Google key, and plans nothing', async () => {
    const think = vi.fn(async () => ({ ok: false as const, reason: 'no_key' as const }));
    const plan = await planPlacement(article, SHOP, think);
    expect(plan).toEqual({ status: 'cannot_think', detail: NO_KEY_DETAIL, candidate: null, verdict: null });
    expect(NO_KEY_DETAIL).toBe('Cannot think: no Google key.');
  });

  it('fails honestly when Google is limiting or unavailable, and plans nothing', async () => {
    for (const reason of ['rate_limited', 'unavailable', 'rejected', 'empty'] as const) {
      const plan = await planPlacement(article, SHOP, async () => ({ ok: false as const, reason }));
      expect(plan.status, reason).toBe('failed');
      expect(plan.candidate).toBeNull();
    }
  });

  it('fails when the reply is not usable', async () => {
    const plan = await planPlacement(article, SHOP, async () => ({ ok: true as const, text: 'Nice article!' }));
    expect(plan.status).toBe('failed');
  });

  it('reports no fit when the Strategist finds no honest place', async () => {
    const plan = await planPlacement(article, SHOP, async () => ({ ok: true as const, text: '{"paragraph": -1, "product_ids": [], "sentences": ""}' }));
    expect(plan.status).toBe('no_fit');
    expect(plan.candidate).toBeNull();
  });

  it('is blocked, with the Auditor fix, when the plan breaks a rule', async () => {
    const bad = JSON.stringify({ paragraph: 2, product_ids: ['p1', 'p2', 'p3', 'p4'], sentences: 'The Calm Skin Routine Guide helps.' });
    const plan = await planPlacement(article, SHOP, async () => ({ ok: true as const, text: bad }));
    expect(plan.status).toBe('blocked');
    expect(plan.detail).toContain('three products or fewer');
  });

  it('does not call Google when the shop has no active products', async () => {
    const think = vi.fn(async () => ({ ok: true as const, text: goodReply }));
    const plan = await planPlacement(article, [], think);
    expect(plan.status).toBe('no_fit');
    expect(think).not.toHaveBeenCalled();
  });
});

describe('the brief to the Strategist', () => {
  const { system, prompt } = buildPlacementPrompt('Easy Skincare Routine for Dry Skin', ARTICLE, SHOP);

  it('shows the paragraphs with their line numbers, and the shop with USD prices', () => {
    expect(prompt).toContain('[2] A simple routine helps most people who want calm, comfortable skin.');
    expect(prompt).toContain('p1 | Calm Skin Routine Guide | digital | $12.00');
    expect(prompt).toContain('p3 | Gentle Foaming Cleanser | product | $18.99');
  });

  it('asks for JSON only, and carries the no-dash and no-country rules', () => {
    expect(system).toContain('Reply with JSON only');
    expect(system).not.toMatch(/[\u2014\u2013]/);
    expect(system).toContain('Never name a country or a city.');
  });

  it('never carries a country name into the brief', () => {
    expect(`${system}\n${prompt}`).not.toMatch(/nigeria|naira|lagos/i);
  });
});

describe('this slice never writes to an article', () => {
  it('the planner module has no database write, no update and no insert', () => {
    const source = readFileSync('supabase/functions/_shared/productPlacement.ts', 'utf8');
    expect(source).not.toMatch(/\.update\(|\.insert\(|\.upsert\(|\.delete\(|\.rpc\(|\bUPDATE\s|\bINSERT\s+INTO/i);
    expect(source).not.toMatch(/\.from\(/);
  });
});
