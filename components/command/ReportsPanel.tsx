'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { clsx } from 'clsx';
import { calcAllMetrics, formatCurrency, addMonthsToDate } from '@/lib/command/calculations';
import { generateRecommendations, generatePriorityStack } from '@/lib/command/recommendations';
import type { FinancialSnapshot, UserProfile, FinancialMetrics } from '@/lib/command/types';
import LegalDisclaimer from './LegalDisclaimer';
import Link from 'next/link';

type ReportType = 'health_summary' | 'monthly_wealth' | 'debt_freedom' | 'emergency_fund';

const REPORTS = [
  { id: 'health_summary' as ReportType, label: 'Financial Health Summary', icon: '⬡', desc: 'Complete overview of all financial health factors' },
  { id: 'monthly_wealth' as ReportType, label: 'Monthly Wealth Report', icon: '◈', desc: 'Net worth, projections, and investment progress' },
  { id: 'debt_freedom' as ReportType, label: 'Debt Freedom Report', icon: '⊗', desc: 'Debt strategy, timeline, and interest analysis' },
  { id: 'emergency_fund' as ReportType, label: 'Emergency Fund Report', icon: '🛡', desc: 'Savings status, gap analysis, and plan' },
];

const SCORE_COLORS: Record<string, string> = {
  critical: '#EF4444', vulnerable: '#F97316', stable: '#EAB308', strong: '#22C55E', elite: '#00D084',
};

export default function ReportsPanel() {
  const supabase = createClient();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [snapshot, setSnapshot] = useState<FinancialSnapshot | null>(null);
  const [metrics, setMetrics] = useState<FinancialMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeReport, setActiveReport] = useState<ReportType>('health_summary');

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const [{ data: p }, { data: s }] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', user.id).single(),
        supabase.from('financial_snapshots').select('*').eq('user_id', user.id).order('updated_at', { ascending: false }).limit(1).single(),
      ]);
      if (p) setProfile(p);
      if (s) {
        setSnapshot(s);
        setMetrics(calcAllMetrics(s, p?.age));
      }
      setLoading(false);
    })();
  }, [supabase]);

  if (loading) return <div className="p-6 space-y-4 animate-pulse">{[...Array(3)].map((_, i) => <div key={i} className="h-32 glass-card rounded-xl bg-white/3" />)}</div>;
  if (!snapshot || !metrics) {
    return (
      <div className="p-6"><div className="glass-card p-8 text-center">
        <p className="text-zinc-400 mb-4">Complete your financial profile to generate reports.</p>
        <Link href="/command/onboarding" className="cmd-btn-primary inline-block px-6 py-3">Set Up Profile</Link>
      </div></div>
    );
  }

  const recommendations = generateRecommendations(profile!, snapshot, metrics);
  const priorities = generatePriorityStack(snapshot, metrics);
  const scoreColor = SCORE_COLORS[metrics.health_band] || '#94A3B8';
  const reportDate = new Date().toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });

  return (
    <div className="p-4 lg:p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between no-print">
        <div>
          <h1 className="text-xl font-bold text-white">Financial Reports</h1>
          <p className="text-sm text-zinc-500">Print-ready summaries of your financial picture</p>
        </div>
        <button onClick={() => window.print()} className="cmd-btn-secondary text-xs py-2 px-4">
          🖨 Print / Save PDF
        </button>
      </div>

      {/* Report selector */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 no-print">
        {REPORTS.map(r => (
          <button
            key={r.id}
            onClick={() => setActiveReport(r.id)}
            className={clsx(
              'p-3 rounded-xl border text-left transition-all',
              activeReport === r.id
                ? 'bg-brand-green/12 border-brand-green/35 text-brand-green'
                : 'glass-card text-zinc-400 hover:border-white/14'
            )}
          >
            <div className="text-lg mb-1">{r.icon}</div>
            <div className="text-xs font-semibold">{r.label}</div>
          </button>
        ))}
      </div>

      {/* ── HEALTH SUMMARY REPORT ── */}
      {activeReport === 'health_summary' && (
        <div className="space-y-5 print-white">
          <div className="glass-card p-6 print-card">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-bold text-white">Financial Health Summary</h2>
                <p className="text-xs text-zinc-500">{reportDate} · {profile?.first_name || 'Your Report'}</p>
              </div>
              <div className="text-right">
                <div className="text-3xl font-extrabold" style={{ color: scoreColor }}>{metrics.health_score}</div>
                <div className="text-xs font-semibold" style={{ color: scoreColor }}>{metrics.health_label}</div>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-5">
              {[
                { label: 'Monthly Cash Flow', value: formatCurrency(metrics.monthly_cash_flow), ok: !metrics.cash_flow_negative },
                { label: 'Savings Rate', value: `${(metrics.savings_rate * 100).toFixed(1)}%`, ok: metrics.savings_rate >= 0.10 },
                { label: 'Emergency Runway', value: `${metrics.emergency_runway_months.toFixed(1)} months`, ok: metrics.emergency_runway_months >= 3 },
                { label: 'Debt-to-Income', value: `${(metrics.debt_to_income_ratio * 100).toFixed(0)}%`, ok: metrics.debt_to_income_ratio < 0.20 },
                { label: 'Net Worth', value: formatCurrency(metrics.net_worth), ok: metrics.net_worth > 0 },
                { label: 'FIRE Progress', value: `${Math.min(100, (((snapshot.investment_balance + snapshot.savings_balance) / Math.max(1, metrics.fire_number)) * 100)).toFixed(0)}%`, ok: true },
              ].map(item => (
                <div key={item.label} className="p-3 rounded-xl bg-white/3 border border-white/6">
                  <div className="text-xs text-zinc-500 mb-1">{item.label}</div>
                  <div className="text-base font-bold" style={{ color: item.ok ? '#00D084' : '#EF4444' }}>{item.value}</div>
                </div>
              ))}
            </div>

            <div className="space-y-3">
              <div>
                <p className="text-xs text-zinc-500 uppercase tracking-wide mb-2 font-semibold">Key Strengths</p>
                <ul className="space-y-1">
                  {[
                    !metrics.cash_flow_negative && '✅ Positive monthly cash flow',
                    metrics.emergency_status === 'strong' && '✅ Strong emergency fund',
                    snapshot.total_debt === 0 && '✅ Zero debt',
                    metrics.savings_rate >= 0.20 && '✅ High savings rate',
                    metrics.net_worth > 0 && '✅ Positive net worth',
                  ].filter(Boolean).map((item, i) => (
                    <li key={i} className="text-sm text-zinc-300">{item as string}</li>
                  ))}
                  {[!metrics.cash_flow_negative, metrics.emergency_status === 'strong', snapshot.total_debt === 0, metrics.savings_rate >= 0.20, metrics.net_worth > 0].every(x => !x) && (
                    <li className="text-sm text-zinc-500 italic">Focus on building your foundation first.</li>
                  )}
                </ul>
              </div>
              <div>
                <p className="text-xs text-zinc-500 uppercase tracking-wide mb-2 font-semibold">Key Risks</p>
                <ul className="space-y-1">
                  {[
                    metrics.cash_flow_negative && '⚠️ Negative monthly cash flow',
                    metrics.no_emergency_fund && '⚠️ No emergency fund',
                    metrics.dangerously_high_debt && '⚠️ Critical debt load',
                    metrics.high_interest_debt_flag && snapshot.total_debt > 0 && '⚠️ High-interest debt destroying wealth',
                    metrics.near_retirement_underfunded && '⚠️ Near retirement with significant gap',
                  ].filter(Boolean).map((item, i) => (
                    <li key={i} className="text-sm text-red-300">{item as string}</li>
                  ))}
                  {!metrics.cash_flow_negative && !metrics.no_emergency_fund && !metrics.dangerously_high_debt && (
                    <li className="text-sm text-zinc-500 italic">No critical risks detected. Maintain course.</li>
                  )}
                </ul>
              </div>
              <div>
                <p className="text-xs text-zinc-500 uppercase tracking-wide mb-2 font-semibold">Next Actions</p>
                <ol className="space-y-1">
                  {priorities.slice(0, 4).map((p, i) => (
                    <li key={i} className="text-sm text-zinc-300 flex items-start gap-2">
                      <span className="text-xs text-zinc-600 mt-0.5 flex-shrink-0">{i + 1}.</span>
                      {p}
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── MONTHLY WEALTH REPORT ── */}
      {activeReport === 'monthly_wealth' && (
        <div className="space-y-5 print-white">
          <div className="glass-card p-6 print-card">
            <div className="mb-4">
              <h2 className="text-lg font-bold text-white">Monthly Wealth Report</h2>
              <p className="text-xs text-zinc-500">{reportDate}</p>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-5">
              {[
                { label: 'Total Assets', value: formatCurrency(metrics.total_assets), color: '#00D084' },
                { label: 'Total Liabilities', value: formatCurrency(metrics.total_liabilities), color: '#EF4444' },
                { label: 'Net Worth', value: formatCurrency(metrics.net_worth), color: metrics.net_worth > 0 ? '#00D084' : '#EF4444' },
                { label: 'Monthly Cash Flow', value: formatCurrency(metrics.monthly_cash_flow), color: metrics.cash_flow_negative ? '#EF4444' : '#00D084' },
                { label: 'Annual Cash Flow', value: formatCurrency(metrics.annual_cash_flow), color: metrics.cash_flow_negative ? '#EF4444' : '#00D084' },
                { label: 'Savings Rate', value: `${(metrics.savings_rate * 100).toFixed(1)}%`, color: metrics.savings_rate >= 0.10 ? '#00D084' : '#EF4444' },
              ].map(item => (
                <div key={item.label} className="p-3 rounded-xl bg-white/3 border border-white/6">
                  <div className="text-xs text-zinc-500 mb-1">{item.label}</div>
                  <div className="text-base font-bold" style={{ color: item.color }}>{item.value}</div>
                </div>
              ))}
            </div>

            <div className="border-t border-white/6 pt-4">
              <p className="text-xs text-zinc-500 uppercase tracking-wide mb-3 font-semibold">10-Year Wealth Projections</p>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'Conservative (4%)', value: metrics.projection_conservative, color: '#94A3B8' },
                  { label: 'Moderate (7%)', value: metrics.projection_moderate, color: '#3B82F6' },
                  { label: 'Aggressive (10%)', value: metrics.projection_aggressive, color: '#00D084' },
                ].map(item => (
                  <div key={item.label} className="text-center p-3 rounded-xl bg-white/3 border border-white/6">
                    <div className="text-xs text-zinc-500 mb-1">{item.label}</div>
                    <div className="text-lg font-bold" style={{ color: item.color }}>{formatCurrency(item.value)}</div>
                  </div>
                ))}
              </div>
              <p className="text-xs text-zinc-600 mt-2">Assumes current investment balance + 30% of cash flow monthly. Hypothetical.</p>
            </div>

            <div className="border-t border-white/6 pt-4 mt-4">
              <p className="text-xs text-zinc-500 uppercase tracking-wide mb-2 font-semibold">FIRE & Retirement</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs text-zinc-600">FIRE Number</div>
                  <div className="text-base font-bold text-yellow-400">{formatCurrency(metrics.fire_number)}</div>
                </div>
                <div>
                  <div className="text-xs text-zinc-600">Retirement Gap</div>
                  <div className="text-base font-bold text-orange-400">{formatCurrency(metrics.retirement_gap)}</div>
                </div>
                <div>
                  <div className="text-xs text-zinc-600">Monthly Investment Needed</div>
                  <div className="text-base font-bold text-blue-400">{formatCurrency(metrics.monthly_investment_needed)}</div>
                </div>
                <div>
                  <div className="text-xs text-zinc-600">Projected Monthly Passive</div>
                  <div className="text-base font-bold text-emerald-400">{formatCurrency(metrics.monthly_passive_income_projected)}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── DEBT FREEDOM REPORT ── */}
      {activeReport === 'debt_freedom' && (
        <div className="space-y-5 print-white">
          <div className="glass-card p-6 print-card">
            <div className="mb-4">
              <h2 className="text-lg font-bold text-white">Debt Freedom Report</h2>
              <p className="text-xs text-zinc-500">{reportDate}</p>
            </div>

            {snapshot.total_debt === 0 ? (
              <div className="text-center py-8">
                <div className="text-4xl mb-3">🎉</div>
                <h3 className="text-xl font-bold text-emerald-400 mb-2">You&rsquo;re Debt-Free!</h3>
                <p className="text-zinc-400 text-sm">No debt detected in your profile. Direct all freed-up cash flow to wealth building.</p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { label: 'Total Debt', value: formatCurrency(snapshot.total_debt), color: '#EF4444' },
                    { label: 'Avg Interest Rate', value: `${snapshot.average_debt_interest}%`, color: snapshot.average_debt_interest > 10 ? '#EF4444' : '#EAB308' },
                    { label: 'Debt-Free Date', value: metrics.debt_free_months < 600 ? addMonthsToDate(metrics.debt_free_months) : '>10 Years', color: '#00D084' },
                    { label: 'Total Interest Cost', value: formatCurrency(metrics.total_interest_cost), color: '#F97316' },
                  ].map(item => (
                    <div key={item.label} className="p-3 rounded-xl bg-white/3 border border-white/6">
                      <div className="text-xs text-zinc-500 mb-1">{item.label}</div>
                      <div className="text-base font-bold" style={{ color: item.color }}>{item.value}</div>
                    </div>
                  ))}
                </div>

                <div className="p-4 rounded-xl bg-white/3 border border-white/6">
                  <p className="text-xs text-zinc-500 uppercase tracking-wide mb-2 font-semibold">Debt Pressure Analysis</p>
                  <div className="space-y-2 text-sm text-zinc-300">
                    <p>Debt-to-income ratio: <strong style={{ color: metrics.debt_to_income_ratio > 0.35 ? '#EF4444' : '#00D084' }}>{(metrics.debt_to_income_ratio * 100).toFixed(0)}%</strong> (safe: under 20%)</p>
                    <p>Debt pressure score: <strong style={{ color: metrics.debt_pressure_score > 60 ? '#EF4444' : '#EAB308' }}>{metrics.debt_pressure_score}/100</strong> (lower is better)</p>
                    {metrics.high_interest_debt_flag && <p className="text-red-300">⚠️ High-interest debt detected. Prioritize payoff using avalanche method.</p>}
                    {metrics.dangerously_high_debt && <p className="text-red-300">⚠️ Debt load is critically high. Consider professional credit counselling.</p>}
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-white/3 border border-white/6">
                  <p className="text-xs text-zinc-500 uppercase tracking-wide mb-2 font-semibold">Recommended Strategy</p>
                  <ul className="space-y-1 text-sm text-zinc-300">
                    <li>• Use the Debt Engine Avalanche method to minimize total interest</li>
                    <li>• Pay {formatCurrency(snapshot.minimum_debt_payment)}/mo in minimums, direct all extra cash to highest-rate debt</li>
                    <li>• Every {formatCurrency(100)} extra per month shaves months off your payoff date</li>
                    {metrics.high_interest_debt_flag && <li>• Explore balance transfer options if credit score permits</li>}
                  </ul>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── EMERGENCY FUND REPORT ── */}
      {activeReport === 'emergency_fund' && (
        <div className="space-y-5 print-white">
          <div className="glass-card p-6 print-card">
            <div className="mb-4">
              <h2 className="text-lg font-bold text-white">Emergency Fund Report</h2>
              <p className="text-xs text-zinc-500">{reportDate}</p>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
              {[
                { label: 'Current Savings', value: formatCurrency(snapshot.savings_balance), color: '#3B82F6' },
                { label: 'Emergency Runway', value: `${metrics.emergency_runway_months.toFixed(1)} months`, color: metrics.emergency_status === 'strong' ? '#00D084' : '#EF4444' },
                { label: 'Target', value: `${snapshot.emergency_fund_target_months} months`, color: '#94A3B8' },
                { label: 'Gap to Fill', value: formatCurrency(metrics.emergency_fund_gap), color: metrics.emergency_fund_gap > 0 ? '#F97316' : '#00D084' },
              ].map(item => (
                <div key={item.label} className="p-3 rounded-xl bg-white/3 border border-white/6">
                  <div className="text-xs text-zinc-500 mb-1">{item.label}</div>
                  <div className="text-base font-bold" style={{ color: item.color }}>{item.value}</div>
                </div>
              ))}
            </div>

            {/* Progress bar */}
            <div className="mb-5">
              <div className="flex justify-between text-xs text-zinc-500 mb-1">
                <span>{formatCurrency(snapshot.savings_balance)} saved</span>
                <span>Target: {formatCurrency(metrics.emergency_fund_target)}</span>
              </div>
              <div className="h-3 bg-white/5 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${Math.min(100, (snapshot.savings_balance / Math.max(1, metrics.emergency_fund_target)) * 100)}%`,
                    background: metrics.emergency_status === 'strong' ? '#00D084' : metrics.emergency_status === 'okay' ? '#EAB308' : '#EF4444',
                  }}
                />
              </div>
            </div>

            <div className="space-y-3">
              <div className="p-4 rounded-xl bg-white/3 border border-white/6">
                <p className="text-xs text-zinc-500 uppercase tracking-wide mb-2 font-semibold">Status Assessment</p>
                <div className="text-sm text-zinc-300 space-y-1">
                  {metrics.emergency_status === 'critical' && <p className="text-red-300">🚨 Critical: Less than 1 month of expenses. Immediate action required.</p>}
                  {metrics.emergency_status === 'low' && <p className="text-orange-300">⚠️ Low: {metrics.emergency_runway_months.toFixed(1)} months covered. Target 3–6 months.</p>}
                  {metrics.emergency_status === 'okay' && <p className="text-yellow-300">📈 Okay: {metrics.emergency_runway_months.toFixed(1)} months covered. Keep building toward {snapshot.emergency_fund_target_months} months.</p>}
                  {metrics.emergency_status === 'strong' && <p className="text-emerald-300">✅ Strong: {metrics.emergency_runway_months.toFixed(1)} months covered. Well protected.</p>}
                </div>
              </div>
              {metrics.emergency_fund_gap > 0 && (
                <div className="p-4 rounded-xl bg-white/3 border border-white/6">
                  <p className="text-xs text-zinc-500 uppercase tracking-wide mb-2 font-semibold">Plan to Close the Gap</p>
                  <div className="space-y-1 text-sm text-zinc-300">
                    <p>Gap: {formatCurrency(metrics.emergency_fund_gap)} to reach {snapshot.emergency_fund_target_months}-month target</p>
                    {metrics.monthly_cash_flow > 0 && (
                      <>
                        <p>• Saving {formatCurrency(Math.min(metrics.monthly_cash_flow * 0.5, 500))}/month: {Math.ceil(metrics.emergency_fund_gap / Math.min(metrics.monthly_cash_flow * 0.5, 500))} months to goal</p>
                        <p>• Saving {formatCurrency(Math.min(metrics.monthly_cash_flow, 1000))}/month: {Math.ceil(metrics.emergency_fund_gap / Math.min(metrics.monthly_cash_flow, 1000))} months to goal</p>
                      </>
                    )}
                    <p>• Park in a high-interest savings account for better returns while keeping liquidity</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Top recommendations in all reports */}
      <div className="glass-card p-5 print-card">
        <p className="text-xs text-zinc-500 uppercase tracking-wide mb-3 font-semibold">Top Recommendations</p>
        <div className="space-y-3">
          {recommendations.slice(0, 3).map(rec => (
            <div key={rec.key} className="flex items-start gap-3 text-sm">
              <span>{rec.icon}</span>
              <div>
                <p className="font-semibold text-white">{rec.title}</p>
                <p className="text-zinc-500 text-xs mt-0.5">{rec.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Print CTA */}
      <div className="glass-card p-5 no-print bg-gradient-to-r from-brand-gold/5 to-transparent border-brand-gold/20">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-yellow-300">✦ BankDeMark Pro — PDF Export</p>
            <p className="text-xs text-zinc-500">Unlock branded PDF reports you can save, share, and review monthly.</p>
          </div>
          <Link href="/command/marketplace" className="cmd-btn-secondary text-xs py-2 px-4 flex-shrink-0">
            Learn More
          </Link>
        </div>
      </div>

      <LegalDisclaimer />
    </div>
  );
}
