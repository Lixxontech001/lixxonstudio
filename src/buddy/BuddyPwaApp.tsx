import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import MfaGate from '../admin/MfaGate';
import PwaInstallPanel from '../components/PwaInstallPanel';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabaseClient';
import {
  BUDDY_OPERATIONS,
  buildBuddyPreview,
  getBuddyOperation,
  parseBuddyCommand,
  previewIsFresh,
  type BuddyLiveState,
  type BuddyPreview,
} from './buddyOperations';
import {
  clearBuddyQueue,
  enqueueBuddyCommand,
  loadBuddyQueue,
  removeBuddyQueueItem,
  type BuddyQueueItem,
} from './offlineBuddyQueue';

function BuddySignInNotice() {
  return (
    <div className="mx-auto max-w-xl rounded-sm border border-taupe/40 bg-white p-6 text-center shadow-sm">
      <h1 className="mt-3 font-serif text-2xl text-charcoal">Sign in to Buddy</h1>
      <p className="mt-2 text-sm leading-relaxed text-charcoal-muted">Buddy is an owner/admin surface. It uses the existing Admin sign-in, permissions and MFA; installing this app does not grant access.</p>
      <a href="/admin/login" className="mt-5 inline-flex min-h-11 items-center justify-center gap-2 rounded-sm bg-charcoal px-4 py-2 text-sm font-medium text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-charcoal">
        Open Admin sign-in
      </a>
    </div>
  );
}

function operationLabel(item: BuddyQueueItem): string {
  return getBuddyOperation(item.command)?.label ?? 'Unknown command';
}

function argumentSummary(item: BuddyQueueItem): string {
  if (item.command !== 'set-daily-pipeline') return '';
  return item.args.enabled === true ? 'Resume the daily schedule' : 'Pause the daily schedule';
}

function BuddyWorkspace() {
  const { can } = useAuth();
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine);
  const [queue, setQueue] = useState<BuddyQueueItem[]>(() => loadBuddyQueue());
  const [commandText, setCommandText] = useState('');
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ itemId: string; value: BuddyPreview } | null>(null);

  useEffect(() => {
    // Connection awareness only. Nothing here executes a queued draft: reconnecting
    // can never run a command, and a draft needs a fresh preview plus confirmation.
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  const submitCommand = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = parseBuddyCommand(commandText);
    setCommandText('');
    setPreview(null);
    if (result.kind === 'blocked') {
      setNotice(result.category === 'commerce'
        ? 'Buddy cannot change products, prices, payments or refunds. Nothing was queued or changed.'
        : 'Buddy cannot publish, send, email, approve, schedule or edit content, and it has no publishing operation at all. Nothing was queued or sent. Use the authorized Admin screen instead.');
      return;
    }
    if (result.kind === 'unsupported') {
      setNotice(`That command is not on Buddy’s safe allow-list. Only ${BUDDY_OPERATIONS.map((operation) => operation.id).join(', ')} are accepted. No free-form text is stored.`);
      return;
    }
    const saved = enqueueBuddyCommand(result.operationId, { args: result.args });
    setQueue(saved.items);
    if (!saved.item) {
      setNotice('That command was refused by its typed argument rules. Nothing was queued.');
      return;
    }
    setNotice(saved.persisted
      ? `${operationLabel(saved.item)} is saved as a draft. It will not run automatically, even when the device reconnects.`
      : 'The browser could not persist this draft. It remains in this tab only and will not run automatically.');
  };

  /** Reads live state and builds the authoritative preview. Only reachable online. */
  const requestPreview = async (item: BuddyQueueItem) => {
    const operation = getBuddyOperation(item.command);
    if (!operation) {
      setNotice('That draft does not match a known operation. Nothing was run.');
      return;
    }
    if (!online) {
      setNotice('You are offline. No action was performed and no preview was requested; review this draft after reconnecting.');
      return;
    }
    if (!can(operation.requiredPermission)) {
      setNotice(`Your current Admin role lacks ${operation.requiredPermission}, so this draft cannot be previewed or run. Nothing was changed.`);
      return;
    }
    setBusyId(item.id);
    setNotice('');
    setPreview(null);
    const readAt = new Date().toISOString();
    let live: BuddyLiveState | null = null;
    let readFailed = false;
    try {
      if (operation.id === 'status') {
        const { data, error } = await supabase.rpc('admin_me');
        if (error) readFailed = true;
        else live = { readAt, adminStatus: (data ?? null) as BuddyLiveState['adminStatus'] };
      } else if (operation.id === 'set-daily-pipeline') {
        const { data, error } = await supabase.rpc('automation_feature_flags');
        if (error || !data || typeof data !== 'object') readFailed = true;
        else live = { readAt, flags: data as BuddyLiveState['flags'] };
      } else {
        live = { readAt };
      }
    } catch {
      readFailed = true;
    }
    setBusyId(null);
    if (readFailed || !live) {
      setNotice('The live check could not be read, so no preview was produced. Nothing was changed; try again when online.');
      return;
    }
    const result = buildBuddyPreview(item.command, item.args, live);
    if (!result.ok) {
      setNotice(result.reason === 'no_change'
        ? 'That is already the current state. Nothing was changed and the draft is still queued.'
        : result.reason === 'unavailable'
          ? 'That setting could not be read from the server, so Buddy will not offer it for confirmation.'
          : 'This draft could not produce a safe preview. Nothing was changed.');
      return;
    }
    setPreview({ itemId: item.id, value: result.preview });
  };

  /** Executes only after a fresh preview and an explicit confirmation. */
  const confirmPreview = async (item: BuddyQueueItem) => {
    const operation = getBuddyOperation(item.command);
    if (!operation || !preview || preview.itemId !== item.id) {
      setNotice('No current preview exists for this draft. Preview it again before confirming.');
      return;
    }
    if (!online) {
      setNotice('You are offline. Nothing was confirmed and nothing was changed.');
      return;
    }
    if (!previewIsFresh(preview.value)) {
      setPreview(null);
      setNotice('That preview expired, so the confirmation was refused. Preview the live state again.');
      return;
    }
    if (operation.kind === 'state-change') {
      if (!can(operation.requiredPermission)) {
        setNotice(`Your current Admin role lacks ${operation.requiredPermission}. Nothing was changed.`);
        return;
      }
      setBusyId(item.id);
      if (operation.id === 'set-daily-pipeline') {
        try {
          const { error } = await supabase.rpc('automation_set_feature_flag', {
            p_flag_key: 'automation.daily_pipeline',
            p_enabled: item.args.enabled === true,
          });
          if (error) {
            setNotice('The daily schedule could not be changed. Nothing was altered; the draft is still queued.');
            setBusyId(null);
            return;
          }
          setNotice(`The 08:00 daily schedule is now ${item.args.enabled === true ? 'on' : 'off'}, recorded in the audit log. This switch never publishes: distribution still needs your approval in the Daily Kit.`);
          setQueue(removeBuddyQueueItem(item.id));
        } catch {
          setNotice('The change failed safely. Nothing was altered; the draft is still queued.');
        }
      }
      setBusyId(null);
      setPreview(null);
      return;
    }

    // Read-only operations: no state change, so a single preview step is enough.
    if (operation.id === 'daily-kit') {
      setQueue(removeBuddyQueueItem(item.id));
      window.location.assign('/admin/automation/distribution');
      return;
    }
    if (operation.id === 'status') {
      setNotice(`Admin status checked${preview.value.currentSummary ? '' : ''}. No external action was sent.`);
      setQueue(removeBuddyQueueItem(item.id));
      setPreview(null);
      return;
    }
    setNotice('Buddy accepts only the listed commands. Nothing was changed.');
    setQueue(removeBuddyQueueItem(item.id));
    setPreview(null);
  };

  const clearQueue = () => {
    clearBuddyQueue();
    setQueue([]);
    setPreview(null);
    setNotice('Buddy’s draft queue was cleared. Reader bookmarks and other site data were not touched.');
  };

  const previewFor = preview ? preview.value : null;

  return (
    <main className="min-h-screen bg-taupe-light px-4 py-6 text-charcoal sm:px-5 sm:py-10">
      <div className="mx-auto max-w-3xl">
        <header className="mb-6 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-charcoal-muted">Lixxon Studio</p>
            <h1 className="mt-1 font-serif text-3xl font-light sm:text-4xl">Buddy</h1>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-charcoal-muted">A permission-aware assistant with typed, allow-listed commands. It never edits article prose, publishes, sends campaigns, or changes products, prices, payments or refunds — and it has no publishing operation at all.</p>
          </div>
          <div className="flex shrink-0 items-center gap-2 rounded-full border border-taupe/40 bg-white px-3 py-2 text-xs" aria-live="polite">
            <span>{online ? 'Online' : 'Offline'}</span>
          </div>
        </header>

        <section aria-labelledby="buddy-command-title" className="rounded-sm border border-taupe/30 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex items-start gap-3">
            <span aria-hidden="true" className="mt-0.5 font-semibold text-bronze">?</span>
            <div>
              <h2 id="buddy-command-title" className="text-lg font-medium">Typed command queue</h2>
              <p className="mt-1 text-sm text-charcoal-muted">Try “status”, “daily kit”, “help”, “pause automation” or “resume automation”. Only these fixed operations are stored as drafts. Nothing runs automatically — not even after reconnecting.</p>
            </div>
          </div>
          <form onSubmit={submitCommand} className="mt-4 flex flex-col gap-3 sm:flex-row">
            <label className="sr-only" htmlFor="buddy-command">Enter a safe Buddy command</label>
            <input
              id="buddy-command"
              value={commandText}
              onChange={(event) => setCommandText(event.target.value)}
              autoComplete="off"
              maxLength={120}
              placeholder="status, daily kit, help, pause automation"
              className="min-h-11 min-w-0 flex-1 rounded-sm border border-taupe/50 bg-white px-3 py-2.5 text-sm text-charcoal focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-charcoal"
            />
            <button type="submit" disabled={!commandText.trim()} className="min-h-11 rounded-sm bg-charcoal px-5 py-2.5 text-sm font-medium text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-charcoal disabled:cursor-not-allowed disabled:opacity-50">Save as draft</button>
          </form>
          <p role="status" aria-live="polite" className="mt-3 text-sm text-charcoal-muted">{notice}</p>
          <p className="mt-2 text-xs leading-relaxed text-charcoal-muted">A draft stores only an allow-listed operation name, its typed arguments and a timestamp — never the typed text, an account token, article text or customer data. The safety-focused service worker does not cache navigations, so a first launch with no network is not guaranteed.</p>
        </section>

        <section aria-labelledby="buddy-queue-title" className="mt-5 rounded-sm border border-taupe/30 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <h2 id="buddy-queue-title" className="text-lg font-medium">Drafts needing review</h2>
              <span className="rounded-full bg-taupe-light px-2 py-0.5 text-xs" aria-label={`${queue.length} queued drafts`}>{queue.length}</span>
            </div>
            {queue.length > 0 && <button type="button" onClick={clearQueue} className="min-h-11 rounded-sm px-3 py-2 text-sm text-charcoal-muted underline underline-offset-2 hover:text-charcoal focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-charcoal">Clear Buddy queue</button>}
          </div>
          {queue.length === 0 ? (
            <p className="mt-4 text-sm text-charcoal-muted">No drafts are queued.</p>
          ) : (
            <ul className="mt-3 divide-y divide-taupe/20" aria-label="Queued drafts">
              {queue.map((item) => (
                <li key={item.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-medium">{operationLabel(item)}</p>
                    {argumentSummary(item) && <p className="text-xs text-charcoal-muted">{argumentSummary(item)}</p>}
                    <p className="text-xs text-charcoal-muted">Draft saved {new Date(item.createdAt).toLocaleString()} · never auto-runs</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void requestPreview(item)}
                    disabled={!online || busyId === item.id}
                    aria-label={`Preview live state for ${operationLabel(item)}`}
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-sm border border-charcoal px-4 py-2 text-sm font-medium text-charcoal hover:bg-taupe-light/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-charcoal disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {busyId === item.id ? 'Reading live state…' : 'Preview live state'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {previewFor && preview && (
          <section aria-labelledby="buddy-preview-title" className="mt-5 rounded-sm border border-bronze/40 bg-white p-5 shadow-sm sm:p-6" role="region">
            <h2 id="buddy-preview-title" className="text-lg font-medium">Live preview: {previewFor.title}</h2>
            <p className="mt-2 text-sm text-charcoal-muted">{previewFor.currentSummary}</p>
            {previewFor.changes.length > 0 && (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-charcoal">
                {previewFor.changes.map((change) => <li key={change}>{change}</li>)}
              </ul>
            )}
            <p className="mt-2 text-sm text-charcoal">{previewFor.nextSummary}</p>
            <p className="mt-2 text-xs text-charcoal-muted">Read from the server at {new Date(previewFor.readAt).toLocaleTimeString()}. This preview expires in two minutes and publishes nothing.</p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              {getBuddyOperation(previewFor.operationId)?.kind === 'state-change' && (
                <button
                  type="button"
                  onClick={() => {
                    const item = queue.find((entry) => entry.id === preview.itemId);
                    if (item) void confirmPreview(item);
                  }}
                  disabled={busyId !== null}
                  className="inline-flex min-h-11 items-center justify-center rounded-sm bg-charcoal px-4 py-2 text-sm font-medium text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-charcoal disabled:opacity-60"
                >
                  Confirm: {previewFor.nextSummary.replace(/^Confirm to /, '').replace(/\.$/, '')}
                </button>
              )}
              {getBuddyOperation(previewFor.operationId)?.kind === 'read' && (
                <button
                  type="button"
                  onClick={() => {
                    const item = queue.find((entry) => entry.id === preview.itemId);
                    if (item) void confirmPreview(item);
                  }}
                  disabled={busyId !== null}
                  className="inline-flex min-h-11 items-center justify-center rounded-sm border border-charcoal px-4 py-2 text-sm font-medium text-charcoal hover:bg-taupe-light/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-charcoal disabled:opacity-60"
                >
                  Continue (read-only)
                </button>
              )}
              <button
                type="button"
                onClick={() => setPreview(null)}
                className="inline-flex min-h-11 items-center justify-center rounded-sm border border-taupe/40 px-4 py-2 text-sm text-charcoal focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-charcoal"
              >
                Cancel
              </button>
            </div>
          </section>
        )}

        <section className="mt-5 rounded-sm border border-bronze/40 bg-taupe-light/30 p-4 text-sm leading-relaxed text-charcoal" aria-label="External action safety">
          Publishing is not available through Buddy. Requests to publish, send, email, approve, schedule or alter article text, or to change commerce data, are blocked before they can enter the queue, and no publishing operation exists to confirm.
          {can('automation.check') && <a href="/admin/automation/distribution" className="mt-2 inline-flex min-h-11 items-center gap-2 font-medium underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-charcoal">Open Daily Kit</a>}
        </section>

        <PwaInstallPanel currentApp="buddy" />
        <footer className="mt-5 flex flex-wrap gap-x-4 gap-y-2 text-sm">
          <a href="/admin/dashboard" className="min-h-11 inline-flex items-center text-charcoal underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-charcoal">Owner/Admin</a>
          <a href="/" className="min-h-11 inline-flex items-center text-charcoal underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-charcoal">Reader</a>
        </footer>
      </div>
    </main>
  );
}

/** Owner sign-in, Admin role and MFA gate. Shared by every Buddy screen; installing Buddy grants no access. */
export function BuddyAccessGate({ children }: { children: ReactNode }) {
  const { session, loading, isAdmin, refreshAdmin } = useAuth();
  if (loading) return <div className="min-h-screen bg-taupe-light p-8 text-center text-sm text-charcoal-muted" role="status">Checking your Admin sign-in…</div>;
  if (!session) return <main className="min-h-screen bg-taupe-light p-5 pt-16"><BuddySignInNotice /></main>;
  if (!isAdmin) {
    return <main className="min-h-screen bg-taupe-light p-5 pt-16"><div className="mx-auto max-w-xl rounded-sm border border-taupe/40 bg-white p-6 text-center"><h1 className="mt-3 font-serif text-2xl">Buddy is restricted</h1><p className="mt-2 text-sm text-charcoal-muted">This account does not have active Admin access. No queued command was sent.</p><a href="/admin/login" className="mt-4 inline-flex min-h-11 items-center justify-center rounded-sm border border-charcoal px-4 py-2 text-sm underline">Open Admin sign-in</a></div></main>;
  }
  return <MfaGate onVerified={refreshAdmin}>{children}</MfaGate>;
}

/** The original typed-command screen. Kept reachable at /buddy/controls until the chat replaces it. */
export default function BuddyPwaApp() {
  return <BuddyAccessGate><BuddyWorkspace /></BuddyAccessGate>;
}
