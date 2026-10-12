import { describe, expect, it, vi } from 'vitest';
import {
  PRICE_LEFT_ALONE,
  auditPriceChange,
  buildPricePrompt,
  fixPriceOnce,
  parsePriceReply,
  planPriceChange,
  type PriceCandidate,
  type PriceProduct,
} from '../../supabase/functions/_shared/priceChanges';
import type { MindThinkResult } from '../../supabase/functions/_shared/mindThink';

const SHEET: PriceProduct = { id: 'p1', name: 'Linen Bath Sheet', priceUsd: 34, currency: 'USD' };

const GOOD: PriceCandidate = { productId: 'p1', priceUsd: 29.5, why: 'It sells well and the price is high against the rest of the range.' };

function thinkWith(text: string) {
  return vi.fn(async (): Promise<MindThinkResult> => ({ ok: true, text }));
}

describe('the price brief the Strategist reads', () => {
  it('carries the shop with US dollar prices, the facts, and the one-change rules', () => {
    const { system, prompt } = buildPricePrompt([SHEET, { ...SHEET, id: 'p2', name: 'Cotton Towel', priceUsd: null }], 'Facts line.');
    expect(system).toContain('US dollars');
    expect(system).toContain('Never write a price of nothing');
    expect(system).toContain('a quarter at most');
    expect(prompt).toContain('p1 | Linen Bath Sheet | $34.00');
    expect(prompt).toContain('p2 | Cotton Towel | no price');
    expect(prompt).toContain('SITE FACTS: Facts line.');
  });

  it('reads the agreed shape, and nothing else: a reply it cannot read changes nothing', () => {
    expect(parsePriceReply('```json\n{"product_id":"p1","price":29.5,"why":"Because."}\n```')).toEqual({ productId: 'p1', priceUsd: 29.5, why: 'Because.' });
    expect(parsePriceReply('{"product_id":"p1","price":"29.5","why":"Because."}')).toEqual({ productId: 'p1', priceUsd: 29.5, why: 'Because.' });
    expect(parsePriceReply('I think the price should stay as it is.')).toBeNull();
    expect(parsePriceReply('{"product_id":"","price":0,"why":""}')).toBeNull();
    expect(parsePriceReply('{"product_id":"p1","price":"free","why":""}')).toBeNull();
  });
});

describe('the Auditor checks every price change', () => {
  it('allows a plain US dollar change with a real reason', () => {
    expect(auditPriceChange(GOOD, SHEET)).toEqual({ verdict: 'allow', fix: '', reasons: [] });
  });

  it('blocks nothing, free, negative and a price that is not dollars and cents', () => {
    expect(auditPriceChange({ ...GOOD, priceUsd: 0 }, SHEET).reasons).toContain('free');
    expect(auditPriceChange({ ...GOOD, priceUsd: -5 }, SHEET).reasons).toContain('free');
    expect(auditPriceChange({ ...GOOD, priceUsd: 29.555 }, SHEET).reasons).toContain('bad price');
    expect(auditPriceChange({ ...GOOD, priceUsd: Number.NaN }, SHEET).reasons).toContain('bad price');
  });

  it('blocks a currency that is not US dollars, and a product with no price to change', () => {
    expect(auditPriceChange(GOOD, { ...SHEET, currency: 'NGN' }).reasons).toContain('currency');
    expect(auditPriceChange(GOOD, { ...SHEET, currency: 'GBP' }).reasons).toContain('currency');
    expect(auditPriceChange(GOOD, { ...SHEET, priceUsd: null }).reasons).toContain('no price');
    expect(auditPriceChange(GOOD, null).reasons).toContain('not in shop');
  });

  it('blocks a step that is not really a change, and a jump bigger than a quarter', () => {
    expect(auditPriceChange({ ...GOOD, priceUsd: 34 }, SHEET).reasons).toContain('no change');
    expect(auditPriceChange({ ...GOOD, priceUsd: 33.75 }, SHEET).reasons).toContain('no change');
    expect(auditPriceChange({ ...GOOD, priceUsd: 20 }, SHEET).reasons).toContain('big change');
    expect(auditPriceChange({ ...GOOD, priceUsd: 60 }, SHEET).reasons).toContain('big change');
  });

  it('keeps the price inside one dollar and under a thousand', () => {
    expect(auditPriceChange({ ...GOOD, priceUsd: 0.6 }, SHEET).reasons).toContain('too low');
    expect(auditPriceChange({ ...GOOD, priceUsd: 1200 }, SHEET).reasons).toContain('too high');
  });

  it('blocks another money, a country, a dash, markup and a missing reason in the words', () => {
    for (const why of ['Set it against the Naira rate.', 'Costs 20 GBP now.', 'It is £12 elsewhere.']) {
      expect(auditPriceChange({ ...GOOD, why }, SHEET).reasons, why).toContain('money');
    }
    for (const why of ['Cheaper than in Lagos.', 'Lower it for the Lagos shop.']) {
      expect(auditPriceChange({ ...GOOD, why }, SHEET).reasons, why).toContain('country');
    }
    expect(auditPriceChange({ ...GOOD, why: 'Lower it — it is high.' }, SHEET).reasons).toContain('dash');
    expect(auditPriceChange({ ...GOOD, why: '**Lower** it.' }, SHEET).reasons).toContain('markup');
    expect(auditPriceChange({ ...GOOD, why: '   ' }, SHEET).reasons).toContain('no reason');
    expect(auditPriceChange({ ...GOOD, why: 'a'.repeat(300) }, SHEET).reasons).toContain('too long');
  });

  it('the fix says what to change, in plain words, and every reason is named once', () => {
    const verdict = auditPriceChange({ productId: 'p1', priceUsd: 0, why: '' }, SHEET);
    expect(verdict.verdict).toBe('block');
    expect(verdict.fix).toContain('A price of nothing is not a price');
    expect(verdict.fix).toContain('Write one short sentence for why this price moves.');
    expect(new Set(verdict.reasons).size).toBe(verdict.reasons.length);
  });
});

describe('the plan the day run makes', () => {
  it('a missing brain key says so and changes nothing', async () => {
    const plan = await planPriceChange([SHEET], 'Facts.', vi.fn(async (): Promise<MindThinkResult> => ({ ok: false, reason: 'no_key' })));
    expect(plan).toMatchObject({ status: 'cannot_think', candidate: null });
  });

  it('a brain that cannot be reached is a plain failure, never a guess', async () => {
    const plan = await planPriceChange([SHEET], 'Facts.', vi.fn(async (): Promise<MindThinkResult> => ({ ok: false, reason: 'unavailable' })));
    expect(plan).toMatchObject({ status: 'failed', candidate: null });
  });

  it('a reply that says no change leaves the shop alone', async () => {
    const plan = await planPriceChange([SHEET], 'Facts.', thinkWith('{"product_id":"","price":0,"why":""}'));
    expect(plan).toMatchObject({ status: 'nothing', candidate: null });
    expect(plan.detail).toBe(PRICE_LEFT_ALONE);
  });

  it('an empty shop is said plainly, without asking a brain', async () => {
    const think = vi.fn(async (): Promise<MindThinkResult> => ({ ok: true, text: '{}' }));
    const plan = await planPriceChange([], 'Facts.', think);
    expect(plan.status).toBe('nothing');
    expect(think).not.toHaveBeenCalled();
  });

  it('a good reply is planned and checked, with the product it is about', async () => {
    const plan = await planPriceChange([SHEET], 'Facts.', thinkWith(JSON.stringify({ product_id: 'p1', price: 29.5, why: 'It sells well and the price is high.' })));
    expect(plan.status).toBe('planned');
    expect(plan.product?.name).toBe('Linen Bath Sheet');
    expect(plan.verdict.verdict).toBe('allow');
  });

  it('a bad reply is planned and blocked, so the one allowed fix can happen', async () => {
    const plan = await planPriceChange([SHEET], 'Facts.', thinkWith(JSON.stringify({ product_id: 'p1', price: 5, why: 'Cheaper in Lagos.' })));
    expect(plan.status).toBe('planned');
    expect(plan.verdict.verdict).toBe('block');
  });

  it('the one fix is asked once, with the Auditor own words, and reads the same shape', async () => {
    const think = vi.fn(async (): Promise<MindThinkResult> => ({ ok: true, text: JSON.stringify({ product_id: 'p1', price: 28, why: 'Still sells well at a lower price.' }) }));
    const fixed = await fixPriceOnce([SHEET], 'Facts.', GOOD, 'One change moves a price by a quarter at most.', think);
    expect(fixed).toEqual({ productId: 'p1', priceUsd: 28, why: 'Still sells well at a lower price.' });
    expect(think.mock.calls[0]![0].prompt).toContain('One change moves a price by a quarter at most.');
  });
});
