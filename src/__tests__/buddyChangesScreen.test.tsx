// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Result = { data: unknown; error: unknown };
const mocks = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('../lib/supabaseClient', () => ({ supabase: { from: mocks.from } }));

import BuddyChanges from '../buddy/BuddyChanges';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root | null = null;
let reads: Record<string, () => Result>;
let updates: Array<{ table: string; values: Record<string, unknown> }>;

/** A fake table. Reads resolve to the table's rows; an update is recorded and returns ok. */
function fromTable(table: string) {
  let op: 'read' | 'update' = 'read';
  let values: Record<string, unknown> = {};
  const run = (): Result => {
    if (op === 'update') {
      updates.push({ table, values });
      return { data: null, error: null };
    }
    return reads[table]?.() ?? { data: null, error: new Error(`no fake for ${table}`) };
  };
  const chain: Record<string, unknown> = {
    then: (resolve: (value: Result) => unknown, reject?: (error: unknown) => unknown) => Promise.resolve(run()).then(resolve, reject),
  };
  for (const method of ['select', 'order', 'limit', 'eq', 'is', 'in']) chain[method] = () => chain;
  chain.update = (next: Record<string, unknown>) => {
    op = 'update';
    values = next;
    return chain;
  };
  return chain;
}

const CHANGE_ROW = {
  id: 'edit-1',
  post_id: 'post-1',
  product_ids: ['prod-1'],
  before_paragraph: 'Dry skin often feels tight after washing.',
  after_paragraph: 'Dry skin often feels tight after washing. The Calm Skin Routine Guide keeps the steps in order.',
  applied_at: '2026-10-09T09:00:00Z',
};
const GAP_ROW = { id: 'gap-1', angle: 'Night routine for oily skin', created_at: '2026-10-09T08:00:00Z' };

async function settle() {
  await act(async () => {
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
  });
}

function buttonByText(text: string): HTMLButtonElement | undefined {
  return Array.from(host.querySelectorAll('button')).find((button) => (button.textContent || '').trim() === text);
}

async function render() {
  root = createRoot(host);
  await act(async () => {
    root!.render(<BuddyChanges vibe="calm" onBack={() => undefined} />);
  });
  await settle();
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  updates = [];
  mocks.from.mockImplementation((table: string) => fromTable(table));
  reads = {
    post_product_edits: () => ({ data: [CHANGE_ROW], error: null }),
    posts: () => ({ data: [{ id: 'post-1', title: 'Easy Skincare Routine for Dry Skin' }], error: null }),
    products: () => ({ data: [{ id: 'prod-1', name: 'Calm Skin Routine Guide' }], error: null }),
    minds_gap_notes: () => ({ data: [GAP_ROW], error: null }),
  };
});

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
  host.remove();
  vi.clearAllMocks();
});

describe('the Changes screen', () => {
  it('lists what was added in one plain sentence, with the article title and product name', async () => {
    await render();
    expect(host.textContent).toContain('I added Calm Skin Routine Guide to "Easy Skincare Routine for Dry Skin". One paragraph changed.');
  });

  it('"Show the paragraph" shows only that paragraph, before and after, and not the whole article', async () => {
    await render();
    expect(host.querySelector('[data-testid="paragraph-before"]')).toBeNull();
    await act(async () => buttonByText('Show the paragraph')!.click());
    expect(host.querySelector('[data-testid="paragraph-before"]')!.textContent).toBe(CHANGE_ROW.before_paragraph);
    expect(host.querySelector('[data-testid="paragraph-after"]')!.textContent).toBe(CHANGE_ROW.after_paragraph);
    expect(host.textContent).not.toContain('# Easy Skincare');
    await act(async () => buttonByText('Hide the paragraph')!.click());
    expect(host.querySelector('[data-testid="paragraph-before"]')).toBeNull();
  });

  it('shows open product gaps with the plain note, and "Got it" marks one seen and removes it', async () => {
    await render();
    expect(host.textContent).toContain('No product in the shop fits this yet. Create one in the shop, then ask Buddy again.');
    await act(async () => buttonByText('Got it')!.click());
    await settle();
    expect(updates).toHaveLength(1);
    expect(updates[0].table).toBe('minds_gap_notes');
    expect(Object.keys(updates[0].values)).toEqual(['seen_at']);
    expect(host.textContent).toContain('No product gaps waiting.');
  });

  it('a failed read says so, and does not claim there is nothing', async () => {
    reads.post_product_edits = () => ({ data: null, error: new Error('down') });
    await render();
    expect(host.querySelector('[role="alert"]')!.textContent).toBe('Changes could not be read just now. Try again shortly.');
  });

  it('an empty list says there are no changes yet', async () => {
    reads.post_product_edits = () => ({ data: [], error: null });
    reads.minds_gap_notes = () => ({ data: [], error: null });
    await render();
    expect(host.textContent).toContain('No article changes yet.');
    expect(host.textContent).toContain('No product gaps waiting.');
  });

  it('has no place to type to a mind: no text box on the screen', async () => {
    await render();
    expect(host.querySelector('textarea, input[type="text"]')).toBeNull();
  });
});
