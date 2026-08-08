import Link from 'next/link';
import { requireBusiness } from '@/lib/services/context';
import { listTransactions } from '@/lib/services/transactions';
import { formatMinor } from '@/lib/domain/money';
import { KIND_LABELS, type TransactionKind } from '@/lib/domain/semantics';

export const dynamic = 'force-dynamic';

export default async function TransactionsPage({
  params, searchParams,
}: { params: { businessId: string }; searchParams: { page?: string; search?: string; filter?: string } }) {
  const ctx = await requireBusiness(params.businessId, 'viewer');
  const page = Number(searchParams.page) || 1;

  const result = await listTransactions(ctx, {
    page,
    pageSize: 50,
    search: searchParams.search,
    reviewStatus: searchParams.filter === 'uncategorized' ? 'unreviewed' : undefined,
  });

  const [accountsRes, categoriesRes] = await Promise.all([
    ctx.db.from('accounts').select('id, name').eq('business_id', ctx.businessId),
    ctx.db.from('categories').select('id, name').or(`business_id.eq.${ctx.businessId},business_id.is.null`),
  ]);
  const accountName = new Map((accountsRes.data ?? []).map((a) => [a.id, a.name]));
  const categoryName = new Map((categoriesRes.data ?? []).map((c) => [c.id, c.name]));
  const currency = ctx.business.base_currency;

  return (
    <div className="bdm-page">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="bdm-eyebrow">{ctx.business.name}</p>
          <h1 className="bdm-h1">Transactions</h1>
          <p className="bdm-sub mt-1">{result.total.toLocaleString()} recorded</p>
        </div>
        <div className="flex gap-2">
          <Link href={`/b/${ctx.businessId}/receipts`} className="bdm-btn-secondary">Snap a receipt</Link>
          <Link href={`/b/${ctx.businessId}/import`} className="bdm-btn-secondary">Import a file</Link>
          <Link href={`/b/${ctx.businessId}/transactions/new`} className="bdm-btn-gold">+ Add transaction</Link>
        </div>
      </header>

      <form className="mb-4" action={`/b/${ctx.businessId}/transactions`}>
        <label className="sr-only" htmlFor="search">Search transactions</label>
        <input id="search" name="search" className="bdm-input max-w-sm" defaultValue={searchParams.search ?? ''}
               placeholder="Search description or merchant" />
      </form>

      {result.transactions.length === 0 ? (
        <div className="bdm-card p-7 text-center">
          <h2 className="bdm-h2">Nothing here yet</h2>
          <p className="bdm-sub mx-auto mt-2 max-w-sm">
            {searchParams.search
              ? 'No transactions match that search.'
              : 'Add your first transaction and the dashboard will start showing real figures.'}
          </p>
          {!searchParams.search && (
            <div className="mt-5 flex flex-col justify-center gap-2 sm:flex-row">
              <Link href={`/b/${ctx.businessId}/import`} className="bdm-btn-gold">Import a file</Link>
              <Link href={`/b/${ctx.businessId}/transactions/new`} className="bdm-btn-secondary">
                Add one manually
              </Link>
            </div>
          )}
        </div>
      ) : (
        <>
          {/* Mobile: cards. Desktop: table. Never a crushed table on a phone. */}
          <ul className="space-y-2 lg:hidden">
            {result.transactions.map((t) => (
              <li key={t.id} className="bdm-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-ink">{t.description}</p>
                    <p className="mt-0.5 text-xs text-muted">
                      {t.occurred_on} · {accountName.get(t.account_id) ?? '—'}
                    </p>
                  </div>
                  <span className={`bdm-num shrink-0 text-sm font-extrabold ${t.amount_minor < 0 ? 'text-negative' : 'text-positive'}`}>
                    {formatMinor(t.amount_minor, currency, { showMinor: true, signDisplay: 'always' })}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <span className="bdm-badge-neutral">{KIND_LABELS[t.transaction_kind as TransactionKind]}</span>
                  {t.category_id
                    ? <span className="bdm-badge-gold">{categoryName.get(t.category_id)}</span>
                    : <span className="bdm-badge-caution">Needs a category</span>}
                </div>
              </li>
            ))}
          </ul>

          <div className="hidden lg:block">
            <div className="bdm-card overflow-hidden">
              <table className="w-full text-sm">
                <caption className="sr-only">Transactions for {ctx.business.name}</caption>
                <thead>
                  <tr className="border-b border-gold-line text-left">
                    <th scope="col" className="px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-muted">Date</th>
                    <th scope="col" className="px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-muted">Description</th>
                    <th scope="col" className="px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-muted">Type</th>
                    <th scope="col" className="px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-muted">Category</th>
                    <th scope="col" className="px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-muted">Account</th>
                    <th scope="col" className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-wider text-muted">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {result.transactions.map((t) => (
                    <tr key={t.id} className="border-b border-gold-line/60 last:border-0 hover:bg-ink/[0.02]">
                      <td className="whitespace-nowrap px-4 py-3 text-muted">{t.occurred_on}</td>
                      <td className="px-4 py-3 font-semibold text-ink">
                        {t.description}
                        {t.gross_amount_minor > Math.abs(t.amount_minor) && (
                          <span className="ml-2 text-xs font-normal text-muted">
                            of {formatMinor(t.gross_amount_minor, currency)} booked
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-muted">{KIND_LABELS[t.transaction_kind as TransactionKind]}</td>
                      <td className="px-4 py-3">
                        {t.category_id
                          ? <span className="text-muted">{categoryName.get(t.category_id)}</span>
                          : <span className="bdm-badge-caution">Needs one</span>}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-muted">{accountName.get(t.account_id) ?? '—'}</td>
                      <td className={`bdm-num whitespace-nowrap px-4 py-3 text-right font-extrabold ${t.amount_minor < 0 ? 'text-negative' : 'text-positive'}`}>
                        {formatMinor(t.amount_minor, currency, { showMinor: true, signDisplay: 'always' })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {result.pageCount > 1 && (
            <nav className="mt-4 flex items-center justify-between" aria-label="Pagination">
              <span className="text-xs text-muted">Page {result.page} of {result.pageCount}</span>
              <div className="flex gap-2">
                {page > 1 && <Link className="bdm-btn-secondary bdm-btn-sm" href={`?page=${page - 1}`}>Previous</Link>}
                {page < result.pageCount && <Link className="bdm-btn-secondary bdm-btn-sm" href={`?page=${page + 1}`}>Next</Link>}
              </div>
            </nav>
          )}
        </>
      )}
    </div>
  );
}
