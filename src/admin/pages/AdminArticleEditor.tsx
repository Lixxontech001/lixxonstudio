import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { renderMarkdown } from '../../lib/markdown';
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
  takeaways: string[];
  faq: { q: string; a: string }[];
  alt_title: string;
  series_id: string;
  series_order: string;
  allow_comments: boolean;
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
  takeaways: [],
  faq: [],
  alt_title: '',
  series_id: '',
  series_order: '',
  allow_comments: true,
};

const draftKey = (id: string) => `lx_draft_${id}`;

/** Browser-side image compression (canvas) so uploads stay small on the free Storage tier. */
async function compressImage(file: File, maxW: number, quality: number): Promise<Blob> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif' || file.type === 'image/svg+xml') return file;
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) return file;
  const scale = Math.min(1, maxW / bmp.width);
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
  const blob: Blob | null = await new Promise(res => c.toBlob(res, type, quality));
  return blob && blob.size < file.size ? blob : file;
}

/** Minimal line diff for the version viewer. */
function diffLines(a: string, b: string): { type: 'same' | 'add' | 'del'; text: string }[] {
  const A = a.split('\n'), B = b.split('\n');
  const m = A.length, n = B.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: { type: 'same' | 'add' | 'del'; text: string }[] = [];
  let i = 0, j = 0;
  while (i < m && j < n) {
    if (A[i] === B[j]) { out.push({ type: 'same', text: A[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ type: 'del', text: A[i] }); i++; }
    else { out.push({ type: 'add', text: B[j] }); j++; }
  }
  while (i < m) out.push({ type: 'del', text: A[i++] });
  while (j < n) out.push({ type: 'add', text: B[j++] });
  return out;
}

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
        takeaways: post.takeaways || [],
        faq: Array.isArray(post.faq) ? post.faq : [],
        alt_title: post.alt_title || '',
        series_id: post.series_id || '',
        series_order: post.series_order ? String(post.series_order) : '',
        allow_comments: post.allow_comments !== false,
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

  const update = (field: keyof EditorState, value: EditorState[keyof EditorState]) => {
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
      takeaways: state.takeaways.map(t => t.trim()).filter(Boolean),
      faq: state.faq.filter(f => f.q.trim() && f.a.trim()),
      alt_title: state.alt_title.trim() || null,
      series_id: state.series_id || null,
      series_order: state.series_id && state.series_order ? Number(state.series_order) : null,
      allow_comments: state.allow_comments,
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

    if (savedId) {
      // version history (kept for the diff view); ignore failures silently
      await supabase.from('article_versions').insert({ post_id: savedId, title: payload.title, content: payload.content, excerpt: payload.excerpt, saved_by: 'editor' }).then(() => undefined, () => undefined);
      localStorage.removeItem(draftKey(savedId));
    }
    setSavedMsg('Saved successfully');
    setSaving(false);
    setTimeout(() => setSavedMsg(null), 3000);
  }, [state, currentPostId, relatedIds]);

  // ---- local autosave (every 5s of inactivity) + recovery prompt
  const [recoverable, setRecoverable] = useState<EditorState | null>(null);
  useEffect(() => {
    const k = draftKey(currentPostId || 'new');
    const t = setTimeout(() => { if (state.title || state.content) localStorage.setItem(k, JSON.stringify({ state, t: Date.now() })); }, 5000);
    return () => clearTimeout(t);
  }, [state, currentPostId]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(draftKey(currentPostId || 'new'));
      if (!raw) return;
      const d = JSON.parse(raw) as { state: EditorState; t: number };
      if (Date.now() - d.t < 7 * 864e5 && (d.state.content !== (post?.content || '') || d.state.title !== (post?.title || ''))) setRecoverable(d.state);
    } catch { /* ignore */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post?.id]);

  // ---- series list for the sidebar
  const [seriesList, setSeriesList] = useState<{ id: string; title: string }[]>([]);
  useEffect(() => { supabase.from('article_series').select('id, title').order('title').then(({ data }) => setSeriesList((data || []) as { id: string; title: string }[])); }, []);

  // ---- version history
  const [versions, setVersions] = useState<{ id: string; title: string; content: string | null; saved_at: string }[]>([]);
  const [diffVersion, setDiffVersion] = useState<{ title: string; content: string | null; saved_at: string } | null>(null);
  useEffect(() => { if (currentPostId) supabase.from('article_versions').select('id, title, content, saved_at').eq('post_id', currentPostId).order('saved_at', { ascending: false }).limit(20).then(({ data }) => setVersions((data || []) as typeof versions)); }, [currentPostId, savedMsg]);

  // ---- paste / drop an image → compress in-browser → upload to Storage → insert markdown
  const uploadImage = useCallback(async (file: File) => {
    const blob = await compressImage(file, 1600, 0.82);
    const ext = blob.type === 'image/png' ? 'png' : 'jpg';
    const path = `articles/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error: upErr } = await supabase.storage.from('media').upload(path, blob, { contentType: blob.type, cacheControl: '31536000' });
    if (upErr) { setError(`Image upload failed: ${upErr.message}`); return; }
    const { data: urlData } = supabase.storage.from('media').getPublicUrl(path);
    const alt = window.prompt('Alt text for this image (required for accessibility):', file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ')) || 'Image';
    await supabase.from('media').insert({ url: urlData.publicUrl, alt_text: alt, file_name: file.name, title: alt }).then(() => undefined, () => undefined);
    const el = document.getElementById('content-editor') as HTMLTextAreaElement | null;
    const md = `\n![${alt}](${urlData.publicUrl})\n`;
    if (el) { const start = el.selectionStart; setState(prev => ({ ...prev, content: prev.content.slice(0, start) + md + prev.content.slice(el.selectionEnd) })); }
    else setState(prev => ({ ...prev, content: prev.content + md }));
  }, []);
  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => { const f = Array.from(e.clipboardData.files).find(x => x.type.startsWith('image/')); if (f) { e.preventDefault(); uploadImage(f); } };
  const onDrop = (e: React.DragEvent<HTMLTextAreaElement>) => { const f = Array.from(e.dataTransfer.files).find(x => x.type.startsWith('image/')); if (f) { e.preventDefault(); uploadImage(f); } };

  const [headlineStats, setHeadlineStats] = useState<{ a: { impressions: number; clicks: number }; b: { impressions: number; clicks: number } } | null>(null);
  useEffect(() => {
    if (!currentPostId || !state.alt_title) { setHeadlineStats(null); return; }
    supabase.from('headline_variants').select('variant, impressions, clicks').eq('post_id', currentPostId).then(({ data }) => {
      const z = { impressions: 0, clicks: 0 };
      const m = { a: { ...z }, b: { ...z } };
      (data || []).forEach((r: { variant: 'a' | 'b'; impressions: number; clicks: number }) => { m[r.variant] = { impressions: r.impressions, clicks: r.clicks }; });
      setHeadlineStats(m);
    });
  }, [currentPostId, state.alt_title, savedMsg]);
  const pct = (v: { impressions: number; clicks: number }) => v.impressions ? `${Math.round((v.clicks / v.impressions) * 100)}%` : '–';

  const renderPreview = (content: string) => renderMarkdown(content);

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
      {recoverable && (
        <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded text-sm text-amber-900 flex flex-wrap items-center gap-3">
          <span>An unsaved draft of this article was found on this device.</span>
          <button onClick={() => { setState(recoverable); setRecoverable(null); }} className="px-3 py-1.5 bg-amber-600 text-white rounded text-xs">Restore draft</button>
          <button onClick={() => { localStorage.removeItem(draftKey(currentPostId || 'new')); setRecoverable(null); }} className="px-3 py-1.5 border border-amber-300 rounded text-xs">Discard</button>
        </div>
      )}
      {diffVersion && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setDiffVersion(null)}>
          <div className="bg-white rounded-lg w-full max-w-4xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-gray-200 flex items-center justify-between"><h3 className="text-sm font-medium">Changes since {new Date(diffVersion.saved_at).toLocaleString()} → current editor</h3><button onClick={() => setDiffVersion(null)} className="text-gray-400 hover:text-gray-700 text-sm">Close</button></div>
            <pre className="p-4 overflow-auto text-xs font-mono leading-relaxed whitespace-pre-wrap">{diffLines(diffVersion.content || '', state.content).map((l, i) => <div key={i} className={l.type === 'add' ? 'bg-green-50 text-green-800' : l.type === 'del' ? 'bg-red-50 text-red-800 line-through' : 'text-gray-600'}>{l.type === 'add' ? '+ ' : l.type === 'del' ? '− ' : '  '}{l.text}</div>)}</pre>
          </div>
        </div>
      )}
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
                onPaste={onPaste}
                onDrop={onDrop}
                placeholder="Start writing your article... (paste or drop images to upload them) Use markdown syntax. # for headings, ** for bold, - for lists, > for quotes, ![alt](url) for images, [text](url) for links."
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

          {/* Reader features */}
          <div className="bg-white border border-gray-200 rounded-lg p-5 space-y-4">
            <h3 className="text-sm font-medium text-gray-900">Reader features</h3>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Key takeaways (one per line)</label>
              <textarea value={state.takeaways.join('\n')} onChange={e => update('takeaways', e.target.value.split('\n'))} rows={3} placeholder="Shown in a box above the article" className="w-full border border-gray-200 px-3 py-2 rounded text-sm focus:outline-none focus:border-bronze" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">FAQ (rendered + FAQPage schema)</label>
              {state.faq.map((f, i) => (
                <div key={i} className="mb-2 p-2 border border-gray-100 rounded">
                  <input value={f.q} onChange={e => update('faq', state.faq.map((x, k) => k === i ? { ...x, q: e.target.value } : x))} placeholder="Question" className="w-full border border-gray-200 px-2 py-1.5 rounded text-sm mb-1 focus:outline-none focus:border-bronze" />
                  <textarea value={f.a} onChange={e => update('faq', state.faq.map((x, k) => k === i ? { ...x, a: e.target.value } : x))} placeholder="Answer" rows={2} className="w-full border border-gray-200 px-2 py-1.5 rounded text-sm focus:outline-none focus:border-bronze" />
                  <button type="button" onClick={() => update('faq', state.faq.filter((_, k) => k !== i))} className="text-xs text-red-500 mt-1">Remove</button>
                </div>
              ))}
              <button type="button" onClick={() => update('faq', [...state.faq, { q: '', a: '' }])} className="text-xs text-bronze hover:underline">+ Add question</button>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Alternative headline (A/B test)</label>
              <input value={state.alt_title} onChange={e => update('alt_title', e.target.value)} placeholder="Half of readers see this title instead" className="w-full border border-gray-200 px-3 py-2 rounded text-sm focus:outline-none focus:border-bronze" />
              {headlineStats && <p className="text-[11px] text-gray-500 mt-1">A: {headlineStats.a.clicks}/{headlineStats.a.impressions} ({pct(headlineStats.a)}) · B: {headlineStats.b.clicks}/{headlineStats.b.impressions} ({pct(headlineStats.b)})</p>}
            </div>
            <div className="grid grid-cols-[1fr,70px] gap-2">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Series</label>
                <select value={state.series_id} onChange={e => update('series_id', e.target.value)} className="w-full border border-gray-200 px-3 py-2 rounded text-sm bg-white focus:outline-none focus:border-bronze"><option value="">None</option>{seriesList.map(x => <option key={x.id} value={x.id}>{x.title}</option>)}</select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Part</label>
                <input type="number" min={1} value={state.series_order} onChange={e => update('series_order', e.target.value)} className="w-full border border-gray-200 px-3 py-2 rounded text-sm focus:outline-none focus:border-bronze" />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={state.allow_comments} onChange={e => update('allow_comments', e.target.checked)} /> Allow comments</label>
          </div>

          {/* Version history */}
          {versions.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-lg p-5">
              <h3 className="text-sm font-medium text-gray-900 mb-3">Version history</h3>
              <ul className="space-y-1 max-h-40 overflow-y-auto text-xs">
                {versions.map(v => <li key={v.id} className="flex items-center justify-between gap-2"><span className="text-gray-500">{new Date(v.saved_at).toLocaleString()}</span><span className="flex gap-2"><button type="button" onClick={() => setDiffVersion(v)} className="text-bronze hover:underline">Diff</button><button type="button" onClick={() => { if (confirm('Restore this version into the editor? (Not saved until you click Save)')) setState(p => ({ ...p, title: v.title, content: v.content || '' })); }} className="text-gray-500 hover:text-charcoal">Restore</button></span></li>)}
              </ul>
            </div>
          )}

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
