import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useCategories, useAdminPost, useAdminAuthors, useAdminMedia } from '../../hooks/useSupabase';
import { useContentTemplates, suggestTags } from '../../hooks/usePlatform';
import { useNavigation } from '../../context/NavigationContext';
import {
  Bold, Italic, Heading1, Heading2, Heading3, List, ListOrdered,
  Quote, Link2, Image as ImageIcon, Minus, Save, Eye, Code,
  FileText, Tag, Star, Sparkles, ArrowLeft, Check, X, Lightbulb, FileCode
} from 'lucide-react';
import type { PostStatus } from '../../lib/types';

interface AdminArticleEditorProps {
  postId?: string;
  isNew?: boolean;
}

interface EditorState {
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  cover_image: string;
  cover_image_alt: string;
  category_id: string;
  author_id: string;
  tags: string[];
  status: PostStatus;
  published_at: string;
  scheduled_at: string;
  seo_title: string;
  seo_description: string;
  canonical_url: string;
  featured: boolean;
  editors_pick: boolean;
}

const DEFAULT_STATE: EditorState = {
  title: '',
  slug: '',
  excerpt: '',
  content: '',
  cover_image: '',
  cover_image_alt: '',
  category_id: '',
  author_id: '',
  tags: [],
  status: 'draft',
  published_at: new Date().toISOString().slice(0, 16),
  scheduled_at: '',
  seo_title: '',
  seo_description: '',
  canonical_url: '',
  featured: false,
  editors_pick: false,
};

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function calculateReadingTime(content: string): number {
  const words = content.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 200));
}

type MediaPickerMode = 'cover' | 'inline' | null;

export default function AdminArticleEditor({ postId, isNew }: AdminArticleEditorProps) {
  const { navigate } = useNavigation();
  const { categories } = useCategories();
  const { authors } = useAdminAuthors();
  const { media } = useAdminMedia();
  const { post, loading } = useAdminPost(postId || null);

  const [state, setState] = useState<EditorState>(DEFAULT_STATE);
  const [tagInput, setTagInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mediaPickerMode, setMediaPickerMode] = useState<MediaPickerMode>(null);
  const [mediaSearch, setMediaSearch] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const [currentPostId, setCurrentPostId] = useState<string | null>(postId || null);
  const [relatedIds, setRelatedIds] = useState<string[]>([]);
  const { templates } = useContentTemplates();
  const tagSuggestions = useMemo(() => suggestTags(state.content + ' ' + state.title, state.tags), [state.content, state.title, state.tags]);
  const [showTemplates, setShowTemplates] = useState(false);

  useEffect(() => {
    if (post) {
      setState({
        title: post.title || '',
        slug: post.slug || '',
        excerpt: post.excerpt || '',
        content: post.content || '',
        cover_image: post.cover_image || '',
        cover_image_alt: post.cover_image_alt || '',
        category_id: post.category_id || '',
        author_id: post.author_id || '',
        tags: post.tags || [],
        status: post.status || 'draft',
        published_at: post.published_at ? new Date(post.published_at).toISOString().slice(0, 16) : new Date().toISOString().slice(0, 16),
        scheduled_at: post.scheduled_at ? new Date(post.scheduled_at).toISOString().slice(0, 16) : '',
        seo_title: post.seo_title || '',
        seo_description: post.seo_description || '',
        canonical_url: post.canonical_url || '',
        featured: post.featured || false,
        editors_pick: post.editors_pick || false,
      });
    }
  }, [post]);

  useEffect(() => {
    if (currentPostId) {
      supabase.from('related_articles').select('related_post_id').eq('post_id', currentPostId).order('sort_order')
        .then(({ data }) => {
          if (data) setRelatedIds(data.map(r => r.related_post_id));
        });
    }
  }, [currentPostId]);

  const update = (field: keyof EditorState, value: string | boolean | string[]) => {
    setState(prev => ({ ...prev, [field]: value }));
  };

  const stats = useMemo(() => {
    const text = state.content.trim();
    const words = text ? text.split(/\s+/).filter(Boolean).length : 0;
    const chars = state.content.length;
    const paragraphs = text ? text.split(/\n\n+/).filter(p => p.trim()).length : 0;
    const sentences = text ? (text.match(/[.!?]+/g) || []).length : 0;
    const headings = (state.content.match(/^#{1,3}\s/gm) || []).length;
    const readingTime = calculateReadingTime(state.content);
    return { words, chars, paragraphs, sentences, headings, readingTime };
  }, [state.content]);

  const headingStructure = useMemo(() => {
    return state.content.split('\n')
      .filter(l => l.trim().startsWith('#'))
      .map(l => {
        const level = (l.trim().match(/^#+/) || [''])[0].length;
        const text = l.trim().replace(/^#+\s/, '');
        return { level, text };
      });
  }, [state.content]);

  const addTag = () => {
    const tag = tagInput.trim().toLowerCase();
    if (tag && !state.tags.includes(tag)) {
      update('tags', [...state.tags, tag]);
    }
    setTagInput('');
  };

  const removeTag = (tag: string) => {
    update('tags', state.tags.filter(t => t !== tag));
  };

  const insertText = (before: string, after: string = '') => {
    const textarea = document.getElementById('content-editor') as HTMLTextAreaElement;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = state.content.substring(start, end);
    const newText = state.content.substring(0, start) + before + selected + after + state.content.substring(end);
    update('content', newText);
    textarea.focus();
    setTimeout(() => {
      textarea.setSelectionRange(start + before.length, end + before.length);
    }, 0);
  };

  const insertLinePrefix = (prefix: string) => {
    const textarea = document.getElementById('content-editor') as HTMLTextAreaElement;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const lineStart = state.content.lastIndexOf('\n', start - 1) + 1;
    const newText = state.content.substring(0, lineStart) + prefix + state.content.substring(lineStart);
    update('content', newText);
    textarea.focus();
    setTimeout(() => {
      textarea.setSelectionRange(start + prefix.length, start + prefix.length);
    }, 0);
  };

  const insertLink = () => {
    const url = prompt('Enter URL:', 'https://');
    if (!url) return;
    const textarea = document.getElementById('content-editor') as HTMLTextAreaElement;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = state.content.substring(start, end) || 'link text';
    const newText = state.content.substring(0, start) + `[${selected}](${url})` + state.content.substring(end);
    update('content', newText);
    textarea.focus();
    setTimeout(() => {
      textarea.setSelectionRange(start + 1, start + 1 + selected.length);
    }, 0);
  };

  const insertImage = (url: string, alt: string = '') => {
    if (mediaPickerMode === 'cover') {
      update('cover_image', url);
      if (alt && !state.cover_image_alt) {
        update('cover_image_alt', alt);
      }
      setMediaPickerMode(null);
      return;
    }
    const textarea = document.getElementById('content-editor') as HTMLTextAreaElement;
    if (!textarea) {
      update('content', state.content + `\n\n![${alt}](${url})\n\n`);
      setMediaPickerMode(null);
      return;
    }
    const start = textarea.selectionStart;
    const insertText = `\n\n![${alt}](${url})\n\n`;
    const newText = state.content.substring(0, start) + insertText + state.content.substring(start);
    update('content', newText);
    setMediaPickerMode(null);
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + insertText.length, start + insertText.length);
    }, 0);
  };

  const save = useCallback(async (newStatus?: PostStatus) => {
    setSaving(true);
    setError(null);

    if (!state.title.trim()) {
      setError('Title is required');
      setSaving(false);
      return;
    }

    const slug = state.slug.trim() || slugify(state.title);
    const status = newStatus || state.status;
    const publishedAt = status === 'scheduled' && state.scheduled_at
      ? new Date(state.scheduled_at).toISOString()
      : new Date(state.published_at).toISOString();

    const payload = {
      title: state.title.trim(),
      slug,
      excerpt: state.excerpt || null,
      content: state.content || null,
      cover_image: state.cover_image || null,
      cover_image_alt: state.cover_image_alt || null,
      category_id: state.category_id || null,
      author_id: state.author_id || null,
      tags: state.tags,
      status,
      published_at: publishedAt,
      scheduled_at: status === 'scheduled' && state.scheduled_at ? new Date(state.scheduled_at).toISOString() : null,
      seo_title: state.seo_title || null,
      seo_description: state.seo_description || null,
      canonical_url: state.canonical_url || null,
      featured: state.featured,
      editors_pick: state.editors_pick,
      reading_time_minutes: calculateReadingTime(state.content),
    };

    let savedId = currentPostId;

    if (savedId) {
      const { error } = await supabase.from('posts').update(payload).eq('id', savedId);
      if (error) { setError(error.message); setSaving(false); return; }
    } else {
      const { data, error } = await supabase.from('posts').insert(payload).select().single();
      if (error) { setError(error.message); setSaving(false); return; }
      savedId = data.id;
      setCurrentPostId(savedId);
    }

    if (savedId && relatedIds.length > 0) {
      await supabase.from('related_articles').delete().eq('post_id', savedId);
      const rows = relatedIds.map((rid, i) => ({
        post_id: savedId,
        related_post_id: rid,
        sort_order: i,
      }));
      await supabase.from('related_articles').insert(rows);
    }

    setSavedMsg('Saved successfully');
    setSaving(false);
    setTimeout(() => setSavedMsg(null), 3000);
  }, [state, currentPostId, relatedIds]);

  const renderPreview = (content: string) => {
    const lines = content.split('\n');
    const html: string[] = [];
    let inUl = false, inOl = false;
    const closeLists = () => {
      if (inUl) { html.push('</ul>'); inUl = false; }
      if (inOl) { html.push('</ol>'); inOl = false; }
    };
    const inline = (text: string): string =>
      text.replace(/!\[(.+?)\]\((.+?)\)/g, '<img src="$2" alt="$1" class="rounded my-4 w-full" />')
          .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
          .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
          .replace(/\*(.+?)\*/g, '<em>$1</em>')
          .replace(/`(.+?)`/g, '<code>$1</code>');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) { closeLists(); continue; }
      if (trimmed.startsWith('# ')) { closeLists(); html.push(`<h1 class="font-serif text-3xl text-gray-900 mt-8 mb-4">${inline(trimmed.slice(2))}</h1>`); }
      else if (trimmed.startsWith('## ')) { closeLists(); html.push(`<h2 class="font-serif text-2xl text-gray-900 mt-6 mb-3">${inline(trimmed.slice(3))}</h2>`); }
      else if (trimmed.startsWith('### ')) { closeLists(); html.push(`<h3 class="font-serif text-xl text-gray-800 mt-5 mb-2">${inline(trimmed.slice(4))}</h3>`); }
      else if (trimmed.startsWith('> ')) { closeLists(); html.push(`<blockquote class="border-l-4 border-bronze pl-4 italic text-gray-700 my-4">${inline(trimmed.slice(2))}</blockquote>`); }
      else if (trimmed.startsWith('---')) { closeLists(); html.push('<hr class="border-gray-200 my-6" />'); }
      else if (/^\d+\.\s/.test(trimmed)) {
        if (inUl) { html.push('</ul>'); inUl = false; }
        if (!inOl) { html.push('<ol class="list-decimal pl-6 my-4 space-y-1">'); inOl = true; }
        html.push(`<li>${inline(trimmed.replace(/^\d+\.\s/, ''))}</li>`);
      } else if (trimmed.startsWith('- ')) {
        if (inOl) { html.push('</ol>'); inOl = false; }
        if (!inUl) { html.push('<ul class="list-disc pl-6 my-4 space-y-1">'); inUl = true; }
        html.push(`<li>${inline(trimmed.slice(2))}</li>`);
      } else {
        closeLists();
        html.push(`<p class="text-gray-700 leading-relaxed my-3">${inline(trimmed)}</p>`);
      }
    }
    closeLists();
    return html.join('');
  };

  if (loading && !isNew) {
    return <div className="text-gray-400 text-sm">Loading article...</div>;
  }

  const toolbarButtons = [
    { icon: Heading1, title: 'Heading 1', onClick: () => insertLinePrefix('# ') },
    { icon: Heading2, title: 'Heading 2', onClick: () => insertLinePrefix('## ') },
    { icon: Heading3, title: 'Heading 3', onClick: () => insertLinePrefix('### ') },
    { icon: Bold, title: 'Bold', onClick: () => insertText('**', '**') },
    { icon: Italic, title: 'Italic', onClick: () => insertText('*', '*') },
    { icon: List, title: 'Bullet List', onClick: () => insertLinePrefix('- ') },
    { icon: ListOrdered, title: 'Numbered List', onClick: () => insertLinePrefix('1. ') },
    { icon: Quote, title: 'Blockquote', onClick: () => insertLinePrefix('> ') },
    { icon: Link2, title: 'Insert Link', onClick: insertLink },
    { icon: ImageIcon, title: 'Insert Image', onClick: () => setMediaPickerMode('inline') },
    { icon: Minus, title: 'Divider', onClick: () => insertText('\n---\n') },
  ];

  const filteredMedia = media.filter(item =>
    !mediaSearch ||
    (item.alt_text || '').toLowerCase().includes(mediaSearch.toLowerCase()) ||
    (item.title || '').toLowerCase().includes(mediaSearch.toLowerCase()) ||
    (item.file_name || '').toLowerCase().includes(mediaSearch.toLowerCase())
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate({ name: 'admin-articles' })} className="text-gray-500 hover:text-gray-700" aria-label="Back to articles">
            <ArrowLeft size={20} />
          </button>
          <h1 className="font-serif text-2xl text-gray-900">{isNew ? 'New Article' : 'Edit Article'}</h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {savedMsg && <span className="text-sm text-green-600 flex items-center gap-1 animate-fade-in"><Check size={14} /> {savedMsg}</span>}
          {error && <span className="text-sm text-red-600 animate-fade-in">{error}</span>}
          <button
            onClick={() => setShowPreview(!showPreview)}
            className="inline-flex items-center gap-2 border border-gray-200 px-4 py-2 rounded text-sm hover:bg-gray-50 transition-colors"
          >
            <Eye size={15} /> {showPreview ? 'Edit' : 'Preview'}
          </button>
          <button
            onClick={() => save('draft')}
            disabled={saving}
            className="inline-flex items-center gap-2 border border-gray-200 px-4 py-2 rounded text-sm hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            <Save size={15} /> Save Draft
          </button>
          <button
            onClick={() => save('published')}
            disabled={saving}
            className="inline-flex items-center gap-2 bg-bronze text-white px-4 py-2 rounded text-sm hover:bg-bronze-dark disabled:opacity-50 transition-colors"
          >
            <Check size={15} /> Publish
          </button>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Main editor */}
        <div className="lg:col-span-2 space-y-5">
          {showPreview ? (
            <div className="bg-white border border-gray-200 rounded-lg p-6 md:p-8">
              <h1 className="font-serif text-3xl text-gray-900 mb-4">{state.title || 'Untitled'}</h1>
              {state.excerpt && <p className="text-gray-600 italic text-lg mb-6">{state.excerpt}</p>}
              {state.cover_image && <img src={state.cover_image} alt={state.cover_image_alt || ''} className="w-full rounded mb-6" />}
              <div className="prose max-w-none" dangerouslySetInnerHTML={{ __html: renderPreview(state.content) }} />
            </div>
          ) : (
            <>
              <input
                type="text"
                value={state.title}
                onChange={e => {
                  update('title', e.target.value);
                  if (!currentPostId) update('slug', slugify(e.target.value));
                }}
                placeholder="Article title..."
                className="w-full bg-white border border-gray-200 px-4 py-3 rounded text-lg font-serif text-gray-900 focus:outline-none focus:border-bronze focus:ring-1 focus:ring-bronze/30 transition-colors"
              />

              <div className="flex gap-3">
                <div className="flex-1">
                  <label htmlFor="slug-input" className="block text-xs text-gray-500 mb-1 tracking-wider uppercase">Slug</label>
                  <input
                    id="slug-input"
                    type="text"
                    value={state.slug}
                    onChange={e => update('slug', slugify(e.target.value))}
                    placeholder="article-url-slug"
                    className="w-full bg-white border border-gray-200 px-3 py-2.5 rounded text-sm font-mono text-gray-700 focus:outline-none focus:border-bronze focus:ring-1 focus:ring-bronze/30 transition-colors"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="excerpt-input" className="block text-xs text-gray-500 mb-1 tracking-wider uppercase">Excerpt</label>
                <textarea
                  id="excerpt-input"
                  value={state.excerpt}
                  onChange={e => update('excerpt', e.target.value)}
                  placeholder="Brief summary of the article..."
                  rows={2}
                  className="w-full bg-white border border-gray-200 px-3 py-2.5 rounded text-sm text-gray-700 focus:outline-none focus:border-bronze focus:ring-1 focus:ring-bronze/30 transition-colors"
                />
              </div>

              {/* Toolbar */}
              <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-t px-2 py-2 flex-wrap">
                {toolbarButtons.map((btn, i) => {
                  const Icon = btn.icon;
                  return (
                    <button
                      key={i}
                      onClick={btn.onClick}
                      title={btn.title}
                      aria-label={btn.title}
                      className="p-2 text-gray-500 hover:text-bronze hover:bg-gray-50 rounded transition-colors"
                    >
                      <Icon size={16} strokeWidth={1.5} />
                    </button>
                  );
                })}
              </div>
              <textarea
                id="content-editor"
                value={state.content}
                onChange={e => update('content', e.target.value)}
                placeholder="Start writing your article... Use markdown syntax. # for headings, ** for bold, - for lists, > for quotes, ![alt](url) for images, [text](url) for links."
                rows={20}
                className="w-full bg-white border border-gray-200 border-t-0 px-4 py-3 rounded-b text-sm text-gray-700 font-mono leading-relaxed focus:outline-none focus:border-bronze focus:ring-1 focus:ring-bronze/30 transition-colors"
                style={{ minHeight: '400px' }}
              />

              {/* Stats */}
              <div className="flex flex-wrap gap-4 text-xs text-gray-500 bg-gray-50 px-4 py-3 rounded">
                <span><strong className="text-gray-700">{stats.words}</strong> words</span>
                <span><strong className="text-gray-700">{stats.chars}</strong> chars</span>
                <span><strong className="text-gray-700">{stats.paragraphs}</strong> paragraphs</span>
                <span><strong className="text-gray-700">{stats.sentences}</strong> sentences</span>
                <span><strong className="text-gray-700">{stats.headings}</strong> headings</span>
                <span><strong className="text-gray-700">~{stats.readingTime}</strong> min read</span>
              </div>
            </>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-5">
          {/* Publishing */}
          <div className="bg-white border border-gray-200 rounded-lg p-5">
            <h3 className="text-sm font-medium text-gray-900 mb-4 flex items-center gap-2">
              <FileText size={15} /> Publishing
            </h3>
            <div className="space-y-3">
              <div>
                <label htmlFor="status-select" className="block text-xs text-gray-500 mb-1">Status</label>
                <select
                  id="status-select"
                  value={state.status}
                  onChange={e => update('status', e.target.value as PostStatus)}
                  className="w-full border border-gray-200 px-3 py-2 rounded text-sm focus:outline-none focus:border-bronze"
                >
                  <option value="draft">Draft</option>
                  <option value="scheduled">Scheduled</option>
                  <option value="published">Published</option>
                  <option value="archived">Archived</option>
                </select>
              </div>
              <div>
                <label htmlFor="pub-date" className="block text-xs text-gray-500 mb-1">Publication Date</label>
                <input
                  id="pub-date"
                  type="datetime-local"
                  value={state.published_at}
                  onChange={e => update('published_at', e.target.value)}
                  className="w-full border border-gray-200 px-3 py-2 rounded text-sm focus:outline-none focus:border-bronze"
                />
              </div>
              {state.status === 'scheduled' && (
                <div>
                  <label htmlFor="sched-date" className="block text-xs text-gray-500 mb-1">Scheduled For</label>
                  <input
                    id="sched-date"
                    type="datetime-local"
                    value={state.scheduled_at}
                    onChange={e => update('scheduled_at', e.target.value)}
                    className="w-full border border-gray-200 px-3 py-2 rounded text-sm focus:outline-none focus:border-bronze"
                  />
                  <p className="text-xs text-amber-600 mt-1">Article will not appear publicly until this time.</p>
                </div>
              )}
              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={state.featured} onChange={e => update('featured', e.target.checked)} className="rounded" />
                  <Star size={14} className="text-bronze" /> Featured
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={state.editors_pick} onChange={e => update('editors_pick', e.target.checked)} className="rounded" />
                  <Sparkles size={14} className="text-bronze" /> Editor's Pick
                </label>
              </div>
            </div>
          </div>

          {/* Category & Author */}
          <div className="bg-white border border-gray-200 rounded-lg p-5">
            <h3 className="text-sm font-medium text-gray-900 mb-4">Organization</h3>
            <div className="space-y-3">
              <div>
                <label htmlFor="cat-select" className="block text-xs text-gray-500 mb-1">Category</label>
                <select
                  id="cat-select"
                  value={state.category_id}
                  onChange={e => update('category_id', e.target.value)}
                  className="w-full border border-gray-200 px-3 py-2 rounded text-sm focus:outline-none focus:border-bronze"
                >
                  <option value="">Select category...</option>
                  {categories.map(cat => (
                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="author-select" className="block text-xs text-gray-500 mb-1">Author</label>
                <select
                  id="author-select"
                  value={state.author_id}
                  onChange={e => update('author_id', e.target.value)}
                  className="w-full border border-gray-200 px-3 py-2 rounded text-sm focus:outline-none focus:border-bronze"
                >
                  <option value="">Select author...</option>
                  {authors.map(a => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Tags */}
          <div className="bg-white border border-gray-200 rounded-lg p-5">
            <h3 className="text-sm font-medium text-gray-900 mb-4 flex items-center gap-2"><Tag size={15} /> Tags</h3>
            <div className="flex gap-2 mb-3">
              <input
                type="text"
                value={tagInput}
                onChange={e => setTagInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
                placeholder="Add tag..."
                className="flex-1 border border-gray-200 px-3 py-2 rounded text-sm focus:outline-none focus:border-bronze"
              />
              <button onClick={addTag} className="px-3 py-2 bg-gray-100 rounded text-sm hover:bg-gray-200 transition-colors">Add</button>
            </div>
            <div className="flex flex-wrap gap-2 mb-3">
              {state.tags.map(tag => (
                <span key={tag} className="inline-flex items-center gap-1 bg-gray-100 text-gray-700 text-xs px-2.5 py-1 rounded-full">
                  {tag}
                  <button onClick={() => removeTag(tag)} className="text-gray-400 hover:text-red-600 transition-colors" aria-label={`Remove ${tag}`}><X size={12} /></button>
                </span>
              ))}
            </div>
            {tagSuggestions.length > 0 && (
              <div className="border-t border-gray-100 pt-3">
                <p className="text-xs text-gray-400 flex items-center gap-1 mb-2"><Lightbulb size={11} /> Suggested tags</p>
                <div className="flex flex-wrap gap-1.5">
                  {tagSuggestions.map(tag => (
                    <button key={tag} onClick={() => update('tags', [...state.tags, tag])} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full border border-bronze/30 text-bronze hover:bg-bronze/5 transition-all">
                      + {tag}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Content Templates */}
          <div className="bg-white border border-gray-200 rounded-lg p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-gray-900 flex items-center gap-2"><FileCode size={15} /> Templates</h3>
              <button onClick={() => setShowTemplates(!showTemplates)} className="text-xs text-bronze hover:text-bronze-dark">{showTemplates ? 'Hide' : 'Show'}</button>
            </div>
            {showTemplates && templates.length > 0 && (
              <div className="space-y-2">
                {templates.map(t => (
                  <button key={t.id} onClick={() => { if (state.content.trim()) { if (!confirm('Replace current content with template?')) return; } update('content', t.content); setShowTemplates(false); }} className="w-full text-left p-3 border border-gray-200 rounded hover:border-bronze transition-all">
                    <span className="text-sm font-medium text-gray-900">{t.name}</span>
                    {t.description && <p className="text-xs text-gray-400 mt-0.5">{t.description}</p>}
                  </button>
                ))}
              </div>
            )}
            {showTemplates && templates.length === 0 && (
              <p className="text-xs text-gray-400">No templates yet. Create them in Tools {'>'} Content Templates.</p>
            )}
          </div>

          {/* Cover Image */}
          <div className="bg-white border border-gray-200 rounded-lg p-5">
            <h3 className="text-sm font-medium text-gray-900 mb-4 flex items-center gap-2"><ImageIcon size={15} /> Cover Image</h3>
            <input
              type="text"
              value={state.cover_image}
              onChange={e => update('cover_image', e.target.value)}
              placeholder="Image URL or pick from media"
              className="w-full border border-gray-200 px-3 py-2 rounded text-sm mb-2 focus:outline-none focus:border-bronze"
            />
            <input
              type="text"
              value={state.cover_image_alt}
              onChange={e => update('cover_image_alt', e.target.value)}
              placeholder="Alt text for accessibility"
              className="w-full border border-gray-200 px-3 py-2 rounded text-sm mb-3 focus:outline-none focus:border-bronze"
            />
            <button
              onClick={() => setMediaPickerMode('cover')}
              className="w-full inline-flex items-center justify-center gap-2 text-sm text-bronze border border-bronze/30 py-2 rounded hover:bg-bronze/5 transition-colors"
            >
              <ImageIcon size={14} /> Choose from Media Library
            </button>
            {state.cover_image && (
              <div className="mt-3 rounded overflow-hidden border border-gray-200">
                <img src={state.cover_image} alt={state.cover_image_alt || ''} className="w-full" />
              </div>
            )}
          </div>

          {/* SEO */}
          <div className="bg-white border border-gray-200 rounded-lg p-5">
            <h3 className="text-sm font-medium text-gray-900 mb-4">SEO Metadata</h3>
            <div className="space-y-3">
              <div>
                <label htmlFor="seo-title" className="block text-xs text-gray-500 mb-1">SEO Title (optional)</label>
                <input
                  id="seo-title"
                  type="text"
                  value={state.seo_title}
                  onChange={e => update('seo_title', e.target.value)}
                  placeholder="Overrides article title in search results"
                  className="w-full border border-gray-200 px-3 py-2 rounded text-sm focus:outline-none focus:border-bronze"
                />
              </div>
              <div>
                <label htmlFor="seo-desc" className="block text-xs text-gray-500 mb-1">SEO Description</label>
                <textarea
                  id="seo-desc"
                  value={state.seo_description}
                  onChange={e => update('seo_description', e.target.value)}
                  placeholder="Overrides excerpt in search results"
                  rows={2}
                  className="w-full border border-gray-200 px-3 py-2 rounded text-sm focus:outline-none focus:border-bronze"
                />
              </div>
              <div>
                <label htmlFor="canonical-url" className="block text-xs text-gray-500 mb-1">Canonical URL</label>
                <input
                  id="canonical-url"
                  type="text"
                  value={state.canonical_url}
                  onChange={e => update('canonical_url', e.target.value)}
                  placeholder="https://..."
                  className="w-full border border-gray-200 px-3 py-2 rounded text-sm focus:outline-none focus:border-bronze"
                />
              </div>
            </div>
          </div>

          {/* Heading Structure */}
          {!showPreview && headingStructure.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-lg p-5">
              <h3 className="text-sm font-medium text-gray-900 mb-3 flex items-center gap-2"><Code size={15} /> Heading Structure</h3>
              <div className="space-y-1">
                {headingStructure.map((h, i) => (
                  <div key={i} className="text-xs text-gray-600" style={{ paddingLeft: `${(h.level - 1) * 12}px` }}>
                    H{h.level}: {h.text}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Media Picker Modal */}
      {mediaPickerMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 animate-fade-in" onClick={() => setMediaPickerMode(null)}>
          <div className="bg-white rounded-lg max-w-2xl w-full mx-4 max-h-[80vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="font-medium text-gray-900">
                {mediaPickerMode === 'cover' ? 'Select Cover Image' : 'Insert Inline Image'}
              </h3>
              <button onClick={() => setMediaPickerMode(null)} className="text-gray-400 hover:text-gray-600 transition-colors" aria-label="Close media picker"><X size={20} /></button>
            </div>
            <div className="p-4 border-b border-gray-200">
              <input
                type="text"
                value={mediaSearch}
                onChange={e => setMediaSearch(e.target.value)}
                placeholder="Search media by name or alt text..."
                className="w-full border border-gray-200 px-3 py-2 rounded text-sm focus:outline-none focus:border-bronze"
              />
            </div>
            <div className="p-4 overflow-y-auto flex-1">
              {media.length === 0 ? (
                <div className="text-center py-12">
                  <ImageIcon size={32} className="text-gray-300 mx-auto mb-3" />
                  <p className="text-gray-400 text-sm">No media uploaded yet.</p>
                  <p className="text-gray-400 text-xs mt-1">Upload images in the Media section first.</p>
                </div>
              ) : filteredMedia.length === 0 ? (
                <p className="text-gray-400 text-sm text-center py-8">No images match your search.</p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {filteredMedia.map(item => (
                    <button
                      key={item.id}
                      onClick={() => insertImage(item.url, item.alt_text || item.title || '')}
                      className="group relative aspect-square rounded overflow-hidden border-2 border-transparent hover:border-bronze transition-all duration-200"
                      title={item.alt_text || item.title || item.file_name || 'Select image'}
                    >
                      <img src={item.url} alt={item.alt_text || ''} className="w-full h-full object-cover" loading="lazy" />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                        <Check size={20} className="text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
