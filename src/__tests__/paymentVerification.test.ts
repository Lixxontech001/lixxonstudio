import { describe, expect, it } from 'vitest';
import {
  checkFlutterwaveTransaction,
  normalizeFlutterwaveTransactionId,
  paymentReferenceMatches,
  timingSafeSecretEqual,
  type FlutterwaveTransaction,
} from '../lib/paymentVerification';

const order = { orderNumber: 'LXX-ABC123-45DEF0', amount: 25.5, currency: 'USD' };
const transaction: FlutterwaveTransaction = {
  id: 81726354,
  status: 'successful',
  tx_ref: order.orderNumber,
  amount: '25.50',
  currency: 'usd',
};

describe('Flutterwave payment verification', () => {
  it('accepts a verified transaction matching the server order and normalizes the currency', () => {
    expect(checkFlutterwaveTransaction(order, transaction, '81726354')).toEqual({
      ok: true,
      transactionId: '81726354',
      amount: 25.5,
      currency: 'USD',
    });
  });

  it('rejects an unverifiable, missing, or malformed transaction ID', () => {
    expect(checkFlutterwaveTransaction(order, null, '81726354')).toEqual({ ok: false, reason: 'transaction_id_invalid' });
    expect(normalizeFlutterwaveTransactionId('  ')).toBeNull();
    expect(normalizeFlutterwaveTransactionId('1'.repeat(129))).toBeNull();
    expect(normalizeFlutterwaveTransactionId('81726354?order=other')).toBeNull();
  });

  it('rejects provider responses for a transaction other than the requested ID', () => {
    expect(checkFlutterwaveTransaction(order, { ...transaction, id: 111 }, '81726354'))
      .toEqual({ ok: false, reason: 'transaction_id_invalid' });
  });

  it('rejects a transaction that has not completed successfully', () => {
    expect(checkFlutterwaveTransaction(order, { ...transaction, status: 'cancelled' }, '81726354'))
      .toEqual({ ok: false, reason: 'transaction_not_successful' });
  });

  it('rejects transaction-reference mismatches', () => {
    expect(checkFlutterwaveTransaction(order, { ...transaction, tx_ref: 'another-order' }, '81726354'))
      .toEqual({ ok: false, reason: 'reference_mismatch' });
  });

  it('rejects amount mismatches, non-finite amounts, and amounts outside the one-cent tolerance', () => {
    expect(checkFlutterwaveTransaction(order, { ...transaction, amount: '25.48' }, '81726354'))
      .toEqual({ ok: false, reason: 'amount_mismatch' });
    expect(checkFlutterwaveTransaction(order, { ...transaction, amount: 'NaN' }, '81726354'))
      .toEqual({ ok: false, reason: 'amount_mismatch' });
  });

  it('rejects currency mismatches and missing currency', () => {
    expect(checkFlutterwaveTransaction(order, { ...transaction, currency: 'NGN' }, '81726354'))
      .toEqual({ ok: false, reason: 'currency_mismatch' });
    expect(checkFlutterwaveTransaction(order, { ...transaction, currency: undefined }, '81726354'))
      .toEqual({ ok: false, reason: 'currency_mismatch' });
  });

  it('uses the requested transaction ID only when Flutterwave omits its ID', () => {
    const result = checkFlutterwaveTransaction(order, { ...transaction, id: undefined }, '81726354');
    expect(result).toMatchObject({ ok: true, transactionId: '81726354' });
  });
});

describe('paid-callback reference matching', () => {
  it('only accepts a valid exact match with the stored transaction reference', () => {
    expect(paymentReferenceMatches('81726354', 81726354)).toBe(true);
    expect(paymentReferenceMatches(null, '81726354')).toBe(false);
    expect(paymentReferenceMatches('81726354', '81726355')).toBe(false);
    expect(paymentReferenceMatches('81726354', '81726354&redirect=1')).toBe(false);
  });
});

describe('Flutterwave webhook signature comparison', () => {
  it('accepts only exact secret values and rejects unequal lengths', () => {
    expect(timingSafeSecretEqual('hook-secret-123', 'hook-secret-123')).toBe(true);
    expect(timingSafeSecretEqual('hook-secret-12X', 'hook-secret-123')).toBe(false);
    expect(timingSafeSecretEqual('short', 'much-longer-secret')).toBe(false);
    expect(timingSafeSecretEqual('', '')).toBe(true);
  });
});
