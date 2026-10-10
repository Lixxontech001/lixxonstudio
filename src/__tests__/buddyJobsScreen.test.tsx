// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Result = { data: unknown; error: unknown };
const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock('../lib/supabaseClient', () => ({ supabase: { from: mocks.from, rpc: mocks.rpc } }));

import BuddyChanges, { JOBS_NOTE, JOBS_READ_FAILED, GAP_SAVE_FAILED } from '../buddy/BuddyChanges';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root | null = null;
let reads: Record<string, () => Result>;

/** A fake table. Reads resolve to the table's rows. Anything not faked is an empty read. */
function fromTable(table: string) {
  const run = (): Result => reads[table]?.() ?? { data: [], error: null };
  const chain: Record<string, unknown> = {
    then: (resolve: (value: Result) => unknown, reject?: (error: unknown) => unknown) => Promise.resolve(run()).then(resolve, reject),
  };
  for (const method of ['select', 'order', 'limit', 'eq', 'is', 'in', 'gt']) chain[method] = () => chain;
  return chain;
}

const READY = {
  id: 'pack-ready',
  channel: 'instagram',
  local_day: '2026-10-10',
  post_id: 'post-1',
  article_url: '/magazine/easy-skincare-routine-dry-skin',
  suggested_at_utc: '2026-10-10T13:00:00+00:00',
  suggested_label: 'Morning, US Eastern',
  caption: 'A calm routine for dry skin, with the guide that keeps the steps in order.',
  pin_title: null,
  pin_description: null,
  video_path: '/tmp/pack-ready.mp4',
  product_ids: ['prod-1'],
  status: 'ready',
  blocked_reason: null,
  posted_at: null,
  created_at: '2026-10-10T08:00:00Z',
};
const BLOCKED = {
  ...READY,
  id: 'pack-blocked',
  channel: 'pinterest',
  caption: null,
  pin_title: 'Easy routine for dry skin',
  pin_description: 'A calm order of steps.',
  suggested_at_utc: null,
  suggested_label: null,
  video_path: null,
  status: 'blocked',
  blocked_reason: 'video not made yet',
  created_at: '2026-10-10T07:00:00Z',
};
const POSTED = {
  ...READY,
  id: 'pack-posted',
  channel: 'tiktok',
  status: 'posted_by_owner',
  posted_at: '2026-10-10T15:00:00Z',
  created_at: '2026-10-10T06:00:00Z',
};

function setPacks(rows: unknown[] | (() => Result)) {
  reads.minds_packs = typeof rows === 'function' ? rows : () => ({ data: rows, error: null });
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 30; i += 1) await Promise.resolve();
  });
}

function buttonByText(text: string): HTMLButtonElement | undefined {
  return Array.from(host.querySelectorAll('button')).find((button) => (button.textContent || '').trim() === text);
}

async function render() {
  await act(async () => {
    root?.render(<BuddyChanges vibe="calm" onBack={() => undefined} />);
  });
  await settle();
}

beforeEach(() => {
  mocks.from.mockReset();
  mocks.rpc.mockReset();
  mocks.from.mockImplementation((table: string) => fromTable(table));
  reads = {
    minds_packs: () => ({ data: [READY, BLOCKED, POSTED], error: null }),
    posts: () => ({ data: [{ id: 'post-1', title: 'Easy Skincare Routine for Dry Skin' }], error: null }),
    products: () => ({ data: [{ id: 'prod-1', name: 'Calm Skin Routine Guide' }], error: null }),
  };
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  host.remove();
});

describe('Your jobs on the Changes screen', () => {
  it('shows real pack rows, with the right words and the notice that Buddy never posts', async () => {
    await render();
    expect(host.textContent).toContain('Your jobs');
    expect(host.textContent).toContain(JOBS_NOTE);
    const rows = host.querySelectorAll('[data-testid="pack-job"]');
    expect(rows.length).toBe(3);
    expect(host.textContent).toContain('Instagram for "Easy Skincare Routine for Dry Skin"');
    expect(host.textContent).toContain('Ready to post by hand.');
    expect(host.textContent).toContain('Blocked: video not made yet.');
    expect(host.textContent).toContain('Posted by you on 2026-10-10.');
  });

  it('only a ready pack has an "I posted this" button', async () => {
    await render();
    const buttons = Array.from(host.querySelectorAll('button')).filter((button) => button.textContent === 'I posted this');
    expect(buttons.length).toBe(1);
  });

  it('"I posted this" asks the database to mark that one pack, and the row then says it is posted by you', async () => {
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    await render();
    await act(async () => buttonByText('I posted this')?.click());
    await settle();
    expect(mocks.rpc).toHaveBeenCalledWith('minds_mark_pack_posted', { p_pack_id: 'pack-ready' });
    expect(host.textContent).toMatch(/Posted by you on \d{4}-\d{2}-\d{2}\./);
    expect(Array.from(host.querySelectorAll('button')).some((button) => button.textContent === 'I posted this')).toBe(false);
    expect(host.textContent).not.toContain(GAP_SAVE_FAILED);
  });

  it('a failed mark keeps the button and says it could not be saved', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: new Error('not_owner') });
    await render();
    await act(async () => buttonByText('I posted this')?.click());
    await settle();
    expect(host.textContent).toContain(GAP_SAVE_FAILED);
    expect(buttonByText('I posted this')).toBeDefined();
    expect(host.textContent).toContain('Ready to post by hand.');
  });

  it('a failed read of packs says so, and does not hide the rest of the screen', async () => {
    setPacks(() => ({ data: null, error: new Error('denied') }));
    await render();
    expect(host.textContent).toContain(JOBS_READ_FAILED);
    expect(host.textContent).toContain('Changes I made');
    expect(host.textContent).toContain('Product gaps');
  });

  it('with no packs in the window, the screen says so plainly', async () => {
    setPacks([]);
    await render();
    expect(host.textContent).toContain('No packs in the last three days.');
  });
});
