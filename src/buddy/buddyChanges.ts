import { supabase } from '../lib/supabaseClient';

/** Browser side of Buddy's "Changes" screen: what the minds changed on articles, and the product gaps still open. */

export const CHANGES_LIMIT = 20;
export const GAPS_LIMIT = 20;
const TITLE_LIMIT = 160;
const PARAGRAPH_LIMIT = 4000;

/** One article change the minds made. Only the one paragraph is kept here: never the whole article. */
export interface AppliedChange {
  id: string;
  postId: string;
  postTitle: string;
  productNames: string[];
  appliedAt: string;
  before: string;
  after: string;
}

export interface GapNote {
  id: string;
  angle: string;
  note: string;
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

/** The sentence Buddy uses for one change. Plain words, no dash, no country. */
export function describeChange(change: AppliedChange): string {
  const names = change.productNames.length ? change.productNames.join(', ') : 'a product';
  return `I added ${names} to "${change.postTitle}". One paragraph changed.`;
}

/**
 * Keeps one change row. Anything that does not look like one is dropped, never guessed at.
 * Titles and names come from separate lookups; a missing one gets a plain fallback.
 */
export function parseChangeRow(row: unknown, titles: Record<string, string>, names: Record<string, string>): AppliedChange | null {
  if (!isRecord(row)) return null;
  if (typeof row.id !== 'string' || typeof row.post_id !== 'string' || !isTime(row.applied_at)) return null;
  if (typeof row.before_paragraph !== 'string' || typeof row.after_paragraph !== 'string') return null;
  const ids = Array.isArray(row.product_ids) ? row.product_ids.filter((id): id is string => typeof id === 'string') : [];
  return {
    id: row.id,
    postId: row.post_id,
    postTitle: clip(titles[row.post_id] || 'an article', TITLE_LIMIT),
    productNames: ids.map((id) => names[id]).filter((name): name is string => Boolean(name)),
    appliedAt: row.applied_at,
    before: clip(row.before_paragraph, PARAGRAPH_LIMIT),
    after: clip(row.after_paragraph, PARAGRAPH_LIMIT),
  };
}

export function parseGapRow(row: unknown): GapNote | null {
  if (!isRecord(row) || typeof row.id !== 'string' || typeof row.angle !== 'string' || !isTime(row.created_at)) return null;
  return {
    id: row.id,
    angle: clip(row.angle, 300),
    note: 'No product in the shop fits this yet. Create one in the shop, then ask Buddy again.',
    createdAt: row.created_at,
  };
}

/** Recent article changes, newest first. Null when the read fails, so the screen says so. */
export async function listAppliedChanges(): Promise<AppliedChange[] | null> {
  try {
    const { data, error } = await supabase
      .from('post_product_edits')
      .select('id,post_id,product_ids,before_paragraph,after_paragraph,applied_at')
      .order('applied_at', { ascending: false })
      .limit(CHANGES_LIMIT);
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
    return rows.map((row) => parseChangeRow(row, titles, names)).filter((change): change is AppliedChange => change !== null);
  } catch {
    return null;
  }
}

/** Open product gaps, newest first. Null when the read fails. */
export async function listGapNotes(): Promise<GapNote[] | null> {
  try {
    const { data, error } = await supabase
      .from('minds_gap_notes')
      .select('id,angle,created_at')
      .is('seen_at', null)
      .order('created_at', { ascending: false })
      .limit(GAPS_LIMIT);
    if (error || !Array.isArray(data)) return null;
    return data.map(parseGapRow).filter((gap): gap is GapNote => gap !== null);
  } catch {
    return null;
  }
}

/** Marks a gap as seen. The database allows the owner to change only this one field. */
export async function markGapSeen(id: string): Promise<boolean> {
  try {
    const { error } = await supabase.from('minds_gap_notes').update({ seen_at: new Date().toISOString() }).eq('id', id);
    return !error;
  } catch {
    return false;
  }
}
