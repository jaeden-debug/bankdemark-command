import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(new URL('../supabase/migrations/20260808200000_travel_commission_reports.sql', import.meta.url), 'utf8');

describe('commission approval database contract', () => {
  it('is atomic, replay-safe, evidence-linked, and tenant-checked', () => {
    expect(migration).toContain('bdm_approve_commission_report');
    expect(migration).toContain('UNIQUE INDEX IF NOT EXISTS idx_commission_payments_report_line');
    expect(migration).toContain('ON CONFLICT (report_line_id)');
    expect(migration).toContain('report evidence does not match payment');
    expect(migration).toContain("is_business_member(v_business, 'member')");
    expect(migration).toContain("'approve_matches'");
  });
});
