// ============================================================
// RECEIPT MATCHING
//
// Whether a receipt is already recorded is a financial judgement. It is
// made deterministically here so the model never decides it — and so
// the decision can be explained to the owner rather than asserted.
// ============================================================

import { describe, expect, it } from 'vitest';
import { findMatches, normalizeMerchant, scoreMatch } from '@/lib/domain/matching';
import type { LedgerTransaction } from '@/lib/domain/ledger';

let n = 0;
const tx = (over: Partial<LedgerTransaction>): LedgerTransaction => ({
  id: `tx-${++n}`,
  account_id: 'acct',
  occurred_on: '2026-08-01',
  amount_minor: -4210,
  currency: 'CAD',
  transaction_kind: 'expense',
  merchant: 'BLUE BOTTLE',
  description: 'Coffee',
  ...over,
});

describe('normalizeMerchant — bank noise vs receipt names', () => {
  it('strips processor prefixes so the same merchant meets', () => {
    expect(normalizeMerchant('SQ *BLUE BOTTLE 4821')).toContain('blue');
    expect(normalizeMerchant('TST* Blue Bottle Coffee')).toContain('bottle');
  });

  it('drops company suffixes that carry no signal', () => {
    const tokens = normalizeMerchant('Acme Supplies Inc.');
    expect(tokens).toContain('acme');
    expect(tokens).not.toContain('inc');
  });

  it('drops digits and store numbers', () => {
    expect(normalizeMerchant('STARBUCKS #4821')).toEqual(['starbucks']);
  });

  it('handles nothing gracefully', () => {
    expect(normalizeMerchant(null)).toEqual([]);
    expect(normalizeMerchant('   ')).toEqual([]);
  });
});

describe('scoreMatch', () => {
  it('scores an exact amount, same day, same merchant very high', () => {
    const c = scoreMatch(
      { amountMinor: -4210, date: '2026-08-01', vendor: 'Blue Bottle Coffee' },
      tx({})
    );
    expect(c.score).toBeGreaterThan(0.9);
    expect(c.confident).toBe(true);
    expect(c.reasons).toContain('the amount matches exactly');
  });

  it('still matches when a card posts a couple of days late', () => {
    const c = scoreMatch(
      { amountMinor: -4210, date: '2026-08-01', vendor: 'Blue Bottle' },
      tx({ occurred_on: '2026-08-03' })
    );
    expect(c.score).toBeGreaterThan(0.8);
    expect(c.reasons.join(' ')).toMatch(/post late/);
  });

  it('recognises a tip added after the receipt printed', () => {
    const c = scoreMatch(
      { amountMinor: -4210, date: '2026-08-01', vendor: 'Blue Bottle' },
      tx({ amount_minor: -4280 })
    );
    expect(c.reasons.join(' ')).toMatch(/tip may have been added/);
    // Plausible, but never confident — the figures genuinely differ.
    expect(c.confident).toBe(false);
  });

  it('is never confident on merchant and date alone', () => {
    // Two visits to the same shop on one day are two transactions.
    const c = scoreMatch(
      { amountMinor: -9900, date: '2026-08-01', vendor: 'Blue Bottle' },
      tx({ amount_minor: -4210 })
    );
    expect(c.confident).toBe(false);
  });

  it('penalises a wrong amount rather than ignoring it', () => {
    const wrong = scoreMatch({ amountMinor: -50000, date: '2026-08-01', vendor: 'Blue Bottle' }, tx({}));
    const right = scoreMatch({ amountMinor: -4210, date: '2026-08-01', vendor: 'Blue Bottle' }, tx({}));
    expect(wrong.score).toBeLessThan(right.score);
  });

  it('matches regardless of sign — a receipt has no direction', () => {
    const c = scoreMatch({ amountMinor: 4210, date: '2026-08-01', vendor: 'Blue Bottle' }, tx({}));
    expect(c.reasons).toContain('the amount matches exactly');
  });
});

describe('findMatches — when to claim a duplicate', () => {
  it('reports a single clear match as a likely duplicate', () => {
    const result = findMatches(
      { amountMinor: -4210, date: '2026-08-01', vendor: 'Blue Bottle' },
      [tx({}), tx({ amount_minor: -99900, merchant: 'AWS', occurred_on: '2026-07-02' })]
    );
    expect(result.likelyDuplicate).not.toBeNull();
    expect(result.candidates).toHaveLength(1);
  });

  it('refuses to pick when two candidates are near-identical', () => {
    // A shop charging the same amount twice in a day is exactly when a
    // wrong automatic match does real damage. Offer both, choose neither.
    const result = findMatches({ amountMinor: -4210, date: '2026-08-01', vendor: 'Blue Bottle' }, [
      tx({}),
      tx({}),
    ]);
    expect(result.candidates.length).toBe(2);
    expect(result.likelyDuplicate).toBeNull();
  });

  it('returns nothing when the receipt is genuinely new', () => {
    const result = findMatches(
      { amountMinor: -88800, date: '2026-08-01', vendor: 'Totally New Vendor' },
      [tx({})]
    );
    expect(result.likelyDuplicate).toBeNull();
    expect(result.candidates).toHaveLength(0);
  });

  it('ignores soft-deleted transactions', () => {
    const result = findMatches({ amountMinor: -4210, date: '2026-08-01', vendor: 'Blue Bottle' }, [
      tx({ deleted_at: '2026-08-05T00:00:00Z' }),
    ]);
    expect(result.candidates).toHaveLength(0);
  });

  it('caps how many candidates a person is asked to consider', () => {
    const many = Array.from({ length: 20 }, () => tx({}));
    expect(findMatches({ amountMinor: -4210, date: '2026-08-01', vendor: 'Blue Bottle' }, many)
      .candidates.length).toBeLessThanOrEqual(5);
  });

  it('copes with a receipt where nothing could be read', () => {
    const result = findMatches({ amountMinor: null, date: null, vendor: null }, [tx({})]);
    expect(result.likelyDuplicate).toBeNull();
  });
});
