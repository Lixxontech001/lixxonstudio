import { describe, expect, it } from 'vitest';
import {
  canRetryDistributionFailure,
  classifyDistributionFailure,
  distributionBackoffMs,
  distributionFailureMessage,
} from '../../supabase/functions/_shared/distributionSafety';

describe('distribution safety policy', () => {
  it('classifies only safe status and error codes', () => {
    expect(classifyDistributionFailure({ status: 429 })).toBe('quota');
    expect(classifyDistributionFailure({ safeCode: 'PROVIDER_AUTH' })).toBe('authentication');
    expect(classifyDistributionFailure({ status: 403 })).toBe('policy');
    expect(classifyDistributionFailure({ safeCode: 'PROVIDER_UNAVAILABLE' })).toBe('transient');
    expect(classifyDistributionFailure({ status: 503 })).toBe('transient');
    expect(classifyDistributionFailure({ safeCode: 'private-provider-message' })).toBe('transient');
  });

  it('applies exponential backoff with bounded jitter and a hard cap', () => {
    expect(distributionBackoffMs(1, () => 0)).toBe(22_500);
    expect(distributionBackoffMs(1, () => 1)).toBe(37_500);
    expect(distributionBackoffMs(2, () => 0.5)).toBe(60_000);
    expect(distributionBackoffMs(16, () => 1)).toBe(3_600_000);
    expect(() => distributionBackoffMs(0)).toThrow(RangeError);
    expect(() => distributionBackoffMs(1, () => 2)).toThrow(RangeError);
  });

  it('retries only transient failures and bounds retry attempts', () => {
    expect(canRetryDistributionFailure('transient', 0)).toBe(true);
    expect(canRetryDistributionFailure('transient', 2)).toBe(true);
    expect(canRetryDistributionFailure('transient', 3)).toBe(false);
    expect(canRetryDistributionFailure('quota', 0)).toBe(false);
    expect(canRetryDistributionFailure('authentication', 0)).toBe(false);
    expect(canRetryDistributionFailure('policy', 0)).toBe(false);
  });

  it('produces plain-English channel alerts without provider data', () => {
    const message = distributionFailureMessage('Telegram', 'authentication');
    expect(message).toContain('credentials were rejected or are missing');
    expect(message).toContain('Daily Kit is still available');
    expect(message).not.toContain('token');
  });
});
