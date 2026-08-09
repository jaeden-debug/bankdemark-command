import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  displayMoney,
  moneySafeForModel,
  requiresWorkspaceFinancialTool,
  routeWorkspaceFinancialTool,
  verifiedFinancialAnswer,
} from '../lib/zylx/financial-truth';

describe('Zylx financial truth boundary', () => {
  it('routes booking thresholds to deterministic minor units', () => {
    const route = routeWorkspaceFinancialTool('Show bookings over $500 commission.', 'CAD');
    expect(route).toEqual({
      tool: 'get_bookings',
      enforcedArgs: { minCommissionMinor: 50000, minCommissionExclusive: true },
    });
  });

  it('uses only returned booking rows for a verified answer', () => {
    const result = {
      ok: true,
      tool: 'get_bookings',
      data: {
        bookings: [
          { reference: 'TEST-ABC124', expectedCommission: displayMoney(61500, 'CAD'), status: 'pending' },
        ],
      },
    };
    const answer = verifiedFinancialAnswer('$900 is outstanding.', result);
    expect(answer).toContain('TEST-ABC124');
    expect(answer).toContain('$615.00');
    expect(answer).not.toContain('$900');
  });

  it('does not fabricate when a required tool fails', () => {
    expect(verifiedFinancialAnswer('Three bookings total $900.', {
      ok: false,
      tool: 'get_bookings',
      error: 'unavailable',
    })).toBe('I couldn’t retrieve your current BankDeMark records for that question.');
  });

  it('corrects unsupported chart narration from the typed money dataset', () => {
    const result = {
      ok: true,
      tool: 'get_commission_chart_data',
      data: {
        currency: 'CAD',
        unit: 'minor_currency_units',
        series: [{ label: 'Paid', points: [{ x: '2027-01', amount: displayMoney(42500, 'CAD') }] }],
      },
    };
    const answer = verifiedFinancialAnswer('Paid commission was $42,500.', result);
    expect(answer).toContain('$425.00');
    expect(answer).not.toContain('$42,500');
  });

  it('annotates pending minor units as $615.00 CAD before model use', () => {
    const safe = moneySafeForModel({ pendingMinor: 61500 }, 'CAD') as Record<string, { display: string }>;
    expect(safe.pending).toMatchObject({ minor: 61500, currency: 'CAD', unit: 'minor_currency_units', display: '$615.00' });
  });

  it('does not require workspace tools for general education', () => {
    expect(requiresWorkspaceFinancialTool('What is commission?')).toBe(false);
    expect(requiresWorkspaceFinancialTool('How does a 10% commission work?')).toBe(false);
  });

  it('introduces no model-callable payment or reconciliation approval action', () => {
    const tools = readFileSync(path.resolve(__dirname, '../lib/zylx/tools.ts'), 'utf8');
    expect(tools).not.toMatch(/name:\s*['"](?:mark_commission_paid|approve_commission_report|create_commission_payment)['"]/);
  });
});
