// ============================================================
// SEND AN INVOICE
//
// Rules this route exists to enforce:
//   1. An invoice is NEVER marked sent unless the provider actually
//      accepted it. A failed send is recorded as failed.
//   2. A double-click cannot send twice — a short idempotency window
//      is claimed in the database before the provider is called.
//   3. Every attempt is recorded with its provider message id, so
//      "was it delivered?" has an answer.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { requireBusiness } from '@/lib/services/context';
import { ServiceError, logError, logEvent, toServiceError } from '@/lib/services/errors';
import { getInvoice, logInvoiceEvent } from '@/lib/services/invoices';
import { getAccess, can } from '@/lib/services/access';
import { renderInvoiceHtml, renderInvoicePdf } from '@/lib/services/invoice-document';
import { buildRenderable, loadLogoDataUri } from '@/lib/services/invoice-render';
import { invoiceEmailHtml, invoiceEmailText } from '@/lib/services/invoice-email';
import { formatMinor } from '@/lib/domain/money';
import { sendEmail, emailConfig } from '@/lib/services/email';
import { appOrigin, invoiceShareUrl } from '@/lib/config/app-url';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest, { params }: { params: { invoiceId: string } }) {
  const requestId = crypto.randomUUID();
  let deliveryId: string | null = null;
  let ctxRef: Awaited<ReturnType<typeof requireBusiness>> | null = null;

  try {
    const body = await req.json();
    if (!body?.businessId) throw new ServiceError('validation', 'Missing business.');

    const ctx = await requireBusiness(String(body.businessId), 'member');
    ctxRef = ctx;

    const access = await getAccess(ctx);
    if (!can(access, 'emailSending')) {
      throw new ServiceError('forbidden', 'Emailing invoices is not included in your plan.');
    }

    // Fail before claiming an idempotency slot, so a misconfigured
    // deployment does not burn the user's send window.
    const cfg = emailConfig();
    if (!cfg.ok) {
      throw new ServiceError('not_configured', `Email is not configured. ${cfg.reason}`);
    }

    const detail = await getInvoice(ctx, params.invoiceId);
    const invoice = detail.invoice;

    if (!invoice.issued_at) {
      throw new ServiceError('conflict', 'Issue this invoice before sending it.');
    }
    if (invoice.status === 'void') {
      throw new ServiceError('conflict', 'This invoice is void and cannot be sent.');
    }

    const to = String(body.to ?? detail.counterparty?.email ?? '').trim();
    if (!EMAIL_RE.test(to)) {
      throw new ServiceError('validation', 'Enter a valid email address to send to.');
    }
    const cc = body.cc ? String(body.cc).trim() : null;
    if (cc && !EMAIL_RE.test(cc)) {
      throw new ServiceError('validation', 'That CC address is not valid.');
    }

    // ── Idempotency: claim a 5-minute window BEFORE calling the
    // provider. A duplicate submit collides on the unique index and is
    // refused, so the client is never billed for two identical emails.
    const windowKey = `${to}:${Math.floor(Date.now() / 300_000)}`;
    const claim = await ctx.db
      .from('invoice_deliveries')
      .insert({
        invoice_id: invoice.id,
        business_id: ctx.businessId,
        channel: 'email',
        to_email: to,
        cc_email: cc,
        subject: null,
        provider: 'resend',
        state: 'queued',
        idempotency_key: windowKey,
        sent_by: ctx.userId,
      })
      .select('id')
      .single();

    if (claim.error) {
      if (claim.error.code === '23505') {
        throw new ServiceError(
          'conflict',
          'This invoice was just sent to that address. Wait a few minutes before sending again.'
        );
      }
      throw new ServiceError('internal', 'Could not start the send.', {
        detail: claim.error.message,
        cause: claim.error,
      });
    }
    deliveryId = claim.data.id;

    // ── Build the document ──
    const renderable = buildRenderable(detail);
    renderable.logoDataUri = await loadLogoDataUri(
      renderable.business.logo_path,
      ctx.db
    );
    const docHtml = renderInvoiceHtml(renderable);
    const pdf = await renderInvoicePdf(docHtml);

    const business = renderable.business;
    // Throws in production if the origin is unset or localhost, rather
    // than mailing a client a link they cannot open.
    appOrigin();
    const viewUrl =
      invoice.share_token && !invoice.share_revoked_at
        ? invoiceShareUrl(invoice.share_token)
        : null;

    const amount = formatMinor(invoice.balance_minor || invoice.total_minor, invoice.currency, {
      showMinor: true,
    });
    const subject = `Invoice ${invoice.number} from ${business.name} — ${amount} ${invoice.currency} due ${invoice.due_date}`;

    const emailHtml = invoiceEmailHtml({
      businessName: business.name,
      clientName: renderable.client.name,
      invoiceNumber: invoice.number ?? '',
      amount,
      currency: invoice.currency,
      dueDate: invoice.due_date,
      viewUrl,
      message: body.message ? String(body.message) : null,
      paymentInstructions: invoice.payment_instructions,
      accentColor: business.accent_color,
      hasAttachment: pdf.ok,
    });

    // ── Send ──
    let messageId: string | null = null;
    try {
      const sent = await sendEmail({
        to,
        cc,
        replyTo: business.email,
        fromName: business.name,
        subject,
        html: emailHtml,
        text: invoiceEmailText({
          businessName: business.name,
          clientName: renderable.client.name,
          invoiceNumber: invoice.number ?? '',
          amount,
          currency: invoice.currency,
          dueDate: invoice.due_date,
          viewUrl,
          message: body.message ? String(body.message) : null,
        }),
        attachments:
          pdf.ok && pdf.pdf
            ? [{
                filename: `${(invoice.number ?? 'invoice').replace(/[^\w-]/g, '')}.pdf`,
                content: pdf.pdf,
              }]
            : undefined,
        // Lets the webhook find this delivery row from a provider event.
        tags: { invoice_id: invoice.id, delivery_id: deliveryId },
      });
      messageId = sent.messageId;
    } catch (sendError) {
      const se = toServiceError(sendError, 'send that invoice');
      await ctx.db
        .from('invoice_deliveries')
        .update({ state: 'failed', error: se.message.slice(0, 500), subject })
        .eq('id', deliveryId);
      await logInvoiceEvent(ctx, invoice.id, 'send_failed', { to, error: se.message });
      logError('invoice.send_failed', se, {
        requestId, businessId: ctx.businessId, invoiceId: invoice.id,
      });
      throw se;
    }

    // Provider accepted it — only now is the invoice "sent".
    await ctx.db
      .from('invoice_deliveries')
      .update({
        state: 'sent',
        provider_message_id: messageId,
        subject,
        last_event_at: new Date().toISOString(),
      })
      .eq('id', deliveryId);

    // Never move a paid or partly paid invoice backwards to `sent`.
    await ctx.db
      .from('invoices')
      .update({ status: 'sent', sent_at: new Date().toISOString() })
      .eq('id', invoice.id)
      .eq('business_id', ctx.businessId)
      .in('status', ['issued', 'overdue']);

    await logInvoiceEvent(ctx, invoice.id, 'sent', {
      to,
      cc,
      provider_message_id: messageId,
      attachment: pdf.ok,
      // Surfaced honestly rather than pretending a PDF went out.
      attachment_skipped_reason: pdf.ok ? null : pdf.reason,
    });

    logEvent('invoice.sent', { requestId, businessId: ctx.businessId, invoiceId: invoice.id });

    return NextResponse.json({
      ok: true,
      to,
      messageId,
      attached: pdf.ok,
      attachmentNote: pdf.ok
        ? null
        : 'The PDF engine is not available on this deployment, so the email contains a secure link instead of an attachment.',
    });
  } catch (error) {
    if (deliveryId && ctxRef) {
      await ctxRef.db
        .from('invoice_deliveries')
        .update({
          state: 'failed',
          error: error instanceof Error ? error.message.slice(0, 500) : 'unknown',
        })
        .eq('id', deliveryId)
        .then(() => {}, () => {});
    }
    const e = toServiceError(error, 'send that invoice');
    logError('invoice.send_error', e, { requestId, route: '/api/invoices/[invoiceId]/send' });
    return NextResponse.json(e.toJSON(), { status: e.status });
  }
}
