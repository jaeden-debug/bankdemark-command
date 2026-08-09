import { describe, expect, it } from 'vitest';
import { reconcileCommissionRows } from '@/lib/domain/commission-reconciliation';

const bookings = [
  { id: 'a', reference: 'ABC123', expectedMinor: 42500, receivedMinor: 0, currency: 'CAD' },
  { id: 'b', reference: 'ABC124', expectedMinor: 61500, receivedMinor: 0, currency: 'CAD' },
  { id: 'c', reference: 'ABC125', expectedMinor: 29000, receivedMinor: 0, currency: 'CAD' },
];

describe('commission report reconciliation', () => {
  it('matches the golden report and leaves omitted known bookings untouched', () => {
    const result = reconcileCommissionRows({ bookings, printedTotalMinor: 131500, rows: [
      { bookingReference: ' abc123 ', amountMinor: 42500, currency: 'CAD' },
      { bookingReference: 'ABC125', amountMinor: 29000, currency: 'CAD' },
      { bookingReference: 'ABC130', amountMinor: 60000, currency: 'CAD' },
    ] });
    expect(result.rows.map((r) => [r.normalizedReference, r.status, r.anomalyCode])).toEqual([
      ['ABC123', 'matched', null], ['ABC125', 'matched', null], ['ABC130', 'needs_attention', 'UNKNOWN_BOOKING'],
    ]);
    expect(result.extractedTotalMinor).toBe(131500);
    expect(result.reportAnomaly).toBeNull();
    expect(result.rows.reduce((sum, row) => sum + (row.status === 'matched' ? row.amountMinor : 0), 0)).toBe(71500);
    expect(bookings.find((b) => b.reference === 'ABC124')?.receivedMinor).toBe(0);
  });

  it.each([
    ['AMOUNT_MISMATCH', [{ bookingReference: 'ABC123', amountMinor: 39000, currency: 'CAD' }], bookings],
    ['DUPLICATE_REPORT_ENTRY', [{ bookingReference: 'ABC123', amountMinor: 42500, currency: 'CAD' }, { bookingReference: 'abc123', amountMinor: 42500, currency: 'CAD' }], bookings],
    ['DUPLICATE_PAYMENT', [{ bookingReference: 'ABC123', amountMinor: 42500, currency: 'CAD' }], [{ ...bookings[0], receivedMinor: 42500 }]],
    ['WRONG_CURRENCY', [{ bookingReference: 'ABC123', amountMinor: 42500, currency: 'USD' }], bookings],
    ['UNKNOWN_BOOKING', [{ bookingReference: 'CROSS-BUSINESS', amountMinor: 42500, currency: 'CAD' }], bookings],
  ] as const)('flags %s without making a financial decision', (code, rows, available) => {
    const result = reconcileCommissionRows({ bookings: available, rows, printedTotalMinor: null });
    expect(result.rows[0].status).toBe('needs_attention');
    expect(result.rows[0].anomalyCode).toBe(code);
  });

  it('flags a printed total mismatch independently of otherwise valid rows', () => {
    const result = reconcileCommissionRows({ bookings, printedTotalMinor: 40000, rows: [
      { bookingReference: 'ABC123', amountMinor: 42500, currency: 'CAD' },
    ] });
    expect(result.rows[0].status).toBe('matched');
    expect(result.reportAnomaly?.code).toBe('REPORT_TOTAL_MISMATCH');
  });
});
