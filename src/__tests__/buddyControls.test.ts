import { describe, expect, it, vi } from 'vitest';
import {
  AUDITOR_REFUSAL,
  MIXED_MINDS_REFUSAL,
  TAKEOVER_REFUSAL,
  UNREADABLE_LINE,
  WAIT_LINE,
  controlChange,
  controlDoneLine,
  parseControlRequest,
} from '../../supabase/functions/_shared/buddyControls';
import { routeMessage } from '../../supabase/functions/_shared/buddyRouter';
import { HELD_CONTROL, laneFor } from '../../supabase/functions/_shared/buddyOrders';
import {
  CONTROL_FAILED_LINE,
  handleBuddyThink,
  type BuddyThinkDeps,
} from '../../supabase/functions/_shared/buddyThink';

const CHAT_ID = '6f1c2b7e-3d4a-4b8c-9e1f-0a2b3c4d5e6f';
const FORBIDDEN = /autonomy|control tower|orchestration|\brpc\b|payload|dispatch|daily kit|adapter/i;

/** Only the parts of the Buddy ports a routed request touches. Other calls are not reached by these tests. */
function deps(overrides: Partial<BuddyThinkDeps> = {}) {
  const saved: string[] = [];
  const base = {
    keyConfigured: async () => true,
    readKey: async () => 'FAKE-GEMINI-KEY-NOT-REAL-0001',
    readSecret: async (name: string) => (name === 'gemini_api_key' ? 'FAKE-GEMINI-KEY-NOT-REAL-0001' : null),
    allowCall: async () => true,
    askGemini: vi.fn(async () => ({ ok: true as const, text: 'unused' })),
    recordProbe: async () => {},
    loadChat: async (id: string) => (id === CHAT_ID ? { id, title: null } : null),
    loadHistory: async () => [],
    saveMessage: async (_chatId: string, _role: string, _kind: string, content: string) => {
      saved.push(content);
      return true;
    },
    touchChat: async () => {},
    now: () => new Date('2026-10-10T12:00:00Z'),
    loadPendingOrder: async () => ({ ok: true as const, instruction: null }),
    saveOrder: vi.fn(async () => true),
    readTakeover: async () => false as boolean | null,
    applyControl: vi.fn(async () => true),
    ...overrides,
  };
  return { deps: base as unknown as BuddyThinkDeps, saved, base };
}

describe('chat control requests: what each sentence means', () => {
  it('pauses and resumes one named door, only when the word door is there', () => {
    expect(parseControlRequest('Pause the Telegram door')).toEqual({ ok: true, action: { kind: 'pause_door', door: 'telegram' } });
    expect(parseControlRequest('Resume the Bluesky door')).toEqual({ ok: true, action: { kind: 'resume_door', door: 'bluesky' } });
    expect(parseControlRequest('Stop the WordPress.com doors')).toEqual({ ok: true, action: { kind: 'pause_door', door: 'wordpress_com' } });
    expect(parseControlRequest('Stop the medium pack')).toBeNull();
  });

  it('stops one mind, stops everything, and starts again', () => {
    expect(parseControlRequest('Stop the Analyst')).toEqual({ ok: true, action: { kind: 'kill_mind', mind: 'analyst' } });
    expect(parseControlRequest('Kill the Executioner')).toEqual({ ok: true, action: { kind: 'kill_mind', mind: 'executioner' } });
    expect(parseControlRequest('Stop everything')).toEqual({ ok: true, action: { kind: 'kill_all' } });
    expect(parseControlRequest('Start the CEO again')).toEqual({ ok: true, action: { kind: 'clear_kill' } });
    expect(parseControlRequest('Clear the kill switch')).toEqual({ ok: true, action: { kind: 'clear_kill' } });
  });

  it('refuses the Auditor, refuses a Takeover switch, and refuses a mix of minds', () => {
    expect(parseControlRequest('Stop the Auditor')).toEqual({ ok: false, refusal: AUDITOR_REFUSAL });
    expect(parseControlRequest('Turn Takeover on')).toEqual({ ok: false, refusal: TAKEOVER_REFUSAL });
    expect(parseControlRequest('Stop the Analyst and the CEO')).toEqual({ ok: false, refusal: MIXED_MINDS_REFUSAL });
  });

  it('two doors in one sentence, and ordinary orders, are not control requests', () => {
    expect(parseControlRequest('Pause the YouTube and Vimeo doors')).toBeNull();
    expect(parseControlRequest('Make the packs')).toBeNull();
    expect(parseControlRequest('Run today')).toBeNull();
  });
});

describe('chat control requests: how the route is chosen', () => {
  it('a plain pause or stop is a control route, and an Auditor stop is refused', () => {
    expect(routeMessage('Pause the Telegram door', null).kind).toBe('control');
    expect(routeMessage('Stop the Analyst', null).kind).toBe('control');
    expect(routeMessage('Stop the Auditor', null).kind).toBe('control_refused');
  });

  it('questions about a door or a mind are never control requests', () => {
    expect(routeMessage('Is the Telegram door paused?', null).kind).not.toBe('control');
    expect(routeMessage('How do I pause the telegram door?', null).kind).not.toBe('control');
    expect(routeMessage('Why did the Analyst stop?', null).kind).not.toBe('control');
  });

  it("'make the packs' is the same run-today request as 'run today'", () => {
    expect(routeMessage('Make the packs', null).kind).toBe('run_day');
    expect(routeMessage('Run today', null).kind).toBe('run_day');
  });
});

describe('a control request never runs as an article change', () => {
  it('a stored control request is held, even when it names a product', () => {
    expect(laneFor('Pause the Telegram door')).toEqual({ lane: 'held', reason: HELD_CONTROL });
    expect(laneFor('Stop the Strategist from changing products')).toEqual({ lane: 'held', reason: HELD_CONTROL });
  });

  it('make the packs and run today are the daily run lane', () => {
    expect(laneFor('Make the packs')).toEqual({ lane: 'daily_run' });
    expect(laneFor('Run today')).toEqual({ lane: 'daily_run' });
  });
});

describe('a control change writes only what the owner asked for', () => {
  it('kill, clear, and door pause and resume', () => {
    expect(controlChange({ kind: 'kill_mind', mind: 'analyst' }, { killScope: 'none', pausedDoors: [] })).toEqual({ kill_scope: 'analyst' });
    expect(controlChange({ kind: 'kill_all' }, { killScope: 'none', pausedDoors: [] })).toEqual({ kill_scope: 'all' });
    expect(controlChange({ kind: 'clear_kill' }, { killScope: 'all', pausedDoors: [] })).toEqual({ kill_scope: 'none' });
    expect(controlChange({ kind: 'pause_door', door: 'telegram' }, { killScope: 'none', pausedDoors: ['vimeo'] })).toEqual({ paused_doors: ['vimeo', 'telegram'] });
    expect(controlChange({ kind: 'pause_door', door: 'telegram' }, { killScope: 'none', pausedDoors: ['telegram'] })).toEqual({ paused_doors: ['telegram'] });
    expect(controlChange({ kind: 'resume_door', door: 'telegram' }, { killScope: 'none', pausedDoors: ['telegram', 'vimeo'] })).toEqual({ paused_doors: ['vimeo'] });
  });

  it('the reply lines are plain words, with no jargon and no em dash', () => {
    const lines = [
      controlDoneLine({ kind: 'kill_mind', mind: 'strategist' }),
      controlDoneLine({ kind: 'kill_all' }),
      controlDoneLine({ kind: 'clear_kill' }),
      controlDoneLine({ kind: 'pause_door', door: 'wordpress_com' }),
      controlDoneLine({ kind: 'resume_door', door: 'youtube' }),
      WAIT_LINE,
      UNREADABLE_LINE,
    ];
    for (const line of lines) {
      expect(line).not.toMatch(FORBIDDEN);
      expect(line).not.toContain('\u2014');
      expect(line).not.toMatch(/nigeria|naira|lagos/i);
    }
  });
});

describe('chat control requests and Takeover', () => {
  it('Takeover off: the request is saved as waiting, and nothing is changed', async () => {
    const { deps: d, base } = deps({ readTakeover: async () => false });
    const result = await handleBuddyThink({ action: 'ask', chat_id: CHAT_ID, message: 'Pause the Telegram door' }, d);
    expect(base.saveOrder).toHaveBeenCalledWith(CHAT_ID, 'Pause the Telegram door', null);
    expect(base.applyControl).not.toHaveBeenCalled();
    expect(result.body).toMatchObject({ ok: true, route: 'control', reply: WAIT_LINE });
  });

  it('Takeover unreadable: the request waits and nothing is changed', async () => {
    const { deps: d, base } = deps({ readTakeover: async () => null });
    const result = await handleBuddyThink({ action: 'ask', chat_id: CHAT_ID, message: 'Stop everything' }, d);
    expect(base.saveOrder).toHaveBeenCalledWith(CHAT_ID, 'Stop everything', null);
    expect(base.applyControl).not.toHaveBeenCalled();
    expect(result.body).toMatchObject({ ok: true, reply: UNREADABLE_LINE });
  });

  it('Takeover on: the change is made now, and nothing is filed as waiting', async () => {
    const { deps: d, base } = deps({ readTakeover: async () => true });
    const result = await handleBuddyThink({ action: 'ask', chat_id: CHAT_ID, message: 'Pause the Telegram door' }, d);
    expect(base.applyControl).toHaveBeenCalledWith({ kind: 'pause_door', door: 'telegram' });
    expect(base.saveOrder).not.toHaveBeenCalled();
    expect(result.body).toMatchObject({ ok: true, route: 'control', reply: controlDoneLine({ kind: 'pause_door', door: 'telegram' }) });
  });

  it('Takeover on but the change cannot be saved: the reply says nothing changed', async () => {
    const { deps: d } = deps({ readTakeover: async () => true, applyControl: async () => false });
    const result = await handleBuddyThink({ action: 'ask', chat_id: CHAT_ID, message: 'Stop the CEO' }, d);
    expect(result.body).toMatchObject({ ok: true, reply: CONTROL_FAILED_LINE });
  });

  it('the Auditor is refused in chat: nothing is filed and nothing is changed', async () => {
    const { deps: d, base } = deps({ readTakeover: async () => true });
    const result = await handleBuddyThink({ action: 'ask', chat_id: CHAT_ID, message: 'Stop the Auditor' }, d);
    expect(base.saveOrder).not.toHaveBeenCalled();
    expect(base.applyControl).not.toHaveBeenCalled();
    expect(result.body).toMatchObject({ ok: true, route: 'control_refused', reply: AUDITOR_REFUSAL });
  });

  it('a waiting request that cannot be saved is refused, and nothing is said as if it was filed', async () => {
    const { deps: d } = deps({ readTakeover: async () => false, saveOrder: async () => false });
    const result = await handleBuddyThink({ action: 'ask', chat_id: CHAT_ID, message: 'Pause the Telegram door' }, d);
    expect(result.status).toBe(503);
  });
});
