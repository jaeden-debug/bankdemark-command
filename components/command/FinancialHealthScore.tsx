'use client';

import { clsx } from 'clsx';
import type { FinancialMetrics } from '@/lib/command/types';

interface FinancialHealthScoreProps {
  metrics: FinancialMetrics;
  firstName?: string;
}

type HealthBand = 'critical' | 'vulnerable' | 'stable' | 'strong' | 'elite';

const BAND_STYLES: Record<HealthBand, {
  color: string;
  bg: string;
  ring: string;
  message: string;
}> = {
  critical: {
    color: '#EF4444',
    bg: 'rgba(239,68,68,0.08)',
    ring: '#EF4444',
    message: 'Immediate action needed. Focus on cash flow and emergency fund first.',
  },
  vulnerable: {
    color: '#F97316',
    bg: 'rgba(249,115,22,0.08)',
    ring: '#F97316',
    message: "You're exposed to financial shocks. Follow your priority stack closely.",
  },
  stable: {
    color: '#EAB308',
    bg: 'rgba(234,179,8,0.08)',
    ring: '#EAB308',
    message: "Solid foundation. Now it's time to accelerate debt payoff and investing.",
  },
  strong: {
    color: '#22C55E',
    bg: 'rgba(34,197,94,0.08)',
    ring: '#22C55E',
    message: "You're in great shape. Focus on wealth building and optimization.",
  },
  elite: {
    color: '#00D084',
    bg: 'rgba(0,208,132,0.08)',
    ring: '#00D084',
    message: 'Exceptional financial health. Optimize, invest, and help others.',
  },
};

const WEIGHT_LABELS: Record<string, string> = {
  cash_flow: 'Cash Flow',
  emergency_runway: 'Emergency Fund',
  debt_pressure: 'Debt Load',
  savings_rate: 'Savings Rate',
  investment_progress: 'Investments',
  profile_completeness: 'Profile',
};

function getSafeBand(band: string): HealthBand {
  if (band === 'critical' || band === 'vulnerable' || band === 'stable' || band === 'strong' || band === 'elite') {
    return band;
  }

  return 'stable';
}

export default function FinancialHealthScore({ metrics, firstName }: FinancialHealthScoreProps) {
  const healthBand = getSafeBand(String(metrics.health_band));
  const style = BAND_STYLES[healthBand];

  const circumference = 2 * Math.PI * 54;
  const dashOffset = circumference - (metrics.health_score / 100) * circumference;

  const invProgress = Math.min(
    100,
    Math.round(
      metrics.fire_number > 0
        ? Math.min(100, (metrics.total_assets / Math.max(1, metrics.fire_number)) * 100)
        : metrics.total_assets > 0
          ? 50
          : 5
    )
  );

  const breakdown: Record<string, number> = {
    cash_flow: Math.min(
      100,
      Math.round((metrics.monthly_cash_flow > 0 ? 80 : 20) + (metrics.savings_rate > 0.1 ? 20 : 0))
    ),
    emergency_runway: Math.min(
      100,
      Math.round(metrics.emergency_runway_months >= 6 ? 100 : (metrics.emergency_runway_months / 6) * 100)
    ),
    debt_pressure: Math.min(
      100,
      Math.round(metrics.debt_to_income_ratio === 0 ? 100 : Math.max(0, 100 - metrics.debt_to_income_ratio * 300))
    ),
    savings_rate: Math.min(
      100,
      Math.round(metrics.savings_rate >= 0.2 ? 100 : Math.max(0, (metrics.savings_rate / 0.2) * 100))
    ),
    investment_progress: invProgress,
    profile_completeness: 100,
  };

  return (
    <div className="glass-card p-6" style={{ background: style.bg, borderColor: `${style.color}25` }}>
      <div className="flex flex-col items-center gap-6 sm:flex-row">
        <div className="relative flex-shrink-0">
          <svg width="128" height="128" viewBox="0 0 128 128">
            <circle cx="64" cy="64" r="54" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="10" />
            <circle
              cx="64"
              cy="64"
              r="54"
              fill="none"
              stroke={style.ring}
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
              transform="rotate(-90 64 64)"
              style={{
                transition: 'stroke-dashoffset 1s ease',
                filter: `drop-shadow(0 0 8px ${style.ring}60)`,
              }}
            />
          </svg>

          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-3xl font-extrabold" style={{ color: style.color }}>
              {metrics.health_score}
            </span>
            <span className="text-xs font-semibold" style={{ color: style.color }}>
              {metrics.health_label}
            </span>
          </div>
        </div>

        <div className="flex-1 text-center sm:text-left">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Financial Health Score
          </p>

          <h2 className="mb-2 text-xl font-bold text-white">
            {firstName ? `${firstName}, you're ` : "You're "}
            <span style={{ color: style.color }}>{metrics.health_label}</span>
          </h2>

          <p className="mb-4 text-sm leading-relaxed text-zinc-400">
            {style.message}
          </p>

          <div className="flex flex-wrap items-center justify-center gap-1 text-xs text-zinc-600 sm:justify-start">
            {['Critical', 'Vulnerable', 'Stable', 'Strong', 'Elite'].map((band) => (
              <span
                key={band}
                className={clsx(
                  'rounded-full px-2 py-0.5 transition-all',
                  metrics.health_label === band ? 'font-bold text-white' : 'opacity-40'
                )}
                style={metrics.health_label === band ? { background: `${style.color}30`, color: style.color } : undefined}
              >
                {band}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-5 border-t border-white/10 pt-5">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Score Breakdown
        </p>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {Object.entries(breakdown).map(([key, score]) => {
            const scoreColor = score >= 75 ? '#00D084' : score >= 50 ? '#EAB308' : '#EF4444';

            return (
              <div key={key}>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs text-zinc-500">{WEIGHT_LABELS[key]}</span>
                  <span className="text-xs font-semibold" style={{ color: scoreColor }}>
                    {score}
                  </span>
                </div>

                <div className="h-1 overflow-hidden rounded-full bg-white/5">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{
                      width: `${score}%`,
                      background: scoreColor,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
