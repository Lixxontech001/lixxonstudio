/**
 * Pure search helpers — URL state, synonym expansion and filter bookkeeping.
 *
 * Everything here is deliberately framework-free and side-effect-free: the
 * search page composes these, and `searchQuery.test.ts` pins the behaviour
 * (URL round-trips, hostile input, synonym expansion in both directions).
 */

export const SEARCH_PAGE_SIZE = 12;
export const MAX_QUERY_LENGTH = 120;
export const MAX_EXPANDED_TERMS = 24;

export const SORT_OPTIONS = ['relevance', 'newest', 'most_read'] as const;
export type SearchSort = (typeof SORT_OPTIONS)[number];

export const KIND_OPTIONS = ['all', 'article', 'product'] as const;
export type SearchKind = (typeof KIND_OPTIONS)[number];

export const SORT_LABELS: Record<SearchSort, string> = {
  relevance: 'Best match',
  newest: 'Newest',
  most_read: 'Most read',
};

export const KIND_LABELS: Record<SearchKind, string> = {
  all: 'Everything',
  article: 'Articles',
  product: 'Products',
};

export interface SearchFilters {
  kind: SearchKind;
  category: string | null;
  author: string | null;
  tag: string | null;
  minMinutes: number | null;
  maxMinutes: number | null;
  /** yyyy-mm-dd */
  dateFrom: string | null;
  /** yyyy-mm-dd */
  dateTo: string | null;
}

export interface SearchState {
  query: string;
  filters: SearchFilters;
  sort: SearchSort;
  page: number;
}

export interface SynonymRow {
  id?: string;
  term: string;
  synonyms: string[];
}

export interface GlossaryRow {
  id: string;
  term: string;
  slug: string;
  definition: string;
  category: string | null;
}

export interface SearchResultRow {
  result_kind: 'article' | 'product';
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  image_url: string | null;
  category_name: string | null;
  category_slug: string | null;
  author_name: string | null;
  author_slug: string | null;
  published_at: string | null;
  reading_time_minutes: number | null;
  price_label: string | null;
  currency: string | null;
  tags: string[] | null;
  score: number;
  total_count: number;
}

export const EMPTY_FILTERS: SearchFilters = {
  kind: 'all',
  category: null,
  author: null,
  tag: null,
  minMinutes: null,
  maxMinutes: null,
  dateFrom: null,
  dateTo: null,
};

export const EMPTY_STATE: SearchState = { query: '', filters: EMPTY_FILTERS, sort: 'relevance', page: 1 };

/** Trim, collapse whitespace, strip control characters and cap the length. */
export function normaliseQuery(raw: string | null | undefined): string {
  return (raw ?? '')
    .replace(/[\p{Cc}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_QUERY_LENGTH);
}

/** Lower-cased, de-duplicated, length-filtered tokens — what the database scores. */
export function tokenise(query: string): string[] {
  const tokens = normaliseQuery(query)
    .toLowerCase()
    .split(' ')
    .map((t) => t.replace(/^[^\w]+|[^\w]+$/g, ''))
    .filter((t) => t.length >= 2);
  return Array.from(new Set(tokens)).slice(0, 8);
}

/**
 * Expand a query with the admin-editable synonym table, in both directions:
 * "retinol" gains "retinal"/"tretinoin", and "ascorbic acid" gains "vitamin c".
 * Multi-word synonym keys ("vitamin c", "capsule wardrobe") are matched as phrases.
 */
export function expandTerms(query: string, rows: SynonymRow[] = []): string[] {
  const normalised = normaliseQuery(query).toLowerCase();
  if (!normalised) return [];

  const terms = new Set(tokenise(normalised));
  if (terms.size === 0) return Array.from(terms);

  // term/synonym -> every sibling in its row
  const lookup = new Map<string, Set<string>>();
  for (const row of rows) {
    const group = [
      normaliseQuery(row.term).toLowerCase(),
      ...(row.synonyms ?? []).map((s) => normaliseQuery(s).toLowerCase()),
    ].filter((t) => t.length >= 2);
    if (group.length < 2) continue;
    for (const key of group) {
      const bucket = lookup.get(key) ?? new Set<string>();
      for (const sibling of group) if (sibling !== key) bucket.add(sibling);
      lookup.set(key, bucket);
    }
  }

  const words = normalised.split(' ').filter(Boolean);
  for (let size = Math.min(3, words.length); size >= 1; size--) {
    for (let start = 0; start + size <= words.length; start++) {
      const phrase = words.slice(start, start + size).join(' ');
      const related = lookup.get(phrase);
      if (!related) continue;
      for (const sibling of related) {
        if (terms.size >= MAX_EXPANDED_TERMS) break;
        terms.add(sibling);
      }
    }
  }

  return Array.from(terms).slice(0, MAX_EXPANDED_TERMS);
}

/** The terms a reader would understand as "we also looked for". */
export function expansionNote(query: string, rows: SynonymRow[] = []): string[] {
  const base = new Set(tokenise(query));
  return expandTerms(query, rows).filter((t) => !base.has(t)).slice(0, 4);
}

function parseIntInRange(value: string | null, min: number, max: number): number | null {
  if (value === null) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return null;
  return Math.min(max, Math.max(min, parsed));
}

function readDate(value: string | null): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) ? value : null;
}

function readText(value: string | null): string | null {
  const clean = normaliseQuery(value);
  return clean ? clean.slice(0, 80) : null;
}

/** Parse a location search string into validated state (never throws). */
export function parseSearchParams(search: string): SearchState {
  const params = new URLSearchParams(search || '');
  const sortParam = params.get('sort') ?? '';
  const kindParam = params.get('type') ?? '';

  const filters: SearchFilters = {
    kind: (KIND_OPTIONS as readonly string[]).includes(kindParam) ? (kindParam as SearchKind) : 'all',
    category: readText(params.get('cat')),
    author: readText(params.get('author')),
    tag: readText(params.get('tag')),
    minMinutes: parseIntInRange(params.get('min'), 1, 600),
    maxMinutes: parseIntInRange(params.get('max'), 1, 600),
    dateFrom: readDate(params.get('from')),
    dateTo: readDate(params.get('to')),
  };

  // A swapped range is almost always a typo — put it back in order.
  if (filters.minMinutes !== null && filters.maxMinutes !== null && filters.minMinutes > filters.maxMinutes) {
    const swap = filters.minMinutes;
    filters.minMinutes = filters.maxMinutes;
    filters.maxMinutes = swap;
  }
  if (filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo) {
    const swap = filters.dateFrom;
    filters.dateFrom = filters.dateTo;
    filters.dateTo = swap;
  }

  const page = parseIntInRange(params.get('page'), 1, 100) ?? 1;

  return {
    query: normaliseQuery(params.get('q')),
    filters,
    sort: (SORT_OPTIONS as readonly string[]).includes(sortParam) ? (sortParam as SearchSort) : 'relevance',
    page,
  };
}

/** Serialise state back into a query string ('' when everything is default). */
export function buildSearchQuery(state: SearchState): string {
  const params = new URLSearchParams();
  const query = normaliseQuery(state.query);
  if (query) params.set('q', query);
  const f = state.filters;
  if (f.kind !== 'all') params.set('type', f.kind);
  if (f.category) params.set('cat', f.category);
  if (f.author) params.set('author', f.author);
  if (f.tag) params.set('tag', f.tag);
  if (f.minMinutes !== null) params.set('min', String(f.minMinutes));
  if (f.maxMinutes !== null) params.set('max', String(f.maxMinutes));
  if (f.dateFrom) params.set('from', f.dateFrom);
  if (f.dateTo) params.set('to', f.dateTo);
  if (state.sort !== 'relevance') params.set('sort', state.sort);
  if (state.page > 1) params.set('page', String(state.page));
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export interface FilterChip {
  key: keyof SearchFilters;
  label: string;
}

export function activeFilterChips(filters: SearchFilters): FilterChip[] {
  const chips: FilterChip[] = [];
  if (filters.kind !== 'all') chips.push({ key: 'kind', label: KIND_LABELS[filters.kind] });
  if (filters.category) chips.push({ key: 'category', label: prettifySlug(filters.category) });
  if (filters.author) chips.push({ key: 'author', label: `By ${prettifySlug(filters.author)}` });
  if (filters.tag) chips.push({ key: 'tag', label: `#${prettifySlug(filters.tag)}` });
  if (filters.minMinutes !== null && filters.maxMinutes !== null)
    chips.push({ key: 'minMinutes', label: `${filters.minMinutes}–${filters.maxMinutes} min` });
  else if (filters.minMinutes !== null) chips.push({ key: 'minMinutes', label: `${filters.minMinutes}+ min` });
  else if (filters.maxMinutes !== null) chips.push({ key: 'maxMinutes', label: `Under ${filters.maxMinutes} min` });
  if (filters.dateFrom && filters.dateTo) chips.push({ key: 'dateFrom', label: `${filters.dateFrom} → ${filters.dateTo}` });
  else if (filters.dateFrom) chips.push({ key: 'dateFrom', label: `Since ${filters.dateFrom}` });
  else if (filters.dateTo) chips.push({ key: 'dateTo', label: `Until ${filters.dateTo}` });
  return chips;
}

/** Remove one filter, keeping the paired bounds sane (min/max, date range). */
export function clearFilter(filters: SearchFilters, key: keyof SearchFilters): SearchFilters {
  const next: SearchFilters = { ...filters };
  if (key === 'minMinutes') {
    next.minMinutes = null;
    if (filters.maxMinutes !== null && filters.minMinutes !== null && filters.minMinutes === filters.maxMinutes) {
      next.maxMinutes = null;
    }
  } else if (key === 'maxMinutes') {
    next.maxMinutes = null;
    if (filters.minMinutes !== null && filters.maxMinutes !== null && filters.minMinutes === filters.maxMinutes) {
      next.minMinutes = null;
    }
  } else if (key === 'dateFrom') {
    next.dateFrom = null;
    if (filters.dateFrom && filters.dateFrom === filters.dateTo) next.dateTo = null;
  } else if (key === 'dateTo') {
    next.dateTo = null;
    if (filters.dateFrom && filters.dateFrom === filters.dateTo) next.dateFrom = null;
  } else if (key === 'kind') {
    next.kind = 'all';
  } else {
    (next[key] as unknown) = null;
  }
  return next;
}

export function countActiveFilters(filters: SearchFilters): number {
  return activeFilterChips(filters).length;
}

export function hasFilters(filters: SearchFilters): boolean {
  return countActiveFilters(filters) > 0;
}

/** Is there anything worth querying for? (query text or any filter) */
export function hasSearchIntent(state: SearchState): boolean {
  return normaliseQuery(state.query).length > 0 || hasFilters(state.filters);
}

/** Slug/tag → display text ("capsule-wardrobe" → "Capsule wardrobe"). */
export function prettifySlug(slug: string): string {
  const spaced = slug.replace(/[-_]+/g, ' ').trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Relevance only makes sense when there is query text. */
export function effectiveSort(state: SearchState): SearchSort {
  if (state.sort === 'relevance' && !normaliseQuery(state.query)) return 'newest';
  return state.sort;
}

export function totalPages(total: number, pageSize: number = SEARCH_PAGE_SIZE): number {
  if (!Number.isFinite(total) || total <= 0) return 1;
  return Math.max(1, Math.ceil(total / pageSize));
}


/**
 * Knowledge card lookup: does this query name a glossary ingredient/term?
 * Matches the term itself, a phrase inside the query, a token, or — through the
 * synonym expansion — the other name for the same thing ("nicotinamide" finds
 * the Niacinamide card).
 */
export function matchGlossaryTerm(query: string, terms: string[], rows: GlossaryRow[]): GlossaryRow | null {
  const q = normaliseQuery(query).toLowerCase();
  if (!q || !rows.length) return null;
  const expanded = new Set(terms.map((t) => t.toLowerCase()));
  const tokens = new Set(tokenise(q));
  let best: { row: GlossaryRow; score: number } | null = null;

  for (const row of rows) {
    const term = normaliseQuery(row.term).toLowerCase();
    if (term.length < 3) continue;
    let score = 0;
    if (term === q) score = 10;
    else if (q.includes(term)) score = 8;
    else if (expanded.has(term)) score = 6;
    else if (tokens.has(term)) score = 4;
    if (score > (best?.score ?? 0)) best = { row, score };
  }

  return best?.row ?? null;
}
