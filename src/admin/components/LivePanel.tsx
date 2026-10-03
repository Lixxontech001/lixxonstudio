import { useEffect, useRef, useState } from 'react';
import { Radio, ShoppingBag, Eye, MessageSquare } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';

type Ev = { id: string; kind: 'order' | 'view' | 'comment'; text: string; at: number };

/** Realtime feed (Supabase Realtime, free): new orders, article views and comments as they happen. */
export default function LivePanel() {
  const [events, setEvents] = useState<Ev[]>([]);
  const [today, setToday] = useState({ orders: 0, revenue: 0, views: 0 });
  const titles = useRef<Record<string, string>>({});

  useEffect(() => {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const since = start.toISOString();
    (async () => {
      const [o, v, p] = await Promise.all([
        supabase.from('orders').select('amount, payment_status').gte('created_at', since),
        supabase.from('article_views').select('id', { count: 'exact', head: true }).gte('created_at', since),
        supabase.from('posts').select('id, title').eq('status', 'published'),
      ]);
      (p.data || []).forEach((x: { id: string; title: string }) => { titles.current[x.id] = x.title; });
      const paid = (o.data || []).filter((x: { payment_status: string }) => x.payment_status === 'paid');
      setToday({ orders: paid.length, revenue: paid.reduce((s: number, x: { amount: number | string }) => s + Number(x.amount), 0), views: v.count || 0 });
    })();
    const push = (e: Ev) => setEvents(prev => [e, ...prev].slice(0, 30));
    const ch = supabase.channel('admin-live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, payload => { const r = payload.new as { id: string; order_number: string; amount: number }; push({ id: r.id, kind: 'order', text: `New order ${r.order_number} · $${Number(r.amount).toFixed(2)}`, at: Date.now() }); })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders' }, payload => { const r = payload.new as { id: string; order_number: string; amount: number; payment_status: string }; const old = payload.old as { payment_status?: string }; if (r.payment_status === 'paid' && old.payment_status !== 'paid') { push({ id: r.id + ':paid', kind: 'order', text: `Paid: ${r.order_number} · $${Number(r.amount).toFixed(2)}`, at: Date.now() }); setToday(t => ({ ...t, orders: t.orders + 1, revenue: t.revenue + Number(r.amount) })); } })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'article_views' }, payload => { const r = payload.new as { id: string; post_id: string }; push({ id: r.id, kind: 'view', text: `Reading: ${titles.current[r.post_id] || 'an article'}`, at: Date.now() }); setToday(t => ({ ...t, views: t.views + 1 })); })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'comments' }, payload => { const r = payload.new as { id: string; author_name: string }; push({ id: r.id, kind: 'comment', text: `New comment from ${r.author_name} (awaiting moderation)`, at: Date.now() }); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const Icon = ({ k }: { k: Ev['kind'] }) => k === 'order' ? <ShoppingBag size={12} className="text-green-600" /> : k === 'comment' ? <MessageSquare size={12} className="text-blue-600" /> : <Eye size={12} className="text-charcoal-muted" />;
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-medium text-gray-900 flex items-center gap-2"><Radio size={14} className="text-red-500 animate-pulse" /> Live today</h2>
        <div className="flex gap-4 text-xs text-gray-500"><span><strong className="text-gray-900">{today.orders}</strong> paid orders</span><span><strong className="text-gray-900">${today.revenue.toFixed(2)}</strong> revenue</span><span><strong className="text-gray-900">{today.views}</strong> views</span></div>
      </div>
      <ul className="space-y-1.5 max-h-56 overflow-y-auto text-xs">
        {events.length === 0 && <li className="text-gray-400">Waiting for activity… this updates in real time while the tab is open.</li>}
        {events.map(e => <li key={e.id} className="flex items-center gap-2 text-gray-600"><Icon k={e.kind} /><span className="flex-1 truncate">{e.text}</span><time className="text-gray-400">{new Date(e.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></li>)}
      </ul>
    </div>
  );
}
