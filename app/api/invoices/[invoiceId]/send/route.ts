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
import { isEnabled } from '@/lib/services/entitlements';
import { renderInvoiceHtml, renderInvoicePdf } from '@/lib/services/invoice-document';
import { buildRenderable } from '@/lib/services/invoice-render';
import { invoiceEmailHtml, invoiceEmailText } from '@/lib/services/invoice-email';
import { formatMinor } from '@/lib/domain/money';

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

    const { data: profile } = await ctx.db
      .from('profiles').select('plan').eq('id', ctx.userId).maybeSingle();
    if (!isEnabled(profile?.plan ?? 'free', 'invoice_send')) {
      throw new ServiceError('forbidden', 'Emailing invoices is not included in your plan.');
    }

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      throw new ServiceError(
        'not_configured',
        'Email sending is not configured on this deployment. Set RESEND_API_KEY to enable it.'
      );
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
    const docHtml = renderInvoiceHtml(renderable);
    const pdf = await renderInvoicePdf(docHtml);

    const business = renderable.business;
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? '';
    const viewUrl =
      invoice.share_token && !invoice.share_revoked_at && appUrl
        ? `${appUrl}/i/${invoice.share_token}`
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
    const payload: Record<string, unknown> = {
      from: `${sanitiseName(business.name)} <${process.env.RESEND_FROM_EMAIL ?? 'invoices@resend.dev'}>`,
      to: [to],
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
    };
    if (cc) payload.cc = [cc];
    // Resend v4+ uses camelCase. Getting this wrong silently drops the
    // header, which is exactly what happened in the retired prototype.
    if (business.email && EMAIL_RE.test(business.email)) payload.replyTo = business.email;
    if (pdf.ok && pdf.pdf) {
      payload.attachments = [
        {
          filename: `${(invoice.number ?? 'invoice').replace(/[^\w-]/g, '')}.pdf`,
          content: pdf.pdf.toString('base64'),
        },
      ];
    }

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const json = (await res.json().catch(() => ({}))) as { id?: string; message?: string };

    if (!res.ok) {
      // Record the failure and do NOT mark the invoice sent.
      await ctx.db
        .from('invoice_deliveries')
        .update({ state: 'failed', error: json.message ?? `HTTP ${res.status}`, subject })
        .eq('id', deliveryId);
      await logInvoiceEvent(ctx, invoice.id, 'send_failed', {
        to,
        error: json.message ?? `HTTP ${res.status}`,
      });
      logError('invoice.send_failed', new Error(json.message ?? `HTTP ${res.status}`), {
        requestId,
        businessId: ctx.businessId,
        invoiceId: invoice.id,
      });
      throw new ServiceError('upstream', json.message ?? 'The email provider rejected the message.');
    }

    // Provider accepted it — only now is the invoice "sent".
    await ctx.db
      .from('invoice_deliveries')
      .update({ state: 'sent', provider_message_id: json.id ?? null, subject })
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
      provider_message_id: json.id ?? null,
      attachment: pdf.ok,
      // Surfaced honestly rather than pretending a PDF went out.
      attachment_skipped_reason: pdf.ok ? null : pdf.reason,
    });

    logEvent('invoice.sent', { requestId, businessId: ctx.businessId, invoiceId: invoice.id });

    return NextResponse.json({
      ok: true,
      to,
      messageId: json.id ?? null,
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

/** Keeps a business name safe inside an email From header. */
function sanitiseName(name: string): string {
  return name.replace(/[<>"\r\n]/g, '').trim().slice(0, 78) || 'Invoices';
}
