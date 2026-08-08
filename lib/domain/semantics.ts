// ============================================================
// FINANCIAL SEMANTICS
//
// The single definition of what each transaction type MEANS.
// This file is the TypeScript mirror of `bdm_revenue_types()` and
// `bdm_expense_types()` in migration 20260808030000_financial_kernel.
// If the two ever disagree, `tests/semantics-parity.test.ts` fails.
//
// This is the file that prevents:
//   - a bank transfer becoming fake revenue
//   - a credit-card payment becoming a second expense
//   - an owner contribution inflating profit
//   - a $6,000 booking being reported as $6,000 of revenue
// ============================================================

export const TRANSACTION_KINDS = [
  'income',
  'expense',
  'transfer',
  'owner_contribution',
  'owner_draw',
  'loan_proceeds',
  'loan_payment',
  'credit_card_payment',
  'refund',
  'reimbursement',
  'commission',
  'pass_through',
  'asset_purchase',
  'tax_payment',
  'other',
] as const;

export type TransactionKind = (typeof TRANSACTION_KINDS)[number];

export type CategoryKind = 'income' | 'expense' | 'asset' | 'liability' | 'equity';

/** Types whose recognized amount enters REVENUE. */
export const REVENUE_KINDS: readonly TransactionKind[] = ['income', 'commission', 'refund'];

/** Types whose recognized amount enters EXPENSES. */
export const EXPENSE_KINDS: readonly TransactionKind[] = ['expense', 'reimbursement'];

/**
 * Types that move money between things the business already owns or owes.
 * They change cash, never profit. Excluding them is what makes transfer
 * safety structural rather than a downstream filter someone can forget.
 */
export const CASH_NEUTRAL_KINDS: readonly TransactionKind[] = [
  'transfer',
  'credit_card_payment',
  'owner_contribution',
  'owner_draw',
  'loan_proceeds',
  'loan_payment',
  'pass_through',
  'asset_purchase',
  'tax_payment',
  'other',
];

/** Types that change owner equity rather than profit. */
export const EQUITY_KINDS: readonly TransactionKind[] = ['owner_contribution', 'owner_draw'];

/** Types that change what the business owes. */
export const LIABILITY_KINDS: readonly TransactionKind[] = ['loan_proceeds', 'loan_payment'];

export function isRevenueKind(kind: TransactionKind): boolean {
  return REVENUE_KINDS.includes(kind);
}

export function isExpenseKind(kind: TransactionKind): boolean {
  return EXPENSE_KINDS.includes(kind);
}

export function affectsProfit(kind: TransactionKind): boolean {
  return isRevenueKind(kind) || isExpenseKind(kind);
}

/**
 * Derive the recognized amount for a transaction when the caller has not
 * set one explicitly. Mirrors `bdm_normalise_transaction()` exactly.
 *
 * `amountMinor` is the signed cash movement from the account's view.
 */
export function deriveRecognizedMinor(kind: TransactionKind, amountMinor: number): number {
  const abs = Math.abs(amountMinor);

  if (isRevenueKind(kind)) {
    // A refund is cash going back out; it must REDUCE revenue.
    return kind === 'refund' ? -abs : abs;
  }

  if (isExpenseKind(kind)) {
    // A reimbursement is money coming back in; it must REDUCE expenses.
    return kind === 'reimbursement' ? -abs : abs;
  }

  // Transfers, owner capital, loans, credit-card payments, pass-through
  // funds, asset purchases and tax payments never touch profit.
  return 0;
}

// ── Business-owner language ─────────────────────────────────
// Accounting correctness underneath, plain words on the surface.

export const KIND_LABELS: Record<TransactionKind, string> = {
  income: 'Money in',
  expense: 'Money out',
  transfer: 'Transfer between accounts',
  owner_contribution: 'Money you put in',
  owner_draw: 'Money you took out',
  loan_proceeds: 'Loan received',
  loan_payment: 'Loan repayment',
  credit_card_payment: 'Credit card payment',
  refund: 'Refund to customer',
  reimbursement: 'Expense reimbursed to you',
  commission: 'Commission earned',
  pass_through: 'Client funds (not yours)',
  asset_purchase: 'Equipment or asset bought',
  tax_payment: 'Tax payment',
  other: 'Other',
};

export const KIND_HELP: Record<TransactionKind, string> = {
  income: 'A customer paid you for something you sold. Counts as revenue.',
  expense: 'You paid for something the business used. Counts as an expense.',
  transfer:
    'You moved your own money between your own accounts. Does not change revenue, expenses or what you are worth.',
  owner_contribution: 'You funded the business from personal money. This is not revenue.',
  owner_draw: 'You paid yourself from the business. This is not an expense.',
  loan_proceeds: 'You borrowed money. Cash goes up and so does what you owe. Not revenue.',
  loan_payment: 'You repaid borrowed money. Cash goes down and so does what you owe. Not an expense.',
  credit_card_payment:
    'You paid down a card balance. The purchases were already counted as expenses, so this is not a second expense.',
  refund: 'You gave money back to a customer. Reduces revenue.',
  reimbursement: 'Someone paid you back for an expense. Reduces expenses.',
  commission: 'You earned a commission. Only the commission is your revenue, not the full sale.',
  pass_through:
    'Money that belongs to a supplier or client and is only passing through your account. Never your revenue.',
  asset_purchase: 'You bought something lasting, like equipment. An asset, not a running cost.',
  tax_payment: 'You paid tax owed. Settles a liability rather than being a normal expense.',
  other: 'Anything that does not fit the categories above.',
};

/** Ordered for a picker: the common cases first. */
export const KIND_PICKER_ORDER: readonly TransactionKind[] = [
  'income',
  'expense',
  'transfer',
  'commission',
  'refund',
  'credit_card_payment',
  'owner_contribution',
  'owner_draw',
  'loan_proceeds',
  'loan_payment',
  'reimbursement',
  'pass_through',
  'asset_purchase',
  'tax_payment',
  'other',
];

/**
 * Which transaction types make sense for a given business model.
 * Used to keep the picker short without hiding anything permanently.
 */
export function suggestedKindsForBusinessType(businessType: string): readonly TransactionKind[] {
  const base: TransactionKind[] = ['income', 'expense', 'transfer', 'owner_contribution', 'owner_draw'];
  switch (businessType) {
    case 'travel':
      return [...base, 'commission', 'pass_through', 'refund'];
    case 'ecommerce':
    case 'retail':
      return [...base, 'refund', 'credit_card_payment'];
    case 'agency':
    case 'freelancer':
      return [...base, 'reimbursement', 'refund'];
    case 'saas':
      return [...base, 'refund', 'credit_card_payment'];
    default:
      return [...base, 'refund'];
  }
}

// ── Recognition modes for gross-value sales ────────────────

export type RecognitionMode = 'commission' | 'full_gross' | 'net_of_supplier' | 'manual';

export const RECOGNITION_MODE_LABELS: Record<RecognitionMode, string> = {
  commission: 'I earn a commission on the sale',
  full_gross: 'The whole sale amount is my revenue',
  net_of_supplier: 'My revenue is the sale minus what I pay the supplier',
  manual: 'I will enter my revenue myself',
};

/**
 * Given a booking's gross value, work out how much of it is actually
 * this business's revenue.
 *
 * This is the function that makes a $6,000 vacation with a $600
 * commission report $600 of revenue and $6,000 of booking volume.
 */
export function recognizedRevenueForBooking(input: {
  grossValueMinor: number;
  recognitionMode: RecognitionMode;
  commissionExpectedMinor?: number | null;
  serviceFeeMinor?: number | null;
  supplierCostMinor?: number | null;
  manualRecognizedMinor?: number | null;
}): number {
  const commission = input.commissionExpectedMinor ?? 0;
  const serviceFee = input.serviceFeeMinor ?? 0;

  switch (input.recognitionMode) {
    case 'commission':
      return commission + serviceFee;
    case 'full_gross':
      return input.grossValueMinor + serviceFee;
    case 'net_of_supplier':
      return input.grossValueMinor - (input.supplierCostMinor ?? 0) + serviceFee;
    case 'manual':
      return (input.manualRecognizedMinor ?? 0) + serviceFee;
  }
}
