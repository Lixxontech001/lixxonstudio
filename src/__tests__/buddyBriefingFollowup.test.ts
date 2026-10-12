import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const edge = readFileSync('supabase/functions/buddy-think/index.ts', 'utf8');
const think = readFileSync('supabase/functions/_shared/buddyThink.ts', 'utf8');

describe('Phase J slice 5: briefing follow-ups use saved facts', () => {
  it('reads the thread kind with the owner session', () => {
    const start = edge.indexOf('loadChat: async');
    const end = edge.indexOf('loadHistory: async', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const reader = edge.slice(start, end);
    expect(reader).toContain('userClient.from("buddy_chats").select("id,title,kind")');
    expect(reader).toContain('data.kind === "briefing"');
    expect(reader).not.toMatch(/\.(insert|update|upsert|delete|rpc)\(/);
  });

  it('reads only the latest briefing text in that same owner-visible chat', () => {
    const start = edge.indexOf('loadBriefingContext: async');
    const end = edge.indexOf('saveMessage:', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const reader = edge.slice(start, end);
    expect(reader).toContain('userClient');
    expect(reader).toContain('from("buddy_messages")');
    expect(reader).toContain('.select("content")');
    expect(reader).toContain('.eq("chat_id", chatId)');
    expect(reader).toContain('.eq("kind", "briefing")');
    expect(reader).toContain('.order("created_at", { ascending: false })');
    expect(reader).toContain('.limit(1)');
    expect(reader).not.toMatch(/\.(insert|update|upsert|delete|rpc)\(/);
  });

  it('uses the saved briefing only for question-style follow-ups and keeps orders on their existing path', () => {
    expect(think).toContain('route.kind === "chat" && chat.kind === "briefing" && isQuestionLike(message)');
    expect(think).toContain('answerFactQuestion(chatId, title, message, { kind: "briefing_followup" }');
    expect(think).toContain('When THE SAVED BRIEFING is supplied');
    expect(think).toContain('const clipped = text.slice(0, BRIEFING_FOLLOWUP_FACT_LIMIT);');
  });
});
