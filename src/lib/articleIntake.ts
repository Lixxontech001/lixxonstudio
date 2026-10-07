export const ARTICLE_WORD_TARGET = Object.freeze({ min: 3500, max: 4000 });
export const LAGOS_TIME_ZONE = 'Africa/Lagos';
const LAGOS_UTC_OFFSET_MINUTES = 60;
const WORD_PATTERN = /[\p{L}\p{N}]+(?:[’'][\p{L}\p{N}]+)*/gu;

export interface IntakeMetadataDraft {
  title: string;
  slug: string;
  categoryId: string;
  tags: string[];
  coverImage: string;
  coverImageAlt: string;
  proposedAt: string;
}

export interface IntakeValidationIssue {
  field: keyof IntakeMetadataDraft | 'wordCount' | 'coverImage';
  severity: 'error' | 'warning';
  message: string;
}

export function countArticleWords(text: string): number {
  return Array.from(text.matchAll(WORD_PATTERN)).length;
}

export function slugifyArticleTitle(title: string): string {
  return title.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function parseArticleTags(value: string): string[] {
  return Array.from(new Set(value.split(',').map(tag => tag.trim().toLowerCase()).filter(Boolean)));
}

export function lagosDateKey(value: string | Date = new Date()): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: LAGOS_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const part = (type: string) => parts.find(item => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** Convert a datetime-local value explicitly interpreted as Lagos wall time to UTC. */
export function lagosInputToIso(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [, y, m, d, h, min] = match;
  const year = Number(y); const month = Number(m); const day = Number(d);
  const hour = Number(h); const minute = Number(min);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth || hour > 23 || minute > 59) return null;
  const utc = Date.UTC(year, month - 1, day, hour, minute - LAGOS_UTC_OFFSET_MINUTES);
  return new Date(utc).toISOString();
}

/** Render an ISO timestamp as the wall-clock value displayed to the owner in Lagos. */
export function isoToLagosInput(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: LAGOS_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const part = (type: string) => parts.find(item => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}

export function lagosDateTimeLabel(value: string | null | undefined): string {
  if (!value) return 'No date proposed';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Invalid date' : new Intl.DateTimeFormat('en-NG', {
    timeZone: LAGOS_TIME_ZONE, dateStyle: 'medium', timeStyle: 'short',
  }).format(date) + ' WAT';
}

export function addLagosDays(dayKey: string, days: number): string {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
  if (!parts) return '';
  const shifted = new Date(Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]) + days));
  return [shifted.getUTCFullYear(), String(shifted.getUTCMonth() + 1).padStart(2, '0'), String(shifted.getUTCDate()).padStart(2, '0')].join('-');
}

export function startOfLagosWeek(dayKey: string): string {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
  if (!parts) return '';
  const date = new Date(Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3])));
  const mondayOffset = (date.getUTCDay() + 6) % 7;
  return addLagosDays(dayKey, -mondayOffset);
}

export function lagosDayAtTimeToIso(dayKey: string, time = '08:00'): string | null {
  return lagosInputToIso(`${dayKey}T${time}`);
}

export function isSafeImageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && Boolean(url.hostname);
  } catch {
    return false;
  }
}

export function validateIntakeMetadata(
  draft: IntakeMetadataDraft,
  wordCount: number,
  existingSlugs: Iterable<string>,
  now = new Date(),
): IntakeValidationIssue[] {
  const issues: IntakeValidationIssue[] = [];
  const slugs = new Set(existingSlugs);
  const title = draft.title.trim();
  const slug = draft.slug.trim().toLowerCase();
  const tags = draft.tags.map(tag => tag.trim()).filter(Boolean);
  const proposedIso = lagosInputToIso(draft.proposedAt);

  if (!title) issues.push({ field: 'title', severity: 'error', message: 'Enter the owner-written article title.' });
  else if (title.length > 200) issues.push({ field: 'title', severity: 'error', message: 'The title must be 200 characters or fewer.' });
  if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    issues.push({ field: 'slug', severity: 'error', message: 'Use a unique lowercase URL slug with letters, numbers and hyphens.' });
  } else if (slugs.has(slug)) {
    issues.push({ field: 'slug', severity: 'error', message: 'This article slug is already in use.' });
  }
  if (!draft.categoryId) issues.push({ field: 'categoryId', severity: 'error', message: 'Choose an article category.' });
  if (tags.length === 0) issues.push({ field: 'tags', severity: 'error', message: 'Add at least one article tag.' });
  if (!draft.coverImage || !isSafeImageUrl(draft.coverImage)) {
    issues.push({ field: 'coverImage', severity: 'error', message: 'Choose a valid HTTPS image from the Media library.' });
  }
  if (!draft.coverImageAlt.trim()) issues.push({ field: 'coverImageAlt', severity: 'error', message: 'Add owner-written alt text for the selected image.' });
  if (!proposedIso) issues.push({ field: 'proposedAt', severity: 'error', message: 'Choose a valid proposed date and time in Lagos.' });
  else if (new Date(proposedIso).getTime() <= now.getTime()) issues.push({ field: 'proposedAt', severity: 'error', message: 'The proposed Lagos publication time must be in the future.' });
  if (wordCount <= 0) issues.push({ field: 'wordCount', severity: 'error', message: 'The DOCX contains no importable article words.' });
  else if (wordCount < ARTICLE_WORD_TARGET.min || wordCount > ARTICLE_WORD_TARGET.max) {
    issues.push({ field: 'wordCount', severity: 'warning', message: `This article has ${wordCount.toLocaleString()} words; the target is ${ARTICLE_WORD_TARGET.min.toLocaleString()}–${ARTICLE_WORD_TARGET.max.toLocaleString()}. The prose is not changed.` });
  }
  return issues;
}
