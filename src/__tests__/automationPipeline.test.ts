import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import {
  AUTOMATION_GITHUB_REPOSITORY,
  AUTOMATION_GITHUB_REPOSITORY_ID,
  AUTOMATION_RUNNER_AUDIENCE,
  AUTOMATION_WORKFLOW_PATH,
  classifyGitHubDispatchStatus,
  evaluatePipelineArticle,
  verifyGitHubActionsOidc,
  type PipelineArticleMetadata,
} from '../lib/automationPipeline';

const fixedNow = 1_800_000_000;
let keyPair: CryptoKeyPair;
let publicJwk: JsonWebKey & { kid: string; alg: string; use: string };

function base64Url(value: string | Uint8Array): string {
  return Buffer.from(typeof value === 'string' ? value : value).toString('base64url');
}

function claims(overrides: Record<string, unknown> = {}) {
  const ref = 'refs/heads/main';
  return {
    iss: 'https://token.actions.githubusercontent.com',
    aud: AUTOMATION_RUNNER_AUDIENCE,
    sub: `repo:${AUTOMATION_GITHUB_REPOSITORY}:ref:${ref}`,
    exp: fixedNow + 300,
    nbf: fixedNow - 10,
    iat: fixedNow - 30,
    repository: AUTOMATION_GITHUB_REPOSITORY,
    repository_owner: 'Lixxontech001',
    repository_id: AUTOMATION_GITHUB_REPOSITORY_ID,
    ref,
    ref_type: 'branch',
    workflow_ref: `${AUTOMATION_GITHUB_REPOSITORY}/${AUTOMATION_WORKFLOW_PATH}@${ref}`,
    event_name: 'workflow_dispatch',
    run_id: '1234567890',
    run_attempt: '1',
    ...overrides,
  };
}

async function signToken(payload: Record<string, unknown>, kid = 'test-kid'): Promise<string> {
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid }));
  const body = base64Url(JSON.stringify(payload));
  const input = new TextEncoder().encode(`${header}.${body}`);
  const signature = await crypto.subtle.sign({ name: 'RSASSA-PKCS1-v1_5' }, keyPair.privateKey, input);
  return `${header}.${body}.${base64Url(new Uint8Array(signature))}`;
}

function jwksFetcher(keys = [publicJwk]): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    expect(String(input)).toBe('https://token.actions.githubusercontent.com/.well-known/jwks');
    expect(init).toMatchObject({ credentials: 'omit', redirect: 'error', cache: 'no-store' });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    return new Response(JSON.stringify({ keys }), { headers: { 'Content-Type': 'application/json' } });
  }) as unknown as typeof fetch;
}

function validArticle(overrides: Partial<PipelineArticleMetadata> = {}): PipelineArticleMetadata {
  return {
    status: 'scheduled',
    title: 'Owner-written article',
    slug: 'owner-written-article',
    excerpt: 'Owner-written excerpt for an approved article.',
    categoryId: 'category-id',
    tags: ['editorial'],
    coverImage: 'https://jaatgiqigsmjodqgaocl.supabase.co/storage/v1/object/public/blog/cover.jpg',
    coverImageAlt: 'Owner-written cover image description',
    seoTitle: 'Owner-written SEO title',
    seoDescription: 'Owner-written SEO description under the database limit.',
    scheduledAt: '2026-10-06T12:00:00.000Z',
    content: 'The owner-authored source links to [the source](https://example.com/reference).',
    ...overrides,
  };
}

beforeAll(async () => {
  vi.stubGlobal('crypto', webcrypto as unknown as Crypto);
  keyPair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  const exported = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  publicJwk = { ...exported, kid: 'test-kid', alg: 'RS256', use: 'sig' };
});

afterAll(() => vi.unstubAllGlobals());

describe('GitHub Actions OIDC verification', () => {
  it('accepts only a signed workflow_dispatch from the fixed repository and allowed ref', async () => {
    const token = await signToken(claims());
    await expect(verifyGitHubActionsOidc(token, jwksFetcher(), fixedNow)).resolves.toEqual({
      runId: 1234567890,
      runAttempt: 1,
      ref: 'refs/heads/main',
    });
  });

  it.each([
    'refs/heads/arena/4da46b60-lixxonstudio',
    'refs/heads/arena/aa5e24a0-lixxonstudio',
  ])('accepts the explicitly allowed Arena ref %s while binding the exact workflow path', async ref => {
    const token = await signToken(claims({
      ref,
      sub: `repo:${AUTOMATION_GITHUB_REPOSITORY}:ref:${ref}`,
      workflow_ref: `${AUTOMATION_GITHUB_REPOSITORY}/${AUTOMATION_WORKFLOW_PATH}@${ref}`,
    }));
    await expect(verifyGitHubActionsOidc(token, jwksFetcher(), fixedNow)).resolves.toMatchObject({ ref });
  });

  it('rejects bad signatures, unknown signing keys and tampered claims', async () => {
    const token = await signToken(claims());
    const otherJwk = { ...publicJwk, kid: 'different-key' };
    await expect(verifyGitHubActionsOidc(token, jwksFetcher([otherJwk]), fixedNow)).resolves.toBeNull();
    await expect(verifyGitHubActionsOidc(`${token.slice(0, -2)}aa`, jwksFetcher(), fixedNow)).resolves.toBeNull();
    const tampered = `${token.split('.')[0]}.${base64Url(JSON.stringify(claims({ repository_id: '1' })))}.${token.split('.')[2]}`;
    await expect(verifyGitHubActionsOidc(tampered, jwksFetcher(), fixedNow)).resolves.toBeNull();
  });

  it.each([
    ['wrong audience', { aud: 'https://example.com' }],
    ['multiple intended audiences', { aud: [AUTOMATION_RUNNER_AUDIENCE, 'https://example.com'] }],
    ['wrong repository', { repository: 'attacker/repository' }],
    ['wrong repository id', { repository_id: '1' }],
    ['wrong owner', { repository_owner: 'attacker' }],
    ['wrong event', { event_name: 'pull_request' }],
    ['wrong ref', { ref: 'refs/heads/feature' }],
    ['wrong workflow', { workflow_ref: 'Lixxontech001/lixxonstudio/.github/workflows/other.yml@refs/heads/main' }],
    ['wrong subject', { sub: 'repo:attacker/repository:ref:refs/heads/main' }],
    ['invalid run number', { run_id: 'not-a-run' }],
  ])('rejects %s even when signed by GitHub', async (_name, override) => {
    const token = await signToken(claims(override));
    await expect(verifyGitHubActionsOidc(token, jwksFetcher(), fixedNow)).resolves.toBeNull();
  });

  it('rejects expired, not-yet-valid, stale, oversized and malformed tokens', async () => {
    const expired = await signToken(claims({ exp: fixedNow - 1 }));
    const future = await signToken(claims({ nbf: fixedNow + 120 }));
    const stale = await signToken(claims({ iat: fixedNow - 360 }));
    await expect(verifyGitHubActionsOidc(expired, jwksFetcher(), fixedNow)).resolves.toBeNull();
    await expect(verifyGitHubActionsOidc(future, jwksFetcher(), fixedNow)).resolves.toBeNull();
    await expect(verifyGitHubActionsOidc(stale, jwksFetcher(), fixedNow)).resolves.toBeNull();
    await expect(verifyGitHubActionsOidc('x'.repeat(16_385), jwksFetcher(), fixedNow)).resolves.toBeNull();
    await expect(verifyGitHubActionsOidc('not-a-jwt', jwksFetcher(), fixedNow)).resolves.toBeNull();
  });
});

describe('safe article pipeline preflight', () => {
  it('checks metadata, HTTPS media, safe links and risk language without mutating owner prose', () => {
    const article = validArticle();
    const original = article.content;
    expect(evaluatePipelineArticle(article)).toEqual({
      metadataComplete: true,
      imageUrlHttps: true,
      imageAttributionReviewRequired: false,
      canonicalPathSafe: true,
      articleLinksSafe: true,
      sourcePresent: true,
      claimReviewRequired: false,
      disclaimerRequired: false,
      disclaimerPresent: false,
      humanReviewRequired: false,
    });
    expect(article.content).toBe(original);
  });

  it.each([
    ['plain HTTP link', 'Read [a source](http://example.com).'],
    ['private address', 'See https://192.168.1.20/private'],
    ['localhost link', 'See https://localhost/admin'],
    ['bare web host', 'Visit www.example.com for details.'],
    ['script scheme', 'Use [this](javascript:alert(1)).'],
    ['unsupported scheme', 'Use [this](ftp://example.com/file).'],
  ])('blocks %s without changing the source', (_label, content) => {
    const article = validArticle({ content });
    const original = article.content;
    expect(evaluatePipelineArticle(article).articleLinksSafe).toBe(false);
    expect(article.content).toBe(original);
  });

  it('holds medical, cure and guaranteed-result language for human review rather than rewriting it', () => {
    const content = 'This product is clinically proven to cure a condition.';
    const article = validArticle({ content });
    expect(evaluatePipelineArticle(article).humanReviewRequired).toBe(true);
    expect(article.content).toBe(content);
  });

  it('holds third-party image origins for owner attribution review', () => {
    const result = evaluatePipelineArticle(validArticle({ coverImage: 'https://images.example.com/cover.jpg' }));
    expect(result.imageUrlHttps).toBe(true);
    expect(result.imageAttributionReviewRequired).toBe(true);
    expect(result.humanReviewRequired).toBe(true);
  });

  it('detects owner-authored disclaimers for risky claims without editing article prose', () => {
    const riskyClaim = 'This product is clinically proven to cure a condition.';
    const missing = evaluatePipelineArticle(validArticle({ content: riskyClaim }));
    expect(missing.disclaimerRequired).toBe(true);
    expect(missing.disclaimerPresent).toBe(false);
    expect(missing.humanReviewRequired).toBe(true);
    const ownerText = `${riskyClaim} This is not medical advice.`;
    const present = evaluatePipelineArticle(validArticle({ content: ownerText }));
    expect(present.disclaimerPresent).toBe(true);
    expect(present.humanReviewRequired).toBe(true);
    expect(ownerText).toBe(`${riskyClaim} This is not medical advice.`);
  });

  it('blocks missing metadata, unsafe cover URLs and invalid slugs', () => {
    expect(evaluatePipelineArticle(validArticle({ seoTitle: '' })).metadataComplete).toBe(false);
    expect(evaluatePipelineArticle(validArticle({ coverImage: 'http://images.example.com/cover.jpg' })).imageUrlHttps).toBe(false);
    expect(evaluatePipelineArticle(validArticle({ slug: '../unsafe' })).canonicalPathSafe).toBe(false);
  });
});

describe('GitHub dispatch response classification', () => {
  it.each([
    [204, 'dispatched'],
    [401, 'auth'],
    [403, 'forbidden'],
    [429, 'rate_limited'],
    [503, 'unavailable'],
    [422, 'unexpected'],
  ] as const)('classifies HTTP %i safely', (status, expected) => {
    expect(classifyGitHubDispatchStatus(status)).toBe(expected);
  });
});
