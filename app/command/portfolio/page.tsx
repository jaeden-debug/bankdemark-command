import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/services/context';
import { getPortfolio } from '@/lib/services/businesses';
import { ServiceError } from '@/lib/services/errors';
import { formatMinor } from '@/lib/domain/money';

export const dynamic = 'force-dynamic';

export default async function PortfolioPage() {
  try {
    const auth = await requireUser();
    const { businesses, totalsByCurrency } = await getPortfolio(auth);

    if (businesses.length === 0) redirect('/onboarding');

    return (
      <div className="bdm-page max-w-4xl">
        <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <Link href="/command" className="text-[19px] font-extrabold tracking-brand">
              <span className="text-ink">Bank</span><span className="text-gold">DeMark</span>
            </Link>
            <h1 className="bdm-h1 mt-2">Your businesses</h1>
            <p className="bdm-sub mt-1">Separate books. Combined view only where it makes sense.</p>
          </div>
          <Link href="/onboarding" className="bdm-btn-secondary">+ Add a business</Link>
        </header>

        {totalsByCurrency.map((t) => (
          <section key={t.currency} className="mb-4">
            <p className="bdm-eyebrow mb-2">
              Combined · {t.count} business{t.count === 1 ? '' : 'es'} in {t.currency}
            </p>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Tile label="Cash" value={formatMinor(t.cashMinor, t.currency)} />
              <Tile label="Money in" value={formatMinor(t.revenueMinor, t.currency)} />
              <Tile label="Money out" value={formatMinor(t.expensesMinor, t.currency)} />
              <Tile label="Profit" value={formatMinor(t.profitMinor, t.currency)} />
            </div>
          </section>
        ))}

        <div className="mt-5 space-y-2.5">
          {businesses.map((row) => (
            <Link key={row.business.id} href={`/b/${row.business.id}/dashboard`} className="bdm-card-interactive flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-ink">{row.business.name}</p>
                <p className="text-xs capitalize text-muted">
                  {row.business.business_type.replace(/_/g, ' ')} · {row.business.base_currency} · {row.business.role}
                </p>
              </div>
              {row.error ? (
                <span className="bdm-badge-negative">{row.error}</span>
              ) : (
                <div className="flex gap-5 text-right">
                  <span className="block">
                    <span className="block text-[11px] font-bold uppercase tracking-wider text-muted">Cash</span>
                    <span className="bdm-num text-sm font-bold text-ink">{formatMinor(row.cashMinor, row.business.base_currency)}</span>
                  </span>
                  <span className="block">
                    <span className="block text-[11px] font-bold uppercase tracking-wider text-muted">Profit</span>
                    <span className={`bdm-num text-sm font-bold ${row.profitMinor < 0 ? 'text-negative' : 'text-ink'}`}>
                      {formatMinor(row.profitMinor, row.business.base_currency)}
                    </span>
                  </span>
                </div>
              )}
            </Link>
          ))}
        </div>

        <p className="mt-5 text-xs text-muted">
          Combined figures group by currency. BankDeMark does not convert between currencies, so
          businesses in different currencies are reported separately.
        </p>
      </div>
    );
  } catch (error) {
    if (error instanceof ServiceError && error.code === 'unauthenticated') {
      redirect('/auth/sign-in');
    }
    throw error;
  }
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="bdm-card p-4">
      <p className="bdm-eyebrow">{label}</p>
      <p className="bdm-figure-lg mt-1.5">{value}</p>
    </div>
  );
}
