// ============================================================
// INVOICES — overview and list
//
// Every figure here comes from the service layer. Currencies are
// grouped, never summed together: CAD + USD is not a number.
// ============================================================

import Link from 'next/link';
import { requireBusiness } from '@/lib/services/context';
import {
  listInvoices,
  getARPosition,
  refreshOverdue,
  getAverageDaysToPayment,
} from '@/lib/services/invoices';
import { formatMinor } from '@/lib/domain/money';
import { daysOverdue, type InvoiceStatus } from '@/lib/domain/invoice';
import InvoiceStatusBadge from '@/components/bdm/InvoiceStatusBadge';

export const dynamic = 'force-dynamic';

const FILTERS = [
  { key: 'outstanding', label: 'Outstanding' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'draft', label: 'Drafts' },
  { key: 'paid', label: 'Paid' },
  { key: 'all', label: 'All' },
] as const;

export default async function InvoicesPage({
  params,
  searchParams,
}: {
  params: { businessId: string };
  searchParams: { status?: string; search?: string; page?: string };
}) {
  const ctx = await requireBusiness(params.businessId, 'viewer');

  // Overdue is derived, not remembered. Recomputed on every visit so
  // the badge can never disagree with the due date.
  await refreshOverdue(ctx);

  const status = (searchParams.status ?? 'outstanding') as 'outstanding' | 'all' | InvoiceStatus;

  const [result, ar, avgDays, counterparties] = await Promise.all([
    listInvoices(ctx, {
      status,
      search: searchParams.search,
      page: Number(searchParams.page) || 1,
      pageSize: 50,
    }),
    getARPosition(ctx),
    getAverageDaysToPayment(ctx),
    ctx.db.from('counterparties').select('id, name').eq('business_id', ctx.businessId),
  ]);

  const clientName = new Map((counterparties.data ?? []).map((c) => [c.id, c.name]));
  const base = `/b/${ctx.businessId}/invoices`;

  return (
    <div className="bdm-page">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="bdm-eyebrow">{ctx.business.name}</p>
          <h1 className="bdm-h1">Invoices</h1>
          <p className="bdm-sub mt-1">
            {result.total.toLocaleString()} {result.total === 1 ? 'invoice' : 'invoices'}
            {status !== 'all' ? ` · ${FILTERS.find((f) => f.key === status)?.label ?? status}` : ''}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href={`${base}/settings`} className="bdm-btn-secondary bdm-btn-sm">
            Settings
          </Link>
          <Link href={`${base}/new`} className="bdm-btn-gold">
            + New invoice
          </Link>
        </div>
      </header>

      {/* ── Receivables, per currency ── */}
      {ar.length > 0 && (
        <section className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Receivables">
          {ar.map((a) => (
            <div key={a.currency} className="contents">
              <div className="bdm-card p-4">
                <p className="bdm-eyebrow">Outstanding · {a.currency}</p>
                <p className="bdm-figure-lg bdm-num mt-1">
                  {formatMinor(a.invoicedMinor, a.currency, { showMinor: true })}
                </p>
                <p className="bdm-sub mt-0.5 text-xs">
                  {a.invoiceCount} {a.invoiceCount === 1 ? 'invoice' : 'invoices'}
                </p>
              </div>

              <div className="bdm-card p-4">
                <p className="bdm-eyebrow">Overdue · {a.currency}</p>
                <p
                  className={`bdm-figure-lg bdm-num mt-1 ${a.overdueMinor > 0 ? 'text-negative' : ''}`}
                >
                  {formatMinor(a.overdueMinor, a.currency, { showMinor: true })}
                </p>
                <p className="bdm-sub mt-0.5 text-xs">
                  {a.overdueCount} past due
                </p>
              </div>

              <div className="bdm-card p-4">
                <p className="bdm-eyebrow">Not yet invoiced · {a.currency}</p>
                <p className="bdm-figure-lg bdm-num mt-1">
                  {formatMinor(a.uninvoicedCommissionMinor, a.currency, { showMinor: true })}
                </p>
                {/* Kept separate from Outstanding on purpose — adding
                    them would double-count an invoiced commission. */}
                <p className="bdm-sub mt-0.5 text-xs">Commission earned, no invoice yet</p>
              </div>

              <div className="bdm-card p-4">
                <p className="bdm-eyebrow">Average time to pay</p>
                <p className="bdm-figure-lg bdm-num mt-1">
                  {avgDays === null ? '—' : `${avgDays}d`}
                </p>
                <p className="bdm-sub mt-0.5 text-xs">
                  {avgDays === null ? 'No paid invoices yet' : 'From issue to paid'}
                </p>
              </div>
            </div>
          ))}
        </section>
      )}

      {/* ── Filters + search ── */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <nav className="bdm-scroll-x flex gap-1.5" aria-label="Filter invoices">
          {FILTERS.map((f) => (
            <Link
              key={f.key}
              href={`${base}?status=${f.key}`}
              aria-current={status === f.key ? 'page' : undefined}
              className={`whitespace-nowrap rounded-pill px-3 py-1.5 text-[13px] font-semibold transition-colors ${
                status === f.key
                  ? 'bg-ink text-cream'
                  : 'border border-gold-line bg-white/70 text-muted hover:text-ink'
              }`}
            >
              {f.label}
            </Link>
          ))}
        </nav>

        <form action={base} className="sm:w-64">
          <input type="hidden" name="status" value={status} />
          <label className="sr-only" htmlFor="invoice-search">
            Search invoices
          </label>
          <input
            id="invoice-search"
            name="search"
            className="bdm-input"
            defaultValue={searchParams.search ?? ''}
            placeholder="Invoice number or note"
          />
        </form>
      </div>

      {/* ── Results ── */}
      {result.invoices.length === 0 ? (
        <div className="bdm-card p-7 text-center">
          <h2 className="bdm-h2">
            {searchParams.search ? 'Nothing matches that search' : 'No invoices here yet'}
          </h2>
          <p className="bdm-sub mx-auto mt-2 max-w-sm">
            {searchParams.search
              ? 'Try a different invoice number or clear the search.'
              : status === 'outstanding'
                ? 'Nothing is owed to you right now. Create an invoice and it will appear here until it is paid.'
                : 'Create your first invoice to get started.'}
          </p>
          {!searchParams.search && (
            <Link href={`${base}/new`} className="bdm-btn-gold mt-4">
              Create an invoice
            </Link>
          )}
        </div>
      ) : (
        <>
          {/* Mobile: cards. Desktop: table. Never a crushed table on a phone. */}
          <ul className="space-y-2 lg:hidden">
            {result.invoices.map((inv) => (
              <li key={inv.id}>
                <Link href={`${base}/${inv.id}`} className="bdm-card-interactive block p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-ink">
                        {inv.number ?? 'Draft'}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-muted">
                        {inv.counterparty_id
                          ? clientName.get(inv.counterparty_id) ?? 'Unknown client'
                          : 'No client yet'}
                      </p>
                    </div>
                    <span className="bdm-num shrink-0 text-sm font-extrabold text-ink">
                      {formatMinor(inv.total_minor, inv.currency, { showMinor: true })}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <InvoiceStatusBadge
                      status={inv.status}
                      daysOverdue={daysOverdue(inv.due_date)}
                    />
                    <span className="text-xs text-muted">Due {inv.due_date}</span>
                    {inv.balance_minor > 0 && inv.balance_minor !== inv.total_minor && (
                      <span className="text-xs font-semibold text-caution">
                        {formatMinor(inv.balance_minor, inv.currency, { showMinor: true })} left
                      </span>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>

          <div className="hidden lg:block">
            <div className="bdm-card overflow-hidden">
              <table className="w-full text-sm">
                <caption className="sr-only">Invoices for {ctx.business.name}</caption>
                <thead>
                  <tr className="border-b border-gold-line text-left">
                    <th scope="col" className="px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-muted">Invoice</th>
                    <th scope="col" className="px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-muted">Client</th>
                    <th scope="col" className="px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-muted">Issued</th>
                    <th scope="col" className="px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-muted">Due</th>
                    <th scope="col" className="px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-muted">Status</th>
                    <th scope="col" className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-wider text-muted">Total</th>
                    <th scope="col" className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-wider text-muted">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {result.invoices.map((inv) => (
                    <tr key={inv.id} className="border-b border-gold-line/60 last:border-0 hover:bg-ink/[0.02]">
                      <td className="whitespace-nowrap px-4 py-3">
                        <Link href={`${base}/${inv.id}`} className="font-semibold text-ink hover:text-gold-dark">
                          {inv.number ?? 'Draft'}
                        </Link>
                        {inv.is_credit_note && (
                          <span className="ml-2 bdm-badge-neutral">Credit</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted">
                        {inv.counterparty_id ? clientName.get(inv.counterparty_id) ?? '—' : '—'}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-muted">
                        {inv.issued_at ? inv.issue_date : '—'}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-muted">{inv.due_date}</td>
                      <td className="px-4 py-3">
                        <InvoiceStatusBadge status={inv.status} daysOverdue={daysOverdue(inv.due_date)} />
                      </td>
                      <td className="bdm-num whitespace-nowrap px-4 py-3 text-right font-semibold text-ink">
                        {formatMinor(inv.total_minor, inv.currency, { showMinor: true })}
                      </td>
                      <td className="bdm-num whitespace-nowrap px-4 py-3 text-right text-muted">
                        {inv.balance_minor > 0
                          ? formatMinor(inv.balance_minor, inv.currency, { showMinor: true })
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {result.total > result.pageSize && (
            <nav className="mt-4 flex items-center justify-between" aria-label="Pagination">
              <span className="bdm-sub text-xs">
                Page {result.page} of {Math.ceil(result.total / result.pageSize)}
              </span>
              <div className="flex gap-2">
                {result.page > 1 && (
                  <Link href={`${base}?status=${status}&page=${result.page - 1}`} className="bdm-btn-secondary bdm-btn-sm">
                    Previous
                  </Link>
                )}
                {result.page * result.pageSize < result.total && (
                  <Link href={`${base}?status=${status}&page=${result.page + 1}`} className="bdm-btn-secondary bdm-btn-sm">
                    Next
                  </Link>
                )}
              </div>
            </nav>
          )}
        </>
      )}
    </div>
  );
}
