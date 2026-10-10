import { supabase } from '../lib/supabaseClient';

/** Browser side of "Your jobs": the daily packs for the four gated channels, read from the owner's own rows. */
// The AI never posts. "I posted this" is the owner's own manual mark, made through one database function.

export const JOBS_LIMIT = 30;
export const JOBS_WINDOW_DAYS = 3;
const TITLE_LIMIT = 160;
const COPY_LIMIT = 2200;

export const PACK_CHANNEL_LABELS: Record<string, string> = {
  instagram: 'Instagram',
  tiktok: 'TikTok',
  facebook: 'Facebook (Page)',
  pinterest: 'Pinterest',
};

export type PackStatus = 'ready' | 'blocked' | 'posted_by_owner';

/** One pack row, shaped for the screen. Plain fields only. */
export interface PackJob {
  id: string;
  channel: string;
  channelLabel: string;
  localDay: string;
  articleTitle: string;
  articleUrl: string;
  status: PackStatus;
  blockedReason: string | null;
  suggestedLabel: string | null;
  suggestedUtc: string | null;
  caption: string | null;
  pinTitle: string | null;
  pinDescription: string | null;
  videoReady: boolean;
  productNames: string[];
  postedAt: string | null;
  createdAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isTime(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function clip(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function textOrNull(value: unknown, limit: number): string | null {
  return typeof value === 'string' && value.trim() ? clip(value, limit) : null;
}

/**
 * Keeps one pack row. Anything that does not look like a real pack is dropped, never guessed at.
 * The article title and product names come from separate lookups; a missing one gets a plain fallback.
 */
export function parsePackRow(row: unknown, titles: Record<string, string>, names: Record<string, string>): PackJob | null {
  if (!isRecord(row)) return null;
  if (typeof row.id !== 'string' || typeof row.post_id !== 'string' || !isTime(row.created_at)) return null;
  if (typeof row.channel !== 'string' || !Object.prototype.hasOwnProperty.call(PACK_CHANNEL_LABELS, row.channel)) return null;
  if (row.status !== 'ready' && row.status !== 'blocked' && row.status !== 'posted_by_owner') return null;
  if (typeof row.local_day !== 'string' || typeof row.article_url !== 'string') return null;
  const ids = Array.isArray(row.product_ids) ? row.product_ids.filter((id): id is string => typeof id === 'string') : [];
  return {
    id: row.id,
    channel: row.channel,
    channelLabel: PACK_CHANNEL_LABELS[row.channel],
    localDay: row.local_day,
    articleTitle: clip(titles[row.post_id] || 'an article', TITLE_LIMIT),
    articleUrl: clip(row.article_url, 500),
    status: row.status,
    blockedReason: textOrNull(row.blocked_reason, 300),
    suggestedLabel: textOrNull(row.suggested_label, 80),
    suggestedUtc: isTime(row.suggested_at_utc) ? row.suggested_at_utc : null,
    caption: textOrNull(row.caption, COPY_LIMIT),
    pinTitle: textOrNull(row.pin_title, 100),
    pinDescription: textOrNull(row.pin_description, 500),
    videoReady: typeof row.video_path === 'string' && row.video_path.trim().length > 0,
    productNames: ids.map((id) => names[id]).filter((name): name is string => Boolean(name)),
    postedAt: isTime(row.posted_at) ? row.posted_at : null,
    createdAt: row.created_at,
  };
}

/** The suggested time as plain UTC, e.g. "13:00 UTC". Never the owner's clock. */
export function utcClock(iso: string | null): string | null {
  if (!iso) return null;
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return null;
  return `${new Date(time).toISOString().slice(11, 16)} UTC`;
}

export interface PackDescription {
  headline: string;
  /** The status and the next step, one short line each. */
  lines: string[];
  /** The text to copy: a caption, or a pin title and description. Empty when the pack has none. */
  copy: string[];
  canMarkPosted: boolean;
}

/** The screen's words for one pack. Plain English, no dash, no country. */
export function describePackJob(job: PackJob): PackDescription {
  const headline = `${job.channelLabel} for "${job.articleTitle}"`;
  const copy: string[] = [];
  if (job.channel === 'pinterest') {
    if (job.pinTitle) copy.push(`Pin title: ${job.pinTitle}`);
    if (job.pinDescription) copy.push(`Pin description: ${job.pinDescription}`);
  } else if (job.caption) {
    copy.push(job.caption);
  }
  const lines: string[] = [];
  if (job.status === 'ready') {
    lines.push('Ready to post by hand.');
    const clock = utcClock(job.suggestedUtc);
    if (job.suggestedLabel && clock) lines.push(`Suggested time: ${job.suggestedLabel} (${clock}).`);
    else if (clock) lines.push(`Suggested time: ${clock}.`);
    lines.push(job.videoReady ? 'Video: ready.' : 'Video: video not made yet.');
  } else if (job.status === 'blocked') {
    lines.push(`Blocked: ${(job.blockedReason || 'no reason was saved').replace(/[.!?]+$/, '')}.`);
  } else {
    lines.push(job.postedAt ? `Posted by you on ${job.postedAt.slice(0, 10)}.` : 'Posted by you.');
  }
  if (job.productNames.length) lines.push(`Products: ${job.productNames.join(', ')}.`);
  return { headline, lines, copy, canMarkPosted: job.status === 'ready' };
}

/** Recent packs for the owner, newest first. Null when the read fails, so the screen says so. */
export async function listPackJobs(): Promise<PackJob[] | null> {
  try {
    const since = new Date(Date.now() - JOBS_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from('minds_packs')
      .select(
        'id,channel,local_day,post_id,article_url,suggested_at_utc,suggested_label,caption,pin_title,pin_description,video_path,product_ids,status,blocked_reason,posted_at,created_at',
      )
      .gt('created_at', since)
      .order('created_at', { ascending: false })
      .limit(JOBS_LIMIT);
    if (error || !Array.isArray(data)) return null;
    const rows = data.filter(isRecord);
    const postIds = [...new Set(rows.map((row) => row.post_id).filter((id): id is string => typeof id === 'string'))];
    const productIds = [...new Set(rows.flatMap((row) => (Array.isArray(row.product_ids) ? row.product_ids : [])).filter((id): id is string => typeof id === 'string'))];
    const titles: Record<string, string> = {};
    const names: Record<string, string> = {};
    if (postIds.length) {
      const { data: posts } = await supabase.from('posts').select('id,title').in('id', postIds);
      for (const post of Array.isArray(posts) ? posts : []) {
        if (isRecord(post) && typeof post.id === 'string' && typeof post.title === 'string') titles[post.id] = post.title;
      }
    }
    if (productIds.length) {
      const { data: products } = await supabase.from('products').select('id,name').in('id', productIds);
      for (const product of Array.isArray(products) ? products : []) {
        if (isRecord(product) && typeof product.id === 'string' && typeof product.name === 'string') names[product.id] = product.name;
      }
    }
    return rows.map((row) => parsePackRow(row, titles, names)).filter((job): job is PackJob => job !== null);
  } catch {
    return null;
  }
}

/** "I posted this". True only when the database marked one of the owner's ready packs. Nothing is posted anywhere. */
export async function markPackPosted(id: string): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc('minds_mark_pack_posted', { p_pack_id: id });
    return !error && data === true;
  } catch {
    return false;
  }
}
