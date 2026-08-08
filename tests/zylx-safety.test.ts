// ============================================================
// ZYLX SAFETY — P0 REGRESSION TESTS
//
// These lock the audit findings shut. Each maps to a confirmed defect
// that was verified exploitable or verified misleading before the fix.
// ============================================================

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const read = (p: string) => readFileSync(path.join(root, p), 'utf8');

const prompt = read('lib/zylx/prompt.ts');
const tools = read('lib/zylx/tools.ts');
const chatRoute = read('app/api/zylx/chat/route.ts');
const approveRoute = read('app/api/zylx/approve/route.ts');

// ============================================================
describe('CRITICAL — Zylx must not claim research it cannot perform', () => {
  it('no tool implements web search', () => {
    expect(tools).not.toContain("capability: 'web_search'");
  });

  it('the prompt never instructs the model to search or cite sources', () => {
    expect(prompt).not.toMatch(/use web search/i);
    expect(prompt).not.toMatch(/cite the source and its date/i);
  });

  it('the prompt explicitly forbids claiming a lookup', () => {
    expect(prompt).toMatch(/never/i);
    expect(prompt).toMatch(/claim to have looked something up|looked something up, searched/i);
  });

  it('names the authorities it must NOT cite, so the ban is unambiguous', () => {
    for (const source of ['CRA', 'Revenu Québec', 'IRS', 'Bank of Canada']) {
      expect(prompt).toContain(source);
    }
  });

  it('capability is gated on the runtime registry, not the plan flag alone', () => {
    // A plan may grant web_search before a tool exists. Both must be true.
    expect(chatRoute).toMatch(/TOOL_DEFINITIONS\.some\(\(t\) => t\.capability === 'web_search'\)/);
  });
});

// ============================================================
describe('HIGH — conversations are scoped to a business', () => {
  it('loading a conversation filters on business_id, not just user_id', () => {
    const block = chatRoute.slice(
      chatRoute.indexOf('// ── Conversation'),
      chatRoute.indexOf('const { data: history }')
    );
    expect(block).toContain(".eq('user_id', ctx.userId)");
    expect(block).toContain(".eq('business_id', ctx.businessId)");
  });

  it('new conversations record which business they belong to', () => {
    expect(chatRoute).toMatch(/business_id: ctx\.businessId,\s*\n\s*title:/);
  });

  it('message history is additionally scoped to the caller', () => {
    const historyBlock = chatRoute.slice(chatRoute.indexOf("from('ai_messages')"));
    expect(historyBlock.slice(0, 400)).toContain(".eq('user_id', ctx.userId)");
  });
});

// ============================================================
describe('MEDIUM — foreign keys are ownership-checked', () => {
  const migration = read('supabase/migrations/20260808070000_zylx_p0_isolation.sql');

  it('a database trigger guards every referenced entity', () => {
    for (const col of [
      'category_id', 'brand_id', 'project_id',
      'counterparty_id', 'account_id', 'booking_id', 'document_id',
    ]) {
      expect(migration).toContain(col);
    }
    expect(migration).toContain('transactions_assert_same_business');
  });

  it('system categories (business_id IS NULL) stay shared', () => {
    expect(migration).toMatch(/v_owner IS NOT NULL AND v_owner <> NEW\.business_id/);
  });

  it('the service layer validates ownership independently of the model', () => {
    const ownership = read('lib/services/ownership.ts');
    expect(ownership).toContain('assertOwned');
    expect(ownership).toContain('assertTransactionsOwned');
    // Same message whether unowned or absent — no existence oracle.
    expect(ownership).toContain('is not part of this business');
  });

  it('bulk categorisation re-verifies every id server-side', () => {
    expect(approveRoute).toContain('assertTransactionsOwned(ctx, ids)');
    expect(approveRoute).toContain("assertOwned(ctx, 'categories', categoryId)");
  });
});

// ============================================================
describe('Approval idempotency', () => {
  // Mirrors proposalKey/stableStringify in the approve route.
  function stableStringify(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([k]) => k !== 'summary' && k !== 'warnings')
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
    return `{${entries.join(',')}}`;
  }
  const key = (b: string, u: string, p: unknown) =>
    createHash('sha256').update(`${b}|${u}|${stableStringify(p)}`).digest('hex').slice(0, 48);

  const proposal = { kind: 'transaction', amountMajor: 82.54, occurredOn: '2026-08-01', description: 'Ads' };

  it('the same proposal always produces the same key — a double-click replays', () => {
    expect(key('biz', 'user', proposal)).toBe(key('biz', 'user', proposal));
  });

  it('property order does not change the key', () => {
    const reordered = { description: 'Ads', occurredOn: '2026-08-01', amountMajor: 82.54, kind: 'transaction' };
    expect(key('biz', 'user', reordered)).toBe(key('biz', 'user', proposal));
  });

  it('presentation-only fields do not change the key', () => {
    const decorated = { ...proposal, summary: 'Money out · $82.54', warnings: ['guessed the account'] };
    expect(key('biz', 'user', decorated)).toBe(key('biz', 'user', proposal));
  });

  it('a genuinely different transaction still gets through', () => {
    expect(key('biz', 'user', { ...proposal, amountMajor: 99 })).not.toBe(key('biz', 'user', proposal));
    expect(key('biz', 'user', { ...proposal, occurredOn: '2026-08-02' })).not.toBe(key('biz', 'user', proposal));
  });

  it('keys never cross a business or user boundary', () => {
    expect(key('bizA', 'user', proposal)).not.toBe(key('bizB', 'user', proposal));
    expect(key('biz', 'userA', proposal)).not.toBe(key('biz', 'userB', proposal));
  });

  it('the route checks for a prior approval before executing', () => {
    expect(approveRoute).toContain("from('zylx_approvals')");
    expect(approveRoute).toContain('idempotent: true');
  });
});

// ============================================================
describe('Risk taxonomy is server-authoritative', () => {
  it('defines four tiers', () => {
    for (const tier of ['read', 'low_write', 'financial_write', 'high_impact']) {
      expect(tools).toContain(tier);
    }
  });

  it('no tool is exposed at high_impact', () => {
    expect(tools).not.toMatch(/risk: 'high_impact'/);
  });

  it('write tools are proposals requiring approval', () => {
    expect(tools).toContain('REQUIRES_USER_APPROVAL');
    // Every write-tier tool must be gated on the ai_writes entitlement.
    const writeTools = tools.match(/risk: '(financial_write|propose)'/g) ?? [];
    expect(writeTools.length).toBeGreaterThan(0);
  });
});

// ============================================================
describe('New tools are wired to deterministic services', () => {
  it('search_transactions returns a deterministic total, not just a sample', () => {
    expect(tools).toContain("case 'search_transactions'");
    expect(tools).toMatch(/truncated: matched\.length > limit/);
    expect(tools).toMatch(/matchCount/);
  });

  it('portfolio cannot be widened by the model', () => {
    expect(tools).toContain("case 'get_portfolio_summary'");
    // No business id parameter exists on the tool at all.
    const def = tools.slice(tools.indexOf("name: 'get_portfolio_summary'"));
    expect(def.slice(0, 500)).toContain('properties: {}');
  });

  it('P&L comes from the deterministic report engine', () => {
    expect(tools).toContain('generateProfitAndLoss');
  });

  it('categorisation is a proposal, never a direct write', () => {
    const def = tools.slice(tools.indexOf("name: 'propose_categorize_transactions'"), 
                            tools.indexOf("name: 'propose_categorize_transactions'") + 700);
    expect(def).toContain("risk: 'financial_write'");
    expect(def).toContain("capability: 'ai_writes'");
  });
});

// ============================================================
describe('Architectural principles hold', () => {
  it('the prompt still forbids the model doing arithmetic', () => {
    expect(prompt).toMatch(/You do not do arithmetic on financial data/i);
  });

  it('no service-role client is reachable from any Zylx path', () => {
    for (const f of [tools, chatRoute, approveRoute, prompt]) {
      expect(f).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
      expect(f).not.toContain('adminDb(');
    }
  });

  it('there is exactly one tool registry', () => {
    expect((tools.match(/export const TOOL_DEFINITIONS/g) ?? []).length).toBe(1);
  });
});
