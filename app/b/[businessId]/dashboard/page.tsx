import Link from 'next/link';
import { requireBusiness } from '@/lib/services/context';
import { getBusinessSnapshot, resolvePeriod, type PeriodPreset } from '@/lib/services/finance';
import { formatMinor, percentChange, formatPercent } from '@/lib/domain/money';

export const dynamic = 'force-dynamic';

const PERIODS: Array<{ id: PeriodPreset; label: string }> = [
  { id: 'this_month', label: 'This month' },
  { id: 'last_month', label: 'Last month' },
  { id: 'this_quarter', label: 'This quarter' },
  { id: 'this_year', label: 'This year' },
];

export default async function DashboardPage({
  params,
  searchParams,
}: {
  params: { businessId: string };
  searchParams: { period?: string };
}) {
  const ctx = await requireBusiness(params.businessId, 'viewer');
  const preset = (PERIODS.find((p) => p.id === searchParams.period)?.id ?? 'this_month') as PeriodPreset;
  const period = resolvePeriod(preset);
  const { value: snap, provenance } = await getBusinessSnapshot(ctx, period);

  const currency = ctx.business.base_currency;
  const fmt = (minor: number) => formatMinor(minor, currency);
  const base = `/b/${ctx.businessId}`;

  // Zero-data state. No sample revenue, ever.
  if (snap.transactionCount === 0) {
    return <EmptyState businessName={ctx.business.name} base={base} />;
  }

  const t = snap.totals;
  const prev = snap.previousTotals;
  const showsVolume = ctx.business.earns_commissions && t.grossVolumeMinor !== t.recognizedRevenueMinor;
  const attentionItems = buildAttention(snap, base);

  return (
    <div className="bdm-page space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="bdm-eyebrow">{ctx.business.name}</p>
          <h1 className="bdm-h1">How the business is doing</h1>
        </div>
        <nav className="bdm-scroll-x" aria-label="Period">
          <div className="flex gap-1.5 rounded-pill border border-gold-line bg-white/60 p-1">
            {PERIODS.map((p) => (
              <Link
                key={p.id}
                href={`${base}/dashboard?period=${p.id}`}
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

      {provenance.staleAccounts.length > 0 && (
        <div className="bdm-panel flex items-start gap-3 p-4">
          <span aria-hidden className="text-caution">⚠</span>
          <p className="text-sm text-ink">
            <strong className="font-bold">Some balances may be out of date.</strong>{' '}
            {provenance.staleAccounts.join(', ')} {provenance.staleAccounts.length === 1 ? 'has' : 'have'} not
            synced recently, so the figures below may not include everything.{' '}
            <Link href={`${base}/settings`} className="font-semibold text-gold-dark underline">
              Check connections
            </Link>
          </p>
        </div>
      )}

      {/* ── Headline figures ─────────────────────────────── */}
      <section aria-label="Key figures" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Figure label="Cash on hand" value={fmt(snap.cashMinor)} hint={`${snap.accounts.length} accounts`} />
        <Figure
          label="Money in"
          value={fmt(t.recognizedRevenueMinor)}
          delta={percentChange(t.recognizedRevenueMinor, prev.recognizedRevenueMinor)}
          hint={showsVolume ? `${fmt(t.grossVolumeMinor)} booked` : undefined}
        />
        <Figure
          label="Money out"
          value={fmt(t.expensesMinor)}
          delta={percentChange(t.expensesMinor, prev.expensesMinor)}
          deltaGoodWhen="down"
        />
        <Figure
          label="Profit"
          value={fmt(t.profitMinor)}
          delta={percentChange(t.profitMinor, prev.profitMinor)}
          emphasis={t.profitMinor < 0 ? 'negative' : 'positive'}
          hint={
            t.recognizedRevenueMinor > 0
              ? `${((t.profitMinor / t.recognizedRevenueMinor) * 100).toFixed(0)}% margin`
              : undefined
          }
        />
      </section>

      <section aria-label="Position" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Figure small label="Owed to you" value={fmt(snap.receivablesMinor)} />
        <Figure small label="What you owe" value={fmt(snap.liabilitiesMinor)} />
        <Figure small label="Business net worth" value={fmt(snap.netWorth.netWorthMinor)} />
        <Figure small label="You've put in" value={fmt(snap.equity.contributionsMinor)} />
      </section>

      {/* ── Attention queue before charts ────────────────── */}
      {attentionItems.length > 0 && (
        <section className="bdm-card p-5" aria-label="Needs your attention">
          <h2 className="bdm-h2 mb-3">Needs your attention</h2>
          <ul className="space-y-2">
            {attentionItems.map((item) => (
              <li key={item.label}>
                <Link
                  href={item.href}
                  className="flex items-center justify-between gap-3 rounded-control px-3 py-2.5 transition-colors hover:bg-ink/[0.04]"
                >
                  <span className="text-sm text-ink">
                    <strong className="font-bold">{item.count}</strong> {item.label}
                  </span>
                  <span aria-hidden className="text-muted">→</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {snap.brands.length > 0 && (
        <section className="bdm-card p-5" aria-label="How each brand did">
          <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="bdm-h2">How each brand did</h2>
            <span className="text-xs text-muted">One company, one filing — split for your view only</span>
          </div>
          <BrandTable
            performance={snap.brandPerformance}
            brands={snap.brands}
            currency={currency}
          />
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-5">
        <section className="bdm-card p-5 lg:col-span-3" aria-label="Money in and out by month">
          <h2 className="bdm-h2 mb-4">Money in and out</h2>
          <MonthlyBars series={snap.monthly.slice(-6)} currency={currency} />
        </section>

        <section className="bdm-card p-5 lg:col-span-2" aria-label="Where money went">
          <h2 className="bdm-h2 mb-4">Where money went</h2>
          {snap.expenseBreakdown.length === 0 ? (
            <p className="bdm-sub">No expenses recorded for {period.label.toLowerCase()}.</p>
          ) : (
            <ul className="space-y-2.5">
              {snap.expenseBreakdown.slice(0, 6).map((row) => (
                <li key={row.key}>
                  <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
                    <span className="truncate text-ink">{row.key === '__uncategorized__' ? 'Uncategorised' : row.key}</span>
                    <span className="bdm-num shrink-0 font-bold text-ink">{fmt(row.amountMinor)}</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-pill bg-ink/[0.06]">
                    <div
                      className="h-full rounded-pill bg-gold-sweep"
                      style={{ width: `${Math.max(2, row.share * 100).toFixed(1)}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* ── One-click actions ────────────────────────────── */}
      <section className="bdm-card p-5" aria-label="Quick actions">
        <h2 className="bdm-h2 mb-3">What do you need?</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <Action href={`${base}/transactions/new?kind=expense`} label="Add expense" />
          <Action href={`${base}/transactions/new?kind=income`} label="Log money in" />
          <Action href={`${base}/transactions/new`} label="Record a transfer" />
          <Action href={`${base}/reports/profit-and-loss`} label="Generate P&L" />
          <Action href={`${base}/zylx`} label="Ask Zylx" gold />
        </div>
      </section>

      <footer className="pb-4 text-xs text-muted">
        Figures cover {period.label.toLowerCase()} ({period.from} to {period.to}) in {currency}, from{' '}
        {snap.transactionCount.toLocaleString()} recorded transactions
        {provenance.dataThrough ? `, up to ${provenance.dataThrough}` : ''}. Calculated by BankDeMark from
        your own records.
      </footer>
    </div>
  );
}

// ── Pieces ────────────────────────────────────────────────

function Figure({
  label,
  value,
  hint,
  delta,
  deltaGoodWhen = 'up',
  emphasis,
  small,
}: {
  label: string;
  value: string;
  hint?: string;
  delta?: number | null;
  deltaGoodWhen?: 'up' | 'down';
  emphasis?: 'positive' | 'negative';
  small?: boolean;
}) {
  const good = delta === null || delta === undefined ? null : deltaGoodWhen === 'up' ? delta >= 0 : delta <= 0;

  return (
    <div className="bdm-card p-4">
      <p className="bdm-eyebrow">{label}</p>
      <p
        className={`mt-1.5 ${small ? 'bdm-figure-lg' : 'bdm-figure-xl'} ${
          emphasis === 'negative' ? 'text-negative' : ''
        }`}
      >
        {value}
      </p>
      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
        {delta !== null && delta !== undefined && (
          <span className={`font-bold ${good ? 'bdm-delta-up' : 'bdm-delta-down'}`}>
            {delta >= 0 ? '↑' : '↓'} {formatPercent(Math.abs(delta), 0)}
          </span>
        )}
        {hint && <span className="text-muted">{hint}</span>}
      </div>
    </div>
  );
}

function Action({ href, label, gold }: { href: string; label: string; gold?: boolean }) {
  return (
    <Link href={href} className={gold ? 'bdm-btn-gold w-full' : 'bdm-btn-secondary w-full'}>
      {label}
    </Link>
  );
}

function MonthlyBars({
  series,
  currency,
}: {
  series: Array<{ month: string; recognizedRevenueMinor: number; expensesMinor: number }>;
  currency: string;
}) {
  if (series.length === 0) return <p className="bdm-sub">Not enough history yet.</p>;

  const max = Math.max(
    1,
    ...series.map((s) => Math.max(s.recognizedRevenueMinor, s.expensesMinor))
  );

  return (
    <div>
      <div className="flex items-end gap-3 sm:gap-5" style={{ height: 168 }} role="img"
           aria-label={series
             .map((s) => `${s.month}: in ${formatMinor(s.recognizedRevenueMinor, currency)}, out ${formatMinor(s.expensesMinor, currency)}`)
             .join('. ')}>
        {series.map((point) => (
          <div key={point.month} className="flex h-full flex-1 flex-col items-center gap-1.5">
            <div className="flex min-h-0 w-full flex-1 items-end justify-center gap-1">
              <div
                className="w-1/2 max-w-[26px] rounded-t-md bg-ink"
                style={{ height: `${Math.max(2, (point.recognizedRevenueMinor / max) * 100)}%` }}
                title={`In: ${formatMinor(point.recognizedRevenueMinor, currency)}`}
              />
              <div
                className="w-1/2 max-w-[26px] rounded-t-md bg-gold/60"
                style={{ height: `${Math.max(2, (point.expensesMinor / max) * 100)}%` }}
                title={`Out: ${formatMinor(point.expensesMinor, currency)}`}
              />
            </div>
            <span className="text-[11px] font-semibold text-muted">{point.month.slice(5)}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 flex gap-4 text-xs text-muted">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-ink" />Money in</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-gold/60" />Money out</span>
      </div>
    </div>
  );
}

function BrandTable({
  performance,
  brands,
  currency,
}: {
  performance: Awaited<ReturnType<typeof getBusinessSnapshot>>['value']['brandPerformance'];
  brands: Array<{ id: string; name: string }>;
  currency: string;
}) {
  const nameById = new Map(brands.map((b) => [b.id, b.name]));
  const fmt = (m: number) => formatMinor(m, currency);
  const rows = performance.brands;

  if (rows.length === 0) {
    return (
      <p className="bdm-sub mt-2">
        Nothing is tagged to a brand yet. Pick a brand when you record a transaction and this fills in.
      </p>
    );
  }

  return (
    <div className="bdm-scroll-x mt-3">
      <table className="w-full min-w-[520px] text-sm">
        <caption className="sr-only">Revenue, costs and profit for each brand</caption>
        <thead>
          <tr className="border-b border-gold-line text-left">
            <th scope="col" className="pb-2 text-[11px] font-bold uppercase tracking-wider text-muted">Brand</th>
            <th scope="col" className="pb-2 text-right text-[11px] font-bold uppercase tracking-wider text-muted">Money in</th>
            <th scope="col" className="pb-2 text-right text-[11px] font-bold uppercase tracking-wider text-muted">Money out</th>
            <th scope="col" className="pb-2 text-right text-[11px] font-bold uppercase tracking-wider text-muted">Profit</th>
            <th scope="col" className="pb-2 text-right text-[11px] font-bold uppercase tracking-wider text-muted">Margin</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.brandId} className="border-b border-gold-line/60 last:border-0">
              <td className="py-2.5 font-semibold text-ink">{nameById.get(r.brandId) ?? 'Unknown brand'}</td>
              <td className="bdm-num py-2.5 text-right text-ink">{fmt(r.revenueMinor)}</td>
              <td className="bdm-num py-2.5 text-right text-muted">{fmt(r.expensesMinor)}</td>
              <td className={`bdm-num py-2.5 text-right font-bold ${r.profitMinor < 0 ? 'text-negative' : 'text-ink'}`}>
                {fmt(r.profitMinor)}
              </td>
              <td className="bdm-num py-2.5 text-right text-muted">
                {r.margin === null ? '—' : `${(r.margin * 100).toFixed(0)}%`}
              </td>
            </tr>
          ))}
          {(performance.unassignedRevenueMinor !== 0 || performance.unassignedExpensesMinor !== 0) && (
            <tr className="border-t border-gold-line">
              <td className="py-2.5 text-muted">
                Shared / company-wide
                <span className="mt-0.5 block text-xs">Not split across brands</span>
              </td>
              <td className="bdm-num py-2.5 text-right text-muted">{fmt(performance.unassignedRevenueMinor)}</td>
              <td className="bdm-num py-2.5 text-right text-muted">{fmt(performance.unassignedExpensesMinor)}</td>
              <td className="bdm-num py-2.5 text-right text-muted">
                {fmt(performance.unassignedRevenueMinor - performance.unassignedExpensesMinor)}
              </td>
              <td className="py-2.5 text-right text-muted">—</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function buildAttention(
  snap: Awaited<ReturnType<typeof getBusinessSnapshot>>['value'],
  base: string
): Array<{ count: number; label: string; href: string }> {
  const items: Array<{ count: number; label: string; href: string }> = [];
  const a = snap.attention;

  if (a.uncategorized > 0)
    items.push({ count: a.uncategorized, label: 'transactions need a category', href: `${base}/transactions?filter=uncategorized` });
  if (a.unmatchedTransfers > 0)
    items.push({ count: a.unmatchedTransfers, label: 'transfers only have one side recorded', href: `${base}/transactions?filter=transfers` });
  if (snap.outstandingCommissionMinor > 0)
    items.push({ count: 1, label: 'commission payments are still outstanding', href: `${base}/money-in` });
  if (a.missingReceipts > 0)
    items.push({ count: a.missingReceipts, label: 'expenses are missing a receipt', href: `${base}/transactions` });

  return items;
}

function EmptyState({ businessName, base }: { businessName: string; base: string }) {
  return (
    <div className="bdm-page">
      <div className="bdm-card mx-auto max-w-xl p-7 text-center">
        <p className="bdm-eyebrow">{businessName}</p>
        <h1 className="bdm-h1 mt-1">Let&apos;s get your numbers in</h1>
        <p className="bdm-sub mx-auto mt-3 max-w-md">
          There is nothing recorded for this business yet, so there is nothing to show. Once money
          movements are in, BankDeMark works out what you actually earned, what you spent, what you
          are owed, and what to set aside for tax.
        </p>

        <div className="mt-6 space-y-2.5 text-left">
          <StartOption
            href={`${base}/import`}
            title="Import a file from your bank"
            body="Export a CSV and drop it in. We work out the columns and skip anything you already have."
          />
          <StartOption
            href={`${base}/transactions/new`}
            title="Record one by hand"
            body="An expense or a payment you remember. About twenty seconds, and the dashboard fills in immediately."
          />
          <StartOption
            href={`${base}/zylx`}
            title="Ask Zylx what to do first"
            body="Not sure how to classify something? Ask before you record it."
          />
        </div>

        <p className="mt-5 text-xs text-muted">
          BankDeMark never shows made-up figures. Everything you see comes from what you put in.
        </p>
      </div>
    </div>
  );
}

function StartOption({ href, title, body }: { href: string; title: string; body: string }) {
  return (
    <Link href={href} className="bdm-card-interactive flex items-start gap-3 p-4">
      <span aria-hidden className="mt-0.5 text-gold">→</span>
      <span>
        <span className="block text-sm font-bold text-ink">{title}</span>
        <span className="mt-0.5 block text-[13px] leading-relaxed text-muted">{body}</span>
      </span>
    </Link>
  );
}
