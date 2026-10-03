import { useState } from 'react';
import { Tag, Plus, Trash2, Power, Loader2 } from 'lucide-react';
import { useAdminPromoCodes } from '../../hooks/usePlatform';

export default function AdminPromoCodes() {
  const { codes, loading, create, toggle, remove } = useAdminPromoCodes();
  const [showForm, setShowForm] = useState(false);
  const [code, setCode] = useState('');
  const [discountType, setDiscountType] = useState('percentage');
  const [discountValue, setDiscountValue] = useState(10);
  const [maxUses, setMaxUses] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [saving, setSaving] = useState(false);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const ok = await create(code, discountType, discountValue, maxUses ? parseInt(maxUses) : undefined, expiresAt || undefined);
    setSaving(false);
    if (ok) { setShowForm(false); setCode(''); setDiscountValue(10); setMaxUses(''); setExpiresAt(''); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-serif text-2xl text-charcoal">Promo Codes</h1>
          <p className="text-sm text-charcoal-muted mt-1">Create and manage discount codes.</p>
        </div>
        <button onClick={() => setShowForm(!showForm)} className="inline-flex items-center gap-2 px-4 py-2 bg-charcoal text-white text-sm rounded-sm hover:bg-bronze transition-all">
          <Plus size={14} /> New Code
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="bg-white rounded-sm p-6 border border-taupe/30 mb-6 space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-charcoal-muted uppercase tracking-wide">Code</label>
              <input value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="SAVE20" required className="w-full mt-1 border border-taupe/50 px-3 py-2 text-sm rounded-sm focus:outline-none focus:border-bronze" />
            </div>
            <div>
              <label className="text-xs text-charcoal-muted uppercase tracking-wide">Type</label>
              <select value={discountType} onChange={e => setDiscountType(e.target.value)} className="w-full mt-1 border border-taupe/50 px-3 py-2 text-sm rounded-sm focus:outline-none focus:border-bronze">
                <option value="percentage">Percentage</option>
                <option value="fixed">Fixed Amount</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-charcoal-muted uppercase tracking-wide">Value</label>
              <input type="number" value={discountValue} onChange={e => setDiscountValue(parseFloat(e.target.value))} step="0.01" min="0" required className="w-full mt-1 border border-taupe/50 px-3 py-2 text-sm rounded-sm focus:outline-none focus:border-bronze" />
            </div>
            <div>
              <label className="text-xs text-charcoal-muted uppercase tracking-wide">Max Uses (optional)</label>
              <input type="number" value={maxUses} onChange={e => setMaxUses(e.target.value)} placeholder="Unlimited" className="w-full mt-1 border border-taupe/50 px-3 py-2 text-sm rounded-sm focus:outline-none focus:border-bronze" />
            </div>
            <div>
              <label className="text-xs text-charcoal-muted uppercase tracking-wide">Expires At (optional)</label>
              <input type="date" value={expiresAt} onChange={e => setExpiresAt(e.target.value)} className="w-full mt-1 border border-taupe/50 px-3 py-2 text-sm rounded-sm focus:outline-none focus:border-bronze" />
            </div>
          </div>
          <button type="submit" disabled={saving} className="inline-flex items-center gap-2 px-5 py-2.5 bg-bronze text-white text-sm rounded-sm hover:bg-bronze-dark transition-all disabled:opacity-50">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Create Code
          </button>
        </form>
      )}

      {loading ? (
        <div className="text-center py-12 text-charcoal-muted text-sm">Loading...</div>
      ) : codes.length === 0 ? (
        <div className="text-center py-12 text-charcoal-muted text-sm">No promo codes yet.</div>
      ) : (
        <div className="bg-white rounded-sm border border-taupe/30 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-taupe-light/40 text-charcoal-muted text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left px-4 py-3">Code</th>
                <th className="text-left px-4 py-3">Discount</th>
                <th className="text-left px-4 py-3">Uses</th>
                <th className="text-left px-4 py-3">Expires</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-right px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {codes.map(c => (
                <tr key={c.id} className="border-t border-taupe/20">
                  <td className="px-4 py-3 font-mono font-medium text-charcoal">{c.code}</td>
                  <td className="px-4 py-3 text-charcoal-muted">{c.discount_type === 'percentage' ? `${c.discount_value}%` : `$${c.discount_value}`}</td>
                  <td className="px-4 py-3 text-charcoal-muted">{c.use_count}{c.max_uses ? ` / ${c.max_uses}` : ''}</td>
                  <td className="px-4 py-3 text-charcoal-muted">{c.expires_at ? new Date(c.expires_at).toLocaleDateString() : '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1 text-xs ${c.is_active ? 'text-green-600' : 'text-charcoal-muted'}`}>
                      <Power size={10} /> {c.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => toggle(c.id, !c.is_active)} className="text-xs text-charcoal-muted hover:text-bronze mr-3">{c.is_active ? 'Deactivate' : 'Activate'}</button>
                    <button onClick={() => remove(c.id)} className="text-xs text-charcoal-muted hover:text-red-500"><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
