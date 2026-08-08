// ============================================================
// ZYLX FINANCIAL TOOLS
//
// The contract between the model and the ledger.
//
// Zylx never receives raw transactions to add up. It calls a tool, the
// backend computes the number deterministically, and Zylx explains the
// result. Every tool result carries its own provenance so Zylx can
// state whether something is a FACT, a CALCULATION or an ESTIMATE.
//
// Write tools never mutate anything directly. They return a PROPOSAL
// which the user must approve in the UI; only then does the approved
// proposal go through the normal transaction service, with an audit
// entry recording that Zylx originated it.
// ============================================================

import 'server-only';
import type { BusinessContext } from '@/lib/services/context';
import { ServiceError } from '@/lib/services/errors';
import {
  findMissingReceipts,
  findUncategorized,
  getBusinessSnapshot,
  getCashPosition,
  getExpenses,
  getOutstandingCommissions,
  getProfit,
  getProjectProfitability,
  getRevenue,
  getTaxReserveEstimate,
  previousPeriod,
  resolvePeriod,
  loadTransactions,
  type Period,
  type PeriodPreset,
} from '@/lib/services/finance';
import { formatMinor } from '@/lib/domain/money';
import { computeBrandPerformance } from '@/lib/domain/ledger';
import { TRANSACTION_KINDS, type TransactionKind } from '@/lib/domain/semantics';
import { isEnabled } from '@/lib/services/entitlements';

export type ToolRisk = 'read' | 'propose';

export interface ToolDefinition {
  name: string;
  description: string;
  risk: ToolRisk;
  /** Capability that must be enabled for this tool to be offered. */
  capability?: 'web_search' | 'ai_writes';
  parameters: Record<string, unknown>;
}

const PERIOD_ENUM: PeriodPreset[] = [
  'this_month', 'last_month', 'this_quarter', 'this_year',
  'last_year', 'last_30_days', 'last_90_days', 'all_time',
];

const periodParam = {
  type: 'object',
  properties: {
    period: { type: 'string', enum: PERIOD_ENUM, description: 'Named period to report on.' },
    from: { type: 'string', description: 'Custom start date YYYY-MM-DD. Overrides `period`.' },
    to: { type: 'string', description: 'Custom end date YYYY-MM-DD. Overrides `period`.' },
  },
  required: [],
  additionalProperties: false,
};

// ============================================================
// TOOL CATALOGUE
// ============================================================

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'get_business_summary',
    description:
      'Cash, revenue, expenses, profit, receivables, liabilities and what needs attention, for a period. Use this first for broad questions like "how are we doing?".',
    risk: 'read',
    parameters: periodParam,
  },
  {
    name: 'get_revenue',
    description:
      'Recognized revenue and gross booking/sale volume for a period, broken down by category. Recognized revenue is the honest top line; gross volume can be much larger for commission businesses.',
    risk: 'read',
    parameters: periodParam,
  },
  {
    name: 'get_expenses',
    description: 'Total expenses for a period, broken down by category and by vendor.',
    risk: 'read',
    parameters: periodParam,
  },
  {
    name: 'get_profit',
    description: 'Revenue minus expenses, with margin, for a period.',
    risk: 'read',
    parameters: periodParam,
  },
  {
    name: 'get_cash_position',
    description:
      'Current cash across bank and cash accounts, plus liabilities, with a per-account breakdown. Cash is not profit — use this when asked about money available.',
    risk: 'read',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'compare_periods',
    description:
      'Compare revenue, expenses and profit between a period and the equivalent period before it. Use for "what changed?" and "how does this month compare?".',
    risk: 'read',
    parameters: periodParam,
  },
  {
    name: 'get_outstanding_commissions',
    description:
      'Bookings where commission has been earned but not yet received, with the total outstanding. Use for "who owes me?" and "what commission am I waiting for?".',
    risk: 'read',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_brand_performance',
    description:
      'Revenue, costs, profit and margin for each brand inside this business. Brands are trade names of ONE legal entity sharing one set of books and one tax filing — this splits the view only. Shared company-wide amounts are reported separately and are never allocated across brands.',
    risk: 'read',
    parameters: periodParam,
  },
  {
    name: 'get_project_profitability',
    description: 'Revenue, expenses, profit and margin for each project in a period.',
    risk: 'read',
    parameters: periodParam,
  },
  {
    name: 'get_tax_reserve_estimate',
    description:
      'An ESTIMATE of how much to set aside for tax, based on profit and a flat rate. Always present the stated assumptions with it. This is not a tax calculation or tax advice.',
    risk: 'read',
    parameters: {
      type: 'object',
      properties: {
        period: { type: 'string', enum: PERIOD_ENUM },
        reserve_rate: { type: 'number', description: 'Set-aside rate, e.g. 0.25 for 25%. Defaults to 0.25.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'find_uncategorized',
    description: 'Transactions with no category yet. Use when the user asks what needs review or cleanup.',
    risk: 'read',
    parameters: {
      type: 'object',
      properties: { limit: { type: 'number', description: 'Max rows, default 50.' } },
      additionalProperties: false,
    },
  },
  {
    name: 'find_missing_receipts',
    description: 'Expenses above a threshold with no receipt attached.',
    risk: 'read',
    parameters: {
      type: 'object',
      properties: {
        threshold_major: { type: 'number', description: 'Minimum expense size in dollars. Defaults to 25.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'propose_transaction',
    description:
      'Propose recording an expense or income. This does NOT write anything — it returns a proposal the user must approve. Use when the user says something like "log $82.54 on Facebook ads yesterday".',
    risk: 'propose',
    capability: 'ai_writes',
    parameters: {
      type: 'object',
      properties: {
        transaction_kind: { type: 'string', enum: [...TRANSACTION_KINDS] },
        amount_major: { type: 'number', description: 'Amount in dollars, always positive. The type decides the direction.' },
        occurred_on: { type: 'string', description: 'YYYY-MM-DD.' },
        description: { type: 'string' },
        merchant: { type: 'string' },
        account_name: { type: 'string', description: 'Which account it went through, if the user said.' },
        category_slug: { type: 'string', description: 'Best-guess category slug, e.g. "advertising".' },
      },
      required: ['transaction_kind', 'amount_major', 'occurred_on', 'description'],
      additionalProperties: false,
    },
  },
];

export function toolsForContext(plan: string | null | undefined): ToolDefinition[] {
  return TOOL_DEFINITIONS.filter(
    (t) => !t.capability || isEnabled(plan, t.capability)
  );
}

// ============================================================
// EXECUTION
// ============================================================

export interface ToolResult {
  ok: boolean;
  tool: string;
  /** Machine-readable payload the model explains rather than recomputes. */
  data?: unknown;
  /** Pre-formatted headline figures. The model must quote these verbatim. */
  formatted?: Record<string, string>;
  provenance?: unknown;
  proposal?: TransactionProposal;
  error?: string;
}

export interface TransactionProposal {
  kind: 'transaction';
  transactionKind: TransactionKind;
  amountMajor: number;
  occurredOn: string;
  description: string;
  merchant?: string;
  accountId?: string;
  accountName?: string;
  categoryId?: string;
  categorySlug?: string;
  /** Human-readable summary shown on the approval card. */
  summary: string;
  warnings: string[];
}

function periodFromArgs(args: Record<string, unknown>): Period {
  const from = typeof args.from === 'string' ? args.from : null;
  const to = typeof args.to === 'string' ? args.to : null;
  if (from && to) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      throw new ServiceError('validation', 'Dates must be YYYY-MM-DD.');
    }
    return { from, to, label: `${from} to ${to}` };
  }
  const preset = (typeof args.period === 'string' ? args.period : 'this_month') as PeriodPreset;
  return resolvePeriod(PERIOD_ENUM.includes(preset) ? preset : 'this_month');
}

export async function executeTool(
  ctx: BusinessContext,
  name: string,
  rawArgs: unknown
): Promise<ToolResult> {
  const args = (rawArgs && typeof rawArgs === 'object' ? rawArgs : {}) as Record<string, unknown>;
  const currency = ctx.business.base_currency;
  const fmt = (minor: number) => formatMinor(minor, currency, { showMinor: true });

  try {
    switch (name) {
      case 'get_business_summary': {
        const period = periodFromArgs(args);
        const { value, provenance } = await getBusinessSnapshot(ctx, period);
        return {
          ok: true,
          tool: name,
          data: {
            period: value.period,
            recognizedRevenueMinor: value.totals.recognizedRevenueMinor,
            grossVolumeMinor: value.totals.grossVolumeMinor,
            expensesMinor: value.totals.expensesMinor,
            profitMinor: value.totals.profitMinor,
            cashMinor: value.cashMinor,
            liabilitiesMinor: value.liabilitiesMinor,
            receivablesMinor: value.receivablesMinor,
            netWorthMinor: value.netWorth.netWorthMinor,
            attention: value.attention,
            transactionCount: value.transactionCount,
          },
          formatted: {
            period: value.period.label,
            recognizedRevenue: fmt(value.totals.recognizedRevenueMinor),
            grossVolume: fmt(value.totals.grossVolumeMinor),
            expenses: fmt(value.totals.expensesMinor),
            profit: fmt(value.totals.profitMinor),
            cash: fmt(value.cashMinor),
            liabilities: fmt(value.liabilitiesMinor),
            owedToYou: fmt(value.receivablesMinor),
            businessNetWorth: fmt(value.netWorth.netWorthMinor),
          },
          provenance,
        };
      }

      case 'get_revenue': {
        const period = periodFromArgs(args);
        const { value, provenance } = await getRevenue(ctx, period);
        return {
          ok: true,
          tool: name,
          data: { ...value, period },
          formatted: {
            period: period.label,
            recognizedRevenue: fmt(value.recognizedRevenueMinor),
            grossVolume: fmt(value.grossVolumeMinor),
          },
          provenance,
        };
      }

      case 'get_expenses': {
        const period = periodFromArgs(args);
        const { value, provenance } = await getExpenses(ctx, period);
        return {
          ok: true,
          tool: name,
          data: { ...value, period },
          formatted: { period: period.label, expenses: fmt(value.expensesMinor) },
          provenance,
        };
      }

      case 'get_profit': {
        const period = periodFromArgs(args);
        const { value, provenance } = await getProfit(ctx, period);
        return {
          ok: true,
          tool: name,
          data: { ...value, period },
          formatted: {
            period: period.label,
            revenue: fmt(value.recognizedRevenueMinor),
            expenses: fmt(value.expensesMinor),
            profit: fmt(value.profitMinor),
            margin: value.marginPercent === null ? 'n/a' : `${(value.marginPercent * 100).toFixed(1)}%`,
          },
          provenance,
        };
      }

      case 'get_cash_position': {
        const { value, provenance } = await getCashPosition(ctx);
        return {
          ok: true,
          tool: name,
          data: value,
          formatted: {
            cash: fmt(value.cashMinor),
            liabilities: fmt(value.liabilitiesMinor),
          },
          provenance,
        };
      }

      case 'compare_periods': {
        const period = periodFromArgs(args);
        const prev = previousPeriod(period);
        const [current, previous] = await Promise.all([getProfit(ctx, period), getProfit(ctx, prev)]);
        const delta = (a: number, b: number) => (b === 0 ? null : (a - b) / Math.abs(b));

        return {
          ok: true,
          tool: name,
          data: {
            current: { ...current.value, period },
            previous: { ...previous.value, period: prev },
            revenueChange: delta(current.value.recognizedRevenueMinor, previous.value.recognizedRevenueMinor),
            expenseChange: delta(current.value.expensesMinor, previous.value.expensesMinor),
            profitChange: delta(current.value.profitMinor, previous.value.profitMinor),
          },
          formatted: {
            currentPeriod: period.label,
            currentRevenue: fmt(current.value.recognizedRevenueMinor),
            currentProfit: fmt(current.value.profitMinor),
            previousRevenue: fmt(previous.value.recognizedRevenueMinor),
            previousProfit: fmt(previous.value.profitMinor),
          },
          provenance: current.provenance,
        };
      }

      case 'get_outstanding_commissions': {
        const { value, provenance } = await getOutstandingCommissions(ctx);
        return {
          ok: true,
          tool: name,
          data: value,
          formatted: {
            totalOutstanding: fmt(value.totalOutstandingMinor),
            bookingCount: String(value.count),
          },
          provenance,
        };
      }

      case 'get_brand_performance': {
        const period = periodFromArgs(args);
        const [tx, brandsRes] = await Promise.all([
          loadTransactions(ctx.db, ctx.businessId, period),
          ctx.db.from('brands').select('id, name').eq('business_id', ctx.businessId).eq('is_active', true),
        ]);
        const nameById = new Map((brandsRes.data ?? []).map((b) => [b.id, b.name]));
        const perf = computeBrandPerformance(tx);

        return {
          ok: true,
          tool: name,
          data: {
            period,
            brands: perf.brands.map((b) => ({
              name: nameById.get(b.brandId) ?? 'Unknown brand',
              revenue: fmt(b.revenueMinor),
              expenses: fmt(b.expensesMinor),
              profit: fmt(b.profitMinor),
              margin: b.margin === null ? 'n/a' : `${(b.margin * 100).toFixed(1)}%`,
              revenueSharePercent: `${(b.revenueShare * 100).toFixed(1)}%`,
            })),
            sharedRevenue: fmt(perf.unassignedRevenueMinor),
            sharedExpenses: fmt(perf.unassignedExpensesMinor),
            note: 'Shared amounts are company-wide and deliberately not split across brands.',
          },
          formatted: { period: period.label, brandCount: String(perf.brands.length) },
        };
      }

      case 'get_project_profitability': {
        const period = periodFromArgs(args);
        const { value, provenance } = await getProjectProfitability(ctx, period);
        return {
          ok: true,
          tool: name,
          data: value.map((p) => ({
            ...p,
            revenueFormatted: fmt(p.revenueMinor),
            expensesFormatted: fmt(p.expensesMinor),
            profitFormatted: fmt(p.profitMinor),
            marginFormatted: p.margin === null ? 'n/a' : `${(p.margin * 100).toFixed(1)}%`,
          })),
          provenance,
        };
      }

      case 'get_tax_reserve_estimate': {
        const period = periodFromArgs(args);
        const rate = typeof args.reserve_rate === 'number' ? args.reserve_rate : 0.25;
        if (rate <= 0 || rate >= 1) {
          throw new ServiceError('validation', 'Reserve rate must be between 0 and 1.');
        }
        const { value, provenance } = await getTaxReserveEstimate(ctx, period, rate);
        return {
          ok: true,
          tool: name,
          data: value,
          formatted: {
            period: period.label,
            estimatedReserve: fmt(value.estimatedReserveMinor),
            basisProfit: fmt(value.basisProfitMinor),
          },
          provenance,
        };
      }

      case 'find_uncategorized': {
        const limit = typeof args.limit === 'number' ? Math.min(args.limit, 100) : 50;
        const { value } = await findUncategorized(ctx, limit);
        return { ok: true, tool: name, data: value, formatted: { count: String(value.count) } };
      }

      case 'find_missing_receipts': {
        const thresholdMajor = typeof args.threshold_major === 'number' ? args.threshold_major : 25;
        const { value } = await findMissingReceipts(ctx, Math.round(thresholdMajor * 100));
        return { ok: true, tool: name, data: value, formatted: { count: String(value.count) } };
      }

      case 'propose_transaction':
        return await proposeTransaction(ctx, args);

      default:
        return { ok: false, tool: name, error: `Unknown tool: ${name}` };
    }
  } catch (error) {
    const message =
      error instanceof ServiceError ? error.message : 'That lookup failed. Please try again.';
    return { ok: false, tool: name, error: message };
  }
}

// ── Write proposal (never a direct mutation) ────────────────

async function proposeTransaction(
  ctx: BusinessContext,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const kind = args.transaction_kind as TransactionKind;
  if (!TRANSACTION_KINDS.includes(kind)) {
    return { ok: false, tool: 'propose_transaction', error: `Unknown transaction type: ${String(kind)}` };
  }

  const amountMajor = Number(args.amount_major);
  if (!Number.isFinite(amountMajor) || amountMajor <= 0) {
    return { ok: false, tool: 'propose_transaction', error: 'Amount must be a positive number.' };
  }

  const occurredOn = String(args.occurred_on ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(occurredOn)) {
    return { ok: false, tool: 'propose_transaction', error: 'Date must be YYYY-MM-DD.' };
  }

  const description = String(args.description ?? '').trim();
  if (!description) {
    return { ok: false, tool: 'propose_transaction', error: 'A description is required.' };
  }

  // Resolve names to ids server-side so the model never invents an id.
  const [accountsRes, categoriesRes] = await Promise.all([
    ctx.db.from('accounts').select('id, name, account_kind').eq('business_id', ctx.businessId).eq('is_active', true),
    ctx.db.from('categories').select('id, name, slug, kind').or(`business_id.eq.${ctx.businessId},business_id.is.null`),
  ]);

  const accounts = accountsRes.data ?? [];
  const categories = categoriesRes.data ?? [];
  const warnings: string[] = [];

  const requestedAccount = typeof args.account_name === 'string' ? args.account_name.toLowerCase() : null;
  let account = requestedAccount
    ? accounts.find((a) => a.name.toLowerCase().includes(requestedAccount))
    : undefined;
  if (!account) {
    account = accounts.find((a) => a.account_kind === 'bank') ?? accounts[0];
    if (requestedAccount) warnings.push(`Could not find an account matching "${args.account_name}".`);
  }
  if (!account) {
    return {
      ok: false,
      tool: 'propose_transaction',
      error: 'This business has no accounts yet. Add an account first.',
    };
  }

  const slug = typeof args.category_slug === 'string' ? args.category_slug : null;
  const category = slug ? categories.find((c) => c.slug === slug) : undefined;
  if (slug && !category) warnings.push(`Could not find a category called "${slug}" — left uncategorised.`);

  const summary = `${kind === 'income' || kind === 'commission' ? 'Money in' : 'Money out'} · ${formatMinor(
    Math.round(amountMajor * 100),
    ctx.business.base_currency,
    { showMinor: true }
  )} · ${description} · ${occurredOn} · ${account.name}`;

  return {
    ok: true,
    tool: 'propose_transaction',
    proposal: {
      kind: 'transaction',
      transactionKind: kind,
      amountMajor,
      occurredOn,
      description,
      merchant: typeof args.merchant === 'string' ? args.merchant : undefined,
      accountId: account.id,
      accountName: account.name,
      categoryId: category?.id,
      categorySlug: category?.slug,
      summary,
      warnings,
    },
    formatted: { summary },
  };
}
