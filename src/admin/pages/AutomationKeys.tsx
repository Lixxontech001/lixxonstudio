import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, ChevronDown, FlaskConical, KeyRound, Loader2,
  LockKeyhole, RefreshCw, ShieldCheck, Trash2,
} from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import VapidGenerator from '../components/VapidGenerator';
import { withoutBrainKeys } from '../../lib/brainRows';
import {
  AUTOMATION_KEY_CATEGORIES,
  automationStatusClass,
  automationTestStatusLabel,
  keysWithoutDoorDetails,
  parseAutomationKeyList,
  safeAutomationKeyTestResult,
  type AutomationKeyCategory,
  type AutomationKeyEntry,
} from '../../lib/automationKeys';

const DEFAULT_VAPID_SUBJECT = 'mailto:owner@lixxonstudio.com';

const CATEGORY_LABELS: Record<AutomationKeyCategory, string> = {
  ai: 'AI providers',
  actions: 'GitHub Actions',
  commerce: 'Commerce & payments',
  email: 'Email',
  social: 'Social & messaging',
  video: 'Video & stock media',
  push: 'Web Push',
};

function testNote(name: string): string {
  if (name.startsWith('x_')) return 'Local format check only. No X request is made because API access can consume paid credit.';
  if (name.startsWith('tumblr_')) return 'Local format check only. A provider probe needs the complete OAuth 1.0a channel adapter.';
  if (name.startsWith('youtube_')) return 'When the client ID, client secret and refresh token are all stored, this tests OAuth and reads the channel ID. Otherwise it checks format only.';
  if (name === 'telegram_chat_id') return 'Private destination for failure alerts; the test checks numeric format locally and sends no message.';
  if (name === 'github_dispatch_token') return 'Checks read access to this repository only. Workflow-dispatch write permission is not exercised.';
  if (name === 'coverr_api_key') return 'Makes one read-only video-list request and consumes one Coverr API request from your account quota.';
  if (name === 'flutterwave_webhook_hash' || name.startsWith('vapid_')) return 'Local format check only. Delivery or webhook verification is tested by its later end-to-end flow.';
  if (name.endsWith('_client_secret') || name.endsWith('_client_id') || name.endsWith('_client_key')) return 'This app credential cannot authenticate alone; the check validates its format without contacting the provider.';
  if (name.endsWith('_id') || name.endsWith('_identifier') || name.endsWith('_board_id')) return 'Account identifier only; the check validates its format and makes no provider request.';
  return 'Makes one read-only provider request. It does not publish, send, charge, or modify account data.';
}

function lastTestTime(value: string | null): string {
  if (!value) return 'Never tested';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Never tested' : date.toLocaleString();
}

function statusNotice(status: string): { tone: 'success' | 'warning' | 'error' | 'info'; message: string } {
  const result = safeAutomationKeyTestResult({ name: 'automation_test', status });
  if (!result) return { tone: 'error', message: 'The key test returned an unrecognized result.' };
  if (status === 'ok') return { tone: 'success', message: result.message };
  if (status === 'local_ok') return { tone: 'info', message: result.message };
  if (status === 'invalid') return { tone: 'error', message: result.message };
  return { tone: 'warning', message: result.message };
}

export default function AutomationKeys() {
  const [items, setItems] = useState<AutomationKeyEntry[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyName, setBusyName] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'warning' | 'error' | 'info'; message: string } | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [vapidSubject, setVapidSubject] = useState(DEFAULT_VAPID_SUBJECT);
  const [generatedVapidPublicKey, setGeneratedVapidPublicKey] = useState('');

  const refresh = useCallback(async (showSpinner = false): Promise<boolean> => {
    if (showSpinner) setRefreshing(true);
    try {
      const { data, error } = await supabase.rpc('automation_list_secrets');
      if (error) {
        setLoadFailed(true);
        setItems([]);
        return false;
      }
      const safeItems = parseAutomationKeyList(data);
      if (!safeItems) {
        setLoadFailed(true);
        setItems([]);
        return false;
      }
      setItems(withoutBrainKeys(keysWithoutDoorDetails(safeItems)));
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

  const grouped = useMemo(() => {
    const groups = new Map<AutomationKeyCategory, AutomationKeyEntry[]>();
    for (const category of AUTOMATION_KEY_CATEGORIES) groups.set(category, []);
    for (const item of items) groups.get(item.category)?.push(item);
    return groups;
  }, [items]);

  const save = async (item: AutomationKeyEntry) => {
    const value = drafts[item.name] || '';
    if (!value.length) {
      setNotice({ tone: 'warning', message: 'Paste a credential before saving. The value is never shown again after a save attempt.' });
      return;
    }
    if (item.configured && !window.confirm(`Replace the stored ${item.label}? The current Vault value will be permanently replaced.`)) return;

    // Remove it from React state before sending the one-time RPC; failed saves are
    // not copied back into the input or browser storage.
    setDrafts(current => ({ ...current, [item.name]: '' }));
    setBusyName(item.name);
    setNotice(null);
    try {
      const { error } = await supabase.rpc('automation_secret_save', {
        p_secret_name: item.name,
        p_secret_value: value,
      });
      if (error) {
        setNotice({ tone: 'error', message: 'Could not save this credential. Confirm owner access and Vault availability, then paste it again.' });
        return;
      }
      setNotice({ tone: 'success', message: `${item.label} saved in Supabase Vault. The saved value cannot be viewed here.` });
      await refresh();
    } catch {
      setNotice({ tone: 'error', message: 'Could not save this credential. No value was retained in the form; check the connection and paste it again.' });
    } finally {
      setBusyName(null);
    }
  };

  const remove = async (item: AutomationKeyEntry) => {
    if (!item.configured || !window.confirm(`Permanently delete the stored ${item.label} from Supabase Vault?`)) return;
    setDrafts(current => ({ ...current, [item.name]: '' }));
    setBusyName(item.name);
    setNotice(null);
    try {
      const { error } = await supabase.rpc('automation_secret_delete', { p_secret_name: item.name });
      if (error) {
        setNotice({ tone: 'error', message: 'Could not delete this credential. Confirm owner access and try again.' });
        return;
      }
      setNotice({ tone: 'success', message: `${item.label} was deleted from Vault.` });
      await refresh();
    } catch {
      setNotice({ tone: 'error', message: 'Could not delete this credential. Check the connection and try again.' });
    } finally {
      setBusyName(null);
    }
  };

  const test = async (item: AutomationKeyEntry) => {
    if (!item.configured) return;
    setBusyName(item.name);
    setNotice(null);
    try {
      const { data, error } = await supabase.functions.invoke('automation-keys', {
        body: { action: 'test', name: item.name },
      });
      if (error) {
        setNotice({ tone: 'error', message: 'The owner-only key test could not complete. No provider response or credential was shown.' });
        return;
      }
      const result = safeAutomationKeyTestResult(data);
      if (!result) {
        setNotice({ tone: 'error', message: 'The key test returned an unrecognized result. No provider response was shown.' });
        return;
      }
      setNotice(statusNotice(result.status));
      await refresh();
    } catch {
      setNotice({ tone: 'error', message: 'The key test could not complete. No provider response or credential was shown.' });
    } finally {
      setBusyName(null);
    }
  };

  const generateVapid = async () => {
    const subject = vapidSubject.trim() || DEFAULT_VAPID_SUBJECT;
    if (!/^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/.test(subject) && !(subject.startsWith('https://') && !/\s/.test(subject))) {
      setNotice({ tone: 'warning', message: 'Use a contact subject in mailto:owner@example.com or https://example.com form.' });
      return;
    }
    if (items.some(item => item.name.startsWith('vapid_') && item.configured)
      && !window.confirm('Replace the stored VAPID keypair and contact subject? The current private key will be permanently replaced.')) return;

    setBusyName('__vapid__');
    try {
      const { data, error } = await supabase.functions.invoke('automation-keys', {
        body: { action: 'generate_vapid', subject },
      });
      const publicKey = (data as { public_key?: unknown } | null)?.public_key;
      if (error || typeof publicKey !== 'string') {
        setNotice({ tone: 'error', message: 'VAPID generation failed; private key not returned.' });
        return;
      }
      setGeneratedVapidPublicKey(publicKey);
      setNotice({ tone: 'success', message: 'Generated VAPID pair; private key in Vault, not returned.' });
      await refresh();
    } catch {
      setNotice({ tone: 'error', message: 'VAPID generation failed; private key not returned.' });
    } finally {
      setBusyName(null);
    }
  };

  const configuredCount = items.filter(item => item.configured).length;

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-bronze mb-2">
            <KeyRound size={18} aria-hidden="true" />
            <span className="text-xs uppercase tracking-[0.18em] font-semibold">Automation settings</span>
          </div>
          <h1 className="font-serif text-3xl text-charcoal">Keys & connections</h1>
          <p className="text-sm text-gray-600 mt-2 max-w-3xl">
            Owner-only Vault storage for AI, Actions, commerce, messaging, social, video and push credentials.
            Saved values are never returned to this page and cannot be revealed or copied here.
          </p>
          <p className="text-sm text-gray-600 mt-2 max-w-3xl">
            Buddy's brain keys (Google, Groq and the rest) are on the <a className="underline" href="/admin/automation/brains">Brains page</a>.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh(true)}
          disabled={loading || refreshing || busyName !== null}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-sm border border-gray-300 bg-white px-4 text-sm text-charcoal hover:border-bronze focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bronze disabled:cursor-not-allowed disabled:opacity-50"
        >
          {refreshing ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <RefreshCw size={16} aria-hidden="true" />}
          Refresh status
        </button>
      </header>

      <section className="grid gap-3 sm:grid-cols-2" aria-label="Key storage protections">
        <div className="flex gap-3 rounded-sm border border-emerald-200 bg-emerald-50 p-4">
          <LockKeyhole size={18} className="mt-0.5 shrink-0 text-emerald-700" aria-hidden="true" />
          <p className="text-sm text-emerald-900"><strong>Encrypted at rest.</strong> Vault values are retrieved only by server-side automation functions.</p>
        </div>
        <div className="flex gap-3 rounded-sm border border-sky-200 bg-sky-50 p-4">
          <ShieldCheck size={18} className="mt-0.5 shrink-0 text-sky-700" aria-hidden="true" />
          <p className="text-sm text-sky-900"><strong>Safe tests.</strong> Checks do not post, send email, charge or edit account content. Most are read-only; local-only checks are labelled and never reported as connected.</p>
        </div>
      </section>

      {notice && (
        <div
          role="status"
          aria-live="polite"
          className={`flex items-start gap-2 rounded-sm border p-4 text-sm ${
            notice.tone === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' :
              notice.tone === 'info' ? 'border-sky-200 bg-sky-50 text-sky-900' :
                notice.tone === 'warning' ? 'border-amber-200 bg-amber-50 text-amber-950' :
                  'border-red-200 bg-red-50 text-red-900'
          }`}
        >
          {notice.tone === 'success' ? <CheckCircle2 size={17} className="mt-0.5 shrink-0" aria-hidden="true" /> : <AlertTriangle size={17} className="mt-0.5 shrink-0" aria-hidden="true" />}
          <span>{notice.message}</span>
        </div>
      )}

      {loadFailed && (
        <div role="alert" className="rounded-sm border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          The owner-only key catalogue could not be loaded. Confirm that you are an active owner and that the automation migrations are deployed. No credential values were received.
        </div>
      )}

      {loading ? (
        <div role="status" aria-live="polite" className="rounded-sm border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
          <Loader2 size={18} className="mx-auto mb-2 animate-spin" aria-hidden="true" />
          Loading key metadata…
        </div>
      ) : !loadFailed && (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-600" aria-live="polite">
            <span><strong className="text-charcoal">{configuredCount}</strong> of {items.length} credentials stored</span>
            <span>Feature switches remain off until an owner enables them separately.</span>
          </div>

          <VapidGenerator
            subject={vapidSubject}
            publicKey={generatedVapidPublicKey}
            busy={busyName !== null}
            onSubjectChange={setVapidSubject}
            onGenerate={() => void generateVapid()}
            onCopy={() => void navigator.clipboard.writeText(generatedVapidPublicKey)}
          />

          <div className="space-y-4">
            {AUTOMATION_KEY_CATEGORIES.map(category => {
              const group = grouped.get(category) || [];
              if (!group.length) return null;
              const count = group.filter(item => item.configured).length;
              return (
                <details key={category} open={category !== 'social'} className="group rounded-sm border border-gray-200 bg-white">
                  <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-bronze">
                    <span className="font-medium text-charcoal">{CATEGORY_LABELS[category]}</span>
                    <span className="inline-flex items-center gap-2 text-xs text-gray-500">
                      {count} of {group.length} stored
                      <ChevronDown size={15} aria-hidden="true" />
                    </span>
                  </summary>
                  <div className="space-y-3 border-t border-gray-100 p-3 sm:p-4">
                    {group.map(item => {
                      const isBusy = busyName === item.name;
                      const statusClass = automationStatusClass(item.last_test_status);
                      return (
                        <article key={item.name} className="rounded-sm border border-gray-200 p-4">
                          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <h2 className="font-medium text-charcoal">{item.label}</h2>
                                <span className={`inline-flex min-h-6 items-center rounded-full border px-2 text-[11px] font-medium ${
                                  item.configured ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-gray-200 bg-gray-50 text-gray-600'
                                }`}>
                                  {item.configured ? '•••••••• Stored in Vault' : 'Not configured'}
                                </span>
                                <span className={`inline-flex min-h-6 items-center rounded-full border px-2 text-[11px] ${statusClass}`}>
                                  {automationTestStatusLabel(item.last_test_status)}
                                </span>
                              </div>
                              <p className="mt-1 text-xs leading-5 text-gray-600">{item.purpose}</p>
                              <p className="mt-1 text-xs leading-5 text-gray-500">{testNote(item.name)}</p>
                              <p className="mt-2 text-xs text-gray-500">
                                Last test: <time dateTime={item.last_tested_at || undefined}>{lastTestTime(item.last_tested_at)}</time>
                              </p>
                            </div>

                            <div className="flex flex-wrap gap-2 lg:shrink-0">
                              <button
                                type="button"
                                onClick={() => void test(item)}
                                disabled={!item.configured || busyName !== null}
                                aria-label={`Test ${item.label}`}
                                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-sm border border-gray-300 bg-white px-3 text-sm text-charcoal hover:border-bronze focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bronze disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {isBusy ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <FlaskConical size={15} aria-hidden="true" />}
                                Test
                              </button>
                              <button
                                type="button"
                                onClick={() => void remove(item)}
                                disabled={!item.configured || busyName !== null}
                                aria-label={`Delete ${item.label}`}
                                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-sm border border-red-200 bg-white px-3 text-sm text-red-800 hover:border-red-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                <Trash2 size={15} aria-hidden="true" />
                                Delete
                              </button>
                            </div>
                          </div>

                          <div className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                            <div>
                              <label htmlFor={`automation-key-${item.name}`} className="mb-1 block text-xs font-medium text-gray-700">
                                {item.configured ? `Paste replacement ${item.credential_type === 'identifier' ? 'ID' : 'value'}` : `Paste ${item.credential_type === 'identifier' ? 'ID' : item.credential_type === 'public_key' ? 'public key' : 'key'}`}
                              </label>
                              <input
                                id={`automation-key-${item.name}`}
                                name={`automation-key-${item.name}`}
                                type={item.credential_type === 'secret' ? 'password' : 'text'}
                                value={drafts[item.name] || ''}
                                onChange={event => setDrafts(current => ({ ...current, [item.name]: event.target.value }))}
                                autoComplete="off"
                                spellCheck={false}
                                maxLength={10000}
                                placeholder={item.configured ? 'Paste to replace the stored value' : 'Paste value'}
                                aria-describedby={`automation-key-help-${item.name}`}
                                className="min-h-11 w-full rounded-sm border border-gray-300 bg-white px-3 text-sm text-charcoal placeholder:text-gray-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bronze"
                              />
                              <p id={`automation-key-help-${item.name}`} className="mt-1 text-xs text-gray-500">
                                {item.credential_type === 'secret' ? 'Hidden while typing; cleared from the form after the save attempt.' : 'Account identifier/public value; stored encrypted and not displayed again after saving.'}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => void save(item)}
                              disabled={busyName !== null || !(drafts[item.name] || '').length}
                              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-sm bg-charcoal px-4 text-sm font-medium text-white hover:bg-bronze focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bronze focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {isBusy ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <KeyRound size={15} aria-hidden="true" />}
                              {item.configured ? 'Replace' : 'Save'}
                            </button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </details>
              );
            })}
          </div>
        </>
      )}

      <p className="border-t border-gray-200 pt-4 text-xs leading-5 text-gray-500">
        Keys saved here are stored in Supabase Vault for the automation runtime. Existing deployment credentials for checkout, scheduled email, Supabase and Vercel remain in their current infrastructure settings until their later migration is evidenced. See <code>docs/AUTOMATION_SETUP.md</code> for the exact key names and limitations.
      </p>
    </div>
  );
}
