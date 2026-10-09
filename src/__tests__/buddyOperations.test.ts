/**
 * Buddy's authoritative preview contract: previews come from a live read, expire
 * quickly, refuse when there is nothing to change, and can never claim to publish.
 */
import { describe, expect, it } from 'vitest';
import {
  BUDDY_PREVIEW_MAX_AGE_MS,
  buildBuddyPreview,
  getBuddyOperation,
  previewIsFresh,
} from '../buddy/buddyOperations';

const READ_AT = '2026-10-06T12:00:00.000Z';

describe('Buddy live preview', () => {
  it('describes the exact state change from live values only', () => {
    const result = buildBuddyPreview('set-daily-pipeline', { enabled: false }, {
      readAt: READ_AT,
      flags: { 'automation.enabled': true, 'automation.daily_pipeline': true },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview.changes).toEqual(['08:00 daily schedule: on → off']);
    expect(result.preview.currentSummary).toContain('currently on');
    expect(result.preview.nextSummary).toContain('turn it off');
    expect(result.preview.publishesNothing).toBe(true);
    expect(result.preview.kind).toBe('state-change');
    expect(result.preview.readAt).toBe(READ_AT);
  });

  it('refuses when the live value is missing, unknown or already at the requested state', () => {
    expect(buildBuddyPreview('set-daily-pipeline', { enabled: false }, { readAt: READ_AT, flags: {} }))
      .toEqual({ ok: false, reason: 'unavailable' });
    expect(buildBuddyPreview('set-daily-pipeline', { enabled: false }, null))
      .toEqual({ ok: false, reason: 'unavailable' });
    expect(buildBuddyPreview('set-daily-pipeline', { enabled: false }, {
      readAt: READ_AT, flags: { 'automation.daily_pipeline': false },
    })).toEqual({ ok: false, reason: 'no_change' });
    expect(buildBuddyPreview('set-daily-pipeline', { enabled: 'nope' }, { readAt: READ_AT }))
      .toEqual({ ok: false, reason: 'invalid_arguments' });
    expect(buildBuddyPreview('publish-article', {}, { readAt: READ_AT }))
      .toEqual({ ok: false, reason: 'unknown_operation' });
  });

  it('labels read-only operations as performing no external action', () => {
    const result = buildBuddyPreview('status', {}, { readAt: READ_AT });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview.changes).toEqual([]);
    expect(result.preview.nextSummary).toContain('no external action');
    expect(result.preview.publishesNothing).toBe(true);
  });

  it('expires a preview so a stale confirmation is refused', () => {
    const preview = {
      operationId: 'set-daily-pipeline' as const,
      kind: 'state-change' as const,
      title: 'x', currentSummary: 'x', nextSummary: 'x', changes: [], publishesNothing: true as const,
      readAt: READ_AT,
    };
    const readAtMs = Date.parse(READ_AT);
    expect(previewIsFresh(preview, readAtMs)).toBe(true);
    expect(previewIsFresh(preview, readAtMs + BUDDY_PREVIEW_MAX_AGE_MS)).toBe(true);
    expect(previewIsFresh(preview, readAtMs + BUDDY_PREVIEW_MAX_AGE_MS + 1)).toBe(false);
    // A timestamp in the future cannot be trusted either.
    expect(previewIsFresh(preview, readAtMs - 1)).toBe(false);
    expect(previewIsFresh(preview, readAtMs + 1_000_000)).toBe(false);
    expect(previewIsFresh(null)).toBe(false);
  });

  it('keeps the state-changing operation reversible and permission-gated', () => {
    const operation = getBuddyOperation('set-daily-pipeline');
    expect(operation).toMatchObject({
      kind: 'state-change',
      publishes: false,
      reversible: true,
      requiredPermission: 'automation.manage',
    });
    expect(operation?.arguments.map((spec) => spec.name)).toEqual(['enabled']);
  });
});
