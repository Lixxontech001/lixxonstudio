import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  env: vi.fn(),
  serviceClient: vi.fn(),
  rpc: vi.fn(),
  deliverAlerts: vi.fn(),
  serve: vi.fn(),
}));
vi.mock('../../supabase/functions/_shared/http.ts', () => ({ env: mocks.env, serviceClient: mocks.serviceClient }));
vi.mock('../../supabase/functions/_shared/automationAlerts.ts', () => ({
  deliverPendingAutomationFailureAlerts: mocks.deliverAlerts,
}));

const RUN_ID = '8b7c9a31-1f82-4e92-9c74-fb8de10a63f7';
let handleAutomationScheduler: typeof import('../../supabase/functions/automation-scheduler/index.ts')['handleAutomationScheduler'];

function schedulerRequest() {
  return new Request('https://project.example/functions/v1/automation-scheduler', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-secret': 'INTERNAL_TEST_SECRET' },
    body: '{}',
  });
}

beforeAll(async () => {
  vi.stubGlobal('Deno', { serve: mocks.serve, env: { get: () => undefined } });
  mocks.env.mockReturnValue('INTERNAL_TEST_SECRET');
  mocks.serviceClient.mockReturnValue({ rpc: mocks.rpc });
  ({ handleAutomationScheduler } = await import('../../supabase/functions/automation-scheduler/index.ts'));
});

afterEach(() => {
  mocks.rpc.mockReset();
  mocks.deliverAlerts.mockReset().mockResolvedValue([]);
  mocks.serve.mockClear();
});

afterAll(() => vi.unstubAllGlobals());

describe('automation scheduler failure-alert hooks', () => {
  it('delivers any pending terminal alerts even when there are no new daily claims', async () => {
    mocks.rpc.mockImplementation(async (name: string) => name === 'automation_claim_daily_runs'
      ? { data: [], error: null }
      : { data: null, error: null });

    const response = await handleAutomationScheduler(schedulerRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'idle', claimed: 0 });
    expect(mocks.deliverAlerts).toHaveBeenCalledTimes(1);
    expect(mocks.deliverAlerts).toHaveBeenCalledWith(expect.objectContaining({ rpc: expect.any(Function) }), expect.any(Function));
  });

  it('records a safe dispatch failure and checks for a terminal alert after the dispatch result', async () => {
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === 'automation_claim_daily_runs') return { data: [{ run_id: RUN_ID }], error: null };
      if (name === 'automation_secret_get_internal') return { data: 'FAKE_GITHUB_DISPATCH_KEY', error: null };
      if (name === 'automation_record_daily_dispatch') return { data: true, error: null };
      return { data: null, error: null };
    });
    const fetcher = vi.fn(async () => new Response('provider response must not be inspected', { status: 403 }));

    const response = await handleAutomationScheduler(schedulerRequest(), fetcher);

    expect(response.status).toBe(200);
    const responseText = await response.text();
    expect(JSON.parse(responseText)).toMatchObject({ status: 'blocked', failed: 1 });
    expect(mocks.rpc).toHaveBeenCalledWith('automation_record_daily_dispatch', {
      p_run_id: RUN_ID,
      p_result: 'failed',
      p_safe_error_code: 'GITHUB_FORBIDDEN',
      p_http_status: 403,
    });
    expect(mocks.deliverAlerts).toHaveBeenCalledTimes(2);
    expect(responseText).not.toContain('FAKE_GITHUB_DISPATCH_KEY');
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining('api.github.com'), expect.objectContaining({
      method: 'POST', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer',
    }));
  });
});
