import { useState } from 'react';
import {Plus, Trash2, Loader2} from 'lucide-react';
import { useAdminGiftCards } from '../../hooks/usePlatform';

export default function AdminGiftCards() {
  const { cards, loading, create, remove } = useAdminGiftCards();
  const [showForm, setShowForm] = useState(false);
  const [code, setCode] = useState('');
  const [balance, setBalance] = useState(50);
  const [buyerEmail, setBuyerEmail] = useState('');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [saving, setSaving] = useState(false);

  const generateCode = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let c = '';
    for (let i = 0; i < 12; i++) c += chars[Math.floor(Math.random() * chars.length)];
    setCode(c);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim() || balance <= 0) return;
    setSaving(true);
    const ok = await create(code, balance, buyerEmail || undefined, recipientEmail || undefined);
    setSaving(false);
    if (ok) { setShowForm(false); setCode(''); setBalance(50); setBuyerEmail(''); setRecipientEmail(''); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-serif text-2xl text-charcoal">Gift Cards</h1>
          <p className="text-sm text-charcoal-muted mt-1">Create and manage gift card codes.</p>
        </div>
        <button onClick={() => setShowForm(!showForm)} className="inline-flex items-center gap-2 px-4 py-2 bg-charcoal text-white text-sm rounded-sm hover:bg-bronze transition-all">
          <Plus size={14} /> New Gift Card
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="bg-white rounded-sm p-6 border border-taupe/30 mb-6 space-y-4">
          <div>
            <label className="text-xs text-charcoal-muted uppercase tracking-wide">Code</label>
            <div className="flex gap-2 mt-1">
              <input value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="GIFT123ABC" required className="flex-1 border border-taupe/50 px-3 py-2 text-sm font-mono rounded-sm focus:outline-none focus:border-bronze" />
              <button type="button" onClick={generateCode} className="px-3 py-2 text-xs border border-taupe/50 rounded-sm hover:border-bronze transition-all">Generate</button>
            </div>
          </div>
          <div>
            <label className="text-xs text-charcoal-muted uppercase tracking-wide">Balance ($)</label>
            <input type="number" value={balance} onChange={e => setBalance(parseFloat(e.target.value))} min="1" step="0.01" required className="w-full mt-1 border border-taupe/50 px-3 py-2 text-sm rounded-sm focus:outline-none focus:border-bronze" />
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-charcoal-muted uppercase tracking-wide">Buyer Email (optional)</label>
              <input type="email" value={buyerEmail} onChange={e => setBuyerEmail(e.target.value)} className="w-full mt-1 border border-taupe/50 px-3 py-2 text-sm rounded-sm focus:outline-none focus:border-bronze" />
            </div>
            <div>
              <label className="text-xs text-charcoal-muted uppercase tracking-wide">Recipient Email (optional)</label>
              <input type="email" value={recipientEmail} onChange={e => setRecipientEmail(e.target.value)} className="w-full mt-1 border border-taupe/50 px-3 py-2 text-sm rounded-sm focus:outline-none focus:border-bronze" />
            </div>
          </div>
          <button type="submit" disabled={saving} className="inline-flex items-center gap-2 px-5 py-2.5 bg-bronze text-white text-sm rounded-sm hover:bg-bronze-dark transition-all disabled:opacity-50">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Create Gift Card
          </button>
        </form>
      )}

      {loading ? (
        <div className="text-center py-12 text-charcoal-muted text-sm">Loading...</div>
      ) : cards.length === 0 ? (
        <div className="text-center py-12 text-charcoal-muted text-sm">No gift cards yet.</div>
      ) : (
        <div className="bg-white rounded-sm border border-taupe/30 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-taupe-light/40 text-charcoal-muted text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left px-4 py-3">Code</th>
                <th className="text-left px-4 py-3">Balance</th>
                <th className="text-left px-4 py-3">Buyer</th>
                <th className="text-left px-4 py-3">Recipient</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-right px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {cards.map(c => (
                <tr key={c.id} className="border-t border-taupe/20">
                  <td className="px-4 py-3 font-mono font-medium text-charcoal">{c.code}</td>
                  <td className="px-4 py-3 text-charcoal-muted">${c.balance.toFixed(2)} / ${c.initial_balance.toFixed(2)}</td>
                  <td className="px-4 py-3 text-charcoal-muted">{c.buyer_email || '—'}</td>
                  <td className="px-4 py-3 text-charcoal-muted">{c.recipient_email || '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs ${c.is_active && c.balance > 0 ? 'text-green-600' : 'text-charcoal-muted'}`}>
                      {c.is_active && c.balance > 0 ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => remove(c.id)} className="text-charcoal-muted hover:text-red-500"><Trash2 size={14} /></button>
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
