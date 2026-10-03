import { useState, useMemo } from 'react';
import { Mail, Search, Download } from 'lucide-react';
import { useAdminNewsletterSubscribers } from '../../hooks/useCommerce';

export default function AdminNewsletter() {
  const { subscribers, loading } = useAdminNewsletterSubscribers();
  const [filter, setFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const filtered = useMemo(() => subscribers.filter(s => {
    if (statusFilter !== 'all' && s.status !== statusFilter) return false;
    if (filter) return s.email?.toLowerCase().includes(filter.toLowerCase());
    return true;
  }), [subscribers, filter, statusFilter]);

  const exportCsv = () => {
    const csv = ['email,status,source,subscribed_date'];
    filtered.forEach(s => {
      csv.push(`${s.email},${s.status},${s.source || ''},${new Date(s.created_at).toISOString()}`);
    });
    const blob = new Blob([csv.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'newsletter-subscribers.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-serif text-3xl text-charcoal font-light">Newsletter</h1>
          <p className="text-sm text-charcoal-muted mt-1">{subscribers.length} subscribers</p>
        </div>
        {subscribers.length > 0 && (
          <button onClick={exportCsv} className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-taupe/50 text-charcoal text-xs tracking-editorial uppercase font-medium rounded-sm hover:border-bronze transition-all">
            <Download size={14} /> Export CSV
          </button>
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-charcoal-muted" />
          <input type="text" value={filter} onChange={e => setFilter(e.target.value)} placeholder="Search subscribers..." className="w-full bg-white border border-taupe/50 pl-9 pr-4 py-2.5 text-sm rounded-sm focus:outline-none focus:border-bronze" />
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="bg-white border border-taupe/50 px-4 py-2.5 text-sm rounded-sm focus:outline-none focus:border-bronze">
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="unsubscribed">Unsubscribed</option>
        </select>
      </div>

      {loading ? (
        <div className="space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="skeleton h-16 rounded-sm" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-sm border border-taupe/30">
          <Mail size={32} strokeWidth={1.5} className="text-charcoal-muted mx-auto mb-4" />
          <p className="text-charcoal-muted">No subscribers found.</p>
        </div>
      ) : (
        <div className="bg-white rounded-sm border border-taupe/30 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-taupe-light/40">
              <tr className="text-left text-[10px] tracking-editorial uppercase text-charcoal-muted">
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Source</th>
                <th className="px-4 py-3">Subscribed</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(s => (
                <tr key={s.id} className="border-t border-taupe/30 hover:bg-taupe-light/20">
                  <td className="px-4 py-3 text-charcoal">{s.email}</td>
                  <td className="px-4 py-3"><span className={`text-xs px-2 py-1 rounded-full ${s.status === 'active' ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{s.status}</span></td>
                  <td className="px-4 py-3 text-charcoal-muted text-xs">{s.source || 'website'}</td>
                  <td className="px-4 py-3 text-charcoal-muted text-xs">{new Date(s.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
