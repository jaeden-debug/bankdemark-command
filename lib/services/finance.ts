// ============================================================
// FINANCE SERVICE
//
// The deterministic financial read layer. Everything the dashboard
// renders, every report, and every number Zylx quotes comes from here.
//
// The LLM never sees raw transactions to add up. It receives the typed
// results of these functions, each carrying its own period, currency,
// source and freshness, and explains them.
// ============================================================

import 'server-only';
import type { BusinessContext, Db } from './context';
import { ServiceError, unwrap } from './errors';
import {
  type LedgerTransaction,
  type LedgerTotals,
  computeAccountBalances,
  computeAttention,
  computeBusinessNetWorth,
  computeCashPosition,
  computeLiabilities,
  computeMonthlySeries,
  computeOwnerEquity,
  computeBrandPerformance,
  computeProjectProfitability,
  computeTotals,
  expensesByCategory,
  revenueByCategory,
  spendByCounterparty,
} from '@/lib/domain/ledger';

// ── Periods ─────────────────────────────────────────────────

export interface Period {
  from: string; // YYYY-MM-DD inclusive
  to: string;   // YYYY-MM-DD inclusive
  label: string;
}

export type PeriodPreset =
  | 'this_month' | 'last_month' | 'this_quarter' | 'this_year'
  | 'last_year' | 'last_30_days' | 'last_90_days' | 'all_time';

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function resolvePeriod(preset: PeriodPreset, now = new Date()): Period {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();

  switch (preset) {
    case 'this_month':
      return { from: iso(new Date(Date.UTC(y, m, 1))), to: iso(new Date(Date.UTC(y, m + 1, 0))), label: 'This month' };
    case 'last_month':
      return { from: iso(new Date(Date.UTC(y, m - 1, 1))), to: iso(new Date(Date.UTC(y, m, 0))), label: 'Last month' };
    case 'this_quarter': {
      const qStart = Math.floor(m / 3) * 3;
      return { from: iso(new Date(Date.UTC(y, qStart, 1))), to: iso(new Date(Date.UTC(y, qStart + 3, 0))), label: 'This quarter' };
    }
    case 'this_year':
      return { from: `${y}-01-01`, to: `${y}-12-31`, label: `${y}` };
    case 'last_year':
      return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31`, label: `${y - 1}` };
    case 'last_30_days':
      return { from: iso(new Date(now.getTime() - 29 * 86_400_000)), to: iso(now), label: 'Last 30 days' };
    case 'last_90_days':
      return { from: iso(new Date(now.getTime() - 89 * 86_400_000)), to: iso(now), label: 'Last 90 days' };
    case 'all_time':
      return { from: '1970-01-01', to: '2999-12-31', label: 'All time' };
  }
}

/** The immediately preceding period of equal length — for "vs last month". */
export function previousPeriod(period: Period): Period {
  const from = new Date(`${period.from}T00:00:00Z`);
  const to = new Date(`${period.to}T00:00:00Z`);
  const days = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
  const prevTo = new Date(from.getTime() - 86_400_000);
  const prevFrom = new Date(prevTo.getTime() - (days - 1) * 86_400_000);
  return { from: iso(prevFrom), to: iso(prevTo), label: 'Previous period' };
}

// ── Provenance ──────────────────────────────────────────────
// Every figure Zylx is given carries where it came from.

export type ClaimType = 'FACT' | 'CALCULATION' | 'ESTIMATE' | 'EXTERNAL_SOURCE' | 'SUGGESTION';

export interface Provenance {
  claimType: ClaimType;
  source: string;
  period?: Period;
  currency: string;
  /** Newest transaction date in scope — how current the answer really is. */
  dataThrough: string | null;
  /** Accounts whose provider data is stale or errored. */
  staleAccounts: string[];
  computedAt: string;
}

export interface Provenanced<T> {
  value: T;
  provenance: Provenance;
}

// ── Loading ─────────────────────────────────────────────────

const TX_COLUMNS =
  'id, account_id, occurred_on, amount_minor, currency, transaction_kind, gross_amount_minor, ' +
  'recognized_amount_minor, category_id, project_id, counterparty_id, brand_id, transfer_group_id, ' +
  'review_status, document_id, merchant, description, deleted_at';

/** Hard cap so a runaway query can never hydrate an entire ledger. */
const MAX_ROWS = 10_000;

export async function loadTransactions(
  db: Db,
  businessId: string,
  period: Period,
  options: { accountId?: string; projectId?: string; limit?: number } = {}
): Promise<LedgerTransaction[]> {
  let query = db
    .from('transactions')
    .select(TX_COLUMNS)
    .eq('business_id', businessId)
    .is('deleted_at', null)
    .gte('occurred_on', period.from)
    .lte('occurred_on', period.to)
    .order('occurred_on', { ascending: false })
    .limit(Math.min(options.limit ?? MAX_ROWS, MAX_ROWS));

  if (options.accountId) query = query.eq('account_id', options.accountId);
  if (options.projectId) query = query.eq('project_id', options.projectId);

  return unwrap(await query, 'load transactions') as unknown as LedgerTransaction[];
}

export interface AccountRow {
  id: string;
  name: string;
  account_kind: string;
  currency: string;
  opening_balance_minor: number;
  reported_balance_minor: number | null;
  balance_as_of: string | null;
  source: string;
  sync_status: string;
  last_synced_at: string | null;
  is_active: boolean;
}

export async function loadAccounts(db: Db, businessId: string): Promise<AccountRow[]> {
  return unwrap(
    await db
      .from('accounts')
      .select(
        'id, name, account_kind, currency, opening_balance_minor, reported_balance_minor, balance_as_of, source, sync_status, last_synced_at, is_active'
      )
      .eq('business_id', businessId)
      .eq('is_active', true)
      .order('created_at'),
    'load accounts'
  ) as unknown as AccountRow[];
}

// ── Freshness ───────────────────────────────────────────────

const STALE_AFTER_HOURS = 36;

export function assessFreshness(accounts: readonly AccountRow[]): {
  staleAccounts: string[];
  hasConnectedAccounts: boolean;
} {
  const stale: string[] = [];
  let connected = false;

  for (const account of accounts) {
    if (account.source === 'manual' || account.source === 'csv') continue;
    connected = true;

    if (account.sync_status === 'error' || account.sync_status === 'disconnected') {
      stale.push(account.name);
      continue;
    }
    if (!account.last_synced_at) {
      stale.push(account.name);
      continue;
    }
    const ageHours = (Date.now() - new Date(account.last_synced_at).getTime()) / 3_600_000;
    if (ageHours > STALE_AFTER_HOURS) stale.push(account.name);
  }

  return { staleAccounts: stale, hasConnectedAccounts: connected };
}

function buildProvenance(
  ctx: BusinessContext,
  period: Period,
  transactions: readonly LedgerTransaction[],
  accounts: readonly AccountRow[],
  claimType: ClaimType = 'CALCULATION',
  source = 'BankDeMark ledger'
): Provenance {
  const dates = transactions.map((t) => t.occurred_on).sort();
  return {
    claimType,
    source,
    period,
    currency: ctx.business.base_currency,
    dataThrough: dates.length ? dates[dates.length - 1] : null,
    staleAccounts: assessFreshness(accounts).staleAccounts,
    computedAt: new Date().toISOString(),
  };
}

// ── The financial snapshot that powers the dashboard ────────

export interface BusinessSnapshot {
  business: BusinessContext['business'];
  period: Period;
  totals: LedgerTotals;
  previousTotals: LedgerTotals;
  cashMinor: number;
  liabilitiesMinor: number;
  receivablesMinor: number;
  netWorth: { assetsMinor: number; liabilitiesMinor: number; netWorthMinor: number };
  equity: ReturnType<typeof computeOwnerEquity>;
  attention: ReturnType<typeof computeAttention>;
  monthly: ReturnType<typeof computeMonthlySeries>;
  expenseBreakdown: ReturnType<typeof expensesByCategory>;
  revenueBreakdown: ReturnType<typeof revenueByCategory>;
  accounts: AccountRow[];
  outstandingCommissionMinor: number;
  transactionCount: number;
  brandPerformance: ReturnType<typeof computeBrandPerformance>;
  brands: Array<{ id: string; name: string }>;
}

export async function getBusinessSnapshot(
  ctx: BusinessContext,
  period: Period
): Promise<Provenanced<BusinessSnapshot>> {
  const { db, businessId } = ctx;
  const currency = ctx.business.base_currency;

  const prev = previousPeriod(period);
  const allTime = resolvePeriod('all_time');

  const [accounts, periodTx, prevTx, allTx, commissionRows, brandRows] = await Promise.all([
    loadAccounts(db, businessId),
    loadTransactions(db, businessId, period),
    loadTransactions(db, businessId, prev),
    // Balances and net worth are inherently all-time.
    loadTransactions(db, businessId, allTime),
    db
      .from('bookings')
      .select('commission_expected_minor, commission_received_minor, commission_status, currency')
      .eq('business_id', businessId)
      .not('commission_status', 'in', '("cancelled","reversed")'),
    db.from('brands').select('id, name').eq('business_id', businessId).eq('is_active', true).order('sort_order'),
  ]);

  if (commissionRows.error) {
    throw new ServiceError('internal', 'Could not load commission totals.', {
      detail: commissionRows.error.message,
      cause: commissionRows.error,
    });
  }

  const totals = computeTotals(periodTx, currency);
  const previousTotals = computeTotals(prevTx, currency);

  const openingBalances = Object.fromEntries(
    accounts.map((a) => [a.id, a.opening_balance_minor])
  );
  const balances = computeAccountBalances(allTx, openingBalances);
  const accountKinds = Object.fromEntries(accounts.map((a) => [a.id, a.account_kind]));

  const cashMinor = computeCashPosition(balances, accountKinds);
  const liabilitiesMinor = computeLiabilities(balances, accountKinds);

  const outstandingCommissionMinor = (commissionRows.data ?? []).reduce(
    (sum, b) => sum + Math.max(0, (b.commission_expected_minor ?? 0) - (b.commission_received_minor ?? 0)),
    0
  );

  // Money owed to the business = unpaid commissions plus any receivable accounts.
  const receivableAccounts = balances
    .filter((b) => accountKinds[b.accountId] === 'receivable')
    .reduce((s, b) => s + b.ledgerBalanceMinor, 0);
  const receivablesMinor = outstandingCommissionMinor + receivableAccounts;

  const allTimeTotals = computeTotals(allTx, currency);

  return {
    value: {
      business: ctx.business,
      period,
      totals,
      previousTotals,
      cashMinor,
      liabilitiesMinor,
      receivablesMinor,
      netWorth: computeBusinessNetWorth({
        cashMinor,
        receivablesMinor,
        otherAssetsMinor: 0,
        liabilitiesMinor,
      }),
      equity: computeOwnerEquity(allTimeTotals),
      attention: computeAttention(allTx),
      monthly: computeMonthlySeries(allTx, currency),
      expenseBreakdown: expensesByCategory(periodTx),
      revenueBreakdown: revenueByCategory(periodTx),
      accounts,
      outstandingCommissionMinor,
      transactionCount: allTx.length,
      brandPerformance: computeBrandPerformance(periodTx),
      brands: (brandRows.data ?? []) as Array<{ id: string; name: string }>,
    },
    provenance: buildProvenance(ctx, period, allTx, accounts),
  };
}

// ── Focused queries (these become the Zylx tools) ───────────

export async function getRevenue(ctx: BusinessContext, period: Period) {
  const [tx, accounts] = await Promise.all([
    loadTransactions(ctx.db, ctx.businessId, period),
    loadAccounts(ctx.db, ctx.businessId),
  ]);
  const totals = computeTotals(tx, ctx.business.base_currency);
  return {
    value: {
      recognizedRevenueMinor: totals.recognizedRevenueMinor,
      grossVolumeMinor: totals.grossVolumeMinor,
      byCategory: revenueByCategory(tx),
      transactionCount: totals.transactionCount,
    },
    provenance: buildProvenance(ctx, period, tx, accounts),
  };
}

export async function getExpenses(ctx: BusinessContext, period: Period) {
  const [tx, accounts] = await Promise.all([
    loadTransactions(ctx.db, ctx.businessId, period),
    loadAccounts(ctx.db, ctx.businessId),
  ]);
  const totals = computeTotals(tx, ctx.business.base_currency);
  return {
    value: {
      expensesMinor: totals.expensesMinor,
      byCategory: expensesByCategory(tx),
      byVendor: spendByCounterparty(tx).slice(0, 20),
    },
    provenance: buildProvenance(ctx, period, tx, accounts),
  };
}

export async function getProfit(ctx: BusinessContext, period: Period) {
  const [tx, accounts] = await Promise.all([
    loadTransactions(ctx.db, ctx.businessId, period),
    loadAccounts(ctx.db, ctx.businessId),
  ]);
  const totals = computeTotals(tx, ctx.business.base_currency);
  return {
    value: {
      recognizedRevenueMinor: totals.recognizedRevenueMinor,
      expensesMinor: totals.expensesMinor,
      profitMinor: totals.profitMinor,
      marginPercent:
        totals.recognizedRevenueMinor === 0
          ? null
          : totals.profitMinor / totals.recognizedRevenueMinor,
    },
    provenance: buildProvenance(ctx, period, tx, accounts),
  };
}

export async function getCashPosition(ctx: BusinessContext) {
  const allTime = resolvePeriod('all_time');
  const [accounts, tx] = await Promise.all([
    loadAccounts(ctx.db, ctx.businessId),
    loadTransactions(ctx.db, ctx.businessId, allTime),
  ]);
  const balances = computeAccountBalances(
    tx,
    Object.fromEntries(accounts.map((a) => [a.id, a.opening_balance_minor]))
  );
  const kinds = Object.fromEntries(accounts.map((a) => [a.id, a.account_kind]));

  return {
    value: {
      cashMinor: computeCashPosition(balances, kinds),
      liabilitiesMinor: computeLiabilities(balances, kinds),
      byAccount: balances.map((b) => ({
        accountId: b.accountId,
        name: accounts.find((a) => a.id === b.accountId)?.name ?? 'Unknown account',
        kind: kinds[b.accountId] ?? 'other',
        balanceMinor: b.ledgerBalanceMinor,
      })),
    },
    provenance: buildProvenance(ctx, allTime, tx, accounts, 'FACT', 'BankDeMark ledger balances'),
  };
}

export async function getProjectProfitability(ctx: BusinessContext, period: Period) {
  const [tx, accounts, projects] = await Promise.all([
    loadTransactions(ctx.db, ctx.businessId, period),
    loadAccounts(ctx.db, ctx.businessId),
    ctx.db.from('projects').select('id, name').eq('business_id', ctx.businessId),
  ]);

  const nameById = new Map((projects.data ?? []).map((p) => [p.id, p.name]));
  const rows = computeProjectProfitability(tx).map((p) => ({
    ...p,
    projectName: nameById.get(p.projectId) ?? 'Unknown project',
  }));

  return { value: rows, provenance: buildProvenance(ctx, period, tx, accounts) };
}

export async function getOutstandingCommissions(ctx: BusinessContext) {
  const { data, error } = await ctx.db
    .from('bookings')
    .select(
      'id, reference, description, booking_date, service_date, gross_value_minor, commission_expected_minor, commission_received_minor, commission_status, currency, client_id'
    )
    .eq('business_id', ctx.businessId)
    .in('commission_status', ['expected', 'earned', 'receivable', 'partial'])
    .order('booking_date', { ascending: true });

  if (error) {
    throw new ServiceError('internal', 'Could not load outstanding commissions.', {
      detail: error.message,
      cause: error,
    });
  }

  const rows = (data ?? []).map((b) => ({
    ...b,
    outstandingMinor: Math.max(0, (b.commission_expected_minor ?? 0) - (b.commission_received_minor ?? 0)),
  }));

  return {
    value: {
      totalOutstandingMinor: rows.reduce((s, r) => s + r.outstandingMinor, 0),
      count: rows.length,
      bookings: rows,
    },
    provenance: {
      claimType: 'FACT' as ClaimType,
      source: 'BankDeMark bookings',
      currency: ctx.business.base_currency,
      dataThrough: rows.length ? rows[rows.length - 1].booking_date : null,
      staleAccounts: [],
      computedAt: new Date().toISOString(),
    },
  };
}

export async function findUncategorized(ctx: BusinessContext, limit = 50) {
  const { data, error } = await ctx.db
    .from('transactions')
    .select('id, occurred_on, amount_minor, currency, description, merchant, transaction_kind')
    .eq('business_id', ctx.businessId)
    .is('deleted_at', null)
    .is('category_id', null)
    .neq('transaction_kind', 'transfer')
    .order('occurred_on', { ascending: false })
    .limit(limit);

  if (error) {
    throw new ServiceError('internal', 'Could not load uncategorised transactions.', {
      detail: error.message,
      cause: error,
    });
  }
  return { value: { count: data?.length ?? 0, transactions: data ?? [] } };
}

export async function findMissingReceipts(ctx: BusinessContext, thresholdMinor = 2500, limit = 50) {
  const { data, error } = await ctx.db
    .from('transactions')
    .select('id, occurred_on, amount_minor, currency, description, merchant')
    .eq('business_id', ctx.businessId)
    .is('deleted_at', null)
    .is('document_id', null)
    .in('transaction_kind', ['expense', 'asset_purchase'])
    .lte('amount_minor', -thresholdMinor)
    .order('amount_minor', { ascending: true })
    .limit(limit);

  if (error) {
    throw new ServiceError('internal', 'Could not load transactions missing receipts.', {
      detail: error.message,
      cause: error,
    });
  }
  return { value: { count: data?.length ?? 0, transactions: data ?? [] } };
}

/**
 * Tax reserve ESTIMATE.
 *
 * Deliberately labelled an estimate with its assumptions attached.
 * BankDeMark does not know the business's deductions, instalments,
 * or personal situation and must never imply it does.
 */
export async function getTaxReserveEstimate(
  ctx: BusinessContext,
  period: Period,
  reserveRate = 0.25
) {
  const profit = await getProfit(ctx, period);
  const taxableMinor = Math.max(0, profit.value.profitMinor);

  return {
    value: {
      estimatedReserveMinor: Math.round(taxableMinor * reserveRate),
      basisProfitMinor: profit.value.profitMinor,
      reserveRate,
      assumptions: [
        `Applies a flat ${(reserveRate * 100).toFixed(0)}% set-aside rate to profit.`,
        'Ignores deductions, credits, instalments already paid, and personal income.',
        'Not a tax filing, a tax calculation, or professional tax advice.',
      ],
    },
    provenance: { ...profit.provenance, claimType: 'ESTIMATE' as ClaimType },
  };
}
