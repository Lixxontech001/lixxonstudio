import { useEffect, useState, useMemo, useCallback, type FormEvent } from 'react';
import {
  Layers, Plus, Trash2, Pencil, Loader2, X,
  ExternalLink, Search, Check, ChevronDown, ChevronUp, FileText, BookOpen,
  Sparkles, Eye, EyeOff
} from 'lucide-react';
import { supabase, rows } from '../../lib/supabaseClient';
import type { ArticleSeries } from '../../lib/types';
import { useNavigation } from '../../context/NavigationContext';
import { MarkdownField } from '../components/AdminEditorKit';
import AdminImageUploadField from '../components/AdminImageUploadField';

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

interface Part {
  id: string;
  title: string;
  slug?: string;
  series_order: number | null;
  status: string;
  published_at?: string;
}

interface AvailablePost {
  id: string;
  title: string;
  slug?: string;
  series_id: string | null;
  series_order: number | null;
  status: string;
  created_at?: string;
  tags?: string[] | null;
  excerpt?: string | null;
  category?: { name: string; slug: string } | null;
}

interface RecommendationResult {
  score: number;
  matchedWords: string[];
  reasons: string[];
}

// Skincare, cosmetic science, and editorial concept synonym clusters for affinity matching
const CONCEPT_CLUSTERS: Record<string, string[]> = {
  retinoid: ['retinol', 'retinoid', 'retinal', 'tretinoin', 'hpr', 'granactive', 'anti-aging', 'turnover', 'wrinkle'],
  barrier: ['barrier', 'ceramide', 'lipid', 'cholesterol', 'moisture', 'stratum', 'corneum', 'repair', 'soothe', 'calm'],
  cleanse: ['cleanse', 'cleansing', 'cleanser', 'wash', 'balm', 'micellar', 'oil-cleansing', 'foam', 'double-cleanse'],
  acid: ['acid', 'aha', 'bha', 'pha', 'glycolic', 'salicylic', 'lactic', 'exfoliat', 'exfoliation', 'peel'],
  hydration: ['hydrat', 'hydration', 'hyaluronic', 'humectant', 'glycerin', 'plump', 'water', 'dehydrated', 'ampoule'],
  peptide: ['peptide', 'copper', 'matrixyl', 'collagen', 'firming', 'elasticity', 'amino'],
  antioxidant: ['antioxidant', 'vitamin', 'ascorbic', 'ferulic', 'resveratrol', 'brighten', 'glow', 'free-radical'],
  sunscreen: ['sunscreen', 'spf', 'uv', 'photoprotection', 'broad-spectrum', 'mineral', 'chemical', 'sun'],
  niacinamide: ['niacinamide', 'b3', 'pore', 'sebum', 'texture', 'congestion', 'oiliness'],
  formulation: ['formulation', 'ingredient', 'stability', 'ph', 'emulsion', 'vehicle', 'concentration', 'synergy'],
  routine: ['routine', 'layering', 'sequence', 'morning', 'evening', 'regimen', 'step', 'protocol']
};

function normalizeStem(word: string): string {
  let w = word.toLowerCase();
  if (w.endsWith('ing') && w.length > 5) w = w.slice(0, -3);
  else if (w.endsWith('tion') && w.length > 6) w = w.slice(0, -4);
  else if (w.endsWith('ies') && w.length > 5) w = w.slice(0, -3) + 'y';
  else if (w.endsWith('es') && w.length > 4) w = w.slice(0, -2);
  else if (w.endsWith('s') && w.length > 4) w = w.slice(0, -1);
  return w;
}

const STOP_WORDS = new Set([
  'the', 'and', 'a', 'to', 'of', 'in', 'for', 'with', 'on', 'at', 'from', 'by',
  'about', 'as', 'into', 'like', 'through', 'after', 'over', 'between', 'out',
  'against', 'during', 'without', 'before', 'under', 'around', 'among', 'is',
  'are', 'was', 'were', 'be', 'been', 'being', 'how', 'what', 'why', 'when',
  'where', 'guide', 'part', 'series', 'edit', 'this', 'that', 'an', 'or', 'not',
  'your', 'our', 'all', 'any', 'each', 'every', 'more', 'most', 'such', 'only'
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map(w => normalizeStem(w.trim()))
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

function computeArticleAffinity(
  post: AvailablePost,
  targetTitle: string,
  targetDesc?: string
): RecommendationResult {
  const targetTokens = new Set([...tokenize(targetTitle), ...tokenize(targetDesc || '')]);
  if (targetTokens.size === 0) {
    return { score: 20, matchedWords: [], reasons: [] };
  }

  const postTitleTokens = tokenize(post.title);
  const postSlugTokens = tokenize(post.slug || '');
  const postTagTokens = (post.tags || []).flatMap(t => tokenize(t));
  const postExcerptTokens = post.excerpt ? tokenize(post.excerpt) : [];
  const catTokens = post.category ? tokenize(post.category.name + ' ' + post.category.slug) : [];

  const matchedSet = new Set<string>();
  const reasons: string[] = [];
  let rawScore = 0;

  // Title matches (highest weight)
  for (const t of postTitleTokens) {
    if (targetTokens.has(t) && !matchedSet.has(t)) {
      matchedSet.add(t);
      rawScore += 35;
      reasons.push(`Title matches "${t}"`);
    }
  }

  // Slug matches
  for (const t of postSlugTokens) {
    if (targetTokens.has(t) && !matchedSet.has(t)) {
      matchedSet.add(t);
      rawScore += 20;
    }
  }

  // Tag matches
  for (const t of postTagTokens) {
    if (targetTokens.has(t) && !matchedSet.has(t)) {
      matchedSet.add(t);
      rawScore += 25;
      reasons.push(`Tag: #${t}`);
    }
  }

  // Excerpt matches
  for (const t of postExcerptTokens) {
    if (targetTokens.has(t) && !matchedSet.has(t)) {
      matchedSet.add(t);
      rawScore += 15;
    }
  }

  // Category match
  for (const t of catTokens) {
    if (targetTokens.has(t) && !matchedSet.has(t)) {
      matchedSet.add(t);
      rawScore += 18;
    }
  }

  // Concept cluster expansion
  for (const [concept, cluster] of Object.entries(CONCEPT_CLUSTERS)) {
    const targetHasCluster = cluster.some(w => targetTokens.has(normalizeStem(w)));
    if (targetHasCluster) {
      const postHasCluster = cluster.some(w =>
        postTitleTokens.includes(normalizeStem(w)) ||
        postTagTokens.includes(normalizeStem(w)) ||
        postExcerptTokens.includes(normalizeStem(w))
      );
      if (postHasCluster && !matchedSet.has(concept)) {
        matchedSet.add(concept);
        rawScore += 22;
        reasons.push(`Concept: ${concept}`);
      }
    }
  }

  // Unassigned boost (unassigned articles are primary candidates)
  if (!post.series_id) {
    rawScore += 8;
  }

  const finalScore = Math.min(99, Math.max(0, rawScore));
  return {
    score: finalScore,
    matchedWords: Array.from(matchedSet),
    reasons: reasons.slice(0, 3)
  };
}

export default function AdminSeries() {
  const { navigate } = useNavigation();
  const [series, setSeries] = useState<ArticleSeries[]>([]);
  const [parts, setParts] = useState<Record<string, Part[]>>({});
  const [allPosts, setAllPosts] = useState<AvailablePost[]>([]);
  const [loadingPosts, setLoadingPosts] = useState(false);
  const [editing, setEditing] = useState<Partial<ArticleSeries> | null>(null);
  const [openSeriesId, setOpenSeriesId] = useState<string | null>(null);

  // Separate picker states to avoid drawer state clashing
  const [formPickerOpen, setFormPickerOpen] = useState(false);
  const [cardDrawerId, setCardDrawerId] = useState<string | null>(null);

  // Search & Filters
  const [searchFilter, setSearchFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'published' | 'draft' | 'unassigned'>('all');

  const [saving, setSaving] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setFeedbackMsg(msg);
    setTimeout(() => setFeedbackMsg(null), 3500);
  }, []);

  // Map series names by id for quick lookup of existing assignments
  const seriesNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    series.forEach(s => {
      map[s.id] = s.title;
    });
    return map;
  }, [series]);

  const load = async () => {
    const { data } = await supabase.from('article_series').select('*').order('created_at', { ascending: false });
    const sList = rows<ArticleSeries>(data);
    setSeries(sList);
    if (!openSeriesId && sList.length > 0) {
      setOpenSeriesId(sList[0].id);
    }

    const { data: p } = await supabase
      .from('posts')
      .select('id, title, slug, series_id, series_order, status, published_at')
      .not('series_id', 'is', null)
      .order('series_order', { ascending: true });

    const map: Record<string, Part[]> = {};
    rows<Part & { series_id: string }>(p).forEach(x => {
      (map[x.series_id] ||= []).push(x);
    });
    setParts(map);
  };

  const loadAllPosts = async (query = '') => {
    setLoadingPosts(true);
    try {
      let q = supabase
        .from('posts')
        .select('id, title, slug, series_id, series_order, status, created_at, tags, excerpt, category:categories(name, slug)')
        .order('created_at', { ascending: false })
        .limit(400);

      if (query.trim()) {
        q = q.ilike('title', `%${query.trim()}%`);
      }

      const { data, error } = await q;
      if (!error && data) {
        setAllPosts(rows<AvailablePost>(data));
      }
    } catch {
      // ignore
    } finally {
      setLoadingPosts(false);
    }
  };

  useEffect(() => {
    load();
    loadAllPosts();
  }, []);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!editing?.title?.trim()) return;
    setSaving(true);
    const payload = {
      title: editing.title.trim(),
      slug: editing.slug?.trim() || slugify(editing.title),
      description: editing.description || null,
      cover_image: editing.cover_image || null,
      is_active: editing.is_active ?? true,
    };

    try {
      if (editing.id) {
        const { error } = await supabase.from('article_series').update(payload).eq('id', editing.id);
        if (error) throw error;
        showToast('Series updated successfully');
      } else {
        const { data, error } = await supabase.from('article_series').insert(payload).select().single();
        if (error) throw error;
        showToast('New series created! You can now add guides to it.');
        if (data) {
          setEditing(null);
          setOpenSeriesId(data.id);
          setCardDrawerId(data.id);
          await load();
          return;
        }
      }
      setEditing(null);
      setFormPickerOpen(false);
      await load();
    } catch (err) {
      showToast('Error saving series: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSaving(false);
    }
  };

  const toggleSeriesStatus = async (s: ArticleSeries) => {
    try {
      const nextStatus = !s.is_active;
      setSeries(prev => prev.map(item => item.id === s.id ? { ...item, is_active: nextStatus } : item));
      const { error } = await supabase.from('article_series').update({ is_active: nextStatus }).eq('id', s.id);
      if (error) throw error;
      showToast(`Series is now ${nextStatus ? 'published & visible' : 'hidden from public view'}`);
    } catch (err) {
      showToast('Error updating status: ' + (err instanceof Error ? err.message : String(err)));
      load();
    }
  };

  const addPart = async (seriesId: string, postId: string) => {
    try {
      const currentList = parts[seriesId] || [];
      const post = allPosts.find(p => p.id === postId);
      const n = currentList.length + 1;

      // Optimistic update
      if (post) {
        const newPart: Part = {
          id: post.id,
          title: post.title,
          slug: post.slug,
          series_order: n,
          status: post.status,
          published_at: post.created_at,
        };
        setParts(prev => ({
          ...prev,
          [seriesId]: [...(prev[seriesId] || []), newPart],
        }));
      }

      const { error } = await supabase.from('posts').update({ series_id: seriesId, series_order: n }).eq('id', postId);
      if (error) throw error;
      showToast('Guide added to series');
      await load();
      await loadAllPosts(searchFilter);
    } catch (err) {
      showToast('Error adding guide: ' + (err instanceof Error ? err.message : String(err)));
      await load();
    }
  };

  const removePart = async (seriesId: string, postId: string) => {
    try {
      const remaining = (parts[seriesId] || []).filter(p => p.id !== postId);
      setParts(prev => ({ ...prev, [seriesId]: remaining }));

      const { error } = await supabase.from('posts').update({ series_id: null, series_order: null }).eq('id', postId);
      if (error) throw error;

      // Re-index remaining parts in parallel to maintain clean sequential order without gaps
      if (remaining.length > 0) {
        await Promise.all(
          remaining.map((item, idx) =>
            supabase.from('posts').update({ series_order: idx + 1 }).eq('id', item.id)
          )
        );
      }

      showToast('Article removed from series');
      await load();
      await loadAllPosts(searchFilter);
    } catch (err) {
      showToast('Error removing article: ' + (err instanceof Error ? err.message : String(err)));
      await load();
    }
  };

  const move = async (seriesId: string, idx: number, dir: -1 | 1) => {
    try {
      const list = [...(parts[seriesId] || [])];
      const j = idx + dir;
      if (j < 0 || j >= list.length) return;
      [list[idx], list[j]] = [list[j], list[idx]];

      // Instant optimistic state update
      setParts(prev => ({ ...prev, [seriesId]: list }));

      // Parallel batch updates for high responsiveness
      await Promise.all(
        list.map((item, i) =>
          supabase.from('posts').update({ series_order: i + 1 }).eq('id', item.id)
        )
      );

      showToast('Reading order updated');
    } catch (err) {
      showToast('Error reordering: ' + (err instanceof Error ? err.message : String(err)));
      load();
    }
  };

  const remove = async (s: ArticleSeries) => {
    if (!confirm(`Delete series “${s.title}”? All articles stay published and are merely unlinked.`)) return;
    await supabase.from('posts').update({ series_id: null, series_order: null }).eq('series_id', s.id);
    await supabase.from('article_series').delete().eq('id', s.id);
    showToast('Series deleted');
    load();
    loadAllPosts(searchFilter);
  };

  // Executive summary vitals calculation
  const stats = useMemo(() => {
    const totalSeries = series.length;
    const activeSeries = series.filter(s => s.is_active).length;
    const totalCuratedGuides = Object.values(parts).reduce((sum, list) => sum + list.length, 0);
    const unassignedPublished = allPosts.filter(p => !p.series_id && p.status === 'published').length;
    const avgDepth = totalSeries > 0 ? (totalCuratedGuides / totalSeries).toFixed(1) : '0';

    return {
      totalSeries,
      activeSeries,
      totalCuratedGuides,
      unassignedPublished,
      avgDepth
    };
  }, [series, parts, allPosts]);

  // Helper to filter and rank available posts for a specific target series
  const getFilteredAndRankedPosts = (targetSeriesId: string, targetTitle: string, targetDesc?: string) => {
    const assignedIds = new Set((parts[targetSeriesId] || []).map(item => item.id));

    return allPosts.filter(p => {
      // Exclude posts already in this active series
      if (assignedIds.has(p.id)) return false;

      // Status filter
      if (statusFilter === 'published' && p.status !== 'published') return false;
      if (statusFilter === 'draft' && p.status !== 'draft') return false;
      if (statusFilter === 'unassigned' && p.series_id) return false;

      // Search query
      if (searchFilter.trim()) {
        const q = searchFilter.toLowerCase();
        const matchesTitle = p.title.toLowerCase().includes(q);
        const matchesSlug = p.slug && p.slug.toLowerCase().includes(q);
        const matchesTag = p.tags && p.tags.some(t => t.toLowerCase().includes(q));
        return matchesTitle || matchesSlug || matchesTag;
      }

      return true;
    }).map(p => {
      const affinity = computeArticleAffinity(p, targetTitle, targetDesc);
      return {
        ...p,
        affinityScore: affinity.score,
        matchedWords: affinity.matchedWords,
        reasons: affinity.reasons
      };
    });
  };

  return (
    <div className="space-y-6">
      {/* Toast Feedback */}
      {feedbackMsg && (
        <div className="fixed bottom-6 right-6 z-50 bg-charcoal dark:bg-[#202020] text-white text-xs px-4 py-2.5 rounded-sm shadow-xl flex items-center gap-2 animate-fade-in border border-bronze/40">
          <Check size={14} className="text-bronze" /> {feedbackMsg}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl text-charcoal dark:text-cream flex items-center gap-2">
            <Layers size={24} className="text-bronze" /> Editorial Series
          </h1>
          <p className="text-sm text-charcoal-muted dark:text-sand/70 mt-1">
            Curate multi-part comprehensive guides. Readers get linear step navigation, part indexes, and dedicated hub pages.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <a
            href="/series"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 border border-taupe dark:border-white/15 text-charcoal dark:text-cream text-xs tracking-editorial uppercase rounded-sm hover:border-bronze dark:hover:border-bronze transition-colors"
          >
            <ExternalLink size={13} /> View /series
          </a>
          <button
            onClick={() => {
              setEditing({ title: '', slug: '', description: '', cover_image: '', is_active: true });
              setFormPickerOpen(false);
            }}
            className="inline-flex items-center gap-2 px-4 py-2 bg-charcoal dark:bg-[#222222] text-white text-xs tracking-editorial uppercase rounded-sm hover:bg-bronze dark:hover:bg-bronze transition-colors shadow-xs"
          >
            <Plus size={14} /> New Series
          </button>
        </div>
      </div>

      {/* Vitals & Telemetry Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
        <div className="bg-white dark:bg-[#161616] border border-taupe/30 dark:border-white/10 rounded-md p-4 transition-all">
          <div className="flex items-center justify-between">
            <span className="text-[10px] tracking-editorial uppercase text-charcoal-muted dark:text-sand/60">Total Series</span>
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          </div>
          <p className="font-serif text-2xl text-charcoal dark:text-cream font-medium mt-1">{stats.totalSeries}</p>
          <div className="flex items-center gap-2 text-[11px] text-charcoal-muted dark:text-sand/60 mt-0.5">
            <span className="text-emerald-600 dark:text-emerald-400 font-medium">{stats.activeSeries} Active</span>
            <span>·</span>
            <span>{stats.totalSeries - stats.activeSeries} Hidden</span>
          </div>
        </div>

        <div className="bg-white dark:bg-[#161616] border border-taupe/30 dark:border-white/10 rounded-md p-4 transition-all">
          <span className="text-[10px] tracking-editorial uppercase text-charcoal-muted dark:text-sand/60">Guides in Series</span>
          <p className="font-serif text-2xl text-charcoal dark:text-cream font-medium mt-1">{stats.totalCuratedGuides}</p>
          <p className="text-[11px] text-charcoal-muted dark:text-sand/60 mt-0.5">Ordered reading steps across all hubs</p>
        </div>

        <div className="bg-white dark:bg-[#161616] border border-taupe/30 dark:border-white/10 rounded-md p-4 transition-all">
          <div className="flex items-center justify-between">
            <span className="text-[10px] tracking-editorial uppercase text-charcoal-muted dark:text-sand/60">Unlinked Articles</span>
            <button
              type="button"
              onClick={() => setStatusFilter(statusFilter === 'unassigned' ? 'all' : 'unassigned')}
              className="text-[10px] text-bronze dark:text-[#d4af37] hover:underline"
            >
              {statusFilter === 'unassigned' ? 'Clear filter' : 'Filter for these'}
            </button>
          </div>
          <p className="font-serif text-2xl text-charcoal dark:text-cream font-medium mt-1">{stats.unassignedPublished}</p>
          <p className="text-[11px] text-charcoal-muted dark:text-sand/60 mt-0.5">Published stories available for series</p>
        </div>

        <div className="bg-white dark:bg-[#161616] border border-taupe/30 dark:border-white/10 rounded-md p-4 transition-all">
          <span className="text-[10px] tracking-editorial uppercase text-charcoal-muted dark:text-sand/60">Avg Series Depth</span>
          <p className="font-serif text-2xl text-charcoal dark:text-cream font-medium mt-1">{stats.avgDepth}</p>
          <p className="text-[11px] text-charcoal-muted dark:text-sand/60 mt-0.5">Chapters per curated curriculum</p>
        </div>
      </div>

      {/* Series Editor Form */}
      {editing && (
        <form onSubmit={save} className="bg-white dark:bg-[#161616] rounded-md p-6 border border-taupe/40 dark:border-white/10 shadow-sm space-y-5 animate-fade-in">
          <div className="flex items-center justify-between border-b border-taupe/20 dark:border-white/10 pb-3">
            <h2 className="font-serif text-lg text-charcoal dark:text-cream font-medium">
              {editing.id ? 'Edit Series Information' : 'Create New Editorial Series'}
            </h2>
            <button
              type="button"
              onClick={() => {
                setEditing(null);
                setFormPickerOpen(false);
              }}
              className="text-charcoal-muted hover:text-charcoal dark:text-sand/60 dark:hover:text-cream p-1"
            >
              <X size={18} />
            </button>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-[11px] tracking-editorial uppercase text-charcoal-muted dark:text-sand/70 mb-1">
                Series Title *
              </label>
              <input
                required
                value={editing.title || ''}
                onChange={e => {
                  const t = e.target.value;
                  setEditing(x => ({ ...x, title: t, slug: x?.slug || slugify(t) }));
                }}
                placeholder="e.g. The Clean Beauty Formulation Blueprint"
                className="w-full border border-taupe/60 dark:border-white/15 px-3 py-2 text-sm rounded-sm focus:outline-none focus:border-bronze bg-white dark:bg-[#1c1c1c] text-charcoal dark:text-cream"
              />
            </div>
            <div>
              <label className="block text-[11px] tracking-editorial uppercase text-charcoal-muted dark:text-sand/70 mb-1">
                URL Slug (/series/:slug)
              </label>
              <input
                value={editing.slug || ''}
                onChange={e => setEditing(x => ({ ...x, slug: slugify(e.target.value) }))}
                placeholder="clean-beauty-formulation"
                className="w-full border border-taupe/60 dark:border-white/15 px-3 py-2 text-sm rounded-sm focus:outline-none focus:border-bronze font-mono bg-white dark:bg-[#1c1c1c] text-charcoal dark:text-cream"
              />
            </div>
          </div>

          <MarkdownField
            label="Series Editorial Synopsis / Description"
            value={editing.description || ''}
            onChange={v => setEditing(x => ({ ...x, description: v }))}
            rows={3}
            max={800}
            hint="Explain what this series teaches, who it is for, and the learning journey readers will take."
          />

          <AdminImageUploadField
            label="Series Cover Image"
            value={editing.cover_image || ''}
            onChange={url => setEditing(x => ({ ...x, cover_image: url }))}
            folder="series"
            hint="Recommended high-resolution landscape image (1600x900 or 1200x800) for series hero cards."
          />

          <div className="flex items-center gap-3 pt-2">
            <label className="flex items-center gap-2 text-sm cursor-pointer text-charcoal dark:text-cream">
              <input
                type="checkbox"
                checked={editing.is_active ?? true}
                onChange={e => setEditing(x => ({ ...x, is_active: e.target.checked }))}
                className="accent-bronze w-4 h-4"
              />
              <span>Visible to readers on the website and feeds</span>
            </label>
          </div>

          {editing.id && (
            <div className="pt-5 border-t border-taupe/30 dark:border-white/10 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="text-xs font-medium tracking-editorial uppercase text-charcoal dark:text-cream flex items-center gap-2">
                    <FileText size={14} className="text-bronze" /> Guides in this Series ({(parts[editing.id] || []).length})
                  </h3>
                  <p className="text-xs text-charcoal-muted dark:text-sand/60 mt-0.5">
                    Articles will be presented to readers in this sequential reading order.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setFormPickerOpen(!formPickerOpen)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-bronze text-white text-xs font-medium rounded-sm hover:bg-bronze-dark transition-colors self-start"
                >
                  <Plus size={13} /> {formPickerOpen ? 'Close Guide Picker' : 'Add Guides to this Series'}
                </button>
              </div>

              {/* Parts list inside edit form */}
              {(parts[editing.id] || []).length === 0 ? (
                <div className="bg-taupe-light/20 dark:bg-white/[0.02] rounded border border-dashed border-taupe/40 dark:border-white/10 p-6 text-center">
                  <p className="text-xs text-charcoal dark:text-cream font-medium">No guides attached to this series yet.</p>
                  <p className="text-[11px] text-charcoal-muted dark:text-sand/60 mt-1">Click “Add Guides to this Series” above to pick from your published and draft articles.</p>
                </div>
              ) : (
                <div className="bg-white dark:bg-[#1a1a1a] rounded border border-taupe/30 dark:border-white/10 divide-y divide-taupe/20 dark:divide-white/5 max-h-64 overflow-y-auto">
                  {(parts[editing.id] || []).map((p, i) => (
                    <div key={p.id} className="p-3 flex items-center gap-3 hover:bg-taupe-light/20 dark:hover:bg-white/[0.04]">
                      <span className="w-7 h-7 rounded-full bg-bronze/10 text-bronze dark:bg-bronze/20 dark:text-[#e0c283] flex items-center justify-center font-mono text-xs font-bold flex-shrink-0">
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-xs text-charcoal dark:text-cream truncate">{p.title}</p>
                        <p className="text-[10px] text-charcoal-muted dark:text-sand/60">Part {i + 1} of {(parts[editing.id!] || []).length}</p>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          disabled={i === 0}
                          onClick={() => move(editing.id!, i, -1)}
                          className="p-1.5 text-charcoal-muted hover:text-bronze dark:text-sand/60 dark:hover:text-[#d4af37] disabled:opacity-20 rounded"
                          title="Move up"
                        >
                          <ChevronUp size={14} />
                        </button>
                        <button
                          type="button"
                          disabled={i === (parts[editing.id!] || []).length - 1}
                          onClick={() => move(editing.id!, i, 1)}
                          className="p-1.5 text-charcoal-muted hover:text-bronze dark:text-sand/60 dark:hover:text-[#d4af37] disabled:opacity-20 rounded"
                          title="Move down"
                        >
                          <ChevronDown size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => removePart(editing.id!, p.id)}
                          className="p-1.5 text-charcoal-muted hover:text-red-600 dark:text-sand/60 dark:hover:text-red-400 rounded ml-1"
                          title="Remove from series"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Drawer inside edit form */}
              {formPickerOpen && (() => {
                const availableForForm = getFilteredAndRankedPosts(
                  editing.id!,
                  editing.title || '',
                  editing.description || ''
                );
                const recommendations = availableForForm
                  .filter(p => p.matchedWords.length > 0)
                  .sort((a, b) => b.affinityScore - a.affinityScore)
                  .slice(0, 3);

                return (
                  <div className="bg-taupe-light/20 dark:bg-[#1f1f1f] border border-bronze/40 dark:border-bronze/30 rounded-md p-4 space-y-3">
                    <div className="flex items-center justify-between pb-2 border-b border-taupe/20 dark:border-white/10">
                      <p className="text-xs font-semibold text-charcoal dark:text-cream">Select Articles to Add</p>
                      <button
                        type="button"
                        onClick={() => setFormPickerOpen(false)}
                        className="text-xs text-charcoal-muted hover:text-charcoal dark:text-sand/60 dark:hover:text-cream"
                      >
                        <X size={13} />
                      </button>
                    </div>

                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Search size={13} className="absolute left-2.5 top-2.5 text-charcoal-muted dark:text-sand/50" />
                        <input
                          type="text"
                          value={searchFilter}
                          onChange={e => setSearchFilter(e.target.value)}
                          placeholder="Search articles by title or tag..."
                          className="w-full pl-8 pr-3 py-1.5 text-xs border border-taupe/60 dark:border-white/15 rounded bg-white dark:bg-[#141414] text-charcoal dark:text-cream focus:outline-none focus:border-bronze"
                        />
                      </div>
                      <select
                        value={statusFilter}
                        onChange={e => setStatusFilter(e.target.value as never)}
                        className="border border-taupe/60 dark:border-white/15 px-2 py-1.5 text-xs rounded bg-white dark:bg-[#141414] text-charcoal dark:text-cream"
                      >
                        <option value="all">All</option>
                        <option value="published">Published</option>
                        <option value="draft">Drafts</option>
                        <option value="unassigned">Unassigned Only</option>
                      </select>
                    </div>

                    {/* Smart Recommendations Inside Edit Form */}
                    {recommendations.length > 0 && !searchFilter.trim() && (
                      <div className="bg-amber-50/70 dark:bg-amber-950/25 border border-amber-200/80 dark:border-amber-800/40 rounded p-3 space-y-2">
                        <div className="flex items-center gap-1.5 text-xs font-medium text-amber-900 dark:text-amber-200">
                          <Sparkles size={14} className="text-bronze" />
                          <span>Suggested Articles for “{editing.title}”</span>
                          <span className="text-[10px] text-amber-700/80 dark:text-amber-300/80 font-normal ml-auto">
                            Ranked by editorial affinity
                          </span>
                        </div>
                        <div className="divide-y divide-amber-200/50 dark:divide-amber-800/30">
                          {recommendations.map(p => (
                            <div key={`rec-form-${p.id}`} className="py-2 flex items-center justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <p className="text-xs font-medium text-charcoal dark:text-cream truncate">{p.title}</p>
                                  <span className="px-1.5 py-0.5 text-[9px] rounded-full bg-bronze/10 text-bronze dark:bg-bronze/20 dark:text-[#e0c283] font-bold">
                                    {p.affinityScore}% match
                                  </span>
                                </div>
                                <p className="text-[10px] text-charcoal-muted dark:text-sand/60 mt-0.5">
                                  Matched: {p.matchedWords.join(', ')}
                                  {p.series_id && seriesNameMap[p.series_id] && (
                                    <span className="ml-1 text-amber-700 dark:text-amber-400">
                                      (Currently in “{seriesNameMap[p.series_id]}”)
                                    </span>
                                  )}
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => addPart(editing.id!, p.id)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 bg-bronze text-white hover:bg-bronze-dark text-[10px] rounded transition-colors whitespace-nowrap font-medium"
                              >
                                <Plus size={11} /> {p.series_id ? 'Transfer' : 'Add'}
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Available Post Items List */}
                    <div className="max-h-52 overflow-y-auto border border-taupe/30 dark:border-white/10 rounded bg-white dark:bg-[#161616] divide-y divide-taupe/15 dark:divide-white/5">
                      {loadingPosts ? (
                        <div className="py-6 text-center text-xs text-charcoal-muted dark:text-sand/60"><Loader2 size={13} className="animate-spin inline mr-1" /> Loading articles...</div>
                      ) : availableForForm.length === 0 ? (
                        <div className="py-6 text-center text-xs text-charcoal-muted dark:text-sand/60">No matching articles found.</div>
                      ) : (
                        availableForForm.map(post => (
                          <div key={post.id} className="p-2.5 flex items-center justify-between gap-2 hover:bg-taupe-light/30 dark:hover:bg-white/[0.04]">
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-medium text-charcoal dark:text-cream truncate">{post.title}</p>
                              <div className="flex items-center gap-2 text-[10px] text-charcoal-muted dark:text-sand/60 mt-0.5">
                                <span className={post.status === 'published' ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'}>
                                  {post.status}
                                </span>
                                {post.series_id && (
                                  <span className="text-charcoal-muted dark:text-sand/50">
                                    (In “{seriesNameMap[post.series_id] || 'another series'}”)
                                  </span>
                                )}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => addPart(editing.id!, post.id)}
                              className="px-2.5 py-1 bg-charcoal dark:bg-[#252525] text-white hover:bg-bronze dark:hover:bg-bronze text-[10px] rounded transition-colors whitespace-nowrap"
                            >
                              + Add
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          <div className="flex items-center gap-3 pt-3 border-t border-taupe/20 dark:border-white/10">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-bronze text-white text-xs tracking-editorial uppercase rounded-sm hover:bg-bronze-dark disabled:opacity-50 transition-all font-medium"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              {editing.id ? 'Save Changes' : 'Create Series'}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(null);
                setFormPickerOpen(false);
              }}
              className="px-4 py-2.5 text-xs text-charcoal-muted hover:text-charcoal dark:text-sand/60 dark:hover:text-cream tracking-editorial uppercase"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Series List & Parts Management */}
      <div className="space-y-4">
        {series.length === 0 ? (
          <div className="bg-white dark:bg-[#161616] rounded-md border border-taupe/30 dark:border-white/10 p-12 text-center">
            <Layers size={36} className="text-taupe dark:text-white/20 mx-auto mb-3" />
            <h3 className="font-serif text-lg text-charcoal dark:text-cream mb-1">No series created yet</h3>
            <p className="text-sm text-charcoal-muted dark:text-sand/70 mb-4 max-w-md mx-auto">
              Group multi-part editorial guides and tutorials into structured, numbered reading paths.
            </p>
            <button
              onClick={() => setEditing({ title: '', is_active: true })}
              className="inline-flex items-center gap-2 px-4 py-2 bg-charcoal dark:bg-[#252525] text-white text-xs tracking-editorial uppercase rounded-sm hover:bg-bronze transition-colors"
            >
              <Plus size={14} /> Create Your First Series
            </button>
          </div>
        ) : (
          series.map(s => {
            const seriesParts = parts[s.id] || [];
            const isOpen = openSeriesId === s.id;
            const isAdding = cardDrawerId === s.id;

            return (
              <div key={s.id} className="bg-white dark:bg-[#161616] rounded-md border border-taupe/30 dark:border-white/10 shadow-sm overflow-hidden transition-all">
                {/* Series Banner Bar */}
                <div className="p-4 flex items-center gap-4 bg-white dark:bg-[#161616] hover:bg-taupe-light/20 dark:hover:bg-white/[0.03] transition-colors">
                  {s.cover_image ? (
                    <img src={s.cover_image} alt="" className="w-14 h-14 rounded-sm object-cover border border-taupe/30 dark:border-white/10 flex-shrink-0" />
                  ) : (
                    <div className="w-14 h-14 rounded-sm bg-taupe-light dark:bg-white/5 flex items-center justify-center text-bronze dark:text-[#d4af37] flex-shrink-0">
                      <BookOpen size={20} strokeWidth={1.5} />
                    </div>
                  )}

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-serif text-lg text-charcoal dark:text-cream font-medium truncate">{s.title}</h3>
                      {!s.is_active ? (
                        <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-sand rounded">
                          Draft / Hidden
                        </span>
                      ) : (
                        <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 rounded">
                          Published
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-charcoal-muted dark:text-sand/70 mt-1">
                      <span className="font-mono text-bronze dark:text-[#d4af37]">/series/{s.slug}</span>
                      <span>·</span>
                      <span className="font-medium text-charcoal dark:text-cream">{seriesParts.length} {seriesParts.length === 1 ? 'Part' : 'Parts'}</span>
                      {s.description && (
                        <>
                          <span>·</span>
                          <span className="truncate max-w-xs text-charcoal-muted dark:text-sand/50">{s.description}</span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1">
                    {/* Quick Visibility Toggle */}
                    <button
                      type="button"
                      onClick={() => toggleSeriesStatus(s)}
                      className="p-2 text-charcoal-muted hover:text-bronze dark:text-sand/60 dark:hover:text-[#d4af37]"
                      title={s.is_active ? 'Hide series from public site' : 'Publish series on site'}
                    >
                      {s.is_active ? <Eye size={15} /> : <EyeOff size={15} />}
                    </button>

                    <a
                      href={`/series/${s.slug}`}
                      target="_blank"
                      rel="noreferrer"
                      className="p-2 text-charcoal-muted hover:text-bronze dark:text-sand/60 dark:hover:text-[#d4af37]"
                      title="View public series page"
                    >
                      <ExternalLink size={15} />
                    </a>
                    <button
                      onClick={() => {
                        setEditing(s);
                        setFormPickerOpen(false);
                      }}
                      className="p-2 text-charcoal-muted hover:text-bronze dark:text-sand/60 dark:hover:text-[#d4af37]"
                      title="Edit series info"
                      aria-label="Edit series details"
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      onClick={() => remove(s)}
                      className="p-2 text-charcoal-muted hover:text-red-600 dark:text-sand/60 dark:hover:text-red-400"
                      title="Delete series"
                      aria-label="Delete series"
                    >
                      <Trash2 size={15} />
                    </button>
                    <button
                      onClick={() => setOpenSeriesId(isOpen ? null : s.id)}
                      className="p-2 text-charcoal-muted hover:text-charcoal dark:text-sand/60 dark:hover:text-cream ml-1"
                      aria-label={isOpen ? 'Collapse series' : 'Expand series'}
                    >
                      {isOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                    </button>
                  </div>
                </div>

                {/* Series Content & Part List */}
                {isOpen && (
                  <div className="border-t border-taupe/20 dark:border-white/10 bg-taupe-light/10 dark:bg-white/[0.02] p-5 space-y-5">
                    {/* Header of parts section */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div>
                        <h4 className="text-xs font-medium tracking-editorial uppercase text-charcoal dark:text-cream">
                          Series Reading Order ({seriesParts.length} Articles)
                        </h4>
                        <p className="text-xs text-charcoal-muted dark:text-sand/60 mt-0.5">
                          Articles are ordered linearly from first to last guide. Readers navigate next/previous steps sequentially.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setCardDrawerId(isAdding ? null : s.id)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-bronze text-white text-xs font-medium rounded-sm hover:bg-bronze-dark transition-colors self-start"
                      >
                        <Plus size={13} /> {isAdding ? 'Close Article Picker' : 'Add Articles / Guides'}
                      </button>
                    </div>

                    {/* Articles list */}
                    {seriesParts.length === 0 ? (
                      <div className="bg-white dark:bg-[#181818] rounded border border-dashed border-taupe/40 dark:border-white/10 p-8 text-center">
                        <FileText size={24} className="text-charcoal-muted dark:text-sand/40 mx-auto mb-2" />
                        <p className="text-xs text-charcoal dark:text-cream font-medium">No articles assigned to this series yet</p>
                        <p className="text-[11px] text-charcoal-muted dark:text-sand/60 mt-1">
                          Click “Add Articles / Guides” above to attach existing articles or guides into this series.
                        </p>
                      </div>
                    ) : (
                      <div className="bg-white dark:bg-[#181818] rounded border border-taupe/30 dark:border-white/10 divide-y divide-taupe/20 dark:divide-white/5">
                        {seriesParts.map((p, i) => (
                          <div key={p.id} className="p-3.5 flex items-center gap-3 hover:bg-taupe-light/20 dark:hover:bg-white/[0.03] transition-colors">
                            <span className="w-8 h-8 rounded-full bg-bronze/10 text-bronze dark:bg-bronze/20 dark:text-[#e0c283] flex items-center justify-center font-mono text-xs font-bold flex-shrink-0">
                              {String(i + 1).padStart(2, '0')}
                            </span>

                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <a
                                  href={`/admin/articles/edit/${p.id}`}
                                  onClick={e => {
                                    e.preventDefault();
                                    navigate({ name: 'admin-article-edit', id: p.id });
                                  }}
                                  className="font-medium text-sm text-charcoal dark:text-cream hover:text-bronze dark:hover:text-[#d4af37] truncate transition-colors"
                                  title="Open article in admin editor"
                                >
                                  {p.title}
                                </a>
                                {p.status !== 'published' && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 font-medium border border-amber-200 dark:border-amber-800/40">
                                    {p.status}
                                  </span>
                                )}
                              </div>
                              <div className="text-[11px] text-charcoal-muted dark:text-sand/60 flex items-center gap-2 mt-0.5">
                                <span>Part {i + 1} of {seriesParts.length}</span>
                                {p.slug && (
                                  <>
                                    <span>·</span>
                                    <a
                                      href={`/article/${p.slug}`}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="font-mono text-bronze dark:text-[#d4af37] hover:underline inline-flex items-center gap-1"
                                      title="View published article on site"
                                    >
                                      /article/{p.slug} <ExternalLink size={10} />
                                    </a>
                                  </>
                                )}
                              </div>
                            </div>

                            {/* Order adjustment buttons */}
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                disabled={i === 0}
                                onClick={() => move(s.id, i, -1)}
                                className="p-1.5 text-charcoal-muted hover:text-bronze dark:text-sand/60 dark:hover:text-[#d4af37] disabled:opacity-20 rounded"
                                title="Move Part Up"
                              >
                                <ChevronUp size={15} />
                              </button>
                              <button
                                type="button"
                                disabled={i === seriesParts.length - 1}
                                onClick={() => move(s.id, i, 1)}
                                className="p-1.5 text-charcoal-muted hover:text-bronze dark:text-sand/60 dark:hover:text-[#d4af37] disabled:opacity-20 rounded"
                                title="Move Part Down"
                              >
                                <ChevronDown size={15} />
                              </button>
                              <button
                                type="button"
                                onClick={() => removePart(s.id, p.id)}
                                className="p-1.5 text-charcoal-muted hover:text-red-600 dark:text-sand/60 dark:hover:text-red-400 rounded ml-2"
                                title="Remove from this series"
                              >
                                <X size={15} />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Article Selector Drawer */}
                    {isAdding && (() => {
                      const availablePosts = getFilteredAndRankedPosts(s.id, s.title, s.description || '');
                      const suggestions = availablePosts
                        .filter(p => p.matchedWords.length > 0)
                        .sort((a, b) => b.affinityScore - a.affinityScore)
                        .slice(0, 3);

                      return (
                        <div className="bg-white dark:bg-[#181818] border border-bronze/40 dark:border-bronze/30 rounded-md p-4 space-y-4 shadow-md animate-fade-in">
                          <div className="flex items-center justify-between border-b border-taupe/20 dark:border-white/10 pb-2">
                            <div className="flex items-center gap-2">
                              <Plus size={16} className="text-bronze" />
                              <h5 className="font-serif text-sm font-medium text-charcoal dark:text-cream">
                                Select Articles to Add to “{s.title}”
                              </h5>
                            </div>
                            <button
                              type="button"
                              onClick={() => setCardDrawerId(null)}
                              className="text-charcoal-muted hover:text-charcoal dark:text-sand/60 dark:hover:text-cream text-xs"
                            >
                              Close
                            </button>
                          </div>

                          {/* Search & Filter Controls */}
                          <div className="grid sm:grid-cols-3 gap-2">
                            <div className="sm:col-span-2 relative">
                              <Search size={14} className="absolute left-3 top-3 text-charcoal-muted dark:text-sand/50" />
                              <input
                                type="text"
                                value={searchFilter}
                                onChange={e => setSearchFilter(e.target.value)}
                                placeholder="Search by article title, tag or slug…"
                                className="w-full pl-9 pr-8 py-2 border border-taupe/60 dark:border-white/15 text-xs rounded-sm focus:outline-none focus:border-bronze bg-white dark:bg-[#141414] text-charcoal dark:text-cream placeholder-charcoal-muted/60 dark:placeholder-sand/40"
                              />
                              {searchFilter && (
                                <button
                                  type="button"
                                  onClick={() => setSearchFilter('')}
                                  className="absolute right-2.5 top-2.5 text-charcoal-muted hover:text-charcoal dark:text-sand/60 dark:hover:text-cream"
                                >
                                  <X size={12} />
                                </button>
                              )}
                            </div>
                            <div>
                              <select
                                value={statusFilter}
                                onChange={e => setStatusFilter(e.target.value as never)}
                                className="w-full border border-taupe/60 dark:border-white/15 px-3 py-2 text-xs rounded-sm focus:outline-none focus:border-bronze bg-white dark:bg-[#141414] text-charcoal dark:text-cream"
                              >
                                <option value="all">All Statuses</option>
                                <option value="published">Published Only</option>
                                <option value="draft">Drafts Only</option>
                                <option value="unassigned">Unassigned Only</option>
                              </select>
                            </div>
                          </div>

                          {/* Smart Recommendations Section */}
                          {suggestions.length > 0 && !searchFilter.trim() && (
                            <div className="bg-amber-50/70 dark:bg-amber-950/20 border border-amber-200/80 dark:border-amber-800/40 rounded-md p-3.5 space-y-2.5">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-950 dark:text-amber-200">
                                  <Sparkles size={14} className="text-bronze" />
                                  <span>Suggested Articles for “{s.title}”</span>
                                </div>
                                <span className="text-[10px] text-amber-800/70 dark:text-amber-300/70">
                                  Ranked by topical affinity &amp; keywords
                                </span>
                              </div>
                              <div className="divide-y divide-amber-200/50 dark:divide-amber-800/30">
                                {suggestions.map(p => (
                                  <div key={`rec-${p.id}`} className="py-2.5 flex items-center justify-between gap-3">
                                    <div className="min-w-0 flex-1">
                                      <div className="flex items-center gap-2">
                                        <p className="text-xs font-medium text-charcoal dark:text-cream truncate">{p.title}</p>
                                        <span className="px-1.5 py-0.5 text-[9px] rounded-full bg-bronze/10 text-bronze dark:bg-bronze/20 dark:text-[#e0c283] font-bold">
                                          {p.affinityScore}% match
                                        </span>
                                      </div>
                                      <p className="text-[10px] text-charcoal-muted dark:text-sand/60 mt-0.5">
                                        Matched: {p.matchedWords.join(', ')}
                                        {p.series_id && seriesNameMap[p.series_id] && (
                                          <span className="ml-1 text-amber-700 dark:text-amber-400 font-medium">
                                            (Currently in “{seriesNameMap[p.series_id]}”)
                                          </span>
                                        )}
                                      </p>
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => addPart(s.id, p.id)}
                                      className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-bronze text-white hover:bg-bronze-dark text-[11px] rounded transition-colors whitespace-nowrap font-medium shadow-xs"
                                    >
                                      <Plus size={11} /> {p.series_id ? 'Transfer to Series' : 'Add to Series'}
                                    </button>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Available Post Items List */}
                          <div className="max-h-64 overflow-y-auto border border-taupe/30 dark:border-white/10 rounded divide-y divide-taupe/15 dark:divide-white/5 bg-white dark:bg-[#161616]">
                            {loadingPosts ? (
                              <div className="py-8 text-center text-xs text-charcoal-muted dark:text-sand/60 flex items-center justify-center gap-2">
                                <Loader2 size={14} className="animate-spin text-bronze" /> Loading available articles…
                              </div>
                            ) : availablePosts.length === 0 ? (
                              <div className="py-8 text-center text-xs text-charcoal-muted dark:text-sand/60">
                                No matching articles found. Try adjusting your search query or filter.
                              </div>
                            ) : (
                              availablePosts.map(post => (
                                <div
                                  key={post.id}
                                  className="p-3 flex items-center justify-between gap-3 hover:bg-taupe-light/30 dark:hover:bg-white/[0.04] transition-colors"
                                >
                                  <div className="min-w-0 flex-1">
                                    <p className="text-xs font-medium text-charcoal dark:text-cream truncate">{post.title}</p>
                                    <div className="flex items-center gap-2 text-[10px] text-charcoal-muted dark:text-sand/60 mt-0.5">
                                      <span className={post.status === 'published' ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'}>
                                        {post.status}
                                      </span>
                                      {post.series_id && (
                                        <span className="text-charcoal-muted dark:text-sand/50">
                                          (In “{seriesNameMap[post.series_id] || 'another series'}”)
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => addPart(s.id, post.id)}
                                    className="inline-flex items-center gap-1 px-3 py-1.5 bg-charcoal dark:bg-[#252525] text-white hover:bg-bronze dark:hover:bg-bronze text-[11px] rounded transition-colors whitespace-nowrap"
                                  >
                                    <Plus size={12} /> {post.series_id ? 'Transfer' : 'Add to Series'}
                                  </button>
                                </div>
                              ))
                            )}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
