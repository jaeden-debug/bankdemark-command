import { formatMinor, money, parseMajorToMinor, type CurrencyCode, type Money } from '@/lib/domain/money';

export interface DisplayMoney extends Money {
  readonly unit: 'minor_currency_units';
  readonly display: string;
}

export function displayMoney(minor: number, currency: CurrencyCode): DisplayMoney {
  return {
    ...money(minor, currency),
    unit: 'minor_currency_units',
    display: formatMinor(minor, currency, { showMinor: true }),
  };
}

export interface FinancialToolRoute {
  tool: string;
  enforcedArgs: Record<string, unknown>;
}

const EDUCATIONAL = /^\s*(what (?:is|are|does)|define|explain|how does)\b/i;
const WORKSPACE_WORDS = /\b(my|our|this business|current|currently|latest|show|list|how much|how many|total|balance|owed|bookings?|invoices?|expenses?|revenue|profit|transactions?|commissions?|cash|paid|pending|unpaid|overdue|receivables?|pipeline|reports?|anomal(?:y|ies)|suspicious|chart|graph)\b/i;
const PERSONAL_WORDS = /\b(my|our|this business|current|currently|latest|show|list|how much|how many|total|balance|owed)\b/i;

export function requiresWorkspaceFinancialTool(message: string): boolean {
  if (EDUCATIONAL.test(message) && !PERSONAL_WORDS.test(message)) return false;
  return WORKSPACE_WORDS.test(message);
}

export function routeWorkspaceFinancialTool(
  message: string,
  currency: CurrencyCode
): FinancialToolRoute | null {
  if (!requiresWorkspaceFinancialTool(message)) return null;
  const q = message.toLowerCase();

  if (/\b(chart|graph)\b/.test(q) && /\bcommission/.test(q)) {
    return { tool: 'get_commission_chart_data', enforcedArgs: {} };
  }
  if (/\b(anomal|suspicious|needs? attention)\b/.test(q) && /\b(report|commission)/.test(q)) {
    return { tool: 'get_commission_anomalies', enforcedArgs: {} };
  }
  if (/\bbookings?\b/.test(q)) {
    const args: Record<string, unknown> = {};
    const threshold = message.match(/\b(over|above|more than|greater than|at least|minimum|min)\s*(?:cad\s*)?\$?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i);
    if (threshold) {
      args.minCommissionMinor = parseMajorToMinor(threshold[2], currency);
      args.minCommissionExclusive = /^(over|above|more than|greater than)$/i.test(threshold[1]);
    }
    if (/\b(unpaid|pending|outstanding)\b/.test(q)) args.status = 'pending';
    if (/\bpaid\b/.test(q) && !/\bunpaid\b/.test(q)) args.status = 'paid';
    return { tool: 'get_bookings', enforcedArgs: args };
  }
  if (/\b(pending|unpaid|outstanding|owed)\b/.test(q) && /\bcommission/.test(q)) {
    return { tool: 'get_outstanding_commissions', enforcedArgs: {} };
  }
  if (/\bcommission pipeline\b/.test(q) || (/\bmoney received\b/.test(q) && /\bcommission/.test(q))) {
    return { tool: 'get_commission_pipeline', enforcedArgs: {} };
  }
  if (/\boverdue invoices?\b/.test(q)) return { tool: 'get_overdue_invoices', enforcedArgs: {} };
  if (/\b(invoice|receivable)/.test(q) && /\b(balance|outstanding|owed|unpaid|total)/.test(q)) {
    return { tool: 'get_receivables_position', enforcedArgs: {} };
  }
  if (/\bexpenses?\b/.test(q)) return { tool: 'get_expenses', enforcedArgs: {} };
  if (/\brevenue\b|\bmoney received\b|\bmoney in\b/.test(q)) return { tool: 'get_revenue', enforcedArgs: {} };
  if (/\bprofit\b/.test(q)) return { tool: 'get_profit', enforcedArgs: {} };
  if (/\bcash\b/.test(q)) return { tool: 'get_cash_position', enforcedArgs: {} };
  if (/\btransactions?\b/.test(q)) return { tool: 'search_transactions', enforcedArgs: {} };
  if (/\bcommission reports?\b/.test(q)) return { tool: 'get_commission_report', enforcedArgs: {} };
  return null;
}

/** Add explicit minor-unit semantics before any tool payload reaches the model. */
export function moneySafeForModel(value: unknown, currency: CurrencyCode): unknown {
  if (Array.isArray(value)) return value.map((item) => moneySafeForModel(item, currency));
  if (!value || typeof value !== 'object') return value;
  const source = value as Record<string, unknown>;
  if (
    typeof source.minor === 'number' &&
    typeof source.currency === 'string' &&
    typeof source.display === 'string'
  ) return source;

  return Object.fromEntries(Object.entries(source).map(([key, item]) => {
    if (typeof item === 'number' && /Minor$/.test(key)) {
      return [key.replace(/Minor$/, ''), displayMoney(item, currency)];
    }
    return [key, moneySafeForModel(item, currency)];
  }));
}

function collectDisplays(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) for (const item of value) collectDisplays(item, out);
  else if (value && typeof value === 'object') {
    const row = value as Record<string, unknown>;
    if (typeof row.display === 'string' && typeof row.minor === 'number') out.add(row.display);
    for (const item of Object.values(row)) collectDisplays(item, out);
  }
  return out;
}

function deterministicFallback(result: Record<string, unknown>): string {
  const tool = String(result.tool ?? '');
  const data = (result.data ?? {}) as Record<string, unknown>;
  const formatted = (result.formatted ?? {}) as Record<string, string>;
  if (tool === 'get_bookings') {
    const rows = Array.isArray(data.bookings) ? data.bookings as Array<Record<string, unknown>> : [];
    if (!rows.length) return 'No matching bookings were found in your current BankDeMark records.';
    return rows.map((row) => {
      const amount = row.expectedCommission as DisplayMoney | undefined;
      return `${String(row.reference ?? 'Booking')}: ${amount?.display ?? 'amount unavailable'} (${String(row.status ?? 'status unavailable')}).`;
    }).join(' ');
  }
  if (tool === 'get_commission_chart_data') {
    const series = Array.isArray(data.series) ? data.series as Array<Record<string, unknown>> : [];
    const lines: string[] = [];
    for (const item of series) for (const point of (Array.isArray(item.points) ? item.points : []) as Array<Record<string, unknown>>) {
      const amount = point.amount as DisplayMoney | undefined;
      if (amount) lines.push(`${String(point.x)} ${String(item.label)}: ${amount.display}`);
    }
    return lines.length ? `Paid versus pending commission: ${lines.join('; ')}.` : 'No commission chart data is available.';
  }
  const values = Object.entries(formatted).filter(([, value]) => typeof value === 'string');
  if (values.length) return values.map(([key, value]) => `${key}: ${value}`).join('. ') + '.';
  return 'I retrieved your current BankDeMark records, but could not safely format an answer.';
}

const MONEY_TOKEN = /(?:CA\$|US\$|\$|€|£)\s?[0-9][0-9,]*(?:\.\d{1,2})?/g;

export function verifiedFinancialAnswer(
  answer: string,
  modelSafeResult: Record<string, unknown> | null
): string {
  if (!modelSafeResult || modelSafeResult.ok !== true) {
    return 'I couldn’t retrieve your current BankDeMark records for that question.';
  }
  const allowed = collectDisplays(modelSafeResult);
  const mentioned = answer.match(MONEY_TOKEN) ?? [];
  if (mentioned.some((amount) => !allowed.has(amount))) return deterministicFallback(modelSafeResult);
  return answer.trim() || deterministicFallback(modelSafeResult);
}
