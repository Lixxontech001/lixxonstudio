import { useCallback, useEffect, useState } from 'react';
import { Plus, Save, Trash2, RefreshCw, Sparkles } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';

interface SynonymRow {
  id: string;
  term: string;
  synonyms: string[];
  note: string | null;
}

/**
 * Search synonyms — the owner-editable bridge between how readers type and how
 * the library is written ("nicotinamide" → niacinamide, "ascorbic acid" →
 * vitamin C). Public read, admin-only write, enforced by RLS.
 */
export default function SearchSynonymsPanel() {
  const [rows, setRows] = useState<SynonymRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [draft, setDraft] = useState({ term: '', synonyms: '' });

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from('search_synonyms').select('id, term, synonyms, note').order('term');
    if (!error && data) setRows(data as SynonymRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const updateRow = (id: string, patch: Partial<SynonymRow>) => {
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };

  const saveRow = async (row: SynonymRow) => {
    setSavingId(row.id);
    setStatus(null);
    const { error } = await supabase
      .from('search_synonyms')
      .update({ synonyms: row.synonyms.filter(Boolean), updated_at: new Date().toISOString() })
      .eq('id', row.id);
    setSavingId(null);
    setStatus(error ? `Could not save “${row.term}”: ${error.message}` : `Saved “${row.term}”. Readers will match it immediately.`);
  };

  const addRow = async () => {
    const term = draft.term.trim().toLowerCase();
    const synonyms = draft.synonyms
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    if (term.length < 2 || synonyms.length === 0) {
      setStatus('Add a term and at least one synonym.');
      return;
    }
    const { data, error } = await supabase
      .from('search_synonyms')
      .upsert({ term, synonyms }, { onConflict: 'term' })
      .select('id, term, synonyms, note')
      .maybeSingle();
    if (error) {
      setStatus(`Could not add “${term}”: ${error.message}`);
      return;
    }
    if (data) setRows((prev) => [...prev.filter((row) => row.term !== term), data as SynonymRow].sort((a, b) => a.term.localeCompare(b.term)));
    setDraft({ term: '', synonyms: '' });
    setStatus(`Added “${term}”.`);
  };

  const removeRow = async (row: SynonymRow) => {
    const { error } = await supabase.from('search_synonyms').delete().eq('id', row.id);
    if (!error) {
      setRows((prev) => prev.filter((entry) => entry.id !== row.id));
      setStatus(`Removed “${row.term}”.`);
    } else {
      setStatus(error.message);
    }
  };

  return (
    <div className="bg-white border border-taupe/30 rounded-sm p-6 mb-6">
      <h3 className="text-sm font-medium text-charcoal mb-2 flex items-center gap-2">
        <Sparkles size={16} className="text-bronze" /> Search synonyms
      </h3>
      <p className="text-sm text-charcoal-muted mb-5 leading-relaxed">
        Readers search with the words they know; the library is written with yours. Each row links a term to the words
        that mean the same thing, in both directions. Changes apply on the next search — no deploy needed.
      </p>

      {status && (
        <p role="status" className="text-xs text-charcoal bg-taupe-light/50 border border-taupe/30 rounded-sm px-3 py-2 mb-4">
          {status}
        </p>
      )}

      {loading ? (
        <div className="space-y-3" aria-hidden="true">
          <div className="skeleton h-10 w-full" />
          <div className="skeleton h-10 w-full" />
          <div className="skeleton h-10 w-2/3" />
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => (
            <div key={row.id} className="flex flex-col sm:flex-row sm:items-center gap-2 border-b border-taupe/20 pb-3">
              <span className="sm:w-40 shrink-0 text-sm text-charcoal font-medium">{row.term}</span>
              <input
                aria-label={`Synonyms for ${row.term}`}
                value={row.synonyms.join(', ')}
                onChange={(event) =>
                  updateRow(row.id, {
                    synonyms: event.target.value.split(',').map((s) => s.trim().toLowerCase()),
                  })
                }
                className="flex-1 min-h-[44px] bg-white border border-taupe/40 px-3 text-sm rounded-sm focus:outline-none focus:border-bronze"
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => saveRow(row)}
                  disabled={savingId === row.id}
                  className="inline-flex items-center gap-1.5 min-h-[44px] px-3 text-xs border border-taupe/40 rounded-sm text-charcoal-muted hover:border-bronze hover:text-bronze disabled:opacity-50"
                >
                  <Save size={13} /> {savingId === row.id ? 'Saving…' : 'Save'}
                </button>
                <button
                  type="button"
                  onClick={() => removeRow(row)}
                  aria-label={`Delete synonym row ${row.term}`}
                  className="inline-flex items-center justify-center w-11 h-11 text-charcoal-muted hover:text-bronze"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-6 pt-5 border-t border-taupe/30">
        <p className="text-xs font-medium text-charcoal mb-3">Add a term</p>
        <div className="grid sm:grid-cols-2 gap-3">
          <input
            aria-label="New term"
            placeholder="term — e.g. azelaic acid"
            value={draft.term}
            onChange={(event) => setDraft((prev) => ({ ...prev, term: event.target.value }))}
            className="min-h-[44px] bg-white border border-taupe/40 px-3 text-sm rounded-sm focus:outline-none focus:border-bronze"
          />
          <input
            aria-label="New synonyms, comma separated"
            placeholder="synonyms, comma separated"
            value={draft.synonyms}
            onChange={(event) => setDraft((prev) => ({ ...prev, synonyms: event.target.value }))}
            className="min-h-[44px] bg-white border border-taupe/40 px-3 text-sm rounded-sm focus:outline-none focus:border-bronze"
          />
        </div>
        <div className="flex items-center gap-3 mt-3">
          <button
            type="button"
            onClick={addRow}
            className="inline-flex items-center gap-2 min-h-[44px] px-4 bg-charcoal text-white text-xs tracking-editorial uppercase rounded-sm hover:bg-bronze transition-colors"
          >
            <Plus size={14} /> Add
          </button>
          <button
            type="button"
            onClick={load}
            className="inline-flex items-center gap-2 min-h-[44px] px-3 text-xs text-charcoal-muted hover:text-bronze"
          >
            <RefreshCw size={13} /> Reload
          </button>
        </div>
      </div>
    </div>
  );
}
