// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Result = { data: unknown; error: unknown };
const mocks = vi.hoisted(() => ({ from: vi.fn(), invoke: vi.fn() }));
vi.mock('../lib/supabaseClient', () => ({ supabase: { from: mocks.from, functions: { invoke: mocks.invoke } } }));

import BuddyReports from '../buddy/BuddyReports';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement | null = null;
let root: Root | null = null;
let result: Result;

function query(value: () => Result) {
  const chain: Record<string, unknown> = {
    then: (resolve: (value: Result) => unknown, reject?: (error: unknown) => unknown) => Promise.resolve(value()).then(resolve, reject),
  };
  for (const method of ['select', 'order', 'limit', 'eq']) chain[method] = () => chain;
  return chain;
}

async function renderReports(onBack = vi.fn()) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(<BuddyReports onBack={onBack} />);
  });
  await act(async () => {
    for (let i = 0; i < 12; i += 1) await Promise.resolve();
  });
  return { el: host, onBack };
}

beforeEach(() => {
  result = { data: [], error: null };
  mocks.from.mockReset();
  mocks.from.mockImplementation(() => query(() => result));
  mocks.invoke.mockReset();
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe('Buddy Reports', () => {
  it('says there are no night reports yet, and reads only the reports table', async () => {
    const { el } = await renderReports();
    expect(el.textContent).toContain('No night reports yet.');
    expect(mocks.from).toHaveBeenCalledWith('buddy_reports');
    expect(el.querySelector('textarea')).toBeNull();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('lists reports, newest first, when there are some', async () => {
    result = {
      data: [{ id: 'r1', title: 'Quiet night', report_date: '2026-10-09', created_at: '2026-10-09T02:00:00Z' }],
      error: null,
    };
    const { el } = await renderReports();
    expect(el.textContent).toContain('Quiet night');
    expect(el.textContent).not.toContain('No night reports yet.');
  });

  it('says plainly when reports cannot be read, rather than claiming there are none', async () => {
    result = { data: null, error: new Error('denied') };
    const { el } = await renderReports();
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('Reports could not be opened just now.');
    expect(el.textContent).not.toContain('No night reports yet.');
  });

  it('goes back to Buddy from the back button', async () => {
    const { el, onBack } = await renderReports();
    const back = Array.from(el.querySelectorAll('button')).find((button) => button.textContent === 'Back to Buddy');
    await act(async () => {
      back?.click();
    });
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
