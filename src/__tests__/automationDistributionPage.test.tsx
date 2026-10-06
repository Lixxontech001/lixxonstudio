// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DISTRIBUTION_CHANNEL_KEYS, type DistributionChannelKey } from '../lib/automationDistribution';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), invoke: vi.fn(), access: null as unknown }));
vi.mock('../lib/supabaseClient', () => ({
  supabase: { rpc: mocks.rpc, functions: { invoke: mocks.invoke } },
}));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ adminAccess: mocks.access, email: 'owner@example.com', session: { user: { email_confirmed_at: '2026-10-01T00:00:00.000Z' } } }) }));

import AutomationDistribution from '../admin/pages/AutomationDistribution';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const POST_ID = '85000000-0000-4000-8000-000000000001';
const DRAFT_ID = '85000000-0000-4000-8000-000000000002';
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const SLUG = 'owner-written-article';
let host: HTMLDivElement;
let root: Root;

function linkFor(channel: DistributionChannelKey): string {
  const medium = channel === 'newsletter' ? 'email' : channel === 'site_widget' ? 'onsite' : 'organic_social';
  return `https://lixxonstudio.com/blog/${SLUG}?utm_source=${channel}&utm_medium=${medium}&utm_campaign=${SLUG}`;
}

function payloadFor(channel: DistributionChannelKey) {
  return {
    title: 'Owner title', subject: 'Owner subject', caption: `Owner-approved copy for ${channel}.`,
    hashtags: ['#ownerwritten'], cta: 'Read the article', link: linkFor(channel),
    image_url: null, image_alt: '',
  };
}

type DraftFixture = {
  id: string;
  payload: ReturnType<typeof payloadFor>;
  payload_sha256: string;
  review_status: 'pending' | 'approved' | 'sent';
  approved_at: string | null;
  delivery: { status: 'sent'; remote_post_id: string; remote_url: null; usage_count: number; safe_error_code: null; created_at: string } | null;
  test_delivery: { status: 'sent'; remote_email_id: string; safe_error_code: null; created_at: string } | null;
};
type ChannelFixture = {
  channel_key: DistributionChannelKey;
  label: string;
  state: string;
  state_reason: string;
  approval_required: true;
  auto_publish_enabled: false;
  daily_free_quota: number | null;
  quota_remaining: number | null;
  last_readback_status: string;
  last_readback_at: string | null;
  circuit_state: 'closed' | 'open' | 'half_open';
  failure_streak: number;
  last_failure_class: 'quota' | 'authentication' | 'policy' | 'transient' | null;
  retry_after: string | null;
  usage_today: {
    usage_day: string;
    readback_attempts: number;
    delivery_attempts: number;
    delivery_successes: number;
    delivery_failures: number;
    owner_test_email_attempts: number;
  };
  draft: DraftFixture | null;
};
type SnapshotFixture = {
  post_id: string;
  title: string;
  slug: string;
  status: 'published';
  scheduled_at_utc: null;
  excerpt: string;
  cover_image: null;
  cover_image_alt: string;
  flags: { 'automation.enabled': boolean; 'automation.distribution': boolean };
  channels: ChannelFixture[];
  metrics: never[];
};

function emptySnapshot(): SnapshotFixture {
  return {
    post_id: POST_ID, title: 'Owner title', slug: SLUG, status: 'published',
    scheduled_at_utc: null, excerpt: 'Owner-authored excerpt only.', cover_image: null, cover_image_alt: '',
    flags: { 'automation.enabled': true, 'automation.distribution': false },
    channels: DISTRIBUTION_CHANNEL_KEYS.map(key => ({
      channel_key: key, label: key === 'youtube_shorts' ? 'YouTube Shorts' : key,
      state: 'manual_kit', state_reason: 'No provider readback has been recorded.',
      approval_required: true, auto_publish_enabled: false,
      daily_free_quota: key === 'telegram' ? 10 : null,
      quota_remaining: key === 'telegram' ? 10 : null,
      last_readback_status: 'not_tested', last_readback_at: null,
      circuit_state: 'closed', failure_streak: 0, last_failure_class: null, retry_after: null,
      usage_today: {
        usage_day: '2026-10-06', readback_attempts: 0, delivery_attempts: 0,
        delivery_successes: 0, delivery_failures: 0, owner_test_email_attempts: 0,
      },
      draft: null,
    })),
    metrics: [],
  };
}

function getChannel(state: SnapshotFixture, key: DistributionChannelKey): ChannelFixture {
  const channel = state.channels.find(row => row.channel_key === key);
  if (!channel) throw new Error(`Missing fixture channel ${key}`);
  return channel;
}

function getDraft(channel: ChannelFixture): NonNullable<ChannelFixture['draft']> {
  if (!channel.draft) throw new Error(`Missing draft for ${channel.channel_key}`);
  return channel.draft;
}

function cardFor(element: HTMLElement, title: string): HTMLElement {
  const card = Array.from(element.querySelectorAll('article')).find(article => article.querySelector('h2')?.textContent === title);
  if (!card) throw new Error(`Missing channel card ${title}`);
  return card as HTMLElement;
}

function buttonFor(element: ParentNode, text: string): HTMLButtonElement {
  const button = Array.from(element.querySelectorAll('button')).find(candidate => candidate.textContent?.includes(text));
  if (!button) throw new Error(`Missing button ${text}`);
  return button as HTMLButtonElement;
}

async function settle() {
  await act(async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); });
}

beforeEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  mocks.rpc.mockReset();
  mocks.invoke.mockReset();
  mocks.access = {
    status: 'active', is_owner: true, is_founder: false, role: 'owner',
    permissions: ['automation.check', 'automation.manage'],
  };
  window.confirm = vi.fn(() => true);
});

afterEach(() => {
  if (root) act(() => root.unmount());
  vi.unstubAllGlobals();
});

describe('Daily Distribution Kit page', () => {
  it('checks, edits, saves, approves and sends exactly one fresh owner-approved Telegram copy', async () => {
    const state = emptySnapshot();
    const copy = () => structuredClone(state);
    mocks.rpc.mockImplementation(async (name: string, args?: Record<string, unknown>) => {
      if (name === 'automation_distribution_articles') return { data: { articles: [{
        id: POST_ID, title: 'Owner title', slug: SLUG, status: 'published', scheduled_at_utc: null,
      }] }, error: null };
      if (name === 'automation_distribution_snapshot') return { data: copy(), error: null };
      if (name === 'automation_prepare_daily_kit') {
        state.channels = state.channels.map(channel => ({
          ...channel,
          draft: {
            id: DRAFT_ID,
            payload: payloadFor(channel.channel_key as DistributionChannelKey),
            payload_sha256: HASH_A, review_status: 'pending', approved_at: null, delivery: null, test_delivery: null,
          },
        }));
        return { data: copy(), error: null };
      }
      if (name === 'automation_save_distribution_draft') {
        expect(args?.p_draft_id).toBe(DRAFT_ID);
        const telegramDraft = getDraft(getChannel(state, 'telegram'));
        telegramDraft.payload = args?.p_payload as DraftFixture['payload'];
        telegramDraft.payload_sha256 = HASH_B;
        telegramDraft.review_status = 'pending';
        telegramDraft.approved_at = null;
        return { data: { draft_id: DRAFT_ID, payload_sha256: HASH_B, review_status: 'pending' }, error: null };
      }
      if (name === 'automation_approve_distribution_draft') {
        expect(args).toEqual({ p_draft_id: DRAFT_ID, p_expected_sha256: HASH_B });
        const telegramDraft = getDraft(getChannel(state, 'telegram'));
        telegramDraft.review_status = 'approved';
        telegramDraft.approved_at = new Date().toISOString();
        return { data: { review_status: 'approved', side_effects: 0 }, error: null };
      }
      if (name === 'automation_set_feature_flag') {
        const flag = String(args?.p_flag_key) as keyof typeof state.flags;
        state.flags[flag] = args?.p_enabled === true;
        return { data: true, error: null };
      }
      if (name === 'automation_set_distribution_pause') {
        const telegram = state.channels.find(channel => channel.channel_key === args?.p_channel_key);
        if (!telegram) throw new Error('Missing pause channel');
        telegram.state = args?.p_paused ? 'paused' : 'approval_required';
        return { data: true, error: null };
      }
      if (name === 'automation_reject_distribution_draft') return { data: true, error: null };
      return { data: null, error: { code: 'PGRST202' } };
    });
    mocks.invoke.mockImplementation(async (_name: string, options: { body: Record<string, unknown> }) => {
      if (options.body.action === 'check') {
        const telegram = getChannel(state, 'telegram');
        telegram.state = 'approval_required';
        telegram.last_readback_status = 'connected';
        telegram.last_readback_at = new Date().toISOString();
        return { data: { ok: true, state: 'connected', message: 'Read-only provider readback passed. Per-item approval is still required.' }, error: null };
      }
      if (options.body.action === 'send_telegram') {
        expect(options.body).toEqual({ action: 'send_telegram', channel: 'telegram', draft_id: DRAFT_ID, payload_sha256: HASH_B });
        const telegramDraft = getDraft(getChannel(state, 'telegram'));
        telegramDraft.review_status = 'sent';
        telegramDraft.delivery = {
          status: 'sent', remote_post_id: '42', remote_url: null, usage_count: 1,
          safe_error_code: null, created_at: new Date().toISOString(),
        };
        return { data: { ok: true, sent: true, remotePostId: '42' }, error: null };
      }
      return { data: null, error: new Error('unexpected Edge action') };
    });

    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root.render(<AutomationDistribution />); await Promise.resolve(); });
    await settle();
    expect(host.textContent).toContain('Daily Distribution Kit');
    expect(host.textContent).toContain('This tool never reads or changes posts.content');
    expect(host.querySelectorAll('article')).toHaveLength(13);

    const telegram = cardFor(host, 'telegram');
    await act(async () => { buttonFor(telegram, 'Read-only check').click(); await Promise.resolve(); });
    await settle();
    expect(mocks.invoke).toHaveBeenCalledWith('automation-distribution', { body: { action: 'check', channel: 'telegram' } });
    expect(host.textContent).toContain('Read-only provider readback passed');

    await act(async () => { buttonFor(host, 'Prepare 13-channel kit').click(); await Promise.resolve(); });
    await settle();
    const telegramAfterPrepare = cardFor(host, 'telegram');
    const caption = telegramAfterPrepare.querySelector<HTMLTextAreaElement>('#dist-caption-telegram')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    await act(async () => {
      setter?.call(caption, 'Edited owner-approved distribution copy.');
      caption.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await settle();
    expect(buttonFor(telegramAfterPrepare, 'Approve this copy').disabled).toBe(true);
    expect(telegramAfterPrepare.textContent).toContain('Save the edited copy before approving');

    await act(async () => { buttonFor(telegramAfterPrepare, 'Save copy').click(); await Promise.resolve(); });
    await settle();
    expect(mocks.rpc).toHaveBeenCalledWith('automation_save_distribution_draft', expect.objectContaining({
      p_draft_id: DRAFT_ID,
      p_payload: expect.objectContaining({ caption: 'Edited owner-approved distribution copy.' }),
    }));
    const savedTelegram = cardFor(host, 'telegram');
    await act(async () => { buttonFor(savedTelegram, 'Approve this copy').click(); await Promise.resolve(); });
    await settle();
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('Approve this exact telegram distribution copy'));

    const distributionSwitch = host.querySelector<HTMLButtonElement>('[aria-label^="External distribution dispatch"]')!;
    await act(async () => { distributionSwitch.click(); await Promise.resolve(); });
    await settle();
    const readyTelegram = cardFor(host, 'telegram');
    const sendButton = buttonFor(readyTelegram, 'Send approved message');
    expect(sendButton.disabled).toBe(false);
    await act(async () => { sendButton.click(); await Promise.resolve(); });
    await settle();
    expect(mocks.invoke).toHaveBeenCalledWith('automation-distribution', {
      body: { action: 'send_telegram', channel: 'telegram', draft_id: DRAFT_ID, payload_sha256: HASH_B },
    });
    expect(host.textContent).toContain('Telegram accepted the message. Receipt ID 42.');
    expect(host.textContent).toContain('Provider receipt confirmed');
  });

  it('keeps a paused channel usable as an owner-approved manual kit without invoking a provider', async () => {
    const state = emptySnapshot();
    const telegram = getChannel(state, 'telegram');
    telegram.state = 'paused';
    telegram.state_reason = 'Paused by the owner. The manual kit remains available.';
    telegram.draft = {
      id: DRAFT_ID, payload: payloadFor('telegram'), payload_sha256: HASH_A,
      review_status: 'approved', approved_at: '2026-10-06T12:00:00.000Z', delivery: null, test_delivery: null,
    };
    const copy = () => structuredClone(state);
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === 'automation_distribution_articles') return { data: { articles: [{
        id: POST_ID, title: 'Owner title', slug: SLUG, status: 'published', scheduled_at_utc: null,
      }] }, error: null };
      if (name === 'automation_distribution_snapshot') return { data: copy(), error: null };
      return { data: null, error: { code: 'PGRST202' } };
    });
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', new Proxy(navigator, {
      get(target, property) {
        if (property === 'clipboard') return { writeText };
        return Reflect.get(target, property, target);
      },
    }));

    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root.render(<AutomationDistribution />); await Promise.resolve(); });
    await settle();

    const card = cardFor(host, 'telegram');
    expect(card.textContent).toContain('Paused');
    expect(card.textContent).toContain('The manual kit remains available.');
    expect(buttonFor(card, 'Copy caption').disabled).toBe(false);
    expect(buttonFor(card, 'Copy UTM link').disabled).toBe(false);
    expect(buttonFor(card, 'Send approved message').disabled).toBe(true);
    const shareLink = card.querySelector<HTMLAnchorElement>('a[href^="https://t.me/share/url?"]');
    expect(shareLink?.href).toContain(encodeURIComponent(payloadFor('telegram').link));

    await act(async () => { buttonFor(card, 'Copy caption').click(); await Promise.resolve(); });
    await settle();
    expect(writeText).toHaveBeenCalledWith(payloadFor('telegram').caption);
    expect(host.textContent).toContain('Caption copied for telegram.');
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('shows tomorrow\u2019s kit state and explains when nothing is scheduled for that Lagos day', async () => {
    const state = emptySnapshot();
    mocks.rpc.mockImplementation(async (name: string, args?: Record<string, unknown>) => {
      if (name === 'automation_distribution_articles') return { data: { articles: [
        { id: POST_ID, title: 'Owner title', slug: SLUG, status: 'published', scheduled_at_utc: null },
      ] }, error: null };
      if (name === 'automation_distribution_snapshot') return { data: state, error: null };
      if (name === 'automation_daily_kit_state') {
        expect(args?.p_lagos_day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        return { data: { post_id: POST_ID, lagos_day: args?.p_lagos_day, is_today: args?.p_lagos_day === undefined, video_url: null, marks: [] }, error: null };
      }
      return { data: null, error: null };
    });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root.render(<AutomationDistribution />); });
    await settle();

    const daySelect = host.querySelector('#kit-day') as HTMLSelectElement;
    const slotSelect = host.querySelector('#kit-slot') as HTMLSelectElement;
    expect(daySelect).not.toBeNull();
    expect(slotSelect).not.toBeNull();
    expect(Array.from(slotSelect.options).map(option => option.value)).toEqual(['morning', 'midday', 'evening']);
    // The published fixture has no schedule date, so it belongs to today's kit only.
    expect(host.textContent).toContain('Owner title');

    await act(async () => {
      daySelect.value = 'tomorrow';
      daySelect.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await settle();
    expect(host.textContent).toContain('Nothing is scheduled for tomorrow in Lagos yet');
  });

  it('offers the video download and marks a channel as posted in the chosen slot', async () => {
    const state = emptySnapshot();
    for (const channel of state.channels) {
      channel.draft = {
        id: DRAFT_ID, payload: payloadFor(channel.channel_key as DistributionChannelKey),
        payload_sha256: HASH_A, review_status: 'approved', approved_at: '2026-10-06T08:00:00.000Z',
        delivery: null, test_delivery: null,
      };
    }
    const marked: Record<string, unknown>[] = [];
    mocks.rpc.mockImplementation(async (name: string, args?: Record<string, unknown>) => {
      if (name === 'automation_distribution_articles') return { data: { articles: [
        { id: POST_ID, title: 'Owner title', slug: SLUG, status: 'published', scheduled_at_utc: null },
      ] }, error: null };
      if (name === 'automation_distribution_snapshot') return { data: structuredClone(state), error: null };
      if (name === 'automation_daily_kit_state') return { data: {
        post_id: POST_ID, lagos_day: args?.p_lagos_day, is_today: true,
        video_url: 'https://cdn.lixxonstudio.com/kit/clip-vertical.mp4',
        marks: marked,
      }, error: null };
      if (name === 'automation_mark_channel_posted') {
        expect(args?.p_draft_id).toBe(DRAFT_ID);
        expect(args?.p_slot).toBe('evening');
        marked.push({ channel_key: 'instagram', slot: 'evening', note: null, marked_at: '2026-10-06T18:04:00.000Z', lagos_day: args?.p_lagos_day, kind: 'manual' });
        return { data: { ok: true, duplicate: false, channel_key: 'instagram', slot: 'evening' }, error: null };
      }
      if (name === 'automation_attach_article_video') return { data: { ok: true }, error: null };
      return { data: null, error: null };
    });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root.render(<AutomationDistribution />); });
    await settle();

    const slotSelect = host.querySelector('#kit-slot') as HTMLSelectElement;
    await act(async () => {
      slotSelect.value = 'evening';
      slotSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await settle();

    const instagram = cardFor(host, 'instagram');
    expect(instagram.textContent).toContain('Copy the caption');
    expect(instagram.textContent).toContain('Mark this channel as posted to record the day and slot');
    expect(instagram.textContent?.toLowerCase()).toContain('open instagram app');
    expect(buttonFor(instagram, 'Download video')).toBeTruthy();

    const widget = cardFor(host, 'site_widget');
    expect(widget.textContent).not.toContain('Download video');
    expect(Array.from(widget.querySelectorAll('a')).some(link => (link.textContent || '').includes('app'))).toBe(false);

    await act(async () => { buttonFor(instagram, 'Mark posted').click(); });
    await settle();
    expect(mocks.rpc).toHaveBeenCalledWith('automation_mark_channel_posted', expect.objectContaining({ p_draft_id: DRAFT_ID, p_slot: 'evening' }));
    expect(host.textContent).toContain('recorded as posted by you in the Evening slot');
    expect(cardFor(host, 'instagram').textContent).toContain('Posted by you: Evening');
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('disables Mark posted until the exact copy is approved and never for a reviewer', async () => {
    const state = emptySnapshot();
    state.channels = state.channels.map(channel => ({
      ...channel,
      draft: { id: DRAFT_ID, payload: payloadFor(channel.channel_key as DistributionChannelKey), payload_sha256: HASH_A, review_status: 'pending', approved_at: null, delivery: null, test_delivery: null },
    }));
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === 'automation_distribution_articles') return { data: { articles: [
        { id: POST_ID, title: 'Owner title', slug: SLUG, status: 'published', scheduled_at_utc: null },
      ] }, error: null };
      if (name === 'automation_distribution_snapshot') return { data: structuredClone(state), error: null };
      if (name === 'automation_daily_kit_state') return { data: { post_id: POST_ID, lagos_day: '2026-10-06', is_today: true, video_url: null, marks: [] }, error: null };
      return { data: null, error: null };
    });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root.render(<AutomationDistribution />); });
    await settle();
    expect(buttonFor(cardFor(host, 'instagram'), 'Mark posted').disabled).toBe(true);

    act(() => root.unmount());
    document.body.innerHTML = '';
    mocks.access = { status: 'active', is_owner: false, is_founder: false, role: 'editor', permissions: ['automation.check'] };
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root.render(<AutomationDistribution />); });
    await settle();
    expect(Array.from(cardFor(host, 'instagram').querySelectorAll('button')).some(button => (button.textContent || '').includes('Mark posted'))).toBe(false);
  });

  it('prepares and demonstrates copy/share controls for all 13 owner-approved manual channels', async () => {
    const state = emptySnapshot();
    const copy = () => structuredClone(state);
    mocks.rpc.mockImplementation(async (name: string, args?: Record<string, unknown>) => {
      if (name === 'automation_distribution_articles') return { data: { articles: [{
        id: POST_ID, title: 'Owner title', slug: SLUG, status: 'published', scheduled_at_utc: null,
      }] }, error: null };
      if (name === 'automation_distribution_snapshot') return { data: copy(), error: null };
      if (name === 'automation_prepare_daily_kit') {
        state.channels = state.channels.map((channel, index) => ({
          ...channel,
          state: 'manual_kit',
          draft: {
            id: `85000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
            payload: payloadFor(channel.channel_key), payload_sha256: HASH_A,
            review_status: 'pending', approved_at: null, delivery: null, test_delivery: null,
          },
        }));
        return { data: copy(), error: null };
      }
      if (name === 'automation_approve_distribution_draft') {
        const draftId = String(args?.p_draft_id);
        const channel = state.channels.find(row => row.draft?.id === draftId);
        if (!channel?.draft) throw new Error('Missing manual-kit approval draft');
        channel.draft.review_status = 'approved';
        channel.draft.approved_at = '2026-10-06T12:00:00.000Z';
        return { data: { review_status: 'approved', side_effects: 0 }, error: null };
      }
      return { data: null, error: { code: 'PGRST202' } };
    });
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', new Proxy(navigator, {
      get(target, property) {
        if (property === 'clipboard') return { writeText };
        return Reflect.get(target, property, target);
      },
    }));

    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root.render(<AutomationDistribution />); await Promise.resolve(); });
    await settle();
    await act(async () => { buttonFor(host, 'Prepare 13-channel kit').click(); await Promise.resolve(); });
    await settle();
    expect(host.querySelectorAll('article')).toHaveLength(13);

    for (const channelKey of DISTRIBUTION_CHANNEL_KEYS) {
      const label = channelKey === 'youtube_shorts' ? 'YouTube Shorts' : channelKey;
      let card = cardFor(host, label);
      await act(async () => { buttonFor(card, 'Approve this copy').click(); await Promise.resolve(); });
      await settle();
      card = cardFor(host, label);
      expect(buttonFor(card, 'Copy caption').disabled).toBe(false);
      expect(buttonFor(card, 'Copy UTM link').disabled).toBe(false);
      const platformLink = card.querySelector<HTMLAnchorElement>('a');
      expect(platformLink?.getAttribute('href')).toBeTruthy();
      if (channelKey === 'telegram') expect(buttonFor(card, 'Send approved message').disabled).toBe(true);
      await act(async () => { buttonFor(card, 'Copy caption').click(); await Promise.resolve(); });
      await settle();
      expect(writeText).toHaveBeenLastCalledWith(payloadFor(channelKey).caption);
    }

    expect(window.confirm).toHaveBeenCalledTimes(13);
    expect(writeText).toHaveBeenCalledTimes(13);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('previews approved newsletter copy and confirms a test only to the signed-in owner', async () => {
    const state = emptySnapshot();
    const newsletter = getChannel(state, 'newsletter');
    newsletter.state = 'approval_required';
    newsletter.last_readback_status = 'connected';
    newsletter.last_readback_at = new Date().toISOString();
    newsletter.draft = {
      id: DRAFT_ID, payload: payloadFor('newsletter'), payload_sha256: HASH_A,
      review_status: 'approved', approved_at: new Date().toISOString(), delivery: null, test_delivery: null,
    };
    const copy = () => structuredClone(state);
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === 'automation_distribution_articles') return { data: { articles: [{
        id: POST_ID, title: 'Owner title', slug: SLUG, status: 'published', scheduled_at_utc: null,
      }] }, error: null };
      if (name === 'automation_distribution_snapshot') return { data: copy(), error: null };
      return { data: null, error: { code: 'PGRST202' } };
    });
    mocks.invoke.mockImplementation(async (_name: string, options: { body: Record<string, unknown> }) => {
      expect(options.body).toEqual({ action: 'test_newsletter', channel: 'newsletter', draft_id: DRAFT_ID, payload_sha256: HASH_A });
      newsletter.draft!.test_delivery = {
        status: 'sent', remote_email_id: 'resend-test-42', safe_error_code: null, created_at: new Date().toISOString(),
      };
      return { data: { ok: true, sent: true, testEmailId: 'resend-test-42' }, error: null };
    });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root.render(<AutomationDistribution />); await Promise.resolve(); });
    await settle();
    const card = cardFor(host, 'newsletter');
    expect(card.textContent).toContain('Preview email and owner-only test');
    expect(card.textContent).toContain('It does not contact subscribers');
    const send = buttonFor(card, 'Send one confirmed test to me');
    expect(send.disabled).toBe(false);
    await act(async () => { send.click(); await Promise.resolve(); });
    await settle();
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('No subscribers will be contacted'));
    expect(host.textContent).toContain('One test email was accepted to your signed-in owner address. No subscribers were contacted. Receipt ID resend-test-42.');
    expect(host.textContent).toContain('Owner-only test receipt confirmed');
  });

  it('keeps provider and mutation actions hidden from a non-owner with read permission', async () => {
    mocks.access = { status: 'active', is_owner: false, is_founder: false, role: 'analyst', permissions: ['automation.check'] };
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === 'automation_distribution_articles') return { data: { articles: [{
        id: POST_ID, title: 'Owner title', slug: SLUG, status: 'published', scheduled_at_utc: null,
      }] }, error: null };
      if (name === 'automation_distribution_snapshot') return { data: emptySnapshot(), error: null };
      return { data: null, error: null };
    });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root.render(<AutomationDistribution />); await Promise.resolve(); });
    await settle();
    expect(host.textContent).toContain('Only an active owner or founder can generate, edit, approve or pause distribution drafts.');
    expect(Array.from(host.querySelectorAll('button')).some(button => button.textContent?.includes('Read-only check'))).toBe(false);
    const prepareButton = Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('Prepare 13-channel kit'));
    expect(prepareButton?.disabled).toBe(true);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});
