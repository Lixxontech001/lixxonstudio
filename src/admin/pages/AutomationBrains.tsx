import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, FlaskConical, Loader2, RefreshCw } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { parseAutomationKeyList, safeAutomationKeyTestResult, type AutomationKeyEntry } from '../../lib/automationKeys';
import { brainRows, type BrainRow } from '../../lib/brainRows';

type Notice = { tone: 'success' | 'warning' | 'error' | 'info'; message: string };

const TONE_CLASS: Record<Notice['tone'], string> = {
  success: 'border-green-200 bg-green-50 text-green-800',
  warning: 'border-amber-200 bg-amber-50 text-amber-800',
  error: 'border-red-200 bg-red-50 text-red-700',
  info: 'border-blue-200 bg-blue-50 text-blue-800',
};

function toneFor(status: string): Notice['tone'] {
  if (status === 'ok') return 'success';
  if (status === 'local_ok') return 'info';
  if (status === 'invalid') return 'error';
  return 'warning';
}

/** Buddy's brains, in try order. Each row: the key box, Save, Saved or Not saved, and Test (one read-only ping). */
export default function AutomationBrains() {
  const rows = brainRows();
  const [items, setItems] = useState<AutomationKeyEntry[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyName, setBusyName] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  const refresh = useCallback(async (showSpinner = false): Promise<boolean> => {
    if (showSpinner) setRefreshing(true);
    try {
      const { data, error } = await supabase.rpc('automation_list_secrets');
      const safeItems = error ? null : parseAutomationKeyList(data);
      if (!safeItems) {
        setLoadFailed(true);
        setItems([]);
        return false;
      }
      setItems(safeItems);
      setLoadFailed(false);
      return true;
    } catch {
      setLoadFailed(true);
      setItems([]);
      return false;
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const isSaved = (name: string) => items.some((item) => item.name === name && item.configured);

  const setDraft = (name: string, value: string) => setDrafts((current) => ({ ...current, [name]: value }));

  const save = async (row: BrainRow) => {
    const pending = [row.keyName, row.identifier?.name]
      .filter((name): name is string => Boolean(name))
      .map((name) => ({ name, value: drafts[name] || '' }))
      .filter((entry) => entry.value.length > 0);
    if (pending.length === 0) {
      setNotice({ tone: 'warning', message: `Paste the ${row.keyLabel.toLowerCase()} for ${row.slot.label} before saving. The value is never shown again after a save attempt.` });
      return;
    }
    if (isSaved(row.keyName) && !window.confirm(`Replace the stored ${row.slot.label} key? The current Vault value will be permanently replaced.`)) return;

    // Clear the boxes before the RPC runs, so a failed save never leaves the value in the form.
    setDrafts((current) => {
      const next = { ...current };
      for (const entry of pending) next[entry.name] = '';
      return next;
    });
    setBusyName(row.keyName);
    setNotice(null);
    try {
      for (const entry of pending) {
        const { error } = await supabase.rpc('automation_secret_save', { p_secret_name: entry.name, p_secret_value: entry.value });
        if (error) {
          setNotice({ tone: 'error', message: `Could not save the ${row.slot.label} entry. Confirm owner access and Vault availability, then paste it again.` });
          return;
        }
      }
      setNotice({ tone: 'success', message: `${row.slot.label} saved in Supabase Vault. The saved value cannot be viewed here.` });
      await refresh();
    } catch {
      setNotice({ tone: 'error', message: `Could not save the ${row.slot.label} entry. No value was kept in the form; check the connection and paste it again.` });
    } finally {
      setBusyName(null);
    }
  };

  const test = async (row: BrainRow) => {
    if (!isSaved(row.keyName)) return;
    setBusyName(row.keyName);
    setNotice(null);
    try {
      const { data, error } = await supabase.functions.invoke('automation-keys', {
        body: { action: 'test', name: row.keyName },
      });
      if (error) {
        setNotice({ tone: 'error', message: `The ${row.slot.label} test could not complete. No provider response or credential was shown.` });
        return;
      }
      const result = safeAutomationKeyTestResult(data);
      if (!result) {
        setNotice({ tone: 'error', message: `The ${row.slot.label} test returned an unrecognized result. No provider response was shown.` });
        return;
      }
      setNotice({ tone: toneFor(result.status), message: `${row.slot.label}: ${result.message}` });
      await refresh();
    } catch {
      setNotice({ tone: 'error', message: `The ${row.slot.label} test could not complete. No provider response or credential was shown.` });
    } finally {
      setBusyName(null);
    }
  };

  return (
    <div className="max-w-3xl">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="font-serif text-2xl text-charcoal">Brains</h1>
          <p className="text-sm text-gray-500 mt-1">
            Buddy tries these brains in this order and skips any with no saved key. Paste a key once. It is never shown again.
            Test makes one read-only request and publishes nothing.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh(true)}
          disabled={refreshing}
          className="inline-flex items-center gap-2 border border-gray-300 rounded px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {refreshing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          Refresh
        </button>
      </div>

      {notice && (
        <div role="status" aria-live="polite" className={`mb-4 border rounded px-3 py-2 text-sm ${TONE_CLASS[notice.tone]}`}>
          {notice.message}
        </div>
      )}

      {loading && <p role="status" className="text-sm text-gray-400 py-8 text-center">Loading brains…</p>}

      {!loading && loadFailed && (
        <div className="flex items-center gap-2 border border-red-200 bg-red-50 text-red-700 rounded px-3 py-2 text-sm">
          <AlertTriangle size={16} />
          The saved-key list could not be read. Confirm owner access, then press Refresh.
        </div>
      )}

      {!loading && !loadFailed && (
        <ol className="space-y-4">
          {rows.map((row) => {
            const saved = isSaved(row.keyName);
            const busy = busyName === row.keyName;
            const skipped = row.slot.access === 'skip';
            return (
              <li key={row.slot.id} className="border border-gray-200 rounded-lg bg-white p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="font-medium text-charcoal">{row.slot.order}. {row.slot.label}</h2>
                    <p className="text-sm text-gray-600 mt-1">{row.slot.purpose}</p>
                  </div>
                  <span className={`shrink-0 inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded ${saved ? 'bg-green-50 text-green-800' : 'bg-gray-100 text-gray-600'}`}>
                    {saved && <CheckCircle2 size={12} />}
                    {saved ? 'Saved' : 'Not saved'}
                  </span>
                </div>

                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="text-sm text-gray-700">
                    {row.keyLabel}
                    <input
                      type="password"
                      autoComplete="off"
                      spellCheck={false}
                      value={drafts[row.keyName] || ''}
                      onChange={(event) => setDraft(row.keyName, event.target.value)}
                      placeholder={saved ? 'Saved. Paste a new one to replace it.' : `Paste the ${row.keyLabel.toLowerCase()}`}
                      className="mt-1 w-full border border-gray-300 rounded px-3 py-2 text-sm"
                    />
                  </label>
                  {row.identifier && (
                    <label className="text-sm text-gray-700">
                      {row.identifier.label}
                      <input
                        type="text"
                        autoComplete="off"
                        spellCheck={false}
                        value={drafts[row.identifier.name] || ''}
                        onChange={(event) => setDraft(row.identifier!.name, event.target.value)}
                        placeholder={isSaved(row.identifier.name) ? 'Saved. Paste a new one to replace it.' : 'Paste the account ID'}
                        className="mt-1 w-full border border-gray-300 rounded px-3 py-2 text-sm"
                      />
                    </label>
                  )}
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void save(row)}
                    disabled={busy}
                    className="inline-flex items-center gap-2 bg-charcoal text-white rounded px-3 py-2 text-sm disabled:opacity-50"
                  >
                    {busy && <Loader2 size={14} className="animate-spin" />}
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => void test(row)}
                    disabled={busy || !saved || !row.testable}
                    className="inline-flex items-center gap-2 border border-gray-300 rounded px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    <FlaskConical size={14} />
                    Test
                  </button>
                  {skipped && (
                    <span className="text-xs text-gray-500">Buddy skips this brain for now, so Test is off.</span>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
