'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { clsx } from 'clsx';
import {
  calcAllMetrics,
  calcFutureValue,
  calcMonthlyInvestmentNeeded,
  formatCurrency,
  addMonthsToDate,
} from '@/lib/command/calculations';
import { INVESTMENT_RETURNS } from '@/lib/command/constants';
import type { FinancialSnapshot, RiskTolerance } from '@/lib/command/types';
import LegalDisclaimer from './LegalDisclaimer';
import Link from 'next/link';

interface Scenario {
  label: string;
  rate: number;
  color: string;
  description: string;
}

const SCENARIOS: Scenario[] = [
  { label: 'Conservative', rate: INVESTMENT_RETURNS.conservative, color: '#94A3B8', description: 'Low-risk, bonds-heavy, ~4% annualized' },
  { label: 'Moderate', rate: INVESTMENT_RETURNS.moderate, color: '#3B82F6', description: 'Balanced portfolio, ~7% annualized' },
  { label: 'Aggressive', rate: INVESTMENT_RETURNS.aggressive, color: '#00D084', description: 'Growth-focused equities, ~10% annualized' },
];

const PROJECTION_YEARS = [5, 10, 15, 20, 25, 30];

export default function WealthEngine() {
  const supabase = createClient();
  const [snapshot, setSnapshot] = useState<FinancialSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedScenario, setSelectedScenario] = useState(1); // moderate
  const [monthlyContrib, setMonthlyContrib] = useState('');
  const [projectionYears, setProjectionYears] = useState(20);
  const [startingBalance, setStartingBalance] = useState('');
  const [targetAmount, setTargetAmount] = useState('');

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: s } = await supabase.from('financial_snapshots').select('*').eq('user_id', user.id).order('updated_at', { ascending: false }).limit(1).single();
      if (s) {
        setSnapshot(s);
        const metrics = calcAllMetrics(s, s.desired_retirement_age ? s.desired_retirement_age - 35 : undefined);
        const suggestedContrib = Math.max(0, Math.round(metrics.monthly_cash_flow * 0.3));
        setMonthlyContrib(suggestedContrib.toString());
        setStartingBalance(s.investment_balance.toString());
        setTargetAmount(Math.round(metrics.fire_number).toString());
      }
      setLoading(false);
    })();
  }, [supabase]);

  if (loading) return <div className="p-6 space-y-4 animate-pulse">{[...Array(4)].map((_, i) => <div key={i} className="h-32 glass-card rounded-xl bg-white/3" />)}</div>;

  if (!snapshot) {
    return (
      <div className="p-6"><div className="glass-card p-8 text-center">
        <p className="text-zinc-400 mb-4">Complete your profile to use the Wealth Engine.</p>
        <Link href="/command/onboarding" className="cmd-btn-primary inline-block px-6 py-3">Set Up Profile</Link>
      </div></div>
    );
  }

  const metrics = calcAllMetrics(snapshot);
  const starting = parseFloat(startingBalance) || snapshot.investment_balance;
  const contribution = parseFloat(monthlyContrib) || 0;
  const scenario = SCENARIOS[selectedScenario];

  // Main projection
  const projectedValue = calcFutureValue(starting, contribution, scenario.rate, projectionYears);
  const totalContributed = starting + contribution * projectionYears * 12;
  const growthGain = projectedValue - totalContributed;

  // All-years table
  const yearlyProjections = PROJECTION_YEARS.map(y => ({
    years: y,
    conservative: calcFutureValue(starting, contribution, INVESTMENT_RETURNS.conservative, y),
    moderate: calcFutureValue(starting, contribution, INVESTMENT_RETURNS.moderate, y),
    aggressive: calcFutureValue(starting, contribution, INVESTMENT_RETURNS.aggressive, y),
  }));

  // Target calculator
  const target = parseFloat(targetAmount) || metrics.fire_number;
  const monthlyNeededModerate = calcMonthlyInvestmentNeeded(target, starting, INVESTMENT_RETURNS.moderate, projectionYears);
  const monthlyNeededAggressive = calcMonthlyInvestmentNeeded(target, starting, INVESTMENT_RETURNS.aggressive, projectionYears);

  // Monthly passive income from projected portfolio
  const projectedMonthlyIncome = (projectedValue * 0.04) / 12;

  return (
    <div className="p-4 lg:p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Wealth Engine</h1>
          <p className="text-sm text-zinc-500">Investment projections, FIRE planning, and passive income roadmap</p>
        </div>
        <Link href="/command/onboarding" className="cmd-btn-ghost text-xs">Update Profile</Link>
      </div>

      {/* Net worth snapshot */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Net Worth', value: formatCurrency(metrics.net_worth), color: metrics.net_worth > 0 ? '#00D084' : '#EF4444' },
          { label: 'Investments', value: formatCurrency(snapshot.investment_balance), color: '#3B82F6' },
          { label: 'FIRE Number', value: formatCurrency(metrics.fire_number), color: '#F5C842' },
          { label: 'Retirement Gap', value: formatCurrency(metrics.retirement_gap), color: metrics.retirement_gap > 0 ? '#F97316' : '#00D084' },
        ].map(m => (
          <div key={m.label} className="glass-card p-4">
            <div className="cmd-label">{m.label}</div>
            <div className="text-xl font-bold" style={{ color: m.color }}>{m.value}</div>
          </div>
        ))}
      </div>

      {/* Passive income highlight */}
      <div className="glass-card p-5 bg-gradient-to-r from-brand-gold/5 to-transparent border-brand-gold/20">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-yellow-400">◈</span>
          <h3 className="font-semibold text-white text-sm">Passive Income Roadmap</h3>
        </div>
        <div className="grid sm:grid-cols-3 gap-4 mt-3">
          <div>
            <div className="cmd-label">Current Monthly Passive</div>
            <div className="text-xl font-bold text-yellow-400">{formatCurrency(metrics.monthly_passive_income_projected)}</div>
            <div className="text-xs text-zinc-500">From {formatCurrency(snapshot.investment_balance)} at 4% SWR</div>
          </div>
          {snapshot.passive_income_target > 0 && (
            <div>
              <div className="cmd-label">Your Passive Target</div>
              <div className="text-xl font-bold text-white">{formatCurrency(snapshot.passive_income_target)}/mo</div>
              <div className="text-xs text-zinc-500">Needs {formatCurrency(metrics.passive_income_capital_needed)} in assets</div>
            </div>
          )}
          <div>
            <div className="cmd-label">Suggested Monthly Invest</div>
            <div className="text-xl font-bold text-blue-400">{formatCurrency(metrics.monthly_investment_needed)}</div>
            <div className="text-xs text-zinc-500">To hit FIRE in {metrics.years_to_retirement}yr at 7%</div>
          </div>
        </div>
      </div>

      {/* Simulator controls */}
      <div className="glass-card p-5">
        <h3 className="font-semibold text-white mb-4">Investment Growth Simulator</h3>
        <div className="grid sm:grid-cols-3 gap-4 mb-5">
          <div>
            <label className="cmd-label">Starting Balance ($)</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -tranzinc-y-1/2 text-zinc-500 text-sm">$</span>
              <input className="cmd-input pl-7" type="number" value={startingBalance} onChange={e => setStartingBalance(e.target.value)} min="0" />
            </div>
          </div>
          <div>
            <label className="cmd-label">Monthly Contribution ($)</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -tranzinc-y-1/2 text-zinc-500 text-sm">$</span>
              <input className="cmd-input pl-7" type="number" value={monthlyContrib} onChange={e => setMonthlyContrib(e.target.value)} min="0" step="50" />
            </div>
          </div>
          <div>
            <label className="cmd-label">Time Horizon</label>
            <select className="cmd-select" value={projectionYears} onChange={e => setProjectionYears(parseInt(e.target.value))}>
              {[5, 10, 15, 20, 25, 30, 40].map(y => <option key={y} value={y}>{y} years</option>)}
            </select>
          </div>
        </div>

        {/* Return scenario selector */}
        <div className="grid grid-cols-3 gap-2 mb-5">
          {SCENARIOS.map((s, i) => (
            <button
              key={s.label}
              onClick={() => setSelectedScenario(i)}
              className={clsx(
                'p-3 rounded-xl border text-left transition-all',
                selectedScenario === i ? 'border-opacity-60 bg-opacity-10' : 'bg-white/3 border-white/8 hover:border-white/14'
              )}
              style={selectedScenario === i ? { borderColor: s.color + '60', background: s.color + '10' } : {}}
            >
              <div className="text-sm font-semibold" style={{ color: selectedScenario === i ? s.color : '#94A3B8' }}>{s.label}</div>
              <div className="text-xs text-zinc-600">{(s.rate * 100).toFixed(0)}%/yr</div>
            </button>
          ))}
        </div>

        {/* Main result */}
        <div className="p-5 rounded-xl text-center" style={{ background: scenario.color + '08', border: `1px solid ${scenario.color}25` }}>
          <div className="text-xs text-zinc-500 mb-1">Projected Portfolio Value in {projectionYears} Years ({scenario.label})</div>
          <div className="text-4xl font-extrabold mb-1" style={{ color: scenario.color }}>{formatCurrency(projectedValue)}</div>
          <div className="text-sm text-zinc-500">
            {formatCurrency(totalContributed)} contributed · {formatCurrency(growthGain)} in compound growth
          </div>
          <div className="text-sm text-zinc-400 mt-2">
            Passive income at 4% withdrawal: <strong className="text-white">{formatCurrency(projectedMonthlyIncome)}/month</strong>
          </div>
        </div>
      </div>

      {/* All scenarios table */}
      <div className="glass-card p-5 overflow-x-auto">
        <h3 className="font-semibold text-white mb-4">Full Projection Table</h3>
        <table className="w-full text-sm min-w-[500px]">
          <thead>
            <tr className="text-left border-b border-white/8">
              <th className="pb-2 text-zinc-500 font-medium text-xs uppercase tracking-wide">Year</th>
              <th className="pb-2 text-zinc-400 font-medium text-xs uppercase tracking-wide">Conservative 4%</th>
              <th className="pb-2 text-blue-400 font-medium text-xs uppercase tracking-wide">Moderate 7% ★</th>
              <th className="pb-2 text-emerald-400 font-medium text-xs uppercase tracking-wide">Aggressive 10%</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/4">
            {yearlyProjections.map(row => (
              <tr key={row.years}>
                <td className="py-2 text-zinc-400">{row.years}yr</td>
                <td className="py-2 text-zinc-300 font-mono">{formatCurrency(row.conservative)}</td>
                <td className="py-2 text-blue-300 font-mono font-semibold">{formatCurrency(row.moderate)}</td>
                <td className="py-2 text-emerald-300 font-mono">{formatCurrency(row.aggressive)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-xs text-zinc-600 mt-3">
          Assumes {formatCurrency(contribution)}/month contributions starting from {formatCurrency(starting)} balance. Hypothetical — not guaranteed.
        </p>
      </div>

      {/* Target calculator */}
      <div className="glass-card p-5">
        <h3 className="font-semibold text-white mb-1">How much do I need to invest monthly?</h3>
        <p className="text-xs text-zinc-500 mb-4">Enter a target and we'll calculate the required monthly contribution.</p>
        <div className="grid sm:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="cmd-label">Target Amount ($)</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -tranzinc-y-1/2 text-zinc-500 text-sm">$</span>
              <input className="cmd-input pl-7" type="number" value={targetAmount} onChange={e => setTargetAmount(e.target.value)} placeholder={Math.round(metrics.fire_number).toString()} min="0" />
            </div>
            <p className="text-xs text-zinc-600 mt-1">Default: your FIRE number ({formatCurrency(metrics.fire_number)})</p>
          </div>
          <div className="flex flex-col justify-end">
            <div className="space-y-2">
              <div className="flex items-center justify-between p-3 rounded-lg bg-white/3 border border-white/8">
                <span className="text-xs text-zinc-500">Moderate (7%) in {projectionYears}yr</span>
                <span className="text-sm font-bold text-blue-400">{formatCurrency(monthlyNeededModerate)}/mo</span>
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg bg-white/3 border border-white/8">
                <span className="text-xs text-zinc-500">Aggressive (10%) in {projectionYears}yr</span>
                <span className="text-sm font-bold text-emerald-400">{formatCurrency(monthlyNeededAggressive)}/mo</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* FIRE gauge */}
      <div className="glass-card p-5 border-yellow-400/20 bg-yellow-400/5">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-yellow-400">🔥</span>
          <h3 className="font-semibold text-white text-sm">FIRE Progress</h3>
        </div>
        <div className="flex items-center gap-4 mb-2">
          <div className="flex-1">
            <div className="flex justify-between text-xs text-zinc-500 mb-1">
              <span>Current: {formatCurrency(snapshot.investment_balance + snapshot.savings_balance)}</span>
              <span>FIRE Target: {formatCurrency(metrics.fire_number)}</span>
            </div>
            <div className="h-3 bg-white/5 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${Math.min(100, ((snapshot.investment_balance + snapshot.savings_balance) / Math.max(1, metrics.fire_number)) * 100)}%`,
                  background: 'linear-gradient(90deg, #F5C842, #00D084)',
                }}
              />
            </div>
          </div>
          <div className="text-xl font-bold text-yellow-400 flex-shrink-0">
            {Math.min(100, (((snapshot.investment_balance + snapshot.savings_balance) / Math.max(1, metrics.fire_number)) * 100)).toFixed(0)}%
          </div>
        </div>
        <p className="text-xs text-zinc-500">
          Gap of {formatCurrency(metrics.retirement_gap)} remaining.
          At {formatCurrency(metrics.monthly_investment_needed)}/mo, you reach FIRE in ~{metrics.years_to_retirement} years (age {snapshot.desired_retirement_age}).
        </p>
      </div>

      <LegalDisclaimer compact />
    </div>
  );
}
