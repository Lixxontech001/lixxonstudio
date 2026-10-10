import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Btn, Loading, Notice } from '../components/ui';
import { KILL_OPTIONS, MINDS, isKillScope, mindStatus, type KillScope } from '../../buddy/minds/mindRoster';
import {
  MINDS_SAVE_FAILED,
  loadMindsControls,
  saveMindsControls,
  type MindsControls,
} from '../../buddy/minds/mindsControlsStore';
import { lastActionLine, loadLastActions, type LastActions } from '../../buddy/minds/mindsLogStore';

type ReadState = { status: 'loading' } | { status: 'ready'; controls: MindsControls } | { status: 'error' };
type LogState = { readable: boolean; last: LastActions };
type Message = { tone: 'ok' | 'error'; text: string } | null;

const CARD_CLASS = 'rounded-sm border border-taupe/40 bg-white p-4 shadow-sm';

/**
 * The owner's one Minds watch. Six cards: Buddy, and the five minds behind it.
 * Takeover is off by default. Kill stops nothing, everything, or one mind, and the choice is saved.
 */
export default function AdminMinds() {
  const { can, session } = useAuth();
  const allowed = can('admin.ai.run');
  const userId = session?.user?.id ?? null;
  const [read, setRead] = useState<ReadState>({ status: 'loading' });
  const [log, setLog] = useState<LogState>({ readable: true, last: {} });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<Message>(null);

  const readAll = async () => {
    const [controls, actions] = await Promise.all([loadMindsControls(), loadLastActions()]);
    setRead(controls.ok ? { status: 'ready', controls: controls.value } : { status: 'error' });
    setLog(actions.ok ? { readable: true, last: actions.value } : { readable: false, last: {} });
  };

  const load = async () => {
    setRead({ status: 'loading' });
    await readAll();
  };

  useEffect(() => {
    if (!allowed) return;
    let live = true;
    Promise.all([loadMindsControls(), loadLastActions()]).then(([controls, actions]) => {
      if (!live) return;
      setRead(controls.ok ? { status: 'ready', controls: controls.value } : { status: 'error' });
      setLog(actions.ok ? { readable: true, last: actions.value } : { readable: false, last: {} });
    });
    return () => {
      live = false;
    };
  }, [allowed]);

  if (!allowed) {
    return <Notice tone="warn">You need the Admin AI permission to see the Minds.</Notice>;
  }
  if (read.status === 'loading') return <Loading />;
  if (read.status === 'error') {
    return (
      <div className="space-y-3">
        <Notice tone="error">Minds could not be read. Try again shortly.</Notice>
        <Btn variant="ghost" onClick={load}>Try again</Btn>
      </div>
    );
  }

  const controls = read.controls;

  // Only a saved change moves the screen. A failed save leaves the switch where it was.
  const save = async (next: MindsControls) => {
    if (!userId) {
      setMessage({ tone: 'error', text: MINDS_SAVE_FAILED });
      return;
    }
    setSaving(true);
    setMessage(null);
    const result = await saveMindsControls(next, userId);
    setSaving(false);
    if (result.ok) {
      setRead({ status: 'ready', controls: next });
      setMessage({ tone: 'ok', text: 'Saved.' });
    } else {
      setMessage({ tone: 'error', text: MINDS_SAVE_FAILED });
    }
  };

  const takeoverText = controls.takeover
    ? 'On. The minds may make the changes they are already allowed to make. Kill and the Auditor still apply, and each act is written to the daily log.'
    : 'Off. The minds cannot change the site.';

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-serif text-2xl text-charcoal">Minds</h1>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-charcoal-muted">
          Buddy is the only voice you hear. The five minds below work behind the scenes and report to Buddy.
        </p>
        <div className="mt-3">
          <a href="/admin/ai/connections" className="inline-flex items-center rounded-sm border border-taupe/50 bg-white px-3 py-1.5 text-sm text-charcoal hover:border-bronze">Connections</a>
        </div>
      </header>

      {message && <Notice tone={message.tone === 'ok' ? 'ok' : 'error'}>{message.text}</Notice>}

      <section aria-labelledby="minds-takeover-title" className={`${CARD_CLASS} space-y-3`}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="minds-takeover-title" className="text-base font-medium text-charcoal">Takeover</h2>
            <p className="mt-1 text-sm text-charcoal-muted">{takeoverText}</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={controls.takeover}
            aria-labelledby="minds-takeover-title"
            disabled={saving}
            onClick={() => save({ ...controls, takeover: !controls.takeover })}
            className={`min-h-11 min-w-[4.5rem] shrink-0 rounded-sm border px-3 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-charcoal disabled:opacity-50 ${controls.takeover ? 'border-charcoal bg-charcoal text-white' : 'border-taupe bg-white text-charcoal'}`}
          >
            {controls.takeover ? 'On' : 'Off'}
          </button>
        </div>
      </section>

      <section aria-labelledby="minds-kill-title" className={`${CARD_CLASS} space-y-3`}>
        <h2 id="minds-kill-title" className="text-base font-medium text-charcoal">Kill</h2>
        <p className="text-sm text-charcoal-muted">Stop a mind, or all of them. The choice is saved.</p>
        <label htmlFor="minds-kill" className="sr-only">Kill setting</label>
        <select
          id="minds-kill"
          value={controls.killScope}
          disabled={saving}
          onChange={(event) => {
            const value = event.target.value;
            if (isKillScope(value)) save({ ...controls, killScope: value as KillScope });
          }}
          className="min-h-11 w-full rounded-sm border border-taupe bg-white px-3 text-sm text-charcoal focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-charcoal disabled:opacity-50 sm:max-w-sm"
        >
          {KILL_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </section>

      <section aria-labelledby="minds-cards-title" className="space-y-3">
        <h2 id="minds-cards-title" className="text-base font-medium text-charcoal">The six</h2>
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <li>
            <article aria-labelledby="mind-buddy" className={`${CARD_CLASS} h-full`}>
              <h3 id="mind-buddy" className="font-serif text-lg text-charcoal">Buddy</h3>
              <p className="mt-1 text-sm text-charcoal-muted">The only voice you hear. Takes your orders and answers questions.</p>
              <p className="mt-3 text-sm text-charcoal">Ready in chat.</p>
              <p className="mt-1 text-xs text-charcoal-muted">{lastActionLine(log.last.buddy, log.readable)}</p>
              <a href="/buddy" className="mt-4 inline-flex min-h-11 items-center text-sm text-bronze underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-charcoal">Open Buddy</a>
            </article>
          </li>
          {MINDS.map((mind) => (
            <li key={mind.key}>
              <article aria-labelledby={`mind-${mind.key}`} className={`${CARD_CLASS} h-full`}>
                <h3 id={`mind-${mind.key}`} className="font-serif text-lg text-charcoal">{mind.name}</h3>
                <p className="mt-1 text-sm text-charcoal-muted">{mind.job}</p>
                <p className="mt-3 text-sm text-charcoal">{mindStatus(controls.takeover, controls.killScope, mind.key, Boolean(log.last[mind.key]))}</p>
                <p className="mt-1 text-xs text-charcoal-muted">{lastActionLine(log.last[mind.key], log.readable)}</p>
              </article>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
