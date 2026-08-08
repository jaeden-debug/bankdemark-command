// ============================================================
// REPORT ENGINE
//
// A report is a reproducible artefact, not a screen. Same business +
// same period + same ledger state must always produce the same
// figures, and every report states what it was generated from so a
// number can be traced back.
//
// Reports are built from the same ledger engine as the dashboard, so
// a P&L can never disagree with the headline figures.
// ============================================================

import 'server-only';
import type { BusinessContext } from './context';
import { ServiceError } from './errors';
import { loadTransactions, previousPeriod, type Period } from './finance';
import {
  computeTotals,
  expensesByCategory,
  revenueByCategory,
  type LedgerTransaction,
} from '@/lib/domain/ledger';
import { percentChange } from '@/lib/domain/money';

export interface ReportLine {
  label: string;
  amountMinor: number;
  /** Same line in the comparison period, when one was requested. */
  previousAmountMinor?: number;
  change?: number | null;
  /** Share of its own section total, for the bar treatment. */
  share: number;
}

export interface ProfitAndLoss {
  businessName: string;
  currency: string;
  period: Period;
  comparisonPeriod: Period | null;

  revenueLines: ReportLine[];
  totalRevenueMinor: number;

  expenseLines: ReportLine[];
  totalExpensesMinor: number;

  profitMinor: number;
  marginPercent: number | null;

  previousRevenueMinor: number | null;
  previousExpensesMinor: number | null;
  previousProfitMinor: number | null;

  /** Headline sale value, which for commission businesses is not revenue. */
  grossVolumeMinor: number;
  showsVolume: boolean;

  /** Movements deliberately excluded from profit, listed so it's clear why. */
  excluded: Array<{ label: string; amountMinor: number; reason: string }>;

  transactionCount: number;
  uncategorisedCount: number;
  generatedAt: string;
  dataThrough: string | null;
}

function buildLines(
  breakdown: ReturnType<typeof revenueByCategory>,
  names: Map<string, string>,
  previous: Map<string, number> | null
): ReportLine[] {
  const total = breakdown.reduce((s, r) => s + r.amountMinor, 0);

  return breakdown.map((row) => {
    const label =
      row.key === '__uncategorized__'
        ? 'Not categorised yet'
        : names.get(row.key) ?? 'Unknown category';
    const previousAmountMinor = previous?.get(row.key);

    return {
      label,
      amountMinor: row.amountMinor,
      previousAmountMinor,
      change:
        previousAmountMinor === undefined
          ? undefined
          : percentChange(row.amountMinor, previousAmountMinor),
      share: total === 0 ? 0 : row.amountMinor / total,
    };
  });
}

function toMap(breakdown: ReturnType<typeof revenueByCategory>): Map<string, number> {
  return new Map(breakdown.map((r) => [r.key, r.amountMinor]));
}

export async function generateProfitAndLoss(
  ctx: BusinessContext,
  period: Period,
  options: { compare?: boolean } = {}
): Promise<ProfitAndLoss> {
  const currency = ctx.business.base_currency;
  const compare = options.compare ?? true;
  const comparisonPeriod = compare ? previousPeriod(period) : null;

  const [transactions, previousTransactions, categoriesRes] = await Promise.all([
    loadTransactions(ctx.db, ctx.businessId, period),
    comparisonPeriod
      ? loadTransactions(ctx.db, ctx.businessId, comparisonPeriod)
      : Promise.resolve([] as LedgerTransaction[]),
    ctx.db
      .from('categories')
      .select('id, name')
      .or(`business_id.eq.${ctx.businessId},business_id.is.null`),
  ]);

  if (categoriesRes.error) {
    throw new ServiceError('internal', 'Could not load categories for the report.', {
      detail: categoriesRes.error.message,
      cause: categoriesRes.error,
    });
  }

  const names = new Map((categoriesRes.data ?? []).map((c) => [c.id, c.name]));

  const totals = computeTotals(transactions, currency);
  const previousTotals = comparisonPeriod ? computeTotals(previousTransactions, currency) : null;

  const revenueBreakdown = revenueByCategory(transactions);
  const expenseBreakdown = expensesByCategory(transactions);

  const revenueLines = buildLines(
    revenueBreakdown,
    names,
    previousTotals ? toMap(revenueByCategory(previousTransactions)) : null
  );
  const expenseLines = buildLines(
    expenseBreakdown,
    names,
    previousTotals ? toMap(expensesByCategory(previousTransactions)) : null
  );

  // Everything that moved cash but is deliberately not profit. Showing
  // this is what stops "why doesn't this match my bank?" — the most
  // common question a P&L provokes.
  const excluded = [
    {
      label: 'Money you put in',
      amountMinor: totals.ownerContributionsMinor,
      reason: 'Owner funding is not revenue.',
    },
    {
      label: 'Money you took out',
      amountMinor: totals.ownerDrawsMinor,
      reason: 'Paying yourself is not a business expense.',
    },
    {
      label: 'Loans received',
      amountMinor: totals.loanProceedsMinor,
      reason: 'Borrowed money is not revenue.',
    },
    {
      label: 'Loan repayments',
      amountMinor: totals.loanPaymentsMinor,
      reason: 'Repaying a loan settles debt rather than being a cost.',
    },
    {
      label: 'Client funds passing through',
      amountMinor: totals.passThroughMinor,
      reason: "This money belongs to someone else.",
    },
    {
      label: 'Tax payments',
      amountMinor: totals.taxPaymentsMinor,
      reason: 'Paying tax owed settles a liability.',
    },
  ].filter((e) => e.amountMinor !== 0);

  const uncategorisedCount = transactions.filter(
    (t) => !t.category_id && t.transaction_kind !== 'transfer'
  ).length;

  const dates = transactions.map((t) => t.occurred_on).sort();

  return {
    businessName: ctx.business.name,
    currency,
    period,
    comparisonPeriod,

    revenueLines,
    totalRevenueMinor: totals.recognizedRevenueMinor,

    expenseLines,
    totalExpensesMinor: totals.expensesMinor,

    profitMinor: totals.profitMinor,
    marginPercent:
      totals.recognizedRevenueMinor === 0
        ? null
        : totals.profitMinor / totals.recognizedRevenueMinor,

    previousRevenueMinor: previousTotals?.recognizedRevenueMinor ?? null,
    previousExpensesMinor: previousTotals?.expensesMinor ?? null,
    previousProfitMinor: previousTotals?.profitMinor ?? null,

    grossVolumeMinor: totals.grossVolumeMinor,
    showsVolume:
      ctx.business.earns_commissions &&
      totals.grossVolumeMinor !== totals.recognizedRevenueMinor,

    excluded,
    transactionCount: totals.transactionCount,
    uncategorisedCount,
    generatedAt: new Date().toISOString(),
    dataThrough: dates.length ? dates[dates.length - 1] : null,
  };
}

/** CSV export of a P&L, for an accountant or a spreadsheet. */
export function profitAndLossToCsv(report: ProfitAndLoss): string {
  const money = (minor: number) => (minor / 100).toFixed(2);
  const rows: string[][] = [
    ['Profit & Loss'],
    ['Business', report.businessName],
    ['Period', `${report.period.from} to ${report.period.to}`],
    ['Currency', report.currency],
    ['Generated', report.generatedAt],
    [],
    ['Money in'],
    ...report.revenueLines.map((l) => [l.label, money(l.amountMinor)]),
    ['Total money in', money(report.totalRevenueMinor)],
    [],
    ['Money out'],
    ...report.expenseLines.map((l) => [l.label, money(l.amountMinor)]),
    ['Total money out', money(report.totalExpensesMinor)],
    [],
    ['Profit', money(report.profitMinor)],
  ];

  if (report.showsVolume) {
    rows.push([], ['Sale value handled (not revenue)', money(report.grossVolumeMinor)]);
  }
  if (report.excluded.length > 0) {
    rows.push([], ['Excluded from profit']);
    for (const e of report.excluded) rows.push([e.label, money(e.amountMinor), e.reason]);
  }

  return rows
    .map((row) =>
      row
        .map((cell) => {
          const value = String(cell ?? '');
          // Neutralise spreadsheet formula injection.
          const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
          return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
        })
        .join(',')
    )
    .join('\n');
}
