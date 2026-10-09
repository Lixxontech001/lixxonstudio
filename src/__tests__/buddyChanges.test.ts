import { describe, expect, it } from 'vitest';
import { describeChange, parseChangeRow, parseGapRow, type AppliedChange } from '../buddy/buddyChanges';

const CHANGE: AppliedChange = {
  id: 'edit-1',
  postId: 'post-1',
  postTitle: 'Easy Skincare Routine for Dry Skin',
  productNames: ['Calm Skin Routine Guide'],
  appliedAt: '2026-10-09T09:00:00Z',
  before: 'Dry skin often feels tight.',
  after: 'Dry skin often feels tight. The Calm Skin Routine Guide keeps the steps in order.',
};

describe('the Changes screen: what Buddy says about one change', () => {
  it('says what was added, to which article, in one plain sentence pair', () => {
    expect(describeChange(CHANGE)).toBe('I added Calm Skin Routine Guide to "Easy Skincare Routine for Dry Skin". One paragraph changed.');
  });

  it('names more than one product in plain words, and never uses a dash or a country', () => {
    const text = describeChange({ ...CHANGE, productNames: ['Calm Skin Routine Guide', 'Barrier Repair Checklist'] });
    expect(text).toContain('Calm Skin Routine Guide, Barrier Repair Checklist');
    expect(text).not.toMatch(/[\u2013\u2014]/);
    expect(text).not.toMatch(/nigeria|naira|lagos/i);
  });

  it('a product name that cannot be read gets a plain fallback, not a guess', () => {
    const row = parseChangeRow(
      { id: 'e', post_id: 'p', product_ids: ['missing'], before_paragraph: 'a', after_paragraph: 'b', applied_at: '2026-10-09T09:00:00Z' },
      { p: 'Guide' },
      {},
    );
    expect(row?.productNames).toEqual([]);
    expect(describeChange(row!)).toBe('I added a product to "Guide". One paragraph changed.');
  });

  it('an article title that cannot be read is shown as "an article"', () => {
    const row = parseChangeRow({ id: 'e', post_id: 'p', product_ids: [], before_paragraph: 'a', after_paragraph: 'b', applied_at: '2026-10-09T09:00:00Z' }, {}, {});
    expect(row?.postTitle).toBe('an article');
  });

  it('a row that is not a change is dropped, never shown', () => {
    expect(parseChangeRow({ id: 'e', post_id: 'p', before_paragraph: 'a', after_paragraph: 'b' }, {}, {})).toBeNull();
    expect(parseChangeRow('nonsense', {}, {})).toBeNull();
    expect(parseChangeRow({ id: 'e', post_id: 'p', before_paragraph: 5, after_paragraph: 'b', applied_at: '2026-10-09T09:00:00Z' }, {}, {})).toBeNull();
  });

  it('keeps only the one paragraph, before and after, from a change row', () => {
    const row = parseChangeRow(
      { id: 'e', post_id: 'p', product_ids: [], before_paragraph: 'one', after_paragraph: 'two', applied_at: '2026-10-09T09:00:00Z', extra: 'whole article' },
      {},
      {},
    );
    expect(row).not.toHaveProperty('extra');
    expect(row?.before).toBe('one');
    expect(row?.after).toBe('two');
  });
});

describe('the Changes screen: product gaps', () => {
  it('a gap says the shop needs a product, and asks the owner to create it', () => {
    const gap = parseGapRow({ id: 'g1', angle: 'Night routine', created_at: '2026-10-09T09:00:00Z' });
    expect(gap?.note).toBe('No product in the shop fits this yet. Create one in the shop, then ask Buddy again.');
    expect(gap?.note).not.toMatch(/[\u2013\u2014]/);
  });

  it('a gap without an angle or a time is dropped', () => {
    expect(parseGapRow({ id: 'g1', created_at: '2026-10-09T09:00:00Z' })).toBeNull();
    expect(parseGapRow({ id: 'g1', angle: 'x', created_at: 'not a date' })).toBeNull();
  });
});
