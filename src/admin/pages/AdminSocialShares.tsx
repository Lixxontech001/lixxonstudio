import {Share2} from 'lucide-react';
import { useAdminSocialShares } from '../../hooks/usePlatform';

const PLATFORM_LABELS: Record<string, string> = {
  twitter: 'X / Twitter',
  facebook: 'Facebook',
  linkedin: 'LinkedIn',
  pinterest: 'Pinterest',
  native: 'Native Share',
  copy: 'Copy Link',
};

export default function AdminSocialShares() {
  const { stats, loading } = useAdminSocialShares();
  const total = stats.reduce((sum, s) => sum + s.count, 0);

  return (
    <div>
      <h1 className="font-serif text-2xl text-charcoal mb-1">Social Shares</h1>
      <p className="text-sm text-charcoal-muted mb-6">Track which platforms readers share to most.</p>

      {loading ? (
        <div className="text-center py-12 text-charcoal-muted text-sm">Loading...</div>
      ) : stats.length === 0 ? (
        <div className="text-center py-12 text-charcoal-muted text-sm">No shares recorded yet.</div>
      ) : (
        <div>
          <div className="bg-white rounded-sm border border-taupe/30 p-6 mb-6 text-center">
            <p className="font-serif text-4xl text-charcoal">{total}</p>
            <p className="text-xs text-charcoal-muted uppercase tracking-wide mt-1">Total Shares</p>
          </div>
          <div className="space-y-3">
            {stats.map(s => (
              <div key={s.platform} className="bg-white rounded-sm border border-taupe/30 p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Share2 size={14} className="text-bronze" />
                    <span className="text-sm font-medium text-charcoal">{PLATFORM_LABELS[s.platform] || s.platform}</span>
                  </div>
                  <span className="text-sm text-charcoal-muted">{s.count} {s.count === 1 ? 'share' : 'shares'}</span>
                </div>
                <div className="h-2 bg-taupe-light/60 rounded-full overflow-hidden">
                  <div className="h-full bg-bronze rounded-full transition-all" style={{ width: `${total > 0 ? (s.count / total) * 100 : 0}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
