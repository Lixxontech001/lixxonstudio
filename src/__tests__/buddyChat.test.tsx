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

function query(result: Result) {
  const chain: Record<string, unknown> = {
    then: (resolve: (value: Result) => unknown, reject?: (error: unknown) => unknown) => Promise.resolve(result).then(resolve, reject),
  };
  for (const method of ['select', 'order', 'limit', 'eq', 'insert', 'single']) chain[method] = () => chain;
  return chain;
}

async function settle() {
  await act(async () => { for (let i = 0; i < 12; i += 1) await Promise.resolve(); });
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
  await act(async () => { root?.render(<BuddyChat />); });
  await settle();
  return host;
}

const CHAT = { id: 'chat-1', title: 'Shop question', created_at: '2026-10-09T10:00:00Z', updated_at: '2026-10-09T10:05:00Z' };

beforeEach(() => {
  mocks.from.mockReset();
  mocks.invoke.mockReset();
  mocks.from.mockImplementation(() => query({ data: [], error: null }));
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
});

describe('Buddy chat screen', () => {
  it('opens to an empty chat with the honest first line and a missing-key line when no key is saved', async () => {
    mocks.invoke.mockResolvedValueOnce({ data: { ok: true, action: 'status', configured: false }, error: null });
    const el = await render();
    expect(el.textContent).toContain('Ask Buddy anything.');
    expect(el.textContent).toContain('cannot see the articles or the shop yet');
    expect(el.textContent).toContain('no Google key is saved');
    expect(mocks.invoke).toHaveBeenCalledWith('buddy-think', { body: { action: 'status' } });
  });

  it('starts a chat on the first message, shows Buddy’s reply, and keeps the chat in the list', async () => {
    mocks.invoke
      .mockResolvedValueOnce({ data: { ok: true, action: 'status', configured: true }, error: null })
      .mockResolvedValueOnce({ data: { ok: true, action: 'ask', model: 'gemini-3.8-flash', reply: 'Hello. How can I help?', saved: true }, error: null });
    // Responses in order: list on mount, insert chat, reload messages, list again.
    mocks.from.mockReset();
    mocks.from
      .mockReturnValueOnce(query({ data: [], error: null }))
      .mockReturnValueOnce(query({ data: CHAT, error: null }))
      .mockReturnValueOnce(query({
        data: [
          { id: 'm1', role: 'owner', kind: 'reply', content: 'Hi Buddy', created_at: CHAT.updated_at },
          { id: 'm2', role: 'buddy', kind: 'reply', content: 'Hello. How can I help?', created_at: CHAT.updated_at },
        ],
        error: null,
      }))
      .mockReturnValueOnce(query({ data: [CHAT], error: null }));

    const el = await render();
    await typeMessage('Hi Buddy');
    await act(async () => { buttonByText('Send')?.click(); });
    await settle();

    expect(mocks.invoke).toHaveBeenLastCalledWith('buddy-think', { body: { action: 'ask', chat_id: 'chat-1', message: 'Hi Buddy' } });
    expect(el.textContent).toContain('Hello. How can I help?');
    expect(el.textContent).not.toContain('no Google key is saved');
  });

  it('New chat clears the thread and the drawer lists past chats to open', async () => {
    mocks.invoke.mockResolvedValueOnce({ data: { ok: true, action: 'status', configured: true }, error: null });
    mocks.from
      .mockReturnValueOnce(query({ data: [CHAT], error: null }))
      .mockReturnValueOnce(query({
        data: [{ id: 'm1', role: 'owner', kind: 'reply', content: 'Old question', created_at: CHAT.updated_at }],
        error: null,
      }));
    const el = await render();

    await act(async () => { buttonByText('Chats')?.click(); });
    await settle();
    const drawer = document.querySelector('[role="dialog"][aria-label="Past chats"]');
    expect(drawer?.textContent).toContain('Shop question');

    await act(async () => { (drawer?.querySelector('.buddy-chat-item') as HTMLButtonElement).click(); });
    await settle();
    expect(el.textContent).toContain('Old question');

    await act(async () => { buttonByText('New chat')?.click(); });
    await settle();
    expect(el.textContent).not.toContain('Old question');
    expect(el.textContent).toContain('Ask Buddy anything.');
  });

  it('shows the honest failure message from the server and never a made-up reply', async () => {
    mocks.invoke
      .mockResolvedValueOnce({ data: { ok: true, action: 'status', configured: true }, error: null })
      .mockResolvedValueOnce({ data: { ok: false, action: 'ask', reason: 'rejected', message: 'Google rejected the saved key. Replace it in Admin under Automation keys.' }, error: null });
    mocks.from
      .mockReturnValueOnce(query({ data: [], error: null }))
      .mockReturnValueOnce(query({ data: CHAT, error: null }))
      .mockReturnValueOnce(query({
        data: [
          { id: 'm1', role: 'owner', kind: 'reply', content: 'Hi', created_at: CHAT.updated_at },
          { id: 'm2', role: 'buddy', kind: 'notice', content: 'Google rejected the saved key.', created_at: CHAT.updated_at },
        ],
        error: null,
      }))
      .mockReturnValueOnce(query({ data: [CHAT], error: null }));
    const el = await render();
    await typeMessage('Hi');
    await act(async () => { buttonByText('Send')?.click(); });
    await settle();
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('Google rejected the saved key.');
    expect(el.textContent).toContain('Google rejected the saved key.');
  });

  it('keeps Send disabled until the box has a real message', async () => {
    mocks.invoke.mockResolvedValueOnce({ data: { ok: true, action: 'status', configured: true }, error: null });
    const el = await render();
    expect(buttonByText('Send')?.disabled).toBe(true);
    await typeMessage('   ');
    expect(buttonByText('Send')?.disabled).toBe(true);
    await typeMessage('Question');
    expect(buttonByText('Send')?.disabled).toBe(false);
    expect(el.querySelector('textarea')?.maxLength).toBe(1000);
  });
});
