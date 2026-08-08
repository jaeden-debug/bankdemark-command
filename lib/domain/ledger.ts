// ============================================================
// LEDGER ENGINE
//
// Pure, deterministic aggregation over transactions. No I/O, no
// database, no LLM. Every number BankDeMark shows or that Zylx
// explains is produced here or by the SQL that mirrors it.
//
// The LLM never performs arithmetic on financial data. It receives
// the output of these functions and explains it.
// ============================================================

import {
  type TransactionKind,
  EQUITY_KINDS,
  LIABILITY_KINDS,
  deriveRecognizedMinor,
  isExpenseKind,
  isRevenueKind,
} from './semantics';
import { assertSafeMinor, percentChange, type CurrencyCode } from './money';

/** The minimum shape the engine needs. Widened rows are fine. */
export interface LedgerTransaction {
  id: string;
  account_id: string;
  occurred_on: string; // ISO date, YYYY-MM-DD
  amount_minor: number;
  currency: CurrencyCode;
  transaction_kind: TransactionKind;
  gross_amount_minor?: number | null;
  recognized_amount_minor?: number | null;
  category_id?: string | null;
  project_id?: string | null;
  counterparty_id?: string | null;
  brand_id?: string | null;
  transfer_group_id?: string | null;
  review_status?: string | null;
  document_id?: string | null;
  merchant?: string | null;
  description?: string | null;
  deleted_at?: string | null;
}

export interface LedgerTotals {
  currency: CurrencyCode;
  /** Revenue actually recognized — the honest top line. */
  recognizedRevenueMinor: number;
  /** Headline volume (booking/sale value). Can be far larger than revenue. */
  grossVolumeMinor: number;
  expensesMinor: number;
  profitMinor: number;
  /** Every cent that entered accounts, including transfers in. */
  cashInMinor: number;
  cashOutMinor: number;
  netCashMovementMinor: number;
  ownerContributionsMinor: number;
  ownerDrawsMinor: number;
  loanProceedsMinor: number;
  loanPaymentsMinor: number;
  passThroughMinor: number;
  taxPaymentsMinor: number;
  transactionCount: number;
}

export function emptyTotals(currency: CurrencyCode): LedgerTotals {
  return {
    currency,
    recognizedRevenueMinor: 0,
    grossVolumeMinor: 0,
    expensesMinor: 0,
    profitMinor: 0,
    cashInMinor: 0,
    cashOutMinor: 0,
    netCashMovementMinor: 0,
    ownerContributionsMinor: 0,
    ownerDrawsMinor: 0,
    loanProceedsMinor: 0,
    loanPaymentsMinor: 0,
    passThroughMinor: 0,
    taxPaymentsMinor: 0,
    transactionCount: 0,
  };
}

function isLive(tx: LedgerTransaction): boolean {
  return !tx.deleted_at;
}

function recognizedOf(tx: LedgerTransaction): number {
  return tx.recognized_amount_minor ?? deriveRecognizedMinor(tx.transaction_kind, tx.amount_minor);
}

/**
 * Aggregate a set of transactions into totals.
 *
 * Currency handling is deliberately strict: mixing currencies throws
 * rather than silently summing. BankDeMark does not pretend to support
 * FX it has not implemented.
 */
export function computeTotals(
  transactions: readonly LedgerTransaction[],
  baseCurrency: CurrencyCode
): LedgerTotals {
  const totals = emptyTotals(baseCurrency);

  for (const tx of transactions) {
    if (!isLive(tx)) continue;

    if (tx.currency !== baseCurrency) {
      throw new Error(
        `Ledger currency mismatch on transaction ${tx.id}: ${tx.currency} in a ${baseCurrency} ledger. ` +
          `Multi-currency conversion is not implemented; convert on import instead.`
      );
    }

    assertSafeMinor(tx.amount_minor, `transaction ${tx.id}`);
    totals.transactionCount += 1;

    // ── Cash movement: literally what hit the accounts ──────
    if (tx.amount_minor > 0) totals.cashInMinor += tx.amount_minor;
    else totals.cashOutMinor += -tx.amount_minor;

    const recognized = recognizedOf(tx);
    const kind = tx.transaction_kind;

    // ── Profit & loss ───────────────────────────────────────
    if (isRevenueKind(kind)) {
      totals.recognizedRevenueMinor += recognized;
      // Gross volume tracks headline value, defaulting to the cash amount.
      totals.grossVolumeMinor += tx.gross_amount_minor ?? Math.abs(tx.amount_minor);
    } else if (isExpenseKind(kind)) {
      totals.expensesMinor += recognized;
    }

    // ── Balance-sheet movements (never profit) ──────────────
    switch (kind) {
      case 'owner_contribution':
        totals.ownerContributionsMinor += Math.abs(tx.amount_minor);
        break;
      case 'owner_draw':
        totals.ownerDrawsMinor += Math.abs(tx.amount_minor);
        break;
      case 'loan_proceeds':
        totals.loanProceedsMinor += Math.abs(tx.amount_minor);
        break;
      case 'loan_payment':
        totals.loanPaymentsMinor += Math.abs(tx.amount_minor);
        break;
      case 'pass_through':
        totals.passThroughMinor += Math.abs(tx.amount_minor);
        break;
      case 'tax_payment':
        totals.taxPaymentsMinor += Math.abs(tx.amount_minor);
        break;
      default:
        break;
    }
  }

  totals.profitMinor = totals.recognizedRevenueMinor - totals.expensesMinor;
  totals.netCashMovementMinor = totals.cashInMinor - totals.cashOutMinor;

  assertSafeMinor(totals.recognizedRevenueMinor, 'recognizedRevenue');
  assertSafeMinor(totals.expensesMinor, 'expenses');
  assertSafeMinor(totals.profitMinor, 'profit');

  return totals;
}

// ── Account balances ────────────────────────────────────────

export interface AccountBalance {
  accountId: string;
  openingBalanceMinor: number;
  ledgerBalanceMinor: number;
  transactionCount: number;
}

/**
 * Ledger-derived balance = opening balance + every signed movement.
 * This is BankDeMark's own number. It is NOT the provider-reported
 * balance; reconciliation compares the two rather than conflating them.
 */
export function computeAccountBalances(
  transactions: readonly LedgerTransaction[],
  openingBalances: Readonly<Record<string, number>> = {}
): AccountBalance[] {
  const byAccount = new Map<string, AccountBalance>();

  for (const accountId of Object.keys(openingBalances)) {
    byAccount.set(accountId, {
      accountId,
      openingBalanceMinor: openingBalances[accountId] ?? 0,
      ledgerBalanceMinor: openingBalances[accountId] ?? 0,
      transactionCount: 0,
    });
  }

  for (const tx of transactions) {
    if (!isLive(tx)) continue;
    let entry = byAccount.get(tx.account_id);
    if (!entry) {
      entry = {
        accountId: tx.account_id,
        openingBalanceMinor: openingBalances[tx.account_id] ?? 0,
        ledgerBalanceMinor: openingBalances[tx.account_id] ?? 0,
        transactionCount: 0,
      };
      byAccount.set(tx.account_id, entry);
    }
    entry.ledgerBalanceMinor += tx.amount_minor;
    entry.transactionCount += 1;
  }

  return [...byAccount.values()];
}

/**
 * Total cash on hand: bank and cash accounts only.
 *
 * Credit cards and loans are liabilities and are deliberately excluded —
 * a card with a -$2,000 balance must not reduce "cash on hand", it
 * belongs in liabilities.
 */
export function computeCashPosition(
  balances: readonly AccountBalance[],
  accountKinds: Readonly<Record<string, string>>
): number {
  return balances
    .filter((b) => ['bank', 'cash'].includes(accountKinds[b.accountId] ?? 'bank'))
    .reduce((sum, b) => sum + b.ledgerBalanceMinor, 0);
}

export function computeLiabilities(
  balances: readonly AccountBalance[],
  accountKinds: Readonly<Record<string, string>>
): number {
  return balances
    .filter((b) => ['credit_card', 'loan', 'payable'].includes(accountKinds[b.accountId] ?? ''))
    // Liability accounts carry negative balances; report them positive.
    .reduce((sum, b) => sum + Math.max(0, -b.ledgerBalanceMinor), 0);
}

// ── Breakdowns ──────────────────────────────────────────────

export interface Breakdown {
  key: string;
  amountMinor: number;
  transactionCount: number;
  share: number;
}

function buildBreakdown(
  transactions: readonly LedgerTransaction[],
  keyOf: (tx: LedgerTransaction) => string | null | undefined,
  include: (tx: LedgerTransaction) => boolean,
  valueOf: (tx: LedgerTransaction) => number
): Breakdown[] {
  const map = new Map<string, { amountMinor: number; transactionCount: number }>();
  let total = 0;

  for (const tx of transactions) {
    if (!isLive(tx) || !include(tx)) continue;
    const key = keyOf(tx) ?? '__uncategorized__';
    const value = valueOf(tx);
    const entry = map.get(key) ?? { amountMinor: 0, transactionCount: 0 };
    entry.amountMinor += value;
    entry.transactionCount += 1;
    map.set(key, entry);
    total += value;
  }

  return [...map.entries()]
    .map(([key, v]) => ({
      key,
      amountMinor: v.amountMinor,
      transactionCount: v.transactionCount,
      share: total === 0 ? 0 : v.amountMinor / total,
    }))
    .sort((a, b) => b.amountMinor - a.amountMinor);
}

export function expensesByCategory(transactions: readonly LedgerTransaction[]): Breakdown[] {
  return buildBreakdown(
    transactions,
    (tx) => tx.category_id,
    (tx) => isExpenseKind(tx.transaction_kind),
    (tx) => recognizedOf(tx)
  );
}

export function revenueByCategory(transactions: readonly LedgerTransaction[]): Breakdown[] {
  return buildBreakdown(
    transactions,
    (tx) => tx.category_id,
    (tx) => isRevenueKind(tx.transaction_kind),
    (tx) => recognizedOf(tx)
  );
}

export function spendByCounterparty(transactions: readonly LedgerTransaction[]): Breakdown[] {
  return buildBreakdown(
    transactions,
    (tx) => tx.counterparty_id ?? tx.merchant,
    (tx) => isExpenseKind(tx.transaction_kind),
    (tx) => recognizedOf(tx)
  );
}

// ── Brand profitability ─────────────────────────────────────
//
// A brand is a segment INSIDE one set of books — a trade name or
// division of a single legal entity. Revenue and expenses stay in the
// one ledger and one tax return; this only splits the view.
//
// Do not confuse this with a business group, where each brand is its
// own legal entity with its own books (see businesses.parent_business_id).

export interface BrandPerformance {
  brandId: string;
  revenueMinor: number;
  expensesMinor: number;
  profitMinor: number;
  margin: number | null;
  transactionCount: number;
  /** Share of the business's total recognized revenue. */
  revenueShare: number;
}

export function computeBrandPerformance(
  transactions: readonly LedgerTransaction[]
): { brands: BrandPerformance[]; unassignedRevenueMinor: number; unassignedExpensesMinor: number } {
  const map = new Map<string, BrandPerformance>();
  let unassignedRevenueMinor = 0;
  let unassignedExpensesMinor = 0;
  let totalRevenue = 0;

  for (const tx of transactions) {
    if (!isLive(tx)) continue;

    const isRevenue = isRevenueKind(tx.transaction_kind);
    const isExpense = isExpenseKind(tx.transaction_kind);
    if (!isRevenue && !isExpense) continue;

    const value = recognizedOf(tx);
    if (isRevenue) totalRevenue += value;

    if (!tx.brand_id) {
      // Shared overhead and unattributed income. Reported separately
      // rather than silently spread across brands, which would invent
      // an allocation the owner never chose.
      if (isRevenue) unassignedRevenueMinor += value;
      else unassignedExpensesMinor += value;
      continue;
    }

    const entry =
      map.get(tx.brand_id) ??
      { brandId: tx.brand_id, revenueMinor: 0, expensesMinor: 0, profitMinor: 0, margin: null, transactionCount: 0, revenueShare: 0 };

    if (isRevenue) entry.revenueMinor += value;
    else entry.expensesMinor += value;
    entry.transactionCount += 1;
    map.set(tx.brand_id, entry);
  }

  const brands = [...map.values()];
  for (const b of brands) {
    b.profitMinor = b.revenueMinor - b.expensesMinor;
    b.margin = b.revenueMinor === 0 ? null : b.profitMinor / b.revenueMinor;
    b.revenueShare = totalRevenue === 0 ? 0 : b.revenueMinor / totalRevenue;
  }
  brands.sort((a, b) => b.revenueMinor - a.revenueMinor);

  return { brands, unassignedRevenueMinor, unassignedExpensesMinor };
}

// ── Project profitability ───────────────────────────────────

export interface ProjectProfit {
  projectId: string;
  revenueMinor: number;
  expensesMinor: number;
  profitMinor: number;
  /** Profit as a share of revenue, or null when there is no revenue. */
  margin: number | null;
  transactionCount: number;
}

export function computeProjectProfitability(
  transactions: readonly LedgerTransaction[]
): ProjectProfit[] {
  const map = new Map<string, ProjectProfit>();

  for (const tx of transactions) {
    if (!isLive(tx) || !tx.project_id) continue;
    const entry =
      map.get(tx.project_id) ??
      {
        projectId: tx.project_id,
        revenueMinor: 0,
        expensesMinor: 0,
        profitMinor: 0,
        margin: null,
        transactionCount: 0,
      };

    if (isRevenueKind(tx.transaction_kind)) entry.revenueMinor += recognizedOf(tx);
    else if (isExpenseKind(tx.transaction_kind)) entry.expensesMinor += recognizedOf(tx);

    entry.transactionCount += 1;
    map.set(tx.project_id, entry);
  }

  for (const entry of map.values()) {
    entry.profitMinor = entry.revenueMinor - entry.expensesMinor;
    entry.margin = entry.revenueMinor === 0 ? null : entry.profitMinor / entry.revenueMinor;
  }

  return [...map.values()].sort((a, b) => b.profitMinor - a.profitMinor);
}

// ── Time series ─────────────────────────────────────────────

export interface MonthlyPoint {
  month: string; // YYYY-MM
  recognizedRevenueMinor: number;
  expensesMinor: number;
  profitMinor: number;
  cashInMinor: number;
  cashOutMinor: number;
}

export function computeMonthlySeries(
  transactions: readonly LedgerTransaction[],
  baseCurrency: CurrencyCode
): MonthlyPoint[] {
  const buckets = new Map<string, LedgerTransaction[]>();

  for (const tx of transactions) {
    if (!isLive(tx)) continue;
    const month = tx.occurred_on.slice(0, 7);
    const list = buckets.get(month) ?? [];
    list.push(tx);
    buckets.set(month, list);
  }

  return [...buckets.entries()]
    .map(([month, txs]) => {
      const t = computeTotals(txs, baseCurrency);
      return {
        month,
        recognizedRevenueMinor: t.recognizedRevenueMinor,
        expensesMinor: t.expensesMinor,
        profitMinor: t.profitMinor,
        cashInMinor: t.cashInMinor,
        cashOutMinor: t.cashOutMinor,
      };
    })
    .sort((a, b) => a.month.localeCompare(b.month));
}

// ── Period comparison ───────────────────────────────────────

export interface PeriodComparison {
  current: LedgerTotals;
  previous: LedgerTotals;
  revenueChange: number | null;
  expenseChange: number | null;
  profitChange: number | null;
}

export function comparePeriods(
  current: LedgerTotals,
  previous: LedgerTotals
): PeriodComparison {
  return {
    current,
    previous,
    revenueChange: percentChange(current.recognizedRevenueMinor, previous.recognizedRevenueMinor),
    expenseChange: percentChange(current.expensesMinor, previous.expensesMinor),
    profitChange: percentChange(current.profitMinor, previous.profitMinor),
  };
}

// ── Attention queue ─────────────────────────────────────────

export interface AttentionCounts {
  uncategorized: number;
  needsReview: number;
  missingReceipts: number;
  unmatchedTransfers: number;
}

/**
 * What the owner should actually look at. Deliberately small — the
 * dashboard shows work to do, not an inbox of everything.
 */
export function computeAttention(
  transactions: readonly LedgerTransaction[],
  options: { receiptRequiredAboveMinor?: number } = {}
): AttentionCounts {
  const receiptThreshold = options.receiptRequiredAboveMinor ?? 2500; // $25

  let uncategorized = 0;
  let needsReview = 0;
  let missingReceipts = 0;

  const transferGroups = new Map<string, number>();

  for (const tx of transactions) {
    if (!isLive(tx)) continue;

    if (!tx.category_id && tx.transaction_kind !== 'transfer') uncategorized += 1;
    if (tx.review_status === 'needs_review' || tx.review_status === 'unreviewed') needsReview += 1;

    if (
      isExpenseKind(tx.transaction_kind) &&
      !tx.document_id &&
      Math.abs(tx.amount_minor) >= receiptThreshold
    ) {
      missingReceipts += 1;
    }

    if (tx.transfer_group_id) {
      transferGroups.set(
        tx.transfer_group_id,
        (transferGroups.get(tx.transfer_group_id) ?? 0) + tx.amount_minor
      );
    }
  }

  // A balanced transfer nets to zero across its legs. Anything else is
  // a half-matched transfer and needs a human.
  let unmatchedTransfers = 0;
  for (const net of transferGroups.values()) {
    if (net !== 0) unmatchedTransfers += 1;
  }

  return { uncategorized, needsReview, missingReceipts, unmatchedTransfers };
}

// ── Equity & liability roll-forward ─────────────────────────

export interface OwnerEquity {
  contributionsMinor: number;
  drawsMinor: number;
  retainedProfitMinor: number;
  netEquityMinor: number;
}

export function computeOwnerEquity(totals: LedgerTotals): OwnerEquity {
  return {
    contributionsMinor: totals.ownerContributionsMinor,
    drawsMinor: totals.ownerDrawsMinor,
    retainedProfitMinor: totals.profitMinor,
    netEquityMinor:
      totals.ownerContributionsMinor - totals.ownerDrawsMinor + totals.profitMinor,
  };
}

/**
 * Business net worth = assets − liabilities.
 *
 * This is ACCOUNTING net worth from recorded balances. It is not an
 * estimated sale value of the business, and callers must not present
 * it as one.
 */
export function computeBusinessNetWorth(input: {
  cashMinor: number;
  receivablesMinor: number;
  otherAssetsMinor: number;
  liabilitiesMinor: number;
}): { assetsMinor: number; liabilitiesMinor: number; netWorthMinor: number } {
  const assetsMinor = input.cashMinor + input.receivablesMinor + input.otherAssetsMinor;
  return {
    assetsMinor,
    liabilitiesMinor: input.liabilitiesMinor,
    netWorthMinor: assetsMinor - input.liabilitiesMinor,
  };
}

export { EQUITY_KINDS, LIABILITY_KINDS };
