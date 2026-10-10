export const DISTRIBUTION_CHANNEL_KEYS = [
  'instagram', 'facebook', 'youtube_shorts', 'tiktok', 'pinterest', 'telegram',
  'threads', 'linkedin', 'x', 'tumblr', 'whatsapp', 'newsletter', 'site_widget',
] as const;
export type DistributionChannelKey = (typeof DISTRIBUTION_CHANNEL_KEYS)[number];

export const DISTRIBUTION_STATES = [
  'connected', 'approval_required', 'manual_kit', 'paused',
  'blocked_by_provider_review', 'quota_exhausted', 'not_configured',
] as const;
export type DistributionState = (typeof DISTRIBUTION_STATES)[number];
export type DistributionReviewStatus = 'pending' | 'approved' | 'rejected' | 'sent' | 'paused';

const DISTRIBUTION_METRIC_KEYS = new Set([
  'reach', 'impressions', 'clicks', 'conversions', 'engagements', 'saves', 'replies',
  'unsubscribes', 'negative_feedback', 'click_through_rate', 'engagement_rate',
  'conversion_rate', 'save_rate', 'reply_rate', 'unsubscribe_rate', 'negative_feedback_rate',
]);
const DISTRIBUTION_FAILURE_CLASSES = ['quota', 'authentication', 'policy', 'transient'] as const;

export interface DistributionPayload {
  title: string;
  subject: string;
  caption: string;
  hashtags: string[];
  cta: string;
  link: string;
  imageUrl: string | null;
  imageAlt: string;
}

export interface DistributionDelivery {
  status: 'pending_approval' | 'approved' | 'dispatching' | 'sent' | 'manual_kit' | 'failed' | 'blocked' | 'quota_exhausted' | 'rejected';
  remotePostId: string | null;
  remoteUrl: string | null;
  usageCount: number;
  safeErrorCode: string | null;
  createdAt: string;
}

export interface DistributionTestDelivery {
  status: 'dispatching' | 'sent' | 'failed' | 'blocked' | 'quota_exhausted';
  remoteEmailId: string | null;
  safeErrorCode: string | null;
  createdAt: string;
}

export interface DistributionDraft {
  id: string;
  payload: DistributionPayload;
  payloadSha256: string;
  reviewStatus: DistributionReviewStatus;
  approvedAt: string | null;
  delivery: DistributionDelivery | null;
  testDelivery: DistributionTestDelivery | null;
}

export interface DistributionArticleOption {
  id: string;
  title: string;
  slug: string;
  status: 'scheduled' | 'published';
  scheduledAtUtc: string | null;
}

export interface DistributionUsageToday {
  usageDay: string;
  readbackAttempts: number;
  deliveryAttempts: number;
  deliverySuccesses: number;
  deliveryFailures: number;
  ownerTestEmailAttempts: number;
}

export interface DistributionMetricSample {
  channelKey: DistributionChannelKey;
  metricKey: string;
  value: number;
  measurementKind: 'measured' | 'estimated';
  collectionBasis: 'provider_aggregate' | 'consented_site_aggregate' | 'estimate';
  periodStart: string;
  periodEnd: string;
  sampleCount: number;
  variantId: string | null;
}

export interface DistributionChannel {
  key: DistributionChannelKey;
  label: string;
  state: DistributionState;
  stateReason: string;
  approvalRequired: true;
  autoPublishEnabled: false;
  dailyFreeQuota: number | null;
  quotaRemaining: number | null;
  lastReadbackStatus: string;
  lastReadbackAt: string | null;
  circuitState: 'closed' | 'open' | 'half_open';
  failureStreak: number;
  lastFailureClass: 'quota' | 'authentication' | 'policy' | 'transient' | null;
  retryAfter: string | null;
  usageToday: DistributionUsageToday;
  draft: DistributionDraft | null;
}

export interface DistributionSnapshot {
  postId: string;
  title: string;
  slug: string;
  status: 'scheduled' | 'published';
  scheduledAtUtc: string | null;
  excerpt: string;
  coverImage: string | null;
  coverImageAlt: string;
  flags: { 'automation.enabled': boolean; 'automation.distribution': boolean };
  channels: DistributionChannel[];
  metrics: DistributionMetricSample[];
}

export const DISTRIBUTION_CHANNELS: Record<DistributionChannelKey, {
  label: string;
  url: string;
  instructions: string;
  maxCaption: number;
  mode: 'share' | 'manual' | 'internal';
}> = {
  instagram: {
    label: 'Instagram', url: 'https://www.instagram.com/',
    instructions: 'Open Instagram, choose the approved image, paste the caption and hashtags, then verify the post in your account.',
    maxCaption: 2200, mode: 'manual',
  },
  facebook: {
    label: 'Facebook Pages', url: 'https://www.facebook.com/',
    instructions: 'Review the share preview, choose the intended Page and audience, and confirm the post in Facebook.',
    maxCaption: 63206, mode: 'share',
  },
  youtube_shorts: {
    label: 'YouTube Shorts', url: 'https://studio.youtube.com/',
    instructions: 'Upload only an owner-approved vertical video in YouTube Studio. Video rendering is a separate gated phase; this text kit does not upload media.',
    maxCaption: 5000, mode: 'manual',
  },
  tiktok: {
    label: 'TikTok', url: 'https://www.tiktok.com/upload',
    instructions: 'Open TikTok upload, attach the owner-approved media, review the caption and audience, then publish manually.',
    maxCaption: 2200, mode: 'manual',
  },
  pinterest: {
    label: 'Pinterest', url: 'https://www.pinterest.com/pin/create/button/',
    instructions: 'Choose the correct board and cover image, review the description and destination link, then save the Pin.',
    maxCaption: 800, mode: 'share',
  },
  telegram: {
    label: 'Telegram', url: 'https://t.me/share/url',
    instructions: 'The manual share link lets you choose the recipient in Telegram. Direct delivery, when freshly verified and both owner switches are on, sends one approved message only after a separate confirmation.',
    maxCaption: 4096, mode: 'share',
  },
  threads: {
    label: 'Threads', url: 'https://www.threads.net/',
    instructions: 'Open Threads, review the copy and link, and publish manually. Account/app review and posting scopes are not assumed.',
    maxCaption: 500, mode: 'manual',
  },
  linkedin: {
    label: 'LinkedIn', url: 'https://www.linkedin.com/feed/',
    instructions: 'Choose the intended personal profile or organization, review the link preview and copy, then publish manually.',
    maxCaption: 3000, mode: 'share',
  },
  x: {
    label: 'X', url: 'https://x.com/compose/post',
    instructions: 'Review the final character count and link preview in X. API posting is deliberately disabled until its no-cost eligibility is verified.',
    maxCaption: 280, mode: 'share',
  },
  tumblr: {
    label: 'Tumblr', url: 'https://www.tumblr.com/new/text',
    instructions: 'Choose the correct blog, review the formatted text and destination link, then publish manually.',
    maxCaption: 5000, mode: 'share',
  },
  whatsapp: {
    label: 'WhatsApp share / Business', url: 'https://wa.me/',
    instructions: 'Share only with a recipient who has opted in. The manual link opens a user-selected chat; it does not broadcast or message contacts automatically.',
    maxCaption: 4000, mode: 'share',
  },
  newsletter: {
    label: 'Email newsletter', url: '/admin/newsletter',
    instructions: 'Preview and confirm one test to the signed-in owner address here. The subscriber admin is management-only; distribution to subscribers stays paused until its consent, verified sender and quota gate is explicitly wired.',
    maxCaption: 10000, mode: 'internal',
  },
  site_widget: {
    label: 'Lixxon Studio content widget', url: 'https://lixxonstudio.com/',
    instructions: 'Copy the approved article link and headline for the existing on-site content widget. The kit does not insert code or change the published article.',
    maxCaption: 1000, mode: 'internal',
  },
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH_RE = /^[a-f0-9]{64}$/;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function safeHttps(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}

function parsePayload(value: unknown): DistributionPayload | null {
  if (!isRecord(value) || typeof value.title !== 'string' || value.title.length < 1 || value.title.length > 200
      || typeof value.subject !== 'string' || value.subject.length < 1 || value.subject.length > 180
      || typeof value.caption !== 'string' || value.caption.length < 1 || value.caption.length > 3000
      || !Array.isArray(value.hashtags) || value.hashtags.length > 12
      || value.hashtags.some(tag => typeof tag !== 'string' || tag.length > 52 || !/^#[A-Za-z0-9_]{1,50}$/.test(tag))
      || typeof value.cta !== 'string' || value.cta.length > 200
      || !safeHttps(value.link) || !/^https:\/\/lixxonstudio\.com\/blog\/[a-z0-9]+(?:-[a-z0-9]+)*\?utm_source=[a-z0-9_]+&utm_medium=(organic_social|email|onsite)&utm_campaign=[a-z0-9-]+$/.test(value.link)
      || (value.image_url !== null && !safeHttps(value.image_url))
      || typeof value.image_alt !== 'string' || value.image_alt.length > 500) return null;
  return {
    title: value.title,
    subject: value.subject,
    caption: value.caption,
    hashtags: value.hashtags as string[],
    cta: value.cta,
    link: value.link,
    imageUrl: value.image_url,
    imageAlt: value.image_alt,
  };
}

function parseDelivery(value: unknown): DistributionDelivery | null {
  if (value === null) return null;
  if (!isRecord(value)
      || !['pending_approval', 'approved', 'dispatching', 'sent', 'manual_kit', 'failed', 'blocked', 'quota_exhausted', 'rejected'].includes(String(value.status))
      || !(value.remote_post_id === null || (typeof value.remote_post_id === 'string' && /^[A-Za-z0-9._:-]{1,160}$/.test(value.remote_post_id)))
      || !(value.remote_url === null || safeHttps(value.remote_url))
      || !Number.isInteger(value.usage_count) || (value.usage_count as number) < 0 || (value.usage_count as number) > 1000
      || !(value.safe_error_code === null || (typeof value.safe_error_code === 'string' && /^[A-Z0-9_.:-]{1,64}$/.test(value.safe_error_code)))
      || typeof value.created_at !== 'string' || !Number.isFinite(Date.parse(value.created_at))) return null;
  return {
    status: value.status as DistributionDelivery['status'],
    remotePostId: value.remote_post_id,
    remoteUrl: value.remote_url,
    usageCount: value.usage_count as number,
    safeErrorCode: value.safe_error_code,
    createdAt: value.created_at,
  };
}

function parseTestDelivery(value: unknown): DistributionTestDelivery | null {
  if (value === null) return null;
  if (!isRecord(value)
      || !['dispatching', 'sent', 'failed', 'blocked', 'quota_exhausted'].includes(String(value.status))
      || !(value.remote_email_id === null || (typeof value.remote_email_id === 'string' && /^[A-Za-z0-9._:-]{1,160}$/.test(value.remote_email_id)))
      || !(value.safe_error_code === null || (typeof value.safe_error_code === 'string' && /^[A-Z0-9_.:-]{1,64}$/.test(value.safe_error_code)))
      || typeof value.created_at !== 'string' || !Number.isFinite(Date.parse(value.created_at))) return null;
  return {
    status: value.status as DistributionTestDelivery['status'],
    remoteEmailId: value.remote_email_id,
    safeErrorCode: value.safe_error_code,
    createdAt: value.created_at,
  };
}

function parseDraft(value: unknown): DistributionDraft | null {
  if (value === null) return null;
  if (!isRecord(value) || !UUID_RE.test(String(value.id)) || !HASH_RE.test(String(value.payload_sha256))
      || !['pending', 'approved', 'rejected', 'sent', 'paused'].includes(String(value.review_status))
      || !(value.approved_at === null || (typeof value.approved_at === 'string' && Number.isFinite(Date.parse(value.approved_at))))) return null;
  const payload = parsePayload(value.payload);
  const delivery = parseDelivery(value.delivery);
  const testDelivery = parseTestDelivery(value.test_delivery ?? null);
  if (!payload || (value.delivery !== null && delivery === null)
      || (value.test_delivery != null && testDelivery === null)) return null;
  return {
    id: value.id as string,
    payload,
    payloadSha256: value.payload_sha256 as string,
    reviewStatus: value.review_status as DistributionReviewStatus,
    approvedAt: value.approved_at,
    delivery,
    testDelivery,
  };
}

export function parseDistributionArticles(value: unknown): DistributionArticleOption[] | null {
  if (!isRecord(value) || !Array.isArray(value.articles) || value.articles.length > 50) return null;
  const articles: DistributionArticleOption[] = [];
  for (const row of value.articles) {
    if (!isRecord(row) || !UUID_RE.test(String(row.id)) || typeof row.title !== 'string' || row.title.length > 200
        || typeof row.slug !== 'string' || !SLUG_RE.test(row.slug)
        || (row.status !== 'scheduled' && row.status !== 'published')
        || !(row.scheduled_at_utc === null || (typeof row.scheduled_at_utc === 'string' && Number.isFinite(Date.parse(row.scheduled_at_utc))))) return null;
    articles.push({ id: row.id as string, title: row.title, slug: row.slug, status: row.status, scheduledAtUtc: row.scheduled_at_utc });
  }
  return articles;
}

function parseUsageToday(value: unknown): DistributionUsageToday | null {
  if (!isRecord(value) || Object.keys(value).some(key => ![
    'usage_day', 'readback_attempts', 'delivery_attempts', 'delivery_successes',
    'delivery_failures', 'owner_test_email_attempts',
  ].includes(key)) || typeof value.usage_day !== 'string'
      || !/^\d{4}-\d{2}-\d{2}$/.test(value.usage_day)
      || !Number.isFinite(Date.parse(value.usage_day))) return null;
  const fields = ['readback_attempts', 'delivery_attempts', 'delivery_successes', 'delivery_failures', 'owner_test_email_attempts'] as const;
  if (fields.some(field => !Number.isInteger(value[field]) || (value[field] as number) < 0 || (value[field] as number) > 100000)) return null;
  if ((value.delivery_successes as number) + (value.delivery_failures as number) > (value.delivery_attempts as number)) return null;
  return {
    usageDay: value.usage_day,
    readbackAttempts: value.readback_attempts as number,
    deliveryAttempts: value.delivery_attempts as number,
    deliverySuccesses: value.delivery_successes as number,
    deliveryFailures: value.delivery_failures as number,
    ownerTestEmailAttempts: value.owner_test_email_attempts as number,
  };
}

function parseDistributionMetrics(value: unknown): DistributionMetricSample[] | null {
  if (!Array.isArray(value) || value.length > 300) return null;
  const metrics: DistributionMetricSample[] = [];
  for (const row of value) {
    if (!isRecord(row) || Object.keys(row).some(key => ![
      'channel_key', 'metric_key', 'value', 'measurement_kind', 'collection_basis',
      'period_start', 'period_end', 'sample_count', 'variant_id',
    ].includes(key)) || typeof row.channel_key !== 'string'
        || !(DISTRIBUTION_CHANNEL_KEYS as readonly string[]).includes(row.channel_key)
        || typeof row.metric_key !== 'string' || !DISTRIBUTION_METRIC_KEYS.has(row.metric_key)
        || typeof row.value !== 'number' || !Number.isFinite(row.value) || row.value < 0 || row.value > 1_000_000_000_000
        || (row.metric_key.endsWith('_rate') && row.value > 1)
        || !['measured', 'estimated'].includes(String(row.measurement_kind))
        || !['provider_aggregate', 'consented_site_aggregate', 'estimate'].includes(String(row.collection_basis))
        || (row.collection_basis === 'estimate') !== (row.measurement_kind === 'estimated')
        || typeof row.period_start !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.period_start)
        || typeof row.period_end !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.period_end)
        || !Number.isFinite(Date.parse(row.period_start)) || !Number.isFinite(Date.parse(row.period_end))
        || Date.parse(row.period_start) > Date.parse(row.period_end)
        || !Number.isInteger(row.sample_count) || (row.sample_count as number) < 1 || (row.sample_count as number) > 100000
        || !(row.variant_id === null || (typeof row.variant_id === 'string' && UUID_RE.test(row.variant_id)))) return null;
    metrics.push({
      channelKey: row.channel_key as DistributionChannelKey,
      metricKey: row.metric_key,
      value: row.value,
      measurementKind: row.measurement_kind as DistributionMetricSample['measurementKind'],
      collectionBasis: row.collection_basis as DistributionMetricSample['collectionBasis'],
      periodStart: row.period_start,
      periodEnd: row.period_end,
      sampleCount: row.sample_count as number,
      variantId: row.variant_id as string | null,
    });
  }
  return metrics;
}

export function parseDistributionSnapshot(value: unknown): DistributionSnapshot | null {
  if (!isRecord(value) || !UUID_RE.test(String(value.post_id))
      || typeof value.title !== 'string' || value.title.length > 200
      || typeof value.slug !== 'string' || !SLUG_RE.test(value.slug)
      || (value.status !== 'scheduled' && value.status !== 'published')
      || !(value.scheduled_at_utc === null || (typeof value.scheduled_at_utc === 'string' && Number.isFinite(Date.parse(value.scheduled_at_utc))))
      || typeof value.excerpt !== 'string' || value.excerpt.length > 1000
      || (value.cover_image !== null && !safeHttps(value.cover_image))
      || typeof value.cover_image_alt !== 'string' || value.cover_image_alt.length > 500
      || !isRecord(value.flags) || typeof value.flags['automation.enabled'] !== 'boolean'
      || typeof value.flags['automation.distribution'] !== 'boolean'
      || !Array.isArray(value.channels) || value.channels.length !== DISTRIBUTION_CHANNEL_KEYS.length
      || !Array.isArray(value.metrics)) return null;
  const metrics = parseDistributionMetrics(value.metrics);
  if (!metrics) return null;
  const channels: DistributionChannel[] = [];
  const seen = new Set<string>();
  for (const candidate of value.channels) {
    if (!isRecord(candidate) || typeof candidate.channel_key !== 'string'
        || !(DISTRIBUTION_CHANNEL_KEYS as readonly string[]).includes(candidate.channel_key)
        || seen.has(candidate.channel_key)
        || typeof candidate.label !== 'string' || candidate.label.length > 80
        || typeof candidate.state !== 'string' || !(DISTRIBUTION_STATES as readonly string[]).includes(candidate.state)
        || typeof candidate.state_reason !== 'string' || candidate.state_reason.length > 500
        || candidate.approval_required !== true || candidate.auto_publish_enabled !== false
        || !(candidate.daily_free_quota === null || (Number.isInteger(candidate.daily_free_quota) && (candidate.daily_free_quota as number) >= 0))
        || !(candidate.quota_remaining === null || (Number.isInteger(candidate.quota_remaining) && (candidate.quota_remaining as number) >= 0))
        || typeof candidate.last_readback_status !== 'string'
        || !(candidate.last_readback_at === null || (typeof candidate.last_readback_at === 'string' && Number.isFinite(Date.parse(candidate.last_readback_at))))
        || !['closed', 'open', 'half_open'].includes(String(candidate.circuit_state))
        || !Number.isInteger(candidate.failure_streak) || (candidate.failure_streak as number) < 0 || (candidate.failure_streak as number) > 1000
        || !(candidate.last_failure_class === null || (typeof candidate.last_failure_class === 'string' && (DISTRIBUTION_FAILURE_CLASSES as readonly string[]).includes(candidate.last_failure_class)))
        || !(candidate.retry_after === null || (typeof candidate.retry_after === 'string' && Number.isFinite(Date.parse(candidate.retry_after))))) return null;
    const usageToday = parseUsageToday(candidate.usage_today);
    if (!usageToday) return null;
    const draft = parseDraft(candidate.draft);
    if (candidate.draft !== null && draft === null) return null;
    channels.push({
      key: candidate.channel_key as DistributionChannelKey,
      label: candidate.label,
      state: candidate.state as DistributionState,
      stateReason: candidate.state_reason,
      approvalRequired: true,
      autoPublishEnabled: false,
      dailyFreeQuota: candidate.daily_free_quota as number | null,
      quotaRemaining: candidate.quota_remaining as number | null,
      lastReadbackStatus: candidate.last_readback_status,
      lastReadbackAt: candidate.last_readback_at as string | null,
      circuitState: candidate.circuit_state as DistributionChannel['circuitState'],
      failureStreak: candidate.failure_streak as number,
      lastFailureClass: candidate.last_failure_class as DistributionChannel['lastFailureClass'],
      retryAfter: candidate.retry_after as string | null,
      usageToday,
      draft,
    });
    seen.add(candidate.channel_key);
  }
  return {
    postId: value.post_id as string,
    title: value.title,
    slug: value.slug,
    status: value.status,
    scheduledAtUtc: value.scheduled_at_utc,
    excerpt: value.excerpt,
    coverImage: value.cover_image,
    coverImageAlt: value.cover_image_alt,
    flags: {
      'automation.enabled': value.flags['automation.enabled'],
      'automation.distribution': value.flags['automation.distribution'],
    },
    channels,
    metrics,
  };
}

export function distributionShareUrl(channel: DistributionChannelKey, payload: DistributionPayload): string {
  const encodedLink = encodeURIComponent(payload.link);
  const encodedCaption = encodeURIComponent(payload.caption);
  const encodedTitle = encodeURIComponent(payload.title);
  const encodedImage = encodeURIComponent(payload.imageUrl || '');
  switch (channel) {
    case 'facebook': return `https://www.facebook.com/sharer/sharer.php?u=${encodedLink}`;
    case 'pinterest': return `https://www.pinterest.com/pin/create/button/?url=${encodedLink}&media=${encodedImage}&description=${encodedCaption}`;
    case 'telegram': return `https://t.me/share/url?url=${encodedLink}&text=${encodedCaption}`;
    case 'linkedin': return `https://www.linkedin.com/sharing/share-offsite/?url=${encodedLink}`;
    case 'x': return `https://x.com/intent/post?text=${encodedCaption}`;
    case 'tumblr': return `https://www.tumblr.com/widgets/share/tool?canonicalUrl=${encodedLink}&caption=${encodedTitle}&tags=${encodeURIComponent(payload.hashtags.join(','))}`;
    case 'whatsapp': return `https://wa.me/?text=${encodeURIComponent(`${payload.caption}\n${payload.link}`)}`;
    case 'newsletter': return '/admin/newsletter';
    case 'site_widget': return payload.link;
    default: return DISTRIBUTION_CHANNELS[channel].url;
  }
}

export async function downloadDistributionImage(url: string, filename: string): Promise<boolean> {
  if (!safeHttps(url)) return false;
  try {
    const response = await fetch(url, { mode: 'cors', credentials: 'omit', cache: 'no-store', redirect: 'error' });
    if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) return false;
    const blob = await response.blob();
    if (blob.size === 0 || blob.size > 12_000_000) return false;
    const objectUrl = URL.createObjectURL(blob);
    try {
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = `${filename.replace(/[^a-z0-9-]/gi, '-').slice(0, 80) || 'lixxon-image'}.jpg`;
      link.rel = 'noopener';
      document.body.appendChild(link);
      link.click();
      link.remove();
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// V16 — Daily Kit completeness helpers: posting slots, the platforms' own app
// schemes, a deterministic numbered step list per channel, the video download and
// the read-back of the owner's own "posted by hand" records.
//
// Everything here is static text and pure parsing: no provider call, no credential,
// no tracking parameter. The deep links use each platform app's own public URL scheme,
// so a browser that has the app installed opens it and a browser without it does
// nothing at all — the kit never pretends a post happened.
// ---------------------------------------------------------------------------

export const KIT_SLOTS = [
  { key: 'morning', label: 'Morning', at: '08:00 studio clock' },
  { key: 'midday', label: 'Midday', at: '13:00 studio clock' },
  { key: 'evening', label: 'Evening', at: '18:00 studio clock' },
] as const;
export type KitSlot = (typeof KIT_SLOTS)[number]['key'];
export const KIT_SLOT_KEYS: readonly KitSlot[] = KIT_SLOTS.map(slot => slot.key);

const VIDEO_CHANNEL_KEYS = new Set<DistributionChannelKey>(['instagram', 'facebook', 'youtube_shorts', 'tiktok']);
export function channelNeedsVideo(channel: DistributionChannelKey): boolean {
  return VIDEO_CHANNEL_KEYS.has(channel);
}

/** Each platform app's own public scheme. `null` means the channel is worked on-site. */
export const DISTRIBUTION_DEEP_LINKS: Record<DistributionChannelKey, string | null> = {
  instagram: 'instagram://app',
  facebook: 'fb://feed',
  youtube_shorts: 'youtube://',
  tiktok: 'tiktok://',
  pinterest: 'pinterest://',
  telegram: 'tg://resolve',
  threads: 'barcelona://',
  linkedin: 'linkedin://feed/',
  x: 'twitter://timeline',
  tumblr: 'tumblr://x-callback-url/dashboard',
  whatsapp: 'whatsapp://send',
  newsletter: null,
  site_widget: null,
};

/**
 * Three to five numbered steps for one channel, in the order the work is really done.
 * The steps are derived from the channel's own mode and formats, so they cannot drift
 * from the kit's actual capabilities.
 */
export function distributionKitSteps(channel: DistributionChannelKey, hasVideo = false): string[] {
  const needsVideo = channelNeedsVideo(channel);
  const media = needsVideo
    ? (hasVideo ? 'Download the attached vertical video' : 'Attach the vertical video URL for this article')
    : 'Download the article image';
  switch (channel) {
    case 'newsletter':
      return [
        'Copy the email subject and the email body',
        'Open the subscriber admin and confirm the audience',
        'Send it yourself, then come back to this page',
        'Mark this channel as posted to record the day and slot',
      ];
    case 'site_widget':
      return [
        'Copy the safe widget snippet',
        'Open the article to check the placement',
        'Paste the snippet in the page builder',
        'Mark this channel as posted to record the day and slot',
      ];
    case 'telegram':
      return [
        'Copy the caption',
        'Open telegram app (or send the approved message directly)',
        'Paste and post in the private chat',
        'Mark this channel as posted to record the day and slot',
      ];
    case 'whatsapp':
      return [
        'Copy the caption and the UTM link',
        'Open whatsapp app',
        'Send only to people who opted in',
        'Mark this channel as posted to record the day and slot',
      ];
    default:
      return [
        'Copy the caption',
        media,
        `Open ${DISTRIBUTION_CHANNELS[channel].label}`,
        'Paste the caption, attach the media and post',
        'Mark this channel as posted to record the day and slot',
      ];
  }
}

/** Video download for the article's owner-attached asset. Never a provider call. */
export async function downloadDistributionVideo(url: string, filename: string): Promise<boolean> {
  if (!safeHttps(url)) return false;
  try {
    const response = await fetch(url, { mode: 'cors', credentials: 'omit', cache: 'no-store', redirect: 'error' });
    if (!response.ok || !response.headers.get('content-type')?.startsWith('video/')) return false;
    const blob = await response.blob();
    if (blob.size === 0 || blob.size > 120_000_000) return false;
    const objectUrl = URL.createObjectURL(blob);
    try {
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = `${filename.replace(/[^a-z0-9-]/gi, '-').slice(0, 80) || 'lixxon-video'}.mp4`;
      link.rel = 'noopener';
      document.body.appendChild(link);
      link.click();
      link.remove();
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
    return true;
  } catch {
    return false;
  }
}

export interface DailyKitMark {
  channelKey: DistributionChannelKey;
  slot: KitSlot;
  note: string | null;
  markedAt: string;
  lagosDay: string;
}
export interface DailyKitState {
  postId: string;
  lagosDay: string;
  isToday: boolean;
  videoUrl: string | null;
  marks: DailyKitMark[];
}

/** Strict parse of the read-only kit state so the page never renders unverified data. */
export function parseDailyKitState(value: unknown): DailyKitState | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (typeof row.post_id !== 'string' || !/^[0-9a-f-]{36}$/.test(row.post_id)) return null;
  if (typeof row.lagos_day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.lagos_day)) return null;
  if (typeof row.is_today !== 'boolean') return null;
  const videoUrl = row.video_url === null || row.video_url === undefined ? null : safeHttps(row.video_url) ? row.video_url : null;
  if (!Array.isArray(row.marks)) return null;
  const marks: DailyKitMark[] = [];
  for (const entry of row.marks) {
    if (!entry || typeof entry !== 'object') return null;
    const mark = entry as Record<string, unknown>;
    if (typeof mark.channel_key !== 'string' || !DISTRIBUTION_CHANNEL_KEYS.includes(mark.channel_key as DistributionChannelKey)) return null;
    if (typeof mark.slot !== 'string' || !KIT_SLOT_KEYS.includes(mark.slot as KitSlot)) return null;
    if (typeof mark.lagos_day !== 'string' || typeof mark.marked_at !== 'string') return null;
    if (mark.note !== null && mark.note !== undefined && typeof mark.note !== 'string') return null;
    marks.push({
      channelKey: mark.channel_key as DistributionChannelKey,
      slot: mark.slot as KitSlot,
      note: typeof mark.note === 'string' ? mark.note.slice(0, 400) : null,
      markedAt: mark.marked_at,
      lagosDay: mark.lagos_day,
    });
  }
  return { postId: row.post_id, lagosDay: row.lagos_day, isToday: row.is_today, videoUrl, marks };
}

// ---------------------------------------------------------------------------
// V22 — video templates: the look of a rendered vertical video is owner-editable data,
// stored in `video_templates` and handed to the renderer as one validated document.
// The panel edits the essentials and always saves the whole document, so a save can
// never drop a field the renderer needs.
// ---------------------------------------------------------------------------

export interface VideoTemplateMovement {
  zoom_step: number;
  zoom_max: number;
  pan_x: number;
  pan_y: number;
  pan_x_period: number;
  pan_y_period: number;
}
export interface VideoTemplateDocument {
  schema: 'lixxon.video-template.v1';
  name: string;
  duration_seconds: number;
  music: 'none';
  fps: 24 | 25 | 30;
  movement: VideoTemplateMovement;
  title: { font_size: number; line_spacing: number; color: string; box_height: number; seconds: number };
  caption: {
    font_size: number; line_spacing: number; color: string; box_top: number; box_height: number;
    max_characters_per_line: number; max_lines: number;
  };
  end_card: { font_size: number; line_spacing: number; color: string; text: string };
  watermark: { text: string; font_size: number };
}
export interface VideoTemplateSummary {
  id: string;
  name: string;
  isActive: boolean;
  durationSeconds: number;
  fps: number;
  music: 'none';
  createdAt: string | null;
}
export interface VideoTemplateList {
  activeId: string | null;
  templates: VideoTemplateSummary[];
  activeDocument: VideoTemplateDocument | null;
}

const COLOR_PATTERN = /^0x[0-9A-Fa-f]{6}$/;

function boundedInteger(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : null;
}
function boundedNumber(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : null;
}
function boundedColor(value: unknown): string | null {
  return typeof value === 'string' && COLOR_PATTERN.test(value) ? value : null;
}
function boundedText(value: unknown, maxLength: number, maxLines: number): string | null {
  if (typeof value !== 'string' || value.length < 1 || value.length > maxLength) return null;
  if (value.split('\n').length > maxLines) return null;
  return value;
}

/**
 * Parse a template document with the same bounds the database and the renderer enforce,
 * so the panel can never display — or save — a look the renderer would reject.
 */
export function parseVideoTemplateDocument(value: unknown): VideoTemplateDocument | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (row.schema !== 'lixxon.video-template.v1' || row.music !== 'none') return null;
  const name = typeof row.name === 'string' && row.name.trim().length >= 1 && row.name.length <= 80 ? row.name : null;
  const duration = boundedInteger(row.duration_seconds, 8, 60);
  const fps = boundedInteger(row.fps, 24, 30);
  const movement = (row.movement || {}) as Record<string, unknown>;
  const title = (row.title || {}) as Record<string, unknown>;
  const caption = (row.caption || {}) as Record<string, unknown>;
  const endCard = (row.end_card || {}) as Record<string, unknown>;
  const watermark = (row.watermark || {}) as Record<string, unknown>;

  const zoomStep = boundedNumber(movement.zoom_step, 0.0001, 0.002);
  const zoomMax = boundedNumber(movement.zoom_max, 1.02, 1.25);
  const panX = boundedNumber(movement.pan_x, 0, 0.4);
  const panY = boundedNumber(movement.pan_y, 0, 0.4);
  const panXPeriod = boundedInteger(movement.pan_x_period, 30, 300);
  const panYPeriod = boundedInteger(movement.pan_y_period, 30, 300);
  const titleFont = boundedInteger(title.font_size, 28, 96);
  const titleSpacing = boundedInteger(title.line_spacing, 0, 40);
  const titleColor = boundedColor(title.color);
  const titleBox = boundedInteger(title.box_height, 200, 900);
  const titleSeconds = boundedNumber(title.seconds, 1, 6);
  const captionFont = boundedInteger(caption.font_size, 24, 72);
  const captionSpacing = boundedInteger(caption.line_spacing, 0, 40);
  const captionColor = boundedColor(caption.color);
  const captionTop = boundedInteger(caption.box_top, 200, 1700);
  const captionBox = boundedInteger(caption.box_height, 200, 900);
  const captionWidth = boundedInteger(caption.max_characters_per_line, 16, 48);
  const captionLines = boundedInteger(caption.max_lines, 3, 10);
  const endFont = boundedInteger(endCard.font_size, 28, 96);
  const endSpacing = boundedInteger(endCard.line_spacing, 0, 48);
  const endColor = boundedColor(endCard.color);
  const endText = boundedText(endCard.text, 200, 4);
  const watermarkText = boundedText(watermark.text, 60, 1);
  const watermarkFont = boundedInteger(watermark.font_size, 16, 48);

  if (name === null || duration === null || fps === null || ![24, 25, 30].includes(fps)
      || zoomStep === null || zoomMax === null || panX === null || panY === null
      || panXPeriod === null || panYPeriod === null
      || titleFont === null || titleSpacing === null || titleColor === null || titleBox === null || titleSeconds === null
      || captionFont === null || captionSpacing === null || captionColor === null
      || captionTop === null || captionBox === null || captionWidth === null || captionLines === null
      || endFont === null || endSpacing === null || endColor === null || endText === null
      || watermarkText === null || watermarkFont === null
      || titleBox + 100 > 1920 || captionTop + captionBox > 1900) {
    return null;
  }
  return {
    schema: 'lixxon.video-template.v1',
    name,
    duration_seconds: duration,
    music: 'none',
    fps: fps as 24 | 25 | 30,
    movement: { zoom_step: zoomStep, zoom_max: zoomMax, pan_x: panX, pan_y: panY, pan_x_period: panXPeriod, pan_y_period: panYPeriod },
    title: { font_size: titleFont, line_spacing: titleSpacing, color: titleColor, box_height: titleBox, seconds: titleSeconds },
    caption: {
      font_size: captionFont, line_spacing: captionSpacing, color: captionColor,
      box_top: captionTop, box_height: captionBox,
      max_characters_per_line: captionWidth, max_lines: captionLines,
    },
    end_card: { font_size: endFont, line_spacing: endSpacing, color: endColor, text: endText },
    watermark: { text: watermarkText, font_size: watermarkFont },
  };
}

/** Parse the template list RPC; anything unrecognised is refused rather than rendered. */
export function parseVideoTemplates(value: unknown): VideoTemplateList | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (!Array.isArray(row.templates)) return null;
  const templates: VideoTemplateSummary[] = [];
  for (const entry of row.templates) {
    if (!entry || typeof entry !== 'object') return null;
    const item = entry as Record<string, unknown>;
    if (typeof item.id !== 'string' || typeof item.name !== 'string' || typeof item.is_active !== 'boolean') return null;
    const duration = boundedInteger(item.duration_seconds, 8, 60);
    const fps = boundedInteger(item.fps, 24, 30);
    if (duration === null || fps === null || item.music !== 'none') return null;
    templates.push({
      id: item.id, name: item.name.slice(0, 80), isActive: item.is_active,
      durationSeconds: duration, fps, music: 'none',
      createdAt: typeof item.created_at === 'string' ? item.created_at : null,
    });
  }
  const activeId = typeof row.active_id === 'string' ? row.active_id : null;
  return {
    activeId,
    templates,
    activeDocument: row.active_document === null || row.active_document === undefined
      ? null : parseVideoTemplateDocument(row.active_document),
  };
}
