import { supabase } from '../lib/supabaseClient';
import { DEFAULT_VIBE, parseVibe, type BuddyVibeId } from './buddyVibes';

/** Buddy's settings for this owner. Row-level security keeps them to this owner's row. */
export interface BuddySettings {
  vibe: BuddyVibeId;
  speakReplies: boolean;
}

export const DEFAULT_SETTINGS: BuddySettings = { vibe: DEFAULT_VIBE, speakReplies: false };

/** Turns a saved row into settings. A missing row or a bad value gives the defaults. */
export function parseSettingsRow(row: unknown): BuddySettings {
  if (!row || typeof row !== 'object') return DEFAULT_SETTINGS;
  const record = row as Record<string, unknown>;
  return {
    vibe: parseVibe(record.vibe),
    speakReplies: record.speak_replies === true,
  };
}

/** Reads the owner's settings. Null means they could not be read, so the caller keeps the defaults. */
export async function loadSettings(): Promise<BuddySettings | null> {
  try {
    const { data, error } = await supabase.from('buddy_owner_state').select('vibe,speak_replies').maybeSingle();
    if (error) return null;
    return parseSettingsRow(data);
  } catch {
    return null;
  }
}

/** Saves the look and the read-aloud switch. Returns false when nothing was saved, so the screen never claims otherwise. */
export async function saveSettings(settings: BuddySettings): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('buddy_owner_state')
      .upsert(
        { vibe: settings.vibe, speak_replies: settings.speakReplies, updated_at: new Date().toISOString() },
        { onConflict: 'owner_id' },
      );
    return !error;
  } catch {
    return false;
  }
}
