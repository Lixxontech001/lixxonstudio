import { describe, it, expect } from 'vitest';
import {
  activeFilterChips,
  buildSearchQuery,
  clearFilter,
  countActiveFilters,
  effectiveSort,
  EMPTY_FILTERS,
  expandTerms,
  expansionNote,
  hasSearchIntent,
  normaliseQuery,
  parseSearchParams,
  prettifySlug,
  tokenise,
  totalPages,
  MAX_QUERY_LENGTH,
  matchGlossaryTerm,
  type GlossaryRow,
  type SynonymRow,
} from '../lib/searchQuery';

const SYNONYMS: SynonymRow[] = [
  { term: 'niacinamide', synonyms: ['nicotinamide', 'vitamin b3'] },
  { term: 'retinol', synonyms: ['retinal', 'tretinoin', 'vitamin a'] },
  { term: 'vitamin c', synonyms: ['ascorbic acid', 'l-ascorbic acid'] },
  { term: 'capsule wardrobe', synonyms: ['capsule closet', 'minimal wardrobe'] },
  { term: 'spf', synonyms: ['sunscreen'] },
];

describe('normaliseQuery', () => {
  it('collapses whitespace and trims', () => {
    expect(normaliseQuery('  retinol   vs  retinal ')).toBe('retinol vs retinal');
  });

  it('strips control characters and caps the length', () => {
    const dirty = `niacin\u0000amide\n${'x'.repeat(500)}`;
    const clean = normaliseQuery(dirty);
    expect(clean).not.toContain('\u0000');
    expect(clean).not.toContain('\n');
    expect(clean.length).toBeLessThanOrEqual(MAX_QUERY_LENGTH);
  });

  it('survives null/undefined', () => {
    expect(normaliseQuery(null)).toBe('');
    expect(normaliseQuery(undefined)).toBe('');
  });
});

describe('tokenise', () => {
  it('lowercases, drops one-letter noise and de-duplicates', () => {
    expect(tokenise('Retinol a RETINOL retinal')).toEqual(['retinol', 'retinal']);
  });

  it('keeps at most eight tokens', () => {
    expect(tokenise('one two three four five six seven eight nine ten').length).toBe(8);
  });
});

describe('expandTerms (synonym expansion)', () => {
  it('expands a canonical term with its synonyms', () => {
    const terms = expandTerms('niacinamide', SYNONYMS);
    expect(terms).toContain('niacinamide');
    expect(terms).toContain('nicotinamide');
    expect(terms).toContain('vitamin b3');
  });

  it('expands the other direction too (synonym → canonical)', () => {
    const terms = expandTerms('ascorbic acid', SYNONYMS);
    expect(terms).toContain('vitamin c');
    expect(terms).toContain('l-ascorbic acid');
  });

  it('matches multi-word phrase keys', () => {
    const terms = expandTerms('minimal wardrobe ideas', SYNONYMS);
    expect(terms).toContain('capsule wardrobe');
    expect(terms).toContain('capsule closet');
  });

  it('finds a phrase inside a longer query', () => {
    const terms = expandTerms('the best vitamin c serum', SYNONYMS);
    expect(terms).toContain('ascorbic acid');
  });

  it('does not invent synonyms for unrelated words', () => {
    expect(expandTerms('money mindset', SYNONYMS)).toEqual(['money', 'mindset']);
  });

  it('returns the plain tokens when there is no synonym table', () => {
    expect(expandTerms('retinol basics', [])).toEqual(['retinol', 'basics']);
  });

  it('caps the expansion so the RPC payload stays small', () => {
    const many: SynonymRow[] = [
      { term: 'retinol', synonyms: Array.from({ length: 60 }, (_, i) => `retinoid-${i}`) },
    ];
    expect(expandTerms('retinol', many).length).toBeLessThanOrEqual(24);
  });

  it('ignores blank rows and one-character synonyms', () => {
    const messy: SynonymRow[] = [
      { term: '  ', synonyms: ['x'] },
      { term: 'spf', synonyms: ['a', 'sunscreen'] },
    ];
    const terms = expandTerms('spf', messy);
    expect(terms).toContain('sunscreen');
    expect(terms).not.toContain('a');
  });

  it('expansionNote lists only the added terms', () => {
    expect(expansionNote('retinol', SYNONYMS)).toEqual(expect.arrayContaining(['retinal']));
    expect(expansionNote('retinol', SYNONYMS)).not.toContain('retinol');
  });
});

describe('parseSearchParams', () => {
  it('reads query, filters, sort and page', () => {
    const state = parseSearchParams(
      '?q=retinol&type=article&cat=skincare&author=elena&tag=retinoids&min=4&max=12&from=2026-01-01&to=2026-06-30&sort=most_read&page=3',
    );
    expect(state.query).toBe('retinol');
    expect(state.filters).toEqual({
      kind: 'article',
      category: 'skincare',
      author: 'elena',
      tag: 'retinoids',
      minMinutes: 4,
      maxMinutes: 12,
      dateFrom: '2026-01-01',
      dateTo: '2026-06-30',
    });
    expect(state.sort).toBe('most_read');
    expect(state.page).toBe(3);
  });

  it('falls back to defaults for junk values', () => {
    const state = parseSearchParams('?type=../../etc/passwd&sort=DROP&page=-9&min=abc&from=not-a-date');
    expect(state.filters.kind).toBe('all');
    expect(state.sort).toBe('relevance');
    expect(state.page).toBe(1);
    expect(state.filters.minMinutes).toBeNull();
    expect(state.filters.dateFrom).toBeNull();
  });

  it('clamps extremes instead of trusting them', () => {
    const state = parseSearchParams('?min=0&max=99999&page=100000');
    expect(state.filters.minMinutes).toBe(1);
    expect(state.filters.maxMinutes).toBe(600);
    expect(state.page).toBe(100);
  });

  it('swaps an inverted reading-time or date range', () => {
    const state = parseSearchParams('?min=20&max=5&from=2026-06-01&to=2026-01-01');
    expect(state.filters.minMinutes).toBe(5);
    expect(state.filters.maxMinutes).toBe(20);
    expect(state.filters.dateFrom).toBe('2026-01-01');
    expect(state.filters.dateTo).toBe('2026-06-01');
  });

  it('handles an empty search string', () => {
    const state = parseSearchParams('');
    expect(state.query).toBe('');
    expect(state.filters).toEqual(EMPTY_FILTERS);
  });
});

describe('buildSearchQuery', () => {
  it('serialises only non-default state', () => {
    const qs = buildSearchQuery({
      query: 'niacinamide',
      filters: { ...EMPTY_FILTERS, kind: 'product', tag: 'barrier' },
      sort: 'newest',
      page: 2,
    });
    const params = new URLSearchParams(qs);
    expect(params.get('q')).toBe('niacinamide');
    expect(params.get('type')).toBe('product');
    expect(params.get('tag')).toBe('barrier');
    expect(params.get('sort')).toBe('newest');
    expect(params.get('page')).toBe('2');
    expect(params.get('cat')).toBeNull();
  });

  it('returns an empty string when everything is default', () => {
    expect(buildSearchQuery({ query: '', filters: EMPTY_FILTERS, sort: 'relevance', page: 1 })).toBe('');
  });

  it('round-trips through parseSearchParams', () => {
    const original = {
      query: 'vitamin c serum',
      filters: { ...EMPTY_FILTERS, kind: 'article' as const, minMinutes: 3, maxMinutes: 9, dateFrom: '2026-02-01' },
      sort: 'most_read' as const,
      page: 4,
    };
    const parsed = parseSearchParams(buildSearchQuery(original));
    expect(parsed.query).toBe(original.query);
    expect(parsed.filters).toEqual(original.filters);
    expect(parsed.sort).toBe(original.sort);
    expect(parsed.page).toBe(original.page);
  });
});

describe('filter chips', () => {
  it('labels every active filter readably', () => {
    const chips = activeFilterChips({
      ...EMPTY_FILTERS,
      kind: 'article',
      tag: 'capsule-wardrobe',
      minMinutes: 4,
      maxMinutes: 4,
    });
    expect(chips.map((c) => c.label)).toEqual(['Articles', '#Capsule wardrobe', '4–4 min']);
  });

  it('collapses an open-ended reading time to one chip', () => {
    expect(activeFilterChips({ ...EMPTY_FILTERS, minMinutes: 6 }).map((c) => c.label)).toEqual(['6+ min']);
    expect(activeFilterChips({ ...EMPTY_FILTERS, maxMinutes: 6 }).map((c) => c.label)).toEqual(['Under 6 min']);
  });

  it('counts zero for the default filter set', () => {
    expect(countActiveFilters(EMPTY_FILTERS)).toBe(0);
  });

  it('clears a single filter and keeps the rest', () => {
    const filters = { ...EMPTY_FILTERS, kind: 'product' as const, tag: 'spf' };
    expect(clearFilter(filters, 'tag')).toEqual({ ...filters, tag: null });
    expect(clearFilter(filters, 'kind').kind).toBe('all');
  });

  it('clears both ends of an equal date range together', () => {
    const filters = { ...EMPTY_FILTERS, dateFrom: '2026-01-01', dateTo: '2026-01-01' };
    const cleared = clearFilter(filters, 'dateFrom');
    expect(cleared.dateFrom).toBeNull();
    expect(cleared.dateTo).toBeNull();
  });
});

describe('intent and paging helpers', () => {
  it('knows when there is nothing to search for', () => {
    expect(hasSearchIntent({ query: '   ', filters: EMPTY_FILTERS, sort: 'relevance', page: 1 })).toBe(false);
    expect(hasSearchIntent({ query: 'spf', filters: EMPTY_FILTERS, sort: 'relevance', page: 1 })).toBe(true);
    expect(
      hasSearchIntent({ query: '', filters: { ...EMPTY_FILTERS, category: 'skincare' }, sort: 'relevance', page: 1 }),
    ).toBe(true);
  });

  it('falls back to newest when relevance has no query', () => {
    expect(effectiveSort({ query: '', filters: EMPTY_FILTERS, sort: 'relevance', page: 1 })).toBe('newest');
    expect(effectiveSort({ query: 'spf', filters: EMPTY_FILTERS, sort: 'relevance', page: 1 })).toBe('relevance');
  });

  it('computes total pages safely', () => {
    expect(totalPages(0)).toBe(1);
    expect(totalPages(-5)).toBe(1);
    expect(totalPages(25, 12)).toBe(3);
  });

  it('prettifies slugs', () => {
    expect(prettifySlug('capsule-wardrobe')).toBe('Capsule wardrobe');
  });
});

describe('matchGlossaryTerm (knowledge card)', () => {
  const glossary: GlossaryRow[] = [
    { id: 'g1', term: 'Niacinamide', slug: 'niacinamide', definition: 'Vitamin B3...', category: 'skincare' },
    { id: 'g2', term: 'Retinoid', slug: 'retinoid', definition: 'Vitamin A family...', category: 'skincare' },
    { id: 'g3', term: 'Capsule wardrobe', slug: 'capsule-wardrobe', definition: 'A small wardrobe...', category: 'style' },
  ];

  it('matches the ingredient the reader typed', () => {
    const match = matchGlossaryTerm('niacinamide', expandTerms('niacinamide', SYNONYMS), glossary);
    expect(match?.slug).toBe('niacinamide');
  });

  it('matches through a synonym, so the card names the canonical term', () => {
    const match = matchGlossaryTerm('nicotinamide', expandTerms('nicotinamide', SYNONYMS), glossary);
    expect(match?.slug).toBe('niacinamide');
  });

  it('matches a multi-word glossary term inside a question', () => {
    const match = matchGlossaryTerm('how do I build a capsule wardrobe', [], glossary);
    expect(match?.slug).toBe('capsule-wardrobe');
  });

  it('returns nothing for an unrelated query', () => {
    expect(matchGlossaryTerm('how to fix a leaking tap', [], glossary)).toBeNull();
  });

  it('handles an empty glossary', () => {
    expect(matchGlossaryTerm('niacinamide', [], [])).toBeNull();
  });
});
