import { describe, expect, it, vi } from 'vitest';
import {
  PLACEMENT_MAX_PRODUCTS,
  buildPlacementPrompt,
  digitalFirst,
  planPlacement,
  type ShopProduct,
} from '../../supabase/functions/_shared/productPlacement';

// Phase B slice 4: a digital shop product that fits an article wins over a physical or affiliate one,
// until the cap of three is full. The Strategist still decides what fits; Buddy only orders and trims.

const SHOP: ShopProduct[] = [
  { id: 'p1', name: 'Calm Skin Routine Guide', isDigital: true, priceUsd: 12 },
  { id: 'p2', name: 'Barrier Repair Checklist', isDigital: true, priceUsd: 7.5 },
  { id: 'p3', name: 'Gentle Foaming Cleanser', isDigital: false, priceUsd: 18.99 },
  { id: 'p4', name: 'Night Cream Sample Pack', isDigital: false, priceUsd: 9 },
];

const ARTICLE = [
  'Dry skin often feels tight after washing, and it can look dull by midday.',
  '',
  'A simple routine helps most people who want calm, comfortable skin.',
].join('\n');

describe('digitalFirst: digital products lead, and the cap of three is kept', () => {
  it('a physical product listed first is moved behind a digital one that also fits', () => {
    expect(digitalFirst(['p3', 'p1'], SHOP)).toEqual(['p1', 'p3']);
  });

  it('keeps the order inside each group', () => {
    expect(digitalFirst(['p4', 'p2', 'p3', 'p1'], SHOP)).toEqual(['p2', 'p1', 'p4', 'p3']);
  });

  it('only orders: the cap of three stays the Auditor\'s rule, so the list is not trimmed here', () => {
    expect(PLACEMENT_MAX_PRODUCTS).toBe(3);
    expect(digitalFirst(['p3', 'p4', 'p1', 'p2'], SHOP)).toEqual(['p1', 'p2', 'p3', 'p4']);
  });

  it('a single affiliate or physical product still goes through: digital is preferred, never required', () => {
    expect(digitalFirst(['p4'], SHOP)).toEqual(['p4']);
  });
});

describe('making a plan: digital and physical both fit, digital is chosen first', () => {
  const article = { id: 'post-1', title: 'Easy Skincare Routine for Dry Skin', content: ARTICLE };
  const bothFit = JSON.stringify({
    paragraph: 2,
    product_ids: ['p3', 'p1'],
    sentences: 'A gentle start helps, and the Gentle Foaming Cleanser is a mild option. The Calm Skin Routine Guide walks you through a plan step by step.',
  });

  it('the planned product order puts the digital product first, and the plan is still allowed', async () => {
    const plan = await planPlacement(article, SHOP, async () => ({ ok: true as const, text: bothFit }));
    expect(plan.status).toBe('planned');
    expect(plan.verdict?.verdict).toBe('allow');
    expect(plan.candidate?.productIds).toEqual(['p1', 'p3']);
  });

  it('with four products offered, digital ones lead, and the Auditor still blocks the four-product plan', async () => {
    const fourFit = JSON.stringify({
      paragraph: 2,
      product_ids: ['p3', 'p4', 'p1', 'p2'],
      sentences: 'The Gentle Foaming Cleanser is mild. The Night Cream Sample Pack is for evenings. The Calm Skin Routine Guide and the Barrier Repair Checklist are digital guides.',
    });
    const plan = await planPlacement(article, SHOP, async () => ({ ok: true as const, text: fourFit }));
    expect(plan.candidate?.productIds).toEqual(['p1', 'p2', 'p3', 'p4']);
    expect(plan.status).toBe('blocked');
    expect(plan.verdict?.reasons).toContain('too many products');
    expect(plan.candidate!.productIds.length).toBeGreaterThan(PLACEMENT_MAX_PRODUCTS);
  });

  it('a physical product alone is still planned when no digital one fits', async () => {
    const onlyPhysical = JSON.stringify({
      paragraph: 2,
      product_ids: ['p4'],
      sentences: 'The Night Cream Sample Pack is a small way to try a richer night routine.',
    });
    const plan = await planPlacement(article, SHOP, async () => ({ ok: true as const, text: onlyPhysical }));
    expect(plan.status).toBe('planned');
    expect(plan.candidate?.productIds).toEqual(['p4']);
  });

  it('the Strategist is asked to use digital products first, and lists them first', () => {
    const think = vi.fn(async () => ({ ok: true as const, text: bothFit }));
    const { system, prompt } = buildPlacementPrompt(article.title, article.content, SHOP);
    expect(system).toContain('When a digital product fits, use it before a physical product or an affiliate link.');
    const lines = prompt.split('\n').filter((line) => / \| (digital|product) \| /.test(line));
    expect(lines[0]).toContain('| digital |');
    expect(lines[1]).toContain('| digital |');
    expect(lines[2]).toContain('| product |');
    expect(think).not.toHaveBeenCalled();
  });
});
