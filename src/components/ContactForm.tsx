import { useState } from 'react';
import { ArrowRight, Check, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';

export default function ContactForm() {
  const [form, setForm] = useState({ name: '', email: '', message: '' });
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const update = (field: keyof typeof form, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }));
    if (status !== 'idle') setStatus('idle');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim() || !form.message.trim()) {
      setStatus('error');
      setErrorMsg('Please fill in all fields.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      setStatus('error');
      setErrorMsg('Please enter a valid email address.');
      return;
    }
    setStatus('submitting');
    const { error } = await supabase.from('contact_messages').insert({
      name: form.name.trim(),
      email: form.email.trim(),
      message: form.message.trim(),
    });
    if (error) {
      setStatus('error');
      setErrorMsg('Something went wrong. Please try again in a moment.');
      return;
    }
    setStatus('success');
    setForm({ name: '', email: '', message: '' });
    setTimeout(() => setStatus('idle'), 6000);
  };

  return (
    <form onSubmit={handleSubmit} className="grid gap-5 mt-10">
      <div className="grid sm:grid-cols-2 gap-5">
        <div>
          <label className="block text-[10px] tracking-editorial uppercase text-charcoal-muted mb-2">Name</label>
          <input
            type="text"
            value={form.name}
            onChange={e => update('name', e.target.value)}
            placeholder="Your full name"
            className="w-full bg-porcelain border border-taupe/50 px-4 py-3.5 text-charcoal placeholder:text-charcoal-muted/50 focus:outline-none focus:border-bronze transition-colors rounded-sm"
          />
        </div>
        <div>
          <label className="block text-[10px] tracking-editorial uppercase text-charcoal-muted mb-2">Email</label>
          <input
            type="email"
            value={form.email}
            onChange={e => update('email', e.target.value)}
            placeholder="your@email.com"
            className="w-full bg-porcelain border border-taupe/50 px-4 py-3.5 text-charcoal placeholder:text-charcoal-muted/50 focus:outline-none focus:border-bronze transition-colors rounded-sm"
          />
        </div>
      </div>
      <div>
        <label className="block text-[10px] tracking-editorial uppercase text-charcoal-muted mb-2">Message</label>
        <textarea
          value={form.message}
          onChange={e => update('message', e.target.value)}
          rows={6}
          placeholder="Tell us what is on your mind..."
          className="w-full bg-porcelain border border-taupe/50 px-4 py-3.5 text-charcoal placeholder:text-charcoal-muted/50 focus:outline-none focus:border-bronze transition-colors rounded-sm resize-none"
        />
      </div>

      {status === 'error' && (
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 px-4 py-3 rounded-sm">{errorMsg}</p>
      )}
      {status === 'success' && (
        <div className="flex items-center gap-3 text-sm text-green-800 bg-green-50 border border-green-200 px-4 py-3.5 rounded-sm">
          <Check size={16} strokeWidth={2} />
          <span>Thank you for reaching out. Our editorial team will respond within two business days.</span>
        </div>
      )}

      <button
        type="submit"
        disabled={status === 'submitting'}
        className="inline-flex items-center justify-center gap-3 px-8 py-4 bg-charcoal text-white text-xs tracking-editorial uppercase font-medium hover:bg-bronze transition-all duration-500 rounded-sm disabled:opacity-60 w-fit"
      >
        {status === 'submitting' ? (
          <><Loader2 size={14} className="animate-spin" /> Sending</>
        ) : status === 'success' ? (
          <><Check size={14} /> Message Sent</>
        ) : (
          <>Send Message <ArrowRight size={14} /></>
        )}
      </button>
    </form>
  );
}
