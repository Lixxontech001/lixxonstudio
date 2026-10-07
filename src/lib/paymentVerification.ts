export interface PaymentOrderReference {
  orderNumber: string;
  amount: number;
  currency: string;
}

export interface FlutterwaveTransaction {
  id?: string | number;
  status?: unknown;
  tx_ref?: unknown;
  amount?: string | number;
  currency?: unknown;
}

export type PaymentCheckFailure =
  | 'transaction_id_invalid'
  | 'transaction_not_successful'
  | 'reference_mismatch'
  | 'amount_mismatch'
  | 'currency_mismatch';

export type PaymentCheckResult =
  | { ok: true; transactionId: string; amount: number; currency: string }
  | { ok: false; reason: PaymentCheckFailure };

export function normalizeFlutterwaveTransactionId(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const transactionId = String(value).trim();
  return /^[A-Za-z0-9._:-]{1,128}$/.test(transactionId) ? transactionId : null;
}

export function paymentReferenceMatches(storedReference: unknown, suppliedTransactionId: unknown): boolean {
  const stored = normalizeFlutterwaveTransactionId(storedReference);
  const supplied = normalizeFlutterwaveTransactionId(suppliedTransactionId);
  return stored !== null && supplied !== null && stored === supplied;
}

/** Compare a live Flutterwave verification response with the server-stored order. */
export function checkFlutterwaveTransaction(
  order: PaymentOrderReference,
  transaction: FlutterwaveTransaction | null,
  requestedTransactionId: unknown,
): PaymentCheckResult {
  const requestedId = normalizeFlutterwaveTransactionId(requestedTransactionId);
  if (!requestedId || !transaction) return { ok: false, reason: 'transaction_id_invalid' };
  if (transaction.status !== 'successful') return { ok: false, reason: 'transaction_not_successful' };
  if (typeof transaction.tx_ref !== 'string' || transaction.tx_ref !== order.orderNumber) {
    return { ok: false, reason: 'reference_mismatch' };
  }

  const actualAmount = typeof transaction.amount === 'number'
    ? transaction.amount
    : typeof transaction.amount === 'string' && transaction.amount.trim() !== ''
      ? Number(transaction.amount)
      : Number.NaN;
  const expectedAmount = Number(order.amount);
  if (!Number.isFinite(actualAmount) || !Number.isFinite(expectedAmount)
      || Math.abs(actualAmount - expectedAmount) > 0.009) {
    return { ok: false, reason: 'amount_mismatch' };
  }

  if (typeof transaction.currency !== 'string'
      || transaction.currency.trim().toUpperCase() !== order.currency.trim().toUpperCase()) {
    return { ok: false, reason: 'currency_mismatch' };
  }

  const providerId = normalizeFlutterwaveTransactionId(transaction.id);
  if (transaction.id !== undefined && transaction.id !== null && (!providerId || providerId !== requestedId)) {
    return { ok: false, reason: 'transaction_id_invalid' };
  }
  const verifiedId = providerId || requestedId;
  return { ok: true, transactionId: verifiedId, amount: actualAmount, currency: transaction.currency.trim().toUpperCase() };
}

/** Constant-time comparison for webhook secrets, including unequal-length values. */
export function timingSafeSecretEqual(received: string, expected: string): boolean {
  const left = new TextEncoder().encode(received);
  const right = new TextEncoder().encode(expected);
  const maxLength = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < maxLength; index += 1) {
    difference |= (left[index] || 0) ^ (right[index] || 0);
  }
  return difference === 0;
}
