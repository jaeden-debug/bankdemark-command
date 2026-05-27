'use client';

import Link from 'next/link';
import { clsx } from 'clsx';
import type { Recommendation } from '@/lib/command/types';

interface RecommendationCardProps {
  rec: Recommendation;
}

const PRIORITY_STYLES = {
  urgent: { bg: 'bg-red-500/8 border-red-500/20', badge: 'bg-red-500/20 text-red-400', label: 'Urgent' },
  high:   { bg: 'bg-orange-500/8 border-orange-500/20', badge: 'bg-orange-500/20 text-orange-400', label: 'High Priority' },
  medium: { bg: 'bg-yellow-500/8 border-yellow-500/20', badge: 'bg-yellow-500/20 text-yellow-400', label: 'Medium' },
  low:    { bg: 'bg-zinc-500/8 border-zinc-500/20', badge: 'bg-zinc-500/20 text-zinc-400', label: 'Low' },
};

export default function RecommendationCard({ rec }: RecommendationCardProps) {
  const style = PRIORITY_STYLES[rec.priority];

  return (
    <div className={clsx('glass-card p-5 transition-all', style.bg)}>
      <div className="flex items-start gap-3">
        <div className="text-xl flex-shrink-0 mt-0.5">{rec.icon}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 mb-1">
            <h4 className="font-semibold text-white text-sm leading-snug">{rec.title}</h4>
            <span className={clsx('text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full flex-shrink-0', style.badge)}>
              {style.label}
            </span>
          </div>
          <p className="text-sm text-zinc-400 leading-relaxed mb-3">{rec.description}</p>
          <Link
            href={rec.action_href}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-green hover:text-brand-green-dim transition-colors"
          >
            {rec.action_label} →
          </Link>
        </div>
      </div>
    </div>
  );
}
