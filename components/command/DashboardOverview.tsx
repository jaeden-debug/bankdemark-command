'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { calcAllMetrics, formatCurrency, addMonthsToDate } from '@/lib/command/calculations';
import { generateRecommendations } from '@/lib/command/recommendations';
import type { FinancialSnapshot, UserProfile, FinancialMetrics } from '@/lib/command/types';
import FinancialHealthScore from './FinancialHealthScore';
import MetricCard from './MetricCard';
import PriorityStack from './PriorityStack';
import RecommendationCard from './RecommendationCard';
import ProUpgradeCard from './ProUpgradeCard';
import LegalDisclaimer from './LegalDisclaimer';


function ScoreTrendChart({ history }: { history: { score: number; recorded_at: string }[] }) {
  const min = Math.max(0, Math.min(...history.map(h => h.score)) - 5);
  const max = Math.min(100, Math.max(...history.map(h => h.score)) + 5);
  const range = max - min || 1;
  const W = 400, H = 56, pad = 4;
  const pts = history.map((h, i) => {
    const x = pad + (i / (history.length - 1)) * (W - pad * 2);
    const y = H - pad - ((h.score - min) / range) * (H - pad * 2);
    return `${x},${y}`;
  });
  const last = history[history.length - 1];
  const first = history[0];
  const up = last.score >= first.score;
  const color = up ? '#00D084' : '#F87171';
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 56 }}>
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" style={{ filter: `drop-shadow(0 0 4px ${color}80)` }} />
      {history.map((h, i) => {
        const [x, y] = pts[i].split(',').map(Number);
        return <circle key={i} cx={x} cy={y} r="3" fill={color} />;
      })}
    </svg>
  );
}

export default function DashboardOverview() {
  const supabase = createClient();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [snapshot, setSnapshot] = useState<FinancialSnapshot | null>(null);
  const [metrics, setMetrics] = useState<FinancialMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scoreHistory, setScoreHistory] = useState<{ score: number; recorded_at: string }[]>([]);

  const loadData = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    const [{ data: p }, { data: s }, { data: history }] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', user.id).single(),
      supabase.from('financial_snapshots').select('*').eq('user_id', user.id).order('updated_at', { ascending: false }).limit(1).single(),
      supabase.from('score_history').select('score, recorded_at').eq('user_id', user.id).order('recorded_at', { ascending: true }).limit(30),
    ]);
    if (history) setScoreHistory(history);

    if (p) setProfile(p);
    if (s) {
      setSnapshot(s);
      setMetrics(calcAllMetrics(s, p?.age));
    } else {
      setError('no_snapshot');
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => { loadData(); }, [loadData]);

  if (loading) {
    return (
      <div className="p-4 lg:p-6 space-y-4">
        {/* Score card skeleton */}
        <div className="glass-card p-6 animate-pulse flex gap-6 items-center">
          <div className="w-32 h-32 rounded-full bg-white/5 flex-shrink-0" />
          <div className="flex-1 space-y-3">
            <div className="h-3 w-24 rounded bg-white/5" />
            <div className="h-6 w-48 rounded bg-white/5" />
            <div className="h-3 w-64 rounded bg-white/5" />
            <div className="h-2 w-full rounded-full bg-white/5" />
          </div>
        </div>
        {/* Metric cards skeleton */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="glass-card p-4 animate-pulse space-y-2">
              <div className="h-2 w-20 rounded bg-white/5" />
              <div className="h-6 w-24 rounded bg-white/5" />
              <div className="h-2 w-16 rounded bg-white/5" />
            </div>
          ))}
        </div>
        {/* Recommendations skeleton */}
        <div className="glass-card p-5 animate-pulse space-y-3">
          <div className="h-3 w-32 rounded bg-white/5" />
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-14 rounded-lg bg-white/5" />
          ))}
        </div>
      </div>
    );
  }

  if (error === 'no_snapshot' || !snapshot || !metrics) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <div className="glass-card p-8 text-center">
          <div className="text-4xl mb-4">⬡</div>
          <h2 className="text-xl font-bold text-white mb-2">Complete Your Financial Profile</h2>
          <p className="text-zinc-400 text-sm mb-6 leading-relaxed">
            Your dashboard is ready — but you need to add your financial data first.
            It takes about 5 minutes and your score calculates instantly.
          </p>
          <Link href="/command/onboarding" className="cmd-btn-primary inline-block px-8 py-3">
            Set Up My Profile
          </Link>
        </div>
      </div>
    );
  }

  const recommendations = generateRecommendations(profile!, snapshot, metrics);
  const totalIncome = snapshot.monthly_income + (snapshot.business_revenue ?? 0);

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-6xl mx-auto">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">
            {profile?.first_name ? `Welcome back, ${profile.first_name}` : 'Your Dashboard'}
          </h1>
          <p className="text-sm text-zinc-500">
            Financial snapshot — last updated {snapshot.updated_at ? new Date(snapshot.updated_at).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' }) : 'today'}
          </p>
        </div>
        <Link href="/command/profile" className="cmd-btn-secondary text-xs py-2 px-3 no-print">
          ⚙ Update Data
        </Link>
      </div>

      {/* Health Score */}
      <FinancialHealthScore metrics={metrics} firstName={profile?.first_name} />

      {/* Score Trend Sparkline */}
      {scoreHistory.length >= 2 && (
        <div className="glass-card p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Score Trend (last {scoreHistory.length} updates)</p>
            <span className={`text-xs font-semibold ${scoreHistory[scoreHistory.length-1].score >= scoreHistory[0].score ? 'text-brand-green' : 'text-red-400'}`}>
              {scoreHistory[scoreHistory.length-1].score >= scoreHistory[0].score ? '↑' : '↓'} {Math.abs(scoreHistory[scoreHistory.length-1].score - scoreHistory[0].score)} pts
            </span>
          </div>
          <ScoreTrendChart history={scoreHistory} />
        </div>
      )}

      {/* Core Metrics Grid */}
      <div>
        <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide mb-3">Core Metrics</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          <MetricCard
            label="Monthly Cash Flow"
            value={formatCurrency(metrics.monthly_cash_flow)}
            subtext={metrics.cash_flow_negative ? 'Spending more than earning' : `${(metrics.savings_rate * 100).toFixed(0)}% savings rate`}
            status={metrics.cash_flow_negative ? 'danger' : metrics.savings_rate >= 0.15 ? 'good' : 'warn'}
            icon="↕"
          />
          <MetricCard
            label="Emergency Runway"
            value={`${metrics.emergency_runway_months.toFixed(1)} mo`}
            subtext={`Target: ${snapshot.emergency_fund_target_months} months — ${metrics.emergency_status}`}
            status={metrics.emergency_status === 'strong' ? 'good' : metrics.emergency_status === 'okay' ? 'warn' : 'danger'}
            icon="🛡"
          />
          <MetricCard
            label="Net Worth"
            value={formatCurrency(metrics.net_worth)}
            subtext={`Assets ${formatCurrency(metrics.total_assets)} · Debt ${formatCurrency(metrics.total_liabilities)}`}
            status={metrics.net_worth > 0 ? 'good' : 'danger'}
            icon="◈"
          />
          <MetricCard
            label="Savings Rate"
            value={`${(metrics.savings_rate * 100).toFixed(1)}%`}
            subtext={metrics.savings_rate >= 0.2 ? 'Excellent' : metrics.savings_rate >= 0.1 ? 'Good — push toward 20%' : 'Low — aim for 10%+'}
            status={metrics.savings_rate >= 0.2 ? 'good' : metrics.savings_rate >= 0.1 ? 'warn' : 'danger'}
            icon="💰"
          />
          <MetricCard
            label="Debt Pressure"
            value={`${(metrics.debt_to_income_ratio * 100).toFixed(0)}% DTI`}
            subtext={metrics.dangerously_high_debt ? 'Danger zone — act now' : metrics.debt_to_income_ratio > 0.2 ? 'High — reduce obligations' : 'Manageable'}
            status={metrics.dangerously_high_debt ? 'danger' : metrics.debt_to_income_ratio > 0.2 ? 'warn' : 'good'}
            icon="⊗"
          />
          <MetricCard
            label="FIRE Number"
            value={formatCurrency(metrics.fire_number)}
            subtext={`Gap: ${formatCurrency(metrics.retirement_gap)} — ${metrics.years_to_retirement}yr runway`}
            status={metrics.near_retirement_underfunded ? 'danger' : metrics.retirement_gap < metrics.fire_number * 0.5 ? 'good' : 'warn'}
            icon="🔥"
          />
          <MetricCard
            label="Debt-Free Date"
            value={metrics.debt_free_months < 600 && snapshot.total_debt > 0 ? addMonthsToDate(metrics.debt_free_months) : snapshot.total_debt === 0 ? 'Debt-Free!' : '>10 Years'}
            subtext={snapshot.total_debt > 0 ? `Total interest: ${formatCurrency(metrics.total_interest_cost)}` : 'Zero debt — outstanding'}
            status={snapshot.total_debt === 0 ? 'good' : metrics.high_interest_debt_flag ? 'danger' : 'warn'}
            icon="📅"
          />
          <MetricCard
            label="Monthly Investment"
            value={formatCurrency(metrics.monthly_investment_needed)}
            subtext="Needed to reach FIRE on schedule"
            status={metrics.monthly_investment_needed <= Math.max(0, metrics.monthly_cash_flow) ? 'good' : 'warn'}
            icon="📈"
          />
        </div>
      </div>

      {/* Wealth Projection Strip */}
      <div className="glass-card p-5 bg-gradient-to-r from-brand-blue/5 to-brand-green/5 border-brand-blue/15">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-brand-blue">◈</span>
          <h3 className="font-semibold text-white text-sm">10-Year Wealth Projection</h3>
          <span className="text-xs text-zinc-600">(investing {Math.round(Math.max(0, metrics.monthly_cash_flow) * 0.3).toLocaleString()}/mo)</span>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div className="text-center">
            <div className="text-xs text-zinc-500 mb-1">Conservative (4%)</div>
            <div className="text-xl font-bold text-zinc-300">{formatCurrency(metrics.projection_conservative)}</div>
          </div>
          <div className="text-center border-x border-white/5">
            <div className="text-xs text-brand-blue mb-1">Moderate (7%) ★</div>
            <div className="text-xl font-bold text-blue-400">{formatCurrency(metrics.projection_moderate)}</div>
          </div>
          <div className="text-center">
            <div className="text-xs text-zinc-500 mb-1">Aggressive (10%)</div>
            <div className="text-xl font-bold text-zinc-300">{formatCurrency(metrics.projection_aggressive)}</div>
          </div>
        </div>
        <p className="text-xs text-zinc-600 mt-3 text-center">
          Hypothetical projections only. Assumes consistent contributions. Not a guarantee.{' '}
          <Link href="/command/wealth" className="text-brand-blue hover:underline">Open Wealth Engine →</Link>
        </p>
      </div>

      {/* Two-column: Priority Stack + Top Recommendations */}
      <div className="grid lg:grid-cols-2 gap-6">
        <div>
          <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide mb-3">Your Priority Stack</h2>
          <PriorityStack snapshot={snapshot} metrics={metrics} />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide mb-3">Top Recommendations</h2>
          <div className="space-y-3">
            {recommendations.slice(0, 3).map(rec => (
              <RecommendationCard key={rec.key} rec={rec} />
            ))}
            {recommendations.length > 3 && (
              <Link href="/command/marketplace" className="block text-xs text-center text-zinc-500 hover:text-zinc-300 py-2 transition-colors">
                View all {recommendations.length} recommendations →
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* Income breakdown */}
      <div className="glass-card p-5">
        <h3 className="font-semibold text-white text-sm mb-4">Monthly Cash Flow Breakdown</h3>
        <div className="grid sm:grid-cols-2 gap-6">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-zinc-500">Monthly Income</span>
              <span className="text-sm font-semibold text-emerald-400">{formatCurrency(totalIncome)}</span>
            </div>
            {[
              { label: 'Fixed Expenses', value: snapshot.fixed_expenses, pct: snapshot.fixed_expenses / totalIncome },
              { label: 'Variable Expenses', value: snapshot.variable_expenses, pct: snapshot.variable_expenses / totalIncome },
              { label: 'Housing', value: snapshot.housing_payment, pct: snapshot.housing_payment / totalIncome },
              { label: 'Debt Payments', value: snapshot.minimum_debt_payment, pct: snapshot.minimum_debt_payment / totalIncome },
            ].filter(r => r.value > 0).map(row => (
              <div key={row.label} className="flex items-center gap-3 py-1.5 border-b border-white/4 last:border-0">
                <div className="w-28 text-xs text-zinc-500">{row.label}</div>
                <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
                  <div className="h-full rounded-full bg-red-400/60" style={{ width: `${Math.min(100, row.pct * 100)}%` }} />
                </div>
                <div className="w-20 text-right text-xs text-zinc-400">
                  {formatCurrency(row.value)} <span className="text-zinc-600">({(row.pct * 100).toFixed(0)}%)</span>
                </div>
              </div>
            ))}
          </div>
          <div className="flex flex-col justify-center">
            <div className="glass-card p-4 text-center" style={metrics.cash_flow_negative ? { borderColor: 'rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.05)' } : { borderColor: 'rgba(0,208,132,0.2)', background: 'rgba(0,208,132,0.05)' }}>
              <div className="text-xs text-zinc-500 mb-1">Monthly Surplus / Deficit</div>
              <div className="text-3xl font-extrabold" style={{ color: metrics.cash_flow_negative ? '#EF4444' : '#00D084' }}>
                {metrics.cash_flow_negative ? '-' : '+'}{formatCurrency(Math.abs(metrics.monthly_cash_flow))}
              </div>
              <div className="text-xs text-zinc-500 mt-1">{formatCurrency(Math.abs(metrics.annual_cash_flow))} per year</div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Link href="/command/debt" className="cmd-btn-secondary text-xs py-2 text-center">
                Debt Engine
              </Link>
              <Link href="/command/wealth" className="cmd-btn-secondary text-xs py-2 text-center">
                Wealth Engine
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Pro upgrade */}
      <ProUpgradeCard inline />

      {/* Quick links to reports */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { href: '/command/reports', label: 'Monthly Report', icon: '⊟', desc: 'Full financial summary' },
          { href: '/command/portfolio', label: 'Ask Zylx', icon: '✦', desc: 'Ask about your business' },
          { href: '/command/affordability', label: 'Affordability Check', icon: '◎', desc: 'Can I afford this?' },
          { href: '/command/marketplace', label: 'Product Tools', icon: '⊕', desc: 'Compare financial products' },
        ].map(link => (
          <Link key={link.href} href={link.href} className="glass-card p-4 hover:border-white/14 transition-all group">
            <div className="text-xl text-zinc-400 group-hover:text-brand-green transition-colors mb-2">{link.icon}</div>
            <div className="text-sm font-semibold text-white">{link.label}</div>
            <div className="text-xs text-zinc-500 mt-0.5">{link.desc}</div>
          </Link>
        ))}
      </div>

      <LegalDisclaimer />
    </div>
  );
}
