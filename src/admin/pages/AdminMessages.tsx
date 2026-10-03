import { useState, useEffect } from 'react';
import { Mail, Search, Trash2, MailOpen } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';

interface ContactMessage {
  id: string;
  name: string;
  email: string;
  topic: string | null;
  message: string;
  created_at: string;
}

export default function AdminMessages() {
  const [messages, setMessages] = useState<ContactMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<ContactMessage | null>(null);

  useEffect(() => { fetchMessages(); }, []);

  const fetchMessages = async () => {
  setLoading(true);
  const { data, error } = await supabase
    .from('contact_messages')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching contact messages:', error.message);
  } else {
    setMessages((data || []) as ContactMessage[]);
  }
  setLoading(false);
};

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this message?')) return;
    await supabase.from('contact_messages').delete().eq('id', id);
    setMessages(prev => prev.filter(m => m.id !== id));
    if (selected?.id === id) setSelected(null);
  };

  const filtered = messages.filter(m =>
    !filter || m.name?.toLowerCase().includes(filter.toLowerCase()) || m.email?.toLowerCase().includes(filter.toLowerCase()) || m.message?.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div>
      <div className="mb-8">
        <h1 className="font-serif text-3xl text-charcoal font-light">Messages</h1>
        <p className="text-sm text-charcoal-muted mt-1">{messages.length} total</p>
      </div>

      <div className="relative max-w-xs mb-6">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-charcoal-muted" />
        <input type="text" value={filter} onChange={e => setFilter(e.target.value)} placeholder="Search messages..." className="w-full bg-white border border-taupe/50 pl-9 pr-4 py-2.5 text-sm rounded-sm focus:outline-none focus:border-bronze" />
      </div>

      {loading ? (
        <div className="space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="skeleton h-20 rounded-sm" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-sm border border-taupe/30">
          <Mail size={32} strokeWidth={1.5} className="text-charcoal-muted mx-auto mb-4" />
          <p className="text-charcoal-muted">No messages yet. Contact form submissions will appear here.</p>
        </div>
      ) : (
        <div className="grid lg:grid-cols-2 gap-6">
          <div className="space-y-3">
            {filtered.map(m => (
              <button
                key={m.id}
                onClick={() => setSelected(m)}
                className={`w-full text-left bg-white rounded-sm border p-5 transition-all ${selected?.id === m.id ? 'border-bronze' : 'border-taupe/30 hover:border-taupe'}`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-charcoal">{m.name}</span>
                  <span className="text-xs text-charcoal-muted">{new Date(m.created_at).toLocaleDateString()}</span>
                </div>
                <p className="text-xs text-charcoal-muted mb-2">{m.email}</p>
                {m.topic && <span className="text-[10px] tracking-editorial uppercase text-bronze">{m.topic}</span>}
                <p className="text-sm text-charcoal-muted mt-2 line-clamp-2">{m.message}</p>
              </button>
            ))}
          </div>

          {selected && (
            <div className="bg-white rounded-sm border border-taupe/30 p-6 sticky top-6 self-start">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <MailOpen size={18} className="text-bronze" />
                  <h3 className="font-serif text-lg text-charcoal">Message Details</h3>
                </div>
                <button onClick={() => handleDelete(selected.id)} className="text-charcoal-muted hover:text-red-600 transition-colors"><Trash2 size={16} /></button>
              </div>
              <div className="space-y-3 text-sm">
                <div><span className="text-charcoal-muted text-xs">From:</span> <span className="text-charcoal">{selected.name}</span></div>
                <div><span className="text-charcoal-muted text-xs">Email:</span> <a href={`mailto:${selected.email}`} className="text-bronze hover:underline">{selected.email}</a></div>
                {selected.topic && <div><span className="text-charcoal-muted text-xs">Topic:</span> <span className="text-charcoal">{selected.topic}</span></div>}
                <div><span className="text-charcoal-muted text-xs">Date:</span> <span className="text-charcoal">{new Date(selected.created_at).toLocaleString()}</span></div>
                <div className="pt-3 border-t border-taupe/30">
                  <p className="text-charcoal-muted text-xs mb-2">Message:</p>
                  <p className="text-charcoal leading-relaxed whitespace-pre-wrap">{selected.message}</p>
                </div>
                <a href={`mailto:${selected.email}?subject=Re: ${selected.topic || 'Your message to Lixxon Studio'}&body=Hi ${selected.name},%0D%0A%0D%0AThank you for reaching out to Lixxon Studio.`} className="inline-flex items-center gap-2 px-4 py-2.5 bg-bronze text-white text-xs tracking-editorial uppercase font-medium rounded-sm hover:bg-bronze-dark transition-all mt-2">
                  Reply via Email
                </a>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
