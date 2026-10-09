import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (file: string) => readFileSync(join(process.cwd(), file), 'utf8');
const FUNCTION = read('supabase/functions/door-connection-test/index.ts');
const PAGE = read('src/admin/pages/AdminConnections.tsx');

describe('the door connection test function', () => {
  it('is owner-only: the caller must be signed in, and the owner-only list must answer', () => {
    expect(FUNCTION).toContain('callerUser(req)');
    expect(FUNCTION).toContain('"Owner authentication required."');
    expect(FUNCTION).toMatch(/userClient\.rpc\("automation_list_secrets"\)/);
    expect(FUNCTION).toContain('"Owner-only key access is required."');
  });

  it('reads saved values only on the server, through the internal Vault read', () => {
    expect(FUNCTION).toContain('sb.rpc("automation_secret_get_internal"');
    expect(FUNCTION).not.toMatch(/from\("automation_secrets"\)/);
  });

  it('accepts only a door id, and only a known door', () => {
    expect(FUNCTION).toContain('Object.keys(body).some((key) => key !== "door")');
    expect(FUNCTION).toContain('isDoorId(body.door)');
  });

  it('is rate limited per owner with its own action name', () => {
    expect(FUNCTION).toContain('p_action: "door_connection_test"');
    expect(FUNCTION).toMatch(/RATE_LIMIT = 6/);
    expect(FUNCTION).toMatch(/RATE_WINDOW_SECONDS = 600/);
  });

  it('does not send, post or write anything: it only calls the read-only test', () => {
    expect(FUNCTION).toContain('testDoorConnection(door, values, fetch)');
    expect(FUNCTION).not.toMatch(/send(Telegram|Discord|Bluesky|Mastodon|Tumblr|Blogger)\(/);
    expect(FUNCTION).not.toMatch(/minds_(save|reserve|finish)|automation_secret_(save|delete)|insert\(|update\(|upsert\(/);
  });

  it('replies only with the door, a status word and the fixed line: never a value or provider text', () => {
    expect(FUNCTION).toContain('reply(req, { door, status, message: doorTestMessage(status) })');
    expect(FUNCTION).not.toMatch(/reply\(req, \{[^}]*values/);
    expect(FUNCTION).not.toMatch(/reply\(req, \{[^}]*rawBody|reply\(req, \{[^}]*error\.message/);
  });

  it('never logs: no console calls in the function or the check module', () => {
    const checks = read('supabase/functions/_shared/doorConnectionTests.ts');
    expect(FUNCTION).not.toMatch(/console\./);
    expect(checks).not.toMatch(/console\./);
  });

  it('clears the values after the check, even when it fails', () => {
    expect(FUNCTION).toContain('finally {');
    expect(FUNCTION).toContain('delete values[name]');
  });
});

describe('the Connections page test button', () => {
  it('sends only the door id to the function, and never a saved value', () => {
    expect(PAGE).toContain("supabase.functions.invoke('door-connection-test', { body: { door: id } })");
  });

  it('shows the fixed line for the status, never the text the server sent', () => {
    expect(PAGE).toContain('DOOR_TEST_MESSAGE[testResults[id]!]');
    expect(PAGE).not.toMatch(/text: .*\bmessage\b/);
  });
});
