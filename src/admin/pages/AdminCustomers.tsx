import { useState, useMemo } from 'react';
import { Users, Search } from 'lucide-react';
import { useAdminCustomers } from '../../hooks/useCommerce';

export default function AdminCustomers() {
  const { customers, loading } = useAdminCustomers();
  const [filter, setFilter] = useState('');

  const filtered = useMemo(() => customers.filter(c =>
    !filter || c.email?.toLowerCase().includes(filter.toLowerCase()) || c.name?.toLowerCase().includes(filter.toLowerCase())
  ), [customers, filter]);

  return (
    <div>
      <div className="mb-8">
        <h1 className="font-serif text-3xl text-charcoal font-light">Customers</h1>
        <p className="text-sm text-charcoal-muted mt-1">{customers.length} total</p>
      </div>

      <div className="relative max-w-xs mb-6">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-charcoal-muted" />
        <input type="text" value={filter} onChange={e => setFilter(e.target.value)} placeholder="Search customers..." className="w-full bg-white border border-taupe/50 pl-9 pr-4 py-2.5 text-sm rounded-sm focus:outline-none focus:border-bronze" />
      </div>

      {loading ? (
        <div className="space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="skeleton h-16 rounded-sm" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-sm border border-taupe/30">
          <Users size={32} strokeWidth={1.5} className="text-charcoal-muted mx-auto mb-4" />
          <p className="text-charcoal-muted">No customers found.</p>
        </div>
      ) : (
        <div className="bg-white rounded-sm border border-taupe/30 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-taupe-light/40">
              <tr className="text-left text-[10px] tracking-editorial uppercase text-charcoal-muted">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Joined</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => (
                <tr key={c.id} className="border-t border-taupe/30 hover:bg-taupe-light/20">
                  <td className="px-4 py-3 text-charcoal">{c.name || '—'}</td>
                  <td className="px-4 py-3 text-charcoal-muted">{c.email}</td>
                  <td className="px-4 py-3 text-charcoal-muted text-xs">{new Date(c.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
