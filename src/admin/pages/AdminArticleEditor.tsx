import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useCategories, useAdminPost, useAdminAuthors, useAdminMedia } from '../../hooks/useSupabase';
import { useContentTemplates } from '../../hooks/usePlatform';
import {
  extractEditorialKeywords,
  extractKeyTakeaways,
  extractFaqItems,
  cleanMarkdownContent,
  generateSmartExcerpt,
  stripMarkdown,
} from '../../lib/editorialKeywords';
import { useNavigation } from '../../context/NavigationContext';
import { useAuth } from '../../context/AuthContext';
import {
  Save, Eye, EyeOff, Tag, Star, Sparkles, ArrowLeft, Check, Send, ShieldCheck, FolderTree as Archive,
  Lightbulb, FileCode, Clock, CheckCircle2 as Target, Search,
  Image as ImageIcon, History, Info, Send as Rocket, Gauge as Calculator, Bookmark as Pin,
} from 'lucide-react';
import type { PostStatus } from '../../lib/types';
import { optimizeAdminImage } from '../../lib/imageUpload';
import {
  useMarkdownEditor, markdownStats, EditorToolbar, SlashMenu, FindReplaceBar, QualityPanel,
  SearchPreview, SocialCardPreview, CharCount, RevisionPanel, DiffModal, LivePreview,
  AutosaveBadge, SideSection, LinkDialog, MediaPicker, ScoreRing, EDITOR_SHORTCUTS,
  type QualityReport, type QualityIssue, type RevisionRow,
} from '../components/AdminEditorKit';
import GuideLink from '../components/GuideLink';
import AdminImageUploadField from '../components/AdminImageUploadField';

interface AdminArticleEditorProps {
  postId?: string;
  isNew?: boolean;
}

/** Where the guide returns to: this article when it is saved, the list otherwise. */
function guideBackFor(postId?: string): string {
  return postId ? `/admin/articles/edit/${postId}#article-product-slots` : '/admin/articles';
}

type Workflow = 'draft' | 'in_review' | 'approved' | 'scheduled' | 'published' | 'archived';

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
  workflow_status: Workflow;
  published_at: string;
  scheduled_at: string;
  seo_title: string;
  seo_description: string;
  canonical_url: string;
  focus_keyword: string;
  og_title: string;
  og_description: string;
  og_image: string;
  robots: string;
  schema_type: string;
  featured: boolean;
  editors_pick: boolean;
  takeaways: string[];
  faq: { q: string; a: string }[];
  alt_title: string;
  series_id: string;
  series_order: string;
  allow_comments: boolean;
  is_evergreen: boolean;
  pinned_until: string;
  editor_notes: string;
  content_warnings: string[];
  review_note: string;
}

const DEFAULT_STATE: EditorState = {
  title: '', slug: '', excerpt: '', content: '', cover_image: '', cover_image_alt: '',
  category_id: '', author_id: '', tags: [], status: 'draft', workflow_status: 'draft',
  published_at: new Date().toISOString().slice(0, 16), scheduled_at: '', seo_title: '',
  seo_description: '', canonical_url: '', focus_keyword: '', og_title: '', og_description: '',
  og_image: '', robots: 'index,follow', schema_type: 'BlogPosting', featured: false,
  editors_pick: false, takeaways: [], faq: [], alt_title: '', series_id: '', series_order: '',
  allow_comments: true, is_evergreen: false, pinned_until: '', editor_notes: '',
  content_warnings: [], review_note: '',
};

const draftKey = (id: string) => `lx_draft_${id}`;
const AUTOSAVE_MS = 20000;

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

const WORKFLOW: { id: Workflow; label: string }[] = [
  { id: 'draft', label: 'Draft' },
  { id: 'in_review', label: 'In review' },
  { id: 'approved', label: 'Approved' },
  { id: 'scheduled', label: 'Scheduled' },
  { id: 'published', label: 'Published' },
  { id: 'archived', label: 'Archived' },
];

/** The fields the DB scores; sent as one object so the panel and the stored score agree. */
const scoreArgs = (s: EditorState) => ({
  p_title: s.title,
  p_excerpt: s.excerpt,
  p_content: s.content,
  p_focus: s.focus_keyword,
  p_seo_title: s.seo_title,
  p_seo_description: s.seo_description,
  p_cover_image: s.cover_image,
  p_cover_alt: s.cover_image_alt,
});

export default function AdminArticleEditor({ postId, isNew }: AdminArticleEditorProps) {
  const { navigate } = useNavigation();
  const { can } = useAuth();
  const { categories } = useCategories();
  const { authors } = useAdminAuthors();
  const { media } = useAdminMedia();
  const { post, loading } = useAdminPost(postId || null);
  const { templates } = useContentTemplates();

  const [state, setState] = useState<EditorState>(DEFAULT_STATE);
  const [tagInput, setTagInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [autosaving, setAutosaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mediaPickerMode, setMediaPickerMode] = useState<'cover' | 'inline' | 'og' | null>(null);
  const [editorTab, setEditorTab] = useState<'write' | 'preview' | 'split'>('write');
  const [focusMode, setFocusMode] = useState(false);
  const [currentPostId, setCurrentPostId] = useState<string | null>(postId || null);
  const [relatedIds, setRelatedIds] = useState<string[]>([]);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showToc, setShowToc] = useState(false);
  const [report, setReport] = useState<QualityReport | null>(null);
  const [scoring, setScoring] = useState(false);
  const [revisions, setRevisions] = useState<RevisionRow[]>([]);
  const [diff, setDiff] = useState<{ title: string; oldText: string; newText: string } | null>(null);
  const [linkDialog, setLinkDialog] = useState(false);
  const [internalLinks, setInternalLinks] = useState<{ id: string; title: string; url: string }[]>([]);
  const [autosavedAt, setAutosavedAt] = useState<string | null>(null);
  const [autosaveEnabled, setAutosaveEnabled] = useState(true);
  const [lastSavedSnapshot, setLastSavedSnapshot] = useState<string>('');
  const [wordGoal, setWordGoal] = useState(1200);
  const [recoverable, setRecoverable] = useState<EditorState | null>(null);
  const [seriesList, setSeriesList] = useState<{ id: string; title: string }[]>([]);
  const [headlineStats, setHeadlineStats] = useState<{ a: { impressions: number; clicks: number }; b: { impressions: number; clicks: number } } | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const dirty = useMemo(() => JSON.stringify(state) !== lastSavedSnapshot, [state, lastSavedSnapshot]);

  const update = useCallback((field: keyof EditorState, value: EditorState[keyof EditorState]) => {
    setState(prev => ({ ...prev, [field]: value }));
  }, []);

  const editor = useMarkdownEditor({
    value: state.content,
    onChange: next => update('content', next),
    onAction: action => {
      if (action === 'link') openLinkDialog();
      if (action === 'media') setMediaPickerMode('inline');
    },
  });

  const stats = useMemo(() => markdownStats(state.content), [state.content]);
  const headingStructure = useMemo(() => state.content.split('\n')
    .filter(l => l.trim().startsWith('#'))
    .map(l => {
      const level = (l.trim().match(/^#+/) || [''])[0].length;
      return { level, text: l.trim().replace(/^#+\s/, '') };
    }), [state.content]);
  // Sharp keyword & tag extraction
  const keywordAnalysis = useMemo(() => {
    return extractEditorialKeywords(state.content, state.title, state.tags);
  }, [state.content, state.title, state.tags]);

  const tagSuggestions = keywordAnalysis.suggestedTags;

  // Live Focus Keyword Health Diagnostic
  const focusMetrics = useMemo(() => {
    const kw = state.focus_keyword.trim().toLowerCase();
    if (!kw) return null;
    const titleLower = state.title.toLowerCase();
    const contentLower = state.content.toLowerCase();
    const plainText = stripMarkdown(state.content).toLowerCase();
    const words = plainText.split(/\s+/).filter(Boolean);
    const totalWords = Math.max(words.length, 1);

    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = new RegExp(`\\b${escaped}\\b`, 'gi');
    const count = (contentLower.match(rx) || []).length;
    const inTitle = titleLower.includes(kw);
    const inIntro = words.slice(0, 150).join(' ').includes(kw);
    const headings = Array.from(state.content.matchAll(/^#{1,6}\s+(.+)$/gm)).map(m => m[1].toLowerCase());
    const inHeadings = headings.some(h => h.includes(kw));
    const density = Math.round((count / totalWords) * 1000) / 10;

    return {
      count,
      density,
      inTitle,
      inIntro,
      inHeadings,
      optimal: density >= 0.5 && density <= 2.5 && inTitle && inIntro,
    };
  }, [state.focus_keyword, state.title, state.content]);
  const linkSuggestions = useMemo(() => state.content
    .split('\n')
    .flatMap(l => Array.from(l.matchAll(/\]\((\/[^)]+)\)/g)).map(m => m[1]))
    .slice(0, 50), [state.content]);

  // ------------------------------------------------------------------ load
  useEffect(() => {
    if (!post) return;
    const next: EditorState = {
      title: post.title || '',
      slug: post.slug || '',
      excerpt: post.excerpt || '',
      content: post.content || '',
      cover_image: post.cover_image || '',
      cover_image_alt: post.cover_image_alt || '',
      category_id: post.category_id || '',
      author_id: post.author_id || '',
      tags: post.tags || [],
      status: (post.status || 'draft') as PostStatus,
      workflow_status: ((post as { workflow_status?: Workflow }).workflow_status || 'draft') as Workflow,
      published_at: post.published_at ? new Date(post.published_at).toISOString().slice(0, 16) : new Date().toISOString().slice(0, 16),
      scheduled_at: post.scheduled_at ? new Date(post.scheduled_at).toISOString().slice(0, 16) : '',
      seo_title: post.seo_title || '',
      seo_description: post.seo_description || '',
      canonical_url: post.canonical_url || '',
      focus_keyword: (post as { focus_keyword?: string }).focus_keyword || '',
      og_title: (post as { og_title?: string }).og_title || '',
      og_description: (post as { og_description?: string }).og_description || '',
      og_image: (post as { og_image?: string }).og_image || '',
      robots: (post as { robots?: string }).robots || 'index,follow',
      schema_type: (post as { schema_type?: string }).schema_type || 'BlogPosting',
      featured: post.featured || false,
      editors_pick: post.editors_pick || false,
      takeaways: post.takeaways || [],
      faq: Array.isArray(post.faq) ? post.faq : [],
      alt_title: post.alt_title || '',
      series_id: post.series_id || '',
      series_order: post.series_order ? String(post.series_order) : '',
      allow_comments: post.allow_comments !== false,
      is_evergreen: Boolean((post as { is_evergreen?: boolean }).is_evergreen),
      pinned_until: (post as unknown as { pinned_until?: string }).pinned_until
        ? new Date((post as unknown as { pinned_until: string }).pinned_until).toISOString().slice(0, 16) : '',
      editor_notes: (post as { editor_notes?: string }).editor_notes || '',
      content_warnings: (post as { content_warnings?: string[] }).content_warnings || [],
      review_note: (post as { review_note?: string }).review_note || '',
    };
    setState(next);
    setLastSavedSnapshot(JSON.stringify(next));
    setAutosavedAt((post as { autosave_at?: string }).autosave_at || null);
  }, [post]);

  useEffect(() => {
    if (isNew) {
      const draftTpl = sessionStorage.getItem('lixxon_draft_template');
      if (draftTpl) {
        sessionStorage.removeItem('lixxon_draft_template');
        setState(s => ({ ...s, content: draftTpl }));
        setNotice('Loaded template structure into new draft.');
      }
    }
  }, [isNew]);

  useEffect(() => {
    if (!currentPostId) return;
    supabase.from('related_articles').select('related_post_id').eq('post_id', currentPostId).order('sort_order')
      .then(({ data }) => { if (data) setRelatedIds(data.map(r => r.related_post_id)); });
  }, [currentPostId]);

  useEffect(() => {
    supabase.from('article_series').select('id, title').order('title')
      .then(({ data }) => setSeriesList((data || []) as { id: string; title: string }[]));
  }, []);

  // ------------------------------------------------------------------ quality score (DB = single source of truth)
  const scoreRef = useRef(0);
  const runScore = useCallback(async () => {
    const mine = ++scoreRef.current;
    setScoring(true);
    const { data, error } = await supabase.rpc('admin_score_draft', scoreArgs(state));
    if (mine !== scoreRef.current) return; // a newer keystroke already asked
    setScoring(false);
    if (!error && data) setReport(data as QualityReport);
  }, [state]);

  useEffect(() => {
    const t = setTimeout(runScore, 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.title, state.content, state.excerpt, state.focus_keyword, state.seo_title, state.seo_description, state.cover_image, state.cover_image_alt]);

  // ------------------------------------------------------------------ revisions
  const loadRevisions = useCallback(async () => {
    if (!currentPostId) { setRevisions([]); return; }
    const { data } = await supabase.rpc('admin_list_revisions', { p_post_id: currentPostId, p_limit: 40 });
    if (Array.isArray(data)) setRevisions(data as RevisionRow[]);
  }, [currentPostId]);
  useEffect(() => { loadRevisions(); }, [loadRevisions, savedMsg]);

  const openDiff = useCallback(async (r: RevisionRow) => {
    const { data } = await supabase.from('article_versions').select('content, title').eq('id', r.id).maybeSingle();
    if (!data) return;
    setDiff({ title: `Changes since ${new Date(r.saved_at).toLocaleString()}`, oldText: data.content || '', newText: state.content });
  }, [state.content]);

  const restoreRevision = useCallback(async (r: RevisionRow) => {
    if (!confirm('Restore this revision? The current text is kept as a revision first, so nothing is lost.')) return;
    const { data, error } = await supabase.rpc('admin_restore_revision', { p_version_id: r.id });
    if (error) { setError(error.message); return; }
    const restored = data as { title: string } | null;
    const { data: fresh } = await supabase.from('posts').select('*').eq('id', currentPostId!).maybeSingle();
    if (fresh) {
      const next = { ...state, title: fresh.title || '', content: fresh.content || '', excerpt: fresh.excerpt || '' };
      setState(next);
      setLastSavedSnapshot(JSON.stringify(next));
    } else if (restored) {
      update('title', restored.title);
    }
    setNotice('Revision restored — reloaded into the editor.');
    loadRevisions();
  }, [currentPostId, state, update, loadRevisions]);

  // ------------------------------------------------------------------ autosave (DB) + local recovery
  const autosave = useCallback(async (silent = true) => {
    if (!currentPostId || !dirty || !can('content.write')) return;
    setAutosaving(true);
    const { error } = await supabase.rpc('admin_autosave_post', {
      p_post_id: currentPostId,
      p_patch: {
        title: state.title, slug: state.slug || slugify(state.title), excerpt: state.excerpt,
        content: state.content, cover_image: state.cover_image, cover_image_alt: state.cover_image_alt,
        category_id: state.category_id, author_id: state.author_id, tags: state.tags,
        seo_title: state.seo_title, seo_description: state.seo_description, canonical_url: state.canonical_url,
        focus_keyword: state.focus_keyword, og_title: state.og_title, og_description: state.og_description,
        og_image: state.og_image, robots: state.robots, schema_type: state.schema_type,
        takeaways: state.takeaways, faq: state.faq, allow_comments: state.allow_comments,
        editor_notes: state.editor_notes, content_warnings: state.content_warnings,
        is_evergreen: state.is_evergreen,
      },
    });
    setAutosaving(false);
    if (error) { if (!silent) setError(error.message); return; }
    setAutosavedAt(new Date().toISOString());
    setLastSavedSnapshot(JSON.stringify(state));
    if (!silent) setNotice('Autosave written to the database.');
  }, [currentPostId, dirty, state, can]);

  useEffect(() => {
    if (!autosaveEnabled) return;
    const t = setInterval(() => { autosave(true); }, AUTOSAVE_MS);
    return () => clearInterval(t);
  }, [autosave, autosaveEnabled]);

  // local safety net while the browser is offline / the tab dies
  useEffect(() => {
    const k = draftKey(currentPostId || 'new');
    const t = setTimeout(() => {
      if (state.title || state.content) localStorage.setItem(k, JSON.stringify({ state, t: Date.now() }));
    }, 5000);
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

  // warn before losing unsaved work
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  // ------------------------------------------------------------------ helpers
  const addTag = () => {
    const tag = tagInput.trim().toLowerCase();
    if (tag && !state.tags.includes(tag)) update('tags', [...state.tags, tag]);
    setTagInput('');
  };
  const removeTag = (tag: string) => update('tags', state.tags.filter(t => t !== tag));

  const openLinkDialog = useCallback(async () => {
    setLinkDialog(true);
    const { data } = await supabase.rpc('admin_internal_link_suggestions', {
      p_post_id: currentPostId, p_query: state.title + ' ' + state.tags.join(' '), p_limit: 6,
    });
    if (Array.isArray(data)) setInternalLinks(data as { id: string; title: string; url: string }[]);
  }, [currentPostId, state.title, state.tags]);

  const uploadImage = useCallback(async (file: File) => {
    const { blob, width, height, contentType, extension } = await optimizeAdminImage(file, 1600, 0.78);
    const path = `articles/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;
    const { error: upErr } = await supabase.storage.from('media').upload(path, blob, { contentType, cacheControl: '31536000' });
    if (upErr) { setError(`Image upload failed: ${upErr.message}`); return; }
    const { data: urlData } = supabase.storage.from('media').getPublicUrl(path);
    const alt = window.prompt('Alt text for this image (required for accessibility):', file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ')) || 'Image';
    await supabase.from('media').insert({ url: urlData.publicUrl, alt_text: alt, file_name: file.name, file_size: blob.size, mime_type: contentType, width: width || null, height: height || null, title: alt }).then(() => undefined, () => undefined);
    editor.insertBlock(`\n![${alt}](${urlData.publicUrl})\n`);
  }, [editor]);
  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const f = Array.from(e.clipboardData.files).find(x => x.type.startsWith('image/'));
    if (f) { e.preventDefault(); uploadImage(f); }
  };
  const onDrop = (e: React.DragEvent<HTMLTextAreaElement>) => {
    const f = Array.from(e.dataTransfer.files).find(x => x.type.startsWith('image/'));
    if (f) { e.preventDefault(); uploadImage(f); }
  };

  // ------------------------------------------------------------------ save
  const buildPayload = useCallback((overrides: Partial<EditorState> = {}) => {
    const s = { ...state, ...overrides };
    const status = s.status;
    return {
      title: s.title.trim(),
      slug: s.slug.trim() || slugify(s.title),
      excerpt: s.excerpt || null,
      content: s.content || null,
      cover_image: s.cover_image || null,
      cover_image_alt: s.cover_image_alt || null,
      category_id: s.category_id || null,
      author_id: s.author_id || null,
      tags: s.tags,
      status,
      workflow_status: s.workflow_status,
      published_at: status === 'scheduled' && s.scheduled_at ? new Date(s.scheduled_at).toISOString() : new Date(s.published_at).toISOString(),
      scheduled_at: status === 'scheduled' && s.scheduled_at ? new Date(s.scheduled_at).toISOString() : null,
      seo_title: s.seo_title || s.title || null,
      seo_description: s.seo_description || s.excerpt || null,
      canonical_url: s.canonical_url || null,
      focus_keyword: s.focus_keyword ? s.focus_keyword.toLowerCase().trim() : null,
      og_title: s.og_title || null,
      og_description: s.og_description || null,
      og_image: s.og_image || null,
      robots: s.robots,
      schema_type: s.schema_type,
      featured: s.featured,
      editors_pick: s.editors_pick,
      reading_time_minutes: stats.reading_time_minutes,
      word_count: stats.words,
      takeaways: s.takeaways.map(t => t.trim()).filter(Boolean),
      faq: s.faq.filter(f => f.q.trim() && f.a.trim()),
      alt_title: s.alt_title.trim() || null,
      series_id: s.series_id || null,
      series_order: s.series_id && s.series_order ? Number(s.series_order) : null,
      allow_comments: s.allow_comments,
      content_warnings: s.content_warnings.map(w => w.trim()).filter(Boolean),
      is_evergreen: s.is_evergreen,
      pinned_until: s.pinned_until ? new Date(s.pinned_until).toISOString() : null,
      editor_notes: s.editor_notes || null,
      seo_score: report?.score ?? null,
    };
  }, [state, stats, report]);

  const save = useCallback(async (newStatus?: PostStatus, overrides: Partial<EditorState> = {}, quiet = false) => {
    setSaving(true);
    setError(null);
    if (!state.title.trim()) { setError('A title is required before saving.'); setSaving(false); return; }
    if (newStatus === 'published' && !can('content.publish')) {
      setError('Your role cannot publish — send it for review instead.');
      setSaving(false);
      return;
    }

    const payload = buildPayload({ ...overrides, ...(newStatus ? { status: newStatus } : {}) });
    let savedId = currentPostId;
    if (savedId) {
      const { error: upErr } = await supabase.from('posts').update(payload).eq('id', savedId);
      if (upErr) { setError(upErr.message); setSaving(false); return; }
    } else {
      const { data, error: insErr } = await supabase.from('posts').insert(payload).select().single();
      if (insErr) { setError(insErr.message); setSaving(false); return; }
      savedId = data.id as string;
      setCurrentPostId(savedId);
      navigate({ name: 'admin-article-edit', id: savedId });
    }

    if (savedId && relatedIds.length > 0) {
      await supabase.from('related_articles').delete().eq('post_id', savedId);
      await supabase.from('related_articles').insert(relatedIds.map((rid, i) => ({ post_id: savedId, related_post_id: rid, sort_order: i })));
    }

    localStorage.removeItem(draftKey(savedId || 'new'));
    setLastSavedSnapshot(JSON.stringify({ ...state, ...overrides, ...(newStatus ? { status: newStatus } : {}), workflow_status: overrides.workflow_status ?? state.workflow_status }));
    setAutosavedAt(new Date().toISOString());
    if (!quiet) {
      setSavedMsg(newStatus === 'published' ? 'Published' : 'Saved');
      setTimeout(() => setSavedMsg(null), 3000);
    }
    setSaving(false);
    loadRevisions();
  }, [state, buildPayload, currentPostId, relatedIds, can, navigate, loadRevisions]);

  // ------------------------------------------------------------------ workflow actions
  const [workflowBusy, setWorkflowBusy] = useState(false);
  const runWorkflow = useCallback(async (kind: 'review' | 'approve' | 'publish' | 'reject' | 'unpublish' | 'archive') => {
    if (!currentPostId) { setError('Save the article first.'); return; }
    setWorkflowBusy(true);
    setError(null);
    try {
      if (dirty) await save(undefined, {}, true);
      if (kind === 'review') {
        const note = state.review_note || prompt('Add a note for the reviewer (optional):') || undefined;
        const { error: e } = await supabase.rpc('admin_submit_review', { p_post_id: currentPostId, p_note: note ?? null });
        if (e) throw e;
        update('workflow_status', 'in_review');
        setNotice('Sent for review.');
      } else if (kind === 'approve' || kind === 'publish') {
        const { data, error: e } = await supabase.rpc('admin_approve_post', {
          p_post_id: currentPostId, p_publish: kind === 'publish', p_note: state.review_note || null,
        });
        if (e) throw e;
        const wf = (data as string) || (kind === 'publish' ? 'published' : 'approved');
        update('workflow_status', wf as Workflow);
        if (kind === 'publish') { update('status', 'published'); }
        setNotice(kind === 'publish' ? 'Published.' : 'Approved — ready to schedule or publish.');
      } else if (kind === 'reject') {
        const note = prompt('What needs changing?');
        if (!note) { setWorkflowBusy(false); return; }
        const { error: e } = await supabase.rpc('admin_reject_post', { p_post_id: currentPostId, p_note: note });
        if (e) throw e;
        update('workflow_status', 'draft');
        update('review_note', note);
        setNotice('Sent back to the author with your note.');
      } else if (kind === 'unpublish') {
        await save('draft', { workflow_status: 'draft', status: 'draft' }, true);
        setNotice('Unpublished — the article is a draft again.');
      } else if (kind === 'archive') {
        await save('archived', { workflow_status: 'archived', status: 'archived' }, true);
        setNotice('Archived.');
      }
      loadRevisions();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setWorkflowBusy(false);
    }
  }, [currentPostId, dirty, save, state.review_note, update, loadRevisions]);

  const applyFix = useCallback((issue: QualityIssue) => {
    const jump: Record<string, () => void> = {
      title: () => document.getElementById('article-title')?.focus(),
      title_length: () => document.getElementById('article-title')?.focus(),
      excerpt: () => document.getElementById('excerpt-input')?.focus(),
      excerpt_length: () => document.getElementById('excerpt-input')?.focus(),
      seo_description: () => document.getElementById('seo-desc')?.focus(),
      seo_description_length: () => document.getElementById('seo-desc')?.focus(),
      seo_title: () => document.getElementById('seo-title')?.focus(),
      seo_title_length: () => document.getElementById('seo-title')?.focus(),
      focus_keyword: () => document.getElementById('focus-keyword')?.focus(),
      kw_title: () => document.getElementById('focus-keyword')?.focus(),
      kw_description: () => document.getElementById('focus-keyword')?.focus(),
      kw_intro: () => editor.focus(),
      headings: () => editor.insertBlock('## Section title\n'),
      heading_order: () => editor.focus(),
      internal_links: () => openLinkDialog(),
      internal_links_low: () => openLinkDialog(),
      cover: () => setMediaPickerMode('cover'),
      image_alt: () => editor.focus(),
      cover_alt: () => document.getElementById('cover-alt')?.focus(),
      thin: () => editor.focus(),
      short: () => editor.focus(),
      readability: () => editor.focus(),
      sentence_length: () => editor.focus(),
      paragraph_length: () => editor.focus(),
    };
    // "seo_description" and friends may arrive with different keys; fall back to the top field
    const run = jump[issue.key] ?? (() => editor.focus());
    run();
  }, [editor, openLinkDialog]);

  // ------------------------------------------------------------------ headline A/B stats
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

  const siteUrl = typeof window !== 'undefined' ? window.location.origin : 'https://lixxonstudio.com';
  const previewUrl = `${siteUrl}/article/${state.slug || slugify(state.title) || 'draft'}`;

  if (loading && !isNew) return <div className="text-gray-400 text-sm">Loading article…</div>;

  void WORKFLOW;
  const canPublish = can('content.publish');
  const canWrite = can('content.write');

  // ------------------------------------------------------------------ render
  return (
    <div className={focusMode ? 'max-w-3xl mx-auto' : ''}>
      {recoverable && (
        <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded text-sm text-amber-900 flex flex-wrap items-center gap-3">
          <span>An unsaved local draft of this article was found on this device.</span>
          <button onClick={() => { setState(recoverable); setRecoverable(null); }} className="px-3 py-1.5 bg-amber-600 text-white rounded text-xs">Restore local draft</button>
          <button onClick={() => { localStorage.removeItem(draftKey(currentPostId || 'new')); setRecoverable(null); }} className="px-3 py-1.5 border border-amber-300 rounded text-xs">Discard</button>
        </div>
      )}
      {notice && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded text-sm text-green-900 flex items-center gap-3">
          <Check size={15} /> <span className="flex-1">{notice}</span>
          <button onClick={() => setNotice(null)} className="text-green-700 text-xs">Dismiss</button>
        </div>
      )}

      {/* header */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={() => { if (!dirty || confirm('You have unsaved changes. Leave anyway?')) navigate({ name: 'admin-articles' }); }} className="text-gray-500 hover:text-gray-700" aria-label="Back to articles">
            <ArrowLeft size={20} />
          </button>
          <h1 className="font-serif text-2xl text-gray-900 truncate">{isNew ? 'New article' : 'Edit article'}</h1>
          {report && <span className="hidden sm:inline-flex"><ScoreRing score={report.score} grade={report.grade} size={40} /></span>}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {savedMsg && <span className="text-sm text-green-600 flex items-center gap-1"><Check size={14} /> {savedMsg}</span>}
          {error && <span className="text-sm text-red-600">{error}</span>}
          <AutosaveBadge at={autosavedAt} saving={autosaving} dirty={dirty} onSaveNow={() => autosave(false)} />
          <button onClick={() => setFocusMode(f => !f)} title="Focus mode" aria-label="Focus mode" className="p-2 border border-gray-200 rounded hover:bg-gray-50">
            {focusMode ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
          <div className="inline-flex border border-gray-200 rounded overflow-hidden text-sm">
            <button onClick={() => setEditorTab('write')} className={`px-3 py-2 ${editorTab === 'write' ? 'bg-gray-100 font-medium' : 'hover:bg-gray-50'}`}>✍️ Write</button>
            <button onClick={() => setEditorTab('preview')} className={`px-3 py-2 border-l border-gray-200 ${editorTab === 'preview' ? 'bg-gray-100 font-medium' : 'hover:bg-gray-50'}`}>👁️ Preview</button>
            <button onClick={() => setEditorTab('split')} className={`px-3 py-2 border-l border-gray-200 ${editorTab === 'split' ? 'bg-gray-100 font-medium' : 'hover:bg-gray-50'}`}>⬛ Split</button>
          </div>
          <a href={previewUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-bronze hover:underline">Open on site →</a>
          <button onClick={() => save('draft')} disabled={saving || !canWrite} className="inline-flex items-center gap-2 border border-gray-200 px-3 py-2 rounded text-sm hover:bg-gray-50 disabled:opacity-50">
            <Save size={15} /> Save draft
          </button>
          {canPublish ? (
            <button onClick={() => save('published', { workflow_status: 'published' })} disabled={saving || workflowBusy} className="inline-flex items-center gap-2 bg-bronze text-white px-3 py-2 rounded text-sm hover:bg-bronze-dark disabled:opacity-50">
              <Rocket size={15} /> Publish
            </button>
          ) : (
            <button onClick={() => runWorkflow('review')} disabled={saving || workflowBusy} className="inline-flex items-center gap-2 bg-bronze text-white px-3 py-2 rounded text-sm hover:bg-bronze-dark disabled:opacity-50">
              <Send size={15} /> Send for review
            </button>
          )}
        </div>
      </div>

      {/* status badge */}
      <div className="mb-5 flex items-center gap-2 flex-wrap">
        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${state.workflow_status === 'published' ? 'bg-green-100 text-green-800' : state.workflow_status === 'in_review' ? 'bg-amber-100 text-amber-800' : state.workflow_status === 'approved' ? 'bg-blue-100 text-blue-800' : state.workflow_status === 'archived' ? 'bg-gray-200 text-gray-600' : 'bg-gray-100 text-gray-700'}`}>
          {WORKFLOW.find(w => w.id === state.workflow_status)?.label ?? state.workflow_status}
        </span>
        {canPublish && <button onClick={() => runWorkflow('approve')} disabled={workflowBusy} className="text-xs px-2.5 py-1.5 border border-gray-200 rounded hover:bg-gray-50 disabled:opacity-50">Approve</button>}
        {canPublish && <button onClick={() => runWorkflow('reject')} disabled={workflowBusy} className="text-xs px-2.5 py-1.5 border border-gray-200 rounded hover:bg-gray-50 disabled:opacity-50">Request changes</button>}
        {canPublish && <button onClick={() => runWorkflow('unpublish')} disabled={workflowBusy} className="text-xs px-2.5 py-1.5 border border-gray-200 rounded hover:bg-gray-50 disabled:opacity-50">Unpublish</button>}
        {canPublish && <button onClick={() => runWorkflow('archive')} disabled={workflowBusy} className="text-xs px-2.5 py-1.5 border border-gray-200 rounded hover:bg-gray-50 disabled:opacity-50 inline-flex items-center gap-1"><Archive size={12} /> Archive</button>}
        <label className="text-[11px] text-gray-500 inline-flex items-center gap-1 cursor-pointer ml-auto">
          <input type="checkbox" checked={autosaveEnabled} onChange={e => setAutosaveEnabled(e.target.checked)} /> autosave
        </label>
        {autosavedAt && <span className="text-[11px] text-gray-400 inline-flex items-center gap-1"><Clock size={11} /> last saved {new Date(autosavedAt).toLocaleTimeString()}</span>}
      </div>
      {state.review_note && state.workflow_status === 'draft' && (
        <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded text-sm text-amber-900 flex gap-2">
          <Info size={15} className="mt-0.5 shrink-0" /> <span><strong>Reviewer note:</strong> {state.review_note}</span>
        </div>
      )}

      <div className={`grid gap-6 ${focusMode ? 'grid-cols-1' : 'lg:grid-cols-3'}`}>
        {/* ---------------- main column ---------------- */}
        <div className={`space-y-4 ${focusMode ? '' : 'lg:col-span-2'}`}>
          <div className="flex gap-3">
            <input
              id="article-title"
              type="text"
              value={state.title}
              onChange={e => { update('title', e.target.value); if (!currentPostId) update('slug', slugify(e.target.value)); }}
              placeholder="Article title…"
              className="w-full bg-white border border-gray-200 px-4 py-3 rounded text-lg font-serif text-gray-900 focus:outline-none focus:border-bronze focus:ring-1 focus:ring-bronze/30"
            />
            <div className="hidden sm:flex items-center px-3 border border-gray-200 rounded bg-white text-xs text-gray-400 whitespace-nowrap">
              {stats.words}/{wordGoal} words
              <button onClick={() => setWordGoal(g => (g === 1200 ? 2000 : g === 2000 ? 600 : 1200))} className="ml-2 text-bronze" title="Change goal">goal</button>
            </div>
          </div>
          <div className="h-1 bg-gray-100 rounded overflow-hidden">
            <div className="h-full bg-bronze transition-all" style={{ width: `${Math.min(100, (stats.words / wordGoal) * 100)}%` }} />
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="slug-input" className="block text-xs text-gray-500 mb-1 uppercase tracking-wider">Slug</label>
              <input id="slug-input" value={state.slug} onChange={e => update('slug', slugify(e.target.value))} placeholder="article-url-slug" className="w-full bg-white border border-gray-200 px-3 py-2 rounded text-sm font-mono text-gray-700" />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label htmlFor="focus-keyword" className="block text-xs text-gray-500 uppercase tracking-wider font-medium">Focus keyword</label>
                {focusMetrics && (
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                    focusMetrics.optimal ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'
                  }`}>
                    {focusMetrics.density}% density ({focusMetrics.count}x)
                  </span>
                )}
              </div>
              <input
                id="focus-keyword"
                value={state.focus_keyword}
                onChange={e => update('focus_keyword', e.target.value)}
                placeholder="e.g. niacinamide serum"
                className="w-full bg-white border border-gray-200 px-3 py-2 rounded text-sm focus:outline-none focus:border-bronze"
              />

              {/* Real-time Focus Keyword Diagnostic Indicators */}
              {focusMetrics && (
                <div className="mt-1.5 flex flex-wrap gap-1.5 text-[10px]">
                  <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border ${
                    focusMetrics.inTitle ? 'bg-green-50 text-green-700 border-green-200 font-medium' : 'bg-gray-50 text-gray-500 border-gray-200'
                  }`}>
                    {focusMetrics.inTitle ? '✓ In Title' : '○ Title missing'}
                  </span>
                  <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border ${
                    focusMetrics.inIntro ? 'bg-green-50 text-green-700 border-green-200 font-medium' : 'bg-gray-50 text-gray-500 border-gray-200'
                  }`}>
                    {focusMetrics.inIntro ? '✓ In Intro' : '○ Intro missing'}
                  </span>
                  <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border ${
                    focusMetrics.inHeadings ? 'bg-green-50 text-green-700 border-green-200 font-medium' : 'bg-gray-50 text-gray-500 border-gray-200'
                  }`}>
                    {focusMetrics.inHeadings ? '✓ In Headings' : '○ Headings missing'}
                  </span>
                </div>
              )}

              {/* Suggested Focus Keywords from Article */}
              {keywordAnalysis.focusCandidates.length > 0 && (
                <div className="mt-2 pt-2 border-t border-gray-100">
                  <span className="text-[10px] uppercase tracking-wider text-gray-400 block mb-1">
                    Suggested keyphrases:
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {keywordAnalysis.focusCandidates.slice(0, 4).map(cand => (
                      <button
                        key={cand.phrase}
                        type="button"
                        onClick={() => update('focus_keyword', cand.phrase)}
                        className={`text-xs px-2.5 py-1 rounded-sm border transition-colors ${
                          state.focus_keyword.toLowerCase() === cand.phrase.toLowerCase()
                            ? 'bg-bronze text-white border-bronze font-medium'
                            : 'border-bronze/30 text-bronze hover:bg-bronze/10'
                        }`}
                      >
                        + {cand.phrase}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <label htmlFor="excerpt-input" className="text-xs text-gray-500 uppercase tracking-wider font-medium">Excerpt</label>
                <button
                  type="button"
                  onClick={() => {
                    const generated = generateSmartExcerpt(state.content);
                    if (generated) {
                      update('excerpt', generated);
                      setNotice('Generated excerpt from article introduction.');
                    } else {
                      setError('Enter or paste content first to generate an excerpt.');
                    }
                  }}
                  className="text-[11px] text-bronze hover:underline flex items-center gap-1"
                  title="Extract thesis sentence from article introduction"
                >
                  <Sparkles size={11} /> Auto-generate
                </button>
              </div>
              <CharCount value={state.excerpt} min={110} max={170} />
            </div>
            <textarea id="excerpt-input" value={state.excerpt} onChange={e => update('excerpt', e.target.value)} rows={2} placeholder="One or two sentences that make someone click…" className="w-full bg-white border border-gray-200 px-3 py-2 rounded text-sm focus:outline-none focus:border-bronze" />
          </div>

          {/* editor + preview */}
          <div className={editorTab === 'split' ? 'grid md:grid-cols-2 gap-4 items-start' : ''}>
            <div className="relative">
              <EditorToolbar
                editor={editor}
                onAction={action => (action === 'link' ? openLinkDialog() : setMediaPickerMode('inline'))}
                extra={[
                  {
                    id: 'clean',
                    label: 'Clean formatting',
                    icon: Sparkles,
                    run: () => {
                      if (!state.content.trim()) { setError('No content to clean.'); return; }
                      const cleaned = cleanMarkdownContent(state.content);
                      update('content', cleaned);
                      setNotice('Markdown formatted: removed junk HTML, smart quotes & extra blank lines.');
                    },
                  },
                  { id: 'toc', label: 'Outline', icon: FileCode, run: () => setShowToc(t => !t) },
                  { id: 'rev', label: 'Snapshot', icon: History, run: async () => {
                    if (!currentPostId) { setError('Save the article before snapshotting.'); return; }
                    const { error: e } = await supabase.rpc('admin_save_revision', { p_post_id: currentPostId, p_note: 'Manual snapshot' });
                    if (e) setError(e.message); else { setNotice('Snapshot added to the revision list.'); loadRevisions(); }
                  } },
                ]}
              />
              <FindReplaceBar editor={editor} content={state.content} />
              {editorTab !== 'preview' && <div className="relative">
                <SlashMenu editor={editor} />
                <textarea
                  id="content-editor"
                  ref={editor.ref}
                  value={state.content}
                  onChange={e => update('content', e.target.value)}
                  onSelect={editor.onSelect}
                  onClick={editor.onSelect}
                  onKeyUp={editor.onSelect}
                  onPaste={onPaste}
                  onDrop={onDrop}
                  placeholder="Write here. Type / on an empty line for blocks (headings, lists, tables, FAQs). Paste or drop images to upload them. Markdown is fine."
                  rows={22}
                  className="w-full bg-white border border-gray-200 border-t-0 px-4 py-3 rounded-b text-sm text-gray-700 font-mono leading-relaxed focus:outline-none focus:border-bronze focus:ring-1 focus:ring-bronze/30"
                  style={{ minHeight: '420px' }}
                />
              </div>}
              {showToc && headingStructure.length > 0 && (
                <div className="mt-2 border border-gray-200 rounded bg-white p-3">
                  <p className="text-[11px] uppercase tracking-wider text-gray-400 mb-2">Outline</p>
                  <ul className="space-y-1 text-xs">
                    {headingStructure.map((h, i) => (
                      <li key={i} style={{ paddingLeft: `${(h.level - 1) * 12}px` }} className="text-gray-600">
                        H{h.level} · {h.text}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="flex flex-wrap gap-4 text-xs text-gray-500 bg-gray-50 px-4 py-3 rounded mt-2">
                <span><strong className="text-gray-700">{stats.words}</strong> words</span>
                <span><strong className="text-gray-700">{stats.chars}</strong> chars</span>
                <span><strong className="text-gray-700">{stats.paragraphs}</strong> paragraphs</span>
                <span><strong className="text-gray-700">{stats.headings}</strong> headings</span>
                <span><strong className="text-gray-700">{stats.internal_links}</strong> internal links</span>
                <span><strong className="text-gray-700">{stats.images}</strong> images</span>
                <span><strong className="text-gray-700">~{stats.reading_time_minutes}</strong> min read</span>
                <button onClick={() => setShowShortcuts(s => !s)} className="ml-auto text-bronze hover:underline">Shortcuts</button>
              </div>
              {showShortcuts && (
                <div className="mt-2 grid sm:grid-cols-2 gap-x-6 gap-y-1 text-xs text-gray-500 bg-white border border-gray-200 rounded p-3">
                  {EDITOR_SHORTCUTS.map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-2"><span className="font-mono text-gray-600">{k}</span><span>{v}</span></div>
                  ))}
                </div>
              )}
            </div>
            {editorTab === 'split' && (
              <div className="md:max-h-[720px] md:overflow-y-auto">
                <LivePreview content={state.content} title={state.title} excerpt={state.excerpt} cover={state.cover_image} coverAlt={state.cover_image_alt} takeaways={state.takeaways} />
              </div>
            )}
          </div>

          {editorTab === 'preview' && (
            <LivePreview content={state.content} title={state.title} excerpt={state.excerpt} cover={state.cover_image} coverAlt={state.cover_image_alt} takeaways={state.takeaways} />
          )}

          {/* inline images with missing alt */}
          {stats.images_missing_alt > 0 && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
              {stats.images_missing_alt} image(s) have no alt text. Screen readers announce nothing for them — add a description.
            </p>
          )}
        </div>

        {/* ---------------- sidebar ---------------- */}
        {!focusMode && (
          <div className="space-y-4">
            <SideSection title="Quality" icon={Search} badge={report ? `${report.score}/100` : undefined}>
              <QualityPanel report={report} loading={scoring} onFix={applyFix} onRefresh={runScore} />
            </SideSection>

            <SideSection title="Publishing" icon={Rocket} badge={state.workflow_status}>
              <div className="space-y-3">
                <div>
                  <label htmlFor="status-select" className="block text-xs text-gray-500 mb-1">Status</label>
                  <select id="status-select" value={state.status} onChange={e => update('status', e.target.value as PostStatus)} className="w-full border border-gray-200 px-3 py-2 rounded text-sm bg-white">
                    <option value="draft">Draft</option>
                    <option value="scheduled">Scheduled</option>
                    <option value="published">Published</option>
                    <option value="archived">Archived</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="pub-date" className="block text-xs text-gray-500 mb-1">Publication date</label>
                  <input id="pub-date" type="datetime-local" value={state.published_at} onChange={e => update('published_at', e.target.value)} className="w-full border border-gray-200 px-3 py-2 rounded text-sm" />
                </div>
                {state.status === 'scheduled' && (
                  <div>
                    <label htmlFor="sched-date" className="block text-xs text-gray-500 mb-1">Scheduled for</label>
                    <input id="sched-date" type="datetime-local" value={state.scheduled_at} onChange={e => update('scheduled_at', e.target.value)} className="w-full border border-gray-200 px-3 py-2 rounded text-sm" />
                    <p className="text-xs text-amber-600 mt-1">Publishes automatically once the clock passes; the database job does this every few minutes.</p>
                  </div>
                )}
                <div className="flex flex-wrap gap-4">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="checkbox" checked={state.featured} onChange={e => update('featured', e.target.checked)} /> <Star size={14} className="text-bronze" /> Featured
                  </label>
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="checkbox" checked={state.editors_pick} onChange={e => update('editors_pick', e.target.checked)} /> <Sparkles size={14} className="text-bronze" /> Editor's pick
                  </label>
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="checkbox" checked={state.is_evergreen} onChange={e => update('is_evergreen', e.target.checked)} /> <Lightbulb size={14} /> Evergreen
                  </label>
                </div>
                <div>
                  <label htmlFor="pin-until" className="block text-xs text-gray-500 mb-1 flex items-center gap-1"><Pin size={11} /> Pinned until (auto-unpins)</label>
                  <input id="pin-until" type="datetime-local" value={state.pinned_until} onChange={e => update('pinned_until', e.target.value)} className="w-full border border-gray-200 px-3 py-2 rounded text-sm" />
                </div>
              </div>
            </SideSection>

            <SideSection title="Organization" icon={Tag}>
              <div className="space-y-3">
                <div>
                  <label htmlFor="cat-select" className="block text-xs text-gray-500 mb-1">Category</label>
                  <select id="cat-select" value={state.category_id} onChange={e => update('category_id', e.target.value)} className="w-full border border-gray-200 px-3 py-2 rounded text-sm bg-white">
                    <option value="">Uncategorised</option>
                    {categories.map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="author-select" className="block text-xs text-gray-500 mb-1">Author</label>
                  <select id="author-select" value={state.author_id} onChange={e => update('author_id', e.target.value)} className="w-full border border-gray-200 px-3 py-2 rounded text-sm bg-white">
                    <option value="">No author</option>
                    {authors.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-[1fr,70px] gap-2">
                  <div>
                    <label htmlFor="series-select" className="block text-xs text-gray-500 mb-1">Series</label>
                    <select id="series-select" value={state.series_id} onChange={e => update('series_id', e.target.value)} className="w-full border border-gray-200 px-3 py-2 rounded text-sm bg-white">
                      <option value="">None</option>
                      {seriesList.map(x => <option key={x.id} value={x.id}>{x.title}</option>)}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="series-order" className="block text-xs text-gray-500 mb-1">Part</label>
                    <input id="series-order" type="number" min={1} value={state.series_order} onChange={e => update('series_order', e.target.value)} className="w-full border border-gray-200 px-3 py-2 rounded text-sm" />
                  </div>
                </div>
                <div id="article-product-slots">
                  <GuideLink section="product-slots" back={guideBackFor(postId)} />
                </div>
              </div>
            </SideSection>

            <SideSection title="Tags" icon={Tag} badge={state.tags.length || undefined}>
              <div className="flex gap-2">
                <input value={tagInput} onChange={e => setTagInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }} placeholder="Add tag…" className="flex-1 border border-gray-200 px-3 py-2 rounded text-sm" />
                <button onClick={addTag} className="px-3 py-2 bg-gray-100 rounded text-sm hover:bg-gray-200">Add</button>
              </div>
              <div className="flex flex-wrap gap-2">
                {state.tags.map(tag => (
                  <span key={tag} className="inline-flex items-center gap-1 bg-gray-100 text-gray-700 text-xs px-2.5 py-1 rounded-full">
                    {tag}
                    <button onClick={() => removeTag(tag)} className="text-gray-400 hover:text-red-600" aria-label={`Remove ${tag}`}>×</button>
                  </span>
                ))}
              </div>
              {tagSuggestions.length > 0 && (
                <div className="border-t border-gray-100 pt-3">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs text-gray-400 flex items-center gap-1"><Lightbulb size={11} /> Suggested from the text</p>
                    <button
                      type="button"
                      onClick={() => update('tags', [...new Set([...state.tags, ...tagSuggestions])])}
                      className="text-xs text-bronze hover:underline font-medium"
                    >
                      + Add all ({tagSuggestions.length})
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {tagSuggestions.map((tag: string) => (
                      <button key={tag} onClick={() => update('tags', [...state.tags, tag])} className="text-xs px-2 py-1 rounded-full border border-bronze/30 text-bronze hover:bg-bronze/5">+ {tag}</button>
                    ))}
                  </div>
                </div>
              )}
            </SideSection>

            <SideSection title="SEO" icon={Search} defaultOpen={false} badge={report?.metrics?.keyword_density ? `${report.metrics.keyword_density}% kw` : undefined}>
              <div className="space-y-3">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label htmlFor="seo-title" className="text-xs text-gray-500">SEO title</label>
                    <CharCount value={state.seo_title} min={30} max={65} />
                  </div>
                  <input id="seo-title" value={state.seo_title} onChange={e => update('seo_title', e.target.value)} placeholder={state.title || 'Overrides the article title in search results'} className="w-full border border-gray-200 px-3 py-2 rounded text-sm" />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label htmlFor="seo-desc" className="text-xs text-gray-500">Meta description</label>
                    <CharCount value={state.seo_description} min={110} max={160} />
                  </div>
                  <textarea id="seo-desc" value={state.seo_description} onChange={e => update('seo_description', e.target.value)} rows={2} placeholder="What the reader gets, in 110–160 characters." className="w-full border border-gray-200 px-3 py-2 rounded text-sm" />
                </div>
                <button type="button" onClick={() => { update('seo_title', state.seo_title || state.title); update('seo_description', state.seo_description || state.excerpt); }} className="text-xs text-bronze hover:underline flex items-center gap-1"><Sparkles size={12} /> Fill from the article</button>
                <SearchPreview title={state.seo_title || state.title} description={state.seo_description || state.excerpt} url={previewUrl} />
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label htmlFor="robots" className="block text-xs text-gray-500 mb-1">Robots</label>
                    <select id="robots" value={state.robots} onChange={e => update('robots', e.target.value)} className="w-full border border-gray-200 px-2 py-1.5 rounded text-xs bg-white">
                      <option value="index,follow">index, follow</option>
                      <option value="noindex,follow">noindex, follow</option>
                      <option value="index,nofollow">index, nofollow</option>
                      <option value="noindex,nofollow">noindex, nofollow</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="schema" className="block text-xs text-gray-500 mb-1">Schema</label>
                    <select id="schema" value={state.schema_type} onChange={e => update('schema_type', e.target.value)} className="w-full border border-gray-200 px-2 py-1.5 rounded text-xs bg-white">
                      {['Article', 'NewsArticle', 'BlogPosting', 'HowTo', 'FAQPage', 'Review', 'Recipe'].map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label htmlFor="canonical" className="block text-xs text-gray-500 mb-1">Canonical URL</label>
                  <input id="canonical" value={state.canonical_url} onChange={e => update('canonical_url', e.target.value)} placeholder="https://…" className="w-full border border-gray-200 px-3 py-2 rounded text-sm" />
                </div>
                <div className="border-t border-gray-100 pt-3 space-y-2">
                  <p className="text-xs text-gray-500">Social share (falls back to SEO title/description and the cover)</p>
                  <input value={state.og_title} onChange={e => update('og_title', e.target.value)} placeholder="Social title" className="w-full border border-gray-200 px-3 py-2 rounded text-sm" />
                  <textarea value={state.og_description} onChange={e => update('og_description', e.target.value)} rows={2} placeholder="Social description" className="w-full border border-gray-200 px-3 py-2 rounded text-sm" />
                  <AdminImageUploadField
                    label="Social Share Image (OG)"
                    value={state.og_image}
                    onChange={url => update('og_image', url)}
                    folder="articles"
                    hint="Image used when article is shared on Twitter/X, LinkedIn, Facebook, Pinterest. Falls back to cover image."
                  />
                  <SocialCardPreview title={state.og_title || state.seo_title || state.title} description={state.og_description || state.seo_description || state.excerpt} image={state.og_image || state.cover_image} />
                </div>
              </div>
            </SideSection>

            <SideSection title="Cover image" icon={ImageIcon} defaultOpen={true}>
              <AdminImageUploadField
                label="Article Main Cover"
                value={state.cover_image}
                onChange={url => update('cover_image', url)}
                altText={state.cover_image_alt}
                onAltChange={alt => update('cover_image_alt', alt)}
                folder="articles"
                hint="Landscape 16:9 or 4:3 high-res image for article hero, RSS feeds, and social cards."
              />
            </SideSection>

            <SideSection title="Reader extras" icon={Calculator} defaultOpen={false}>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs text-gray-500 font-medium">Key takeaways (one per line)</label>
                  <button
                    type="button"
                    onClick={() => {
                      const items = extractKeyTakeaways(state.content);
                      if (items.length > 0) {
                        update('takeaways', items);
                        setNotice(`Extracted ${items.length} takeaways from content.`);
                      } else {
                        setError('No "Key Takeaways" bulleted list found in content.');
                      }
                    }}
                    className="text-[11px] text-bronze hover:underline flex items-center gap-1"
                    title="Auto-extract bullet points under ## Key Takeaways"
                  >
                    <Sparkles size={11} /> Extract from content
                  </button>
                </div>
                <textarea value={state.takeaways.join('\n')} onChange={e => update('takeaways', e.target.value.split('\n'))} rows={3} placeholder="Shown in a box above the article" className="w-full border border-gray-200 px-3 py-2 rounded text-sm" />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs text-gray-500 font-medium">FAQ (rendered + FAQPage schema)</label>
                  <button
                    type="button"
                    onClick={() => {
                      const items = extractFaqItems(state.content);
                      if (items.length > 0) {
                        update('faq', items);
                        setNotice(`Extracted ${items.length} FAQ questions from content.`);
                      } else {
                        setError('No "Frequently Asked Questions" section found in content.');
                      }
                    }}
                    className="text-[11px] text-bronze hover:underline flex items-center gap-1"
                    title="Auto-extract Q&A from ## FAQ section"
                  >
                    <Sparkles size={11} /> Extract FAQ from content
                  </button>
                </div>
                {state.faq.map((f, i) => (
                  <div key={i} className="mb-2 p-2 border border-gray-100 rounded">
                    <input value={f.q} onChange={e => update('faq', state.faq.map((x, k) => (k === i ? { ...x, q: e.target.value } : x)))} placeholder="Question" className="w-full border border-gray-200 px-2 py-1.5 rounded text-sm mb-1" />
                    <textarea value={f.a} onChange={e => update('faq', state.faq.map((x, k) => (k === i ? { ...x, a: e.target.value } : x)))} placeholder="Answer" rows={2} className="w-full border border-gray-200 px-2 py-1.5 rounded text-sm" />
                    <button type="button" onClick={() => update('faq', state.faq.filter((_, k) => k !== i))} className="text-xs text-red-500 mt-1">Remove</button>
                  </div>
                ))}
                <button type="button" onClick={() => update('faq', [...state.faq, { q: '', a: '' }])} className="text-xs text-bronze hover:underline">+ Add question</button>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Alternative headline (A/B test)</label>
                <input value={state.alt_title} onChange={e => update('alt_title', e.target.value)} placeholder="Half of readers see this title instead" className="w-full border border-gray-200 px-3 py-2 rounded text-sm" />
                {headlineStats && <p className="text-[11px] text-gray-500 mt-1">A: {headlineStats.a.clicks}/{headlineStats.a.impressions} ({pct(headlineStats.a)}) · B: {headlineStats.b.clicks}/{headlineStats.b.impressions} ({pct(headlineStats.b)})</p>}
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Content warnings (one per line)</label>
                <textarea
                  value={state.content_warnings.join('\n')}
                  onChange={e => update('content_warnings', e.target.value.split('\n'))}
                  rows={2}
                  placeholder="e.g. Contains affiliate links"
                  className="w-full border border-gray-200 px-3 py-2 rounded text-sm"
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={state.allow_comments} onChange={e => update('allow_comments', e.target.checked)} /> Allow comments</label>
            </SideSection>

            <SideSection title="Revisions" icon={History} defaultOpen={false} badge={revisions.length || undefined}>
              <RevisionPanel revisions={revisions} onDiff={openDiff} onRestore={restoreRevision} />
            </SideSection>

            <SideSection title="Notes for the team" icon={Info} defaultOpen={false}>
              <textarea value={state.editor_notes} onChange={e => update('editor_notes', e.target.value)} rows={3} placeholder="Context for other editors: sources, legal review, embargo…" className="w-full border border-gray-200 px-3 py-2 rounded text-sm" />
            </SideSection>

            <SideSection title="Templates" icon={FileCode} defaultOpen={false} badge={templates.length || undefined}>
              <div className="space-y-2">
                {templates.length === 0 && <p className="text-xs text-gray-400">No templates yet. Create them in Tools → Content templates.</p>}
                {templates.map(t => (
                  <button key={t.id} onClick={() => { if (state.content.trim() && !confirm('Replace the current content with this template?')) return; update('content', t.content); setShowTemplates(false); }} className="w-full text-left p-3 border border-gray-200 rounded hover:border-bronze">
                    <span className="text-sm font-medium text-gray-900">{t.name}</span>
                    {t.description && <p className="text-xs text-gray-400 mt-0.5">{t.description}</p>}
                  </button>
                ))}
                {showTemplates && <p className="text-[11px] text-gray-400">Linked articles in this piece: {linkSuggestions.length}</p>}
              </div>
            </SideSection>

            <div className="bg-white border border-gray-200 rounded-lg p-4 text-xs text-gray-500 space-y-1">
              <p className="flex items-center gap-1 text-gray-700 font-medium"><ShieldCheck size={13} /> Editorial rules</p>
              <p>Every save is captured as a revision by the database, so nothing typed here is ever lost.</p>
              <p>Quality score is worked out on the server — the same number search engines and the dashboard see.</p>
            </div>
          </div>
        )}
      </div>

      {/* footer actions for long pages */}
      <div className="sticky bottom-0 mt-6 py-3 bg-charcoal backdrop-blur border-t border-white/10 flex items-center gap-2 flex-wrap">
        <AutosaveBadge at={autosavedAt} saving={autosaving} dirty={dirty} onSaveNow={() => autosave(false)} />
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => runWorkflow('review')} disabled={workflowBusy} className="text-sm px-3 py-2 rounded border border-white/20 text-white hover:bg-charcoal disabled:opacity-50 inline-flex items-center gap-1"><Send size={14} /> Review</button>
          <button onClick={() => save('draft')} disabled={saving} className="text-sm px-3 py-2 rounded border border-white/20 text-white hover:bg-charcoal disabled:opacity-50 inline-flex items-center gap-1"><Save size={14} /> Save</button>
          {canPublish && !can('content.write') ? null : null}
          <button onClick={() => save('published', { workflow_status: 'published' })} disabled={saving || !canPublish} className="text-sm px-3 py-2 rounded bg-bronze text-white hover:bg-bronze-dark disabled:opacity-50 inline-flex items-center gap-1"><Target size={14} /> {state.status === 'published' ? 'Update live' : 'Publish'}</button>
          {!canPublish && <span className="text-xs text-white/60">Publishing needs the content.publish capability.</span>}
        </div>
      </div>

      {diff && (
        <DiffModal
          title={diff.title}
          oldText={diff.oldText}
          newText={diff.newText}
          onClose={() => setDiff(null)}
          onRestore={() => { const r = revisions.find(x => diff.title.includes(new Date(x.saved_at).toLocaleString())); if (r) { setDiff(null); restoreRevision(r); } }}
        />
      )}

      <LinkDialog
        open={linkDialog}
        initialText={''}
        internal={internalLinks}
        onClose={() => setLinkDialog(false)}
        onInsert={(text, url) => editor.wrapSelection('[', `](${url})`, text)}
      />

      <MediaPicker
        open={mediaPickerMode !== null}
        mode={mediaPickerMode}
        items={media}
        onClose={() => setMediaPickerMode(null)}
        onPick={({ url, alt }) => {
          if (mediaPickerMode === 'cover') { update('cover_image', url); if (alt && !state.cover_image_alt) update('cover_image_alt', alt); }
          else if (mediaPickerMode === 'og') update('og_image', url);
          else editor.insertBlock(`![${alt}](${url})\n`);
          setMediaPickerMode(null);
        }}
      />
    </div>
  );
}
