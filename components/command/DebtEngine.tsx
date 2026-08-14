'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { clsx } from 'clsx';
import {
  calcSimplifiedDebtPayoff,
  calcDebtAvalanche,
  calcDebtSnowball,
  calcAllMetrics,
  formatCurrency,
  addMonthsToDate,
} from '@/lib/command/calculations';
import type { FinancialSnapshot, Debt, DebtPayoffResult } from '@/lib/command/types';
import LegalDisclaimer from './LegalDisclaimer';
import Link from 'next/link';

type Strategy = 'avalanche' | 'snowball' | 'simplified';

const DEBT_TYPE_ICONS: Record<string, string> = {
  credit_card: '💳', student_loan: '🎓', auto_loan: '🚗', personal_loan: '💼',
  mortgage: '🏠', heloc: '🏦', business_loan: '🏢', other: '📄',
};

export default function DebtEngine() {
  const supabase = createClient();
  const [snapshot, setSnapshot] = useState<FinancialSnapshot | null>(null);
  const [debts, setDebts] = useState<Debt[]>([]);
  const [loading, setLoading] = useState(true);
  const [strategy, setStrategy] = useState<Strategy>('avalanche');
  const [extraPayment, setExtraPayment] = useState('0');
  const [avalancheResult, setAvalancheResult] = useState<DebtPayoffResult | null>(null);
  const [snowballResult, setSnowballResult] = useState<DebtPayoffResult | null>(null);
  const [simplifiedResult, setSimplifiedResult] = useState<DebtPayoffResult | null>(null);

  // New debt form
  const [showAddDebt, setShowAddDebt] = useState(false);
  const [newDebt, setNewDebt] = useState({ name: '', balance: '', interest_rate: '', minimum_payment: '', debt_type: 'credit_card' });
  const [addingDebt, setAddingDebt] = useState(false);

  const loadData = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const [{ data: s }, { data: d }] = await Promise.all([
      supabase.from('financial_snapshots').select('*').eq('user_id', user.id).order('updated_at', { ascending: false }).limit(1).single(),
      supabase.from('debts').select('*').eq('user_id', user.id).order('created_at', { ascending: true }),
    ]);
    if (s) setSnapshot(s);
    if (d) setDebts(d);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { loadData(); }, [loadData]);

  // Recalculate whenever debts, snapshot, or extra payment changes
  useEffect(() => {
    if (!snapshot) return;
    const extra = parseFloat(extraPayment) || 0;

    if (debts.length > 0) {
      setAvalancheResult(calcDebtAvalanche(debts, extra));
      setSnowballResult(calcDebtSnowball(debts, extra));
      if (strategy === 'simplified') setStrategy('avalanche');
    } else if (snapshot.total_debt > 0) {
      const attackPmt = snapshot.minimum_debt_payment + extra;
      const { months, totalInterest } = calcSimplifiedDebtPayoff(
        snapshot.total_debt, snapshot.average_debt_interest, attackPmt
      );
      setSimplifiedResult({
        method: 'simplified',
        months_to_payoff: months,
        total_interest_paid: totalInterest,
        monthly_attack_payment: attackPmt,
        payoff_date: addMonthsToDate(months),
        interest_saved_vs_minimum: 0,
      });
      if (strategy !== 'simplified') setStrategy('simplified');
    }
  }, [debts, snapshot, extraPayment, strategy]);

  const addDebt = async () => {
    if (!newDebt.name || !newDebt.balance) return;
    setAddingDebt(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data, error } = await supabase.from('debts').insert({
      user_id: user.id,
      name: newDebt.name,
      balance: parseFloat(newDebt.balance) || 0,
      interest_rate: parseFloat(newDebt.interest_rate) || 0,
      minimum_payment: parseFloat(newDebt.minimum_payment) || 0,
      debt_type: newDebt.debt_type,
    }).select().single();
    if (!error && data) {
      setDebts(d => [...d, data]);
      setNewDebt({ name: '', balance: '', interest_rate: '', minimum_payment: '', debt_type: 'credit_card' });
      setShowAddDebt(false);
    }
    setAddingDebt(false);
  };

  const removeDebt = async (id: string) => {
    await supabase.from('debts').delete().eq('id', id);
    setDebts(d => d.filter(x => x.id !== id));
  };

  const activeResult = strategy === 'avalanche' ? avalancheResult : strategy === 'snowball' ? snowballResult : simplifiedResult;
  const totalDebt = debts.length > 0 ? debts.reduce((a, b) => a + b.balance, 0) : (snapshot?.total_debt ?? 0);
  const metrics = snapshot ? calcAllMetrics(snapshot) : null;

  if (loading) {
    return (
      <div className="p-4 lg:p-6 space-y-4">
        <div className="glass-card p-5 animate-pulse space-y-3">
          <div className="h-3 w-28 rounded bg-white/5" />
          <div className="grid grid-cols-3 gap-3">
            {[...Array(3)].map((_, i) => <div key={i} className="h-16 rounded-lg bg-white/5" />)}
          </div>
        </div>
        {[...Array(3)].map((_, i) => (
          <div key={i} className="glass-card p-5 animate-pulse space-y-2">
            <div className="flex justify-between">
              <div className="h-4 w-36 rounded bg-white/5" />
              <div className="h-4 w-20 rounded bg-white/5" />
            </div>
            <div className="h-2 w-full rounded-full bg-white/5" />
            <div className="h-3 w-48 rounded bg-white/5" />
          </div>
        ))}
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div className="p-6"><div className="glass-card p-8 text-center">
        <p className="text-zinc-400 mb-4">Complete your financial profile to use the Debt Engine.</p>
        <Link href="/command/onboarding" className="cmd-btn-primary inline-block px-6 py-3">Set Up Profile</Link>
      </div></div>
    );
  }

  return (
    <div className="p-4 lg:p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Debt Engine</h1>
          <p className="text-sm text-zinc-500">Strategic debt elimination with avalanche & snowball methods</p>
        </div>
        <Link href="/command/onboarding" className="cmd-btn-ghost text-xs">Update Profile</Link>
      </div>

      {/* Debt overview */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total Debt', value: formatCurrency(totalDebt), color: totalDebt > 0 ? '#EF4444' : '#00D084' },
          { label: 'Debt-to-Income', value: metrics ? `${(metrics.debt_to_income_ratio * 100).toFixed(0)}%` : '—', color: (metrics?.debt_to_income_ratio ?? 0) > 0.35 ? '#EF4444' : '#EAB308' },
          { label: 'Pressure Score', value: metrics ? `${metrics.debt_pressure_score}/100` : '—', color: (metrics?.debt_pressure_score ?? 0) > 60 ? '#EF4444' : '#EAB308' },
          { label: 'Avg Interest Rate', value: debts.length > 0 ? `${(debts.reduce((a, b) => a + b.interest_rate, 0) / debts.length).toFixed(1)}%` : `${snapshot.average_debt_interest}%`, color: snapshot.average_debt_interest > 10 ? '#EF4444' : '#EAB308' },
        ].map(m => (
          <div key={m.label} className="glass-card p-4">
            <div className="cmd-label">{m.label}</div>
            <div className="text-xl font-bold" style={{ color: m.color }}>{m.value}</div>
          </div>
        ))}
      </div>

      {/* Dangerous debt warning */}
      {metrics?.dangerously_high_debt && (
        <div className="glass-card p-4 border-red-500/30 bg-red-500/8">
          <div className="flex items-start gap-3">
            <span className="text-red-400 text-xl">⚠</span>
            <div>
              <p className="text-red-300 font-semibold text-sm">Danger Zone: Critical Debt Load</p>
              <p className="text-red-300/70 text-sm mt-1">
                Your debt is dangerously high relative to income. Avoid all new debt. Consider speaking with a credit counsellor.
                <a href="/debt-consolidation-canada" className="underline ml-1 hover:text-red-300">Debt consolidation guide →</a>
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Itemized debts */}
      <div className="glass-card p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-white">Your Debts</h3>
          <button onClick={() => setShowAddDebt(s => !s)} className="cmd-btn-secondary text-xs py-1.5 px-3">
            {showAddDebt ? 'Cancel' : '+ Add Debt'}
          </button>
        </div>

        {debts.length === 0 && !showAddDebt && (
          <div className="text-center py-6">
            <p className="text-zinc-500 text-sm mb-2">No itemized debts added yet.</p>
            <p className="text-zinc-600 text-xs mb-4">
              Using simplified model from your profile: {formatCurrency(snapshot.total_debt)} total at {snapshot.average_debt_interest}% avg.
            </p>
            <button onClick={() => setShowAddDebt(true)} className="cmd-btn-secondary text-sm py-2 px-4">
              Add Individual Debts for Precise Strategy
            </button>
          </div>
        )}

        {debts.length > 0 && (
          <div className="space-y-2 mb-4">
            {debts.map(debt => (
              <div key={debt.id} className="flex items-center gap-3 p-3 rounded-xl bg-white/3 border border-white/6 hover:border-white/10 transition-all group">
                <span className="text-lg flex-shrink-0">{DEBT_TYPE_ICONS[debt.debt_type] || '📄'}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-white">{debt.name}</div>
                  <div className="text-xs text-zinc-500">{debt.interest_rate}% APR · Min. {formatCurrency(debt.minimum_payment)}/mo</div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="text-sm font-bold text-red-400">{formatCurrency(debt.balance)}</div>
                </div>
                <button
                  onClick={() => removeDebt(debt.id)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-zinc-600 hover:text-red-400 text-xs px-1"
                >✕</button>
              </div>
            ))}
            <div className="flex items-center justify-between pt-2 px-1 border-t border-white/6">
              <span className="text-xs text-zinc-500">Total</span>
              <span className="text-sm font-bold text-red-400">{formatCurrency(debts.reduce((a, b) => a + b.balance, 0))}</span>
            </div>
          </div>
        )}

        {/* Add debt form */}
        {showAddDebt && (
          <div className="mt-4 p-4 rounded-xl bg-white/3 border border-white/8 space-y-3">
            <p className="text-sm font-semibold text-white">Add a Debt</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="cmd-label">Name</label>
                <input className="cmd-input" value={newDebt.name} onChange={e => setNewDebt(d => ({ ...d, name: e.target.value }))} placeholder="e.g. TD Visa" />
              </div>
              <div>
                <label className="cmd-label">Type</label>
                <select className="cmd-select" value={newDebt.debt_type} onChange={e => setNewDebt(d => ({ ...d, debt_type: e.target.value }))}>
                  {Object.entries(DEBT_TYPE_ICONS).map(([k]) => <option key={k} value={k}>{k.replace('_', ' ')}</option>)}
                </select>
              </div>
              <div>
                <label className="cmd-label">Balance ($)</label>
                <input className="cmd-input" type="number" value={newDebt.balance} onChange={e => setNewDebt(d => ({ ...d, balance: e.target.value }))} placeholder="0" min="0" />
              </div>
              <div>
                <label className="cmd-label">Interest Rate (%)</label>
                <input className="cmd-input" type="number" value={newDebt.interest_rate} onChange={e => setNewDebt(d => ({ ...d, interest_rate: e.target.value }))} placeholder="19.99" min="0" step="0.01" />
              </div>
              <div className="col-span-2">
                <label className="cmd-label">Minimum Monthly Payment ($)</label>
                <input className="cmd-input" type="number" value={newDebt.minimum_payment} onChange={e => setNewDebt(d => ({ ...d, minimum_payment: e.target.value }))} placeholder="0" min="0" />
              </div>
            </div>
            <button onClick={addDebt} className="cmd-btn-primary w-full py-2.5 text-sm" disabled={addingDebt || !newDebt.name || !newDebt.balance}>
              {addingDebt ? 'Adding…' : 'Add This Debt'}
            </button>
          </div>
        )}
      </div>

      {/* Extra payment slider */}
      <div className="glass-card p-5">
        <h3 className="font-semibold text-white mb-1">Extra Monthly Attack Payment</h3>
        <p className="text-xs text-zinc-500 mb-4">How much <em>extra</em> can you throw at debt each month beyond minimums?</p>
        <div className="flex items-center gap-4">
          <div className="relative flex-1">
            <span className="absolute left-3 top-1/2 -tranzinc-y-1/2 text-zinc-500 text-sm">$</span>
            <input
              type="number"
              className="cmd-input pl-7"
              value={extraPayment}
              onChange={e => setExtraPayment(e.target.value)}
              min="0"
              step="50"
            />
          </div>
          <div className="text-sm text-zinc-400">
            Total attack: <span className="font-bold text-white">{formatCurrency(snapshot.minimum_debt_payment + (parseFloat(extraPayment) || 0))}/mo</span>
          </div>
        </div>
      </div>

      {/* Strategy selector */}
      {(debts.length > 0 || snapshot.total_debt > 0) && (
        <>
          {debts.length > 0 && (
            <div className="flex gap-2">
              {(['avalanche', 'snowball'] as const).map(s => (
                <button
                  key={s}
                  onClick={() => setStrategy(s)}
                  className={clsx(
                    'flex-1 py-3 rounded-xl border text-sm font-semibold transition-all',
                    strategy === s
                      ? 'bg-brand-green/15 border-brand-green/40 text-brand-green'
                      : 'bg-white/3 border-white/8 text-zinc-400 hover:border-white/14'
                  )}
                >
                  {s === 'avalanche' ? '🔥 Avalanche (lowest interest cost)' : '⛄ Snowball (fastest wins)'}
                </button>
              ))}
            </div>
          )}

          {/* Strategy explanation */}
          <div className="glass-card p-4 bg-gradient-to-br from-brand-green/5 to-transparent border-brand-green/15">
            <p className="text-xs text-zinc-400 mb-1">
              <strong className="text-white">
                {strategy === 'avalanche' ? 'Avalanche Method' : strategy === 'snowball' ? 'Snowball Method' : 'Simplified Model'}:
              </strong>
              {strategy === 'avalanche' && ' Pay minimums on all debts. Direct all extra money to the highest-interest debt first. Minimizes total interest paid.'}
              {strategy === 'snowball' && ' Pay minimums on all debts. Direct all extra money to the smallest balance first. Builds psychological momentum.'}
              {strategy === 'simplified' && ' Based on your total debt balance and average interest rate. Add individual debts for avalanche/snowball strategies.'}
            </p>
          </div>

          {/* Payoff results */}
          {activeResult && (
            <div className="glass-card p-5 border-brand-green/20">
              <h3 className="font-semibold text-white mb-4">Payoff Timeline</h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
                <div>
                  <div className="cmd-label">Debt-Free Date</div>
                  <div className="text-lg font-bold text-emerald-400">{activeResult.payoff_date}</div>
                </div>
                <div>
                  <div className="cmd-label">Months to Payoff</div>
                  <div className="text-lg font-bold text-white">{activeResult.months_to_payoff}</div>
                </div>
                <div>
                  <div className="cmd-label">Total Interest</div>
                  <div className="text-lg font-bold text-red-400">{formatCurrency(activeResult.total_interest_paid)}</div>
                </div>
                <div>
                  <div className="cmd-label">Monthly Attack</div>
                  <div className="text-lg font-bold text-brand-green">{formatCurrency(activeResult.monthly_attack_payment)}</div>
                </div>
              </div>

              {/* Method comparison */}
              {avalancheResult && snowballResult && (
                <div className="mt-4 pt-4 border-t border-white/6">
                  <p className="text-xs text-zinc-500 uppercase tracking-wide mb-3">Method Comparison</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className={clsx('p-3 rounded-xl border text-sm', strategy === 'avalanche' ? 'bg-brand-green/10 border-brand-green/30' : 'bg-white/3 border-white/6')}>
                      <div className="font-semibold text-white mb-1">🔥 Avalanche</div>
                      <div className="text-zinc-400">{avalancheResult.months_to_payoff} months · {formatCurrency(avalancheResult.total_interest_paid)} interest</div>
                    </div>
                    <div className={clsx('p-3 rounded-xl border text-sm', strategy === 'snowball' ? 'bg-brand-green/10 border-brand-green/30' : 'bg-white/3 border-white/6')}>
                      <div className="font-semibold text-white mb-1">⛄ Snowball</div>
                      <div className="text-zinc-400">{snowballResult.months_to_payoff} months · {formatCurrency(snowballResult.total_interest_paid)} interest</div>
                    </div>
                  </div>
                  {avalancheResult.total_interest_paid < snowballResult.total_interest_paid && (
                    <p className="text-xs text-emerald-400 mt-2 text-center">
                      Avalanche saves {formatCurrency(snowballResult.total_interest_paid - avalancheResult.total_interest_paid)} in interest vs. Snowball.
                    </p>
                  )}
                </div>
              )}

              {/* Payoff order */}
              {activeResult.payoff_order && activeResult.payoff_order.length > 0 && (
                <div className="mt-4 pt-4 border-t border-white/6">
                  <p className="text-xs text-zinc-500 uppercase tracking-wide mb-3">Payoff Order</p>
                  <ol className="space-y-2">
                    {activeResult.payoff_order.map((item, i) => (
                      <li key={i} className="flex items-center gap-3 text-sm">
                        <span className="w-5 h-5 rounded-full bg-brand-green/20 text-brand-green text-xs flex items-center justify-center font-bold flex-shrink-0">{i + 1}</span>
                        <span className="text-white font-medium">{item.name}</span>
                        <span className="text-zinc-500">paid off month {item.months}</span>
                        <span className="text-red-400 ml-auto">{formatCurrency(item.interest)} interest</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* No debt state */}
      {totalDebt === 0 && (
        <div className="glass-card p-8 text-center border-brand-green/20 bg-brand-green/5">
          <div className="text-4xl mb-3">🎉</div>
          <h3 className="text-xl font-bold text-white mb-2">You&rsquo;re Debt-Free!</h3>
          <p className="text-zinc-400 text-sm mb-4">Incredible work. Now redirect your former debt payments into wealth-building investments.</p>
          <Link href="/command/wealth" className="cmd-btn-primary inline-block px-6 py-2.5 text-sm">Open Wealth Engine →</Link>
        </div>
      )}

      <LegalDisclaimer compact />
    </div>
  );
}
