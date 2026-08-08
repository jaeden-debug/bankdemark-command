'use client';

import Link from 'next/link';
import type { FinancialMetrics, FinancialSnapshot } from '@/lib/command/types';
import { generatePriorityStack, generateRiskWarnings } from '@/lib/command/recommendations';

interface PriorityStackProps {
  snapshot: FinancialSnapshot;
  metrics: FinancialMetrics;
}

export default function PriorityStack({ snapshot, metrics }: PriorityStackProps) {
  const priorities = generatePriorityStack(snapshot, metrics);
  const warnings = generateRiskWarnings(snapshot, metrics);

  return (
    <div className="space-y-4">
      {/* Risk Warnings */}
      {warnings.length > 0 && (
        <div className="glass-card p-5 border-red-500/20 bg-red-500/5">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-red-400 text-lg">⚠</span>
            <h3 className="font-semibold text-red-300 text-sm uppercase tracking-wide">Active Risk Warnings</h3>
          </div>
          <ul className="space-y-2">
            {warnings.map((warning, i) => (
              <li key={i} className="text-sm text-red-300/80 flex items-start gap-2 leading-relaxed">
                <span className="text-red-500 mt-0.5 flex-shrink-0">›</span>
                {warning}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Priority Stack */}
      <div className="glass-card p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <span className="text-brand-green">▸</span>
            <h3 className="font-semibold text-white text-sm uppercase tracking-wide">Your Priority Stack</h3>
          </div>
          <span className="text-xs text-zinc-600">{priorities.length} actions</span>
        </div>

        <ol className="space-y-3">
          {priorities.map((priority, i) => (
            <li key={i} className="flex items-start gap-3">
              <span className="flex-shrink-0 w-5 h-5 rounded-full bg-white/5 border border-white/10 text-xs text-zinc-500 flex items-center justify-center font-mono font-bold mt-0.5">
                {i + 1}
              </span>
              <span className="text-sm text-zinc-300 leading-relaxed">{priority}</span>
            </li>
          ))}
        </ol>

        <div className="mt-5 pt-4 border-t border-white/6 flex flex-wrap gap-2">
          <Link href="/command/portfolio" className="cmd-btn-secondary text-xs py-2 px-3 inline-flex items-center gap-1.5">
            <span>✦</span> Ask Zylx for Next Step
          </Link>
          <Link href="/command/debt" className="cmd-btn-ghost text-xs py-2 px-3">
            Debt Engine →
          </Link>
          <Link href="/command/wealth" className="cmd-btn-ghost text-xs py-2 px-3">
            Wealth Engine →
          </Link>
        </div>
      </div>
    </div>
  );
}
