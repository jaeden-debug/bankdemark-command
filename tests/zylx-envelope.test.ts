// ============================================================
// ZYLX RESPONSE ENVELOPE
//
// The envelope is the seam every future capability renders through —
// charts, receipts, source cards. These tests lock the two properties
// that make it safe to grow into: an allow-list, and figures that come
// from the deterministic layer rather than the model.
// ============================================================

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ALLOWED_BLOCK_TYPES, buildBlocks, sanitizeBlocks } from '@/lib/zylx/envelope';

describe('sanitizeBlocks — the allow-list', () => {
  it('drops a block type that is not on the list', () => {
    const blocks = sanitizeBlocks([
      { type: 'metric', figures: [] },
      { type: 'script', src: 'evil.js' },
      { type: 'iframe', src: 'https://example.com' },
      { type: 'Component', name: 'AdminPanel' },
    ]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('metric');
  });

  it('drops malformed entries rather than throwing', () => {
    expect(sanitizeBlocks([null, undefined, 'metric', 42, {}, { type: 123 }])).toHaveLength(0);
    expect(sanitizeBlocks('not an array')).toHaveLength(0);
    expect(sanitizeBlocks(undefined)).toHaveLength(0);
  });

  it('every allowed type is genuinely accepted', () => {
    const all = ALLOWED_BLOCK_TYPES.map((type) => ({ type }));
    expect(sanitizeBlocks(all)).toHaveLength(ALLOWED_BLOCK_TYPES.length);
  });
});

describe('buildBlocks — figures come from the deterministic layer', () => {
  it('uses the backend formatted strings verbatim', () => {
    const blocks = buildBlocks([
      {
        ok: true,
        tool: 'get_profit',
        formatted: {
          period: 'This month',
          revenue: '$18,421.37',
          expenses: '$4,210.00',
          profit: '$14,211.37',
          margin: '77.1%',
        },
      },
    ]);
    const metric = blocks.find((b) => b.type === 'metric');
    expect(metric).toBeDefined();
    const figures = (metric as { figures: Array<{ formatted: string }> }).figures;
    // Exact strings, not re-derived or rounded on the client.
    expect(figures.map((f) => f.formatted)).toContain('$18,421.37');
    expect(figures.map((f) => f.formatted)).toContain('$14,211.37');
  });

  it('marks rising expenses as bad and rising revenue as good', () => {
    const blocks = buildBlocks([
      { ok: true, tool: 'get_profit', formatted: { revenue: '$1', expenses: '$2', profit: '$3', margin: '1%' } },
    ]);
    const figures = (blocks[0] as { figures: Array<{ label: string; goodWhen?: string }> }).figures;
    expect(figures.find((f) => f.label === 'Money out')?.goodWhen).toBe('down');
    expect(figures.find((f) => f.label === 'Money in')?.goodWhen).toBe('up');
  });

  it('emits nothing for a failed tool', () => {
    expect(buildBlocks([{ ok: false, tool: 'get_profit', formatted: { profit: '$1' } }])).toHaveLength(0);
  });

  it('surfaces truncation so a partial table is never read as complete', () => {
    const blocks = buildBlocks([
      {
        ok: true,
        tool: 'search_transactions',
        formatted: { totalOut: '$4,283.00', matchCount: '137' },
        data: {
          truncated: true,
          returnedCount: 25,
          matchCount: 137,
          transactions: [{ date: '2026-07-01', description: 'Amazon', amount: '-$42.10' }],
        },
      },
    ]);
    const table = blocks.find((b) => b.type === 'table') as { truncated?: { shown: number; total: number } };
    expect(table.truncated).toEqual({ shown: 25, total: 137 });
  });

  it('raises a source block when accounts are stale', () => {
    const blocks = buildBlocks([
      {
        ok: true,
        tool: 'get_cash_position',
        formatted: { cash: '$48,210' },
        provenance: { dataThrough: '2026-08-01', staleAccounts: ['Business chequing'] },
      },
    ]);
    const source = blocks.find((b) => b.type === 'source');
    expect(source).toBeDefined();
    expect((source as { staleAccounts: string[] }).staleAccounts).toContain('Business chequing');
  });

  it('turns a tool proposal into an approval block carrying its payload', () => {
    const blocks = buildBlocks([
      {
        ok: true,
        tool: 'propose_categorize_transactions',
        proposal: { kind: 'categorize', summary: 'Move 5 to Advertising', warnings: [], transactionIds: ['a'] },
      },
    ]);
    const proposal = blocks.find((b) => b.type === 'proposal') as { kind: string; payload: Record<string, unknown> };
    expect(proposal.kind).toBe('categorize');
    // Payload round-trips to /api/zylx/approve, which re-validates it.
    expect(proposal.payload.transactionIds).toEqual(['a']);
  });

  it('collapses duplicate blocks from repeated tool calls', () => {
    const one = { ok: true, tool: 'get_profit', formatted: { revenue: '$1', expenses: '$2', profit: '$3', margin: '1%' } };
    expect(buildBlocks([one, one, one])).toHaveLength(1);
  });
});

describe('streaming route contract', () => {
  const route = readFileSync(
    path.join(path.resolve(__dirname, '..'), 'app/api/zylx/chat/route.ts'),
    'utf8'
  );

  it('returns an SSE stream', () => {
    expect(route).toContain('text/event-stream');
    expect(route).toContain('ReadableStream');
  });

  it('status labels are curated, never built from tool arguments', () => {
    expect(route).toContain('TOOL_STATUS');
    expect(route).toContain('function statusFor');
    // The status event carries a label and a tool name — never args.
    expect(route).toMatch(/send\('status', \{ label: statusFor\(call\.name\), tool: call\.name \}\)/);
  });

  it('blocks are built server-side and sanitized before sending', () => {
    expect(route).toContain('sanitizeBlocks(buildBlocks(');
  });

  it('has a provider timeout and bounded retry', () => {
    expect(route).toContain('PROVIDER_TIMEOUT_MS');
    expect(route).toContain('MAX_PROVIDER_ATTEMPTS');
    expect(route).toMatch(/status === 429 \|\| \(status >= 500/);
  });

  it('never streams raw prompts or tool arguments', () => {
    expect(route).not.toMatch(/send\('[a-z]+', \{[^}]*systemPrompt/);
    expect(route).not.toMatch(/send\('[a-z]+', \{[^}]*call\.args/);
  });
});
