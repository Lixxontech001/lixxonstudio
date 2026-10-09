import { beforeEach, describe, expect, it, vi } from 'vitest';

type Result = { data: unknown; error: unknown };
const mocks = vi.hoisted(() => ({ from: vi.fn(), invoke: vi.fn() }));
vi.mock('../lib/supabaseClient', () => ({ supabase: { from: mocks.from, functions: { invoke: mocks.invoke } } }));

import {
  askBuddy,
  chatLabel,
  createChat,
  listChats,
  loadMessages,
  parseChatRows,
  parseMessageRows,
} from '../buddy/buddyChatStore';

/** A query that resolves to the given result, whatever filters are chained onto it. */
function query(result: Result) {
  const chain: Record<string, unknown> = {
    then: (resolve: (value: Result) => unknown, reject?: (error: unknown) => unknown) => Promise.resolve(result).then(resolve, reject),
  };
  for (const method of ['select', 'order', 'limit', 'eq', 'insert', 'single']) chain[method] = () => chain;
  return chain;
}

const CHAT_ROW = { id: 'chat-1', title: 'Shop question', created_at: '2026-10-09T10:00:00Z', updated_at: '2026-10-09T10:05:00Z' };

beforeEach(() => {
  mocks.from.mockReset();
  mocks.invoke.mockReset();
});

describe('Buddy chat store: create and list', () => {
  it('lists the owner’s chats, newest first, as plain summaries', async () => {
    mocks.from.mockReturnValueOnce(query({ data: [CHAT_ROW, { ...CHAT_ROW, id: 'chat-2', title: null }], error: null }));
    const chats = await listChats();
    expect(mocks.from).toHaveBeenCalledWith('buddy_chats');
    expect(chats).toEqual([
      { id: 'chat-1', title: 'Shop question', createdAt: CHAT_ROW.created_at, updatedAt: CHAT_ROW.updated_at },
      { id: 'chat-2', title: null, createdAt: CHAT_ROW.created_at, updatedAt: CHAT_ROW.updated_at },
    ]);
  });

  it('creates a new empty chat for the owner', async () => {
    mocks.from.mockReturnValueOnce(query({ data: CHAT_ROW, error: null }));
    const chat = await createChat();
    expect(chat?.id).toBe('chat-1');
    expect(mocks.from).toHaveBeenCalledWith('buddy_chats');
  });

  it('returns null, not an empty list, when the read fails', async () => {
    mocks.from.mockReturnValueOnce(query({ data: null, error: new Error('denied') }));
    expect(await listChats()).toBeNull();
    mocks.from.mockReturnValueOnce(query({ data: null, error: new Error('denied') }));
    expect(await createChat()).toBeNull();
  });

  it('labels a chat with no title as New chat', () => {
    expect(chatLabel({ title: null })).toBe('New chat');
    expect(chatLabel({ title: '   ' })).toBe('New chat');
    expect(chatLabel({ title: 'Weekly plan' })).toBe('Weekly plan');
  });

  it('rejects malformed rows instead of showing them', () => {
    expect(parseChatRows([{ id: 'x' }])).toBeNull();
    expect(parseChatRows({})).toBeNull();
    expect(parseMessageRows([{ id: 'm', role: 'admin', kind: 'reply', content: 'x', created_at: CHAT_ROW.created_at }])).toBeNull();
  });
});

describe('Buddy chat store: messages and sending', () => {
  it('opens a chat in order, with replies and notices kept apart', async () => {
    mocks.from.mockReturnValueOnce(query({
      data: [
        { id: 'm1', role: 'owner', kind: 'reply', content: 'Hi', created_at: CHAT_ROW.created_at },
        { id: 'm2', role: 'buddy', kind: 'notice', content: 'No key yet.', created_at: CHAT_ROW.updated_at },
      ],
      error: null,
    }));
    const messages = await loadMessages('chat-1');
    expect(messages?.map((message) => [message.role, message.kind])).toEqual([['owner', 'reply'], ['buddy', 'notice']]);
  });

  it('sends the question with the chat id and reads back the answer', async () => {
    mocks.invoke.mockResolvedValueOnce({ data: { ok: true, action: 'ask', model: 'm', reply: 'Hello.', saved: true }, error: null });
    const result = await askBuddy('chat-1', 'Hi');
    expect(mocks.invoke).toHaveBeenCalledWith('buddy-think', { body: { action: 'ask', chat_id: 'chat-1', message: 'Hi' } });
    expect(result).toMatchObject({ ok: true, reply: 'Hello.' });
  });

  it('reads the plain message from a refused request, so the owner sees the reason', async () => {
    const context = new Response(JSON.stringify({ ok: false, reason: 'not_saved', message: 'Buddy could not save your message.' }), { status: 503 });
    mocks.invoke.mockResolvedValueOnce({ data: null, error: Object.assign(new Error('non-2xx'), { context }) });
    const result = await askBuddy('chat-1', 'Hi');
    expect(result).toMatchObject({ ok: false, reason: 'not_saved', message: 'Buddy could not save your message.' });
  });

  it('returns null when nothing usable comes back', async () => {
    mocks.invoke.mockResolvedValueOnce({ data: null, error: new Error('network') });
    expect(await askBuddy('chat-1', 'Hi')).toBeNull();
  });
});
