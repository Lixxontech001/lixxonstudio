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
      || !Array.isArray(value.channels) || value.channels.length !== DISTRIBUTION_CHANNEL_KEYS.length) return null;
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
        || !(candidate.last_readback_at === null || (typeof candidate.last_readback_at === 'string' && Number.isFinite(Date.parse(candidate.last_readback_at))))) return null;
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
