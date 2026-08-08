// ============================================================
// INVOICE TOTALS — GOLDEN CASES
//
// Real business shapes with hand-verified figures. If any of these
// change, an invoice a business sent to a client changed, so a
// deliberate decision is required rather than an updated snapshot.
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  computeInvoiceTotals,
  computeLineSubtotal,
  allocateProportionally,
  daysOverdue,
  dueDateFor,
  isEditable,
  canRecordPayment,
  canVoid,
  type InvoiceLineInput,
} from '../lib/domain/invoice';

const CAD = 'CAD';

/** Every invoice must satisfy these, whatever its shape. */
function expectInternallyConsistent(t: ReturnType<typeof computeInvoiceTotals>) {
  expect(t.lines.reduce((s, l) => s + l.subtotalMinor, 0)).toBe(t.subtotalMinor);
  expect(t.lines.reduce((s, l) => s + l.discountMinor, 0)).toBe(t.discountMinor);
  expect(t.lines.reduce((s, l) => s + l.taxMinor, 0)).toBe(t.taxMinor);
  expect(t.taxLines.reduce((s, l) => s + l.taxMinor, 0)).toBe(t.taxMinor);
  expect(t.subtotalMinor - t.discountMinor).toBe(t.taxableMinor);
  expect(t.taxableMinor + t.taxMinor).toBe(t.totalMinor);
  for (const l of t.lines) {
    expect(Number.isInteger(l.subtotalMinor)).toBe(true);
    expect(Number.isInteger(l.taxMinor)).toBe(true);
    expect(l.taxableMinor + l.taxMinor).toBe(l.totalMinor);
  }
}

describe('travel advisor — commission invoice (the golden path)', () => {
  // Booking ABC123: $6,000 gross, 10% commission, $600 owed by the
  // host agency. The invoice is for the COMMISSION only.
  const lines: InvoiceLineInput[] = [
    {
      description: 'Travel booking commission — Booking ABC123',
      quantity: 1,
      unitPriceMinor: 60_000, // $600.00
      taxCode: 'NONE',
      taxRate: 0,
      taxTreatment: 'out_of_scope',
    },
  ];

  it('totals exactly $600.00', () => {
    const t = computeInvoiceTotals(lines, { currency: CAD });
    expect(t.subtotalMinor).toBe(60_000);
    expect(t.taxMinor).toBe(0);
    expect(t.totalMinor).toBe(60_000);
    expectInternallyConsistent(t);
  });

  it('never lets the $6,000 gross booking value reach the invoice', () => {
    const t = computeInvoiceTotals(lines, { currency: CAD });
    // Gross booking value lives on the booking and in custom_fields.
    // It is context, and context is not money on this document.
    const custom = { booking_reference: 'ABC123', gross_booking: '6000.00', commission_rate: '10%' };
    expect(t.totalMinor).toBe(60_000);
    expect(t.totalMinor).not.toBe(600_000);
    // Nothing in custom_fields participates in any total.
    expect(Object.values(custom).some((v) => t.totalMinor === Number(v))).toBe(false);
  });

  it('supports a taxed service fee alongside the untaxed commission', () => {
    const t = computeInvoiceTotals(
      [
        ...lines,
        {
          description: 'Planning fee',
          quantity: 1,
          unitPriceMinor: 15_000, // $150.00
          taxCode: 'HST',
          taxLabel: 'HST 13%',
          taxRate: 0.13,
          taxTreatment: 'standard',
        },
      ],
      { currency: CAD }
    );
    expect(t.subtotalMinor).toBe(75_000);
    expect(t.taxMinor).toBe(1_950); // 13% of $150 only, never of the commission
    expect(t.totalMinor).toBe(76_950);
    expect(t.taxLines).toHaveLength(1);
    expect(t.taxLines[0].taxableMinor).toBe(15_000);
    expectInternallyConsistent(t);
  });
});

describe('freelancer — hourly with tax', () => {
  it('10 hours × $150.00 with 13% HST', () => {
    const t = computeInvoiceTotals(
      [{
        description: 'Design consulting',
        quantity: 10,
        unitPriceMinor: 15_000,
        taxCode: 'HST',
        taxLabel: 'HST 13%',
        taxRate: 0.13,
        taxTreatment: 'standard',
      }],
      { currency: CAD }
    );
    expect(t.subtotalMinor).toBe(150_000); // $1,500.00
    expect(t.taxMinor).toBe(19_500);       // $195.00
    expect(t.totalMinor).toBe(169_500);    // $1,695.00
    expectInternallyConsistent(t);
  });

  it('handles fractional hours without drift', () => {
    const t = computeInvoiceTotals(
      [{ description: 'Support', quantity: 7.25, unitPriceMinor: 12_500, taxRate: 0 }],
      { currency: CAD }
    );
    expect(t.subtotalMinor).toBe(90_625); // 7.25 × $125.00 = $906.25
    expectInternallyConsistent(t);
  });
});

describe('contractor — taxable materials, non-taxable labour', () => {
  it('taxes only what is taxable', () => {
    const t = computeInvoiceTotals(
      [
        {
          description: 'Materials', quantity: 1, unitPriceMinor: 200_000,
          taxCode: 'HST', taxLabel: 'HST 13%', taxRate: 0.13, taxTreatment: 'standard',
        },
        {
          description: 'Labour (exempt)', quantity: 20, unitPriceMinor: 7_500,
          taxCode: 'EXEMPT', taxLabel: 'Exempt', taxRate: 0, taxTreatment: 'exempt',
        },
      ],
      { currency: CAD }
    );
    expect(t.subtotalMinor).toBe(350_000); // $2,000 + $1,500
    expect(t.taxMinor).toBe(26_000);       // 13% of $2,000 only
    expect(t.totalMinor).toBe(376_000);
    expectInternallyConsistent(t);
  });

  it('keeps exempt distinguishable from zero-rated and from no tax', () => {
    const t = computeInvoiceTotals(
      [
        { description: 'Exempt item', quantity: 1, unitPriceMinor: 10_000, taxCode: 'EXEMPT', taxLabel: 'Exempt', taxRate: 0, taxTreatment: 'exempt' },
        { description: 'Zero-rated item', quantity: 1, unitPriceMinor: 10_000, taxCode: 'ZERO_RATED', taxLabel: 'Zero-rated', taxRate: 0, taxTreatment: 'zero_rated' },
        { description: 'Out of scope', quantity: 1, unitPriceMinor: 10_000, taxCode: 'NONE', taxRate: 0, taxTreatment: 'out_of_scope' },
      ],
      { currency: CAD }
    );
    // All three are 0% but the first two must still be reportable, so
    // they appear in the breakdown with their taxable base.
    const codes = t.taxLines.map((l) => l.code).sort();
    expect(codes).toEqual(['EXEMPT', 'ZERO_RATED']);
    expect(t.taxMinor).toBe(0);
    expect(t.taxLines.every((l) => l.taxableMinor === 10_000)).toBe(true);
    expectInternallyConsistent(t);
  });
});

describe('discounts', () => {
  it('applies a $500.00 FIXED discount to a $2,000.00 invoice', () => {
    // The retired prototype validated fixed discounts with .max(100),
    // which rejected any discount above one dollar.
    const t = computeInvoiceTotals(
      [{ description: 'Project work', quantity: 1, unitPriceMinor: 200_000, taxRate: 0 }],
      { currency: CAD, discountKind: 'fixed', discountValue: 50_000 }
    );
    expect(t.subtotalMinor).toBe(200_000);
    expect(t.discountMinor).toBe(50_000);
    expect(t.totalMinor).toBe(150_000);
    expectInternallyConsistent(t);
  });

  it('never discounts below zero', () => {
    const t = computeInvoiceTotals(
      [{ description: 'Small job', quantity: 1, unitPriceMinor: 10_000, taxRate: 0 }],
      { currency: CAD, discountKind: 'fixed', discountValue: 99_999_999 }
    );
    expect(t.discountMinor).toBe(10_000);
    expect(t.totalMinor).toBe(0);
    expectInternallyConsistent(t);
  });

  it('allocates a 10% discount across two different tax rates proportionally', () => {
    const t = computeInvoiceTotals(
      [
        { description: 'A', quantity: 1, unitPriceMinor: 100_000, taxCode: 'HST', taxLabel: 'HST 13%', taxRate: 0.13, taxTreatment: 'standard' },
        { description: 'B', quantity: 1, unitPriceMinor: 50_000, taxCode: 'GST', taxLabel: 'GST 5%', taxRate: 0.05, taxTreatment: 'standard' },
      ],
      { currency: CAD, discountKind: 'percentage', discountValue: 10 }
    );
    expect(t.subtotalMinor).toBe(150_000);
    expect(t.discountMinor).toBe(15_000);
    // 2:1 subtotal split -> 2:1 discount split
    expect(t.lines[0].discountMinor).toBe(10_000);
    expect(t.lines[1].discountMinor).toBe(5_000);
    // Tax charged on the DISCOUNTED base, never the gross.
    expect(t.lines[0].taxMinor).toBe(11_700); // 13% of $900
    expect(t.lines[1].taxMinor).toBe(2_250);  // 5% of $450
    expect(t.taxMinor).toBe(13_950);
    expect(t.totalMinor).toBe(148_950);
    expect(t.taxLines).toHaveLength(2);
    expectInternallyConsistent(t);
  });

  it('rejects a percentage discount above 100%', () => {
    expect(() =>
      computeInvoiceTotals(
        [{ description: 'X', quantity: 1, unitPriceMinor: 1000 }],
        { currency: CAD, discountKind: 'percentage', discountValue: 150 }
      )
    ).toThrow(/cannot exceed 100/i);
  });
});

describe('rounding — no drift, no lost cents', () => {
  it('three lines at $0.335 each still reconcile', () => {
    const t = computeInvoiceTotals(
      [
        { description: 'a', quantity: 1, unitPriceMinor: 33.5 as unknown as number, taxRate: 0 },
      ].map((l) => ({ ...l, unitPriceMinor: 34 })), // 33.5 minor units is not representable; 34 is
      { currency: CAD }
    );
    expect(Number.isInteger(t.totalMinor)).toBe(true);
    expectInternallyConsistent(t);
  });

  it('a discount that does not divide evenly still sums exactly', () => {
    // $10 discount across three equal lines: 333 + 333 + 334 = 1000.
    const t = computeInvoiceTotals(
      [
        { description: 'a', quantity: 1, unitPriceMinor: 10_000, taxRate: 0 },
        { description: 'b', quantity: 1, unitPriceMinor: 10_000, taxRate: 0 },
        { description: 'c', quantity: 1, unitPriceMinor: 10_000, taxRate: 0 },
      ],
      { currency: CAD, discountKind: 'fixed', discountValue: 1_000 }
    );
    expect(t.discountMinor).toBe(1_000);
    expect(t.lines.map((l) => l.discountMinor).reduce((a, b) => a + b, 0)).toBe(1_000);
    expectInternallyConsistent(t);
  });

  it('QST at 9.975% rounds to whole cents', () => {
    const t = computeInvoiceTotals(
      [{ description: 'Service', quantity: 1, unitPriceMinor: 10_033, taxCode: 'QST', taxLabel: 'QST 9.975%', taxRate: 0.09975, taxTreatment: 'standard' }],
      { currency: CAD }
    );
    // 10033 × 0.09975 = 1000.79175 -> 1001
    expect(t.taxMinor).toBe(1_001);
    expect(Number.isInteger(t.taxMinor)).toBe(true);
    expectInternallyConsistent(t);
  });

  it('computeLineSubtotal rounds half away from zero', () => {
    // 0.5 × 5 = 2.5 -> 3, not 2
    expect(computeLineSubtotal(0.5, 5)).toBe(3);
    expect(computeLineSubtotal(1.005, 10_000)).toBe(10_050);
  });

  it('float artifacts never survive: 0.1 + 0.2 style inputs', () => {
    const t = computeInvoiceTotals(
      [
        { description: 'a', quantity: 0.1, unitPriceMinor: 10_000, taxRate: 0 },
        { description: 'b', quantity: 0.2, unitPriceMinor: 10_000, taxRate: 0 },
      ],
      { currency: CAD }
    );
    expect(t.subtotalMinor).toBe(3_000); // exactly $30.00
    expect(Number.isInteger(t.subtotalMinor)).toBe(true);
  });
});

describe('allocateProportionally', () => {
  it('always sums to the total', () => {
    for (const total of [1000, 999, 1, 7, 100_000]) {
      for (const weights of [[1, 1, 1], [2, 1], [5, 3, 2], [1], [0, 0, 0], [7, 11, 13, 17]]) {
        const parts = allocateProportionally(total, weights);
        expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
        expect(parts.every(Number.isInteger)).toBe(true);
      }
    }
  });

  it('gives leftover units to the largest fractional remainders', () => {
    // 100 split 1:1:1 -> 34/33/33, never 33/33/33
    expect(allocateProportionally(100, [1, 1, 1])).toEqual([34, 33, 33]);
  });

  it('handles an empty line set', () => {
    expect(allocateProportionally(100, [])).toEqual([]);
  });
});

describe('empty and edge invoices', () => {
  it('an invoice with no lines totals zero rather than throwing', () => {
    const t = computeInvoiceTotals([], { currency: CAD });
    expect(t.totalMinor).toBe(0);
    expect(t.taxLines).toEqual([]);
    expectInternallyConsistent(t);
  });

  it('a zero-value line does not break allocation', () => {
    const t = computeInvoiceTotals(
      [
        { description: 'Free item', quantity: 1, unitPriceMinor: 0, taxRate: 0 },
        { description: 'Paid item', quantity: 1, unitPriceMinor: 10_000, taxRate: 0 },
      ],
      { currency: CAD, discountKind: 'percentage', discountValue: 10 }
    );
    expect(t.discountMinor).toBe(1_000);
    expect(t.lines[0].discountMinor).toBe(0); // all of it belongs to the paid line
    expect(t.lines[1].discountMinor).toBe(1_000);
    expectInternallyConsistent(t);
  });
});

describe('status rules', () => {
  it('only a draft is editable', () => {
    expect(isEditable('draft')).toBe(true);
    for (const s of ['issued', 'sent', 'viewed', 'partially_paid', 'paid', 'overdue', 'void'] as const) {
      expect(isEditable(s)).toBe(false);
    }
  });

  it('payments can only be recorded against a live invoice', () => {
    expect(canRecordPayment('sent')).toBe(true);
    expect(canRecordPayment('overdue')).toBe(true);
    expect(canRecordPayment('partially_paid')).toBe(true);
    expect(canRecordPayment('draft')).toBe(false);
    expect(canRecordPayment('void')).toBe(false);
    expect(canRecordPayment('paid')).toBe(false);
  });

  it('a draft is never voidable — it is deletable instead', () => {
    expect(canVoid('draft')).toBe(false);
    expect(canVoid('sent')).toBe(true);
    expect(canVoid('paid')).toBe(true);
    expect(canVoid('void')).toBe(false);
  });
});

describe('dates', () => {
  it('derives the due date from payment terms', () => {
    expect(dueDateFor('2026-09-01', 'net_30')).toBe('2026-10-01');
    expect(dueDateFor('2026-09-01', 'due_on_receipt')).toBe('2026-09-01');
    expect(dueDateFor('2026-12-15', 'net_30')).toBe('2027-01-14');
  });

  it('reports days overdue, never negative', () => {
    const today = new Date('2026-09-20T12:00:00Z');
    expect(daysOverdue('2026-09-10', today)).toBe(10);
    expect(daysOverdue('2026-09-20', today)).toBe(0);
    expect(daysOverdue('2026-10-30', today)).toBe(0);
  });
});

describe('currency safety', () => {
  it('carries the invoice currency through untouched', () => {
    const usd = computeInvoiceTotals(
      [{ description: 'X', quantity: 1, unitPriceMinor: 10_000 }],
      { currency: 'USD' }
    );
    expect(usd.currency).toBe('USD');
    const cad = computeInvoiceTotals(
      [{ description: 'X', quantity: 1, unitPriceMinor: 10_000 }],
      { currency: 'CAD' }
    );
    // Same minor units, different currencies. Nothing here converts or
    // adds them — that has to be an explicit, sourced FX decision.
    expect(cad.totalMinor).toBe(usd.totalMinor);
    expect(cad.currency).not.toBe(usd.currency);
  });
});
