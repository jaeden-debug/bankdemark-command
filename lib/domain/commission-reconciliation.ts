export const COMMISSION_ANOMALIES = [
  'UNKNOWN_BOOKING',
  'AMOUNT_MISMATCH',
  'DUPLICATE_PAYMENT',
  'DUPLICATE_REPORT_ENTRY',
  'WRONG_CURRENCY',
  'REPORT_TOTAL_MISMATCH',
  'LUMP_SUM_MISMATCH',
] as const;

export type CommissionAnomaly = (typeof COMMISSION_ANOMALIES)[number];

export interface ReconciliationBooking {
  id: string;
  reference: string | null;
  expectedMinor: number;
  receivedMinor: number;
  currency: string;
}

export interface ExtractedCommissionRow {
  bookingReference: string;
  amountMinor: number;
  currency: string;
  confidence?: number | null;
}

export interface ReconciledCommissionRow extends ExtractedCommissionRow {
  rowPosition: number;
  normalizedReference: string;
  matchedBookingId: string | null;
  expectedOutstandingMinor: number | null;
  status: 'matched' | 'needs_attention';
  anomalyCode: CommissionAnomaly | null;
  anomalyDetail: string | null;
}

export interface CommissionReconciliation {
  rows: ReconciledCommissionRow[];
  extractedTotalMinor: number;
  reportAnomaly: { code: 'REPORT_TOTAL_MISMATCH'; detail: string } | null;
}

/** Exact matching only: trim, uppercase, and collapse ordinary whitespace. */
export function normalizeBookingReference(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toUpperCase();
}

export function reconcileCommissionRows(input: {
  bookings: readonly ReconciliationBooking[];
  rows: readonly ExtractedCommissionRow[];
  printedTotalMinor: number | null;
}): CommissionReconciliation {
  const bookingByReference = new Map<string, ReconciliationBooking>();
  for (const booking of input.bookings) {
    if (booking.reference) bookingByReference.set(normalizeBookingReference(booking.reference), booking);
  }

  const counts = new Map<string, number>();
  for (const row of input.rows) {
    const ref = normalizeBookingReference(row.bookingReference);
    counts.set(ref, (counts.get(ref) ?? 0) + 1);
  }

  const rows = input.rows.map((row, index): ReconciledCommissionRow => {
    const normalizedReference = normalizeBookingReference(row.bookingReference);
    const base = {
      ...row,
      rowPosition: index + 1,
      normalizedReference,
      matchedBookingId: null,
      expectedOutstandingMinor: null,
    };

    if ((counts.get(normalizedReference) ?? 0) > 1) {
      return attention(base, 'DUPLICATE_REPORT_ENTRY', `Booking ${normalizedReference} appears more than once in this report.`);
    }

    const booking = bookingByReference.get(normalizedReference);
    if (!booking) {
      return attention(base, 'UNKNOWN_BOOKING', `Booking ${normalizedReference || '(blank)'} was not found.`);
    }

    const withBooking = {
      ...base,
      matchedBookingId: booking.id,
      expectedOutstandingMinor: Math.max(0, booking.expectedMinor - booking.receivedMinor),
    };

    if (booking.currency !== row.currency) {
      return attention(withBooking, 'WRONG_CURRENCY', `Booking uses ${booking.currency}; report row uses ${row.currency}.`);
    }
    if (booking.expectedMinor > 0 && booking.receivedMinor >= booking.expectedMinor) {
      return attention(withBooking, 'DUPLICATE_PAYMENT', `Booking ${normalizedReference} is already fully paid.`);
    }
    if (row.amountMinor !== withBooking.expectedOutstandingMinor) {
      return attention(
        withBooking,
        'AMOUNT_MISMATCH',
        `Expected ${withBooking.expectedOutstandingMinor} minor units; report shows ${row.amountMinor}.`
      );
    }

    return { ...withBooking, status: 'matched', anomalyCode: null, anomalyDetail: null };
  });

  const extractedTotalMinor = input.rows.reduce((sum, row) => sum + row.amountMinor, 0);
  const reportAnomaly =
    input.printedTotalMinor !== null && input.printedTotalMinor !== extractedTotalMinor
      ? {
          code: 'REPORT_TOTAL_MISMATCH' as const,
          detail: `Printed total is ${input.printedTotalMinor} minor units; extracted rows total ${extractedTotalMinor}.`,
        }
      : null;

  return { rows, extractedTotalMinor, reportAnomaly };
}

function attention<T extends object>(
  row: T,
  anomalyCode: CommissionAnomaly,
  anomalyDetail: string
): T & { status: 'needs_attention'; anomalyCode: CommissionAnomaly; anomalyDetail: string } {
  return { ...row, status: 'needs_attention', anomalyCode, anomalyDetail };
}
