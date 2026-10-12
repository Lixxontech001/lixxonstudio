// Phase H slice 2: the in-place help on the rest of the surfaces, and the sections behind it.
// Real components where one can be mounted with a fake backend, and the real line for each anchor.
// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GUIDE_LINK_LABEL, GUIDE_MISSING_SHORT, GUIDE_PATH, guideShort } from '../admin/lib/guide';
import { BUILT_IN_LOOK } from '../lib/videoLook';
import { GUIDE_SECTIONS } from '../admin/lib/guideSections';

type Result = { data: unknown; error: unknown };
const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), invoke: vi.fn(), can: vi.fn(() => true) }));
vi.mock('../lib/supabaseClient', () => ({ supabase: { from: mocks.from, rpc: mocks.rpc, functions: { invoke: mocks.invoke } } }));
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ can: mocks.can, session: { user: { id: 'owner-1' } }, adminAccess: { status: 'active', is_owner: true, permissions: [] } }),
}));

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import AdminMinds from '../admin/pages/AdminMinds';
import AutomationVideoLook from '../admin/pages/AutomationVideoLook';
import BuddyChanges from '../buddy/BuddyChanges';
import BuddyChat from '../buddy/BuddyChat';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const GUIDE_SECTION_IDS = GUIDE_SECTIONS.map((section) => section.id);

let host: HTMLDivElement;
let root: Root | null = null;
let reads: Record<string, () => Result>;

/** A fake table. Reads resolve to the table's rows. Anything not faked is an empty read. */
function fromTable(table: string) {
  const run = (): Result => reads[table]?.() ?? { data: [], error: null };
  const chain: Record<string, unknown> = {
    then: (resolve: (value: Result) => unknown, reject?: (error: unknown) => unknown) => Promise.resolve(run()).then(resolve, reject),
  };
  for (const method of ['select', 'order', 'limit', 'eq', 'is', 'in', 'gt', 'maybeSingle', 'update']) chain[method] = () => chain;
  return chain;
}

const read = (file: string) => readFileSync(join(process.cwd(), file), 'utf8');

const READY_PACK = {
  id: 'pack-ready', channel: 'instagram', local_day: '2026-10-12', post_id: 'post-1',
  article_url: '/blog/easy-skincare-routine', suggested_at_utc: '2026-10-12T13:00:00+00:00',
  suggested_label: 'Morning', caption: 'A calm routine for dry skin.', pin_title: null, pin_description: null,
  video_path: '/tmp/pack.mp4', product_ids: ['prod-1'], status: 'ready', blocked_reason: null,
  posted_at: null, created_at: '2026-10-12T08:00:00Z',
};

async function settle() {
  await act(async () => {
    for (let i = 0; i < 30; i += 1) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function render(element: React.ReactElement) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(element);
  });
  await settle();
  return host;
}

function links(el: HTMLElement) {
  return Array.from(el.querySelectorAll('a')).filter((link) => link.textContent === GUIDE_LINK_LABEL);
}

const hrefs = (el: HTMLElement) => links(el).map((link) => link.getAttribute('href') ?? '');
const decoded = (el: HTMLElement) => hrefs(el).map((href) => decodeURIComponent(href));

beforeEach(() => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('reduce'), media: query, addEventListener: () => {}, removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
  document.body.innerHTML = '';
  mocks.from.mockReset();
  mocks.rpc.mockReset();
  mocks.invoke.mockReset();
  mocks.can.mockReturnValue(true);
  // Buddy's chat asks the server for its key status and for today's briefing. Both are answered quietly here.
  mocks.invoke.mockImplementation(async (_name: string, options?: { body?: { action?: string } }) => {
    if (options?.body?.action === 'status') return { data: { ok: true, action: 'status', configured: true }, error: null };
    if (options?.body?.action === 'briefing') {
      return { data: { ok: true, action: 'briefing', chat_id: 'brief-1', created: true, first_visit: true, quiet: true, text: 'Quiet since you left.' }, error: null };
    }
    return { data: null, error: null };
  });
  mocks.from.mockImplementation((table: string) => fromTable(table));
  reads = {
    minds_controls: () => ({ data: { takeover: false, kill_scope: 'none' }, error: null }),
    minds_log: () => ({ data: [], error: null }),
    minds_packs: () => ({ data: [READY_PACK], error: null }),
    posts: () => ({ data: [{ id: 'post-1', title: 'Easy Skincare Routine for Dry Skin' }], error: null }),
    products: () => ({ data: [{ id: 'prod-1', name: 'Calm Skin Routine Guide' }], error: null }),
    post_product_edits: () => ({ data: [], error: null }),
    minds_gap_notes: () => ({ data: [], error: null }),
  };
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  host?.remove();
});

describe('the anchors slice 2 points at', () => {
  it('every section slice 2 links to exists on the guide page, with a real line', () => {
    for (const id of ['minds', 'takeover', 'kill', 'video-look', 'packs', 'i-posted-this', 'buddy-chat', 'product-slots']) {
      expect(GUIDE_SECTION_IDS, id).toContain(id);
      expect(guideShort(id), id).not.toBe(GUIDE_MISSING_SHORT);
    }
  });
});

describe('Minds carries the guide help for Takeover and Kill', () => {
  it('shows the page line, the Takeover line and the Kill line, each back to that card', async () => {
    const el = await render(<AdminMinds />);
    const found = decoded(el);
    expect(found.some((href) => href.startsWith(GUIDE_PATH) && href.endsWith('#minds'))).toBe(true);
    expect(found.some((href) => href.includes('#takeover') && href.includes('/admin/ai#minds-takeover'))).toBe(true);
    expect(found.some((href) => href.includes('#kill') && href.includes('/admin/ai#minds-kill'))).toBe(true);
    expect(el.textContent).toContain(guideShort('takeover'));
    expect(el.textContent).toContain(guideShort('kill'));
    // The two cards keep a field the return can land on, and Takeover is still off.
    expect(el.querySelector('#minds-takeover')).not.toBeNull();
    expect(el.querySelector('#minds-kill')).not.toBeNull();
    expect((el.querySelector('[role="switch"]') as HTMLElement | null)?.getAttribute('aria-checked')).toBe('false');
  });
});

describe('Video look carries the guide help for the length and captions', () => {
  it('shows the line next to the three values, back to the length box', async () => {
    mocks.rpc.mockImplementation(async () => ({
      data: {
        active_id: 'look-1',
        templates: [{ id: 'look-1', name: BUILT_IN_LOOK.name, is_active: true, duration_seconds: BUILT_IN_LOOK.duration_seconds, fps: BUILT_IN_LOOK.fps, music: 'none', created_at: '2026-10-10T00:00:00Z' }],
        active_document: BUILT_IN_LOOK,
      },
      error: null,
    }));
    const el = await render(<AutomationVideoLook />);
    expect(decoded(el).some((href) => href.includes('#video-look') && href.includes('/admin/automation/video-look#look-length'))).toBe(true);
    expect(el.textContent).toContain(guideShort('video-look'));
    expect(el.querySelector('#look-length')).not.toBeNull();
    expect(el.querySelector('#look-caption-size')).not.toBeNull();
    expect(el.querySelector('#look-caption-colour')).not.toBeNull();
  });
});

describe("Buddy's own screens carry the guide help", () => {
  it('Changes shows the packs line, and the I posted this line beside that button', async () => {
    const el = await render(<BuddyChanges vibe="noir" onBack={() => undefined} />);
    const found = decoded(el);
    expect(found.some((href) => href.includes('#packs') && href.includes('back=/buddy'))).toBe(true);
    expect(found.some((href) => href.includes('#i-posted-this') && href.includes('back=/buddy'))).toBe(true);
    expect(el.textContent).toContain(guideShort('packs'));
    expect(el.textContent).toContain(guideShort('i-posted-this'));
    // The owner's own mark is the only action there, and it is unchanged.
    expect(Array.from(el.querySelectorAll('button')).some((button) => button.textContent === 'I posted this')).toBe(true);
  });

  it('the empty chat carries the guide help, and it names the plain-words rule', async () => {
    const el = await render(<BuddyChat />);
    // The greeting comes first; Continue opens the chat with its empty state.
    const continueButton = Array.from(el.querySelectorAll('button')).find((button) => (button.textContent || '').trim() === 'Continue');
    await act(async () => {
      continueButton?.click();
    });
    await settle();
    const found = decoded(el);
    expect(found.some((href) => href.includes('#buddy-chat') && href.includes('back=/buddy'))).toBe(true);
    expect(el.textContent).toContain(guideShort('buddy-chat'));
  });

  it('the article editor carries the products line, back to this article', () => {
    const source = read('src/admin/pages/AdminArticleEditor.tsx');
    expect(source).toContain('<GuideLink section="product-slots" back={guideBackFor(postId)} />');
    expect(source).toContain('function guideBackFor(postId?: string): string');
    expect(source).toContain('id="article-product-slots"');
    expect(source).toMatch(/\/admin\/articles\/edit\/\$\{postId\}#article-product-slots/);
  });

  it('the link on Buddy opens the guide and comes back to Buddy', async () => {
    const el = await render(<BuddyChanges vibe="noir" onBack={() => undefined} />);
    for (const href of hrefs(el)) {
      expect(href.startsWith(`${GUIDE_PATH}?back=`)).toBe(true);
      expect(decodeURIComponent(href)).toContain('back=/buddy');
    }
  });
});
