// Phase I slice 2: the door the 08:00 clock uses to start the owner's own run. The internal secret is the only way
// in on that path, the owner id is checked against app_admins, and a browser is unchanged. Fake fetch and fake
// clients only: no model, no database, no live function is called.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { callInternal, internalCallDetail, isInternalCall, safeEqual } from '../../supabase/functions/_shared/internalCall';

const SECRET = 'internal-secret-for-tests-only';
const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const post = (headers: Record<string, string> = {}) => new Request('https://example.test/minds-run-placement', { method: 'POST', headers });

describe('Phase I slice 2: the internal secret is the door', () => {
  it('a request is internal only when the secret matches exactly', () => {
    expect(isInternalCall(post({ 'x-internal-secret': SECRET }), SECRET)).toBe(true);
    expect(isInternalCall(post({ 'x-internal-secret': `${SECRET}x` }), SECRET)).toBe(false);
    expect(isInternalCall(post({ 'x-internal-secret': SECRET.slice(0, -1) }), SECRET)).toBe(false);
    expect(isInternalCall(post({}), SECRET)).toBe(false);
    expect(isInternalCall(post({ 'x-internal-secret': '' }), SECRET)).toBe(false);
  });

  it('an unset secret never matches, whatever is sent', () => {
    expect(isInternalCall(post({ 'x-internal-secret': '' }), undefined)).toBe(false);
    expect(isInternalCall(post({ 'x-internal-secret': 'anything' }), undefined)).toBe(false);
    expect(isInternalCall(post({ 'x-internal-secret': 'anything' }), '')).toBe(false);
  });

  it('the comparison never says where two secrets first differ', () => {
    expect(safeEqual(SECRET, SECRET)).toBe(true);
    expect(safeEqual(SECRET, `${SECRET}x`)).toBe(false);
    expect(safeEqual(`${SECRET}x`, SECRET)).toBe(false);
    expect(safeEqual('', '')).toBe(true);
  });
});

describe('Phase I slice 2: one internal call, honestly reported', () => {
  it('a good answer is read as JSON and reported as ok', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ status: 'applied', detail: 'Added the kit.' }), { status: 200 }));
    const result = await callInternal('https://example.test/minds-run-placement', SECRET, { local_day: '2026-10-14', owner_id: 'x' }, fetchImpl as unknown as typeof fetch);
    expect(result).toEqual({ ok: true, status: 200, body: { status: 'applied', detail: 'Added the kit.' } });
    const [url, init] = (fetchImpl as unknown as { mock: { calls: Array<[string, RequestInit]> } }).mock.calls[0];
    expect(url).toBe('https://example.test/minds-run-placement');
    expect(init.method).toBe('POST');
    // Only the secret and the run's own body travel. No key, no token, no user session.
    expect(Object.keys(init.headers as Record<string, string>).sort()).toEqual(['Content-Type', 'x-internal-secret']);
    expect((init.headers as Record<string, string>)['x-internal-secret']).toBe(SECRET);
    expect(String(init.body)).toContain('2026-10-14');
  });

  it('a refusal is not ok, and never a crash', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: 'Owner-only access is required.' }), { status: 403 }));
    const result = await callInternal('https://example.test/minds-run-placement', SECRET, {}, fetchImpl as unknown as typeof fetch);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
    expect(internalCallDetail(result)).toBe('The run refused the internal call. Nothing changed.');
  });

  it('a call that cannot be made at all is reported as unreachable', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down');
    });
    const result = await callInternal('https://example.test/minds-run-placement', SECRET, {}, fetchImpl as unknown as typeof fetch);
    expect(result).toEqual({ ok: false, status: 0, body: null });
    expect(internalCallDetail(result)).toBe('The run could not be reached. Nothing changed.');
  });

  it('an answer that is not JSON is not ok, and no detail is invented', async () => {
    const fetchImpl = vi.fn(async () => new Response('<html>gateway</html>', { status: 200 }));
    const result = await callInternal('https://example.test/minds-run-placement', SECRET, {}, fetchImpl as unknown as typeof fetch);
    expect(result).toEqual({ ok: false, status: 200, body: null });
    expect(internalCallDetail(result)).toBe('The run did not finish. Nothing changed.');
  });

  it('every plain line says nothing changed, and none of them names a machine word', () => {
    const lines = [
      internalCallDetail({ ok: true, status: 200, body: {} }),
      internalCallDetail({ ok: false, status: 0, body: null }),
      internalCallDetail({ ok: false, status: 401, body: null }),
      internalCallDetail({ ok: false, status: 403, body: null }),
      internalCallDetail({ ok: false, status: 503, body: null }),
      internalCallDetail({ ok: false, status: 500, body: null }),
    ];
    for (const line of lines.slice(1)) expect(line).toMatch(/Nothing changed\.$/);
    for (const line of lines) expect(line).not.toMatch(/http|status|json|token|vault/i);
  });
});

describe('Phase I slice 2: the run function has exactly two ways in', () => {
  const source = read('supabase/functions/minds-run-placement/index.ts');

  it('the internal path needs the secret and an owner row in app_admins', () => {
    expect(source).toContain('isInternalCall(req, env("INTERNAL_FN_SECRET"))');
    expect(source).toContain('.from("app_admins").select("user_id").eq("user_id", claimed).eq("role", "owner")');
    expect(source).toContain('if (typeof claimed !== "string" || !UUID.test(claimed)) return out({ error: "An owner id is required." }, 403);');
  });

  it('a browser still goes down the owner-session path, and is refused without one', () => {
    expect(source).toContain('user = await callerUser(req);');
    expect(source).toContain('if (!user) return out({ error: "Owner authentication required." }, 401);');
    expect(source).toMatch(/if \(!internal\) \{\n\s+user = await callerUser\(req\);/);
    expect(source).toContain('automation_list_secrets');
  });

  it('the browser rule is not applied to the internal call, and no CORS header is invented for it', () => {
    expect(source).toContain('const cors = internal ? {} : corsFor(req);');
    expect(source).toContain('function reply(req: Request, body: unknown, status = 200, internal = false): Response {');
    expect(source).toContain('status: internal || cors ? status : 403');
  });

  it('the internal path cannot name an order, and the brief it carries is clipped', () => {
    expect(source).toContain('const brief = internal ? clipBrief(asRecord(body)?.brief) : "";');
    expect(source).toMatch(/flat\.length > 1200 \?/);
    // The clock never picks an order: an internal call runs the oldest waiting order, exactly like Run today.
    expect(source).toContain('const orderId = !internal && typeof requestedOrder === "string" ? requestedOrder : null;');
  });

  it('the morning clock is the only caller of that path, and it sends the owner id and the brief', () => {
    const clock = read('supabase/functions/minds-morning-clock/index.ts');
    expect(clock).toContain('`${functionsUrl}/minds-run-placement`');
    expect(clock).toContain('{ local_day: day, owner_id: ownerId, brief: briefText(brief) }');
    expect(clock).toContain('callInternal(');
    expect(clock).toContain('internalCallDetail(answer)');
  });
});
