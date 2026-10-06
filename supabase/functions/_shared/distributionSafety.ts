export type DistributionFailureClass = 'quota' | 'authentication' | 'policy' | 'transient';

export interface ProviderFailureSignal {
  status?: number;
  safeCode?: string;
}

/** Classify only bounded HTTP status and internal safe codes; never inspect provider bodies. */
export function classifyDistributionFailure(signal: ProviderFailureSignal): DistributionFailureClass {
  const code = signal.safeCode;
  if (code === 'PROVIDER_QUOTA' || signal.status === 429) return 'quota';
  if (code === 'PROVIDER_AUTH' || code === 'PROVIDER_NOT_CONFIGURED' || signal.status === 401) return 'authentication';
  if (code === 'PROVIDER_REVIEW_REQUIRED' || code === 'PROVIDER_POLICY'
      || code === 'PROVIDER_UNEXPECTED' || (typeof signal.status === 'number'
        && signal.status >= 400 && signal.status < 500 && signal.status !== 408)) return 'policy';
  return 'transient';
}

/** Exponential retry window with bounded +/-25% jitter; non-transient failures are never retried. */
export function distributionBackoffMs(
  attempt: number,
  random: () => number = Math.random,
  baseMs = 30_000,
  maxMs = 60 * 60 * 1000,
): number {
  if (!Number.isInteger(attempt) || attempt < 1 || attempt > 16) throw new RangeError('attempt must be 1–16');
  if (!Number.isFinite(baseMs) || baseMs < 1 || !Number.isFinite(maxMs) || maxMs < baseMs) {
    throw new RangeError('invalid backoff bounds');
  }
  const sample = random();
  if (!Number.isFinite(sample) || sample < 0 || sample > 1) throw new RangeError('random sample must be between 0 and 1');
  const exponential = Math.min(maxMs, baseMs * (2 ** (attempt - 1)));
  return Math.min(maxMs, Math.round(exponential * (0.75 + sample * 0.5)));
}

export function canRetryDistributionFailure(
  failureClass: DistributionFailureClass,
  completedAttempts: number,
  maxAttempts = 3,
): boolean {
  return failureClass === 'transient'
    && Number.isInteger(completedAttempts)
    && completedAttempts >= 0
    && Number.isInteger(maxAttempts)
    && maxAttempts > 0
    && completedAttempts < maxAttempts;
}

export function distributionFailureMessage(
  channelLabel: string,
  failureClass: DistributionFailureClass,
): string {
  const channel = channelLabel.trim().slice(0, 80) || 'This channel';
  switch (failureClass) {
    case 'quota':
      return `${channel} is paused because its available allowance or daily safety cap is exhausted. The approved Daily Kit is still available; try again after the allowance resets.`;
    case 'authentication':
      return `${channel} is paused because its credentials were rejected or are missing. Update the key, then run a fresh read-only check. The approved Daily Kit is still available.`;
    case 'policy':
      return `${channel} is paused because the platform requires account review, permission changes, or policy attention. Resolve that with the platform before trying again. The approved Daily Kit is still available.`;
    case 'transient':
      return `${channel} had a temporary provider failure. It is backing off before another attempt; no automatic resend was made, to avoid duplicates. The approved Daily Kit is still available.`;
  }
}
