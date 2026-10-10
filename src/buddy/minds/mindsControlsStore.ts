import { supabase } from '../../lib/supabaseClient';
import { isKillScope, type KillScope } from './mindRoster';

/** The owner's Takeover and Kill settings. One row, owner only (row-level security). */
export type MindsControls = { takeover: boolean; killScope: KillScope };

/** Defaults: Takeover off, nothing stopped. Used when no row has been saved yet. */
export const MINDS_CONTROLS_DEFAULTS: MindsControls = { takeover: false, killScope: 'none' };

export const MINDS_READ_FAILED = 'Minds could not be read. Try again shortly.';
export const MINDS_SAVE_FAILED = 'Minds could not save. Try again shortly.';

/**
 * Reads a saved row. Takeover is on only when the saved value is exactly true.
 * A Kill value that is not recognised becomes "all": when unsure, stop everything.
 */
export function parseMindsControls(row: unknown): MindsControls {
  if (!row || typeof row !== 'object') return { ...MINDS_CONTROLS_DEFAULTS };
  const record = row as Record<string, unknown>;
  return {
    takeover: record.takeover === true,
    killScope: isKillScope(record.kill_scope) ? record.kill_scope : 'all',
  };
}

export async function loadMindsControls(): Promise<{ ok: true; value: MindsControls } | { ok: false }> {
  try {
    const { data, error } = await supabase.from('minds_controls').select('takeover,kill_scope').eq('id', 1).maybeSingle();
    if (error) return { ok: false };
    return { ok: true, value: parseMindsControls(data) };
  } catch {
    return { ok: false };
  }
}

export async function saveMindsControls(next: MindsControls, userId: string): Promise<{ ok: boolean }> {
  try {
    const { error } = await supabase.from('minds_controls').upsert(
      { id: 1, takeover: next.takeover, kill_scope: next.killScope, updated_by: userId, updated_at: new Date().toISOString(), change_source: 'minds' },
      { onConflict: 'id' },
    );
    if (error) return { ok: false };
    notifyControlSaved();
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/**
 * Asks the server to attempt the owner's push for the notable the save just wrote. Best effort: the save already
 * happened, and a missed or unavailable push is never shown as a failed save.
 */
function notifyControlSaved(): void {
  try {
    void supabase.functions.invoke('minds-control-notify', { body: {} }).catch(() => undefined);
  } catch {
    // Nothing to do: the owner's switch is saved, and the push is extra.
  }
}
