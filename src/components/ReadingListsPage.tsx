import { useEffect, useState } from 'react';
import { List, Trash2, Clock, ArrowRight, Plus, X } from 'lucide-react';
import { Link } from '../context/NavigationContext';
import { useReadingLists, useReadingListItems } from '../hooks/usePlatform';
import { useToast } from '../context/ToastContext';
import { Helmet } from 'react-helmet-async';
import EmptyState from './EmptyState';

export default function ReadingListsPage() {
  const { lists, createList, deleteList, loading } = useReadingLists();
  const { showToast } = useToast();
  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const [newListName, setNewListName] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => { window.scrollTo(0, 0); }, []);

  const selectedList = lists.find(l => l.id === selectedListId);

  const handleCreate = async () => {
    if (!newListName.trim()) return;
    const result = await createList(newListName.trim());
    if (result) {
      setNewListName('');
      setShowCreate(false);
      setSelectedListId(result.id);
      showToast('Reading list created', 'success');
    }
  };

  const handleDelete = async (id: string, name: string) => {
    await deleteList(id);
    if (selectedListId === id) setSelectedListId(null);
    showToast(`Deleted "${name}"`, 'info');
  };

  return (
    <main className="container-wide py-12 md:py-16">
      <Helmet>
        <title>Reading Lists | Lixxon Studio</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>

      <div className="flex items-start justify-between mb-10 flex-wrap gap-4">
        <div>
          <p className="text-[10px] tracking-ultra-wide uppercase text-bronze mb-3">Your Collections</p>
          <h1 className="font-serif text-3xl md:text-5xl text-charcoal font-light">Reading Lists</h1>
          <p className="text-charcoal-muted text-base mt-3 max-w-md">Create themed collections of articles to revisit and organize.</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-charcoal text-white text-xs tracking-editorial uppercase font-medium rounded-sm hover:bg-bronze transition-all"
        >
          <Plus size={14} /> New List
        </button>
      </div>

      {showCreate && (
        <div className="flex gap-2 mb-6 max-w-md animate-fade-up">
          <input
            type="text"
            value={newListName}
            onChange={e => setNewListName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setShowCreate(false); }}
            placeholder="List name (e.g., 'Morning Reads')"
            autoFocus
            className="flex-1 border border-taupe/50 px-3 py-2.5 text-sm rounded-sm focus:outline-none focus:border-bronze"
          />
          <button onClick={handleCreate} className="px-4 py-2.5 bg-bronze text-white text-sm rounded-sm hover:bg-bronze-dark transition-all">Create</button>
          <button onClick={() => setShowCreate(false)} className="px-3 py-2.5 text-charcoal-muted hover:text-charcoal"><X size={16} /></button>
        </div>
      )}

      {loading ? (
        <div className="text-charcoal-muted text-sm">Loading...</div>
      ) : lists.length === 0 ? (
        <EmptyState message="No reading lists yet. Create one to start organizing articles." />
      ) : selectedList ? (
        <ReadingListDetail listId={selectedList.id} listName={selectedList.name} onBack={() => setSelectedListId(null)} />
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 max-w-5xl">
          {lists.map(list => (
            <div key={list.id} className="group bg-white border border-taupe/30 rounded-sm p-6 luxury-shadow hover:luxury-shadow-lg transition-all duration-300">
              <div className="flex items-start justify-between mb-4">
                <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-bronze/10">
                  <List size={16} className="text-bronze" />
                </div>
                <button
                  onClick={() => handleDelete(list.id, list.name)}
                  className="text-charcoal-muted/40 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                  aria-label="Delete list"
                >
                  <Trash2 size={14} />
                </button>
              </div>
              <button onClick={() => setSelectedListId(list.id)} className="text-left w-full">
                <h3 className="font-serif text-lg text-charcoal group-hover:text-bronze transition-colors">{list.name}</h3>
                {list.description && <p className="text-sm text-charcoal-muted mt-1 line-clamp-2">{list.description}</p>}
                <p className="text-xs text-charcoal-muted mt-3">{new Date(list.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</p>
              </button>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}

function ReadingListDetail({ listId, listName, onBack }: { listId: string; listName: string; onBack: () => void }) {
  const { items, loading, removePost } = useReadingListItems(listId);

  return (
    <div>
      <button onClick={onBack} className="inline-flex items-center gap-2 text-xs text-charcoal-muted hover:text-bronze transition-colors mb-6">
        <ArrowRight size={14} className="rotate-180" /> Back to lists
      </button>
      <h2 className="font-serif text-2xl text-charcoal mb-6">{listName}</h2>

      {loading ? (
        <div className="text-charcoal-muted text-sm">Loading...</div>
      ) : items.length === 0 ? (
        <EmptyState message="This list is empty. Save articles from any article page." />
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-8 max-w-5xl">
          {items.map(item => (
            <div key={item.id} className="group relative">
              <Link to={{ name: 'article', slug: item.post.slug }} className="flex flex-col">
                <div className="img-zoom rounded-sm overflow-hidden luxury-shadow aspect-[4/5] bg-taupe-light mb-3">
                  {item.post.cover_image && <img src={item.post.cover_image} alt={item.post.title} className="w-full h-full object-cover" loading="lazy" />}
                </div>
                <h3 className="font-serif text-base text-charcoal leading-snug group-hover:text-bronze transition-colors line-clamp-2">{item.post.title}</h3>
                <div className="flex items-center gap-2 mt-2 text-xs text-charcoal-muted">
                  <Clock size={10} strokeWidth={1.5} /> {item.post.reading_time_minutes} min read
                </div>
              </Link>
              <button
                onClick={() => removePost(item.id)}
                className="absolute top-2 right-2 w-8 h-8 rounded-full bg-white/80 backdrop-blur flex items-center justify-center text-charcoal-muted hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                aria-label="Remove from list"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
