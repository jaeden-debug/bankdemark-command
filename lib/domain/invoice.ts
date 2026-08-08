// ============================================================
// INVOICE TOTALS
//
// Pure, deterministic, no I/O. Every figure that appears on an
// invoice is computed here and nowhere else, so the builder preview,
// the stored totals, the PDF and Zylx cannot disagree.
//
// MONEY IS INTEGER MINOR UNITS THROUGHOUT.
// The only float-ish inputs are `quantity` and `tax_rate`, neither of
// which is money. They are multiplied into minor units and rounded to
// a whole unit immediately, so no fractional cent ever propagates.
//
// DISCOUNT ORDER
//   subtotal -> invoice discount -> allocate discount across lines in
//   proportion to their subtotal -> tax each line on its discounted
//   base. Taxing before the discount would overcharge tax; discounting
//   after tax would misstate the tax actually collected.
//
// The proportional-allocation concept is the one genuinely good idea
// carried over from the retired BankDeMarkInvoice prototype. It has
// been reimplemented in integer arithmetic with an explicit remainder
// pass, which the float original did not have.
// ============================================================

import {
  applyRate,
  assertSafeMinor,
  sumMinor,
  type CurrencyCode,
} from './money';

export type TaxTreatment = 'standard' | 'zero_rated' | 'exempt' | 'out_of_scope';

export type DiscountKind = 'percentage' | 'fixed';

/** A line as the user is editing it, before any invoice-level maths. */
export interface InvoiceLineInput {
  description: string;
  /** May be fractional (hours, units). Not money. */
  quantity: number;
  unitPriceMinor: number;
  taxCode?: string | null;
  taxLabel?: string | null;
  /** 0.13 for 13%. Not a percentage number. */
  taxRate?: number;
  taxTreatment?: TaxTreatment;
  categoryId?: string | null;
  projectId?: string | null;
}

/** A line after computation — what actually gets stored. */
export interface ComputedLine extends InvoiceLineInput {
  position: number;
  subtotalMinor: number;
  /** This line's share of the invoice-level discount. */
  discountMinor: number;
  /** subtotalMinor - discountMinor. The base tax is charged on. */
  taxableMinor: number;
  taxMinor: number;
  /** taxableMinor + taxMinor */
  totalMinor: number;
}

/** One row of the tax summary shown on the invoice. */
export interface TaxLine {
  code: string;
  label: string;
  rate: number;
  treatment: TaxTreatment;
  taxableMinor: number;
  taxMinor: number;
}

export interface InvoiceTotals {
  lines: ComputedLine[];
  subtotalMinor: number;
  discountMinor: number;
  /** Subtotal less discount. The sum of all line taxable bases. */
  taxableMinor: number;
  taxLines: TaxLine[];
  taxMinor: number;
  totalMinor: number;
  currency: CurrencyCode;
}

export interface ComputeOptions {
  discountKind?: DiscountKind;
  /** A percentage (0–100) when kind is 'percentage', else a MINOR-unit amount. */
  discountValue?: number;
  currency: CurrencyCode;
}

/** Round half away from zero. Never `Math.round`, which is asymmetric on negatives. */
function roundHalfAway(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/**
 * quantity × unitPrice, rounded to whole minor units.
 *
 * Rounded per line rather than at the end so that the stored line total
 * always equals what the invoice shows. An invoice whose lines do not
 * add up to its own total is worse than one that rounds a cent.
 */
export function computeLineSubtotal(quantity: number, unitPriceMinor: number): number {
  if (!Number.isFinite(quantity)) {
    throw new TypeError(`quantity must be a finite number, got ${quantity}`);
  }
  assertSafeMinor(unitPriceMinor, 'unit price');
  return assertSafeMinor(roundHalfAway(quantity * unitPriceMinor), 'line subtotal');
}

/**
 * Split `totalToAllocate` across `weights` proportionally, in whole
 * minor units, such that the parts sum EXACTLY to the total.
 *
 * Largest-remainder method: floor every share, then hand the leftover
 * units one at a time to the lines with the largest fractional part.
 * Without this pass a 3-way split of 100 would produce 33+33+33 = 99
 * and the invoice would silently lose a cent.
 */
export function allocateProportionally(
  totalToAllocate: number,
  weights: readonly number[]
): number[] {
  const n = weights.length;
  if (n === 0) return [];

  assertSafeMinor(totalToAllocate, 'allocation total');

  const weightSum = weights.reduce((a, b) => a + b, 0);
  // Nothing to weight by (all-zero lines): spread evenly instead of
  // dividing by zero.
  if (weightSum === 0) {
    const base = Math.trunc(totalToAllocate / n);
    const out = new Array<number>(n).fill(base);
    let remainder = totalToAllocate - base * n;
    for (let i = 0; remainder !== 0 && i < n; i += 1) {
      const step = remainder > 0 ? 1 : -1;
      out[i] += step;
      remainder -= step;
    }
    return out;
  }

  const exact = weights.map((w) => (totalToAllocate * w) / weightSum);
  const floored = exact.map((v) => Math.floor(v));
  let remainder = totalToAllocate - floored.reduce((a, b) => a + b, 0);

  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);

  for (let k = 0; remainder > 0 && k < order.length; k += 1) {
    floored[order[k].i] += 1;
    remainder -= 1;
  }
  // Negative remainder (possible with negative allocations) drains from
  // the smallest fractional parts first.
  for (let k = order.length - 1; remainder < 0 && k >= 0; k -= 1) {
    floored[order[k].i] -= 1;
    remainder += 1;
  }

  return floored;
}

/**
 * Compute every figure on an invoice from its lines.
 *
 * Guarantees, all covered by tests:
 *   - sum(line.subtotalMinor)  === subtotalMinor
 *   - sum(line.discountMinor)  === discountMinor
 *   - sum(line.taxMinor)       === taxMinor
 *   - sum(taxLines[].taxMinor) === taxMinor
 *   - taxableMinor + taxMinor  === totalMinor
 */
export function computeInvoiceTotals(
  lineInputs: readonly InvoiceLineInput[],
  options: ComputeOptions
): InvoiceTotals {
  const { currency } = options;
  const discountKind: DiscountKind = options.discountKind ?? 'percentage';
  const discountValue = options.discountValue ?? 0;

  // ── 1. Line subtotals ──────────────────────────────────────
  const subtotals = lineInputs.map((l) => computeLineSubtotal(l.quantity, l.unitPriceMinor));
  const subtotalMinor = sumMinor(subtotals);

  // ── 2. Invoice-level discount ──────────────────────────────
  // A fixed discount is a minor-unit amount and is NOT capped at any
  // arbitrary ceiling — the retired prototype validated fixed discounts
  // with `.max(100)`, which rejected any discount over one dollar.
  let discountMinor = 0;
  if (discountValue > 0 && subtotalMinor > 0) {
    if (discountKind === 'percentage') {
      if (discountValue > 100) {
        throw new RangeError('A percentage discount cannot exceed 100%.');
      }
      discountMinor = applyRate(subtotalMinor, discountValue / 100);
    } else {
      discountMinor = roundHalfAway(discountValue);
    }
    // Never discount below zero.
    discountMinor = Math.min(Math.max(discountMinor, 0), subtotalMinor);
  }

  // ── 3. Allocate the discount across lines ──────────────────
  const discountShares = discountMinor > 0
    ? allocateProportionally(discountMinor, subtotals)
    : new Array<number>(lineInputs.length).fill(0);

  // ── 4. Per-line tax on the discounted base ─────────────────
  const lines: ComputedLine[] = lineInputs.map((input, i) => {
    const subtotal = subtotals[i];
    const discount = discountShares[i];
    const taxable = subtotal - discount;
    const treatment: TaxTreatment = input.taxTreatment ?? 'standard';
    const rate = input.taxRate ?? 0;

    // zero_rated and exempt are 0% but stay distinguishable in the
    // breakdown — they are reported differently on a tax return.
    const tax = treatment === 'standard' && rate > 0 ? applyRate(taxable, rate) : 0;

    return {
      ...input,
      position: i,
      subtotalMinor: subtotal,
      discountMinor: discount,
      taxableMinor: taxable,
      taxMinor: tax,
      totalMinor: taxable + tax,
    };
  });

  // ── 5. Aggregate the tax summary by code + rate ────────────
  const taxMap = new Map<string, TaxLine>();
  for (const line of lines) {
    const treatment = line.taxTreatment ?? 'standard';
    const rate = line.taxRate ?? 0;
    const code = line.taxCode ?? (treatment === 'standard' ? 'NONE' : treatment.toUpperCase());

    // What belongs in the tax summary:
    //   standard  + rate > 0  -> yes, it was taxed
    //   standard  + rate = 0  -> no, simply untaxed
    //   zero_rated / exempt   -> YES at 0%. These are taxable supplies
    //                            whose base must still be reportable,
    //                            and they are reported differently from
    //                            each other on a return.
    //   out_of_scope          -> no. Not a supply at all, so it has no
    //                            place on a tax summary.
    if (treatment === 'out_of_scope') continue;
    if (treatment === 'standard' && rate <= 0) continue;

    const key = `${code}:${rate}:${treatment}`;
    const existing = taxMap.get(key);
    if (existing) {
      existing.taxableMinor += line.taxableMinor;
      existing.taxMinor += line.taxMinor;
    } else {
      taxMap.set(key, {
        code,
        label: line.taxLabel ?? code,
        rate,
        treatment,
        taxableMinor: line.taxableMinor,
        taxMinor: line.taxMinor,
      });
    }
  }
  const taxLines = Array.from(taxMap.values()).sort(
    (a, b) => b.rate - a.rate || a.code.localeCompare(b.code)
  );

  // Summed from the lines, never recomputed from the aggregate — that
  // is what keeps sum(lines) === sum(taxLines) exact.
  const taxMinor = sumMinor(lines.map((l) => l.taxMinor));
  const taxableMinor = subtotalMinor - discountMinor;
  const totalMinor = assertSafeMinor(taxableMinor + taxMinor, 'invoice total');

  return {
    lines,
    subtotalMinor,
    discountMinor,
    taxableMinor,
    taxLines,
    taxMinor,
    totalMinor,
    currency,
  };
}

// ── Status helpers ──────────────────────────────────────────

export const INVOICE_STATUSES = [
  'draft',
  'issued',
  'sent',
  'viewed',
  'partially_paid',
  'paid',
  'overdue',
  'void',
] as const;

export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: 'Draft',
  issued: 'Issued',
  sent: 'Sent',
  viewed: 'Viewed',
  partially_paid: 'Partly paid',
  paid: 'Paid',
  overdue: 'Overdue',
  void: 'Void',
};

/** Statuses that represent live money owed — the receivable set. */
export const OUTSTANDING_STATUSES: readonly InvoiceStatus[] = [
  'issued',
  'sent',
  'viewed',
  'partially_paid',
  'overdue',
];

export function isOutstanding(status: InvoiceStatus): boolean {
  return OUTSTANDING_STATUSES.includes(status);
}

/** An issued invoice's financial record is frozen. */
export function isEditable(status: InvoiceStatus): boolean {
  return status === 'draft';
}

export function canIssue(status: InvoiceStatus): boolean {
  return status === 'draft';
}

export function canSend(status: InvoiceStatus): boolean {
  return isOutstanding(status) || status === 'paid';
}

export function canVoid(status: InvoiceStatus): boolean {
  return status !== 'draft' && status !== 'void';
}

export function canRecordPayment(status: InvoiceStatus): boolean {
  return isOutstanding(status);
}

export function canDelete(status: InvoiceStatus): boolean {
  return status === 'draft';
}

/** Days past due. Zero when not yet due — never negative. */
export function daysOverdue(dueDate: string, today = new Date()): number {
  const due = new Date(`${dueDate}T00:00:00Z`);
  const now = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  );
  const diff = now.getTime() - due.getTime();
  return diff <= 0 ? 0 : Math.floor(diff / 86_400_000);
}

/** Common payment terms, and the due-date offset each implies. */
export const PAYMENT_TERMS: Record<string, { label: string; days: number | null }> = {
  due_on_receipt: { label: 'Due on receipt', days: 0 },
  net_7: { label: 'Net 7', days: 7 },
  net_14: { label: 'Net 14', days: 14 },
  net_15: { label: 'Net 15', days: 15 },
  net_30: { label: 'Net 30', days: 30 },
  net_45: { label: 'Net 45', days: 45 },
  net_60: { label: 'Net 60', days: 60 },
  net_90: { label: 'Net 90', days: 90 },
  custom: { label: 'Custom', days: null },
};

export function dueDateFor(issueDate: string, terms: string): string {
  const days = PAYMENT_TERMS[terms]?.days;
  if (days === null || days === undefined) return issueDate;
  const d = new Date(`${issueDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
