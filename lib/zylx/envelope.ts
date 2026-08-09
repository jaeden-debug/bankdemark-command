// ============================================================
// ZYLX RESPONSE ENVELOPE
//
// Everything Zylx renders — today text, metrics, tables and proposals;
// later charts, receipts and source cards — arrives as a typed block.
//
// Three properties make this safe to grow into:
//
//   1. The renderer uses an ALLOW-LIST. An unknown block type is
//      dropped, never rendered. The model cannot name a React component.
//   2. Money is carried as pre-formatted strings produced by the
//      deterministic engine, plus the raw minor units for sorting. The
//      model never formats or re-derives a figure.
//   3. Blocks are built SERVER-SIDE from tool results, not emitted by
//      the model. The model chooses which tool to call; the server
//      decides what a result looks like.
//
// Adding a block type later means: add to `ZylxBlock`, add a renderer
// case, add it to the allow-list. Nothing else changes.
// ============================================================

/** Every block type the renderer will accept. Anything else is dropped. */
export const ALLOWED_BLOCK_TYPES = [
  'metric',
  'table',
  'proposal',
  'source',
  // Reserved — schemas exist so the envelope does not need reshaping
  // when these ship. Not emitted yet.
  'chart',
  'document',
] as const;

export type ZylxBlockType = (typeof ALLOWED_BLOCK_TYPES)[number];

/** A figure that came from the deterministic engine, never from the model. */
export interface ZylxFigure {
  label: string;
  /** Pre-formatted by the backend in the business's currency. Display this. */
  formatted: string;
  /** Raw minor units, for sorting and client-side comparison only. */
  minor?: number;
  /** Fractional change vs the comparison period, e.g. 0.14 for +14%. */
  change?: number | null;
  /** Whether an increase is good. Expenses rising is not. */
  goodWhen?: 'up' | 'down';
  hint?: string;
}

export interface ZylxMetricBlock {
  type: 'metric';
  title?: string;
  figures: ZylxFigure[];
}

export interface ZylxTableBlock {
  type: 'table';
  title?: string;
  columns: Array<{ key: string; label: string; align?: 'left' | 'right' }>;
  rows: Array<Record<string, string | number | null>>;
  /** Present when the underlying result was capped. */
  truncated?: { shown: number; total: number };
  /** Deep link into the app for the full set. */
  href?: string;
}

/** A write the user must approve. Mirrors what /api/zylx/approve accepts. */
export interface ZylxProposalBlock {
  type: 'proposal';
  kind: string;
  summary: string;
  warnings: string[];
  /** Opaque to the client; re-validated server-side on approval. */
  payload: Record<string, unknown>;
}

/** Where a figure came from, so a number can be traced rather than trusted. */
export interface ZylxSourceBlock {
  type: 'source';
  label: string;
  detail?: string;
  href?: string;
  /** ISO date of the newest record in scope. */
  dataThrough?: string | null;
  /** Accounts whose data may be stale. */
  staleAccounts?: string[];
}

/** Reserved. Schema fixed now so the envelope survives adding charts. */
export interface ZylxChartBlock {
  type: 'chart';
  title?: string;
  chartKind: 'bar' | 'line' | 'stacked-bar';
  series: Array<{
    label: string;
    points: Array<{
      x: string;
      amount: { minor: number; currency: string; unit: 'minor_currency_units'; display: string };
    }>;
  }>;
  yFormat: 'currency' | 'number' | 'percent';
  currency?: string;
}

/** Reserved. For receipts and statements once document work lands. */
export interface ZylxDocumentBlock {
  type: 'document';
  documentId: string;
  title: string;
  docType: string;
  extracted?: Record<string, string>;
  confidence?: number;
}

export type ZylxBlock =
  | ZylxMetricBlock
  | ZylxTableBlock
  | ZylxProposalBlock
  | ZylxSourceBlock
  | ZylxChartBlock
  | ZylxDocumentBlock;

export interface ZylxResponse {
  text: string;
  blocks: ZylxBlock[];
  conversationId: string | null;
  /** Names only — never arguments, which can contain private detail. */
  toolsUsed: string[];
  usage?: { used: number; limit: number | null };
}

/**
 * Drop anything not on the allow-list.
 *
 * Blocks are server-built today, so this is belt-and-braces. It stays
 * because the cost of a malformed block reaching the renderer is a
 * crashed chat, and the cost of an *unexpected* block type is worse.
 */
export function sanitizeBlocks(blocks: unknown): ZylxBlock[] {
  if (!Array.isArray(blocks)) return [];

  return blocks.filter((b): b is ZylxBlock => {
    if (!b || typeof b !== 'object') return false;
    const type = (b as { type?: unknown }).type;
    return typeof type === 'string' && (ALLOWED_BLOCK_TYPES as readonly string[]).includes(type);
  });
}

// ============================================================
// SERVER-SIDE BUILDERS
//
// Tool results are shaped into blocks here. Each builder reads the
// `formatted` strings the deterministic layer produced — it never
// formats a number itself.
// ============================================================

interface ToolResultLike {
  ok: boolean;
  tool: string;
  data?: unknown;
  formatted?: Record<string, string>;
  provenance?: unknown;
  proposal?: unknown;
}

/** Which `formatted` keys become headline figures, per tool. */
const METRIC_LAYOUT: Record<string, Array<{ key: string; label: string; goodWhen?: 'up' | 'down' }>> = {
  get_business_summary: [
    { key: 'cash', label: 'Cash on hand' },
    { key: 'recognizedRevenue', label: 'Money in', goodWhen: 'up' },
    { key: 'expenses', label: 'Money out', goodWhen: 'down' },
    { key: 'profit', label: 'Profit', goodWhen: 'up' },
  ],
  get_profit: [
    { key: 'revenue', label: 'Money in', goodWhen: 'up' },
    { key: 'expenses', label: 'Money out', goodWhen: 'down' },
    { key: 'profit', label: 'Profit', goodWhen: 'up' },
    { key: 'margin', label: 'Margin' },
  ],
  get_profit_and_loss: [
    { key: 'revenue', label: 'Money in', goodWhen: 'up' },
    { key: 'expenses', label: 'Money out', goodWhen: 'down' },
    { key: 'profit', label: 'Profit', goodWhen: 'up' },
    { key: 'margin', label: 'Margin' },
  ],
  get_revenue: [
    { key: 'recognizedRevenue', label: 'Money in', goodWhen: 'up' },
    { key: 'grossVolume', label: 'Sale value handled' },
  ],
  get_cash_position: [
    { key: 'cash', label: 'Cash on hand' },
    { key: 'liabilities', label: 'What you owe', goodWhen: 'down' },
  ],
  get_outstanding_commissions: [
    { key: 'totalOutstanding', label: 'Still owed to you' },
    { key: 'bookingCount', label: 'Bookings' },
  ],
  get_commission_pipeline: [
    { key: 'paid', label: 'Money received' },
    { key: 'pending', label: 'Pending commission' },
    { key: 'completedCount', label: 'Completed, unpaid' },
    { key: 'average', label: 'Average commission' },
  ],
  search_transactions: [
    { key: 'totalOut', label: 'Money out', goodWhen: 'down' },
    { key: 'totalIn', label: 'Money in', goodWhen: 'up' },
    { key: 'matchCount', label: 'Matches' },
  ],
};

export function buildBlocks(results: readonly ToolResultLike[]): ZylxBlock[] {
  const blocks: ZylxBlock[] = [];

  for (const result of results) {
    if (!result.ok) continue;

    // ── Metrics ───────────────────────────────────────────
    const layout = METRIC_LAYOUT[result.tool];
    if (layout && result.formatted) {
      const figures = layout
        .filter((f) => result.formatted?.[f.key])
        .map((f) => ({
          label: f.label,
          formatted: result.formatted![f.key],
          goodWhen: f.goodWhen,
        }));

      if (figures.length > 0) {
        blocks.push({
          type: 'metric',
          title: result.formatted.period ?? undefined,
          figures,
        });
      }
    }

    // ── Tables ────────────────────────────────────────────
    const data = result.data as Record<string, unknown> | undefined;

    if (result.tool === 'search_transactions' && data && Array.isArray(data.transactions)) {
      const rows = data.transactions as Array<Record<string, unknown>>;
      if (rows.length > 0) {
        blocks.push({
          type: 'table',
          columns: [
            { key: 'date', label: 'Date' },
            { key: 'description', label: 'Description' },
            { key: 'amount', label: 'Amount', align: 'right' },
          ],
          rows: rows.map((r) => ({
            date: String(r.date ?? ''),
            description: String(r.description ?? ''),
            amount: String(r.amount ?? ''),
          })),
          truncated:
            data.truncated === true
              ? { shown: Number(data.returnedCount ?? rows.length), total: Number(data.matchCount ?? 0) }
              : undefined,
        });
      }
    }

    if (result.tool === 'get_portfolio_summary' && data && Array.isArray(data.businesses)) {
      const rows = data.businesses as Array<Record<string, unknown>>;
      if (rows.length > 0) {
        blocks.push({
          type: 'table',
          title: 'Your businesses',
          columns: [
            { key: 'name', label: 'Business' },
            { key: 'revenue', label: 'Money in', align: 'right' },
            { key: 'profit', label: 'Profit', align: 'right' },
            { key: 'cash', label: 'Cash', align: 'right' },
          ],
          rows: rows.map((r) => ({
            name: String(r.name ?? ''),
            revenue: String(r.revenue ?? ''),
            profit: String(r.profit ?? ''),
            cash: String(r.cash ?? ''),
          })),
        });
      }
    }

    if (result.tool === 'get_profit_and_loss' && data) {
      for (const [key, title] of [
        ['revenueLines', 'Money in'],
        ['expenseLines', 'Money out'],
      ] as const) {
        const lines = data[key];
        if (Array.isArray(lines) && lines.length > 0) {
          blocks.push({
            type: 'table',
            title,
            columns: [
              { key: 'label', label: 'Category' },
              { key: 'amount', label: 'Amount', align: 'right' },
            ],
            rows: (lines as Array<Record<string, unknown>>).map((l) => ({
              label: String(l.label ?? ''),
              amount: String(l.amount ?? ''),
            })),
          });
        }
      }
    }

    if (result.tool === 'get_commission_chart_data' && data && Array.isArray(data.series)) {
      blocks.push({
        type: 'chart',
        title: String(data.title ?? 'Commission chart'),
        chartKind: 'stacked-bar',
        series: data.series as ZylxChartBlock['series'],
        yFormat: 'currency',
        currency: String(data.currency ?? ''),
      });
    }

    // ── Proposals ─────────────────────────────────────────
    if (result.proposal) {
      const p = result.proposal as Record<string, unknown>;
      blocks.push({
        type: 'proposal',
        kind: String(p.kind ?? 'unknown'),
        summary: String(p.summary ?? 'Review this before it is recorded'),
        warnings: Array.isArray(p.warnings) ? p.warnings.map(String) : [],
        payload: p,
      });
    }

    // ── Provenance ────────────────────────────────────────
    const prov = result.provenance as
      | { dataThrough?: string | null; staleAccounts?: string[]; source?: string }
      | undefined;

    if (prov?.staleAccounts?.length) {
      blocks.push({
        type: 'source',
        label: 'Some accounts may be out of date',
        detail: prov.staleAccounts.join(', '),
        dataThrough: prov.dataThrough ?? null,
        staleAccounts: prov.staleAccounts,
      });
    }
  }

  return dedupeBlocks(blocks);
}

/**
 * A multi-round conversation can call the same tool twice. Identical
 * blocks are collapsed so the user sees one metric row, not three.
 */
function dedupeBlocks(blocks: ZylxBlock[]): ZylxBlock[] {
  const seen = new Set<string>();
  return blocks.filter((b) => {
    const key = JSON.stringify(b);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
