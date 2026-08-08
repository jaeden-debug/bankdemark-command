'use client';

// ============================================================
// INVOICE ACTIONS
//
// Only the actions that are actually valid for the current status are
// rendered. There is no "mark as paid" button anywhere: paid is derived
// from recorded payments, so the only way to reach it is to record the
// money. That is what keeps status and balance from disagreeing.
// ============================================================

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  canIssue,
  canRecordPayment,
  canSend,
  canVoid,
  canDelete,
  type InvoiceStatus,
} from '@/lib/domain/invoice';
import { formatMinor } from '@/lib/domain/money';

interface Props {
  businessId: string;
  invoiceId: string;
  status: InvoiceStatus;
  balanceMinor: number;
  paidMinor: number;
  currency: string;
  number: string | null;
  shareUrl: string | null;
  clientEmail: string | null;
  canEmail: boolean;
  emailLockedReason: string | null;
}

type Dialog = 'payment' | 'void' | 'credit' | 'send' | null;

export default function InvoiceActions(props: Props) {
  const router = useRouter();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function call(label: string, url: string, init: RequestInit) {
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(url, init);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? 'That did not work.');
      setDialog(null);
      router.refresh();
      return json;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
      return null;
    } finally {
      setBusy(null);
    }
  }

  const patch = (body: Record<string, unknown>) => ({
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ businessId: props.businessId, ...body }),
  });

  return (
    <div className="space-y-3">
      {error && (
        <div role="alert" className="rounded-panel border border-negative/25 bg-negative-soft p-3">
          <p className="text-sm font-semibold text-negative">{error}</p>
        </div>
      )}
      {notice && (
        <div role="status" className="rounded-panel border border-positive/25 bg-positive-soft p-3">
          <p className="text-sm font-semibold text-positive">{notice}</p>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {canIssue(props.status) && (
          <>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() =>
                call('issue', `/api/invoices/${props.invoiceId}`, patch({ action: 'issue' }))
              }
              className="bdm-btn-gold"
            >
              {busy === 'issue' ? 'Issuing…' : 'Issue invoice'}
            </button>
            <a
              href={`/b/${props.businessId}/invoices/${props.invoiceId}/edit`}
              className="bdm-btn-secondary"
            >
              Edit
            </a>
          </>
        )}

        {canSend(props.status) && (
          <button
            type="button"
            onClick={() => setDialog('send')}
            disabled={busy !== null || !props.canEmail}
            title={props.emailLockedReason ?? undefined}
            className="bdm-btn-primary"
          >
            Send by email
          </button>
        )}

        {props.status !== 'draft' && (
          <a
            href={`/api/invoices/${props.invoiceId}/pdf?businessId=${props.businessId}`}
            className="bdm-btn-secondary"
          >
            Download PDF
          </a>
        )}

        {props.shareUrl && (
          <button
            type="button"
            onClick={() => {
              navigator.clipboard?.writeText(props.shareUrl!);
              setNotice('Link copied.');
            }}
            className="bdm-btn-secondary"
          >
            Copy client link
          </button>
        )}

        {canRecordPayment(props.status) && (
          <button type="button" onClick={() => setDialog('payment')} className="bdm-btn-primary">
            Record payment
          </button>
        )}

        {canVoid(props.status) && (
          <button type="button" onClick={() => setDialog('void')} className="bdm-btn-ghost">
            Void
          </button>
        )}

        {props.paidMinor > 0 && props.status !== 'void' && (
          <button type="button" onClick={() => setDialog('credit')} className="bdm-btn-ghost">
            Credit note
          </button>
        )}

        {canDelete(props.status) && (
          <button
            type="button"
            disabled={busy !== null}
            onClick={async () => {
              if (!confirm('Delete this draft? It has not been issued, so nothing is lost from your records.')) return;
              const ok = await call(
                'delete',
                `/api/invoices/${props.invoiceId}?businessId=${props.businessId}`,
                { method: 'DELETE' }
              );
              if (ok) router.push(`/b/${props.businessId}/invoices`);
            }}
            className="bdm-btn-ghost text-negative"
          >
            Delete draft
          </button>
        )}
      </div>

      {props.emailLockedReason && canSend(props.status) && (
        <p className="bdm-hint">{props.emailLockedReason}</p>
      )}

      {/* ── Record payment ── */}
      {dialog === 'payment' && (
        <Dialog title="Record a payment" onClose={() => setDialog(null)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              await call('payment', `/api/invoices/${props.invoiceId}/payments`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  businessId: props.businessId,
                  amountMajor: String(fd.get('amount') ?? ''),
                  currency: props.currency,
                  receivedOn: String(fd.get('receivedOn') ?? ''),
                  method: String(fd.get('method') ?? '') || null,
                  reference: String(fd.get('reference') ?? '') || null,
                }),
              });
            }}
            className="space-y-3"
          >
            <p className="bdm-sub">
              {formatMinor(props.balanceMinor, props.currency, { showMinor: true })} outstanding.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="bdm-label" htmlFor="pay-amount">Amount received</label>
                <input
                  id="pay-amount" name="amount" required inputMode="decimal"
                  className="bdm-input text-right"
                  defaultValue={(props.balanceMinor / 100).toFixed(2)}
                />
              </div>
              <div>
                <label className="bdm-label" htmlFor="pay-date">Date received</label>
                <input
                  id="pay-date" name="receivedOn" type="date" required
                  className="bdm-input"
                  defaultValue={new Date().toISOString().slice(0, 10)}
                />
              </div>
              <div>
                <label className="bdm-label" htmlFor="pay-method">Method</label>
                <select id="pay-method" name="method" className="bdm-select" defaultValue="EFT">
                  <option value="EFT">Bank transfer / EFT</option>
                  <option value="e-transfer">e-Transfer</option>
                  <option value="cheque">Cheque</option>
                  <option value="cash">Cash</option>
                  <option value="card">Card</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div>
                <label className="bdm-label" htmlFor="pay-ref">Reference</label>
                <input id="pay-ref" name="reference" className="bdm-input" placeholder="Optional" />
              </div>
            </div>
            <button type="submit" disabled={busy !== null} className="bdm-btn-gold w-full">
              {busy === 'payment' ? 'Recording…' : 'Record payment'}
            </button>
          </form>
        </Dialog>
      )}

      {/* ── Void ── */}
      {dialog === 'void' && (
        <Dialog title={`Void ${props.number ?? 'this invoice'}`} onClose={() => setDialog(null)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              await call(
                'void',
                `/api/invoices/${props.invoiceId}`,
                patch({ action: 'void', reason: String(fd.get('reason') ?? '') })
              );
            }}
            className="space-y-3"
          >
            <p className="bdm-sub">
              The invoice stays on record exactly as it was issued, marked void. Its client link
              stops working. This is how a mistake is corrected without rewriting history.
            </p>
            <div>
              <label className="bdm-label" htmlFor="void-reason">Reason</label>
              <input
                id="void-reason" name="reason" required className="bdm-input"
                placeholder="e.g. Issued to the wrong agency"
              />
            </div>
            <button type="submit" disabled={busy !== null} className="bdm-btn-danger w-full">
              {busy === 'void' ? 'Voiding…' : 'Void this invoice'}
            </button>
          </form>
        </Dialog>
      )}

      {/* ── Credit note ── */}
      {dialog === 'credit' && (
        <Dialog title="Issue a credit note" onClose={() => setDialog(null)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              const json = await call(
                'credit',
                `/api/invoices/${props.invoiceId}`,
                patch({ action: 'credit_note', reason: String(fd.get('reason') ?? '') })
              );
              if (json?.invoice?.id) {
                router.push(`/b/${props.businessId}/invoices/${json.invoice.id}`);
              }
            }}
            className="space-y-3"
          >
            <p className="bdm-sub">
              This invoice has payments against it, so it must not be voided. A credit note is a
              separate negative document that offsets it and leaves the payment history intact.
            </p>
            <div>
              <label className="bdm-label" htmlFor="credit-reason">Reason</label>
              <input id="credit-reason" name="reason" required className="bdm-input" placeholder="e.g. Booking cancelled" />
            </div>
            <button type="submit" disabled={busy !== null} className="bdm-btn-primary w-full">
              {busy === 'credit' ? 'Creating…' : 'Create credit note'}
            </button>
          </form>
        </Dialog>
      )}

      {/* ── Send ── */}
      {dialog === 'send' && (
        <Dialog title="Send this invoice" onClose={() => setDialog(null)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              const json = await call('send', `/api/invoices/${props.invoiceId}/send`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  businessId: props.businessId,
                  to: String(fd.get('to') ?? ''),
                  cc: String(fd.get('cc') ?? '') || null,
                  message: String(fd.get('message') ?? '') || null,
                }),
              });
              if (json?.ok) setNotice(`Sent to ${json.to}.`);
            }}
            className="space-y-3"
          >
            <div>
              <label className="bdm-label" htmlFor="send-to">To</label>
              <input
                id="send-to" name="to" type="email" required className="bdm-input"
                defaultValue={props.clientEmail ?? ''}
              />
            </div>
            <div>
              <label className="bdm-label" htmlFor="send-cc">CC</label>
              <input id="send-cc" name="cc" type="email" className="bdm-input" placeholder="Optional" />
            </div>
            <div>
              <label className="bdm-label" htmlFor="send-msg">Message</label>
              <textarea id="send-msg" name="message" className="bdm-textarea" placeholder="Optional note to include" />
            </div>
            <p className="bdm-hint">
              The PDF is attached and a secure link is included. Sending twice is prevented for
              five minutes.
            </p>
            <button type="submit" disabled={busy !== null} className="bdm-btn-gold w-full">
              {busy === 'send' ? 'Sending…' : 'Send invoice'}
            </button>
          </form>
        </Dialog>
      )}
    </div>
  );
}

function Dialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" aria-label="Close" className="absolute inset-0 bg-ink/30" onClick={onClose} />
      <div className="relative max-h-[90dvh] w-full overflow-y-auto rounded-t-card border border-gold-line bg-cream p-5 shadow-float sm:max-w-lg sm:rounded-card">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="bdm-h2">{title}</h2>
          <button type="button" onClick={onClose} className="bdm-btn-ghost bdm-btn-sm" aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
