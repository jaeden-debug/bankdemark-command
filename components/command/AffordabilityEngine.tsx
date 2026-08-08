'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { clsx } from 'clsx';
import { calcAllMetrics, calcAffordability, formatCurrency } from '@/lib/command/calculations';
import type { FinancialSnapshot, AffordabilityInput, AffordabilityResult } from '@/lib/command/types';
import LegalDisclaimer from './LegalDisclaimer';
import Link from 'next/link';

const CATEGORIES = [
  { value: 'car', label: '🚗 Car / Vehicle', placeholder: { purchase: '35000', payment: '550', down: '5000', term: '60', rate: '7.9' } },
  { value: 'rent', label: '🏠 New Rent / Housing', placeholder: { purchase: '0', payment: '2200', down: '0', term: '0', rate: '0' } },
  { value: 'home', label: '🏡 Home Purchase', placeholder: { purchase: '550000', payment: '2800', down: '55000', term: '300', rate: '5.5' } },
  { value: 'vacation', label: '✈️ Vacation', placeholder: { purchase: '5000', payment: '0', down: '5000', term: '0', rate: '0' } },
  { value: 'baby', label: '👶 Baby / Family Expense', placeholder: { purchase: '15000', payment: '1200', down: '0', term: '12', rate: '0' } },
  { value: 'business', label: '🏢 Business Purchase', placeholder: { purchase: '25000', payment: '800', down: '5000', term: '36', rate: '8.5' } },
  { value: 'custom', label: '📋 Custom Purchase', placeholder: { purchase: '10000', payment: '300', down: '2000', term: '36', rate: '6.9' } },
];

export default function AffordabilityEngine() {
  const supabase = createClient();
  const [snapshot, setSnapshot] = useState<FinancialSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<AffordabilityResult | null>(null);

  const [category, setCategory] = useState<AffordabilityInput['category']>('car');
  const [purchaseAmount, setPurchaseAmount] = useState('35000');
  const [monthlyPayment, setMonthlyPayment] = useState('550');
  const [downPayment, setDownPayment] = useState('5000');
  const [termMonths, setTermMonths] = useState('60');
  const [interestRate, setInterestRate] = useState('7.9');

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: s } = await supabase.from('financial_snapshots').select('*').eq('user_id', user.id).order('updated_at', { ascending: false }).limit(1).single();
      if (s) setSnapshot(s);
      setLoading(false);
    })();
  }, [supabase]);

  const handleCategoryChange = (cat: AffordabilityInput['category']) => {
    setCategory(cat);
    const found = CATEGORIES.find(c => c.value === cat);
    if (found) {
      setPurchaseAmount(found.placeholder.purchase);
      setMonthlyPayment(found.placeholder.payment);
      setDownPayment(found.placeholder.down);
      setTermMonths(found.placeholder.term);
      setInterestRate(found.placeholder.rate);
    }
    setResult(null);
  };

  const check = () => {
    if (!snapshot) return;
    const metrics = calcAllMetrics(snapshot);
    const input: AffordabilityInput = {
      purchase_amount: parseFloat(purchaseAmount) || 0,
      monthly_payment: parseFloat(monthlyPayment) || 0,
      down_payment: parseFloat(downPayment) || 0,
      term_months: parseInt(termMonths) || 0,
      interest_rate: parseFloat(interestRate) || 0,
      category,
    };
    setResult(calcAffordability(input, snapshot, metrics));
  };

  if (loading) return <div className="p-6 space-y-4 animate-pulse">{[...Array(3)].map((_, i) => <div key={i} className="h-32 glass-card rounded-xl bg-white/3" />)}</div>;

  if (!snapshot) {
    return (
      <div className="p-6"><div className="glass-card p-8 text-center">
        <p className="text-zinc-400 mb-4">Complete your profile to use the Affordability Engine.</p>
        <Link href="/command/onboarding" className="cmd-btn-primary inline-block px-6 py-3">Set Up Profile</Link>
      </div></div>
    );
  }

  const metrics = calcAllMetrics(snapshot);

  return (
    <div className="p-4 lg:p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white">Affordability Engine</h1>
        <p className="text-sm text-zinc-500">Can you truly afford it? Get an honest answer based on your real finances.</p>
      </div>

      {/* Current financial context */}
      <div className="glass-card p-4 border-brand-blue/20">
        <p className="text-xs text-zinc-500 uppercase tracking-wide mb-3 font-semibold">Your Current Snapshot</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <div>
            <div className="text-xs text-zinc-600">Monthly Cash Flow</div>
            <div className="font-semibold" style={{ color: metrics.cash_flow_negative ? '#EF4444' : '#00D084' }}>
              {formatCurrency(metrics.monthly_cash_flow)}
            </div>
          </div>
          <div>
            <div className="text-xs text-zinc-600">Emergency Runway</div>
            <div className="font-semibold text-white">{metrics.emergency_runway_months.toFixed(1)} months</div>
          </div>
          <div>
            <div className="text-xs text-zinc-600">Debt-to-Income</div>
            <div className="font-semibold text-white">{(metrics.debt_to_income_ratio * 100).toFixed(0)}%</div>
          </div>
          <div>
            <div className="text-xs text-zinc-600">Max Safe Payment</div>
            <div className="font-semibold text-brand-green">{formatCurrency(metrics.max_safe_monthly_payment)}/mo</div>
          </div>
        </div>
      </div>

      {/* Category selector */}
      <div className="glass-card p-5">
        <h3 className="font-semibold text-white mb-3">What are you considering?</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {CATEGORIES.map(cat => (
            <button
              key={cat.value}
              onClick={() => handleCategoryChange(cat.value as AffordabilityInput['category'])}
              className={clsx(
                'px-3 py-2.5 rounded-xl border text-xs font-medium transition-all text-left',
                category === cat.value
                  ? 'bg-brand-blue/15 border-brand-blue/40 text-blue-400'
                  : 'bg-white/3 border-white/8 text-zinc-400 hover:border-white/14'
              )}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      {/* Inputs */}
      <div className="glass-card p-5">
        <h3 className="font-semibold text-white mb-4">Purchase Details</h3>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="cmd-label">Purchase Price / Total Cost ($)</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -tranzinc-y-1/2 text-zinc-500 text-sm">$</span>
              <input className="cmd-input pl-7" type="number" value={purchaseAmount} onChange={e => setPurchaseAmount(e.target.value)} min="0" />
            </div>
          </div>
          <div>
            <label className="cmd-label">Monthly Payment ($)</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -tranzinc-y-1/2 text-zinc-500 text-sm">$</span>
              <input className="cmd-input pl-7" type="number" value={monthlyPayment} onChange={e => setMonthlyPayment(e.target.value)} min="0" />
            </div>
          </div>
          <div>
            <label className="cmd-label">Down Payment / Cash Out ($)</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -tranzinc-y-1/2 text-zinc-500 text-sm">$</span>
              <input className="cmd-input pl-7" type="number" value={downPayment} onChange={e => setDownPayment(e.target.value)} min="0" />
            </div>
          </div>
          <div>
            <label className="cmd-label">Term (months)</label>
            <input className="cmd-input" type="number" value={termMonths} onChange={e => setTermMonths(e.target.value)} min="0" placeholder="0 = one-time" />
          </div>
          {parseFloat(interestRate) > 0 || category === 'car' || category === 'home' ? (
            <div>
              <label className="cmd-label">Interest Rate (%)</label>
              <div className="relative">
                <input className="cmd-input pr-8" type="number" value={interestRate} onChange={e => setInterestRate(e.target.value)} min="0" step="0.1" />
                <span className="absolute right-3 top-1/2 -tranzinc-y-1/2 text-zinc-500 text-sm">%</span>
              </div>
            </div>
          ) : null}
        </div>

        <button onClick={check} className="cmd-btn-primary w-full py-3 mt-5 text-base">
          Check Affordability
        </button>
      </div>

      {/* Result */}
      {result && (
        <div
          className="glass-card p-6 animate-in"
          style={{ borderColor: result.verdict_color + '40', background: result.verdict_color + '08' }}
        >
          {/* Verdict header */}
          <div className="flex items-center gap-4 mb-5">
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center text-2xl font-extrabold flex-shrink-0"
              style={{ background: result.verdict_color + '20', color: result.verdict_color }}
            >
              {result.verdict === 'affordable' ? '✓' : result.verdict === 'risky' ? '!' : '✕'}
            </div>
            <div>
              <div className="text-xs text-zinc-500 uppercase tracking-wide mb-0.5">Affordability Verdict</div>
              <div className="text-2xl font-extrabold" style={{ color: result.verdict_color }}>{result.verdict_label}</div>
              <div className="text-xs text-zinc-500">Affordability Score: {result.score}/100</div>
            </div>
          </div>

          {/* Score bar */}
          <div className="mb-5">
            <div className="h-2 bg-white/5 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{ width: `${result.score}%`, background: result.verdict_color }}
              />
            </div>
          </div>

          {/* Impact metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-5">
            <div className="p-3 rounded-xl bg-white/4 border border-white/6">
              <div className="text-xs text-zinc-500 mb-1">Cash Flow Impact</div>
              <div className="text-base font-bold text-red-400">{formatCurrency(result.cash_flow_impact)}/mo</div>
            </div>
            <div className="p-3 rounded-xl bg-white/4 border border-white/6">
              <div className="text-xs text-zinc-500 mb-1">New Monthly Cash Flow</div>
              <div className="text-base font-bold" style={{ color: result.new_monthly_cash_flow < 0 ? '#EF4444' : '#00D084' }}>
                {formatCurrency(result.new_monthly_cash_flow)}
              </div>
            </div>
            <div className="p-3 rounded-xl bg-white/4 border border-white/6">
              <div className="text-xs text-zinc-500 mb-1">Emergency Fund After</div>
              <div className="text-base font-bold text-white">{result.emergency_fund_months_remaining} months</div>
            </div>
            <div className="p-3 rounded-xl bg-white/4 border border-white/6">
              <div className="text-xs text-zinc-500 mb-1">New Debt-to-Income</div>
              <div className="text-base font-bold" style={{ color: result.new_debt_pressure > 35 ? '#EF4444' : '#EAB308' }}>
                {result.new_debt_pressure}%
              </div>
            </div>
            <div className="p-3 rounded-xl bg-white/4 border border-white/6 col-span-2 sm:col-span-2">
              <div className="text-xs text-zinc-500 mb-1">Recommended Max Monthly Payment</div>
              <div className="text-base font-bold text-brand-green">{formatCurrency(result.recommended_max_payment)}/mo</div>
            </div>
          </div>

          {/* Analysis */}
          <div className="space-y-3">
            {result.reasons.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-2">Analysis</p>
                <ul className="space-y-1.5">
                  {result.reasons.map((r, i) => (
                    <li key={i} className="text-sm text-zinc-300 flex items-start gap-2">
                      <span style={{ color: result.verdict_color }} className="mt-0.5 flex-shrink-0">›</span>
                      {r}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {result.suggestions.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-2">Suggestions</p>
                <ul className="space-y-1.5">
                  {result.suggestions.map((s, i) => (
                    <li key={i} className="text-sm text-zinc-400 flex items-start gap-2">
                      <span className="text-brand-green mt-0.5 flex-shrink-0">→</span>
                      {s}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="mt-5 pt-4 border-t border-white/6 flex flex-wrap gap-2">
            <Link href="/command/portfolio" className="cmd-btn-secondary text-xs py-2 px-3">
              ✦ Ask Zylx About This
            </Link>
            <Link href="/command/debt" className="cmd-btn-ghost text-xs py-2 px-3">
              View Debt Engine →
            </Link>
          </div>
        </div>
      )}

      <LegalDisclaimer compact />
    </div>
  );
}
