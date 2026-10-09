import { useEffect, useState } from 'react';
import { formatDayLabel, listReports, type BuddyReport } from './buddyChatStore';
import type { BuddyVibeId } from './buddyVibes';

interface BuddyReportsProps {
  vibe: BuddyVibeId;
  onBack: () => void;
}

/** Night reports are a separate door from chat. This view only lists them. Nothing here writes or sends. */
export default function BuddyReports({ vibe, onBack }: BuddyReportsProps) {
  const [reports, setReports] = useState<BuddyReport[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const list = await listReports();
      if (cancelled) return;
      if (list) setReports(list);
      else setFailed(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="buddy-app" data-vibe={vibe} data-testid="buddy-reports">
      <header className="buddy-top">
        <button type="button" className="buddy-button" onClick={onBack}>
          Back to Buddy
        </button>
        <h1 className="buddy-name">Reports</h1>
      </header>
      <main className="buddy-log" aria-label="Night reports">
        <div className="buddy-log-inner">
          {failed && <p className="buddy-banner buddy-error" role="alert">Reports could not be opened just now. Try again shortly.</p>}
          {!failed && reports === null && <p className="buddy-empty">Loading reports…</p>}
          {reports !== null && reports.length === 0 && <p className="buddy-empty">No night reports yet.</p>}
          {reports !== null && reports.length > 0 && (
            <ul className="buddy-chat-list">
              {reports.map((report) => (
                <li key={report.id} className="buddy-report-item">
                  <span className="buddy-chat-title">{report.title}</span>
                  <span className="buddy-chat-time">{formatDayLabel(report.reportDate)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>
    </div>
  );
}
