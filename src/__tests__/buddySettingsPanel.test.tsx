// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Result = { data: unknown; error: unknown };
const mocks = vi.hoisted(() => ({ from: vi.fn(), upsert: vi.fn(), select: vi.fn() }));
vi.mock('../lib/supabaseClient', () => ({ supabase: { from: mocks.from } }));

import BuddySettingsPanel from '../buddy/BuddySettings';
import BuddyChat from '../buddy/BuddyChat';
import type { BuddySettings } from '../buddy/buddySettingsStore';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement | null = null;
let root: Root | null = null;
let savedRow: Result;

function stateChain(read: () => Result) {
  const chain: Record<string, unknown> = {
    then: (resolve: (value: Result) => unknown, reject?: (error: unknown) => unknown) => Promise.resolve(read()).then(resolve, reject),
  };
  for (const method of ['select', 'maybeSingle', 'eq', 'limit', 'order', 'in', 'gt', 'is']) chain[method] = () => chain;
  chain.upsert = mocks.upsert;
  return chain;
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 16; i += 1) await Promise.resolve();
  });
}

async function mount(element: React.ReactElement): Promise<HTMLDivElement> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(element);
  });
  await flush();
  return host;
}

function buttonByText(text: string): HTMLButtonElement | undefined {
  return Array.from(host?.querySelectorAll('button') ?? []).find((button) => (button.textContent || '').includes(text));
}

const SAVED: BuddySettings = { vibe: 'noir-gold', speakReplies: false };

beforeEach(() => {
  savedRow = { data: null, error: null };
  mocks.upsert.mockReset().mockResolvedValue({ error: null });
  mocks.from.mockReset().mockImplementation((table: string) => {
    if (table === 'buddy_owner_state') return stateChain(() => savedRow);
    return stateChain(() => ({ data: [], error: null }));
  });
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe('Buddy settings panel', () => {
  it('previews a chosen look at once, saves it, and shows it again after a reload', async () => {
    const onSaved = vi.fn();
    const el = await mount(<BuddySettingsPanel saved={SAVED} onBack={() => {}} onSaved={onSaved} />);
    expect(el.querySelector('[data-testid="buddy-settings"]')?.getAttribute('data-vibe')).toBe('noir-gold');

    await act(async () => {
      buttonByText('Velvet Opera')?.click();
    });
    expect(el.querySelector('[data-testid="buddy-settings"]')?.getAttribute('data-vibe')).toBe('velvet-opera');
    expect(mocks.upsert).not.toHaveBeenCalled();

    await act(async () => {
      buttonByText('Save settings')?.click();
    });
    await flush();
    expect(mocks.upsert).toHaveBeenCalledWith(
      { vibe: 'velvet-opera', speak_replies: false, updated_at: expect.any(String) },
      { onConflict: 'owner_id' },
    );
    expect(onSaved).toHaveBeenCalledWith({ vibe: 'velvet-opera', speakReplies: false });
    expect(el.textContent).toContain('Saved.');

    // Reload: the saved row now holds the new look, and the chat screen opens in it.
    act(() => root?.unmount());
    host?.remove();
    savedRow = { data: { vibe: 'velvet-opera', speak_replies: false }, error: null };
    const chat = await mount(<BuddyChat />);
    expect(chat.querySelector('[data-testid="buddy-chat"]')?.getAttribute('data-vibe')).toBe('velvet-opera');
  });

  it('says plainly when the save fails, and does not claim it worked', async () => {
    mocks.upsert.mockResolvedValueOnce({ error: new Error('denied') });
    const onSaved = vi.fn();
    const el = await mount(<BuddySettingsPanel saved={SAVED} onBack={() => {}} onSaved={onSaved} />);
    await act(async () => {
      buttonByText('Porcelain')?.click();
    });
    await act(async () => {
      buttonByText('Save settings')?.click();
    });
    await flush();
    expect(onSaved).not.toHaveBeenCalled();
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('could not save your settings');
    expect(el.textContent).not.toContain('Saved.');
  });

  it('keeps read-aloud off by default, and saves it once the owner switches it on', async () => {
    (window as unknown as Record<string, unknown>).speechSynthesis = { speak: vi.fn(), cancel: vi.fn() };
    (window as unknown as Record<string, unknown>).SpeechSynthesisUtterance = function () {};
    try {
      const onSaved = vi.fn();
      const el = await mount(<BuddySettingsPanel saved={SAVED} onBack={() => {}} onSaved={onSaved} />);
      const box = el.querySelector<HTMLInputElement>('input[type="checkbox"]');
      expect(box?.checked).toBe(false);
      expect(box?.disabled).toBe(false);
      await act(async () => {
        box?.click();
      });
      await act(async () => {
        buttonByText('Save settings')?.click();
      });
      await flush();
      expect(mocks.upsert).toHaveBeenCalledWith(
        { vibe: 'noir-gold', speak_replies: true, updated_at: expect.any(String) },
        { onConflict: 'owner_id' },
      );
      expect(onSaved).toHaveBeenCalledWith({ vibe: 'noir-gold', speakReplies: true });
    } finally {
      delete (window as unknown as Record<string, unknown>).speechSynthesis;
      delete (window as unknown as Record<string, unknown>).SpeechSynthesisUtterance;
    }
  });

  it('offers the four looks as pressed buttons, one at a time', async () => {
    const el = await mount(<BuddySettingsPanel saved={SAVED} onBack={() => {}} onSaved={() => {}} />);
    const pressed = Array.from(el.querySelectorAll('button[aria-pressed="true"]')).map((button) => button.textContent);
    expect(pressed).toHaveLength(1);
    expect(pressed[0]).toContain('Noir Gold');
  });
});
