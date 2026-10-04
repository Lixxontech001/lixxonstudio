import { useEffect, useMemo, useState } from 'react';
import { Search as SearchIcon, X, SlidersHorizontal } from 'lucide-react';
import {
  activeFilterChips,
  clearFilter,
  countActiveFilters,
  KIND_LABELS,
  KIND_OPTIONS,
  SORT_LABELS,
  SORT_OPTIONS,
  type SearchFilters,
  type SearchKind,
  type SearchSort,
} from '../../lib/searchQuery';
import { useCategories } from '../../hooks/useSupabase';

interface FilterPanelProps {
  filters: SearchFilters;
  sort: SearchSort;
  query: string;
  onChange: (filters: SearchFilters) => void;
  onSortChange: (sort: SearchSort) => void;
  onClearAll: () => void;
}

const DATE_PRESETS = [
  { label: 'Any time', from: null, to: null },
  { label: 'This month', months: 1 },
  { label: 'This year', months: 12 },
  { label: 'Older', older: true },
] as const;

function isoDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

/** The filter body, shared between the desktop rail and the mobile sheet. */
export function FilterFields({ filters, sort, query, onChange, onSortChange, onClearAll }: FilterPanelProps) {
  const { categories } = useCategories();
  const activeCount = countActiveFilters(filters);
  const [tagDraft, setTagDraft] = useState(filters.tag ?? '');
  const [authorDraft, setAuthorDraft] = useState(filters.author ?? '');

  useEffect(() => setTagDraft(filters.tag ?? ''), [filters.tag]);
  useEffect(() => setAuthorDraft(filters.author ?? ''), [filters.author]);

  const datePreset = useMemo(() => {
    if (!filters.dateFrom && !filters.dateTo) return 'Any time';
    if (filters.dateTo && !filters.dateFrom) return 'Older';
    if (filters.dateFrom && !filters.dateTo) {
      const monthAgo = isoDaysAgo(31);
      const yearAgo = isoDaysAgo(366);
      if (filters.dateFrom >= monthAgo) return 'This month';
      if (filters.dateFrom >= yearAgo) return 'This year';
    }
    return 'Custom';
  }, [filters.dateFrom, filters.dateTo]);

  const applyPreset = (preset: (typeof DATE_PRESETS)[number]) => {
    if (preset.label === 'Any time') onChange({ ...filters, dateFrom: null, dateTo: null });
    else if ('older' in preset) onChange({ ...filters, dateFrom: null, dateTo: isoDaysAgo(366) });
    else onChange({ ...filters, dateFrom: isoDaysAgo(preset.months * 31), dateTo: null });
  };

  return (
    <div className="space-y-7">
      <fieldset>
        <legend className="text-[10px] tracking-ultra-wide uppercase text-bronze mb-3">Show me</legend>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Result type">
          {KIND_OPTIONS.map((kind: SearchKind) => (
            <button
              key={kind}
              type="button"
              role="radio"
              aria-checked={filters.kind === kind}
              onClick={() => onChange({ ...filters, kind })}
              className={`px-3 py-2 min-h-[44px] text-xs rounded-full border transition-colors ${
                filters.kind === kind
                  ? 'bg-charcoal text-white border-charcoal'
                  : 'bg-white text-charcoal-muted border-taupe/40 hover:border-bronze hover:text-bronze'
              }`}
            >
              {KIND_LABELS[kind]}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="text-[10px] tracking-ultra-wide uppercase text-bronze mb-3">Sort by</legend>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Sort order">
          {SORT_OPTIONS.map((option) => {
            const disabled = option === 'relevance' && !query.trim();
            return (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={sort === option}
                disabled={disabled}
                title={disabled ? 'Relevance needs a search term' : undefined}
                onClick={() => onSortChange(option)}
                className={`px-3 py-2 min-h-[44px] text-xs rounded-full border transition-colors disabled:opacity-40 ${
                  sort === option
                    ? 'bg-bronze text-white border-bronze'
                    : 'bg-white text-charcoal-muted border-taupe/40 hover:border-bronze hover:text-bronze'
                }`}
              >
                {SORT_LABELS[option]}
              </button>
            );
          })}
        </div>
      </fieldset>

      <div>
        <label htmlFor="search-category" className="block text-[10px] tracking-ultra-wide uppercase text-bronze mb-3">
          Category
        </label>
        <select
          id="search-category"
          value={filters.category ?? ''}
          onChange={(e) => onChange({ ...filters, category: e.target.value || null })}
          className="w-full min-h-[44px] bg-white border border-taupe/40 px-3 text-sm text-charcoal rounded-sm focus:outline-none focus:border-bronze"
        >
          <option value="">All categories</option>
          {categories.map((category) => (
            <option key={category.id} value={category.slug}>
              {category.name}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="search-min-minutes" className="block text-[10px] tracking-ultra-wide uppercase text-bronze mb-3">
            Min read
          </label>
          <input
            id="search-min-minutes"
            type="number"
            inputMode="numeric"
            min={1}
            max={600}
            value={filters.minMinutes ?? ''}
            onChange={(e) => onChange({ ...filters, minMinutes: e.target.value ? Number(e.target.value) : null })}
            className="w-full min-h-[44px] bg-white border border-taupe/40 px-3 text-sm rounded-sm focus:outline-none focus:border-bronze"
            placeholder="Any"
          />
        </div>
        <div>
          <label htmlFor="search-max-minutes" className="block text-[10px] tracking-ultra-wide uppercase text-bronze mb-3">
            Max read
          </label>
          <input
            id="search-max-minutes"
            type="number"
            inputMode="numeric"
            min={1}
            max={600}
            value={filters.maxMinutes ?? ''}
            onChange={(e) => onChange({ ...filters, maxMinutes: e.target.value ? Number(e.target.value) : null })}
            className="w-full min-h-[44px] bg-white border border-taupe/40 px-3 text-sm rounded-sm focus:outline-none focus:border-bronze"
            placeholder="Any"
          />
        </div>
      </div>

      <div>
        <label htmlFor="search-tag" className="block text-[10px] tracking-ultra-wide uppercase text-bronze mb-3">
          Tag
        </label>
        <div className="flex gap-2">
          <input
            id="search-tag"
            value={tagDraft}
            onChange={(e) => setTagDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onChange({ ...filters, tag: tagDraft.trim().replace(/^#/, '') || null });
              }
            }}
            placeholder="e.g. retinoids"
            className="w-full min-h-[44px] bg-white border border-taupe/40 px-3 text-sm rounded-sm focus:outline-none focus:border-bronze"
          />
          <button
            type="button"
            onClick={() => onChange({ ...filters, tag: tagDraft.trim().replace(/^#/, '') || null })}
            className="px-3 min-h-[44px] min-w-[44px] text-xs border border-taupe/40 rounded-sm text-charcoal-muted hover:border-bronze hover:text-bronze"
          >
            Apply
          </button>
        </div>
      </div>

      <div>
        <label htmlFor="search-author" className="block text-[10px] tracking-ultra-wide uppercase text-bronze mb-3">
          Author
        </label>
        <div className="flex gap-2">
          <input
            id="search-author"
            value={authorDraft}
            onChange={(e) => setAuthorDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onChange({ ...filters, author: authorDraft.trim().replace(/^\//, '') || null });
              }
            }}
            placeholder="e.g. elena"
            className="w-full min-h-[44px] bg-white border border-taupe/40 px-3 text-sm rounded-sm focus:outline-none focus:border-bronze"
          />
          <button
            type="button"
            onClick={() => onChange({ ...filters, author: authorDraft.trim().replace(/^\//, '') || null })}
            className="px-3 min-h-[44px] min-w-[44px] text-xs border border-taupe/40 rounded-sm text-charcoal-muted hover:border-bronze hover:text-bronze"
          >
            Apply
          </button>
        </div>
      </div>

      <fieldset>
        <legend className="text-[10px] tracking-ultra-wide uppercase text-bronze mb-3">Published</legend>
        <div className="flex flex-wrap gap-2">
          {DATE_PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              aria-pressed={datePreset === preset.label}
              onClick={() => applyPreset(preset)}
              className={`px-3 py-2 min-h-[44px] text-xs rounded-full border transition-colors ${
                datePreset === preset.label
                  ? 'bg-bronze text-white border-bronze'
                  : 'bg-white text-charcoal-muted border-taupe/40 hover:border-bronze hover:text-bronze'
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3 mt-3">
          <div>
            <label htmlFor="search-date-from" className="sr-only">
              Published from
            </label>
            <input
              id="search-date-from"
              type="date"
              value={filters.dateFrom ?? ''}
              onChange={(e) => onChange({ ...filters, dateFrom: e.target.value || null })}
              className="w-full min-h-[44px] bg-white border border-taupe/40 px-3 text-sm rounded-sm focus:outline-none focus:border-bronze"
            />
          </div>
          <div>
            <label htmlFor="search-date-to" className="sr-only">
              Published until
            </label>
            <input
              id="search-date-to"
              type="date"
              value={filters.dateTo ?? ''}
              onChange={(e) => onChange({ ...filters, dateTo: e.target.value || null })}
              className="w-full min-h-[44px] bg-white border border-taupe/40 px-3 text-sm rounded-sm focus:outline-none focus:border-bronze"
            />
          </div>
        </div>
      </fieldset>

      {activeCount > 0 && (
        <button
          type="button"
          onClick={onClearAll}
          className="inline-flex items-center gap-2 text-xs text-charcoal-muted hover:text-bronze transition-colors min-h-[44px]"
        >
          <X size={14} /> Clear all filters ({activeCount})
        </button>
      )}
    </div>
  );
}

/** Desktop filter rail. */
export function FilterRail(props: FilterPanelProps) {
  return (
    <aside className="hidden lg:block w-64 shrink-0" aria-label="Search filters">
      <div className="sticky top-28 bg-white/70 border border-taupe/30 rounded-sm p-6">
        <FilterFields {...props} />
      </div>
    </aside>
  );
}

/** Mobile filter sheet — full-height, focus-friendly, dismissible. */
export function FilterSheet(props: FilterPanelProps & { open: boolean; onClose: () => void }) {
  const { open, onClose } = props;

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Search filters">
      <button type="button" aria-label="Close filters" onClick={onClose} className="absolute inset-0 bg-charcoal/40" />
      <div className="absolute inset-x-0 bottom-0 max-h-[88dvh] bg-white rounded-t-lg overflow-y-auto p-6 pb-10">
        <div className="flex items-center justify-between mb-6">
          <h2 className="font-serif text-xl text-charcoal">Filters</h2>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center justify-center w-11 h-11 rounded-full border border-taupe/40 text-charcoal-muted"
            aria-label="Close filters"
          >
            <X size={16} />
          </button>
        </div>
        <FilterFields {...props} />
        <button
          type="button"
          onClick={onClose}
          className="sticky bottom-0 mt-8 w-full min-h-[48px] bg-charcoal text-white text-xs tracking-editorial uppercase rounded-sm"
        >
          Show results
        </button>
      </div>
    </div>
  );
}

/** Active filter chips + the mobile "Filters" trigger. */
export function FilterChips({
  filters,
  onChange,
  onClearAll,
  onOpenSheet,
}: {
  filters: SearchFilters;
  onChange: (filters: SearchFilters) => void;
  onClearAll: () => void;
  onOpenSheet: () => void;
}) {
  const chips = activeFilterChips(filters);

  return (
    <div className="flex flex-wrap items-center gap-2 mb-6">
      <button
        type="button"
        onClick={onOpenSheet}
        className="lg:hidden inline-flex items-center gap-2 px-3 min-h-[44px] text-xs border border-taupe/40 rounded-full text-charcoal-muted hover:border-bronze hover:text-bronze"
      >
        <SlidersHorizontal size={14} />
        Filters{chips.length ? ` (${chips.length})` : ''}
      </button>
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          onClick={() => onChange(clearFilter(filters, chip.key))}
          className="inline-flex items-center gap-1.5 px-3 min-h-[36px] bg-taupe-light/60 text-charcoal-muted text-xs rounded-full border border-taupe/30 hover:border-bronze hover:text-bronze"
          aria-label={`Remove filter ${chip.label}`}
        >
          {chip.label}
          <X size={12} />
        </button>
      ))}
      {chips.length > 1 && (
        <button type="button" onClick={onClearAll} className="text-xs text-charcoal-muted hover:text-bronze px-2 min-h-[36px]">
          Clear all
        </button>
      )}
    </div>
  );
}

export { SearchIcon };
