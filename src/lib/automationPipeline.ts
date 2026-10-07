export const AUTOMATION_RUNNER_AUDIENCE = 'urn:lixxonstudio:automation:runner';
export const AUTOMATION_GITHUB_REPOSITORY = 'Lixxontech001/lixxonstudio';
export const AUTOMATION_GITHUB_REPOSITORY_ID = '1402965323';
export const AUTOMATION_WORKFLOW_PATH = '.github/workflows/automation.yml';
export const AUTOMATION_ALLOWED_REFS = Object.freeze([
  'refs/heads/main',
  'refs/heads/arena/4da46b60-lixxonstudio',
  'refs/heads/arena/aa5e24a0-lixxonstudio',
] as const);
export const AUTOMATION_RUN_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GITHUB_OIDC_ISSUER = 'https://token.actions.githubusercontent.com';
const GITHUB_OIDC_JWKS_URL = `${GITHUB_OIDC_ISSUER}/.well-known/jwks`;
const OIDC_MAX_AGE_SECONDS = 5 * 60;
const CLOCK_SKEW_SECONDS = 30;

export interface VerifiedGitHubRunner {
  runId: number;
  runAttempt: number;
  ref: typeof AUTOMATION_ALLOWED_REFS[number];
}

interface JsonWebKeySet {
  keys?: JsonWebKey[];
}

interface ParsedOidcClaims {
  iss?: unknown;
  aud?: unknown;
  sub?: unknown;
  exp?: unknown;
  nbf?: unknown;
  iat?: unknown;
  repository?: unknown;
  repository_owner?: unknown;
  repository_id?: unknown;
  ref?: unknown;
  ref_type?: unknown;
  workflow_ref?: unknown;
  event_name?: unknown;
  run_id?: unknown;
  run_attempt?: unknown;
}

function base64UrlBytes(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);
    const binary = atob(padded);
    return Uint8Array.from(binary, character => character.charCodeAt(0));
  } catch {
    return null;
  }
}

function parseJsonPart<T>(value: string): T | null {
  const bytes = base64UrlBytes(value);
  if (!bytes) return null;
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as T;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function hasAudience(value: unknown): boolean {
  return value === AUTOMATION_RUNNER_AUDIENCE;
}

function parseSafeInteger(value: unknown, minimum: number, maximum: number): number | null {
  const number = typeof value === 'number' ? value : typeof value === 'string' && /^\d{1,16}$/.test(value) ? Number(value) : NaN;
  return Number.isSafeInteger(number) && number >= minimum && number <= maximum ? number : null;
}

/**
 * Verify the signed, short-lived GitHub Actions OIDC JWT used by the workflow.
 * The caller must still bind its run ID to a queued database run and redeem the
 * separate one-use capability before any pipeline work is performed.
 */
export async function verifyGitHubActionsOidc(
  rawToken: string,
  fetcher: typeof fetch = fetch,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<VerifiedGitHubRunner | null> {
  if (!rawToken || rawToken.length > 16_384 || /[\r\n\s]/.test(rawToken)) return null;
  const parts = rawToken.split('.');
  if (parts.length !== 3) return null;

  const header = parseJsonPart<Record<string, unknown>>(parts[0]);
  const claims = parseJsonPart<ParsedOidcClaims>(parts[1]);
  const signature = base64UrlBytes(parts[2]);
  if (!header || !claims || !signature || header.alg !== 'RS256' || typeof header.kid !== 'string' || header.kid.length > 256) return null;

  const keyController = new AbortController();
  const keyTimeout = setTimeout(() => keyController.abort(), 5_000);
  try {
    const keyResponse = await fetcher(GITHUB_OIDC_JWKS_URL, {
      method: 'GET',
      redirect: 'error',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      credentials: 'omit',
      signal: keyController.signal,
      headers: { Accept: 'application/json' },
    });
    if (!keyResponse.ok) {
      await keyResponse.body?.cancel().catch(() => undefined);
      return null;
    }
    const declaredLength = Number(keyResponse.headers.get('content-length') || 0);
    if (Number.isFinite(declaredLength) && declaredLength > 64 * 1024) {
      await keyResponse.body?.cancel().catch(() => undefined);
      return null;
    }
    const keySet = await keyResponse.json() as JsonWebKeySet;
    if (!Array.isArray(keySet.keys) || keySet.keys.length < 1 || keySet.keys.length > 32) return null;
    const jwk = keySet.keys.find(key => isRecord(key)
      && key.kid === header.kid
      && key.kty === 'RSA'
      && (!key.alg || key.alg === 'RS256')
      && (!key.use || key.use === 'sig')
      && (key.key_ops === undefined || (Array.isArray(key.key_ops) && key.key_ops.includes('verify'))));
    if (!jwk) return null;
    const publicKey = await crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    const signedBytes = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    const signatureBytes = new Uint8Array(signature);
    const signatureValid = await crypto.subtle.verify(
      { name: 'RSASSA-PKCS1-v1_5' },
      publicKey,
      signatureBytes,
      signedBytes,
    );
    if (!signatureValid) return null;
  } catch {
    return null;
  } finally {
    clearTimeout(keyTimeout);
  }

  if (claims.iss !== GITHUB_OIDC_ISSUER || !hasAudience(claims.aud)) return null;
  const exp = parseSafeInteger(claims.exp, nowSeconds - CLOCK_SKEW_SECONDS, nowSeconds + 10 * 60);
  const iat = parseSafeInteger(claims.iat, nowSeconds - OIDC_MAX_AGE_SECONDS, nowSeconds + CLOCK_SKEW_SECONDS);
  const nbf = parseSafeInteger(claims.nbf, 0, nowSeconds + CLOCK_SKEW_SECONDS);
  if (exp === null || iat === null || nbf === null || exp <= nowSeconds || iat > exp || nbf > nowSeconds + CLOCK_SKEW_SECONDS) return null;

  const ref = typeof claims.ref === 'string' && AUTOMATION_ALLOWED_REFS.includes(claims.ref as typeof AUTOMATION_ALLOWED_REFS[number])
    ? claims.ref as typeof AUTOMATION_ALLOWED_REFS[number]
    : null;
  if (!ref || claims.ref_type !== 'branch' || claims.event_name !== 'workflow_dispatch') return null;
  if (typeof claims.repository !== 'string' || claims.repository.toLowerCase() !== AUTOMATION_GITHUB_REPOSITORY.toLowerCase()) return null;
  if (typeof claims.repository_owner !== 'string' || claims.repository_owner.toLowerCase() !== 'lixxontech001') return null;
  if (String(claims.repository_id) !== AUTOMATION_GITHUB_REPOSITORY_ID) return null;
  if (claims.workflow_ref !== `${AUTOMATION_GITHUB_REPOSITORY}/${AUTOMATION_WORKFLOW_PATH}@${ref}`) return null;
  if (claims.sub !== `repo:${AUTOMATION_GITHUB_REPOSITORY}:ref:${ref}`) return null;

  const runId = parseSafeInteger(claims.run_id, 1, Number.MAX_SAFE_INTEGER);
  const runAttempt = parseSafeInteger(claims.run_attempt, 1, 100);
  if (runId === null || runAttempt === null) return null;
  return { runId, runAttempt, ref };
}

export interface PipelineArticleMetadata {
  status: string;
  title: string | null;
  slug: string | null;
  excerpt: string | null;
  categoryId: string | null;
  tags: string[] | null;
  coverImage: string | null;
  coverImageAlt: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  scheduledAt: string | null;
  content: string | null;
}

export interface PipelineSafetyResult {
  metadataComplete: boolean;
  imageUrlHttps: boolean;
  imageAttributionReviewRequired: boolean;
  canonicalPathSafe: boolean;
  articleLinksSafe: boolean;
  sourcePresent: boolean;
  claimReviewRequired: boolean;
  disclaimerRequired: boolean;
  disclaimerPresent: boolean;
  humanReviewRequired: boolean;
}

const CLAIM_REVIEW_PATTERN = /\b(?:guarantee(?:d|s)?|cure(?:s|d)?|eliminat(?:e|es|ed)|treat(?:s|ed|ment)|heal(?:s|ed|ing)?|doctor[ -]+approved|clinically[ -]+proven|lose\s+\d+\s*(?:kg|kilograms?|pounds?|lbs?))\b/i;
const DISCLAIMER_PATTERN = /\b(?:not medical advice|not a substitute for (?:professional )?medical advice|consult (?:your )?(?:doctor|physician|healthcare provider)|results may vary|individual results vary)\b/i;
const FIRST_PARTY_IMAGE_HOSTS = [
  'lixxonstudio.com',
  'lixxonstudio.vercel.app',
  'jaatgiqigsmjodqgaocl.supabase.co',
];
const URL_PATTERN = /(?:href\s*=\s*["']([^"']+)["']|\]\(([^)]+)\)|(https?:\/\/[^\s<>"')\]]+))/gi;
const PRIVATE_HOST_PATTERN = /^(?:localhost|.*\.local|127(?:\.\d{1,3}){3}|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})$/i;

function imageAttributionNeedsReview(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return !FIRST_PARTY_IMAGE_HOSTS.some(firstParty => host === firstParty || host.endsWith(`.${firstParty}`));
}

function safeArticleLink(raw: string): boolean {
  const value = raw.trim().replace(/[),.;!?]+$/g, '');
  if (!value || value.startsWith('#')) return true;
  if (value.startsWith('/') && !value.startsWith('//') && !value.includes('\\')) return true;
  if (/^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(value)) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && !url.username
      && !url.password
      && !PRIVATE_HOST_PATTERN.test(url.hostname)
      && !url.hostname.startsWith('[');
  } catch {
    return false;
  }
}

export function evaluatePipelineArticle(article: PipelineArticleMetadata): PipelineSafetyResult {
  const title = article.title?.trim() || '';
  const slug = article.slug?.trim() || '';
  const excerpt = article.excerpt?.trim() || '';
  const alt = article.coverImageAlt?.trim() || '';
  const content = article.content || '';
  let imageUrlHttps = false;
  let imageAttributionReviewRequired = true;
  try {
    const image = new URL(article.coverImage || '');
    imageUrlHttps = image.protocol === 'https:' && !image.username && !image.password && !PRIVATE_HOST_PATTERN.test(image.hostname);
    imageAttributionReviewRequired = imageAttributionNeedsReview(image.hostname);
  } catch {
    imageUrlHttps = false;
  }
  const unparsedText = content.replace(URL_PATTERN, '');
  const containsBareWebHost = /\bwww\.[a-z0-9-]+(?:\.[a-z0-9-]+)+/i.test(unparsedText);
  let articleLinksSafe = !/\b(?:javascript|data|file|vbscript):/i.test(content)
    && !/https?:\/\//i.test(unparsedText)
    && !containsBareWebHost;
  URL_PATTERN.lastIndex = 0;
  for (const match of content.matchAll(URL_PATTERN)) {
    const link = match[1] || match[2] || match[3] || '';
    if (!safeArticleLink(link)) articleLinksSafe = false;
  }
  URL_PATTERN.lastIndex = 0;
  const canonicalPathSafe = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) && !slug.includes('..');
  const metadataComplete = article.status === 'scheduled' || article.status === 'published'
    ? Boolean(title && canonicalPathSafe && excerpt && article.categoryId && article.tags?.some(tag => tag.trim())
      && imageUrlHttps && alt && article.seoTitle?.trim() && article.seoTitle.trim().length <= 70
      && article.seoDescription?.trim() && article.seoDescription.trim().length <= 160 && article.scheduledAt)
    : false;
  const sourcePresent = content.trim().length > 0;
  const claimReviewRequired = CLAIM_REVIEW_PATTERN.test(`${title}\n${excerpt}\n${content}`);
  const disclaimerPresent = DISCLAIMER_PATTERN.test(content);
  return {
    metadataComplete,
    imageUrlHttps,
    imageAttributionReviewRequired,
    canonicalPathSafe,
    articleLinksSafe,
    sourcePresent,
    claimReviewRequired,
    disclaimerRequired: claimReviewRequired,
    disclaimerPresent,
    // External/unknown image origins, risky claims and missing required disclaimers
    // all remain with the owner; no prose or attribution is generated here.
    humanReviewRequired: imageAttributionReviewRequired || claimReviewRequired || (claimReviewRequired && !disclaimerPresent),
  };
}

export function classifyGitHubDispatchStatus(status: number): 'dispatched' | 'auth' | 'forbidden' | 'rate_limited' | 'unavailable' | 'unexpected' {
  if (status === 204) return 'dispatched';
  if (status === 401) return 'auth';
  if (status === 403) return 'forbidden';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'unavailable';
  return 'unexpected';
}

export function isSafeAutomationRunId(value: unknown): value is string {
  return typeof value === 'string' && AUTOMATION_RUN_ID_PATTERN.test(value);
}
