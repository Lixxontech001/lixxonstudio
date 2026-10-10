import { useState } from 'react';
import { speechAvailable } from './buddySpeech';
import { saveSettings, type BuddySettings } from './buddySettingsStore';
import { VIBES, type BuddyVibeId } from './buddyVibes';
import './buddy.css';

interface BuddySettingsPanelProps {
  saved: BuddySettings;
  onBack: () => void;
  onSaved: (settings: BuddySettings) => void;
}

type SaveState = 'idle' | 'saving' | 'saved' | 'failed';

/**
 * Buddy's settings: the look and the optional read-aloud switch. Picking a look previews it at once;
 * nothing is kept until Save is pressed, and a failed save says so.
 */
export default function BuddySettingsPanel({ saved, onBack, onSaved }: BuddySettingsPanelProps) {
  const [draft, setDraft] = useState<BuddySettings>(saved);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const canSpeak = speechAvailable();
  const changed = draft.vibe !== saved.vibe || draft.speakReplies !== saved.speakReplies;

  const chooseVibe = (vibe: BuddyVibeId) => {
    setDraft((previous) => ({ ...previous, vibe }));
    setSaveState('idle');
  };

  const toggleSpeak = (speakReplies: boolean) => {
    setDraft((previous) => ({ ...previous, speakReplies }));
    setSaveState('idle');
  };

  const save = async () => {
    setSaveState('saving');
    const ok = await saveSettings(draft);
    if (ok) {
      onSaved(draft);
      setSaveState('saved');
    } else {
      setSaveState('failed');
    }
  };

  return (
    <div className="buddy-app" data-vibe={draft.vibe} data-testid="buddy-settings">
      <header className="buddy-top">
        <button type="button" className="buddy-button" onClick={onBack}>
          Back to Buddy
        </button>
        <h1 className="buddy-name">Buddy settings</h1>
      </header>

      <main className="buddy-log" aria-label="Buddy settings">
        <div className="buddy-log-inner">
          <section className="buddy-settings-section" aria-labelledby="buddy-look-title">
            <h2 id="buddy-look-title" className="buddy-settings-title">How Buddy looks</h2>
            <div className="buddy-vibe-grid" role="group" aria-label="Buddy's look">
              {VIBES.map((vibe) => {
                const on = draft.vibe === vibe.id;
                return (
                  <button
                    key={vibe.id}
                    type="button"
                    className={`buddy-vibe-card${on ? ' buddy-vibe-card--on' : ''}`}
                    aria-pressed={on}
                    onClick={() => chooseVibe(vibe.id)}
                  >
                    <span className="buddy-swatch" data-vibe={vibe.id} aria-hidden="true">
                      <span className="buddy-swatch-dot" />
                    </span>
                    <span className="buddy-vibe-name">{vibe.name}</span>
                    <span className="buddy-vibe-note">{vibe.note}</span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="buddy-settings-section" aria-labelledby="buddy-speak-title">
            <h2 id="buddy-speak-title" className="buddy-settings-title">Reading aloud</h2>
            <label className="buddy-switch-row">
              <input
                type="checkbox"
                checked={draft.speakReplies}
                disabled={!canSpeak}
                onChange={(event) => toggleSpeak(event.target.checked)}
              />
              <span>Read Buddy’s replies aloud</span>
            </label>
            <p className="buddy-hint">
              {canSpeak
                ? 'Off unless you turn it on. It uses this browser’s own voice, so it costs nothing.'
                : 'This browser cannot read aloud, so this switch does nothing here.'}
            </p>
          </section>

          <div className="buddy-settings-actions">
            <button type="button" className="buddy-button buddy-button--solid" onClick={() => void save()} disabled={!changed || saveState === 'saving'}>
              Save settings
            </button>
            {saveState === 'saved' && <p className="buddy-hint" role="status">Saved. Buddy will look like this next time too.</p>}
            {saveState === 'failed' && (
              <p className="buddy-banner buddy-error" role="alert">Buddy could not save your settings. Try again shortly.</p>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
