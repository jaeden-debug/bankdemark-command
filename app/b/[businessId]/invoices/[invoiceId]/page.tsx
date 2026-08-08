// ============================================================
// INVOICE DETAIL
//
// An issued invoice renders from its FROZEN snapshot, not from current
// business or client settings. Changing your address next year must
// not change what this document says.
// ============================================================

import Link from 'next/link';
import { requireBusiness } from '@/lib/services/context';
import { getInvoice } from '@/lib/services/invoices';
import { getAccess, can } from '@/lib/services/access';
import { formatMinor } from '@/lib/domain/money';
import { daysOverdue } from '@/lib/domain/invoice';
import { appOriginOrNull, invoiceShareUrl } from '@/lib/config/app-url';
import InvoiceStatusBadge from '@/components/bdm/InvoiceStatusBadge';
import InvoiceActions from '@/components/bdm/InvoiceActions';

export const dynamic = 'force-dynamic';

// "Sent" means the provider accepted it. "Delivered" means it arrived.
// These are never conflated.
const DELIVERY_LABEL: Record<string, string> = {
  queued: 'Queued',
  sent: 'Sent',
  delivered: 'Delivered',
  bounced: 'Bounced',
  failed: 'Failed',
};

const DELIVERY_BADGE: Record<string, string> = {
  queued: 'bdm-badge-neutral',
  sent: 'bdm-badge-gold',
  delivered: 'bdm-badge-positive',
  bounced: 'bdm-badge-negative',
  failed: 'bdm-badge-negative',
};

const EVENT_LABELS: Record<string, string> = {
  created: 'Created',
  edited: 'Edited',
  issued: 'Issued',
  sent: 'Emailed',
  send_failed: 'Email failed',
  viewed: 'Viewed by client',
  payment_recorded: 'Payment recorded',
  payment_removed: 'Payment removed',
  voided: 'Voided',
  email_delivered: 'Email delivered',
  email_bounced: 'Email bounced',
  email_failed: 'Email failed',
  revised: 'Revised',
  credit_note_created: 'Credit note created',
  share_revoked: 'Client link revoked',
  share_regenerated: 'Client link regenerated',
};

export default async function InvoiceDetailPage({
  params,
}: {
  params: { businessId: string; invoiceId: string };
}) {
  const ctx = await requireBusiness(params.businessId, 'viewer');
  const { invoice, lines, payments, events, counterparty, booking } = await getInvoice(
    ctx,
    params.invoiceId
  );

  const access = await getAccess(ctx);

  // Provider truth about the last send attempt.
  const { data: deliveries } = await ctx.db
    .from('invoice_deliveries')
    .select('id, to_email, state, error, bounce_type, created_at, delivered_at, bounced_at, failed_at')
    .eq('invoice_id', params.invoiceId)
    .order('created_at', { ascending: false })
    .limit(5);

  const currency = invoice.currency;
  const snapshot = invoice.issued_business_snapshot;
  const clientSnapshot = invoice.issued_client_snapshot;
  const base = `/b/${ctx.businessId}/invoices`;

  // Non-throwing: this page must still render if the origin is
  // misconfigured, and the copy-link button simply will not appear.
  const originOk = appOriginOrNull() !== null;
  const shareUrl =
    invoice.share_token && !invoice.share_revoked_at && originOk
      ? invoiceShareUrl(invoice.share_token)
      : null;

  const clientEmail = counterparty?.email ?? null;
  const emailConfigured = Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL);
  const sendAllowed = can(access, 'emailSending');

  const emailLockedReason = !clientEmail
    ? 'This client has no email address on file, so the invoice cannot be emailed.'
    : !emailConfigured
      ? 'Email sending is not configured on this deployment yet (RESEND_API_KEY is not set).'
      : !sendAllowed
        ? 'Emailing invoices is not included in your plan.'
        : null;

  const customEntries = Object.entries(invoice.custom_fields ?? {});

  return (
    <div className="bdm-page max-w-4xl">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Link href={base} className="bdm-btn-ghost bdm-btn-sm" aria-label="Back to invoices">
            ←
          </Link>
          <div>
            <p className="bdm-eyebrow">{ctx.business.name}</p>
            <h1 className="bdm-h1">
              {invoice.number ?? 'Draft invoice'}
              {invoice.is_credit_note && <span className="ml-2 bdm-badge-neutral">Credit note</span>}
            </h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <InvoiceStatusBadge status={invoice.status} daysOverdue={daysOverdue(invoice.due_date)} />
              <span className="text-xs text-muted">
                {invoice.issued_at ? `Issued ${invoice.issue_date}` : 'Not issued yet'} · Due{' '}
                {invoice.due_date}
              </span>
            </div>
          </div>
        </div>

        <div className="text-right">
          <p className="bdm-eyebrow">Total</p>
          <p className="bdm-figure-xl bdm-num">
            {formatMinor(invoice.total_minor, currency, { showMinor: true })}
          </p>
          {invoice.balance_minor > 0 && invoice.balance_minor !== invoice.total_minor && (
            <p className="mt-0.5 text-sm font-semibold text-caution">
              {formatMinor(invoice.balance_minor, currency, { showMinor: true })} outstanding
            </p>
          )}
        </div>
      </header>

      {invoice.status === 'void' && (
        <div className="mb-4 rounded-panel border border-gold-line bg-ink/[0.04] p-4">
          <p className="text-sm font-semibold text-ink">This invoice was voided</p>
          <p className="bdm-sub mt-0.5">{invoice.void_reason}</p>
        </div>
      )}

      <div className="mb-5">
        <InvoiceActions
          businessId={ctx.businessId}
          invoiceId={invoice.id}
          status={invoice.status}
          balanceMinor={invoice.balance_minor}
          paidMinor={invoice.paid_minor}
          currency={currency}
          number={invoice.number}
          shareUrl={shareUrl}
          clientEmail={clientEmail}
          canEmail={emailLockedReason === null}
          emailLockedReason={emailLockedReason}
        />
      </div>

      {/* ── The document ── */}
      <section className="bdm-card mb-4 p-5 sm:p-7">
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <p className="bdm-eyebrow mb-1.5">From</p>
            <p className="text-sm font-bold text-ink">
              {snapshot?.name ?? ctx.business.name}
            </p>
            {snapshot?.address_line1 && <p className="text-sm text-muted">{snapshot.address_line1}</p>}
            {snapshot?.address_line2 && <p className="text-sm text-muted">{snapshot.address_line2}</p>}
            {(snapshot?.city || snapshot?.region || snapshot?.postal_code) && (
              <p className="text-sm text-muted">
                {[snapshot?.city, snapshot?.region, snapshot?.postal_code].filter(Boolean).join(', ')}
              </p>
            )}
            {snapshot?.email && <p className="text-sm text-muted">{snapshot.email}</p>}
            {snapshot?.tax_number && (
              <p className="mt-1 text-xs text-muted">
                {snapshot.tax_number_label ?? 'Tax no.'}: {snapshot.tax_number}
              </p>
            )}
            {invoice.issued_at && (
              <p className="mt-2 text-[11px] text-muted">
                Frozen at issue — later changes to your settings do not affect this document.
              </p>
            )}
          </div>

          <div>
            <p className="bdm-eyebrow mb-1.5">Bill to</p>
            <p className="text-sm font-bold text-ink">
              {clientSnapshot?.name ?? counterparty?.name ?? 'No client selected'}
            </p>
            {(clientSnapshot?.email ?? counterparty?.email) && (
              <p className="text-sm text-muted">{clientSnapshot?.email ?? counterparty?.email}</p>
            )}
          </div>
        </div>

        {/* Custom fields — context, never money */}
        {customEntries.length > 0 && (
          <div className="mt-5 rounded-panel border border-gold-line bg-white/50 p-4">
            <p className="bdm-eyebrow mb-2">Reference</p>
            <dl className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
              {customEntries.map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3 text-sm">
                  <dt className="text-muted">{humanise(k)}</dt>
                  <dd className="text-right font-semibold text-ink">{String(v)}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        {/* Lines */}
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <caption className="sr-only">Line items</caption>
            <thead>
              <tr className="border-b border-gold-line text-left">
                <th scope="col" className="py-2 pr-3 text-[11px] font-bold uppercase tracking-wider text-muted">Description</th>
                <th scope="col" className="py-2 px-3 text-right text-[11px] font-bold uppercase tracking-wider text-muted">Qty</th>
                <th scope="col" className="py-2 px-3 text-right text-[11px] font-bold uppercase tracking-wider text-muted">Rate</th>
                <th scope="col" className="py-2 px-3 text-[11px] font-bold uppercase tracking-wider text-muted">Tax</th>
                <th scope="col" className="py-2 pl-3 text-right text-[11px] font-bold uppercase tracking-wider text-muted">Amount</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id} className="border-b border-gold-line/50 last:border-0">
                  <td className="py-2.5 pr-3 font-medium text-ink">{l.description}</td>
                  <td className="bdm-num py-2.5 px-3 text-right text-muted">{Number(l.quantity)}</td>
                  <td className="bdm-num py-2.5 px-3 text-right text-muted">
                    {formatMinor(Number(l.unit_price_minor), currency, { showMinor: true })}
                  </td>
                  <td className="py-2.5 px-3 text-xs text-muted">{l.tax_label ?? l.tax_code ?? '—'}</td>
                  <td className="bdm-num py-2.5 pl-3 text-right font-semibold text-ink">
                    {formatMinor(Number(l.total_minor), currency, { showMinor: true })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Totals */}
        <div className="mt-4 ml-auto max-w-xs space-y-1.5 text-sm">
          <Row label="Subtotal" value={formatMinor(invoice.subtotal_minor, currency, { showMinor: true })} />
          {invoice.discount_minor > 0 && (
            <Row label="Discount" value={`−${formatMinor(invoice.discount_minor, currency, { showMinor: true })}`} />
          )}
          {Array.isArray(invoice.tax_breakdown) &&
            (invoice.tax_breakdown as Array<{ label: string; taxMinor: number; treatment: string }>).map((t, i) => (
              <Row
                key={i}
                label={t.treatment === 'standard' ? t.label : `${t.label} (0%)`}
                value={formatMinor(t.taxMinor, currency, { showMinor: true })}
              />
            ))}
          <div className="bdm-divider my-1.5" />
          <div className="flex justify-between">
            <span className="font-bold text-ink">Total</span>
            <span className="bdm-num font-extrabold text-ink">
              {formatMinor(invoice.total_minor, currency, { showMinor: true })}
            </span>
          </div>
          {invoice.paid_minor > 0 && (
            <>
              <Row label="Paid" value={`−${formatMinor(invoice.paid_minor, currency, { showMinor: true })}`} />
              <div className="flex justify-between border-t border-gold-line pt-1.5">
                <span className="font-bold text-ink">Balance due</span>
                <span className={`bdm-num font-extrabold ${invoice.balance_minor > 0 ? 'text-negative' : 'text-positive'}`}>
                  {formatMinor(invoice.balance_minor, currency, { showMinor: true })}
                </span>
              </div>
            </>
          )}
        </div>

        {(invoice.notes || invoice.payment_instructions || invoice.terms) && (
          <div className="mt-6 grid gap-4 border-t border-gold-line pt-5 sm:grid-cols-2">
            {invoice.notes && <Block title="Notes" body={invoice.notes} />}
            {invoice.payment_instructions && <Block title="How to pay" body={invoice.payment_instructions} />}
            {invoice.terms && <Block title="Terms" body={invoice.terms} />}
          </div>
        )}
      </section>

      {/* ── Source booking ── */}
      {booking && (
        <section className="bdm-card mb-4 p-5">
          <h2 className="bdm-h2 mb-2">Where this came from</h2>
          <dl className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
            <Pair label="Booking" value={booking.reference ?? booking.id.slice(0, 8)} />
            <Pair
              label="Gross booking value"
              value={formatMinor(Number(booking.gross_value_minor), booking.currency, { showMinor: true })}
            />
            {booking.commission_rate !== null && (
              <Pair label="Commission rate" value={`${(Number(booking.commission_rate) * 100).toFixed(2).replace(/\.?0+$/, '')}%`} />
            )}
            <Pair
              label="Commission expected"
              value={formatMinor(Number(booking.commission_expected_minor), booking.currency, { showMinor: true })}
            />
          </dl>
          <p className="bdm-hint mt-2">
            The gross booking value is context. Only this invoice&rsquo;s line items are billed, and
            only a matched payment becomes revenue.
          </p>
        </section>
      )}

      {/* ── Payments ── */}
      {payments.length > 0 && (
        <section className="bdm-card mb-4 p-5">
          <h2 className="bdm-h2 mb-3">Payments</h2>
          <ul className="space-y-2">
            {payments.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-gold-line/50 pb-2 last:border-0 last:pb-0">
                <div>
                  <p className="text-sm font-semibold text-ink">
                    {formatMinor(Number(p.amount_minor), p.currency, { showMinor: true })}
                  </p>
                  <p className="text-xs text-muted">
                    {p.received_on}
                    {p.method ? ` · ${p.method}` : ''}
                    {p.reference ? ` · ${p.reference}` : ''}
                  </p>
                </div>
                <span className={p.transaction_id ? 'bdm-badge-positive' : 'bdm-badge-neutral'}>
                  {p.transaction_id ? 'Matched to bank' : 'Recorded manually'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── Delivery ── */}
      {deliveries && deliveries.length > 0 && (
        <section className="bdm-card mb-4 p-5">
          <h2 className="bdm-h2 mb-3">Email delivery</h2>
          <ul className="space-y-2">
            {deliveries.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-gold-line/50 pb-2 last:border-0 last:pb-0">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink">{d.to_email}</p>
                  <p className="text-xs text-muted">
                    {new Date(d.created_at).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' })}
                    {d.error ? ` · ${d.error}` : ''}
                  </p>
                </div>
                <span className={DELIVERY_BADGE[d.state] ?? 'bdm-badge-neutral'}>
                  {DELIVERY_LABEL[d.state] ?? d.state}
                </span>
              </li>
            ))}
          </ul>
          {!can(access, 'deliveryTracking') && (
            <p className="bdm-hint mt-3">
              Delivered and bounced tracking is included from Starter. Until then this shows only
              whether the send was accepted.
            </p>
          )}
        </section>
      )}

      {/* ── History ── */}
      {events.length > 0 && (
        <section className="bdm-card p-5">
          <h2 className="bdm-h2 mb-3">History</h2>
          <ol className="space-y-2.5">
            {events.map((e) => (
              <li key={e.id} className="flex items-start justify-between gap-3 text-sm">
                <div>
                  <span className="font-semibold text-ink">
                    {EVENT_LABELS[e.event] ?? humanise(e.event)}
                  </span>
                  {e.actor_type !== 'user' && (
                    <span className="ml-2 bdm-badge-neutral">{e.actor_type}</span>
                  )}
                </div>
                <time className="shrink-0 text-xs text-muted" dateTime={e.created_at}>
                  {new Date(e.created_at).toLocaleString('en-CA', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                </time>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted">{label}</span>
      <span className="bdm-num font-semibold text-ink">{value}</span>
    </div>
  );
}

function Pair({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="bdm-num text-right font-semibold text-ink">{value}</dd>
    </div>
  );
}

function Block({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <p className="bdm-eyebrow mb-1">{title}</p>
      <p className="whitespace-pre-wrap text-sm text-muted">{body}</p>
    </div>
  );
}

function humanise(key: string): string {
  return key.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}
