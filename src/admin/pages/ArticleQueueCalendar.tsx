import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import {
  CalendarDays, Check, ChevronLeft, ChevronRight, Loader2, Plus, RefreshCw,
  RotateCcw, Search, Upload,
} from 'lucide-react';
import { useNavigation } from '../../context/NavigationContext';
import { useAuth } from '../../context/AuthContext';
import { useAdminMedia, useCategories } from '../../hooks/useSupabase';
import { supabase } from '../../lib/supabaseClient';
import type { Category, MediaItem } from '../../lib/types';
import { DocxImportError, extractDocxText, sha256Hex, DOCX_IMPORT_LIMITS } from '../../lib/articleDocx';
import {
  addLagosDays,
  countArticleWords,
  isoToLagosInput,
  lagosDateKey,
  lagosDateTimeLabel,
  lagosDayAtTimeToIso,
  lagosInputToIso,
  parseArticleTags,
  slugifyArticleTitle,
  startOfLagosWeek,
  validateIntakeMetadata,
  type IntakeMetadataDraft,
} from '../../lib/articleIntake';

const MAX_DOCX_BATCH = 10;
const MAX_BATCH_BYTES = 60 * 1024 * 1024;
const MAX_INTAKE_ROWS = 500;
const POST_SUMMARY_SELECT = 'id,title,slug,status,scheduled_at,published_at,created_at,category_id,tags,cover_image,cover_image_alt,excerpt,seo_title,seo_description,category:categories(id,name)';

type IntakeStatus = 'queued' | 'rejected';
type CalendarMode = 'list' | 'week' | 'month';
type Panel = 'queue' | 'calendar';

interface ArticleIntakeMeta {
  post_id: string;
  intake_status: IntakeStatus;
  source_filename: string;
  source_sha256: string;
  word_count: number;
  proposed_publish_at: string;
  rejected_at: string | null;
  created_at: string;
  updated_at: string;
}

interface QueuePostSummary {
  id: string;
  title: string;
  slug: string;
  status: 'draft' | 'scheduled' | 'published' | 'archived';
  scheduled_at: string | null;
  published_at: string | null;
  created_at: string;
  category_id: string | null;
  tags: string[] | null;
  cover_image: string | null;
  cover_image_alt: string | null;
  excerpt: string | null;
  seo_title: string | null;
  seo_description: string | null;
  category?: { id: string; name: string } | null;
  author?: { id: string; name: string } | null;
}

interface IntakeRecord {
  meta: ArticleIntakeMeta;
  post: QueuePostSummary;
}

interface ImportDraft {
  id: string;
  file: File;
  sourceSha256: string;
  content: string;
  wordCount: number;
  metadata: IntakeMetadataDraft;
  savedPostId: string | null;
  parseError: string | null;
  saveError: string | null;
  attempted: boolean;
  saving: boolean;
}

interface CalendarRange {
  days: string[];
  start: string;
  end: string;
}

interface CalendarEvent {
  post: QueuePostSummary;
  kind: 'proposal' | 'scheduled' | 'rejected';
  at: string;
  meta?: ArticleIntakeMeta;
}

interface DropRequest {
  event: CalendarEvent;
  date: string;
}

const EMPTY_METADATA = (): IntakeMetadataDraft => ({
  title: '', slug: '', categoryId: '', tags: [], coverImage: '', coverImageAlt: '', proposedAt: '',
});

function makeId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function monthName(day: string): string {
  const date = new Date(`${day}T12:00:00Z`);
  return new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
}

function dateLabel(day: string, options: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric' }): string {
  return new Intl.DateTimeFormat('en-GB', { ...options, timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`));
}

function getCalendarRange(selectedDay: string, mode: CalendarMode): CalendarRange {
  let start: string;
  let end: string;
  if (mode === 'week') {
    start = startOfLagosWeek(selectedDay);
    end = addLagosDays(start, 6);
  } else if (mode === 'month') {
    const date = new Date(`${selectedDay}T12:00:00Z`);
    const first = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-01`;
    const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    const last = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    start = startOfLagosWeek(first);
    const weekStart = startOfLagosWeek(last);
    end = addLagosDays(weekStart, 6);
  } else {
    start = addLagosDays(lagosDateKey(), -30);
    end = addLagosDays(lagosDateKey(), 180);
  }
  const days: string[] = [];
  for (let current = start; current && current <= end; current = addLagosDays(current, 1)) days.push(current);
  return { days, start, end };
}

function safeDateAtLagosMidnight(day: string): string {
  return lagosDayAtTimeToIso(day, '00:00') ?? '';
}

function hasScheduleMetadata(post: QueuePostSummary): boolean {
  return Boolean(post.title.trim() && post.slug.trim() && post.excerpt?.trim() && post.category_id && post.tags?.length
    && post.cover_image?.startsWith('https://') && post.cover_image_alt?.trim()
    && post.seo_title?.trim() && post.seo_title.length <= 70
    && post.seo_description?.trim() && post.seo_description.length <= 160);
}

function probeImage(url: string): Promise<boolean> {
  return new Promise(resolve => {
    const image = new Image();
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
      resolve(ok);
    };
    const timer = window.setTimeout(() => finish(false), 8000);
    image.referrerPolicy = 'no-referrer';
    image.onload = () => finish(image.naturalWidth > 0 && image.naturalHeight > 0);
    image.onerror = () => finish(false);
    image.src = url;
  });
}

function formatImportError(error: unknown): string {
  if (error instanceof DocxImportError) return error.message;
  return 'Could not read DOCX; re-save it.';
}

function ErrorNotice({ message }: { message: string }) {
  return <div role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{message}</div>;
}

function MetadataDateEditor({ record, canWrite, onSaved }: { record: IntakeRecord; canWrite: boolean; onSaved: () => void }) {
  const { meta, post } = record;
  const [value, setValue] = useState(isoToLagosInput(meta.proposed_publish_at));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  useEffect(() => setValue(isoToLagosInput(meta.proposed_publish_at)), [meta.proposed_publish_at]);

  const saveDate = async () => {
    const proposed = lagosInputToIso(value);
    if (!proposed || new Date(proposed).getTime() <= Date.now()) {
      setError('Choose a valid future date and time on your studio clock.');
      return;
    }
    setBusy(true); setError(''); setMessage('');
    try {
      const { data: capacity, error: capacityError } = await supabase.rpc('article_intake_slot_check', {
        p_proposed_publish_at: proposed, p_post_id: post.id,
      });
      if (capacityError || !capacity?.allowed) {
        setError('Date unavailable; choose a future day with room on your studio clock.');
        return;
      }
      const { error: saveError } = await supabase.rpc('article_intake_save', {
        p_post_id: post.id,
        p_source_filename: meta.source_filename,
        p_source_sha256: meta.source_sha256,
        p_word_count: meta.word_count,
        p_proposed_publish_at: proposed,
      });
      if (saveError) {
        setError('The proposed date was not saved. It may be in the past or the two-article day limit may be full.');
        return;
      }
      setMessage(meta.intake_status === 'rejected' ? 'Date saved and item restored to the queue.' : 'Proposed publication time saved.');
      onSaved();
    } catch {
      setError('The proposed date could not be saved. Check your connection and try again.');
    } finally { setBusy(false); }
  };

  return (
    <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
      <label className="block flex-1 text-xs font-medium text-gray-600">
        Proposed date and time (studio clock)
        <input type="datetime-local" value={value} onChange={e => { setValue(e.target.value); setError(''); setMessage(''); }} disabled={!canWrite || busy || post.status !== 'draft'} className="mt-1 min-h-11 w-full rounded border border-gray-300 bg-white px-3 text-sm text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bronze disabled:bg-gray-100" />
      </label>
      <button type="button" onClick={() => void saveDate()} disabled={!canWrite || busy || post.status !== 'draft'} className="min-h-11 rounded border border-gray-300 px-4 text-sm font-medium text-charcoal hover:border-bronze disabled:cursor-not-allowed disabled:opacity-50">
        {busy ? 'Saving…' : meta.intake_status === 'rejected' ? 'Save date & reopen' : 'Save proposed date'}
      </button>
      {error && <p role="alert" className="text-xs text-red-700 sm:basis-full">{error}</p>}
      {message && <p role="status" className="text-xs text-green-700 sm:basis-full">{message}</p>}
    </div>
  );
}

function QueueRecordCard({ record, canWrite, onChanged, navigate }: {
  record: IntakeRecord;
  canWrite: boolean;
  onChanged: () => void;
  navigate: ReturnType<typeof useNavigation>['navigate'];
}) {
  const { meta, post } = record;
  const scheduleMetadataReady = hasScheduleMetadata(post);
  const reuploadInput = useRef<HTMLInputElement>(null);
  const [replacement, setReplacement] = useState<{ filename: string; sha: string; text: string; words: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const reject = async () => {
    if (!window.confirm(`Reject “${post.title}” from the intake queue? Its draft and article text will be kept; nothing will be published.`)) return;
    setBusy(true); setError(''); setNotice('');
    const { error: rejectError } = await supabase.rpc('article_intake_reject', { p_post_id: post.id });
    if (rejectError) setError('This item could not be rejected. It may already be scheduled or your write access changed.');
    else { setNotice('Rejected. The draft text is retained and the proposed day is released.'); onChanged(); }
    setBusy(false);
  };

  const reopen = async () => {
    setBusy(true); setError(''); setNotice('');
    const { error: reopenError } = await supabase.rpc('article_intake_reopen', { p_post_id: post.id });
    if (reopenError) setError('This item could not be reopened. Choose a future date with an available slot first.');
    else { setNotice('Item restored to the queue.'); onChanged(); }
    setBusy(false);
  };

  const parseReplacement = async (file: File) => {
    setError(''); setNotice(''); setReplacement(null);
    if (!file.name.toLowerCase().endsWith('.docx') || file.size > DOCX_IMPORT_LIMITS.maxFileBytes) {
      setError('Choose a .docx file no larger than 15 MB.');
      return;
    }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const [text, sha] = await Promise.all([extractDocxText(bytes), sha256Hex(bytes)]);
      setReplacement({ filename: file.name, sha, text, words: countArticleWords(text) });
    } catch (parseError) { setError(formatImportError(parseError)); }
  };

  const replaceText = async () => {
    if (!replacement || !canWrite || post.status !== 'draft' || meta.intake_status !== 'queued') return;
    if (!window.confirm(`Replace the saved article text for “${post.title}” with the exact text extracted from ${replacement.filename}? This is an explicit owner/editor edit; the existing editor revision history will retain the previous text.`)) return;
    setBusy(true); setError(''); setNotice('');
    const { error: updateError } = await supabase.from('posts').update({
      content: replacement.text,
      word_count: replacement.words,
      reading_time_minutes: Math.max(1, Math.ceil(replacement.words / 220)),
    }).eq('id', post.id).eq('status', 'draft');
    if (updateError) {
      setError('Text not replaced; confirm this is still a draft.');
      setBusy(false);
      return;
    }
    const { error: registerError } = await supabase.rpc('article_intake_save', {
      p_post_id: post.id,
      p_source_filename: replacement.filename,
      p_source_sha256: replacement.sha,
      p_word_count: replacement.words,
      p_proposed_publish_at: meta.proposed_publish_at,
    });
    if (registerError) {
      setError('The new prose was saved through your explicit re-upload, but its source record could not be refreshed. The editor history still holds the previous version; ask an owner to retry intake registration.');
      setBusy(false);
      return;
    }
    setNotice(`Re-uploaded exactly as supplied (${replacement.words.toLocaleString()} words). Article text was not rewritten.`);
    setReplacement(null);
    onChanged();
    setBusy(false);
  };

  return (
    <article className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        {post.cover_image && <img src={post.cover_image} alt={post.cover_image_alt || ''} referrerPolicy="no-referrer" className="h-20 w-20 shrink-0 rounded object-cover" />}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${meta.intake_status === 'queued' ? 'bg-amber-50 text-amber-800' : 'bg-gray-100 text-gray-700'}`}>
              {meta.intake_status === 'queued' ? 'Queued draft' : 'Rejected — retained'}
            </span>
            {post.status === 'scheduled' && <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-800">Scheduled</span>}
            {meta.intake_status === 'queued' && post.status === 'draft' && <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${scheduleMetadataReady ? 'bg-green-50 text-green-800' : 'bg-orange-50 text-orange-800'}`}>{scheduleMetadataReady ? 'Metadata ready' : 'Needs metadata'}</span>}
            <span className="text-xs text-gray-500">{meta.word_count.toLocaleString()} words</span>
          </div>
          <h3 className="mt-2 break-words font-serif text-xl text-gray-900">{post.title}</h3>
          <p className="mt-1 text-sm text-gray-600">{post.category?.name || 'No category'} · {post.tags?.length ? post.tags.join(', ') : 'No tags'}</p>
          <p className="mt-1 break-all text-xs text-gray-500">Source: {meta.source_filename} · /blog/{post.slug}</p>
          <p className="mt-1 text-sm text-gray-700">
            {post.status === 'scheduled' && post.scheduled_at
              ? `Scheduled: ${lagosDateTimeLabel(post.scheduled_at)}`
              : `Proposed: ${lagosDateTimeLabel(meta.proposed_publish_at)}`}
          </p>
          {post.excerpt && <p className="mt-2 line-clamp-2 text-sm text-gray-600">{post.excerpt}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => navigate({ name: 'admin-article-edit', id: post.id })} className="min-h-11 rounded bg-charcoal px-4 text-sm font-medium text-white hover:bg-bronze">Edit article</button>
            {meta.intake_status === 'queued' && post.status === 'draft' && canWrite && <button type="button" onClick={() => void reject()} disabled={busy} className="min-h-11 rounded border border-gray-300 px-4 text-sm text-gray-700 hover:border-red-400 hover:text-red-700 disabled:opacity-50">Reject item</button>}
            {meta.intake_status === 'rejected' && post.status === 'draft' && canWrite && <button type="button" onClick={() => void reopen()} disabled={busy} className="min-h-11 inline-flex items-center gap-2 rounded border border-gray-300 px-4 text-sm text-gray-700 hover:border-bronze disabled:opacity-50"><RotateCcw size={14} /> Reopen</button>}
            {meta.intake_status === 'queued' && post.status === 'draft' && canWrite && <>
              <button type="button" onClick={() => reuploadInput.current?.click()} disabled={busy} className="min-h-11 inline-flex items-center gap-2 rounded border border-gray-300 px-4 text-sm text-gray-700 hover:border-bronze disabled:opacity-50"><Upload size={14} /> Choose replacement DOCX</button>
              <input ref={reuploadInput} type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="sr-only" aria-label={`Choose replacement DOCX for ${post.title}`} onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void parseReplacement(file); }} />
            </>}
          </div>
          {replacement && <div className="mt-3 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
            <p>Replacement text ready: {replacement.filename} · {replacement.words.toLocaleString()} words. It will be used exactly as extracted.</p>
            <button type="button" onClick={() => void replaceText()} disabled={busy} className="mt-2 min-h-11 rounded bg-amber-800 px-4 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Replacing…' : 'Replace article prose'}</button>
          </div>}
          {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
          {notice && <p role="status" className="mt-2 text-sm text-green-700">{notice}</p>}
        </div>
      </div>
      {post.status === 'draft' && canWrite && <MetadataDateEditor record={record} canWrite={canWrite} onSaved={onChanged} />}
    </article>
  );
}

function CalendarEventCard({ event, canMove, onEdit, onDragStart }: {
  event: CalendarEvent;
  canMove: boolean;
  onEdit: (id: string) => void;
  onDragStart: (event: DragEvent<HTMLButtonElement>, item: CalendarEvent) => void;
}) {
  const label = event.kind === 'scheduled' ? 'Scheduled' : event.kind === 'rejected' ? 'Rejected' : 'Draft proposal';
  const tone = event.kind === 'scheduled' ? 'border-blue-200 bg-blue-50 text-blue-950' : event.kind === 'rejected' ? 'border-gray-200 bg-gray-100 text-gray-700' : 'border-amber-200 bg-amber-50 text-amber-950';
  return (
    <div className={`mb-1 rounded border px-2 py-1.5 text-left text-xs ${tone}`}>
      <button type="button" draggable={canMove} onDragStart={e => onDragStart(e, event)} onClick={() => onEdit(event.post.id)} className="min-h-11 w-full break-words text-left font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bronze" aria-label={`${label} article: ${event.post.title}. Open editor.`}>
        <span className="block">{label} · {event.post.title}</span>
        <span className="mt-0.5 block font-normal opacity-75">{lagosDateTimeLabel(event.at)}</span>
      </button>
    </div>
  );
}

export default function ArticleQueueCalendar() {
  const { navigate } = useNavigation();
  const { can } = useAuth();
  const { categories } = useCategories();
  const { media, loading: mediaLoading } = useAdminMedia();
  const canWrite = can('content.write');
  const canPublish = can('content.publish');
  const [panel, setPanel] = useState<Panel>('queue');
  const [imports, setImports] = useState<ImportDraft[]>([]);
  const [importing, setImporting] = useState(false);
  const [queue, setQueue] = useState<IntakeRecord[]>([]);
  const [scheduled, setScheduled] = useState<QueuePostSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'queued' | 'rejected' | 'scheduled'>('all');
  const [calendarMode, setCalendarMode] = useState<CalendarMode>('month');
  const [selectedDay, setSelectedDay] = useState(lagosDateKey());
  const [dropRequest, setDropRequest] = useState<DropRequest | null>(null);
  const [dropBusy, setDropBusy] = useState(false);
  const [dropError, setDropError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const range = useMemo(() => getCalendarRange(selectedDay, calendarMode), [selectedDay, calendarMode]);

  const refreshQueue = useCallback(async (showSpinner = false) => {
    if (showSpinner) setRefreshing(true);
    setLoadError('');
    try {
      const { data: metaRows, error: metaError } = await supabase
        .from('article_intake_items')
        .select('post_id,intake_status,source_filename,source_sha256,word_count,proposed_publish_at,rejected_at,created_at,updated_at')
        .order('created_at', { ascending: false }).limit(MAX_INTAKE_ROWS);
      if (metaError) throw metaError;
      const safeMeta = (metaRows || []) as unknown as ArticleIntakeMeta[];
      if (safeMeta.length === 0) { setQueue([]); return; }
      const { data: postRows, error: postError } = await supabase
        .from('posts').select(POST_SUMMARY_SELECT).in('id', safeMeta.map(row => row.post_id)).limit(MAX_INTAKE_ROWS);
      if (postError) throw postError;
      const posts = (postRows || []) as unknown as QueuePostSummary[];
      const byId = new Map(posts.map(post => [post.id, post]));
      setQueue(safeMeta.flatMap(meta => {
        const post = byId.get(meta.post_id);
        return post ? [{ meta, post }] : [];
      }));
    } catch {
      setLoadError('Cannot load queue. Check content access and the database migration.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const refreshScheduled = useCallback(async () => {
    if (panel !== 'calendar') return;
    setScheduleLoading(true);
    const from = safeDateAtLagosMidnight(range.start);
    const until = safeDateAtLagosMidnight(addLagosDays(range.end, 1));
    try {
      const { data, error } = await supabase.from('posts').select(POST_SUMMARY_SELECT)
        .eq('status', 'scheduled').not('scheduled_at', 'is', null)
        .gte('scheduled_at', from).lt('scheduled_at', until)
        .order('scheduled_at', { ascending: true }).limit(MAX_INTAKE_ROWS);
      if (error) throw error;
      setScheduled((data || []) as unknown as QueuePostSummary[]);
    } catch {
      setLoadError('Cannot load scheduled articles; drafts are unchanged.');
    } finally { setScheduleLoading(false); }
  }, [panel, range]);

  useEffect(() => { void refreshQueue(); }, [refreshQueue]);
  useEffect(() => { void refreshScheduled(); }, [refreshScheduled]);

  const handleFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files || []);
    event.target.value = '';
    if (!selected.length) return;
    if (selected.length > MAX_DOCX_BATCH || selected.length + imports.length > MAX_DOCX_BATCH) {
      setNotice(`Choose no more than ${MAX_DOCX_BATCH} DOCX files in one import batch.`);
      return;
    }
    const totalBytes = selected.reduce((sum, file) => sum + file.size, imports.reduce((batch, row) => batch + row.file.size, 0));
    if (totalBytes > MAX_BATCH_BYTES) { setNotice('The combined DOCX batch must be 60 MB or smaller.'); return; }
    setImporting(true); setNotice('');
    const parsed = await Promise.all(selected.map(async file => {
      const id = makeId();
      if (!file.name.toLowerCase().endsWith('.docx')) {
        return { id, file, sourceSha256: '', content: '', wordCount: 0, metadata: EMPTY_METADATA(), savedPostId: null, parseError: 'Choose a Microsoft Word .docx file.', saveError: null, attempted: false, saving: false } satisfies ImportDraft;
      }
      if (file.size > DOCX_IMPORT_LIMITS.maxFileBytes) {
        return { id, file, sourceSha256: '', content: '', wordCount: 0, metadata: EMPTY_METADATA(), savedPostId: null, parseError: 'Each DOCX must be 15 MB or smaller.', saveError: null, attempted: false, saving: false } satisfies ImportDraft;
      }
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const [content, sourceSha256] = await Promise.all([extractDocxText(bytes), sha256Hex(bytes)]);
        return { id, file, sourceSha256, content, wordCount: countArticleWords(content), metadata: EMPTY_METADATA(), savedPostId: null, parseError: null, saveError: null, attempted: false, saving: false } satisfies ImportDraft;
      } catch (error) {
        return { id, file, sourceSha256: '', content: '', wordCount: 0, metadata: EMPTY_METADATA(), savedPostId: null, parseError: formatImportError(error), saveError: null, attempted: false, saving: false } satisfies ImportDraft;
      }
    }));
    setImports(current => [...current, ...parsed]);
    setImporting(false);
  };

  const updateDraft = (id: string, change: Partial<ImportDraft>) => {
    setImports(current => current.map(row => row.id === id ? { ...row, ...change } : row));
  };
  const updateMetadata = (id: string, change: Partial<IntakeMetadataDraft>) => {
    setImports(current => current.map(row => row.id === id ? { ...row, metadata: { ...row.metadata, ...change }, saveError: null } : row));
  };



  const saveImport = async (row: ImportDraft) => {
    updateDraft(row.id, { attempted: true, saving: true, saveError: null });
    const issues = validateIntakeMetadata(row.metadata, row.wordCount, [], new Date());
    if (row.parseError || issues.some(issue => issue.severity === 'error')) {
      updateDraft(row.id, { attempted: true, saving: false, saveError: row.parseError || 'Correct the highlighted fields before saving.' });
      return;
    }
    const proposed = lagosInputToIso(row.metadata.proposedAt);
    if (!proposed) { updateDraft(row.id, { saving: false, saveError: 'Choose a valid future date and time on your studio clock.' }); return; }

    const slug = row.metadata.slug.trim().toLowerCase();
    try {
      let slugQuery = supabase.from('posts').select('id').eq('slug', slug).limit(1);
      if (row.savedPostId) slugQuery = slugQuery.neq('id', row.savedPostId);
      const { data: duplicateRows, error: duplicateError } = await slugQuery;
      if (duplicateError) throw duplicateError;
      if ((duplicateRows || []).length > 0) {
        updateDraft(row.id, { attempted: true, saving: false, saveError: 'That slug is already used by another article. Change it before saving.' });
        return;
      }
      const imageOk = await probeImage(row.metadata.coverImage.trim());
      if (!imageOk) {
        updateDraft(row.id, { attempted: true, saving: false, saveError: 'The selected cover image could not be loaded. Choose or upload a working image before saving.' });
        return;
      }
      const { data: slot, error: slotError } = await supabase.rpc('article_intake_slot_check', {
        p_proposed_publish_at: proposed,
        p_post_id: row.savedPostId,
      });
      if (slotError || !slot?.allowed) {
        updateDraft(row.id, { attempted: true, saving: false, saveError: 'That date is past, full, or could not be checked on your studio clock. Choose a future day with fewer than two articles.' });
        return;
      }

      const values = {
        title: row.metadata.title.trim(),
        slug,
        excerpt: null,
        category_id: row.metadata.categoryId,
        tags: row.metadata.tags.map(tag => tag.trim().toLowerCase()).filter(Boolean),
        cover_image: row.metadata.coverImage.trim(),
        cover_image_alt: row.metadata.coverImageAlt.trim(),
        seo_title: null,
        seo_description: null,
        status: 'draft',
        workflow_status: 'draft',
        scheduled_at: null,
        published_at: new Date().toISOString(),
        word_count: row.wordCount,
        reading_time_minutes: Math.max(1, Math.ceil(row.wordCount / 220)),
      };
      let postId = row.savedPostId;
      if (!postId) {
        const { data, error: insertError } = await supabase.from('posts')
          .insert({ ...values, content: row.content }).select('id').single();
        if (insertError || !data) throw insertError || new Error('draft_insert_failed');
        postId = data.id as string;
        updateDraft(row.id, { savedPostId: postId });
      } else {
        const { error: updateError } = await supabase.from('posts').update(values)
          .eq('id', postId).eq('status', 'draft');
        if (updateError) throw updateError;
      }
      const { error: intakeError } = await supabase.rpc('article_intake_save', {
        p_post_id: postId,
        p_source_filename: row.file.name,
        p_source_sha256: row.sourceSha256,
        p_word_count: row.wordCount,
        p_proposed_publish_at: proposed,
      });
      if (intakeError) {
        updateDraft(row.id, { attempted: true, saving: false, saveError: 'The draft is safely saved, but queue registration did not finish. Correct the date if needed and retry; article text was not changed.' });
        return;
      }
      setImports(current => current.filter(item => item.id !== row.id));
      setNotice(`“${values.title}” was added as an unpublished draft. Its prose was imported exactly as supplied.`);
      await refreshQueue();
    } catch {
      updateDraft(row.id, { attempted: true, saving: false, saveError: 'The draft could not be saved. Check your access, slug, image and connection, then retry.' });
    }
  };

  const events = useMemo(() => {
    const byId = new Map<string, CalendarEvent>();
    for (const record of queue) {
      if (record.post.status !== 'draft') continue;
      if (record.meta.intake_status === 'rejected') {
        if (statusFilter === 'rejected') byId.set(record.post.id, { post: record.post, kind: 'rejected', at: record.meta.proposed_publish_at, meta: record.meta });
      } else {
        byId.set(record.post.id, { post: record.post, kind: 'proposal', at: record.meta.proposed_publish_at, meta: record.meta });
      }
    }
    for (const post of scheduled) {
      if (!post.scheduled_at) continue;
      byId.set(post.id, { post, kind: 'scheduled', at: post.scheduled_at });
    }
    return [...byId.values()].filter(item => {
      const day = lagosDateKey(item.at);
      if (day < range.start || day > range.end) return false;
      if (categoryFilter !== 'all' && item.post.category_id !== categoryFilter) return false;
      if (statusFilter === 'queued' && item.kind !== 'proposal') return false;
      if (statusFilter === 'scheduled' && item.kind !== 'scheduled') return false;
      if (statusFilter === 'rejected' && item.kind !== 'rejected') return false;
      const q = search.trim().toLowerCase();
      if (q && !`${item.post.title} ${item.post.slug} ${item.post.category?.name || ''}`.toLowerCase().includes(q)) return false;
      return true;
    }).sort((a, b) => a.at.localeCompare(b.at));
  }, [queue, scheduled, range, categoryFilter, statusFilter, search]);

  const filteredQueue = useMemo(() => queue.filter(({ meta, post }) => {
    if (categoryFilter !== 'all' && post.category_id !== categoryFilter) return false;
    if (statusFilter === 'queued' && meta.intake_status !== 'queued') return false;
    if (statusFilter === 'rejected' && meta.intake_status !== 'rejected') return false;
    if (statusFilter === 'scheduled' && post.status !== 'scheduled') return false;
    const q = search.trim().toLowerCase();
    return !q || `${post.title} ${post.slug} ${post.category?.name || ''} ${meta.source_filename}`.toLowerCase().includes(q);
  }), [queue, categoryFilter, statusFilter, search]);

  const moveCalendar = (amount: number) => {
    const anchor = calendarMode === 'month'
      ? (() => {
          const d = new Date(`${selectedDay}T12:00:00Z`);
          return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + amount, 1)).toISOString().slice(0, 10);
        })()
      : addLagosDays(selectedDay, calendarMode === 'week' ? amount * 7 : amount);
    setSelectedDay(anchor);
  };

  const startDrag = (event: DragEvent<HTMLButtonElement>, item: CalendarEvent) => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', item.post.id);
  };

  const dropOnDate = (event: DragEvent<HTMLDivElement>, day: string) => {
    event.preventDefault();
    const id = event.dataTransfer.getData('text/plain');
    const item = events.find(candidate => candidate.post.id === id);
    if (!item || item.kind === 'rejected' || (item.kind === 'scheduled' && !canPublish) || (item.kind === 'proposal' && !canWrite) || lagosDateKey(item.at) === day) return;
    setDropError('');
    setDropRequest({ event: item, date: day });
  };

  const confirmReschedule = async () => {
    if (!dropRequest) return;
    const { event, date } = dropRequest;
    if (event.kind === 'rejected') { setDropError('Rejected items cannot be moved. Reopen the draft from the queue first.'); return; }
    const wallTime = isoToLagosInput(event.at).split('T')[1] || '08:00';
    const proposed = lagosDayAtTimeToIso(date, wallTime);
    if (!proposed || new Date(proposed).getTime() <= Date.now()) { setDropError('Choose a future date and time on your studio clock.'); return; }
    setDropBusy(true); setDropError('');
    try {
      if (event.kind === 'proposal' && event.meta) {
        const { error } = await supabase.rpc('article_intake_save', {
          p_post_id: event.post.id,
          p_source_filename: event.meta.source_filename,
          p_source_sha256: event.meta.source_sha256,
          p_word_count: event.meta.word_count,
          p_proposed_publish_at: proposed,
        });
        if (error) throw error;
      } else {
        const { error } = await supabase.from('posts').update({ scheduled_at: proposed, published_at: proposed })
          .eq('id', event.post.id).eq('status', 'scheduled');
        if (error) throw error;
      }
      setDropRequest(null);
      setNotice(`“${event.post.title}” was rescheduled to ${lagosDateTimeLabel(proposed)}.`);
      await Promise.all([refreshQueue(), refreshScheduled()]);
    } catch {
      setDropError('Reschedule failed; capacity or your permission may block it.');
    } finally { setDropBusy(false); }
  };

  const goToToday = () => setSelectedDay(lagosDateKey());

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-bronze"><CalendarDays size={18} aria-hidden="true" /><span className="text-xs font-semibold uppercase tracking-[0.18em]">Editorial workflow</span></div>
          <h1 className="font-serif text-3xl text-charcoal">Article intake & calendar</h1>
          <p className="mt-2 max-w-3xl text-sm text-gray-600">Owner-written article prose only.</p>
        </div>
        <button type="button" onClick={() => void Promise.all([refreshQueue(true), refreshScheduled()])} disabled={refreshing || loading} className="inline-flex min-h-11 items-center justify-center gap-2 rounded border border-gray-300 bg-white px-4 text-sm text-charcoal hover:border-bronze disabled:opacity-50"><RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} /> Refresh</button>
      </header>

      {notice && <div role="status" className="flex items-center gap-2 rounded border border-green-200 bg-green-50 p-3 text-sm text-green-900"><Check size={16} />{notice}<button type="button" className="ml-auto min-h-11 px-3 text-xs underline" onClick={() => setNotice('')}>Dismiss</button></div>}
      {loadError && <ErrorNotice message={loadError} />}

      <div className="flex flex-wrap gap-2 border-b border-gray-200" role="tablist" aria-label="Article intake views">
        <button type="button" role="tab" aria-selected={panel === 'queue'} onClick={() => setPanel('queue')} className={`min-h-11 border-b-2 px-4 text-sm font-medium ${panel === 'queue' ? 'border-bronze text-bronze' : 'border-transparent text-gray-600 hover:text-charcoal'}`}>DOCX queue ({queue.length})</button>
        <button type="button" role="tab" aria-selected={panel === 'calendar'} onClick={() => setPanel('calendar')} className={`min-h-11 border-b-2 px-4 text-sm font-medium ${panel === 'calendar' ? 'border-bronze text-bronze' : 'border-transparent text-gray-600 hover:text-charcoal'}`}>Calendar</button>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <label className="relative min-w-[220px] flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden="true" />
          <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search title, slug or source…" aria-label="Search intake and calendar articles" className="min-h-11 w-full rounded border border-gray-300 bg-white pl-10 pr-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bronze" />
        </label>
        <label className="text-sm text-gray-700">Category
          <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} className="ml-2 min-h-11 rounded border border-gray-300 bg-white px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bronze"><option value="all">All categories</option>{categories.map((category: Category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select>
        </label>
        <label className="text-sm text-gray-700">Status
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as typeof statusFilter)} className="ml-2 min-h-11 rounded border border-gray-300 bg-white px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bronze"><option value="all">All</option><option value="queued">Queued drafts</option><option value="rejected">Rejected</option><option value="scheduled">Scheduled</option></select>
        </label>
      </div>

      {panel === 'queue' ? (
        <section aria-label="DOCX article queue" className="space-y-5">
          <div className="rounded-lg border border-gray-200 bg-white p-4 sm:p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div><h2 className="font-serif text-xl text-gray-900">Import owner-authored DOCX</h2><p className="mt-1 text-sm text-gray-600">Ten DOCX max per batch (15 MB each). Add excerpt and SEO in Edit article before scheduling.</p></div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => fileInput.current?.click()} disabled={!canWrite || importing || imports.length >= MAX_DOCX_BATCH} className="min-h-11 inline-flex items-center gap-2 rounded bg-bronze px-4 text-sm font-semibold text-white hover:bg-bronze-dark disabled:cursor-not-allowed disabled:opacity-50"><Plus size={16} /> Choose DOCX files</button>
                <input ref={fileInput} type="file" multiple accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={e => void handleFiles(e)} disabled={!canWrite || importing || imports.length >= MAX_DOCX_BATCH} className="sr-only" aria-label="Choose up to ten owner-authored DOCX files" />
              </div>
            </div>
            {!canWrite && <p className="mt-3 text-sm text-amber-800">Your role can read the calendar but cannot add or edit article drafts. Ask an owner for content.write.</p>}
          </div>

          {importing && <div role="status" className="flex items-center gap-2 text-sm text-gray-600"><Loader2 size={16} className="animate-spin" />Extracting text locally in this browser…</div>}
          {imports.map(row => {
            const validation = validateIntakeMetadata(row.metadata, row.wordCount, [], new Date());
            const errors = validation.filter(issue => issue.severity === 'error');
            const warnings = validation.filter(issue => issue.severity === 'warning');
            const mediaOptions = media.filter((item: MediaItem) => !item.mime_type || item.mime_type.startsWith('image/'));
            const selectedMedia = mediaOptions.find((item: MediaItem) => item.url === row.metadata.coverImage);
            return (
              <article key={row.id} className="rounded-lg border border-gray-200 bg-white p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0"><h3 className="break-all font-medium text-gray-900">{row.file.name}</h3><p className="mt-1 text-xs text-gray-500">{(row.file.size / (1024 * 1024)).toFixed(1)} MB · {row.wordCount.toLocaleString()} words</p></div>
                  <button type="button" onClick={() => setImports(current => current.filter(item => item.id !== row.id))} className="min-h-11 min-w-11 rounded border border-gray-200 text-xl text-gray-500 hover:text-red-700" aria-label={`Remove unsaved ${row.file.name} from this batch`}>×</button>
                </div>
                {row.parseError ? <ErrorNotice message={row.parseError} /> : <>
                  <details className="mt-3 rounded border border-gray-100 bg-gray-50 p-3 text-xs text-gray-600"><summary className="min-h-11 cursor-pointer pt-3 font-medium text-gray-700">Review extracted text (read-only)</summary><pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words font-sans">{row.content.slice(0, 4000)}{row.content.length > 4000 ? '\n… preview limited; saved text remains complete and unchanged.' : ''}</pre></details>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <label className="text-sm font-medium text-gray-700">Owner-written title
                      <input value={row.metadata.title} maxLength={200} onChange={e => {
                        const title = e.target.value;
                        const oldSlug = slugifyArticleTitle(row.metadata.title);
                        updateMetadata(row.id, { title, slug: !row.metadata.slug || row.metadata.slug === oldSlug ? slugifyArticleTitle(title) : row.metadata.slug });
                      }} disabled={!canWrite || row.saving} className="mt-1 min-h-11 w-full rounded border border-gray-300 px-3 text-sm" />
                    </label>
                    <label className="text-sm font-medium text-gray-700">URL slug
                      <input value={row.metadata.slug} maxLength={180} onChange={e => updateMetadata(row.id, { slug: e.target.value.toLowerCase() })} disabled={!canWrite || row.saving} className="mt-1 min-h-11 w-full rounded border border-gray-300 px-3 text-sm" />
                    </label>
                    <label className="text-sm font-medium text-gray-700">Category
                      <select value={row.metadata.categoryId} onChange={e => updateMetadata(row.id, { categoryId: e.target.value })} disabled={!canWrite || row.saving} className="mt-1 min-h-11 w-full rounded border border-gray-300 bg-white px-3 text-sm"><option value="">Choose category…</option>{categories.filter((category: Category) => category.is_active).map((category: Category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select>
                    </label>
                    <label className="text-sm font-medium text-gray-700 sm:col-span-2">Tags (comma-separated)
                      <input value={row.metadata.tags.join(', ')} onChange={e => updateMetadata(row.id, { tags: parseArticleTags(e.target.value) })} disabled={!canWrite || row.saving} placeholder="style, wellness" className="mt-1 min-h-11 w-full rounded border border-gray-300 px-3 text-sm" />
                    </label>
                    <div className="sm:col-span-2">
                      <label className="block text-sm font-medium text-gray-700">Cover image
                        <select value={row.metadata.coverImage} onChange={e => {
                          const image = mediaOptions.find((item: MediaItem) => item.url === e.target.value);
                          updateMetadata(row.id, { coverImage: e.target.value, coverImageAlt: image?.alt_text || row.metadata.coverImageAlt });
                        }} disabled={!canWrite || row.saving} className="mt-1 min-h-11 w-full rounded border border-gray-300 bg-white px-3 text-sm"><option value="">Choose from Media library…</option>{mediaOptions.map((item: MediaItem) => <option key={item.id} value={item.url}>{item.title || item.file_name || item.url}</option>)}</select>
                      </label>
                      <div className="mt-2 flex flex-wrap items-center gap-3">
                        {selectedMedia && <img src={selectedMedia.url} alt="" referrerPolicy="no-referrer" className="h-14 w-14 rounded object-cover" />}
                        {can('media.write') && <a href="/admin/media" target="_blank" rel="noreferrer" className="min-h-11 rounded border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:border-bronze">Media library; return to refresh</a>}
                        {mediaLoading && <span className="text-xs text-gray-500">Loading media…</span>}
                      </div>
                      <label className="mt-2 block text-sm font-medium text-gray-700">Owner-written image alt text
                        <input value={row.metadata.coverImageAlt} maxLength={250} onChange={e => updateMetadata(row.id, { coverImageAlt: e.target.value })} disabled={!canWrite || row.saving} className="mt-1 min-h-11 w-full rounded border border-gray-300 px-3 text-sm" />
                      </label>
                    </div>
                    <label className="text-sm font-medium text-gray-700 sm:col-span-2">Proposed publication date and time (studio clock)
                      <input type="datetime-local" value={row.metadata.proposedAt} onChange={e => updateMetadata(row.id, { proposedAt: e.target.value })} disabled={!canWrite || row.saving} className="mt-1 min-h-11 w-full rounded border border-gray-300 px-3 text-sm sm:max-w-sm" />
                    </label>
                  </div>
                  {row.attempted && errors.length > 0 && <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-red-700">{errors.map((issue, index) => <li key={`${issue.field}-${index}`}>{issue.message}</li>)}</ul>}
                  {warnings.map(issue => <p key={issue.field} className="mt-2 text-sm text-amber-800">{issue.message}</p>)}
                  {row.saveError && <p role="alert" className="mt-3 text-sm text-red-700">{row.saveError}</p>}
                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <button type="button" onClick={() => void saveImport(row)} disabled={!canWrite || row.saving || Boolean(row.parseError)} className="min-h-11 inline-flex items-center gap-2 rounded bg-charcoal px-4 text-sm font-semibold text-white hover:bg-bronze disabled:cursor-not-allowed disabled:opacity-50"><Check size={15} />{row.saving ? 'Saving draft…' : row.savedPostId ? 'Retry queue save' : 'Save as draft & queue'}</button>
                    {row.savedPostId && <span className="text-xs text-gray-600">Draft already saved; retrying does not create a second post.</span>}
                  </div>
                </>}
              </article>
            );
          })}

          <div className="flex items-center gap-2"><h2 className="font-serif text-xl text-gray-900">Saved intake items</h2><span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{filteredQueue.length}</span></div>
          {loading ? <p role="status" className="text-sm text-gray-500">Loading saved items…</p> : filteredQueue.length === 0 ? <div className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-600">No intake items match this search and filter.</div> : <div className="space-y-3">{filteredQueue.map(record => <QueueRecordCard key={record.post.id} record={record} canWrite={canWrite} onChanged={() => void refreshQueue()} navigate={navigate} />)}</div>}
        </section>
      ) : (
        <section aria-label="Article calendar" className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white p-3">
            <div className="flex items-center gap-2"><button type="button" onClick={() => moveCalendar(-1)} aria-label="Previous calendar period" className="min-h-11 min-w-11 rounded border border-gray-300 hover:border-bronze"><ChevronLeft className="mx-auto" size={18} /></button><button type="button" onClick={goToToday} className="min-h-11 rounded border border-gray-300 px-3 text-sm hover:border-bronze">Today</button><button type="button" onClick={() => moveCalendar(1)} aria-label="Next calendar period" className="min-h-11 min-w-11 rounded border border-gray-300 hover:border-bronze"><ChevronRight className="mx-auto" size={18} /></button><h2 className="ml-2 font-serif text-lg text-gray-900">{calendarMode === 'month' ? monthName(selectedDay) : `${dateLabel(range.start, { month: 'short', day: 'numeric' })} – ${dateLabel(range.end, { month: 'short', day: 'numeric', year: 'numeric' })}`}</h2></div>
            <div className="flex flex-wrap gap-1" role="group" aria-label="Calendar view">
              {(['list', 'week', 'month'] as CalendarMode[]).map(mode => <button key={mode} type="button" aria-pressed={calendarMode === mode} onClick={() => setCalendarMode(mode)} className={`min-h-11 rounded px-3 text-sm capitalize ${calendarMode === mode ? 'bg-charcoal text-white' : 'border border-gray-300 text-gray-700 hover:border-bronze'}`}>{mode}</button>)}
            </div>
          </div>
          <p className="text-xs text-gray-600">Blue = scheduled; amber = proposal; gray = rejected. Drag to move; scheduled posts need content.publish and confirmation.</p>
          {scheduleLoading && <p role="status" className="text-sm text-gray-500">Loading scheduled articles…</p>}
          {calendarMode === 'list' ? (
            <div className="space-y-2">{events.length ? events.map(event => <CalendarEventCard key={event.post.id} event={event} canMove={false} onEdit={id => navigate({ name: 'admin-article-edit', id })} onDragStart={startDrag} />) : <div className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-600">No items match this calendar range and status filter.</div>}</div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white p-2"><div className="grid min-w-[700px] grid-cols-7 gap-1">
              {calendarMode === 'month' && ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => <div key={day} className="p-2 text-center text-xs font-semibold uppercase text-gray-500">{day}</div>)}
              {range.days.map(day => {
                const activeMonth = day.slice(0, 7) === selectedDay.slice(0, 7);
                const items = events.filter(item => lagosDateKey(item.at) === day);
                const month = calendarMode === 'month';
                return <div key={day} onDragOver={e => e.preventDefault()} onDrop={e => dropOnDate(e, day)} className={`${month ? 'min-h-32' : 'min-h-40'} rounded border p-2 ${month && !activeMonth ? 'border-gray-100 bg-gray-50' : day === lagosDateKey() ? 'border-bronze bg-amber-50/40' : 'border-gray-100 bg-white'}`}>
                  <p className={`mb-1 text-xs font-semibold ${month && !activeMonth ? 'text-gray-400' : 'text-gray-700'}`}>{dateLabel(day, month ? { day: 'numeric' } : { weekday: 'short', month: 'short', day: 'numeric' })}</p>
                  {items.slice(0, month ? 3 : items.length).map(item => <CalendarEventCard key={item.post.id} event={item} canMove={item.kind === 'scheduled' ? canPublish : item.kind === 'proposal' && canWrite} onEdit={id => navigate({ name: 'admin-article-edit', id })} onDragStart={startDrag} />)}
                  {month && items.length > 3 && <p className="text-[11px] text-gray-500">+{items.length - 3} more</p>}
                </div>;
              })}
            </div></div>
          )}
        </section>
      )}

      {dropRequest && <div role="dialog" aria-modal="true" aria-labelledby="reschedule-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"><div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl"><h2 id="reschedule-title" className="font-serif text-xl text-gray-900">Confirm reschedule</h2><p className="mt-2 text-sm text-gray-700">Move “{dropRequest.event.post.title}” to {dateLabel(dropRequest.date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })} on your studio clock? Its time stays the same. {dropRequest.event.kind === 'scheduled' ? 'Channel distribution remains unapproved.' : 'The draft stays unpublished.'}</p>{dropError && <p role="alert" className="mt-3 text-sm text-red-700">{dropError}</p>}<div className="mt-4 flex justify-end gap-2"><button type="button" onClick={() => { setDropRequest(null); setDropError(''); }} disabled={dropBusy} className="min-h-11 rounded border border-gray-300 px-4 text-sm">Cancel</button><button type="button" onClick={() => void confirmReschedule()} disabled={dropBusy || (dropRequest.event.kind === 'scheduled' ? !canPublish : !canWrite)} className="min-h-11 rounded bg-bronze px-4 text-sm font-semibold text-white disabled:opacity-50">{dropBusy ? 'Saving…' : 'Confirm change'}</button></div></div></div>}
    </div>
  );
}
