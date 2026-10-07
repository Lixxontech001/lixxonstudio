import { afterAll, beforeEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { DEFAULT_VIDEO_TEMPLATE } from '../../scripts/video-template.mjs';

const mocks = vi.hoisted(() => ({
  caller: vi.fn(),
  env: vi.fn(),
  service: vi.fn(),
  rpc: vi.fn(),
  sha256: vi.fn(),
  originAllowed: vi.fn(),
  serve: vi.fn(),
}));
vi.mock('../../supabase/functions/_shared/http.ts', () => ({
  callerUser: mocks.caller,
  env: mocks.env,
  rateLimit: mocks.sha256,
  serviceClient: mocks.service,
}));
vi.mock('../../supabase/functions/_shared/automationKeyChecks.ts', () => ({
  isAllowedAutomationOrigin: mocks.originAllowed,
}));

let handleAutomationVideoTemplate: typeof import('../../supabase/functions/automation-video-template/handler.ts')['handleAutomationVideoTemplate'];
let classifyGitHubDispatchStatus: typeof import('../../src/lib/automationPipeline.ts')['classifyGitHubDispatchStatus'];

const OWNER_ID = '00000000-0000-0000-0000-000000000001';
const templateDocument = () => JSON.parse(JSON.stringify(DEFAULT_VIDEO_TEMPLATE));

function request(body: unknown = { action: 'dispatch' }, init: RequestInit = {}) {
  return new Request('https://project.example/functions/v1/automation-video-template', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer USER_JWT', Origin: 'https://lixxonstudio.com' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
    ...init,
  });
}

beforeAll(async () => {
  vi.stubGlobal('Deno', { serve: mocks.serve });
  ({ handleAutomationVideoTemplate } = await import('../../supabase/functions/automation-video-template/handler.ts'));
  ({ classifyGitHubDispatchStatus } = await import('../../src/lib/automationPipeline.ts'));
});

beforeEach(() => {
  mocks.caller.mockReset().mockResolvedValue({ id: OWNER_ID });
  mocks.service.mockReset().mockReturnValue({ rpc: mocks.rpc });
  mocks.rpc.mockReset().mockImplementation(async (name: string) => {
    if (name === 'automation_video_template_active_internal') {
      return { data: { id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', name: templateDocument().name, document: templateDocument() }, error: null };
    }
    if (name === 'automation_secret_get_internal') return { data: 'FAKE_GITHUB_DISPATCH_KEY', error: null };
    return { data: null, error: null };
  });
  mocks.sha256.mockReset().mockResolvedValue(true);
  mocks.originAllowed.mockReset().mockReturnValue(true);
  mocks.env.mockReset().mockReturnValue('https://lixxonstudio.com');
});

afterAll(() => vi.unstubAllGlobals());

describe('automation video template dispatch', () => {
  it('dispatches the live look to the render workflow without exposing the token or the document in a URL', async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 204 }));
    const response = await handleAutomationVideoTemplate(request(), { fetcher });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'dispatched', workflow: 'video-render-test.yml' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.github.com/repos/Lixxontech001/lixxonstudio/actions/workflows/video-render-test.yml/dispatches');
    expect(url).not.toContain('template_json');
    const body = JSON.parse(String(init.body));
    expect(body.ref).toBe('main');
    expect(body.inputs.run_id).toBeUndefined();
    expect(JSON.parse(body.inputs.template_json)).toEqual(templateDocument());
    expect(String(init.body)).not.toContain('FAKE_GITHUB_DISPATCH_KEY');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer FAKE_GITHUB_DISPATCH_KEY');
  });

  it('never dispatches a look the owner did not activate, or one that fails the render contract', async () => {
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === 'automation_video_template_active_internal') return { data: null, error: null };
      return { data: 'FAKE_GITHUB_DISPATCH_KEY', error: null };
    });
    const fetcher = vi.fn();
    const empty = await handleAutomationVideoTemplate(request(), { fetcher });
    expect(empty.status).toBe(409);
    expect(fetcher).not.toHaveBeenCalled();

    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === 'automation_video_template_active_internal') {
        return { data: { id: 'x', name: 'Broken', document: { ...templateDocument(), fps: 60 } }, error: null };
      }
      return { data: 'FAKE_GITHUB_DISPATCH_KEY', error: null };
    });
    const broken = await handleAutomationVideoTemplate(request(), { fetcher });
    expect(broken.status).toBe(409);
    expect(await broken.text()).toContain('render contract');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('requires a signed-in owner, a JSON body and the one accepted action', async () => {
    const fetcher = vi.fn();
    mocks.caller.mockResolvedValueOnce(null);
    expect((await handleAutomationVideoTemplate(request(), { fetcher })).status).toBe(401);

    expect((await handleAutomationVideoTemplate(request({ action: 'publish' }), { fetcher })).status).toBe(400);
    const notPost = new Request('https://project.example/functions/v1/automation-video-template', {
      method: 'GET', headers: { Authorization: 'Bearer USER_JWT', Origin: 'https://lixxonstudio.com' },
    });
    expect((await handleAutomationVideoTemplate(notPost, { fetcher })).status).toBe(405);
    const notJson = new Request('https://project.example/functions/v1/automation-video-template', {
      method: 'POST', headers: { 'Content-Type': 'text/plain', Authorization: 'Bearer USER_JWT', Origin: 'https://lixxonstudio.com' }, body: '{}',
    });
    expect((await handleAutomationVideoTemplate(notJson, { fetcher })).status).toBe(415);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('refuses an oversized body and a rate-limited caller before touching GitHub', async () => {
    const fetcher = vi.fn();
    const huge = await handleAutomationVideoTemplate(request({ action: 'dispatch', padding: 'x'.repeat(2000) }), { fetcher });
    expect(huge.status).toBe(413);

    mocks.sha256.mockResolvedValue(false);
    const limited = await handleAutomationVideoTemplate(request(), { fetcher });
    expect(limited.status).toBe(429);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('reports a safe reason and no partial state when Vault or GitHub fails', async () => {
    const fetcher = vi.fn();
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === 'automation_video_template_active_internal') {
        return { data: { id: 'x', name: 'Live', document: templateDocument() }, error: null };
      }
      return { data: null, error: null };
    });
    const noToken = await handleAutomationVideoTemplate(request(), { fetcher });
    expect(noToken.status).toBe(409);
    expect(await noToken.text()).toContain('Vault');
    expect(fetcher).not.toHaveBeenCalled();

    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === 'automation_video_template_active_internal') {
        return { data: { id: 'x', name: 'Live', document: templateDocument() }, error: null };
      }
      return { data: 'FAKE_GITHUB_DISPATCH_KEY', error: null };
    });
    const refused = vi.fn(async () => new Response('github detail must not be inspected', { status: 403 }));
    const blocked = await handleAutomationVideoTemplate(request(), { fetcher: refused });
    expect(blocked.status).toBe(502);
    const text = await blocked.text();
    expect(text).toContain('GITHUB_FORBIDDEN');
    expect(text).not.toContain('github detail');
    // Every provider status maps to a safe code, and 204 is the only success.
    expect(classifyGitHubDispatchStatus(204)).toBe('dispatched');
  });

  it('treats a thrown or timed-out GitHub call as a safe, non-retrying failure', async () => {
    const throwing = vi.fn(async () => { throw new Error('socket closed'); });
    const response = await handleAutomationVideoTemplate(request(), { fetcher: throwing });
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.error_code).toBe('GITHUB_NETWORK_ERROR');
    expect(JSON.stringify(body)).not.toContain('socket closed');
  });

  it('answers a preflight only for an allowed origin', async () => {
    const fetcher = vi.fn();
    mocks.originAllowed.mockReturnValue(false);
    const blocked = await handleAutomationVideoTemplate(
      new Request('https://project.example/functions/v1/automation-video-template', { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } }),
      { fetcher },
    );
    expect(blocked.status).toBe(403);

    mocks.originAllowed.mockReturnValue(true);
    const allowed = await handleAutomationVideoTemplate(
      new Request('https://project.example/functions/v1/automation-video-template', { method: 'OPTIONS', headers: { Origin: 'https://lixxonstudio.com' } }),
      { fetcher },
    );
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get('Access-Control-Allow-Origin')).toBe('https://lixxonstudio.com');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
