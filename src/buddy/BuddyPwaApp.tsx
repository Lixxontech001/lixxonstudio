import { useEffect, useState, type FormEvent } from 'react';
import MfaGate from '../admin/MfaGate';
import PwaInstallPanel from '../components/PwaInstallPanel';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabaseClient';
import {
  clearBuddyQueue,
  enqueueBuddyCommand,
  loadBuddyQueue,
  parseBuddyCommand,
  removeBuddyQueueItem,
  type BuddyQueueItem,
  type SafeBuddyCommand,
} from './offlineBuddyQueue';

const COMMAND_LABEL: Record<SafeBuddyCommand, string> = {
  status: 'Check admin status',
  'daily-kit': 'Open the Daily Kit',
  help: 'Show safe commands',
};

function BuddySignInNotice() {
  return (
    <div className="mx-auto max-w-xl rounded-sm border border-taupe/40 bg-white p-6 text-center shadow-sm">
      <h1 className="mt-3 font-serif text-2xl text-charcoal">Sign in to Buddy</h1>
      <p className="mt-2 text-sm leading-relaxed text-charcoal-muted">Buddy is an owner/admin surface. It uses the existing Admin sign-in, permissions and MFA; installing this app does not grant access.</p>
      <a href="/admin/login" className="mt-5 inline-flex min-h-11 items-center justify-center gap-2 rounded-sm bg-charcoal px-4 py-2 text-sm font-medium text-white hover:bg-bronze focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bronze">
        Open Admin sign-in
      </a>
    </div>
  );
}

function BuddyWorkspace() {
  const { can } = useAuth();
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine);
  const [queue, setQueue] = useState<BuddyQueueItem[]>(() => loadBuddyQueue());
  const [commandText, setCommandText] = useState('');
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
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
    if (result.kind === 'blocked') {
      setNotice(result.category === 'commerce'
        ? 'Buddy cannot change products, prices, payments or refunds. Nothing was queued or changed.'
        : 'Buddy cannot publish, send, approve, schedule, delete or edit article content. Nothing was queued or sent. Review the authorized Admin screen instead.');
      return;
    }
    if (result.kind === 'unsupported') {
      setNotice('That command is not on Buddy’s safe allow-list. Only status, Daily Kit and help can be queued. No free-form text is stored.');
      return;
    }
    const saved = enqueueBuddyCommand(result.command);
    setQueue(saved.items);
    setNotice(saved.persisted
      ? `${COMMAND_LABEL[result.command]} is queued for your review. It will not run automatically, even when the device reconnects.`
      : 'The browser could not persist this safe command. It remains in this tab only and will not run automatically.');
  };

  const reviewCommand = async (item: BuddyQueueItem) => {
    if (!online) {
      setNotice('You are offline. No action was performed; review the queued command after reconnecting.');
      return;
    }
    setBusyId(item.id);
    setNotice('');
    if (item.command === 'status') {
      try {
        const { data, error } = await supabase.rpc('admin_me');
        if (error || !data) {
          setNotice('The signed-in admin status could not be verified. Nothing was changed.');
        } else {
          setNotice('Admin status checked. No external action was sent.');
          setQueue(removeBuddyQueueItem(item.id));
        }
      } catch {
        setNotice('The status check failed safely. Nothing was changed. Try again when online.');
      } finally {
        setBusyId(null);
      }
      return;
    }
    if (item.command === 'daily-kit') {
      if (!can('automation.check')) {
        setNotice('Your current Admin role cannot open the Daily Kit. Ask an owner to review access.');
        setBusyId(null);
        return;
      }
      setQueue(removeBuddyQueueItem(item.id));
      window.location.assign('/admin/automation/distribution');
      return;
    }
    setNotice('Buddy commands: “status” checks your signed-in admin state; “daily kit” opens the approved review surface. No content or external action is sent.');
    setQueue(removeBuddyQueueItem(item.id));
    setBusyId(null);
  };

  const clearQueue = () => {
    clearBuddyQueue();
    setQueue([]);
    setNotice('Buddy’s safe local queue was cleared. Reader bookmarks and other site data were not touched.');
  };

  return (
    <main className="min-h-screen bg-taupe-light px-4 py-6 text-charcoal sm:px-6 sm:py-10">
      <div className="mx-auto max-w-3xl">
        <header className="mb-6 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-bronze">Lixxon Studio</p>
            <h1 className="mt-1 font-serif text-3xl font-light sm:text-4xl">Buddy</h1>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-charcoal-muted">A permission-aware assistant for safe checks and review navigation. It never edits article prose, publishes, sends campaigns, or changes products, prices, payments or refunds.</p>
          </div>
          <div className="flex shrink-0 items-center gap-2 rounded-full border border-taupe/40 bg-white px-3 py-2 text-xs" aria-live="polite">
            <span>{online ? 'Online' : 'Offline'}</span>
          </div>
        </header>

        <section aria-labelledby="buddy-command-title" className="rounded-sm border border-taupe/30 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex items-start gap-3">
            <span aria-hidden="true" className="mt-0.5 font-semibold text-bronze">?</span>
            <div>
              <h2 id="buddy-command-title" className="text-lg font-medium">Safe command queue</h2>
              <p className="mt-1 text-sm text-charcoal-muted">Try “status”, “daily kit”, or “help”. Only these fixed commands are stored. Nothing runs automatically after reconnecting.</p>
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
              placeholder="status, daily kit, or help"
              className="min-h-11 min-w-0 flex-1 rounded-sm border border-taupe/50 bg-white px-3 py-2.5 text-sm text-charcoal focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bronze"
            />
            <button type="submit" disabled={!commandText.trim()} className="min-h-11 rounded-sm bg-charcoal px-5 py-2.5 text-sm font-medium text-white hover:bg-bronze focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bronze disabled:cursor-not-allowed disabled:opacity-50">Queue for review</button>
          </form>
          <p role="status" aria-live="polite" className="mt-3 text-sm text-charcoal-muted">{notice}</p>
          <p className="mt-2 text-xs leading-relaxed text-charcoal-muted">Offline queue storage contains only an allow-listed command name, local ID and timestamp—not the typed text, account token, article text or customer data. It works while Buddy is open; the safety-focused service worker does not cache navigations, so a first launch with no network is not guaranteed.</p>
        </section>

        <section aria-labelledby="buddy-queue-title" className="mt-5 rounded-sm border border-taupe/30 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <h2 id="buddy-queue-title" className="text-lg font-medium">Needs your review</h2>
              <span className="rounded-full bg-taupe-light px-2 py-0.5 text-xs" aria-label={`${queue.length} queued commands`}>{queue.length}</span>
            </div>
            {queue.length > 0 && <button type="button" onClick={clearQueue} className="min-h-11 rounded-sm px-3 py-2 text-sm text-charcoal-muted underline underline-offset-2 hover:text-charcoal focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bronze">Clear Buddy queue</button>}
          </div>
          {queue.length === 0 ? (
            <p className="mt-4 text-sm text-charcoal-muted">No commands are queued.</p>
          ) : (
            <ul className="mt-3 divide-y divide-taupe/20" aria-label="Queued safe commands">
              {queue.map((item) => (
                <li key={item.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-medium">{COMMAND_LABEL[item.command]}</p>
                    <p className="text-xs text-charcoal-muted">Saved {new Date(item.createdAt).toLocaleString()} · never auto-runs</p>
                  </div>
                  <button type="button" onClick={() => void reviewCommand(item)} disabled={!online || busyId === item.id} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-sm border border-charcoal/30 px-4 py-2 text-sm font-medium text-charcoal hover:border-bronze hover:text-bronze focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bronze disabled:cursor-not-allowed disabled:opacity-50">
                    {busyId === item.id ? 'Checking…' : item.command === 'daily-kit' ? 'Review and open' : 'Review and continue'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="mt-5 rounded-sm border border-bronze/40 bg-taupe-light/30 p-4 text-sm leading-relaxed text-charcoal" aria-label="External action safety">
          External actions are not available through Buddy yet. Requests to publish, send, approve, schedule, alter article text, or change commerce data are blocked before they can enter the queue. To publish a distribution item, open the Daily Kit and review it there with the existing owner approval.
          {can('automation.check') && <a href="/admin/automation/distribution" className="mt-2 inline-flex min-h-11 items-center gap-2 font-medium underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bronze">Open Daily Kit</a>}
        </section>

        <PwaInstallPanel currentApp="buddy" />
        <footer className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm">
          <a href="/admin/dashboard" className="min-h-11 inline-flex items-center text-bronze underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bronze">Owner/Admin</a>
          <a href="/" className="min-h-11 inline-flex items-center text-bronze underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bronze">Reader</a>
        </footer>
      </div>
    </main>
  );
}

export default function BuddyPwaApp() {
  const { session, loading, isAdmin, refreshAdmin } = useAuth();
  if (loading) return <div className="min-h-screen bg-taupe-light p-8 text-center text-sm text-charcoal-muted" role="status">Checking your Admin sign-in…</div>;
  if (!session) return <main className="min-h-screen bg-taupe-light p-5 pt-16"><BuddySignInNotice /></main>;
  if (!isAdmin) {
    return <main className="min-h-screen bg-taupe-light p-5 pt-16"><div className="mx-auto max-w-xl rounded-sm border border-taupe/40 bg-white p-6 text-center"><h1 className="mt-3 font-serif text-2xl">Buddy is restricted</h1><p className="mt-2 text-sm text-charcoal-muted">This account does not have active Admin access. No queued command was sent.</p><a href="/admin/login" className="mt-4 inline-flex min-h-11 items-center justify-center rounded-sm border border-charcoal/30 px-4 py-2 text-sm underline">Open Admin sign-in</a></div></main>;
  }
  return <MfaGate onVerified={refreshAdmin}><BuddyWorkspace /></MfaGate>;
}
