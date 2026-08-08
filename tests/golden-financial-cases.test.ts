// ============================================================
// GOLDEN FINANCIAL CASES
//
// These are the tests that decide whether BankDeMark can be trusted
// with a business's money. Each one encodes a bookkeeping error that
// destroys a financial system if it is ever allowed to happen.
//
// None of them special-case a business name, a category name, or a
// description string. They test the semantics.
// ============================================================

import { describe, expect, it } from 'vitest';
import {
  computeAccountBalances,
  computeAttention,
  computeBusinessNetWorth,
  computeOwnerEquity,
  computeProjectProfitability,
  computeTotals,
  type LedgerTransaction,
} from '@/lib/domain/ledger';
import { recognizedRevenueForBooking } from '@/lib/domain/semantics';
import { applyRate, parseMajorToMinor } from '@/lib/domain/money';

const CAD = 'CAD';
let seq = 0;

function tx(partial: Partial<LedgerTransaction> & Pick<LedgerTransaction, 'amount_minor' | 'transaction_kind'>): LedgerTransaction {
  seq += 1;
  return {
    id: `tx-${seq}`,
    account_id: 'acct-bank',
    occurred_on: '2026-07-15',
    currency: CAD,
    ...partial,
  } as LedgerTransaction;
}

// ============================================================
describe('CASE 1 — income increases revenue and profit', () => {
  it('records +$100 of income as $100 revenue, $0 expense, $100 profit', () => {
    const totals = computeTotals([tx({ amount_minor: 10_000, transaction_kind: 'income' })], CAD);

    expect(totals.recognizedRevenueMinor).toBe(10_000);
    expect(totals.expensesMinor).toBe(0);
    expect(totals.profitMinor).toBe(10_000);
    expect(totals.cashInMinor).toBe(10_000);
  });
});

// ============================================================
describe('CASE 2 — expense increases expenses and reduces profit', () => {
  it('records -$100 of expense as $0 revenue, $100 expense, -$100 profit', () => {
    const totals = computeTotals([tx({ amount_minor: -10_000, transaction_kind: 'expense' })], CAD);

    expect(totals.recognizedRevenueMinor).toBe(0);
    expect(totals.expensesMinor).toBe(10_000);
    expect(totals.profitMinor).toBe(-10_000);
    expect(totals.cashOutMinor).toBe(10_000);
  });
});

// ============================================================
describe('CASE 3 — an internal transfer is not revenue', () => {
  const transfer: LedgerTransaction[] = [
    tx({ account_id: 'acct-a', amount_minor: -100_000, transaction_kind: 'transfer', transfer_group_id: 'grp-1' }),
    tx({ account_id: 'acct-b', amount_minor: 100_000, transaction_kind: 'transfer', transfer_group_id: 'grp-1' }),
  ];

  it('produces zero revenue and zero expenses', () => {
    const totals = computeTotals(transfer, CAD);
    expect(totals.recognizedRevenueMinor).toBe(0);
    expect(totals.expensesMinor).toBe(0);
    expect(totals.profitMinor).toBe(0);
  });

  it('leaves total net worth unchanged', () => {
    const balances = computeAccountBalances(transfer, { 'acct-a': 500_000, 'acct-b': 0 });
    const total = balances.reduce((s, b) => s + b.ledgerBalanceMinor, 0);
    expect(total).toBe(500_000);
  });

  it('moves the money between the two accounts', () => {
    const balances = computeAccountBalances(transfer, { 'acct-a': 500_000, 'acct-b': 0 });
    const a = balances.find((b) => b.accountId === 'acct-a')!;
    const b = balances.find((b) => b.accountId === 'acct-b')!;
    expect(a.ledgerBalanceMinor).toBe(400_000);
    expect(b.ledgerBalanceMinor).toBe(100_000);
  });

  it('flags a half-recorded transfer as needing attention', () => {
    const halfTransfer = [transfer[0]];
    expect(computeAttention(halfTransfer).unmatchedTransfers).toBe(1);
    expect(computeAttention(transfer).unmatchedTransfers).toBe(0);
  });
});

// ============================================================
describe('CASE 4 — a credit-card payment is not a second expense', () => {
  it('counts the purchase once, not twice', () => {
    const ledger = [
      // The purchase on the card is the expense.
      tx({ account_id: 'acct-card', amount_minor: -50_000, transaction_kind: 'expense' }),
      // Paying the card down moves money; it is not a new expense.
      tx({ account_id: 'acct-bank', amount_minor: -50_000, transaction_kind: 'credit_card_payment', transfer_group_id: 'grp-cc' }),
      tx({ account_id: 'acct-card', amount_minor: 50_000, transaction_kind: 'credit_card_payment', transfer_group_id: 'grp-cc' }),
    ];

    const totals = computeTotals(ledger, CAD);
    expect(totals.expensesMinor).toBe(50_000);
    expect(totals.expensesMinor).not.toBe(100_000);
    expect(totals.profitMinor).toBe(-50_000);
  });

  it('settles the card balance back to zero', () => {
    const ledger = [
      tx({ account_id: 'acct-card', amount_minor: -50_000, transaction_kind: 'expense' }),
      tx({ account_id: 'acct-card', amount_minor: 50_000, transaction_kind: 'credit_card_payment' }),
    ];
    const balances = computeAccountBalances(ledger, { 'acct-card': 0 });
    expect(balances[0].ledgerBalanceMinor).toBe(0);
  });
});

// ============================================================
describe('CASE 5 — travel booking: gross volume is not revenue', () => {
  const GROSS = parseMajorToMinor('6000.00', CAD); // 600000
  const COMMISSION = parseMajorToMinor('600.00', CAD); // 60000

  it('recognizes only the commission as revenue', () => {
    const recognized = recognizedRevenueForBooking({
      grossValueMinor: GROSS,
      recognitionMode: 'commission',
      commissionExpectedMinor: COMMISSION,
    });
    expect(recognized).toBe(60_000);
    expect(recognized).not.toBe(600_000);
  });

  it('reports booking volume of $6,000 and revenue of $600', () => {
    // The commission transaction carries the booking's gross value so the
    // dashboard can show volume without inflating the top line.
    const ledger = [
      tx({
        amount_minor: COMMISSION,
        transaction_kind: 'commission',
        gross_amount_minor: GROSS,
        recognized_amount_minor: COMMISSION,
      }),
    ];

    const totals = computeTotals(ledger, CAD);
    expect(totals.grossVolumeMinor).toBe(600_000); // $6,000 booked
    expect(totals.recognizedRevenueMinor).toBe(60_000); // $600 earned
    expect(totals.profitMinor).toBe(60_000);
  });

  it('does not count pass-through supplier money as revenue', () => {
    const ledger = [
      tx({ amount_minor: GROSS, transaction_kind: 'pass_through' }),
      tx({ amount_minor: -(GROSS - COMMISSION), transaction_kind: 'pass_through' }),
      tx({ amount_minor: COMMISSION, transaction_kind: 'commission', gross_amount_minor: GROSS }),
    ];

    const totals = computeTotals(ledger, CAD);
    expect(totals.recognizedRevenueMinor).toBe(60_000);
    expect(totals.passThroughMinor).toBe(GROSS + (GROSS - COMMISSION));
  });

  it('supports full-gross recognition for businesses where that is correct', () => {
    expect(
      recognizedRevenueForBooking({ grossValueMinor: GROSS, recognitionMode: 'full_gross' })
    ).toBe(600_000);
  });

  it('adds a service fee on top of the commission', () => {
    expect(
      recognizedRevenueForBooking({
        grossValueMinor: GROSS,
        recognitionMode: 'commission',
        commissionExpectedMinor: COMMISSION,
        serviceFeeMinor: parseMajorToMinor('75.00', CAD),
      })
    ).toBe(67_500);
  });

  it('computes commission from a rate without floating-point drift', () => {
    expect(applyRate(GROSS, 0.1)).toBe(60_000);
    // 12.5% of $6,000 = $750.00 exactly
    expect(applyRate(GROSS, 0.125)).toBe(75_000);
  });
});

// ============================================================
describe('CASE 6 — owner contribution is not revenue', () => {
  it('adds $5,000 to equity and nothing to revenue', () => {
    const totals = computeTotals(
      [tx({ amount_minor: 500_000, transaction_kind: 'owner_contribution' })],
      CAD
    );

    expect(totals.recognizedRevenueMinor).toBe(0);
    expect(totals.profitMinor).toBe(0);
    expect(totals.ownerContributionsMinor).toBe(500_000);
    expect(totals.cashInMinor).toBe(500_000);

    const equity = computeOwnerEquity(totals);
    expect(equity.netEquityMinor).toBe(500_000);
  });

  it('treats an owner draw as equity out, not an expense', () => {
    const totals = computeTotals(
      [
        tx({ amount_minor: 500_000, transaction_kind: 'owner_contribution' }),
        tx({ amount_minor: -200_000, transaction_kind: 'owner_draw' }),
      ],
      CAD
    );

    expect(totals.expensesMinor).toBe(0);
    expect(computeOwnerEquity(totals).netEquityMinor).toBe(300_000);
  });
});

// ============================================================
describe('CASE 7 — loan proceeds are not revenue', () => {
  it('adds $10,000 to cash and to liabilities, not to revenue', () => {
    const totals = computeTotals(
      [tx({ amount_minor: 1_000_000, transaction_kind: 'loan_proceeds' })],
      CAD
    );

    expect(totals.recognizedRevenueMinor).toBe(0);
    expect(totals.profitMinor).toBe(0);
    expect(totals.loanProceedsMinor).toBe(1_000_000);
    expect(totals.cashInMinor).toBe(1_000_000);
  });

  it('treats loan repayment as settling debt, not an expense', () => {
    const totals = computeTotals(
      [tx({ amount_minor: -250_000, transaction_kind: 'loan_payment' })],
      CAD
    );
    expect(totals.expensesMinor).toBe(0);
    expect(totals.loanPaymentsMinor).toBe(250_000);
  });

  it('nets out to zero business net worth change', () => {
    const before = computeBusinessNetWorth({
      cashMinor: 0, receivablesMinor: 0, otherAssetsMinor: 0, liabilitiesMinor: 0,
    });
    const after = computeBusinessNetWorth({
      cashMinor: 1_000_000, receivablesMinor: 0, otherAssetsMinor: 0, liabilitiesMinor: 1_000_000,
    });
    expect(after.netWorthMinor).toBe(before.netWorthMinor);
  });
});

// ============================================================
describe('CASE 8 — a refund reduces revenue', () => {
  it('nets $1,000 revenue against a $200 refund to $800', () => {
    const totals = computeTotals(
      [
        tx({ amount_minor: 100_000, transaction_kind: 'income' }),
        tx({ amount_minor: -20_000, transaction_kind: 'refund' }),
      ],
      CAD
    );

    expect(totals.recognizedRevenueMinor).toBe(80_000);
    expect(totals.expensesMinor).toBe(0);
    expect(totals.profitMinor).toBe(80_000);
  });

  it('does not turn a refund into an expense', () => {
    const totals = computeTotals([tx({ amount_minor: -20_000, transaction_kind: 'refund' })], CAD);
    expect(totals.expensesMinor).toBe(0);
    expect(totals.recognizedRevenueMinor).toBe(-20_000);
  });

  it('treats a reimbursement as reducing expenses, not as revenue', () => {
    const totals = computeTotals(
      [
        tx({ amount_minor: -30_000, transaction_kind: 'expense' }),
        tx({ amount_minor: 10_000, transaction_kind: 'reimbursement' }),
      ],
      CAD
    );
    expect(totals.expensesMinor).toBe(20_000);
    expect(totals.recognizedRevenueMinor).toBe(0);
  });
});

// ============================================================
describe('CASE 9 — agency project profitability', () => {
  it('computes profit and margin for a $5,000 project', () => {
    const ledger = [
      tx({ amount_minor: 500_000, transaction_kind: 'income', project_id: 'proj-1' }),
      tx({ amount_minor: -150_000, transaction_kind: 'expense', project_id: 'proj-1' }),
      tx({ amount_minor: -30_000, transaction_kind: 'expense', project_id: 'proj-1' }),
      // Unrelated overhead must not be attributed to the project.
      tx({ amount_minor: -80_000, transaction_kind: 'expense' }),
    ];

    const [project] = computeProjectProfitability(ledger);
    expect(project.projectId).toBe('proj-1');
    expect(project.revenueMinor).toBe(500_000);
    expect(project.expensesMinor).toBe(180_000);
    expect(project.profitMinor).toBe(320_000); // $3,200
    expect(project.margin).toBeCloseTo(0.64, 10);
  });
});

// ============================================================
describe('CASE 10 — cash can fall while revenue rises', () => {
  it('separates profit from cash movement', () => {
    const ledger = [
      tx({ amount_minor: 300_000, transaction_kind: 'income' }),
      tx({ amount_minor: -50_000, transaction_kind: 'expense' }),
      // Big non-P&L cash outflows.
      tx({ amount_minor: -400_000, transaction_kind: 'owner_draw' }),
      tx({ amount_minor: -100_000, transaction_kind: 'loan_payment' }),
    ];

    const totals = computeTotals(ledger, CAD);
    expect(totals.profitMinor).toBe(250_000); // profitable
    expect(totals.netCashMovementMinor).toBe(-250_000); // cash still fell
  });
});

// ============================================================
describe('guard rails', () => {
  it('refuses to sum a mixed-currency ledger instead of guessing', () => {
    const ledger = [
      tx({ amount_minor: 10_000, transaction_kind: 'income' }),
      tx({ amount_minor: 10_000, transaction_kind: 'income', currency: 'USD' }),
    ];
    expect(() => computeTotals(ledger, CAD)).toThrow(/currency mismatch/i);
  });

  it('ignores soft-deleted transactions', () => {
    const ledger = [
      tx({ amount_minor: 10_000, transaction_kind: 'income' }),
      tx({ amount_minor: 99_999, transaction_kind: 'income', deleted_at: '2026-07-20T00:00:00Z' }),
    ];
    expect(computeTotals(ledger, CAD).recognizedRevenueMinor).toBe(10_000);
  });
});
