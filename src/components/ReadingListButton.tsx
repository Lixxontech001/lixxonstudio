import { useState } from 'react';
import {BookmarkPlus, List, X, Plus} from 'lucide-react';

import { getFingerprint, useReadingLists } from '../hooks/usePlatform';
import { useToast } from '../context/ToastContext';
import { supabase } from '../lib/supabaseClient';

export default function ReadingListButton({ postId }: { postId: string }) {
  const { lists, createList, refetch } = useReadingLists();
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [newListName, setNewListName] = useState('');
  const [saving, setSaving] = useState(false);

  const togglePostInList = async (listId: string, listName: string) => {
    const { data: existing } = await supabase
      .from('reading_list_items')
      .select('id')
      .eq('list_id', listId)
      .eq('post_id', postId)
      .maybeSingle();

    if (existing) {
      await supabase.rpc('delete_reading_list_item', { p_item_id: existing.id, p_fingerprint: getFingerprint() });
      showToast(`Removed from "${listName}"`, 'info');
    } else {
      const { count } = await supabase.from('reading_list_items').select('*', { count: 'exact', head: true }).eq('list_id', listId);
      await supabase.from('reading_list_items').insert({ list_id: listId, post_id: postId, sort_order: count || 0 });
      showToast(`Added to "${listName}"`, 'success');
    }
  };

  const handleCreate = async () => {
    if (!newListName.trim()) return;
    setSaving(true);
    const result = await createList(newListName.trim());
    setSaving(false);
    if (result) {
      setNewListName('');
      await refetch();
      showToast('Reading list created', 'success');
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 px-5 py-3 border border-taupe rounded-sm text-charcoal text-sm hover:border-bronze transition-all"
        aria-label="Save to reading list"
      >
        <BookmarkPlus size={16} strokeWidth={1.5} /> Save to List
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 animate-fade-in" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-sm max-w-md w-full mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-taupe/30">
              <h3 className="font-serif text-lg text-charcoal flex items-center gap-2">
                <List size={18} /> Reading Lists
              </h3>
              <button onClick={() => setOpen(false)} className="text-charcoal-muted hover:text-charcoal" aria-label="Close">
                <X size={18} />
              </button>
            </div>
            <div className="p-5">
              {lists.length > 0 ? (
                <div className="space-y-2 mb-4">
                  {lists.map(list => (
                    <button
                      key={list.id}
                      onClick={() => { togglePostInList(list.id, list.name); }}
                      className="w-full text-left flex items-center gap-3 px-3 py-2.5 border border-taupe/40 rounded-sm hover:border-bronze hover:bg-bronze/5 transition-all"
                    >
                      <Plus size={14} className="text-bronze flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-charcoal font-medium truncate">{list.name}</p>
                        {list.description && <p className="text-xs text-charcoal-muted truncate">{list.description}</p>}
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-charcoal-muted text-center py-4">No reading lists yet. Create one below.</p>
              )}

              <div className="flex gap-2 border-t border-taupe/30 pt-4">
                <input
                  type="text"
                  value={newListName}
                  onChange={e => setNewListName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleCreate(); } }}
                  placeholder="New list name..."
                  className="flex-1 border border-taupe/50 px-3 py-2 text-sm rounded-sm focus:outline-none focus:border-bronze"
                />
                <button
                  onClick={handleCreate}
                  disabled={saving || !newListName.trim()}
                  className="px-4 py-2 bg-charcoal text-white text-sm rounded-sm hover:bg-bronze transition-all disabled:opacity-50"
                >
                  Create
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
