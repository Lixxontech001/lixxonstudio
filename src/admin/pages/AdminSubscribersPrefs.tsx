import { Mail, Loader2, Calendar } from 'lucide-react';
import { useAdminSubscribersWithPrefs } from '../../hooks/usePlatform';

export default function AdminSubscribersPrefs() {
  const { subscribers, loading } = useAdminSubscribersWithPrefs();

  return (
    <div>
      <h1 className="font-serif text-2xl text-charcoal mb-1">Subscriber Preferences</h1>
      <p className="text-sm text-charcoal-muted mb-6">Newsletter subscribers with their content preferences.</p>

      {loading ? (
        <div className="text-center py-12 text-charcoal-muted text-sm">Loading...</div>
      ) : subscribers.length === 0 ? (
        <div className="text-center py-12 text-charcoal-muted text-sm">No subscribers yet.</div>
      ) : (
        <div className="bg-white rounded-sm border border-taupe/30 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-taupe-light/40 text-charcoal-muted text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left px-4 py-3">Email</th>
                <th className="text-left px-4 py-3">Frequency</th>
                <th className="text-left px-4 py-3">Preferred Categories</th>
                <th className="text-left px-4 py-3">Subscribed</th>
              </tr>
            </thead>
            <tbody>
              {subscribers.map(s => (
                <tr key={s.id} className="border-t border-taupe/20">
                  <td className="px-4 py-3 text-charcoal">{s.email}</td>
                  <td className="px-4 py-3 text-charcoal-muted">
                    {s.preferences ? (
                      <span className="inline-flex items-center gap-1"><Calendar size={10} /> {s.preferences.frequency}</span>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-3 text-charcoal-muted">
                    {s.preferences?.preferred_categories?.length ? (
                      <div className="flex flex-wrap gap-1">
                        {s.preferences.preferred_categories.map(c => (
                          <span key={c} className="text-xs bg-taupe-light/60 px-2 py-0.5 rounded-full">{c}</span>
                        ))}
                      </div>
                    ) : 'All categories'}
                  </td>
                  <td className="px-4 py-3 text-charcoal-muted">{new Date(s.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
