import Link from 'next/link';
import { requireBusiness } from '@/lib/services/context';
import { generateProfitAndLoss, type ReportLine } from '@/lib/services/reports';
import { resolvePeriod, type PeriodPreset } from '@/lib/services/finance';
import { formatMinor, formatPercent, percentChange } from '@/lib/domain/money';

export const dynamic = 'force-dynamic';

const PERIODS: Array<{ id: PeriodPreset; label: string }> = [
  { id: 'this_month', label: 'This month' },
  { id: 'last_month', label: 'Last month' },
  { id: 'this_quarter', label: 'This quarter' },
  { id: 'this_year', label: 'This year' },
  { id: 'last_year', label: 'Last year' },
];

export default async function ProfitAndLossPage({
  params,
  searchParams,
}: {
  params: { businessId: string };
  searchParams: { period?: string };
}) {
  const ctx = await requireBusiness(params.businessId, 'viewer');
  const preset = (PERIODS.find((p) => p.id === searchParams.period)?.id ?? 'this_month') as PeriodPreset;
  const period = resolvePeriod(preset);
  const report = await generateProfitAndLoss(ctx, period);

  const c = report.currency;
  const fmt = (m: number) => formatMinor(m, c);
  const base = `/b/${ctx.businessId}`;
  const profitChange = percentChange(report.profitMinor, report.previousProfitMinor ?? 0);
  const isEmpty = report.transactionCount === 0;

  return (
    <div className="bdm-page max-w-3xl space-y-5">
      <header className="bdm-no-print flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href={`${base}/reports`} className="text-[13px] font-semibold text-muted hover:text-ink">
            ← Reports
          </Link>
          <h1 className="bdm-h1 mt-2">Profit &amp; Loss</h1>
        </div>
        <nav className="bdm-scroll-x" aria-label="Period">
          <div className="flex gap-1.5 rounded-pill border border-gold-line bg-white/60 p-1">
            {PERIODS.map((p) => (
              <Link
                key={p.id}
                href={`?period=${p.id}`}
                aria-current={p.id === preset ? 'true' : undefined}
                className={`whitespace-nowrap rounded-pill px-3 py-1.5 text-[13px] font-semibold transition-colors ${
                  p.id === preset ? 'bg-ink text-cream' : 'text-muted hover:text-ink'
                }`}
              >
                {p.label}
              </Link>
            ))}
          </div>
        </nav>
      </header>

      {isEmpty ? (
        <div className="bdm-card p-7 text-center">
          <h2 className="bdm-h2">Nothing recorded for {period.label.toLowerCase()}</h2>
          <p className="bdm-sub mx-auto mt-2 max-w-sm">
            Add some transactions and this fills in on its own.
          </p>
          <div className="mt-5 flex flex-col justify-center gap-2 sm:flex-row">
            <Link href={`${base}/import`} className="bdm-btn-gold">Import a file</Link>
            <Link href={`${base}/transactions/new`} className="bdm-btn-secondary">Add one manually</Link>
          </div>
        </div>
      ) : (
        <>
          {/* The answer, before the detail. */}
          <section className="bdm-card p-6" aria-label="Result">
            <p className="bdm-eyebrow">{report.businessName} · {period.label}</p>
            <p className={`bdm-figure-xl mt-2 ${report.profitMinor < 0 ? 'text-negative' : ''}`}>
              {fmt(report.profitMinor)}
            </p>
            <p className="mt-1.5 text-[15px] text-muted">
              {report.profitMinor >= 0 ? 'profit' : 'loss'}
              {report.marginPercent !== null && ` · ${(report.marginPercent * 100).toFixed(0)}% margin`}
              {profitChange !== null && report.previousProfitMinor !== null && (
                <> · <span className={profitChange >= 0 ? 'text-positive' : 'text-negative'}>
                  {profitChange >= 0 ? '↑' : '↓'} {formatPercent(Math.abs(profitChange), 0)}
                </span> vs last period</>
              )}
            </p>

            <div className="mt-5 grid grid-cols-2 gap-4 border-t border-gold-line pt-4">
              <div>
                <p className="bdm-eyebrow">Money in</p>
                <p className="bdm-figure-lg mt-1">{fmt(report.totalRevenueMinor)}</p>
              </div>
              <div>
                <p className="bdm-eyebrow">Money out</p>
                <p className="bdm-figure-lg mt-1">{fmt(report.totalExpensesMinor)}</p>
              </div>
            </div>

            {report.showsVolume && (
              <p className="mt-4 rounded-control border border-gold-line bg-gold-tint px-3.5 py-2.5 text-[13px] leading-relaxed text-ink">
                You handled <strong className="font-bold">{fmt(report.grossVolumeMinor)}</strong> in sales,
                and earned <strong className="font-bold">{fmt(report.totalRevenueMinor)}</strong> of it.
                Only what you earned counts as revenue.
              </p>
            )}
          </section>

          {report.uncategorisedCount > 0 && (
            <Link
              href={`${base}/transactions?filter=uncategorized`}
              className="bdm-no-print bdm-panel flex items-center justify-between gap-3 p-4 transition-colors hover:bg-white/70"
            >
              <span className="text-sm text-ink">
                <strong className="font-bold">{report.uncategorisedCount}</strong>{' '}
                transaction{report.uncategorisedCount === 1 ? '' : 's'} in this period still need a
                category, so the breakdown below is incomplete.
              </span>
              <span aria-hidden className="shrink-0 text-muted">→</span>
            </Link>
          )}

          <Section title="Money in" lines={report.revenueLines} total={report.totalRevenueMinor} currency={c} />
          <Section title="Money out" lines={report.expenseLines} total={report.totalExpensesMinor} currency={c} />

          {report.excluded.length > 0 && (
            <section className="bdm-card p-5">
              <h2 className="bdm-h2">Not counted in profit</h2>
              <p className="bdm-sub mt-1">
                These moved money but aren&apos;t income or costs — which is why profit won&apos;t match
                your bank balance.
              </p>
              <ul className="mt-3 space-y-2.5">
                {report.excluded.map((e) => (
                  <li key={e.label} className="flex items-baseline justify-between gap-4">
                    <span>
                      <span className="block text-sm font-semibold text-ink">{e.label}</span>
                      <span className="block text-xs text-muted">{e.reason}</span>
                    </span>
                    <span className="bdm-num shrink-0 text-sm font-bold text-muted">
                      {fmt(e.amountMinor)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="bdm-no-print flex flex-col gap-2 sm:flex-row">
            <a
              href={`/api/reports?businessId=${ctx.businessId}&period=${preset}&format=csv`}
              className="bdm-btn-secondary"
            >
              Download as CSV
            </a>
            <Link href={`${base}/zylx`} className="bdm-btn-gold">Ask Zylx about this</Link>
          </div>

          <footer className="pb-4 text-xs leading-relaxed text-muted">
            {period.from} to {period.to} · {report.transactionCount.toLocaleString()} transactions
            {report.dataThrough && ` · newest ${report.dataThrough}`} · {c}. Calculated by BankDeMark
            from your own records. This is not a filed or audited statement.
          </footer>
        </>
      )}
    </div>
  );
}

function Section({
  title,
  lines,
  total,
  currency,
}: {
  title: string;
  lines: ReportLine[];
  total: number;
  currency: string;
}) {
  if (lines.length === 0) {
    return (
      <section className="bdm-card p-5">
        <h2 className="bdm-h2">{title}</h2>
        <p className="bdm-sub mt-1.5">Nothing recorded.</p>
      </section>
    );
  }

  return (
    <section className="bdm-card p-5">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="bdm-h2">{title}</h2>
        <span className="bdm-num text-[17px] font-extrabold text-ink">
          {formatMinor(total, currency)}
        </span>
      </div>

      <ul className="mt-4 space-y-3">
        {lines.map((line) => (
          <li key={line.label}>
            <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
              <span className="truncate text-ink">{line.label}</span>
              <span className="flex shrink-0 items-baseline gap-2">
                {line.change !== null && line.change !== undefined && (
                  <span className={`text-[11px] font-bold ${line.change >= 0 ? 'text-positive' : 'text-negative'}`}>
                    {line.change >= 0 ? '↑' : '↓'}{formatPercent(Math.abs(line.change), 0)}
                  </span>
                )}
                <span className="bdm-num font-bold text-ink">
                  {formatMinor(line.amountMinor, currency)}
                </span>
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-pill bg-ink/[0.06]">
              <div
                className="h-full rounded-pill bg-gold-sweep"
                style={{ width: `${Math.max(2, line.share * 100).toFixed(1)}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
