'use client';

import { clsx } from 'clsx';

interface MetricCardProps {
  label: string;
  value: string;
  subtext?: string;
  status?: 'good' | 'warn' | 'danger' | 'neutral' | 'info';
  icon?: string;
  trend?: 'up' | 'down' | 'flat';
  className?: string;
  large?: boolean;
}

const statusColors = {
  good: 'text-emerald-400',
  warn: 'text-yellow-400',
  danger: 'text-red-400',
  neutral: 'text-zinc-400',
  info: 'text-blue-400',
};

const statusBg = {
  good: 'bg-emerald-400/10 border-emerald-400/20',
  warn: 'bg-yellow-400/10 border-yellow-400/20',
  danger: 'bg-red-400/10 border-red-400/20',
  neutral: 'bg-white/5 border-white/8',
  info: 'bg-blue-400/10 border-blue-400/20',
};

export default function MetricCard({
  label,
  value,
  subtext,
  status = 'neutral',
  icon,
  className,
  large = false,
}: MetricCardProps) {
  return (
    <div
      className={clsx(
        'glass-card p-4 flex flex-col gap-1 animate-in',
        statusBg[status],
        className
      )}
    >
      <div className="flex items-center gap-2 mb-1">
        {icon && <span className="text-base leading-none">{icon}</span>}
        <span className="cmd-label text-[11px]">{label}</span>
      </div>
      <div
        className={clsx(
          'font-bold tracking-tight',
          large ? 'text-2xl' : 'text-xl',
          statusColors[status]
        )}
      >
        {value}
      </div>
      {subtext && (
        <p className="text-xs text-zinc-500 mt-0.5 leading-snug">{subtext}</p>
      )}
    </div>
  );
}
