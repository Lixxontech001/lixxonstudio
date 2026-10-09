// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DOOR_IDS, DOORS } from '../../supabase/functions/_shared/doorRegistry';

type Result = { data: unknown; error: unknown };
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), can: vi.fn(() => true), invoke: vi.fn() }));
vi.mock('../lib/supabaseClient', () => ({ supabase: { rpc: mocks.rpc, functions: { invoke: mocks.invoke } } }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ can: mocks.can }) }));

import AdminConnections, {
  CONNECTIONS_EMPTY_VALUE,
  CONNECTIONS_READ_FAILED,
  CONNECTIONS_SAVE_FAILED,
  CONNECTIONS_TEST_FAILED,
  fieldStatus,
  savedNamesFrom,
  stateLabel,
} from '../admin/pages/AdminConnections';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const OWNER_FUNCTIONS = ['automation_list_secrets', 'automation_secret_save', 'automation_secret_delete'];
const ALL_FIELDS = DOOR_IDS.flatMap((id) => DOORS[id].fields);

let host: HTMLDivElement;
let root: Root | null = null;
let listRows: Array<{ name: string; configured: boolean }>;
let listError: boolean;
let saveError: boolean;
let removeError: boolean;

function answer(name: string, args?: Record<string, unknown>): Result {
  if (name === 'automation_list_secrets') {
    return listError ? { data: null, error: { message: 'boom' } } : { data: listRows, error: null };
  }
  if (name === 'automation_secret_save') {
    return saveError ? { data: null, error: { message: 'could not save' } } : { data: { ok: true }, error: null };
  }
  if (name === 'automation_secret_delete') {
    return removeError ? { data: null, error: { message: 'could not remove' } } : { data: true, error: null };
  }
  return { data: null, error: { message: `unexpected ${name} ${JSON.stringify(args ?? {})}` } };
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function render() {
  root = createRoot(host);
  await act(async () => {
    root!.render(<AdminConnections />);
  });
  await flush();
}

function text(): string {
  return host.textContent ?? '';
}

function field(name: string): HTMLInputElement {
  const input = host.querySelector<HTMLInputElement>(`#field-${name}`);
  if (!input) throw new Error(`no input for ${name}`);
  return input;
}

function saveButtonFor(name: string): HTMLButtonElement {
  const item = field(name).closest('li');
  const button = [...(item?.querySelectorAll('button') ?? [])].find((candidate) => candidate.textContent?.trim() === 'Save');
  if (!button) throw new Error(`no Save for ${name}`);
  return button as HTMLButtonElement;
}

async function typeInto(name: string, value: string) {
  const input = field(name);
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function click(button: HTMLButtonElement) {
  await act(async () => {
    button.click();
  });
  await flush();
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  listRows = [];
  listError = false;
  saveError = false;
  removeError = false;
  mocks.can.mockReset();
  mocks.can.mockReturnValue(true);
  mocks.rpc.mockReset();
  mocks.rpc.mockImplementation(async (name: string, args?: Record<string, unknown>) => answer(name, args));
  mocks.invoke.mockReset();
  mocks.invoke.mockResolvedValue({ data: { door: 'telegram', status: 'connected', message: 'x' }, error: null });
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  host.remove();
  vi.restoreAllMocks();
});

describe('the Connections page shows the six doors and their state', () => {
  it('lists the six doors by name, and nothing else as a door', async () => {
    await render();
    const headings = [...host.querySelectorAll('h2')].map((heading) => heading.textContent);
    expect(headings).toEqual(DOOR_IDS.map((id) => DOORS[id].label));
  });

  it('with nothing saved: every door is Not connected, and every field says Not saved yet', async () => {
    await render();
    expect(text().split(stateLabel('not_connected')).length - 1).toBe(DOOR_IDS.length);
    expect(text().split(fieldStatus(false)).length - 1).toBe(ALL_FIELDS.length);
  });

  it('a saved value shows Saved, and a door with only some fields saved is Partly connected', async () => {
    listRows = [
      { name: 'telegram_bot_token', configured: true },
      { name: 'telegram_chat_id', configured: true },
      { name: 'bluesky_handle', configured: true },
    ];
    await render();
    expect(text()).toContain(stateLabel('connected'));
    expect(text()).toContain(stateLabel('partly'));
    const statuses = [...host.querySelectorAll('span')].filter((span) => span.textContent === fieldStatus(true));
    expect(statuses).toHaveLength(3);
  });

  it('a saved value is never shown again: every input starts empty', async () => {
    listRows = ALL_FIELDS.map((item) => ({ name: item.secretName, configured: true }));
    await render();
    for (const item of ALL_FIELDS) {
      expect(field(item.secretName).value, item.secretName).toBe('');
    }
    expect(text()).toContain(stateLabel('connected'));
  });

  it('secret fields are hidden inputs, and names or IDs are plain inputs', async () => {
    await render();
    for (const item of ALL_FIELDS) {
      expect(field(item.secretName).type, item.secretName).toBe(item.kind === 'secret' ? 'password' : 'text');
    }
  });

  it('says plainly that the four gated channels are manual and that nothing is posted from this page', async () => {
    await render();
    expect(text()).toContain('Instagram, TikTok, Facebook and Pinterest stay manual.');
    expect(text()).toContain('Nothing is posted from this page.');
  });

  it('a read failure says so plainly', async () => {
    listError = true;
    await render();
    expect(text()).toContain(CONNECTIONS_READ_FAILED);
  });

  it('a person without the owner permission sees one note and no secret is read', async () => {
    mocks.can.mockReturnValue(false);
    await render();
    expect(text()).toContain('Only the owner can see Connections.');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe('saving a value', () => {
  it('sends the trimmed value to the owner save function, then shows it saved and reads again', async () => {
    await render();
    await typeInto('bluesky_handle', '  name.bsky.social  ');
    await click(saveButtonFor('bluesky_handle'));
    expect(mocks.rpc).toHaveBeenCalledWith('automation_secret_save', {
      p_secret_name: 'bluesky_handle',
      p_secret_value: 'name.bsky.social',
    });
    expect(text()).toContain('Handle saved.');
    expect(field('bluesky_handle').value).toBe('');
    expect(mocks.rpc.mock.calls.filter(([name]) => name === 'automation_list_secrets').length).toBeGreaterThanOrEqual(2);
  });

  it('an empty value is never sent', async () => {
    await render();
    await click(saveButtonFor('discord_webhook_url'));
    expect(mocks.rpc.mock.calls.some(([name]) => name === 'automation_secret_save')).toBe(false);
    expect(text()).toContain(CONNECTIONS_EMPTY_VALUE);
  });

  it('a failed save says so, and the typed value is not shown back', async () => {
    saveError = true;
    await render();
    await typeInto('discord_webhook_url', 'https://discord.example/hook-SECRET-VALUE');
    await click(saveButtonFor('discord_webhook_url'));
    expect(text()).toContain(CONNECTIONS_SAVE_FAILED);
    expect(text()).not.toContain('SECRET-VALUE');
  });
});

describe('removing a value', () => {
  it('asks first, then removes it when the owner says yes', async () => {
    listRows = [{ name: 'telegram_bot_token', configured: true }];
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await render();
    const item = field('telegram_bot_token').closest('li');
    const remove = [...(item?.querySelectorAll('button') ?? [])].find((candidate) => candidate.textContent?.trim() === 'Remove') as HTMLButtonElement;
    await click(remove);
    expect(mocks.rpc).toHaveBeenCalledWith('automation_secret_delete', { p_secret_name: 'telegram_bot_token' });
  });

  it('does nothing when the owner says no', async () => {
    listRows = [{ name: 'telegram_bot_token', configured: true }];
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    await render();
    const item = field('telegram_bot_token').closest('li');
    const remove = [...(item?.querySelectorAll('button') ?? [])].find((candidate) => candidate.textContent?.trim() === 'Remove') as HTMLButtonElement;
    await click(remove);
    expect(mocks.rpc.mock.calls.some(([name]) => name === 'automation_secret_delete')).toBe(false);
  });
});

describe('the page only uses the owner functions the Keys page already uses', () => {
  it('after saving and removing, every call is one of the three owner functions', async () => {
    listRows = [{ name: 'telegram_bot_token', configured: true }];
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await render();
    await typeInto('telegram_chat_id', '-100123');
    await click(saveButtonFor('telegram_chat_id'));
    const item = field('telegram_bot_token').closest('li');
    const remove = [...(item?.querySelectorAll('button') ?? [])].find((candidate) => candidate.textContent?.trim() === 'Remove') as HTMLButtonElement;
    await click(remove);
    const names = new Set(mocks.rpc.mock.calls.map(([name]) => name));
    expect(names.size).toBeGreaterThan(0);
    for (const name of names) expect(OWNER_FUNCTIONS).toContain(name);
  });
});

describe('the small helpers', () => {
  it('savedNamesFrom counts only configured rows, and returns null for a non-list', () => {
    expect([...(savedNamesFrom([{ name: 'a', configured: true }, { name: 'b', configured: false }, null, 'x']) ?? [])]).toEqual(['a']);
    expect(savedNamesFrom({ not: 'a list' })).toBeNull();
  });

  it('the state and field words are the plain ones', () => {
    expect(stateLabel('connected')).toBe('Connected');
    expect(stateLabel('partly')).toBe('Partly connected');
    expect(stateLabel('not_connected')).toBe('Not connected');
    expect(fieldStatus(true)).toBe('Saved');
    expect(fieldStatus(false)).toBe('Not saved yet');
  });
});

function doorCard(id: string): HTMLElement {
  const card = host.querySelector<HTMLElement>(`section[aria-labelledby="door-${id}"]`);
  if (!card) throw new Error(`no card for ${id}`);
  return card;
}

function testButtonFor(id: string): HTMLButtonElement {
  const button = [...doorCard(id).querySelectorAll('button')].find((candidate) => candidate.textContent?.trim() === 'Test connection');
  if (!button) throw new Error(`no Test connection for ${id}`);
  return button as HTMLButtonElement;
}

const TELEGRAM_SAVED = [
  { name: 'telegram_bot_token', configured: true },
  { name: 'telegram_chat_id', configured: true },
];

describe('testing a door connection', () => {
  it('the Test button is disabled until every field of the door is saved', async () => {
    listRows = [{ name: 'telegram_bot_token', configured: true }];
    await render();
    expect(testButtonFor('telegram').disabled).toBe(true);
    expect(doorCard('telegram').textContent).toContain('Save every field for this door first.');
  });

  it('with every field saved: sends only the door id, then shows the one fixed line', async () => {
    listRows = TELEGRAM_SAVED;
    mocks.invoke.mockResolvedValue({ data: { door: 'telegram', status: 'connected', message: 'SERVER TEXT' }, error: null });
    await render();
    expect(testButtonFor('telegram').disabled).toBe(false);
    await click(testButtonFor('telegram'));
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.invoke).toHaveBeenCalledWith('door-connection-test', { body: { door: 'telegram' } });
    expect(doorCard('telegram').querySelector('[role="status"]')?.textContent).toBe('Connected. The door answered. Nothing was posted.');
    expect(text()).not.toContain('SERVER TEXT');
  });

  it('an invalid answer shows the plain refusal', async () => {
    listRows = TELEGRAM_SAVED;
    mocks.invoke.mockResolvedValue({ data: { door: 'telegram', status: 'invalid', message: 'x' }, error: null });
    await render();
    await click(testButtonFor('telegram'));
    expect(doorCard('telegram').querySelector('[role="status"]')?.textContent).toBe('The door did not accept these details.');
  });

  it('a failed call shows the test-failed line, and nothing is shown as a result', async () => {
    listRows = TELEGRAM_SAVED;
    mocks.invoke.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await render();
    await click(testButtonFor('telegram'));
    expect(text()).toContain(CONNECTIONS_TEST_FAILED);
    expect(doorCard('telegram').querySelector('[role="status"]')?.textContent).toBe('The door did not answer. Try later.');
  });

  it('an unknown status from the server is never shown as text', async () => {
    listRows = TELEGRAM_SAVED;
    mocks.invoke.mockResolvedValue({ data: { status: 'toString' }, error: null });
    await render();
    await click(testButtonFor('telegram'));
    expect(text()).toContain(CONNECTIONS_TEST_FAILED);
    expect(text()).not.toContain('[object Function]');
  });

  it('the test never reads a saved value into the page, and never saves or removes one', async () => {
    listRows = TELEGRAM_SAVED;
    await render();
    await click(testButtonFor('telegram'));
    const names = new Set(mocks.rpc.mock.calls.map(([name]) => name));
    expect(names.has('automation_secret_get_internal')).toBe(false);
    expect(names.has('automation_secret_save')).toBe(false);
    expect(names.has('automation_secret_delete')).toBe(false);
  });
});
