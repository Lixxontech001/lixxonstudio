import { useEffect, useState } from 'react';
import { describeChange, listAppliedChanges, listGapNotes, markGapSeen, type AppliedChange, type GapNote } from './buddyChanges';
import { describePackJob, listPackJobs, markPackPosted, type PackJob } from './buddyJobs';
import { formatDayLabel } from './buddyChatStore';
import type { BuddyVibeId } from './buddyVibes';

interface BuddyChangesProps {
  vibe: BuddyVibeId;
  onBack: () => void;
}

export const CHANGES_READ_FAILED = 'Changes could not be read just now. Try again shortly.';
export const GAP_SAVE_FAILED = 'That could not be saved just now. Try again shortly.';
export const JOBS_READ_FAILED = 'Your jobs could not be read just now. Try again shortly.';
export const JOBS_NOTE = 'Buddy never posts. "I posted this" only writes your own record.';

/**
 * Buddy's report of what the minds changed, and the product gaps still open.
 * The only thing the owner can do here is look at one paragraph, or mark a gap seen. Nothing here edits an article.
 */
export default function BuddyChanges({ vibe, onBack }: BuddyChangesProps) {
  const [changes, setChanges] = useState<AppliedChange[] | null>(null);
  const [gaps, setGaps] = useState<GapNote[] | null>(null);
  const [packs, setPacks] = useState<PackJob[] | null>(null);
  const [packsFailed, setPacksFailed] = useState(false);
  const [failed, setFailed] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [changeList, gapList, packList] = await Promise.all([listAppliedChanges(), listGapNotes(), listPackJobs()]);
      if (cancelled) return;
      if (changeList === null || gapList === null) setFailed(true);
      if (packList === null) setPacksFailed(true);
      setChanges(changeList ?? []);
      setGaps(gapList ?? []);
      setPacks(packList ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function seen(id: string) {
    const ok = await markGapSeen(id);
    if (!ok) {
      setNotice(GAP_SAVE_FAILED);
      return;
    }
    setNotice('');
    setGaps((current) => (current ? current.filter((gap) => gap.id !== id) : current));
  }

  async function posted(id: string) {
    const ok = await markPackPosted(id);
    if (!ok) {
      setNotice(GAP_SAVE_FAILED);
      return;
    }
    setNotice('');
    const when = new Date().toISOString();
    setPacks((current) =>
      current ? current.map((job) => (job.id === id ? { ...job, status: 'posted_by_owner', postedAt: when } : job)) : current,
    );
  }

  return (
    <div className="buddy-app" data-vibe={vibe} data-testid="buddy-changes">
      <header className="buddy-top">
        <button type="button" className="buddy-button" onClick={onBack}>
          Back to Buddy
        </button>
        <h1 className="buddy-name">Changes</h1>
      </header>
      <main className="buddy-log" aria-label="Changes and product gaps">
        <div className="buddy-log-inner">
          {failed && (
            <p className="buddy-banner buddy-error" role="alert">
              {CHANGES_READ_FAILED}
            </p>
          )}
          {notice && (
            <p className="buddy-banner buddy-error" role="alert">
              {notice}
            </p>
          )}

          <section className="buddy-briefing-section" aria-label="Your jobs">
            <h2 className="buddy-briefing-title">Your jobs</h2>
            <p className="buddy-empty">{JOBS_NOTE}</p>
            {packsFailed && (
              <p className="buddy-banner buddy-error" role="alert">
                {JOBS_READ_FAILED}
              </p>
            )}
            {packs === null && !packsFailed && <p className="buddy-empty">Loading jobs…</p>}
            {packs !== null && packs.length === 0 && <p className="buddy-empty">No packs in the last three days.</p>}
            {packs !== null && packs.length > 0 && (
              <ul className="buddy-chat-list">
                {packs.map((job) => {
                  const view = describePackJob(job);
                  return (
                    <li key={job.id} className="buddy-report-item buddy-change-item" data-testid="pack-job">
                      <p className="buddy-change-text">
                        <strong>{view.headline}</strong>
                      </p>
                      {view.lines.map((line, index) => (
                        <p key={index} className="buddy-chat-time">
                          {line}
                        </p>
                      ))}
                      {view.copy.map((line, index) => (
                        <p key={index} className="buddy-paragraph">
                          {line}
                        </p>
                      ))}
                      {view.canMarkPosted && (
                        <button type="button" className="buddy-button" onClick={() => posted(job.id)}>
                          I posted this
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="buddy-briefing-section" aria-label="Changes I made">
            <h2 className="buddy-briefing-title">Changes I made</h2>
            {changes === null && <p className="buddy-empty">Loading changes…</p>}
            {changes !== null && changes.length === 0 && <p className="buddy-empty">No article changes yet.</p>}
            {changes !== null && changes.length > 0 && (
              <ul className="buddy-chat-list">
                {changes.map((change) => {
                  const open = openId === change.id;
                  return (
                    <li key={change.id} className="buddy-report-item buddy-change-item">
                      <p className="buddy-change-text">{describeChange(change)}</p>
                      <span className="buddy-chat-time">{formatDayLabel(change.appliedAt.slice(0, 10))}</span>
                      <button
                        type="button"
                        className="buddy-button"
                        aria-expanded={open}
                        onClick={() => setOpenId(open ? null : change.id)}
                      >
                        {open ? 'Hide the paragraph' : 'Show the paragraph'}
                      </button>
                      {open && (
                        <div className="buddy-paragraph-pair" aria-label="The paragraph before and after">
                          <p className="buddy-paragraph-label">Before</p>
                          <p className="buddy-paragraph" data-testid="paragraph-before">
                            {change.before}
                          </p>
                          <p className="buddy-paragraph-label">After</p>
                          <p className="buddy-paragraph" data-testid="paragraph-after">
                            {change.after}
                          </p>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="buddy-briefing-section" aria-label="Product gaps">
            <h2 className="buddy-briefing-title">Product gaps</h2>
            {gaps === null && <p className="buddy-empty">Loading gaps…</p>}
            {gaps !== null && gaps.length === 0 && <p className="buddy-empty">No product gaps waiting.</p>}
            {gaps !== null && gaps.length > 0 && (
              <ul className="buddy-chat-list">
                {gaps.map((gap) => (
                  <li key={gap.id} className="buddy-report-item buddy-change-item">
                    <p className="buddy-change-text">
                      {gap.note} <span className="buddy-chat-time">For: {gap.angle}</span>
                    </p>
                    <button type="button" className="buddy-button" onClick={() => seen(gap.id)}>
                      Got it
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
