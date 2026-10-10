// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Result = { data: unknown; error: unknown };
const mocks = vi.hoisted(() => ({ from: vi.fn(), invoke: vi.fn() }));
vi.mock('../lib/supabaseClient', () => ({ supabase: { from: mocks.from, functions: { invoke: mocks.invoke } } }));

import BuddyChat from '../buddy/BuddyChat';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root | null = null;

/** Fake tables: reads and inserts are functions, so a test can change what the database holds over time. */
let reads: Record<string, () => Result>;
let inserts: Record<string, () => Result>;
let actions: Record<string, (body: Record<string, unknown>) => Result>;

function fromTable(table: string) {
  let op: 'read' | 'insert' = 'read';
  const run = (): Result => (op === 'insert' ? inserts[table]?.() : reads[table]?.()) ?? { data: null, error: new Error(`no fake for ${table}`) };
  const chain: Record<string, unknown> = {
    then: (resolve: (value: Result) => unknown, reject?: (error: unknown) => unknown) => Promise.resolve(run()).then(resolve, reject),
  };
  for (const method of ['select', 'order', 'limit', 'eq', 'is', 'gt', 'in', 'single', 'maybeSingle', 'update', 'upsert']) chain[method] = () => chain;
  chain.insert = () => {
    op = 'insert';
    return chain;
  };
  return chain;
}

const QUIET = { data: { ok: true, action: 'briefing', chat_id: 'brief-1', created: true, first_visit: true, quiet: true, text: 'Quiet since you left.' }, error: null };
const CHAT = { id: 'chat-1', title: 'Shop question', kind: 'chat', briefing_date: null, created_at: '2026-10-09T10:00:00Z', updated_at: '2026-10-09T10:05:00Z' };
const BRIEFING_ROW = { id: 'brief-1', title: null, kind: 'briefing', briefing_date: '2026-10-09', created_at: '2026-10-09T08:00:00Z', updated_at: '2026-10-09T08:00:00Z' };

async function settle() {
  await act(async () => {
    for (let i = 0; i < 16; i += 1) await Promise.resolve();
  });
}

function buttonByText(text: string): HTMLButtonElement | undefined {
  return Array.from(host.querySelectorAll('button')).find((button) => (button.textContent || '').trim() === text);
}

async function typeMessage(text: string) {
  const input = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message Buddy"]');
  if (!input) throw new Error('composer missing');
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function render() {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(<BuddyChat />);
  });
  await settle();
  return host;
}

/** Shows the greeting, then presses Continue. Reduced motion is on in these tests, so Continue is there at once. */
async function continueFromGreeting() {
  expect(host.querySelector('[data-testid="buddy-greeting"]')).not.toBeNull();
  await act(async () => {
    buttonByText('Continue')?.click();
  });
  await settle();
}

beforeEach(() => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('reduce'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
  reads = { buddy_chats: () => ({ data: [], error: null }), buddy_messages: () => ({ data: [], error: null }) };
  inserts = {};
  actions = {
    status: () => ({ data: { ok: true, action: 'status', configured: true }, error: null }),
    briefing: () => QUIET,
  };
  mocks.from.mockReset();
  mocks.from.mockImplementation((table: string) => fromTable(table));
  mocks.invoke.mockReset();
  mocks.invoke.mockImplementation(async (_name: string, options: { body: Record<string, unknown> }) => {
    const handler = actions[String(options.body.action)];
    return handler ? handler(options.body) : { data: null, error: new Error('unexpected action') };
  });
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
});

describe('Buddy chat screen', () => {
  it('opens to the greeting, then to today’s briefing, with the missing-key line when no key is saved', async () => {
    actions.status = () => ({ data: { ok: true, action: 'status', configured: false }, error: null });
    reads.buddy_chats = () => ({ data: [BRIEFING_ROW], error: null });
    reads.buddy_messages = () => ({
      data: [{ id: 'b1', role: 'buddy', kind: 'briefing', content: 'Quiet since you left.', payload: null, created_at: BRIEFING_ROW.created_at }],
      error: null,
    });
    const el = await render();
    expect(el.textContent).toMatch(/Good (morning|afternoon|evening|night)\./);
    expect(el.textContent).not.toContain('Ask Buddy anything.');
    expect(mocks.invoke).not.toHaveBeenCalledWith('buddy-think', expect.objectContaining({ body: expect.objectContaining({ action: 'briefing' }) }));

    await continueFromGreeting();
    expect(el.textContent).toContain('Quiet since you left.');
    expect(el.textContent).toContain('no brain key is saved');
    expect(mocks.invoke).toHaveBeenCalledWith('buddy-think', { body: { action: 'status' } });
    expect(mocks.invoke).toHaveBeenCalledWith('buddy-think', { body: { action: 'briefing', local_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) } });
  });

  it('shows the briefing as titled sections with real numbers from the saved message', async () => {
    reads.buddy_chats = () => ({ data: [BRIEFING_ROW], error: null });
    reads.buddy_messages = () => ({
      data: [
        {
          id: 'b1',
          role: 'buddy',
          kind: 'briefing',
          content: 'Money & readers: 2 paid orders since you left, USD 58.50 in total.',
          payload: {
            sections: [
              { id: 'since', title: 'Since you left', lines: ['You were away for about 5 hours.'] },
              { id: 'money', title: 'Money & readers', lines: ['2 paid orders since you left, USD 58.50 in total.'] },
            ],
          },
          created_at: BRIEFING_ROW.created_at,
        },
      ],
      error: null,
    });
    actions.briefing = () => ({ data: { ok: true, action: 'briefing', chat_id: 'brief-1', created: false, first_visit: false, quiet: false, text: 'x' }, error: null });
    const el = await render();
    await continueFromGreeting();
    const card = el.querySelector('[data-testid="buddy-briefing"]');
    expect(card?.querySelectorAll('h3').length).toBe(2);
    expect(card?.textContent).toContain('Since you left');
    expect(card?.textContent).toContain('USD 58.50 in total.');
    expect(el.textContent).not.toContain('Quiet since you left.');
  });

  it('starts a chat on the first message after New chat, shows Buddy’s reply, and keeps the chat in the list', async () => {
    const stored: Array<Record<string, unknown>> = [];
    inserts.buddy_chats = () => ({ data: CHAT, error: null });
    reads.buddy_messages = () => ({ data: stored, error: null });
    actions.ask = (body) => {
      stored.push(
        { id: 'm1', role: 'owner', kind: 'reply', content: String(body.message), payload: null, created_at: CHAT.updated_at },
        { id: 'm2', role: 'buddy', kind: 'reply', content: 'Hello. How can I help?', payload: null, created_at: CHAT.updated_at },
      );
      return { data: { ok: true, action: 'ask', model: 'gemini-3.8-flash', reply: 'Hello. How can I help?', saved: true }, error: null };
    };
    const el = await render();
    await continueFromGreeting();
    await act(async () => {
      buttonByText('New chat')?.click();
    });
    await settle();
    await typeMessage('Hi Buddy');
    await act(async () => {
      buttonByText('Send')?.click();
    });
    await settle();
    expect(mocks.invoke).toHaveBeenLastCalledWith('buddy-think', { body: { action: 'ask', chat_id: 'chat-1', message: 'Hi Buddy' } });
    expect(el.textContent).toContain('Hello. How can I help?');
  });

  it('shows the honest failure message from the server and never a made-up reply', async () => {
    inserts.buddy_chats = () => ({ data: CHAT, error: null });
    actions.ask = () => ({
      data: { ok: false, action: 'ask', reason: 'rejected', message: 'Google rejected the saved key. Replace it in Admin under Automation keys.' },
      error: null,
    });
    const el = await render();
    await continueFromGreeting();
    await act(async () => {
      buttonByText('New chat')?.click();
    });
    await typeMessage('Hi');
    await act(async () => {
      buttonByText('Send')?.click();
    });
    await settle();
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('Google rejected the saved key.');
  });

  it('New chat clears the thread, and the drawer lists past chats and today’s briefing to open', async () => {
    reads.buddy_chats = () => ({ data: [CHAT, BRIEFING_ROW], error: null });
    reads.buddy_messages = () => ({
      data: [{ id: 'm1', role: 'owner', kind: 'reply', content: 'Old question', payload: null, created_at: CHAT.updated_at }],
      error: null,
    });
    const el = await render();
    await continueFromGreeting();

    await act(async () => {
      buttonByText('Chats')?.click();
    });
    await settle();
    const drawer = document.querySelector('[role="dialog"][aria-label="Past chats"]');
    expect(drawer?.textContent).toContain('Shop question');
    expect(drawer?.textContent).toMatch(/Daily briefing, 9 Oct 2026/);

    await act(async () => {
      (drawer?.querySelector('.buddy-chat-item') as HTMLButtonElement).click();
    });
    await settle();
    expect(el.textContent).toContain('Old question');

    await act(async () => {
      buttonByText('New chat')?.click();
    });
    await settle();
    expect(el.textContent).not.toContain('Old question');
    expect(el.textContent).toContain('Ask Buddy anything.');
  });

  it('keeps Send disabled until the box has a real message', async () => {
    const el = await render();
    await continueFromGreeting();
    expect(buttonByText('Send')?.disabled).toBe(true);
    await typeMessage('   ');
    expect(buttonByText('Send')?.disabled).toBe(true);
    await typeMessage('Question');
    expect(buttonByText('Send')?.disabled).toBe(false);
    expect(el.querySelector('textarea')?.maxLength).toBe(1000);
  });

  it('opens Reports from the header and has a way back without a composer', async () => {
    const el = await render();
    await continueFromGreeting();
    await act(async () => {
      buttonByText('Reports')?.click();
    });
    await settle();
    expect(el.querySelector('[data-testid="buddy-reports"]')).not.toBeNull();
    expect(el.querySelector('textarea')).toBeNull();
    await act(async () => {
      buttonByText('Back to Buddy')?.click();
    });
    await settle();
    expect(el.querySelector('textarea[aria-label="Message Buddy"]')).not.toBeNull();
  });
});

describe('Buddy chat: look and read-aloud', () => {
  const speakFn = vi.fn();
  const cancelFn = vi.fn();

  class FakeUtterance {
    text: string;
    lang = '';
    constructor(text: string) {
      this.text = text;
    }
  }

  beforeEach(() => {
    speakFn.mockReset();
    cancelFn.mockReset();
    (window as unknown as Record<string, unknown>).speechSynthesis = { speak: speakFn, cancel: cancelFn };
    (window as unknown as Record<string, unknown>).SpeechSynthesisUtterance = FakeUtterance;
  });

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).speechSynthesis;
    delete (window as unknown as Record<string, unknown>).SpeechSynthesisUtterance;
  });

  it('opens in the look the owner saved', async () => {
    reads.buddy_owner_state = () => ({ data: { vibe: 'porcelain', speak_replies: false }, error: null });
    const el = await render();
    expect(el.querySelector('[data-testid="buddy-chat"]')?.getAttribute('data-vibe')).toBe('porcelain');
  });

  it('falls back to Noir Gold when the look cannot be read', async () => {
    const el = await render();
    expect(el.querySelector('[data-testid="buddy-chat"]')?.getAttribute('data-vibe')).toBe('noir-gold');
  });

  it('reads nothing aloud by default', async () => {
    await render();
    await continueFromGreeting();
    expect(speakFn).not.toHaveBeenCalled();
  });

  it('reads the briefing aloud once the owner has switched read-aloud on', async () => {
    reads.buddy_owner_state = () => ({ data: { vibe: 'noir-gold', speak_replies: true }, error: null });
    await render();
    await continueFromGreeting();
    expect(speakFn).toHaveBeenCalledTimes(1);
    expect((speakFn.mock.calls[0][0] as FakeUtterance).text).toBe('Quiet since you left.');
  });

  it('reads Buddy’s replies aloud, but never the owner’s own message', async () => {
    reads.buddy_owner_state = () => ({ data: { vibe: 'noir-gold', speak_replies: true }, error: null });
    const stored: Array<Record<string, unknown>> = [];
    reads.buddy_messages = () => ({ data: stored, error: null });
    inserts.buddy_chats = () => ({ data: CHAT, error: null });
    actions.ask = (body) => {
      stored.push(
        { id: 'm1', role: 'owner', kind: 'reply', content: String(body.message), payload: null, created_at: CHAT.updated_at },
        { id: 'm2', role: 'buddy', kind: 'reply', content: 'Hello. How can I help?', payload: null, created_at: CHAT.updated_at },
      );
      return { data: { ok: true, action: 'ask', model: 'gemini-3.8-flash', reply: 'Hello. How can I help?', saved: true }, error: null };
    };
    await render();
    await continueFromGreeting();
    speakFn.mockReset();
    await act(async () => {
      buttonByText('New chat')?.click();
    });
    await typeMessage('Hi Buddy');
    await act(async () => {
      buttonByText('Send')?.click();
    });
    await settle();
    expect(speakFn).toHaveBeenCalledTimes(1);
    expect((speakFn.mock.calls[0][0] as FakeUtterance).text).toBe('Hello. How can I help?');
  });
});

