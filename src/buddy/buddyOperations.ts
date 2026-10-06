/**
 * Buddy's typed, allow-listed operation registry.
 *
 * Rules encoded here (and asserted in the Buddy tests):
 *   - Every operation is declared with typed arguments and an explicit kind.
 *   - No operation publishes, posts, sends, emails or touches commerce data; the
 *     registry has no publishing operation at all, and the type system forbids
 *     adding one without editing the literal below.
 *   - Free-form text is never an argument: callers pass a fixed operation id.
 *   - Previews are built only from a live server read taken immediately before
 *     they are shown, and expire quickly so a confirmation is never applied to
 *     stale state.
 */

/** Literal `false`: a publishing operation cannot be declared without changing this contract. */
export type BuddyPublishesNothing = false;

export type BuddyOperationId = 'status' | 'daily-kit' | 'help' | 'set-daily-pipeline';

export interface BuddyArgumentSpec {
  name: string;
  type: 'boolean';
  description: string;
}

export interface BuddyOperation {
  id: BuddyOperationId;
  label: string;
  kind: 'read' | 'state-change';
  /** Permission required before Buddy will preview or run it. */
  requiredPermission: string;
  /** No operation may post, publish, send or email anything. */
  publishes: BuddyPublishesNothing;
  /** True only for state changes the owner can undo with the same operation. */
  reversible: boolean;
  arguments: readonly BuddyArgumentSpec[];
  summary: string;
}

export const BUDDY_OPERATIONS: readonly BuddyOperation[] = [
  {
    id: 'status',
    label: 'Check admin status',
    kind: 'read',
    requiredPermission: 'automation.check',
    publishes: false,
    reversible: true,
    arguments: [],
    summary: 'Reads your signed-in admin identity. Nothing is changed or sent.',
  },
  {
    id: 'daily-kit',
    label: 'Open the Daily Kit',
    kind: 'read',
    requiredPermission: 'automation.check',
    publishes: false,
    reversible: true,
    arguments: [],
    summary: 'Navigates to the existing owner review surface. It performs no action itself.',
  },
  {
    id: 'help',
    label: 'Show safe commands',
    kind: 'read',
    requiredPermission: 'automation.check',
    publishes: false,
    reversible: true,
    arguments: [],
    summary: 'Lists the fixed commands Buddy accepts. Nothing is read or changed.',
  },
  {
    id: 'set-daily-pipeline',
    label: 'Pause or resume the 08:00 Lagos daily schedule',
    kind: 'state-change',
    requiredPermission: 'automation.manage',
    publishes: false,
    reversible: true,
    arguments: [{ name: 'enabled', type: 'boolean', description: 'true resumes the daily schedule, false pauses it' }],
    summary:
      'Turns the scheduled preflight/review preparation on or off. It never publishes: distribution still requires your per-item approval in the Daily Kit.',
  },
];

export function getBuddyOperation(id: string): BuddyOperation | undefined {
  return BUDDY_OPERATIONS.find((operation) => operation.id === id);
}

export type BuddyArguments = { enabled?: boolean };

export type BuddyArgumentResult =
  | { ok: true; args: BuddyArguments }
  | { ok: false; reason: 'unknown_operation' | 'invalid_arguments' };

/** Validates typed arguments against the declared spec. Extra or mistyped values are refused. */
export function validateBuddyArguments(id: string, args: unknown): BuddyArgumentResult {
  const operation = getBuddyOperation(id);
  if (!operation) return { ok: false, reason: 'unknown_operation' };
  const input = args && typeof args === 'object' && !Array.isArray(args) ? args as Record<string, unknown> : {};
  const accepted: Record<string, boolean> = {};
  for (const spec of operation.arguments) {
    const value = input[spec.name];
    if (value === undefined) return { ok: false, reason: 'invalid_arguments' };
    if (spec.type === 'boolean' && typeof value !== 'boolean') return { ok: false, reason: 'invalid_arguments' };
    accepted[spec.name] = value as boolean;
  }
  if (Object.keys(input).some((key) => !operation.arguments.some((spec) => spec.name === key))) {
    return { ok: false, reason: 'invalid_arguments' };
  }
  return { ok: true, args: accepted as BuddyArguments };
}

export type BuddyParseResult =
  | { kind: 'operation'; operationId: BuddyOperationId; args: BuddyArguments }
  | { kind: 'blocked'; category: 'external' | 'commerce' }
  | { kind: 'unsupported' };

const COMMERCE = /\b(price|pricing|product|refund|charge|payment|order|discount|stock|customer)\b/;
const EXTERNAL = /\b(publish|post|send|email|campaign|approve|reject|schedule|delete|rewrite|edit article|newsletter|tweet|share)\b/;

/** Fixed phrases for the only state-changing operation; nothing else can reach it. */
function stateChangeFromPhrase(command: string): BuddyParseResult | null {
  if (/^(pause|stop|disable) (automation|the daily schedule|daily schedule|the pipeline|pipeline)$/.test(command)) {
    return { kind: 'operation', operationId: 'set-daily-pipeline', args: { enabled: false } };
  }
  if (/^(resume|start|enable|restart) (automation|the daily schedule|daily schedule|the pipeline|pipeline)$/.test(command)) {
    return { kind: 'operation', operationId: 'set-daily-pipeline', args: { enabled: true } };
  }
  return null;
}

/**
 * Parses typed input into a fixed operation. Blocked categories are checked for
 * every phrase that is not an exact allow-listed pause/resume command, so no
 * publishing, editorial or commerce request can ever become a queue entry.
 */
export function parseBuddyCommand(input: string): BuddyParseResult {
  const command = input.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!command) return { kind: 'unsupported' };

  const stateChange = stateChangeFromPhrase(command);
  if (stateChange) return stateChange;

  if (COMMERCE.test(command)) return { kind: 'blocked', category: 'commerce' };
  if (EXTERNAL.test(command)) return { kind: 'blocked', category: 'external' };

  if (command === 'status' || command === 'check status') return { kind: 'operation', operationId: 'status', args: {} };
  if (command === 'daily kit' || command === 'open daily kit') return { kind: 'operation', operationId: 'daily-kit', args: {} };
  if (command === 'help' || command === '?') return { kind: 'operation', operationId: 'help', args: {} };
  return { kind: 'unsupported' };
}

/** A preview is only valid for a short window; a stale one must be refreshed. */
export const BUDDY_PREVIEW_MAX_AGE_MS = 120_000;

export interface BuddyLiveFlags {
  'automation.enabled'?: boolean;
  'automation.daily_pipeline'?: boolean;
}

export interface BuddyLiveState {
  adminStatus?: { email?: string | null; role?: string | null } | null;
  flags?: BuddyLiveFlags | null;
  readAt: string;
}

export interface BuddyPreview {
  operationId: BuddyOperationId;
  kind: BuddyOperation['kind'];
  title: string;
  currentSummary: string;
  nextSummary: string;
  changes: string[];
  /** Always true: no operation can publish. */
  publishesNothing: true;
  readAt: string;
}

export type BuddyPreviewResult =
  | { ok: true; preview: BuddyPreview }
  | { ok: false; reason: 'unknown_operation' | 'invalid_arguments' | 'unavailable' | 'no_change' };

function flagLabel(value: boolean): string {
  return value ? 'on' : 'off';
}

/** Builds the authoritative preview from live state only. */
export function buildBuddyPreview(
  id: string,
  args: unknown,
  live: BuddyLiveState | null,
): BuddyPreviewResult {
  const operation = getBuddyOperation(id);
  if (!operation) return { ok: false, reason: 'unknown_operation' };
  const validated = validateBuddyArguments(id, args);
  if (!validated.ok) return { ok: false, reason: 'invalid_arguments' };
  if (!live) return { ok: false, reason: 'unavailable' };

  if (operation.id === 'set-daily-pipeline') {
    const current = live.flags?.['automation.daily_pipeline'];
    if (typeof current !== 'boolean') return { ok: false, reason: 'unavailable' };
    const next = validated.args.enabled === true;
    if (current === next) return { ok: false, reason: 'no_change' };
    return {
      ok: true,
      preview: {
        operationId: operation.id,
        kind: operation.kind,
        title: operation.label,
        currentSummary: `The 08:00 Lagos daily schedule is currently ${flagLabel(current)}.`,
        nextSummary: `Confirm to turn it ${flagLabel(next)}.`,
        changes: [`08:00 Lagos daily schedule: ${flagLabel(current)} → ${flagLabel(next)}`],
        publishesNothing: true,
        readAt: live.readAt,
      },
    };
  }

  return {
    ok: true,
    preview: {
      operationId: operation.id,
      kind: operation.kind,
      title: operation.label,
      currentSummary: operation.summary,
      nextSummary: 'This is a read-only check; confirming performs no external action.',
      changes: [],
      publishesNothing: true,
      readAt: live.readAt,
    },
  };
}

/** True while a preview may still be confirmed. Never true for a future timestamp. */
export function previewIsFresh(preview: BuddyPreview | null, now: number = Date.now()): boolean {
  if (!preview) return false;
  const readAt = Date.parse(preview.readAt);
  if (!Number.isFinite(readAt)) return false;
  const age = now - readAt;
  return age >= 0 && age <= BUDDY_PREVIEW_MAX_AGE_MS;
}
