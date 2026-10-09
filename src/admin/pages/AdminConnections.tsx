import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../context/AuthContext';
import { Btn, Loading, Notice } from '../components/ui';
import { DOOR_IDS, DOORS, doorStatus, type DoorField, type DoorId, type DoorState } from '../../../supabase/functions/_shared/doorRegistry';
import { DOOR_TEST_MESSAGE, type DoorTestStatus } from '../../../supabase/functions/_shared/doorConnectionTests';

// One simple page: the six free doors, each with its details typed once. Values are saved to Vault by the owner-only
// functions the Keys page already uses. Nothing here posts. Buddy only posts once a door is connected and the
// posting step is built and turned on (later Phase 5 slices).

export const CONNECTIONS_INTRO = 'Connect the free places Buddy can post to. Saving here only stores the details. Nothing is posted from this page.';
export const CONNECTIONS_MANUAL = 'Instagram, TikTok, Facebook and Pinterest stay manual. You post those by hand, and Buddy never presses Post on them.';
export const CONNECTIONS_NEVER_SHOWN = 'Saved values are never shown again. To change one, type a new value and save.';
export const CONNECTIONS_READ_FAILED = 'I cannot read your connections yet.';
export const CONNECTIONS_SAVE_FAILED = 'Could not save. Nothing changed. Try again.';
export const CONNECTIONS_REMOVE_FAILED = 'Could not remove it. Nothing changed. Try again.';
export const CONNECTIONS_EMPTY_VALUE = 'Type a value first.';
export const CONNECTIONS_REMOVE_CONFIRM = 'Remove this saved value? Buddy cannot post there until you add it again.';
export const CONNECTIONS_TEST_FAILED = 'The test could not run. Nothing was posted. Try again.';
export const CONNECTIONS_TEST_NOTE = 'Test connection checks the saved details with the door. It never posts.';

const STATE_LABEL: Record<DoorState, string> = {
  connected: 'Connected',
  partly: 'Partly connected',
  not_connected: 'Not connected',
};

const CARD_CLASS = 'rounded-sm border border-taupe/40 bg-white p-4 shadow-sm';

/** Reads the saved catalogue names from the owner's list. A row counts only when it is configured. */
export function savedNamesFrom(rows: unknown): Set<string> | null {
  if (!Array.isArray(rows)) return null;
  const saved = new Set<string>();
  for (const row of rows) {
    if (row && typeof row === 'object') {
      const record = row as Record<string, unknown>;
      if (typeof record.name === 'string' && record.configured === true) saved.add(record.name);
    }
  }
  return saved;
}

export function stateLabel(state: DoorState): string {
  return STATE_LABEL[state];
}

export function fieldStatus(saved: boolean): string {
  return saved ? 'Saved' : 'Not saved yet';
}

type ReadState = { status: 'loading' } | { status: 'ready'; saved: Set<string> } | { status: 'error' };
type Message = { tone: 'ok' | 'error'; text: string } | null;

export default function AdminConnections() {
  const { can } = useAuth();
  const allowed = can('automation.keys');
  const [read, setRead] = useState<ReadState>({ status: 'loading' });
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<Message>(null);
  const [testing, setTesting] = useState<DoorId | null>(null);
  const [testResults, setTestResults] = useState<Partial<Record<DoorId, DoorTestStatus>>>({});

  const load = async () => {
    const { data, error } = await supabase.rpc('automation_list_secrets');
    const saved = error ? null : savedNamesFrom(data);
    setRead(saved ? { status: 'ready', saved } : { status: 'error' });
  };

  useEffect(() => {
    if (!allowed) return;
    let live = true;
    supabase.rpc('automation_list_secrets').then(({ data, error }) => {
      if (!live) return;
      const saved = error ? null : savedNamesFrom(data);
      setRead(saved ? { status: 'ready', saved } : { status: 'error' });
    });
    return () => {
      live = false;
    };
  }, [allowed]);

  if (!allowed) {
    return <Notice tone="warn">Only the owner can see Connections.</Notice>;
  }

  const save = async (field: DoorField) => {
    const value = (drafts[field.secretName] ?? '').trim();
    if (!value) {
      setMessage({ tone: 'error', text: CONNECTIONS_EMPTY_VALUE });
      return;
    }
    setBusy(field.secretName);
    setMessage(null);
    const { error } = await supabase.rpc('automation_secret_save', { p_secret_name: field.secretName, p_secret_value: value });
    setBusy(null);
    if (error) {
      setMessage({ tone: 'error', text: CONNECTIONS_SAVE_FAILED });
      return;
    }
    setDrafts((current) => ({ ...current, [field.secretName]: '' }));
    setMessage({ tone: 'ok', text: `${field.label} saved.` });
    await load();
  };

  const runTest = async (id: DoorId) => {
    setTesting(id);
    setTestResults((current) => ({ ...current, [id]: undefined }));
    const { data, error } = await supabase.functions.invoke('door-connection-test', { body: { door: id } });
    setTesting(null);
    const status = (data as { status?: unknown } | null)?.status;
    if (error || typeof status !== 'string' || !Object.prototype.hasOwnProperty.call(DOOR_TEST_MESSAGE, status)) {
      setTestResults((current) => ({ ...current, [id]: 'unavailable' }));
      setMessage({ tone: 'error', text: CONNECTIONS_TEST_FAILED });
      return;
    }
    setTestResults((current) => ({ ...current, [id]: status as DoorTestStatus }));
  };

  const remove = async (field: DoorField) => {
    if (!window.confirm(CONNECTIONS_REMOVE_CONFIRM)) return;
    setBusy(field.secretName);
    setMessage(null);
    const { error } = await supabase.rpc('automation_secret_delete', { p_secret_name: field.secretName });
    setBusy(null);
    if (error) {
      setMessage({ tone: 'error', text: CONNECTIONS_REMOVE_FAILED });
      return;
    }
    setMessage({ tone: 'ok', text: `${field.label} removed.` });
    await load();
  };

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-serif text-charcoal">Connections</h1>
        <p className="mt-1 text-sm text-charcoal-muted">{CONNECTIONS_INTRO}</p>
        <p className="mt-1 text-sm text-charcoal-muted">{CONNECTIONS_MANUAL}</p>
        <p className="mt-1 text-sm text-charcoal-muted">{CONNECTIONS_NEVER_SHOWN}</p>
      </header>

      {message && <Notice tone={message.tone === 'ok' ? 'ok' : 'error'}>{message.text}</Notice>}

      {read.status === 'loading' && <Loading />}
      {read.status === 'error' && <Notice tone="error">{CONNECTIONS_READ_FAILED}</Notice>}

      {read.status === 'ready' && DOOR_IDS.map((id: DoorId) => {
        const door = DOORS[id];
        const status = doorStatus(id, read.saved);
        return (
          <section key={id} className={CARD_CLASS} aria-labelledby={`door-${id}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id={`door-${id}`} className="text-lg font-semibold text-charcoal">{door.label}</h2>
              <span className="text-sm text-charcoal-muted">{stateLabel(status.state)}</span>
            </div>
            <p className="mt-1 text-sm text-charcoal-muted">{door.summary}</p>

            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Btn
                onClick={() => runTest(id)}
                busy={testing === id}
                disabled={status.state !== 'connected' || (testing !== null && testing !== id)}
              >
                Test connection
              </Btn>
              {status.state !== 'connected' && (
                <span className="text-xs text-charcoal-muted">{DOOR_TEST_MESSAGE.not_connected}</span>
              )}
              {testResults[id] && (
                <span role="status" className="text-sm text-charcoal">{DOOR_TEST_MESSAGE[testResults[id]!]}</span>
              )}
            </div>

            <ul className="mt-3 space-y-3">
              {door.fields.map((field) => {
                const saved = read.saved.has(field.secretName);
                const inputId = `field-${field.secretName}`;
                return (
                  <li key={field.secretName} className="rounded-sm border border-taupe/30 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <label htmlFor={inputId} className="text-sm font-medium text-charcoal">{field.label}</label>
                      <span className="text-xs text-charcoal-muted">{fieldStatus(saved)}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <input
                        id={inputId}
                        type={field.kind === 'secret' ? 'password' : 'text'}
                        autoComplete="off"
                        spellCheck={false}
                        value={drafts[field.secretName] ?? ''}
                        onChange={(event) => setDrafts((current) => ({ ...current, [field.secretName]: event.target.value }))}
                        placeholder={saved ? 'Type a new value to replace it' : 'Type it once'}
                        className="min-w-0 flex-1 rounded-sm border border-taupe/50 px-3 py-2 text-sm"
                      />
                      <Btn onClick={() => save(field)} busy={busy === field.secretName} disabled={busy !== null && busy !== field.secretName}>
                        Save
                      </Btn>
                      {saved && (
                        <Btn variant="danger" onClick={() => remove(field)} disabled={busy !== null && busy !== field.secretName}>
                          Remove
                        </Btn>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      {read.status === 'ready' && (
        <p className="text-xs text-charcoal-muted">Connected means every field is saved. {CONNECTIONS_TEST_NOTE}</p>
      )}
    </div>
  );
}
