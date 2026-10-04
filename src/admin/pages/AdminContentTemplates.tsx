import { useState } from 'react';
import { FileText, Plus, Trash2, Copy, Loader2 } from 'lucide-react';
import { useContentTemplates } from '../../hooks/usePlatform';

export default function AdminContentTemplates() {
  const { templates, loading, saveTemplate, deleteTemplate } = useContentTemplates();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [content, setContent] = useState('');
  const [category, setCategory] = useState('');
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !content.trim()) return;
    setSaving(true);
    const result = await saveTemplate(name.trim(), description.trim(), content, category.trim() || undefined);
    setSaving(false);
    if (result) { setShowForm(false); setName(''); setDescription(''); setContent(''); setCategory(''); }
  };

  const copyContent = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-serif text-2xl text-charcoal">Content Templates</h1>
          <p className="text-sm text-charcoal-muted mt-1">Reusable article structures for faster writing.</p>
        </div>
        <button onClick={() => setShowForm(!showForm)} className="inline-flex items-center gap-2 px-4 py-2 bg-charcoal text-white text-sm rounded-sm hover:bg-bronze transition-all">
          <Plus size={14} /> New Template
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSave} className="bg-white rounded-sm p-6 border border-taupe/30 mb-6 space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-charcoal-muted uppercase tracking-wide">Name</label>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Product Comparison" required className="w-full mt-1 border border-taupe/50 px-3 py-2 text-sm rounded-sm focus:outline-none focus:border-bronze" />
            </div>
            <div>
              <label className="text-xs text-charcoal-muted uppercase tracking-wide">Category (optional)</label>
              <input value={category} onChange={e => setCategory(e.target.value)} placeholder="Review" className="w-full mt-1 border border-taupe/50 px-3 py-2 text-sm rounded-sm focus:outline-none focus:border-bronze" />
            </div>
          </div>
          <div>
            <label className="text-xs text-charcoal-muted uppercase tracking-wide">Description</label>
            <input value={description} onChange={e => setDescription(e.target.value)} placeholder="Brief description of when to use this template" className="w-full mt-1 border border-taupe/50 px-3 py-2 text-sm rounded-sm focus:outline-none focus:border-bronze" />
          </div>
          <div>
            <label className="text-xs text-charcoal-muted uppercase tracking-wide">Template Content (Markdown)</label>
            <textarea value={content} onChange={e => setContent(e.target.value)} rows={10} placeholder="# Article Title..." required className="w-full mt-1 border border-taupe/50 px-3 py-2 text-sm font-mono rounded-sm focus:outline-none focus:border-bronze resize-y" />
          </div>
          <button type="submit" disabled={saving} className="inline-flex items-center gap-2 px-5 py-2.5 bg-bronze text-white text-sm rounded-sm hover:bg-bronze-dark transition-all disabled:opacity-50">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Save Template
          </button>
        </form>
      )}

      {loading ? (
        <div className="text-center py-12 text-charcoal-muted text-sm">Loading...</div>
      ) : templates.length === 0 ? (
        <div className="text-center py-12 text-charcoal-muted text-sm">No templates yet.</div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {templates.map(t => (
            <div key={t.id} className="bg-white rounded-sm border border-taupe/30 p-5 group">
              <div className="flex items-start justify-between mb-3">
                <FileText size={16} className="text-bronze" />
                <div className="flex items-center gap-2 hover-reveal transition-opacity">
                  <button onClick={() => copyContent(t.id, t.content)} className="text-charcoal-muted hover:text-bronze" aria-label="Copy template">
                    {copied === t.id ? <span className="text-xs text-green-600">Copied!</span> : <Copy size={14} />}
                  </button>
                  <button onClick={() => deleteTemplate(t.id)} className="text-charcoal-muted hover:text-red-500" aria-label="Delete template">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              <h3 className="font-serif text-base text-charcoal">{t.name}</h3>
              {t.category && <span className="text-[10px] tracking-editorial uppercase text-bronze">{t.category}</span>}
              {t.description && <p className="text-xs text-charcoal-muted mt-2 leading-relaxed">{t.description}</p>}
              <pre className="text-xs text-charcoal-muted/70 mt-3 line-clamp-4 font-mono whitespace-pre-wrap">{t.content}</pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
