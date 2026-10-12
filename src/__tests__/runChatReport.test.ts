import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { RUN_CHAT_REPORT_LIMIT, saveRunChatReport } from '../../supabase/functions/_shared/runChatReport';

const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const CHAT_ID = '22222222-2222-4222-8222-222222222222';
const RUN_SOURCE = readFileSync(resolve(process.cwd(), 'supabase/functions/minds-run-placement/index.ts'), 'utf8');

describe('Phase J slice 4: run results stay in the originating chat', () => {
  it('saves the combined run result as a Buddy reply and touches only that chat', async () => {
    const saveBuddyReply = vi.fn(async () => true);
    const touchChat = vi.fn(async () => {});
    const detail = 'The article edit is done. Four packs were saved. Telegram posted the article.';

    await expect(saveRunChatReport({ ownerId: OWNER_ID, chatId: CHAT_ID, detail }, { saveBuddyReply, touchChat })).resolves.toBe(true);
    expect(saveBuddyReply).toHaveBeenCalledWith({ ownerId: OWNER_ID, chatId: CHAT_ID, content: detail });
    expect(touchChat).toHaveBeenCalledWith({ ownerId: OWNER_ID, chatId: CHAT_ID });
  });

  it('does not save empty details and reports a message-write failure honestly', async () => {
    const saveBuddyReply = vi.fn(async () => false);
    const touchChat = vi.fn(async () => {});
    const ports = { saveBuddyReply, touchChat };

    await expect(saveRunChatReport({ ownerId: OWNER_ID, chatId: CHAT_ID, detail: '  ' }, ports)).resolves.toBe(false);
    await expect(saveRunChatReport({ ownerId: OWNER_ID, chatId: CHAT_ID, detail: 'Run details.' }, ports)).resolves.toBe(false);
    expect(saveBuddyReply).toHaveBeenCalledTimes(1);
    expect(touchChat).not.toHaveBeenCalled();
  });

  it('keeps a saved reply even if refreshing the chat timestamp fails', async () => {
    const saveBuddyReply = vi.fn(async () => true);
    const touchChat = vi.fn(async () => { throw new Error('fake storage failure'); });

    await expect(saveRunChatReport({ ownerId: OWNER_ID, chatId: CHAT_ID, detail: 'The run finished.' }, { saveBuddyReply, touchChat })).resolves.toBe(true);
  });

  it('clips the report to the chat message limit', async () => {
    const saveBuddyReply = vi.fn(async () => true);
    const touchChat = vi.fn(async () => {});

    await saveRunChatReport({ ownerId: OWNER_ID, chatId: CHAT_ID, detail: 'x'.repeat(RUN_CHAT_REPORT_LIMIT + 50) }, { saveBuddyReply, touchChat });
    expect(saveBuddyReply.mock.calls[0][0].content).toHaveLength(RUN_CHAT_REPORT_LIMIT);
  });

  it('validates chat ownership before a run and reports whether the result was saved', () => {
    expect(RUN_SOURCE).toContain('const requestedChat = asRecord(body)?.chat_id;');
    expect(RUN_SOURCE).toContain('const chatId = !internal && typeof requestedChat === "string" ? requestedChat : null;');
    expect(RUN_SOURCE).toContain('.from("buddy_chats").select("id").eq("id", chatId).eq("owner_id", owner).maybeSingle()');
    expect(RUN_SOURCE).toContain('saveRunChatReport(');
    expect(RUN_SOURCE).toContain('chat_reply_saved: saved');
    expect(RUN_SOURCE).toContain('return reportOut({');
  });
});
