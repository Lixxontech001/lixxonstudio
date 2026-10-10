import { beforeEach, describe, expect, it, vi } from 'vitest';

type Result = { data: unknown; error: unknown };
const mocks = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('../lib/supabaseClient', () => ({ supabase: { from: mocks.from } }));

import { DEFAULT_SETTINGS, loadSettings, parseSettingsRow, saveSettings } from '../buddy/buddySettingsStore';
import { DEFAULT_VIBE, parseVibe, VIBES } from '../buddy/buddyVibes';

const upsert = vi.fn();
const selectChain = (result: Result) => {
  const chain: Record<string, unknown> = {
    then: (resolve: (value: Result) => unknown, reject?: (error: unknown) => unknown) => Promise.resolve(result).then(resolve, reject),
  };
  for (const method of ['select', 'maybeSingle', 'eq']) chain[method] = () => chain;
  return chain;
};

beforeEach(() => {
  mocks.from.mockReset();
  upsert.mockReset();
});

describe('Buddy looks', () => {
  it('offers exactly the four agreed looks, with Noir Gold first', () => {
    expect(VIBES.map((vibe) => vibe.name)).toEqual(['Noir Gold', 'Ivory Silk', 'Velvet Opera', 'Porcelain']);
    expect(DEFAULT_VIBE).toBe('noir-gold');
  });

  it('keeps a known look and falls back to Noir Gold for anything else', () => {
    expect(parseVibe('velvet-opera')).toBe('velvet-opera');
    expect(parseVibe('magazine-dark')).toBe('noir-gold');
    expect(parseVibe(undefined)).toBe('noir-gold');
    expect(parseVibe(42)).toBe('noir-gold');
  });
});

describe('Buddy settings: reading and saving', () => {
  it('turns a saved row into settings, and a missing row into the defaults', () => {
    expect(parseSettingsRow({ vibe: 'porcelain', speak_replies: true })).toEqual({ vibe: 'porcelain', speakReplies: true });
    expect(parseSettingsRow(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettingsRow({ vibe: 'bogus', speak_replies: 'yes' })).toEqual({ vibe: 'noir-gold', speakReplies: false });
  });

  it('starts with read-aloud off', () => {
    expect(DEFAULT_SETTINGS.speakReplies).toBe(false);
  });

  it('reads the owner’s own row, and returns null when the read fails', async () => {
    mocks.from.mockReturnValueOnce(selectChain({ data: { vibe: 'ivory-silk', speak_replies: false }, error: null }));
    expect(await loadSettings()).toEqual({ vibe: 'ivory-silk', speakReplies: false });
    expect(mocks.from).toHaveBeenCalledWith('buddy_owner_state');

    mocks.from.mockReturnValueOnce(selectChain({ data: null, error: new Error('denied') }));
    expect(await loadSettings()).toBeNull();
  });

  it('saves the look and the read-aloud switch on the owner’s row, and reports success', async () => {
    upsert.mockResolvedValueOnce({ error: null });
    mocks.from.mockReturnValueOnce({ upsert });
    expect(await saveSettings({ vibe: 'velvet-opera', speakReplies: true })).toBe(true);
    expect(upsert).toHaveBeenCalledWith(
      { vibe: 'velvet-opera', speak_replies: true, updated_at: expect.any(String) },
      { onConflict: 'owner_id' },
    );
  });

  it('says nothing was saved when the save fails, so the screen never claims otherwise', async () => {
    upsert.mockResolvedValueOnce({ error: new Error('denied') });
    mocks.from.mockReturnValueOnce({ upsert });
    expect(await saveSettings({ vibe: 'porcelain', speakReplies: false })).toBe(false);
  });

  it('never writes the article table when saving settings', async () => {
    upsert.mockResolvedValueOnce({ error: null });
    mocks.from.mockReturnValueOnce({ upsert });
    await saveSettings({ vibe: 'noir-gold', speakReplies: false });
    expect(mocks.from).not.toHaveBeenCalledWith('posts');
    expect(mocks.from).toHaveBeenCalledTimes(1);
  });
});
