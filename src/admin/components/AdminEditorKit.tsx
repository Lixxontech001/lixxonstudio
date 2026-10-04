/**
 * Shared editor kit — the machinery behind every admin editor.
 *
 * `useMarkdownEditor` gives a textarea real editing powers (undo/redo history, selection
 * wrapping, line prefixes, block inserts, find & replace, live stats, slash commands).
 * The panels around it (`ScoreRing`, `QualityPanel`, `SeoPanel`, `SocialPreview`,
 * `RevisionPanel`, `MediaPicker`) are the editorial surfaces the article and product editors
 * share, so improving one improves all of them.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bold, Italic, Code, Heading1, Heading2, Heading3, List, ListOrdered,
  Quote, Link2, Image as ImageIcon, Minus, Table2 as Table, ListTree as ListChecks, AlertTriangle, ChevronDown,
  RotateCcw as Undo2, RotateCcw as Redo2, Search, Sparkles, Star, X, Check, Loader2, BookOpen, Gauge,
} from 'lucide-react';
import { renderMarkdown } from '../../lib/markdown';
import { diffLines, diffStats, type DiffLine } from '../lib/diff';

// ---------------------------------------------------------------- editor hook

export interface EditorStats {
  words: number;
  chars: number;
  characters_no_spaces: number;
  paragraphs: number;
  sentences: number;
  headings: number;
  links: number;
  internal_links: number;
  images: number;
  images_missing_alt: number;
  reading_time_minutes: number;
  avg_sentence_words: number;
}

/** Word count and friends, computed the same way the database does. */
export function markdownStats(content: string): EditorStats {
  const c = content || '';
  const plain = c
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`#>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const words = plain ? plain.split(/\s+/).filter(Boolean).length : 0;
  const sentences = Math.max((plain.match(/[.!?]+(\s|$)/g) || []).length, words > 0 ? 1 : 0);
  const paragraphs = Math.max((c.match(/\n\s*\n/g) || []).length, c.trim() ? 1 : 0);
  return {
    words,
    chars: c.length,
    characters_no_spaces: c.replace(/\s/g, '').length,
    paragraphs,
    sentences,
    headings: (c.match(/^#{1,6}\s+\S/gm) || []).length,
    links: (c.match(/\]\([^)]*\)/g) || []).length,
    internal_links: (c.match(/\]\(\/[^)]*\)/g) || []).length,
    images: (c.match(/!\[[^\]]*\]\([^)]*\)/g) || []).length,
    images_missing_alt: (c.match(/!\[\s*\]\([^)]*\)/g) || []).length,
    reading_time_minutes: Math.max(1, Math.ceil(words / 200)),
    avg_sentence_words: sentences > 0 ? Math.round((words / sentences) * 10) / 10 : 0,
  };
}

export interface SlashItem { id: string; label: string; hint: string; block: string; keywords?: string }

export const SLASH_ITEMS: SlashItem[] = [
  { id: 'h2', label: 'Section heading', hint: '## ', block: '## Section title\n', keywords: 'h2 heading section' },
  { id: 'h3', label: 'Sub-heading', hint: '### ', block: '### Sub-heading\n', keywords: 'h3 subheading' },
  { id: 'ul', label: 'Bulleted list', hint: '-', block: '- First point\n- Second point\n- Third point\n', keywords: 'bullets ul list' },
  { id: 'ol', label: 'Numbered list', hint: '1.', block: '1. First step\n2. Second step\n3. Third step\n', keywords: 'ordered ol steps' },
  { id: 'tasks', label: 'Checklist', hint: '- [ ]', block: '- [ ] To do\n- [x] Done\n', keywords: 'todo task checkbox' },
  { id: 'quote', label: 'Pull quote', hint: '>', block: '> A line worth pulling out.\n', keywords: 'quote blockquote' },
  { id: 'callout', label: 'Editorial note', hint: '> **', block: '> **Note:** something the reader should not miss.\n', keywords: 'callout note tip' },
  { id: 'image', label: 'Image', hint: '![]', block: '![Describe the image](/media/example.jpg)\n', keywords: 'picture photo img' },
  { id: 'divider', label: 'Divider', hint: '---', block: '\n---\n', keywords: 'hr rule separator' },
  { id: 'table', label: 'Table', hint: '| |', block: '| Column | Detail |\n| --- | --- |\n| Row | Value |\n', keywords: 'table grid' },
  { id: 'cta', label: 'Shop call-to-action', hint: 'CTA', block: '\n> **Shop the edit** — [see the full selection](/shop)\n', keywords: 'cta product promo' },
  { id: 'faq', label: 'FAQ block', hint: 'FAQ', block: '## Frequently asked questions\n\n**Question?**\n\nAnswer.\n', keywords: 'faq questions seo' },
  { id: 'key', label: 'Key takeaways', hint: 'list', block: '## Key takeaways\n\n- Point one\n- Point two\n', keywords: 'takeaways summary' },
  { id: 'details', label: 'Collapsible section', hint: '<details>', block: '<details>\n<summary>More detail</summary>\n\nHidden until opened.\n\n</details>\n', keywords: 'details collapse spoiler' },
];

const HISTORY_LIMIT = 120;

export interface MarkdownEditorApi {
  ref: React.MutableRefObject<HTMLTextAreaElement | null>;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  wrapSelection: (before: string, after?: string, placeholder?: string) => void;
  prefixLines: (prefix: string) => void;
  togglePrefix: (prefix: string) => void;
  insertBlock: (block: string) => void;
  replaceRange: (start: number, end: number, text: string) => void;
  focus: () => void;
  /** Track the caret: call from onSelect/onClick/onKeyUp so the slash menu can open. */
  onSelect: () => void;
  slash: { open: boolean; query: string; items: SlashItem[]; start: number; end: number };
  closeSlash: () => void;
  findReplace: { open: boolean };
  setFindReplace: (open: boolean) => void;
  caret: number;
  selectionLength: number;
}

/**
 * Wraps a textarea with editing superpowers. `value`/`onChange` stay in sync with the form
 * state, so this composes with any of the admin editors.
 */
export function useMarkdownEditor(opts: {
  value: string;
  onChange: (next: string) => void;
  /** Called when the toolbar should scroll a field into view, e.g. 'ai' | 'media'. */
  onAction?: (action: string) => void;
}): MarkdownEditorApi {
  const { value, onChange } = opts;
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const undoStack = useRef<string[]>([]);
  const redoStack = useRef<string[]>([]);
  const lastCommitted = useRef<string>(value);
  const [, setTick] = useState(0);
  const [slash, setSlash] = useState<{ open: boolean; query: string; start: number; end: number }>({ open: false, query: '', start: 0, end: 0 });
  const [findOpen, setFindOpen] = useState(false);
  const [caret, setCaret] = useState(0);
  const [selectionLength, setSelectionLength] = useState(0);

  // History: a commit is a change that survived 600 ms without another one (typing bursts
  // collapse into a single undo step, like a real editor).
  useEffect(() => {
    if (value === lastCommitted.current) return;
    const t = setTimeout(() => {
      undoStack.current.push(lastCommitted.current);
      if (undoStack.current.length > HISTORY_LIMIT) undoStack.current.shift();
      redoStack.current = [];
      lastCommitted.current = value;
      setTick(n => n + 1);
    }, 600);
    return () => clearTimeout(t);
  }, [value]);

  const apply = useCallback((next: string, caretPos?: number, selLen?: number) => {
    onChange(next);
    window.requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      const pos = caretPos ?? el.selectionStart;
      el.setSelectionRange(pos, pos + (selLen ?? 0));
      setCaret(pos);
      setSelectionLength(selLen ?? 0);
    });
  }, [onChange]);

  const wrapSelection = useCallback((before: string, after = '', placeholder = '') => {
    const el = ref.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = value.substring(start, end) || placeholder;
    const next = value.substring(0, start) + before + selected + after + value.substring(end);
    apply(next, start + before.length, selected.length);
  }, [value, apply]);

  const prefixLines = useCallback((prefix: string) => {
    const el = ref.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    const next = value.substring(0, lineStart) + prefix + value.substring(lineStart);
    apply(next, start + prefix.length);
    void end;
  }, [value, apply]);

  /** Apply a line prefix to every selected line, or remove it when they all have it. */
  const togglePrefix = useCallback((prefix: string) => {
    const el = ref.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const from = value.lastIndexOf('\n', start - 1) + 1;
    let to = value.indexOf('\n', end);
    if (to === -1) to = value.length;
    const block = value.substring(from, to);
    const lines = block.split('\n');
    const all = lines.length > 0 && lines.every(l => l.startsWith(prefix));
    const next = lines.map(l => (all ? l.slice(prefix.length) : prefix + l)).join('\n');
    const nextText = value.substring(0, from) + next + value.substring(to);
    const delta = next.length - block.length;
    apply(nextText, all ? Math.max(from, start - prefix.length) : start + prefix.length, Math.max(0, end - start + delta));
  }, [value, apply]);

  const insertBlock = useCallback((block: string) => {
    const el = ref.current;
    const start = el ? el.selectionStart : value.length;
    const end = el ? el.selectionEnd : value.length;
    const before = value.substring(0, start);
    const needsBreak = before.length > 0 && !before.endsWith('\n') && !before.endsWith('\n\n');
    const text = (needsBreak ? '\n\n' : '') + block;
    const next = value.substring(0, start) + text + value.substring(end);
    apply(next, start + text.length);
  }, [value, apply]);

  const replaceRange = useCallback((start: number, end: number, text: string) => {
    apply(value.substring(0, start) + text + value.substring(end), start + text.length);
  }, [value, apply]);

  const undo = useCallback(() => {
    const prev = undoStack.current.pop();
    if (prev === undefined) return;
    redoStack.current.push(value);
    lastCommitted.current = prev;
    onChange(prev);
    setTick(n => n + 1);
  }, [value, onChange]);

  const redo = useCallback(() => {
    const next = redoStack.current.pop();
    if (next === undefined) return;
    undoStack.current.push(value);
    lastCommitted.current = next;
    onChange(next);
    setTick(n => n + 1);
  }, [value, onChange]);

  /** Slash commands: open the menu when the caret sits after a lone `/` at a line start. */
  const onSelect = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const pos = el.selectionStart;
    setCaret(pos);
    setSelectionLength(el.selectionEnd - pos);
    const upto = value.slice(0, pos);
    const m = /(^|\n)\/([a-zA-Z]*)$/.exec(upto);
    if (m) setSlash({ open: true, query: m[2], start: pos - m[2].length - 1, end: pos });
    else if (slash.open) setSlash(s => ({ ...s, open: false }));
  }, [value, slash.open]);

  // keyboard shortcuts that every editor should have
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handler = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (e.key === 'Escape') { setSlash(s => ({ ...s, open: false })); return; }
      if (!meta) return;
      if (e.key.toLowerCase() === 'b') { e.preventDefault(); wrapSelection('**', '**', 'bold text'); }
      else if (e.key.toLowerCase() === 'i') { e.preventDefault(); wrapSelection('*', '*', 'italic text'); }
      else if (e.key.toLowerCase() === 'k') { e.preventDefault(); opts.onAction?.('link'); }
      else if (e.key.toLowerCase() === 'f') { e.preventDefault(); setFindOpen(true); }
      else if (e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((e.key.toLowerCase() === 'z' && e.shiftKey) || e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
    };
    el.addEventListener('keydown', handler);
    return () => el.removeEventListener('keydown', handler);
  }, [wrapSelection, undo, redo, opts]);

  const items = useMemo(() => {
    const q = slash.query.toLowerCase();
    if (!q) return SLASH_ITEMS;
    return SLASH_ITEMS.filter(i => i.label.toLowerCase().includes(q) || (i.keywords || '').includes(q) || i.id.includes(q));
  }, [slash.query]);

  return {
    ref,
    undo,
    redo,
    canUndo: undoStack.current.length > 0 || value !== lastCommitted.current,
    canRedo: redoStack.current.length > 0,
    wrapSelection,
    prefixLines,
    togglePrefix,
    insertBlock,
    replaceRange,
    focus: () => ref.current?.focus(),
    onSelect,
    slash: { ...slash, items },
    closeSlash: () => setSlash(s => ({ ...s, open: false })),
    findReplace: { open: findOpen },
    setFindReplace: setFindOpen,
    caret,
    selectionLength,
  };
}

// ---------------------------------------------------------------- toolbar

export interface ToolbarAction { id: string; label: string; icon: typeof Bold; run: () => void; kbd?: string }

export function EditorToolbar({ editor, extra, onAction }: {
  editor: MarkdownEditorApi;
  extra?: ToolbarAction[];
  onAction?: (action: string) => void;
}) {
  const { wrapSelection, togglePrefix, insertBlock, undo, redo, canUndo, canRedo } = editor;
  const groups: ToolbarAction[][] = [
    [
      { id: 'h1', label: 'Heading 1', icon: Heading1, run: () => togglePrefix('# ') },
      { id: 'h2', label: 'Heading 2', icon: Heading2, run: () => togglePrefix('## ') },
      { id: 'h3', label: 'Heading 3', icon: Heading3, run: () => togglePrefix('### ') },
    ],
    [
      { id: 'bold', label: 'Bold', icon: Bold, run: () => wrapSelection('**', '**', 'bold text'), kbd: '⌘B' },
      { id: 'italic', label: 'Italic', icon: Italic, run: () => wrapSelection('*', '*', 'italic text'), kbd: '⌘I' },
      { id: 'strike', label: 'Strikethrough', icon: Bold, run: () => wrapSelection('~~', '~~', 'text') },
      { id: 'code', label: 'Inline code', icon: Code, run: () => wrapSelection('`', '`', 'code') },
    ],
    [
      { id: 'ul', label: 'Bulleted list', icon: List, run: () => togglePrefix('- ') },
      { id: 'ol', label: 'Numbered list', icon: ListOrdered, run: () => togglePrefix('1. ') },
      { id: 'tasks', label: 'Checklist', icon: ListChecks, run: () => insertBlock('- [ ] Task\n') },
      { id: 'quote', label: 'Quote', icon: Quote, run: () => togglePrefix('> ') },
    ],
    [
      { id: 'link', label: 'Link', icon: Link2, run: () => onAction?.('link'), kbd: '⌘K' },
      { id: 'image', label: 'Image', icon: ImageIcon, run: () => onAction?.('media') },
      { id: 'table', label: 'Table', icon: Table, run: () => insertBlock('| Column | Detail |\n| --- | --- |\n| Row | Value |\n') },
      { id: 'divider', label: 'Divider', icon: Minus, run: () => insertBlock('---\n') },
      { id: 'callout', label: 'Callout', icon: AlertTriangle, run: () => insertBlock('> **Note:** something the reader should not miss.\n') },
    ],
    [
      { id: 'undo', label: 'Undo', icon: Undo2, run: undo, kbd: '⌘Z' },
      { id: 'redo', label: 'Redo', icon: Redo2, run: redo, kbd: '⇧⌘Z' },
      { id: 'find', label: 'Find & replace', icon: Search, run: () => editor.setFindReplace(true), kbd: '⌘F' },
    ],
  ];
  return (
    <div className="flex items-center gap-1 flex-wrap bg-white border border-gray-200 rounded-t px-2 py-1.5" role="toolbar" aria-label="Formatting">
      {groups.map((group, gi) => (
        <div key={gi} className="flex items-center gap-0.5">
          {group.map(btn => {
            const Icon = btn.icon;
            const disabled = (btn.id === 'undo' && !canUndo) || (btn.id === 'redo' && !canRedo);
            return (
              <button
                key={btn.id}
                type="button"
                onClick={btn.run}
                disabled={disabled}
                title={btn.kbd ? `${btn.label} (${btn.kbd})` : btn.label}
                aria-label={btn.label}
                className="p-1.5 text-gray-500 hover:text-bronze hover:bg-gray-50 rounded transition-colors"
              >
                <Icon size={16} strokeWidth={1.5} />
              </button>
            );
          })}
        </div>
      ))}
      {extra?.map(btn => {
        const Icon = btn.icon;
        return (
          <button
            key={btn.id}
            type="button"
            onClick={btn.run}
            title={btn.label}
            className="inline-flex items-center gap-1 text-xs px-2 py-1.5 ml-auto text-bronze hover:bg-bronze/5 rounded transition-colors"
          >
            <Icon size={14} /> {btn.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- slash menu

export function SlashMenu({ editor }: { editor: MarkdownEditorApi }) {
  if (!editor.slash.open || editor.slash.items.length === 0) return null;
  return (
    <div className="absolute z-40 mt-1 w-64 max-h-64 overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-lg">
      <p className="px-3 py-2 text-[11px] uppercase tracking-wider text-gray-400 border-b border-gray-100">Blocks</p>
      {editor.slash.items.map(item => (
        <button
          key={item.id}
          type="button"
          onMouseDown={e => {
            e.preventDefault();
            editor.replaceRange(editor.slash.start, editor.slash.end, item.block);
            editor.closeSlash();
          }}
          className="w-full text-left px-3 py-2 hover:bg-gray-50 flex items-center justify-between gap-2"
        >
          <span className="text-sm text-gray-700">{item.label}</span>
          <span className="text-[11px] text-gray-400 font-mono">{item.hint}</span>
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- find & replace

export function FindReplaceBar({ editor, content }: { editor: MarkdownEditorApi; content: string }) {
  const [find, setFind] = useState('');
  const [replace, setReplace] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  if (!editor.findReplace.open) return null;

  const matches = (() => {
    if (!find) return [];
    const hay = caseSensitive ? content : content.toLowerCase();
    const needle = caseSensitive ? find : find.toLowerCase();
    const out: number[] = [];
    let i = hay.indexOf(needle);
    while (i !== -1) { out.push(i); i = hay.indexOf(needle, i + needle.length); }
    return out;
  })();

  const step = (dir: 1 | -1) => {
    const el = editor.ref.current;
    if (!el || matches.length === 0) return;
    const from = el.selectionEnd;
    const next = dir === 1 ? matches.find(m => m > from) ?? matches[0] : [...matches].reverse().find(m => m < from) ?? matches[matches.length - 1];
    el.focus();
    el.setSelectionRange(next, next + find.length);
  };

  const replaceAll = () => {
    if (!find) return;
    const escaped = find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(escaped, caseSensitive ? 'g' : 'gi');
    editor.replaceRange(0, content.length, content.replace(re, replace));
    setMsg(`Replaced ${matches.length} occurrence${matches.length === 1 ? '' : 's'}`);
  };

  return (
    <div className="flex flex-wrap items-center gap-2 bg-gray-50 border border-gray-200 border-t-0 px-3 py-2 text-sm">
      <Search size={14} className="text-gray-400" />
      <input
        value={find}
        onChange={e => setFind(e.target.value)}
        placeholder="Find"
        aria-label="Find"
        className="border border-gray-200 rounded px-2 py-1 text-sm w-40"
      />
      <input
        value={replace}
        onChange={e => setReplace(e.target.value)}
        placeholder="Replace with"
        aria-label="Replace with"
        className="border border-gray-200 rounded px-2 py-1 text-sm w-40"
      />
      <label className="flex items-center gap-1 text-xs text-gray-500">
        <input type="checkbox" checked={caseSensitive} onChange={e => setCaseSensitive(e.target.checked)} /> match case
      </label>
      <span className="text-xs text-gray-500">{matches.length} match{matches.length === 1 ? '' : 'es'}</span>
      <button type="button" onClick={() => step(-1)} className="text-xs px-2 py-1 border border-gray-200 rounded">Prev</button>
      <button type="button" onClick={() => step(1)} className="text-xs px-2 py-1 border border-gray-200 rounded">Next</button>
      <button
        type="button"
        onClick={() => {
          const el = editor.ref.current;
          if (!el || matches.length === 0) return;
          const start = el.selectionStart;
          if (start >= 0 && (caseSensitive ? content.startsWith(find, start) : content.toLowerCase().startsWith(find.toLowerCase(), start))) {
            editor.replaceRange(start, start + find.length, replace);
          } else step(1);
        }}
        className="text-xs px-2 py-1 border border-gray-200 rounded"
      >Replace</button>
      <button type="button" onClick={replaceAll} className="text-xs px-2 py-1 border border-gray-200 rounded">Replace all</button>
      {msg && <span className="text-xs text-green-600">{msg}</span>}
      <button type="button" onClick={() => editor.setFindReplace(false)} className="ml-auto text-gray-400 hover:text-gray-700" aria-label="Close find bar"><X size={14} /></button>
    </div>
  );
}

// ---------------------------------------------------------------- quality

export interface QualityIssue { key: string; severity: 'error' | 'warn' | 'info'; message: string; fix?: string }
export interface QualityReport {
  score: number;
  grade: string;
  metrics: Record<string, number | string | null>;
  issues: QualityIssue[];
  passed?: boolean;
}

const fmt = (v: unknown) => (typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(1)) : v == null ? '–' : String(v));

export function ScoreRing({ score, grade, size = 64 }: { score: number; grade?: string; size?: number }) {
  const r = size / 2 - 5;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score)) / 100;
  const color = score >= 90 ? '#15803d' : score >= 75 ? '#65a30d' : score >= 60 ? '#b45309' : '#b91c1c';
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }} role="img" aria-label={`Quality score ${score} of 100`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e5e7eb" strokeWidth={5} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={5} strokeDasharray={`${c * pct} ${c}`} strokeLinecap="round" />
      </svg>
      <span className="absolute text-center leading-none">
        <span className="block text-base font-medium" style={{ color }}>{score}</span>
        {grade && <span className="block text-[10px] text-gray-400">{grade}</span>}
      </span>
    </div>
  );
}

export function QualityPanel({ report, loading, onFix, onRefresh }: {
  report: QualityReport | null;
  loading?: boolean;
  onFix?: (issue: QualityIssue) => void;
  onRefresh?: () => void;
}) {
  if (!report) {
    return (
      <div className="text-xs text-gray-400 flex items-center gap-2">
        {loading ? <Loader2 size={13} className="animate-spin" /> : <Gauge size={13} />}
        {loading ? 'Scoring the draft…' : 'Quality report unavailable.'}
      </div>
    );
  }
  const m = report.metrics || {};
  const groups: { level: QualityIssue['severity']; title: string; tone: string }[] = [
    { level: 'error', title: 'Must fix', tone: 'text-red-600' },
    { level: 'warn', title: 'Should fix', tone: 'text-amber-600' },
    { level: 'info', title: 'Nice to have', tone: 'text-gray-500' },
  ];
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <ScoreRing score={report.score} grade={report.grade} />
        <div className="text-xs text-gray-500 space-y-0.5">
          <p><strong className="text-gray-700">{m.words ?? 0}</strong> words · {fmt(m.reading_time_minutes)} min read</p>
          <p>{fmt(m.h2)} sections · {fmt(m.internal_links)} internal links · {fmt(m.images)} images</p>
          <p>Flesch {fmt(m.flesch_reading_ease)} · avg sentence {fmt(m.avg_sentence_words)} words</p>
          {Boolean(m.keyword) && <p>“{String(m.keyword)}” × {fmt(m.keyword_count)} ({fmt(m.keyword_density)}%)</p>}
        </div>
        {onRefresh && (
          <button type="button" onClick={onRefresh} className="ml-auto text-xs text-bronze hover:underline">Re-check</button>
        )}
      </div>
      {report.issues.length === 0 ? (
        <p className="text-xs text-green-700 flex items-center gap-1"><Check size={13} /> Nothing flagged — this draft is in good shape.</p>
      ) : (
        groups.map(g => {
          const list = report.issues.filter(i => i.severity === g.level);
          if (list.length === 0) return null;
          return (
            <div key={g.level}>
              <p className={`text-[11px] uppercase tracking-wider mb-1.5 ${g.tone}`}>{g.title} ({list.length})</p>
              <ul className="space-y-1.5">
                {list.map(issue => (
                  <li key={issue.key} className="text-xs text-gray-600 flex items-start gap-2">
                    <span className={`mt-1 w-2 h-2 rounded-full shrink-0 ${g.level === 'error' ? 'bg-red-500' : g.level === 'warn' ? 'bg-amber-500' : 'bg-gray-300'}`} />
                    <span>
                      <span>{issue.message}</span>
                      {issue.fix && <span className="text-gray-400"> {issue.fix}</span>}
                      {onFix && (
                        <button type="button" onClick={() => onFix(issue)} className="ml-1 text-bronze hover:underline">Fix</button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })
      )}
    </div>
  );
}

// ---------------------------------------------------------------- SEO surfaces

export function SearchPreview({ title, description, url, siteName }: {
  title: string; description: string; url: string; siteName?: string;
}) {
  return (
    <div className="border border-gray-200 rounded p-3 bg-white">
      <p className="text-[11px] text-gray-500 truncate">{url}</p>
      <p className="text-[15px] text-blue-800 leading-snug truncate">{title || 'Untitled article'}</p>
      <p className="text-xs text-gray-600 leading-snug line-clamp-2">{description || 'No meta description yet — search engines will invent one.'}</p>
      {siteName && <p className="text-[11px] text-gray-400 mt-1">{siteName}</p>}
    </div>
  );
}

export function SocialCardPreview({ title, description, image, siteName }: {
  title: string; description: string; image?: string; siteName?: string;
}) {
  return (
    <div className="border border-gray-200 rounded overflow-hidden bg-white">
      {image ? (
        <img src={image} alt="" className="w-full h-28 object-cover" />
      ) : (
        <div className="w-full h-28 bg-gray-100 flex items-center justify-center text-[11px] text-gray-400">No social image</div>
      )}
      <div className="p-2.5">
        <p className="text-[11px] uppercase tracking-wide text-gray-400">{siteName || 'lixxonstudio'}</p>
        <p className="text-sm text-gray-900 leading-snug line-clamp-2">{title || 'Untitled article'}</p>
        <p className="text-[11px] text-gray-500 leading-snug line-clamp-2">{description || 'No description'}</p>
      </div>
    </div>
  );
}

/** Field-level character counter with the same thresholds the scorer uses. */
export function CharCount({ value, min, max, id }: { value: string; min: number; max: number; id?: string }) {
  const len = (value || '').length;
  const tone = len === 0 ? 'text-gray-400' : len < min || len > max ? 'text-amber-600' : 'text-green-600';
  return <span id={id} className={`text-[11px] ${tone}`}>{len}/{min}–{max}</span>;
}

// ---------------------------------------------------------------- revisions

export interface RevisionRow {
  id: string;
  title: string;
  excerpt?: string | null;
  saved_at: string;
  saved_by?: string | null;
  note?: string | null;
  kind?: string | null;
  word_count?: number | null;
  chars?: number | null;
}

const KIND_LABEL: Record<string, string> = {
  manual: 'Manual save', autosave: 'Autosave', publish: 'Published', restore: 'Restored', ai: 'AI',
};

export function RevisionPanel({ revisions, onRestore, onDiff, loading }: {
  revisions: RevisionRow[];
  onRestore?: (r: RevisionRow) => void;
  onDiff?: (r: RevisionRow) => void;
  loading?: boolean;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  if (loading) return <p className="text-xs text-gray-400 flex items-center gap-2"><Loader2 size={13} className="animate-spin" /> Loading revisions…</p>;
  if (revisions.length === 0) return <p className="text-xs text-gray-400">No revisions yet. Every save is captured automatically.</p>;
  return (
    <ul className="space-y-1 max-h-72 overflow-y-auto">
      {revisions.map(r => (
        <li key={r.id} className="border border-gray-100 rounded">
          <div className="flex items-center justify-between gap-2 px-2.5 py-2">
            <div className="min-w-0">
              <p className="text-xs text-gray-700 truncate">{new Date(r.saved_at).toLocaleString()}</p>
              <p className="text-[11px] text-gray-400 truncate">
                {KIND_LABEL[r.kind || 'manual'] || r.kind} · {r.saved_by || 'unknown'}{r.word_count ? ` · ${r.word_count} words` : ''}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {onDiff && <button type="button" onClick={() => { setExpanded(expanded === r.id ? null : r.id); onDiff(r); }} className="text-[11px] text-bronze hover:underline">Diff</button>}
              {onRestore && <button type="button" onClick={() => onRestore(r)} className="text-[11px] text-gray-500 hover:text-charcoal">Restore</button>}
            </div>
          </div>
          {expanded === r.id && <InlineDiff revisionId={r.id} />}
        </li>
      ))}
    </ul>
  );
}

/** Diff is fetched lazily by the parent and shown through this wrapper. */
const diffCache = new Map<string, DiffLine[]>();
export function setRevisionDiff(id: string, lines: DiffLine[]) { diffCache.set(id, lines); }
function InlineDiff({ revisionId }: { revisionId: string }) {
  const lines = diffCache.get(revisionId);
  if (!lines) return <p className="px-2.5 pb-2 text-[11px] text-gray-400">No diff available.</p>;
  return (
    <pre className="px-2.5 pb-2 text-[11px] font-mono leading-relaxed whitespace-pre-wrap max-h-40 overflow-y-auto">
      {lines.slice(0, 60).map((l, i) => (
        <div key={i} className={l.type === 'add' ? 'bg-green-50 text-green-800' : l.type === 'del' ? 'bg-red-50 text-red-800' : 'text-gray-500'}>
          {l.type === 'add' ? '+ ' : l.type === 'del' ? '− ' : '  '}{l.text}
        </div>
      ))}
    </pre>
  );
}

export function DiffModal({ title, oldText, newText, onClose, onRestore }: {
  title: string; oldText: string; newText: string; onClose: () => void; onRestore?: () => void;
}) {
  const lines = useMemo(() => diffLines(oldText, newText), [oldText, newText]);
  const stats = useMemo(() => diffStats(oldText, newText), [oldText, newText]);
  return (
    <div role="dialog" aria-modal="true" aria-label="Revision diff" className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-lg w-full max-w-4xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="p-4 border-b border-gray-200 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-medium">{title}</h3>
            <p className="text-[11px] text-gray-500">
              <span className="text-green-700">+{stats.added}</span> · <span className="text-red-700">−{stats.removed}</span> · {stats.unchanged} unchanged
            </p>
          </div>
          <div className="flex items-center gap-2">
            {onRestore && <button type="button" onClick={onRestore} className="text-xs px-3 py-1.5 border border-gray-200 rounded hover:bg-gray-50">Restore this revision</button>}
            <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-700 text-sm">Close</button>
          </div>
        </div>
        <pre className="p-4 overflow-auto text-xs font-mono leading-relaxed whitespace-pre-wrap">
          {lines.map((l, i) => (
            <div key={i} className={l.type === 'add' ? 'bg-green-50 text-green-800' : l.type === 'del' ? 'bg-red-50 text-red-800' : 'text-gray-600'}>
              {l.type === 'add' ? '+ ' : l.type === 'del' ? '− ' : '  '}{l.text}
            </div>
          ))}
        </pre>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- preview

export function LivePreview({ content, title, excerpt, cover, coverAlt, takeaways }: {
  content: string; title: string; excerpt?: string; cover?: string; coverAlt?: string; takeaways?: string[];
}) {
  const html = useMemo(() => renderMarkdown(content), [content]);
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-6 md:p-8">
      <h1 className="font-serif text-3xl text-gray-900 mb-3">{title || 'Untitled article'}</h1>
      {excerpt && <p className="text-gray-600 italic text-lg mb-5">{excerpt}</p>}
      {cover && <img src={cover} alt={coverAlt || ''} className="w-full rounded mb-6" />}
      {takeaways && takeaways.filter(Boolean).length > 0 && (
        <div className="border border-bronze/30 bg-bronze/5 rounded p-4 mb-6">
          <p className="text-xs uppercase tracking-wider text-bronze mb-2 flex items-center gap-1"><Star size={12} /> Key takeaways</p>
          <ul className="list-disc pl-5 text-sm text-gray-700 space-y-1">
            {takeaways.filter(Boolean).map((t, i) => <li key={i}>{t}</li>)}
          </ul>
        </div>
      )}
      <div className="prose max-w-none" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}

// ---------------------------------------------------------------- misc

export function AutosaveBadge({ at, saving, onSaveNow, dirty }: {
  at: string | null; saving?: boolean; onSaveNow?: () => void; dirty?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-2 text-xs text-gray-500">
      {saving ? (
        <><Loader2 size={12} className="animate-spin" /> Autosaving…</>
      ) : at ? (
        <><Check size={12} className="text-green-600" /> Autosaved {new Date(at).toLocaleTimeString()}</>
      ) : dirty ? (
        <><span className="w-2 h-2 rounded-full bg-amber-500" /> Unsaved changes</>
      ) : (
        <><Check size={12} className="text-gray-300" /> All changes saved</>
      )}
      {onSaveNow && dirty && (
        <button type="button" onClick={onSaveNow} className="text-bronze hover:underline">Save now</button>
      )}
    </span>
  );
}

/** Collapsible sidebar panel so long editors stay navigable. */
export function SideSection({ title, icon: Icon, children, defaultOpen = true, badge }: {
  title: string; icon?: typeof BookOpen; children: React.ReactNode; defaultOpen?: boolean; badge?: string | number;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-white border border-gray-200 rounded-lg">
      <button type="button" onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-2 px-4 py-3 text-left" aria-expanded={open}>
        {Icon && <Icon size={15} className="text-gray-400" />}
        <span className="text-sm font-medium text-gray-900">{title}</span>
        {badge !== undefined && badge !== '' && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">{badge}</span>}
        <ChevronDown size={14} className={`ml-auto text-gray-400 transition-transform ${open ? '' : '-rotate-90'}`} />
      </button>
      {open && <div className="px-4 pb-4 space-y-3">{children}</div>}
    </div>
  );
}

export function LinkDialog({ open, initialText, internal, onInsert, onClose }: {
  open: boolean;
  initialText: string;
  internal: { id: string; title: string; url: string }[];
  onInsert: (text: string, url: string) => void;
  onClose: () => void;
}) {
  const [url, setUrl] = useState('https://');
  const [text, setText] = useState(initialText);
  useEffect(() => { if (open) { setUrl('https://'); setText(initialText); } }, [open, initialText]);
  if (!open) return null;
  return (
    <div role="dialog" aria-modal="true" aria-label="Insert link" className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-lg w-full max-w-lg p-5" onClick={e => e.stopPropagation()}>
        <h3 className="text-sm font-medium mb-4 flex items-center gap-2"><Link2 size={15} /> Insert link</h3>
        <div className="space-y-3">
          <div>
            <label htmlFor="link-url" className="block text-xs text-gray-500 mb-1">URL</label>
            <input id="link-url" value={url} onChange={e => setUrl(e.target.value)} className="w-full border border-gray-200 rounded px-3 py-2 text-sm" autoFocus />
          </div>
          <div>
            <label htmlFor="link-text" className="block text-xs text-gray-500 mb-1">Link text</label>
            <input id="link-text" value={text} onChange={e => setText(e.target.value)} placeholder="link text" className="w-full border border-gray-200 rounded px-3 py-2 text-sm" />
          </div>
          {internal.length > 0 && (
            <div>
              <p className="text-[11px] uppercase tracking-wider text-gray-400 mb-1.5 flex items-center gap-1"><Sparkles size={11} /> Suggested internal links</p>
              <div className="max-h-40 overflow-y-auto space-y-1">
                {internal.map(i => (
                  <button key={i.id} type="button" onClick={() => { setUrl(i.url); if (!text.trim()) setText(i.title); }} className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-gray-50 flex items-center justify-between gap-2">
                    <span className="text-gray-700 truncate">{i.title}</span>
                    <span className="text-gray-400 font-mono shrink-0">{i.url}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button type="button" onClick={onClose} className="text-sm px-3 py-2 border border-gray-200 rounded hover:bg-gray-50">Cancel</button>
          <button
            type="button"
            onClick={() => { onInsert(text.trim() || url, url.trim()); onClose(); }}
            className="text-sm px-3 py-2 bg-bronze text-white rounded hover:bg-bronze-dark"
          >Insert link</button>
        </div>
      </div>
    </div>
  );
}

export function MediaPicker({ open, items, mode, onPick, onClose }: {
  open: boolean;
  items: { id: string; url: string; alt_text?: string | null; title?: string | null; file_name?: string | null }[];
  mode: 'cover' | 'inline' | 'og' | null;
  onPick: (item: { url: string; alt: string }) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  if (!open) return null;
  const filtered = items.filter(i => !q || `${i.alt_text || ''} ${i.title || ''} ${i.file_name || ''}`.toLowerCase().includes(q.toLowerCase()));
  const title = mode === 'cover' ? 'Select cover image' : mode === 'og' ? 'Select social share image' : 'Insert inline image';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} className="bg-white rounded-lg max-w-2xl w-full mx-4 max-h-[80vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="p-4 border-b border-gray-200 flex items-center justify-between">
          <h3 className="font-medium text-gray-900">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Close media picker"><X size={20} /></button>
        </div>
        <div className="p-4 border-b border-gray-200">
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search media by name or alt text…" className="w-full border border-gray-200 px-3 py-2 rounded text-sm" />
        </div>
        <div className="p-4 overflow-y-auto flex-1">
          {filtered.length === 0 ? (
            <div className="text-center py-12">
              <ImageIcon size={32} className="text-gray-300 mx-auto mb-3" />
              <p className="text-gray-400 text-sm">No media matches. Upload images in the Media section first.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {filtered.map(item => (
                <button
                  key={item.id}
                  onClick={() => onPick({ url: item.url, alt: item.alt_text || item.title || '' })}
                  className="group relative aspect-square rounded overflow-hidden border-2 border-transparent hover:border-bronze transition-all"
                  title={item.alt_text || item.title || item.file_name || 'Select image'}
                >
                  <img src={item.url} alt={item.alt_text || ''} className="w-full h-full object-cover" loading="lazy" />
                  <span className="absolute inset-0 bg-black/0 group-hover:bg-black/20 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <Check size={20} className="text-white" />
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Keyboard-shortcut cheat sheet shared by the editors. */
export const EDITOR_SHORTCUTS: [string, string][] = [
  ['⌘/Ctrl + B', 'Bold'],
  ['⌘/Ctrl + I', 'Italic'],
  ['⌘/Ctrl + K', 'Insert link'],
  ['⌘/Ctrl + F', 'Find & replace'],
  ['⌘/Ctrl + S', 'Save draft'],
  ['⌘/Ctrl + Z', 'Undo'],
  ['/', 'Slash commands at the start of a line'],
];

/**
 * A single long-form field with the full formatting toolbar. The product editor, the
 * collection editor and the glossary all use it so a rich field looks and behaves the same
 * everywhere — markdown in the database, preview on demand.
 */
export function MarkdownField({
  value, onChange, rows = 4, placeholder, label, hint, min, max, showPreview = true, id,
}: {
  value: string;
  onChange: (next: string) => void;
  rows?: number;
  placeholder?: string;
  label?: string;
  hint?: string;
  min?: number;
  max?: number;
  showPreview?: boolean;
  id?: string;
}) {
  const [preview, setPreview] = useState(false);
  const editor = useMarkdownEditor({ value, onChange });
  const stats = markdownStats(value);
  return (
    <div>
      {label && (
        <div className="flex items-center justify-between mb-1">
          <span className="block text-[10px] tracking-editorial uppercase text-charcoal-muted">{label}</span>
          <span className="flex items-center gap-2">
            {min !== undefined && max !== undefined && <CharCount value={value} min={min} max={max} />}
            <span className="text-[11px] text-gray-400">{stats.words} words</span>
            {showPreview && (
              <button type="button" onClick={() => setPreview(p => !p)} className="text-[11px] text-bronze hover:underline">
                {preview ? 'Edit' : 'Preview'}
              </button>
            )}
          </span>
        </div>
      )}
      {preview ? (
        <div className="border border-gray-200 rounded bg-white p-3 prose max-w-none" dangerouslySetInnerHTML={{ __html: renderMarkdown(value) }} />
      ) : (
        <div className="relative">
          <EditorToolbar editor={editor} />
          <FindReplaceBar editor={editor} content={value} />
          <SlashMenu editor={editor} />
          <textarea
            ref={editor.ref}
            id={id}
            value={value}
            onChange={e => onChange(e.target.value)}
            onSelect={editor.onSelect}
            onClick={editor.onSelect}
            onKeyUp={editor.onSelect}
            rows={rows}
            placeholder={placeholder}
            className="w-full bg-white border border-gray-200 border-t-0 px-3 py-2.5 text-sm text-charcoal focus:outline-none focus:border-bronze"
          />
        </div>
      )}
      {hint && <p className="text-[11px] text-gray-400 mt-1">{hint}</p>}
    </div>
  );
}
