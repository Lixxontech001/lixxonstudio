/**
 * Touch-visibility regressions (Milestone 2.3): hover must only ever ENHANCE.
 * On a phone (hasTouch, no hover) every title, CTA and control must be visible
 * without hovering. These tests fail if someone reintroduces
 * `opacity-0 group-hover:opacity-100` hides for essential UI.
 */
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ReactNode } from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import MagazineFeed from '../components/MagazineFeed';
import EditorsPicks from '../components/EditorsPicks';
import { NavigationProvider } from '../context/NavigationContext';
import type { PostWithRelations, Category } from '../lib/types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Touch device: no hover capability at all.
window.matchMedia = vi.fn((query: string) => ({
  matches: query.includes('hover: none') || query.includes('pointer: coarse'),
  media: query,
  onchange: null,
  addListener: () => undefined,
  removeListener: () => undefined,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;

vi.mock('../lib/supabaseClient', () => {
  const chain = (): unknown => new Proxy(() => undefined, {
    get(_t, prop) {
      if (prop === 'then') return (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null, count: 0 }).then(res);
      if (prop === 'catch' || prop === 'finally') return () => chain();
      return () => chain();
    },
  });
  return {
    supabaseConfigured: true,
    supabaseConfigError: '',
    supabaseUrl: 'https://test.supabase.co',
    supabaseAnonKey: 'test-anon-key',
    rows: (d: unknown) => (d || []) as unknown[],
    supabase: { from: () => chain(), rpc: () => Promise.resolve({ data: null, error: null }) },
  };
});

let root: Root; let host: HTMLDivElement;
function mount(node: ReactNode) {
  host = document.createElement('div'); document.body.appendChild(host);
  root = createRoot(host);
  act(() => { root.render(node); });
  return host;
}
beforeEach(() => { document.body.innerHTML = ''; });

const category: Category = {
  id: 'c1', name: 'Skincare', slug: 'skincare', description: null,
  sort_order: 0, banner_image: null, seo_title: null, seo_description: null, is_active: true,
};

const post: PostWithRelations = {
  id: 'p1', title: 'Barrier Repair, Slowly', slug: 'barrier-repair-slowly',
  excerpt: 'A calm approach.', content: null,
  cover_image: 'https://images.pexels.com/photos/1/pexels-photo-1.jpeg?auto=compress&cs=tinysrgb&w=800',
  cover_image_alt: 'A calm skincare ritual', category_id: 'c1', author_id: 'a1',
  published_at: '2026-10-01T00:00:00Z', scheduled_at: null, reading_time_minutes: 4,
  featured: false, editors_pick: true, tags: ['skin'], status: 'published',
  seo_title: null, seo_description: null, canonical_url: null,
  created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
  category,
  author: {
    id: 'a1', name: 'Lixxon Studio', slug: 'lixxon-studio', bio: null,
    avatar_url: null, role: 'Editor', social_links: null, is_active: true,
  },
};

function assertNoHoverOnlyHides(el: HTMLElement) {
  for (const node of el.querySelectorAll('*')) {
    const cls = node.getAttribute('class') || '';
    expect(cls).not.toMatch(/opacity-0\s+group-hover:opacity-100/);
    expect(cls).not.toMatch(/(?:^|\s)opacity-0(?:\s|$)/);
  }
}

describe('touch visibility (no hover)', () => {
  it('MagazineFeed card title + metadata render visible with no hover available', () => {
    const el = mount(
      <NavigationProvider>
        <MagazineFeed posts={[post]} categories={[category]} activeCategory="all" onCategoryChange={() => undefined} />
      </NavigationProvider>
    );
    expect(el.textContent).toContain('Barrier Repair, Slowly');
    expect(el.textContent).toMatch(/\b4\s*min\b/i);
    assertNoHoverOnlyHides(el);
  });

  it('EditorsPicks card title + CTA render visible with no hover available', () => {
    const el = mount(
      <NavigationProvider>
        <EditorsPicks posts={[post]} />
      </NavigationProvider>
    );
    expect(el.textContent).toContain('Barrier Repair, Slowly');
    assertNoHoverOnlyHides(el);
  });

  it('CSS keeps .hover-reveal visible by default and only hides it under real hover', () => {
    const css = readFileSync(join(process.cwd(), 'src', 'index.css'), 'utf8');
    // visible by default (touch devices)
    expect(css).toMatch(/\.hover-reveal\s*\{[^}]*opacity:\s*1/);
    // the hiding rule must live INSIDE a hover-capable media query (balanced-brace scan)
    const blocks: string[] = [];
    const marker = '@media (hover: hover) and (pointer: fine)';
    let i = css.indexOf(marker);
    while (i >= 0) {
      const open = css.indexOf('{', i);
      let depth = 1;
      let j = open + 1;
      while (depth > 0 && j < css.length) {
        if (css[j] === '{') depth += 1;
        else if (css[j] === '}') depth -= 1;
        j += 1;
      }
      blocks.push(css.slice(open + 1, j - 1));
      i = css.indexOf(marker, j);
    }
    const touchBlock = blocks.find((b) => b.includes('.group:not(:focus-within) .hover-reveal'));
    expect(touchBlock).toBeDefined();
    expect(touchBlock!).toMatch(/opacity:\s*0/);
    // hover + keyboard equivalence re-show the content
    expect(touchBlock!).toMatch(/:focus-within\s\.hover-reveal/);
    expect(touchBlock!).toMatch(/\.group:hover\s\.hover-reveal/);
  });
});
